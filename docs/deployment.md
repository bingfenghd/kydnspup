# 安装、备份、升级与回滚

KY DNSPup 是 Node.js 24 + React + SQLite 单实例应用。当前接入 DNSPup 客户 API，不需要部署平台数据库、节点 Agent 或调度器。ITDOG 是同类工具的参考名称，与本项目无官方关联。

以下命令均在取得源码后的项目根目录执行。不要让多个进程或容器共用同一个数据目录，也不要为本应用扩容多个副本。

## Linux Docker 初次安装

准备 Docker Engine、Docker Compose V2、`openssl`，以及绑定到服务器的域名。使用本地源码构建镜像；不需要从某个镜像仓库拉取本项目镜像。

```sh
chmod +x scripts/deployment.sh
./scripts/deployment.sh init
vi .env
```

`chmod` 用于恢复从网页下载或上传源码时可能丢失的脚本执行权限。在 `.env` 中将 `KY_PUBLIC_ORIGIN` 改为实际 HTTPS Origin，例如 `https://example.com`，不带路径或末尾斜线。`init` 自动生成 32 字节随机初始化令牌，写入权限为 `600` 的 `.env`；已有文件不会覆盖。保留 `KY_SETUP_TOKEN` 的随机值，不要使用示例字符串或空值。

```sh
docker compose config --quiet
docker compose build app
./scripts/deployment.sh prepare
docker compose up -d --no-build --wait --wait-timeout 90 app
curl --fail http://127.0.0.1:4178/api/health
```

Compose 使用 Linux `host` 网络，应用仅监听宿主机 `127.0.0.1:4178`，不使用端口映射。由同机 Nginx 对外提供 HTTPS；不要把应用监听地址直接改成公网地址。Docker Desktop 的 host 网络行为与 Linux 不同，本流程以 Linux 服务器为准。

容器以 UID/GID `1000` 运行，根文件系统只读；`prepare` 设置 `var/` 权限，数据只挂载到 `/app/var`。健康检查不消费节点检测额度。不要公开 `docker compose config` 的完整展开结果、容器环境变量或 inspect 输出；只做配置校验时使用上面的 `--quiet`。

## 配置 HTTPS

先将域名解析到服务器，并取得域名的有效 TLS 证书。证书申请与续期由站长所用证书工具负责。`examples/nginx.conf.example` 提供完整站点示例，默认证书位置为 `/etc/letsencrypt/live/example.com/`。

以配置目录为 `/etc/nginx/conf.d`、使用 systemd 的 Linux 为例：

```sh
sudo cp examples/nginx.conf.example /etc/nginx/conf.d/kydnspup.conf
sudo vi /etc/nginx/conf.d/kydnspup.conf
# 替换 example.com、证书路径；若改了 KY_PORT，也同步修改 proxy_pass。
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://example.com/api/health
```

示例中的 `example.com` 必须替换为自己的域名；已有站点或面板托管 Nginx 时，把同样的 `server` / `location` 配置合并到该站点，避免重复监听或覆盖其他服务。

`.env` 的 `KY_PUBLIC_ORIGIN` 必须与浏览器访问地址一致，`KY_TRUST_LOCAL_PROXY=1`。Nginx 必须用 `$remote_addr` 覆盖 `X-Real-IP`，不能原样传递访客提供的值。当前应用只信任来自本机回环地址的代理，不支持直接信任 Docker 网桥或远程代理。HTTPS Origin 会启用管理员会话的 Secure Cookie。

访问 `https://example.com/admin`，通过私密编辑器读取 `.env` 中的初始化令牌，设置至少 12 个字符的管理员密码。该令牌只用于首次初始化，不代替管理员密码。完成 [API 接入](onboarding.md) 后，再手动发起一次小范围检测；健康接口成功不等于 API 授权和真实检测已验证。

## 管理员初始化与登录

管理地址为本站域名下的 `/admin`。当前是单管理员模式，**没有用户名，也没有默认密码**。

| 阶段 | 应填写的内容 |
| --- | --- |
| 本机首次安装 | 自己设置一个 12–128 个字符的管理员密码，并再次确认 |
| 公网首次安装 | 自设密码、确认密码，以及私密 `.env` 中的 `KY_SETUP_TOKEN` |
| 日常登录 | 首次设置的管理员密码，不需要用户名或初始化令牌 |
| 修改密码 | 登录后进入「系统管理 → 备份与安全」，填写原密码和新密码 |

`./scripts/deployment.sh init` 生成的是初始化令牌，不会生成或显示管理员密码。完成初始化后，令牌不能代替密码登录。DNSPup 注册账号及其 API 凭据与本地管理登录独立。

