# DNSPup Customer API v1 — six-tool client contract

Base URL: `https://api.dnspup.com`

The customer API is versioned under `/v1`. This document covers the six probe tools used by KY DNSPup. Node operation, platform administration and other service APIs are outside this client contract.

## Authentication

Credentials use an `api_key` and `api_secret` pair:

```http
X-API-Key: dnp_key_xxx
X-API-Secret: dnp_secret_xxx
```

Credentials are approved and assigned by an administrator. Users cannot create,
reset, enable, or disable credentials themselves. After assignment, the owning
user can view both values in `用户中心 → API 密钥`; users without an assignment
are directed to the configured contact methods.

Both headers are required for authenticated requests. Keep them on the KY DNSPup server; never embed them in browser code or a public repository.

## Source binding

Each newly issued API key must be bound to exactly one source: either one fixed
public IP address (`sourceMode: "ip"`) or one complete server hostname
(`sourceMode: "domain"`). Confirm the assigned source binding before connecting this client.

IP-bound keys are accepted only when the server-side trusted client-IP resolver
matches the configured address. Do not try to override this with a client-set
`X-Forwarded-For` header.

Domain-bound keys must include all of the following headers on every
authenticated request:

```http
X-API-Source-Domain: api.customer.example
X-API-Timestamp: 1788268800
X-API-Nonce: 0123456789abcdef0123456789abcdef
X-API-Signature: 64-lowercase-hex-characters
```

The timestamp must be within 90 seconds of server time. The nonce is a
single-use 16-byte random value represented as 32 hexadecimal characters and
is rejected when replayed. The signature covers the exact request body bytes,
so the body must be signed before it is sent.

First derive the signing key from the API secret:

```text
secretHash = lowercase_hex(SHA256(api_secret))
signingKey = HMAC-SHA256(secretHash, "dnspup-customer-api-signing/v1\0")
```

Here `\0` represents one NUL byte (`0x00`), not the two characters backslash and zero. Use the hexadecimal `secretHash` as UTF-8 key bytes; keep the derived `signingKey` as raw bytes.

Then build the canonical message with one field per line. The empty query line
must be retained for requests without a query string:

```text
dnspup-customer-api-v1
METHOD
URL_ESCAPED_PATH
RAW_QUERY
TIMESTAMP
NONCE
NORMALIZED_SOURCE_DOMAIN
lowercase_hex(SHA256(raw_body))
```

`X-API-Signature` is the lowercase hexadecimal HMAC-SHA256 of that canonical
message using `signingKey`. Domain names are normalized to lowercase ASCII
IDNA form; schemes, ports, paths, wildcards and multiple domains are rejected.
The source check runs before rate limiting and monthly quota consumption, so a
failed source or signature check does not consume API usage.

## Health

```http
GET /v1/health
```

No authentication is required.

## Account And Quota

```http
GET /v1/account
```

Returns the key name, assigned plan, expiration time, status, monthly request limit, current-month usage, total usage and timestamps. A `monthlyLimit` of `0` means unlimited. Monthly counters reset on the Asia/Shanghai calendar month boundary. Expired keys are rejected even when their enabled flag remains set.

`data.capabilities.asyncProbesV1 === true` explicitly advertises asynchronous
probe creation. A missing or false field does not advertise this capability;
use the existing synchronous contract in that case. Do not infer support from
the health endpoint, a version string, or node capabilities.

## Available Nodes

```http
GET /v1/nodes
```

Returns online Agent nodes that may be used in `nodeIds`. Account, tool-catalog and node-list requests do not consume probe quota, but they still follow the API Key's per-minute rate limit when one is configured.

Each node also includes `capabilities.ipVersions` (an array of `"4"` and/or `"6"`)
and `capabilities.tools` (a subset of the six probe types). Tools are intersected
with the current key's permissions and the node's execution capabilities. Node
scope and availability still apply at creation time; this catalog does not
reserve capacity. Node tokens and internal connection details are not exposed.

## Available Tools

```http
GET /v1/tools
```

