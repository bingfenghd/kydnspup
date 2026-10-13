import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createStore } from '../server/store.mjs';
import { restore, snapshot, verifyBackup } from '../scripts/deployment-data.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

function directory(t) {
  const base = resolve(import.meta.dirname, '../.tmp'); mkdirSync(base, { recursive: true });
  const path = mkdtempSync(join(base, 'deployment-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
test('deployment init keeps its generated token private and refuses to overwrite configuration', t => {
  const root = directory(t); mkdirSync(join(root, 'scripts'));
  copyFileSync(resolve(import.meta.dirname, '../scripts/deployment.sh'), join(root, 'scripts/deployment.sh'));
  copyFileSync(resolve(import.meta.dirname, '../.env.example'), join(root, '.env.example'));
  const first = spawnSync('sh', ['scripts/deployment.sh', 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0); const value = readFileSync(join(root, '.env'), 'utf8'), token = value.match(/^KY_SETUP_TOKEN=([a-f0-9]{64})$/m)?.[1];
  assert.ok(token); assert.ok(!(first.stdout + first.stderr).includes(token)); assert.equal(statSync(join(root, '.env')).mode & 0o777, 0o600);
  const again = spawnSync('sh', ['scripts/deployment.sh', 'init'], { cwd: root, encoding: 'utf8' }); assert.equal(again.status, 1); assert.equal(readFileSync(join(root, '.env'), 'utf8'), value);
});
test('backup reports completion and restores the prior container state on success or failure', async t => {
  for (const [running, backupStatus] of [['true', 0], ['false', 0], ['true', 7]]) {
    await t.test(`running=${running}, backup exit=${backupStatus}`, t => {
      const root = directory(t); mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'bin'));
      copyFileSync(resolve(import.meta.dirname, '../scripts/deployment.sh'), join(root, 'scripts/deployment.sh'));
      writeFileSync(join(root, 'state'), running + '\n');
      writeFileSync(join(root, 'bin/docker'), `#!/bin/sh
set -eu
case "$*" in
  'compose ps -a -q app') echo fixture ;;
  'inspect --format {{.State.Running}} fixture') cat state ;;
  'inspect --format {{.Image}} fixture') echo sha256:fixture ;;
  'compose stop app') echo false > state ;;
  'compose run '*) exit "$FIXTURE_BACKUP_STATUS" ;;
  'compose up -d --no-build --no-recreate --wait --wait-timeout 90 app') echo true > state ;;
  *) echo 'Unsupported Docker command' >&2; exit 2 ;;
esac
`, { mode: 0o700 });
      const result = spawnSync('sh', ['scripts/deployment.sh', 'backup', 'fixture'], {
        cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, FIXTURE_BACKUP_STATUS: String(backupStatus) },
      });
      assert.equal(result.status, backupStatus, result.stderr);
      assert.equal(readFileSync(join(root, 'state'), 'utf8').trim(), running);
      if (!backupStatus) assert.match(result.stdout, /备份已校验：backups\/fixture；/);
    });
  }
});
test('stopped backup restores database, encrypted credentials and restrictive permissions', t => {
  const root = directory(t), source = join(root, 'data'), backup = join(root, 'backup'), target = join(root, 'restored');
  const store = createStore(source); store.set('settings', { name: 'before upgrade' }); store.saveCredentials({ apiKey: 'fixture', apiSecret: 'fixture-only' }); store.close();
  snapshot(source, backup); verifyBackup(backup); restore(backup, target);
  const restored = createStore(target); t.after(() => restored.close());
  assert.equal(restored.settings().name, 'before upgrade'); assert.equal(restored.credentials().apiSecret, 'fixture-only');
  assert.equal(statSync(target).mode & 0o777, 0o700); assert.equal(statSync(join(target, '.key')).mode & 0o777, 0o600);
  assert.throws(() => snapshot(source, backup), /已存在/);
});
test('tampered or mixed key backup refuses restore before altering current data', t => {
  const root = directory(t), source = join(root, 'data'), backup = join(root, 'backup'), target = join(root, 'current');
  createStore(source).close(); snapshot(source, backup); mkdirSync(target); writeFileSync(join(target, 'untouched'), 'keep');
  writeFileSync(join(backup, 'data', '.key'), Buffer.alloc(32, 9));
  assert.throws(() => restore(backup, target), /备份校验失败/); assert.equal(readFileSync(join(target, 'untouched'), 'utf8'), 'keep');
});
test('symlinks and extra files cannot smuggle content into a backup', t => {
  const root = directory(t), source = join(root, 'data'), backup = join(root, 'backup'); createStore(source).close();
  symlinkSync('../data/.key', join(source, 'link')); assert.throws(() => snapshot(source, backup), /非普通文件/);
  rmSync(join(source, 'link')); snapshot(source, backup);
  writeFileSync(join(backup, 'data', 'unexpected'), 'x'); assert.throws(() => verifyBackup(backup), /清单不匹配/);
});
test('fresh process setup, stop-backup, restart and restore retain admin and encrypted credentials', async t => {
  const root = directory(t), data = join(root, 'data'), backup = join(root, 'baseline');
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const origin = `http://127.0.0.1:${port}`, setupToken = randomBytes(32).toString('hex'); let child, cookie = '';
  async function stop() { if (child && child.exitCode === null && child.signalCode === null) { const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed; } }
  t.after(stop);
  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + path, { method, headers: { Origin: origin, 'X-KY-Request': '1', 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    return { status: response.status, data: await response.json() };
  }
  async function start() {
    child = spawn(process.execPath, [resolve(import.meta.dirname, '../server/index.mjs')], { env: { ...process.env, KY_HOST: '127.0.0.1', KY_PORT: String(port), KY_PUBLIC_ORIGIN: origin, KY_DATA_DIR: data, KY_SETUP_TOKEN: setupToken }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await request('/api/health')).data.ok) return; } catch {} await new Promise(r => setTimeout(r, 25)); }
    throw new Error('隔离测试服务未就绪');
  }
  await start(); assert.equal((await request('/api/admin/session')).data.initialized, false);
  assert.equal((await request('/api/admin/setup', { password: 'deployment-fixture-password' })).status, 403);
  assert.equal((await request('/api/admin/setup', { password: 'deployment-fixture-password', setupToken })).status, 200);
  assert.equal((await request('/api/admin/credentials', { apiKey: 'fixture', apiSecret: 'fixture-only', sourceMode: 'ip', sourceDomain: '' }, 'PUT')).status, 200);
  const settings = (await request('/api/admin/settings')).data.settings; settings.name = 'baseline site';
  assert.equal((await request('/api/admin/settings', settings, 'PUT')).status, 200);
  await stop(); snapshot(data, backup); await start();
  assert.equal((await request('/api/admin/settings')).data.settings.name, 'baseline site');
  settings.name = 'changed after upgrade'; await request('/api/admin/settings', settings, 'PUT');
  await stop(); restore(backup, data); cookie = ''; await start();
  assert.equal((await request('/api/admin/login', { password: 'deployment-fixture-password' })).status, 200);
  const restored = (await request('/api/admin/settings')).data;
  assert.equal(restored.settings.name, 'baseline site'); assert.equal(restored.api.configured, true);
  await stop();
});