### KY_SETUP_TOKEN 是什么，怎么填写？

它是**首次创建本站管理员的安装凭证**。新站在管理员创建前也可能被公网访问；如果只要求访客自己设置密码，任何先打开 `/admin` 的人都能抢先成为管理员。服务器校验这个令牌，确认初始化者持有服务器上的私密配置。因此公网安装保留这项保护，不要删除它。

1. 在服务器的项目目录执行 `./scripts/deployment.sh init`。脚本自动生成 64 位十六进制随机值，写入真实 `.env` 的 `KY_SETUP_TOKEN=` 后面；不用向 DNSPup 申请，也不要复制 `.env.example` 的空值。已有 `.env` 不会被覆盖。
2. 用 `vi .env` 等私密编辑器打开文件，配置自己的 `KY_PUBLIC_ORIGIN`，并复制 `KY_SETUP_TOKEN=` **等号后面的完整值**，不包含变量名。不要把整个文件、令牌或截图发到聊天、工单或 GitHub。
3. 按本文完成启动和 HTTPS 配置，打开自己域名的 `/admin`。在「初始化令牌」中粘贴上述值；另设一个 12–128 个字符的管理员密码，再确认密码并点击「创建管理员」。令牌与管理员密码应当不同。
4. 创建成功后，后续只用管理员密码登录。令牌不能登录后台、调用节点 API、重置密码或再次创建管理员。它不消耗检测额度。

初始化成功后继续私密保留 `.env`：当前 Docker Compose 会检查该变量非空，删除它会导致启动或升级校验失败，但日常登录不会再次要求输入。保留 `var/` 的升级沿用已有管理员；重新生成令牌也不会更改或找回管理员密码。

如果提示「需要服务器配置的初始化令牌」，确认复制的是当前部署 `.env` 的值，且运行中的应用已加载该文件。Docker 修改环境配置后需重建容器（`docker compose up -d --no-build --force-recreate --wait app`），Node 直接运行需使用 `node --env-file=.env server/index.mjs` 重新启动本站进程。重启前等待检测结束；不要删除数据目录。

仅在默认本机模式（监听 `127.0.0.1` 且未设置 `KY_PUBLIC_ORIGIN`）下无需令牌。通过反向代理开放公网时，必须设置真实 `KY_PUBLIC_ORIGIN`，不能通过省略它来跳过初始化保护。

已有部署保留 `var/` 时，升级不会重设管理员密码，也不会重新显示创建管理员页面。密码以不可逆哈希保存，不能从数据库读出原文；请把首次设置的密码保存在自己的密码管理器中。当前没有邮件找回入口，不要通过删除 `var/` 来尝试找回密码，那会同时丢失本站配置和 API 凭据。

## Node.js 直接运行

需要 Node.js 24 或以上版本。仅本机查看：

```sh
npm ci
npm run build
npm start
```

默认监听 `127.0.0.1:4178`。在默认本机模式下，进入 `/admin` 直接创建管理员，无需初始化令牌。`npm start` 不自动加载 `.env`。

对外运行时先生成私密环境文件并配置 HTTPS，再使用：

```sh
chmod +x scripts/deployment.sh
./scripts/deployment.sh init
vi .env
node --env-file=.env server/index.mjs
```

初始化环境文件只需 `openssl`，不调用 Docker。该命令在前台运行；需要常驻时由站长配置进程管理服务，启动命令仍需加载同一个环境文件，并为运行用户授予数据目录权限。不要与 Docker 版本同时使用同一份 `var/`。

## 环境变量

| 变量 | Node 直接运行的默认值 | 用途 |
| --- | --- | --- |
| `KY_HOST` | `127.0.0.1` | 监听地址；Compose 固定为本机回环 |
| `KY_PORT` | `4178` | 监听端口 |
| `KY_PUBLIC_ORIGIN` | 空 | 对外 Origin，例如 `https://example.com` |
| `KY_SETUP_TOKEN` | 空 | 对外部署首次创建管理员的初始化令牌 |
| `KY_DATA_DIR` | `var` | 数据目录；Compose 固定为容器内 `/app/var` |
| `KY_TRUST_LOCAL_PROXY` | `0` | 是否信任本机回环代理覆盖的 `X-Real-IP`；Compose 固定为 `1` |
| `KY_IMAGE` | 不使用 | Compose 镜像标签；默认 `kydnspup:0.1.1-local` |

API Key / Secret 在站长管理端填写，不写入示例配置。真实 `.env`、数据库、加密密钥和运行日志均不能公开。

## 备份与恢复

管理端「导出配置」只包含站点设置、工具、广告、友情链接和访问限制，不包含 API 凭据、管理员密码、会话或调用记录。完整灾备需要备份整个数据目录及其配套应用版本。