Returns the tools enabled for the current API Key. Availability depends on the assigned API authorization.

## Create Probe

```http
POST /v1/probes
Content-Type: application/json
```

Example:

```json
{
  "type": "ping",
  "target": "example.com",
  "count": 4,
  "ipVersion": "4",
  "nodeIds": ["node-id-from-v1-nodes"]
}
```

Fields:

| Field | Required | Values |
| --- | --- | --- |
| `type` | yes | `ping`, `tcping`, `http`, `dns`, `traceroute`, `mtr` |
| `target` | yes | Public IP, domain, or HTTP(S) URL |
| `count` | no | Ping/TCPing/HTTP: `1` to the configured limit, default `4`; DNS/Traceroute fixed at `1`; MTR fixed at `100` |
| `ipVersion` | no | `4` or `6`, default `4` |
| `nodeIds` | no | Up to the key's `maxNodes` limit; omitted selects eligible online nodes automatically |
| `port` | tcping | `1` to `65535` |
| `method` | http | `GET` or `HEAD`, default `GET` |
| `record` | dns | `A`, `AAAA`, `CNAME`, `MX`, `NS`, `TXT`, `PTR` or `SRV` |
| `server` | dns/traceroute | `运营商DNS` or a public DNS server |
| `mode` | traceroute/mtr | `traceroute` or `mtr` |

Private, loopback, link-local, multicast and single-label local targets are rejected.
Selected nodes must be online, within the key's authorization and compatible with the requested tool and IP version. Omitted node IDs select eligible nodes automatically.

Response:

```json
{
  "data": {
    "requestId": "req_xxx",
    "status": "completed",
    "type": "ping",
    "target": "example.com",
    "results": [],
    "usage": {
      "monthlyLimit": 5000,
      "monthlyUsed": 17,
      "remaining": 4983,
      "totalUsage": 42
    }
  }
}
```

`status` is `completed`, `partial`, or `timeout`. A probe consumes one request after authentication, validation and node selection succeed. Node count does not currently change the request unit.

## Asynchronous Probes And Result Recovery

The six probe types above can use the same body with these additional headers,
after the account endpoint explicitly advertises support:

```http
POST /v1/probes
Prefer: respond-async
Idempotency-Key: 9a7db0e5-3ec0-4ee9-9544-3ef909565c64
Content-Type: application/json
```

The usual credentials and source checks are required. Generate and persist a
fresh idempotency key for each intentional new probe. A key is 1–128 printable
ASCII characters without spaces and is scoped to the authenticated API key.
The server binds it to normalized probe parameters, including tool, target,
options and explicit node selection. Node-ID order and duplicate IDs do not
change that selection digest. A different payload with the same key returns
`409 idempotency_conflict`.

