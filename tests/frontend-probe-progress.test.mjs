import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { APIError, waitForProbe } from '../src/api.ts';

const id = '63d76f00-7256-4bc9-a6c3-c5c0f88f08ae';
const result = { requestId: 'req_1234567890abcdef12345678', type: 'ping', target: 'example.com', status: 'completed', results: [] };

function polling(t, jobs) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, method: options.method || 'GET' });
    assert.ok(jobs.length, 'polling must stop at the final result');
    return new Response(JSON.stringify(jobs.shift()), { status: 200 });
  });
  t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
  return calls;
}

test('polling reports real node progress before a final result exists', async t => {
  const jobs = [
    { id, status: 'running', completedNodes: 0, totalNodes: 3, resultAvailable: false },
    { id, status: 'running', completedNodes: 1, totalNodes: 3, resultAvailable: false },
    { id, status: 'running', completedNodes: 2, totalNodes: 3, resultAvailable: false },
    { id, status: 'completed', completedNodes: 3, totalNodes: 3, resultAvailable: true, result }
  ];
  const calls = polling(t, [...jobs]), updates = [];
  assert.deepEqual(await waitForProbe(id, () => true, job => updates.push(job)), result);
  assert.deepEqual(updates, jobs);
  assert.deepEqual(calls, jobs.map(() => ({ path: `/api/probes/${id}`, method: 'GET' })));
});

test('refresh recovery uses only the saved request ID and never creates a detection', async t => {
  const saved = JSON.parse(JSON.stringify({ id, path: '/ping/' }));
  const calls = polling(t, [{ id, status: 'completed', completedNodes: 3, totalNodes: 3, resultAvailable: true, result }]);
  assert.deepEqual(await waitForProbe(saved.id, () => true), result);
  assert.deepEqual(calls, [{ path: `/api/probes/${id}`, method: 'GET' }]);
});

test('terminal errors preserve received progress without resubmitting', async t => {
  const job = { id, status: 'unknown', completedNodes: 1, totalNodes: 3, resultAvailable: false, error: { code: 'upstream_pending', message: '原任务尚未完成' } };
  const calls = polling(t, [job]), updates = [];
  await assert.rejects(waitForProbe(id, () => true, value => updates.push(value)), error => error instanceof APIError && error.code === 'upstream_pending');
  assert.deepEqual(updates, [job]);
  assert.deepEqual(calls, [{ path: `/api/probes/${id}`, method: 'GET' }]);
});

test('an inactive run neither publishes late progress nor replaces results', async t => {
  let active = true;
  t.mock.method(globalThis, 'fetch', async () => {
    active = false;
    return new Response(JSON.stringify({ id, status: 'completed', completedNodes: 3, totalNodes: 3, resultAvailable: true, result }));
  });
  const updates = [];
  assert.equal(await waitForProbe(id, () => active, job => updates.push(job)), undefined);
  assert.deepEqual(updates, []);
});

test('legacy jobs without node counts still deliver the original result', async t => {
  const jobs = [{ id, status: 'running', resultAvailable: false }, { id, status: 'completed', resultAvailable: true, result }];
  polling(t, [...jobs]);
  const updates = [];
  assert.deepEqual(await waitForProbe(id, () => true, job => updates.push(job)), result);
  assert.deepEqual(updates, jobs);
});

test('a failed query does not silently create or retry a paid detection', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push({ path, method: options.method || 'GET' }); throw new TypeError('connection interrupted'); });
  await assert.rejects(waitForProbe(id, () => true), /connection interrupted/);
  assert.deepEqual(calls, [{ path: `/api/probes/${id}`, method: 'GET' }]);
});

test('the existing progress bar renders received counts while result rows are still unavailable', async t => {
  await mkdir(resolve('.tmp'), { recursive: true });
  const directory = await mkdtemp(resolve('.tmp/frontend-progress-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compiled = await build({ entryPoints: ['src/Results.tsx'], bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, plugins: [{ name: 'map-outside-progress-test', setup(builder) { builder.onLoad({ filter: /[/\\]ChinaProbeMap\.tsx$/ }, () => ({ contents: 'export default function ChinaProbeMap() { return null; }', loader: 'js' })); } }] });
  const file = resolve(directory, 'Results.mjs');
  await writeFile(file, compiled.outputFiles[0].contents);
  const { default: Results } = await import(pathToFileURL(file).href);
  const props = { tool: 'ping', busy: true, elapsed: 2, t: key => key, logo: '/logo.png', onTool: () => {}, expected: 7, nodes: [] };
  const html = renderToStaticMarkup(createElement(Results, { ...props, progress: { completedNodes: 1, totalNodes: 3 } }));
  assert.match(html, /aria-valuemax="3" aria-valuenow="1"/);
  assert.match(html, /style="width:33%"/);
  assert.match(html, /<b>1<\/b> nodeProgress/);
  assert.doesNotMatch(html, /result-one/);
  const complete = renderToStaticMarkup(createElement(Results, { ...props, busy: false, progress: { completedNodes: 3, totalNodes: 3 } }));
  assert.match(complete, /aria-valuemax="3" aria-valuenow="3"/);
  assert.match(complete, /style="width:100%"/);
  const legacy = renderToStaticMarkup(createElement(Results, { ...props, result: { ...result, results: [{ node_id: 'one', status: 'ok' }] } }));
  assert.match(legacy, /aria-valuemax="7" aria-valuenow="1"/);
});