Compose 冷备份：

```sh
./scripts/deployment.sh backup before-upgrade
```

备份名称只能包含字母、数字、下划线和短横线，不能重复。脚本停止本站容器，复制完整数据目录（包含隐藏 `.key`、数据库及存在的 WAL），执行 SQLite `quick_check`，生成 SHA-256 清单并记录当前不可变镜像 ID。随后恢复原运行状态；原本停止的容器不会被启动。运行中的检测最多等待 300 秒退出，维护前应先等待检测结束。

备份位于 `backups/before-upgrade/`，包含解密 API 凭据所需材料，应加密并限制访问。`.env` 不包含在数据备份中，旧镜像 ID 也不能代替镜像文件。另行私密保存配置与镜像，例如：

```sh
umask 077
cp -p .env backups/before-upgrade.env
docker image save -o backups/before-upgrade-image.tar \
  "$(docker inspect --format '{{.Image}}' "$(docker compose ps -a -q app)")"
```

把数据目录备份、私密环境文件、镜像归档及对应源码版本一起保存在安全位置。复制由容器创建的备份可能需要 root 权限；不要为了复制而放宽目录的公共访问权限。文件哈希用于检查损坏，不是来源签名。

同一部署目录中恢复：

```sh
./scripts/deployment.sh restore before-upgrade
curl --fail http://127.0.0.1:4178/api/health
```

脚本先校验备份、密钥、数据库和本机旧镜像，再停止应用并自动保存一份 `before-restore-*` 当前数据备份。随后恢复数据，将 `.env` 中 `KY_IMAGE` 固定为备份的镜像 ID，并等待健康状态。数据恢复失败时应用保持停止；保留错误信息和备份，排除问题后再操作，不要启动到不确定的数据目录。

恢复前不要删除旧镜像。换服务器时需要 `docker image load -i backups/before-upgrade-image.tar`，并恢复相应私密 `.env`、备份目录和源码；脚本的 `restore` 流程要求当前 Compose 项目已有 `app` 容器，不能直接代替空服务器初始化。先按初装步骤准备该项目，再恢复备份。

Node 直接运行时，停止本站进程，再完整复制整个数据目录（包括隐藏文件和 WAL）。恢复前保留当前目录，换回同一份备份后使用配套旧代码启动。数据库与 `.key` 必须来自同一备份；密钥丢失后无法解密 API 凭据。

## 升级与回滚

升级不自动拉取代码或镜像。保留相同部署目录、Compose 项目名、`.env`、`var/` 和 `backups/`：

1. 保存当前源码与锁文件，执行 `./scripts/deployment.sh backup before-upgrade`，确认备份成功，保留旧镜像。
2. 将新版本源码更新到该目录，避免覆盖私密环境文件、数据和备份。在 `.env` 中给 `KY_IMAGE` 设置新标签，例如 `kydnspup:upgrade-candidate`，不要复用旧标签。
3. 构建并启动新镜像：

```sh
docker compose config --quiet
docker compose build app
docker compose up -d --no-build --wait --wait-timeout 90 app
curl --fail http://127.0.0.1:4178/api/health
```

核验前台、管理员登录、站点设置及「测试已保存的连接」。需要真实检测时主动发起，检测会按平台规则计量。升级期间不要同时执行其他备份或恢复操作。

失败时恢复配套旧镜像与数据：

```sh
./scripts/deployment.sh restore before-upgrade
curl --fail http://127.0.0.1:4178/api/health
```

再核验管理登录、设置和 API 连接。备份后的新增数据不会合并。恢复后 `.env` 已固定旧镜像 ID，下次升级前应再次改为新的构建标签；若新版本修改了 Compose 或部署脚本，也需恢复对应旧版本文件。不要用 `docker system prune` 清理仍用于回滚的镜像。

Node 部署升级时，停止进程并备份数据，保留旧源码与锁文件；替换代码后重新执行 `npm ci`、`npm run build` 并加载原环境文件启动。失败则恢复旧源码及其配套完整数据备份。

## 数据保留与验收

本地调用记录保留 7 天，完整结果只在内存中短期缓存；已保存平台任务编号的异步请求，可在平台结果有效期内恢复，详见 [任务恢复边界](platform-job-adapter.md)。备份回退不会撤销已经在平台发生的检测或扣费。

在公开提供服务前，至少核验 HTTPS、管理员初始化、来源绑定、API 连接、一次真实检测、一次完整备份及配套恢复。自动化测试可运行 `npm test`，构建检查使用 `npm run build`。新服务器、证书和网络配置需要在实际目标环境验收。