Creation returns `202`; an identical accepted request replay returns `200`
with the existing task. Admission, the durable task and the single monthly
request charge are decided together. Replays do not execute a new task or
consume another request unit. POST attempts, including replays, still follow
the key's ordinary per-minute rate limit. Requests without `Prefer:
respond-async` retain the synchronous behavior; `Idempotency-Key` alone does
not opt into this contract or make synchronous requests idempotent.
Replayed POST requests still validate the key's current tool and parameter
permissions and require asynchronous creation to be enabled. Once a task ID is
known, use GET to recover its result instead of relying on POST replay.

```json
{
  "data": {
    "requestId": "req_0123456789abcdef01234567",
    "status": "queued",
    "completedNodes": 0,
    "totalNodes": 2,
    "createdAt": "2026-10-13T00:00:00Z",
    "updatedAt": "2026-10-13T00:00:00Z",
    "expiresAt": "2026-10-14T00:00:00Z",
    "queryUrl": "/v1/probes/req_0123456789abcdef01234567"
  }
}
```

Save `requestId` before polling. The response also supplies `X-API-Request-ID`
and a relative `Location`. Query only the configured API origin:

```http
GET /v1/probes/req_0123456789abcdef01234567
```

GET uses the same credential pair and source binding as creation. Domain-bound
clients must sign the GET method, escaped query path, empty body and a fresh
timestamp/nonce for every attempt. Retrying a POST also needs a fresh signature
and nonce while retaining its original idempotency key and body. Another key's
task and a nonexistent task both return `404 task_not_found`.

Queries do not consume probe quota or the ordinary request-rate bucket. They
use a separate shared limit of **180 requests per minute per API key**, across
all tasks. Start with one query every two seconds, share polling across callers,
and respect `Retry-After` (normally `2` for queued/running tasks, `60` for query
rate limiting). The GET response uses the same envelope as creation:

| `data.status` | Meaning |
| --- | --- |
| `queued` | Accepted and waiting for a worker |
| `running` | Work is in progress; `result` may contain partial measurements |
| `completed` | All selected node tasks reached a terminal response; inspect individual measurements |
| `partial` | The deadline elapsed with some results available |
| `timeout` | The deadline elapsed without results |
| `failed` | Processing failed; `error.code` describes the failure |
| `unknown` | Execution state cannot be established safely; do not automatically run it again |

`completedNodes` counts terminal node tasks, including those finalized as
timeouts; it is not a success count. `result`, when present, is the former
synchronous response's **data body**, without a second `data` wrapper. It keeps
the per-tool `results`, DNS rows, or traceroute/MTR traces and their measurement
semantics. Top-level completion does not prove that a target was reachable.
An `unknown` or `failed` task may still contain partial measurements; its
`result.status` retains that task state. Clients must not turn it into a
successful or fully completed probe. A task error is under `data.error.code`;
HTTP request errors continue to use the top-level `error` envelope below.

Results are available for **24 hours from creation** (`expiresAt`); the
idempotency record is retained for **30 days from creation**. Once results
expire, GET and a matching replay return `410 result_expired`, without execution
or another charge. After 30 days the idempotency record may be removed: do not
reuse old keys. Persist results locally if longer retention is needed.

After any response containing a valid task ID, recover by GET only; never
downgrade to a synchronous POST. If the initial response is lost before an ID
is obtained, keep the state unknown until a deliberate retry with the **same**
idempotency key and parameters recovers it. Do not issue a new key as a network
error fallback. A `401`, `403`, `404`, `410` or temporary `503` query response is
not permission to submit the probe again.

Idempotency prevents repeated acceptance and charging; it does not prove a
measurement executed exactly once on a remote node. An uncertain execution can
produce `unknown`. A new probe must be an explicit caller action.

Traceroute and MTR responses return `traces`; DNS responses return `rows`.
MTR may take longer than a normal probe. Use the response's task status and
per-node results to distinguish progress from target reachability.

## Per-key access policy

The assigned authorization determines the allowed tools, node scope, maximum
nodes and sample count per request, request rate, expiry and monthly quota.
Check `/v1/account`, `/v1/tools` and `/v1/nodes`; the final creation response
is authoritative if permissions or node availability change.

## Errors

Errors use a stable envelope:

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "..."
  }
}
```

| HTTP status | Code | Meaning |
| --- | --- | --- |
| `400` | `invalid_request`, `invalid_nodes`, `trusted_dns_resolution_failed` | Invalid target/options/node selection, or trusted public DNS resolution failed |
| `400` | `invalid_idempotency_key` | Missing, repeated, or invalid asynchronous idempotency header |
| `401` | `unauthorized` | Missing/invalid credential pair, disabled, expired, or revoked API key |
| `404` | `task_not_found` | Task does not exist or belongs to another API key |
| `409` | `idempotency_conflict` | Idempotency key was used with different normalized parameters |
| `410` | `result_expired` | The task's 24-hour result window has expired; it is not rerun or charged again |
| `429` | `quota_exceeded` | Monthly request limit reached |
| `429` | `rate_limited` | Per-key rolling request limit reached |
| `403` | `tool_not_allowed` | The API Key has not been granted this tool |
| `500` | `internal_error` | Request could not be processed or metered |
| `503` | `service_unavailable` | Customer API is disabled or its storage is unavailable |
| `503` | `async_unavailable` | New asynchronous creation is not enabled or not available |

