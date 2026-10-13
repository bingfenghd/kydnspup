import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const exec = promisify(execFile), root = resolve(import.meta.dirname, '..');
const [image, ...options] = process.argv.slice(2);
if (!image || !/^kydnspup:deployment-qa-[a-zA-Z0-9_-]+$/.test(image) || options.some(option => !['--failed-upgrade', '--host-network'].includes(option))) {
  throw new Error('用法：node scripts/deployment-smoke.mjs kydnspup:deployment-qa-* [--failed-upgrade] [--host-network]');
}
const hostNetwork = options.includes('--host-network');
const output = join(root, 'artifacts/deployment-closure');
mkdirSync(join(root, '.tmp'), { recursive: true }); mkdirSync(output, { recursive: true });
const directory = mkdtempSync(join(root, '.tmp/deployment-e2e-'));
const project = 'kydnspup-qa-' + randomBytes(5).toString('hex');
const upgraded = `kydnspup:${project}-upgrade`, broken = `kydnspup:${project}-broken`;
const reportFile = join(output, project + '.json'), ownerLabel = 'kydnspup.deployment-qa';
const env = { ...process.env, COMPOSE_PROJECT_NAME: project };
for (const key of Object.keys(env)) if (key.startsWith('KY_') || key === 'COMPOSE_FILE' || key === 'COMPOSE_PROFILES') delete env[key];
if (env.DOCKER_HOST) delete env.DOCKER_CONTEXT;
const password = 'deployment-fixture-password';
const fixtureDay = new Date().toISOString().slice(0, 10);
const credentials = { apiKey: 'deployment-fixture-key', apiSecret: 'deployment-fixture-secret', sourceMode: 'ip', sourceDomain: '' };
const privateValues = [password, credentials.apiKey, credentials.apiSecret];
async function command(program, args, cwd = directory) { return (await exec(program, args, { cwd, env, timeout: 240000, maxBuffer: 1024 * 1024 })).stdout.trim(); }
const compose = args => command('docker', ['compose', ...args]);
const script = args => command('sh', ['scripts/deployment.sh', ...args]);
const runtimeNode = code => compose(['exec', '-T', 'app', 'node', '--input-type=module', '-e', code]);
const privateNode = code => command('docker', ['run', '--rm', '--network', 'none', '--user', '0:0', '--label', `${ownerLabel}=${project}`, '--entrypoint', 'node', '-v', `${directory}:/qa`, image, '--input-type=module', '-e', code]);
const digest = value => createHash('sha256').update(value).digest('hex');
function safeError(error) {
  let message = String(error.message);
  for (const value of privateValues) if (value) message = message.replaceAll(value, '[REDACTED]');
  return message.replace(/KY_SETUP_TOKEN=[^\s]+/g, 'KY_SETUP_TOKEN=[REDACTED]');
}
function setImage(value) {
  const path = join(directory, '.env');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^KY_IMAGE=.*$/m, `KY_IMAGE=${value}`), { mode: 0o600 });
}
async function mustFail(action, expected) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  assert.ok(failure, '预期操作被拒绝');
  if (expected) assert.match(String(failure.message), expected);
}
async function state() {
  const id = await compose(['ps', '-a', '-q', 'app']); assert.match(id, /^[a-f0-9]+$/);
  return JSON.parse(await command('docker', ['inspect', '--format', '{"id":{{json .Id}},"image":{{json .Image}},"networkMode":{{json .HostConfig.NetworkMode}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}}}', id]));
}
async function persistentFingerprint() {
  return runtimeNode(`import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
    const db=new DatabaseSync('/app/var/site.sqlite',{readOnly:true});const tables={};
    for(const [name,order] of [['config','id'],['sessions','token'],['calls','id'],['daily','day']]) tables[name]=db.prepare('SELECT * FROM '+name+' ORDER BY '+order).all();
    db.close();console.log(createHash('sha256').update(JSON.stringify(tables)).update(readFileSync('/app/var/.key')).digest('hex'));`);
}
let cookie = '', origin;
async function request(path, value, method = value === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-KY-Request': '1', Cookie: cookie }, ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(10000) });
  const nextCookie = response.headers.get('set-cookie')?.split(';')[0];
  if (nextCookie) { cookie = nextCookie; privateValues.push(cookie, cookie.slice(cookie.indexOf('=') + 1)); }
  return { status: response.status, data: await response.json() };
}
async function login() {
  cookie = '';
  assert.equal((await request('/api/admin/login', { password })).status, 200);
}
async function fixtureMatches(stage = 'baseline') {
  // The runtime decrypts its own stored credentials; only a boolean leaves the container.
  const result = await runtimeNode(`import {createStore} from './server/store.mjs';
    const s=createStore(process.env.KY_DATA_DIR),c=s.credentials(),f=s.get('deploymentFixture');
    const call=s.db.prepare('SELECT status,target,nodes FROM calls WHERE id=?').get('deployment-fixture-call');
    const daily=s.db.prepare('SELECT attempts FROM daily WHERE day=?').get(${JSON.stringify(fixtureDay)});
    const ok=c?.apiKey===${JSON.stringify(credentials.apiKey)}&&c?.apiSecret===${JSON.stringify(credentials.apiSecret)}&&c?.sourceMode==='ip'
      &&f?.project===${JSON.stringify(project)}&&f?.stage===${JSON.stringify(stage)}&&call?.status==='completed'&&call?.target==='fixture.invalid'&&call?.nodes===2&&daily?.attempts===7;
    s.close();console.log(ok);if(!ok)process.exitCode=1;`);
  assert.equal(result, 'true');
}
const report = { mode: hostNetwork ? 'Linux host network; HTTPS reverse proxy not tested' : 'isolated bridge override; not host-network or HTTPS acceptance', project, image, temporaryDirectory: directory, reportFile, failedUpgradeRequested: options.includes('--failed-upgrade'), checks: {}, cleanup: {} };
let success = false;
try {
  const [os, architecture, version, operatingSystem] = (await command('docker', ['info', '--format', '{{.OSType}}|{{.Architecture}}|{{.ServerVersion}}|{{.OperatingSystem}}'])).split('|');
  report.daemon = { os, architecture, version, operatingSystem };
  if (hostNetwork) assert.equal(os, 'linux');
  report.baseImage = await command('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
  const portServer = createServer(); await new Promise(r => portServer.listen(0, '127.0.0.1', r));
  const port = portServer.address().port; await new Promise(r => portServer.close(r)); origin = `http://127.0.0.1:${port}`;
  mkdirSync(join(directory, 'scripts'));
  for (const file of ['compose.yaml', '.env.example', 'scripts/deployment.sh']) copyFileSync(join(root, file), join(directory, file));
  writeFileSync(join(directory, '.dockerignore'), '*\n!Dockerfile.upgrade\n!Dockerfile.broken\n');
  const initialized = await script(['init']);
  const initialEnv = readFileSync(join(directory, '.env'), 'utf8'), token = initialEnv.match(/^KY_SETUP_TOKEN=([a-f0-9]{64})$/m)?.[1];
  assert.ok(token); privateValues.push(token); assert.ok(!initialized.includes(token));
  await mustFail(() => script(['init']), /\.env 已存在/); assert.equal(readFileSync(join(directory, '.env'), 'utf8'), initialEnv);
  writeFileSync(join(directory, '.env'), initialEnv.replace(/^KY_IMAGE=.*$/m, `KY_IMAGE=${image}`).replace(/^KY_PORT=.*$/m, `KY_PORT=${hostNetwork ? port : 4178}`).replace(/^KY_PUBLIC_ORIGIN=.*$/m, `KY_PUBLIC_ORIGIN=${origin}`), { mode: 0o600 });
  if (!hostNetwork) writeFileSync(join(directory, 'compose.override.yaml'), `services:\n  app:\n    network_mode: bridge\n    environment:\n      KY_HOST: 0.0.0.0\n      KY_TRUST_LOCAL_PROXY: "0"\n    ports:\n      - "127.0.0.1:${port}:4178"\n`);
  await compose(['config', '--quiet']); await script(['prepare']); await script(['prepare']);
  await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90']);
  const original = await state(); report.originalImage = original.image; report.networkMode = original.networkMode;
  assert.equal(report.originalImage, report.baseImage); assert.equal(report.networkMode, hostNetwork ? 'host' : 'bridge');
  assert.equal(await runtimeNode(`const ok=process.env.KY_HOST===${JSON.stringify(hostNetwork ? '127.0.0.1' : '0.0.0.0')}&&process.env.KY_TRUST_LOCAL_PROXY===${JSON.stringify(hostNetwork ? '1' : '0')}&&process.env.KY_PORT===${JSON.stringify(String(hostNetwork ? port : 4178))};console.log(ok);if(!ok)process.exitCode=1;`), 'true');
  report.checks.networkAndProxyConfiguration = true;
  assert.equal((await request('/api/health')).data.ok, true); assert.equal((await request('/api/admin/session')).data.initialized, false);
  assert.equal((await request('/api/admin/setup', { password })).status, 403);
  assert.equal((await request('/api/admin/setup', { password, setupToken: token })).status, 200);
  report.checks.freshInstallAndPrivateSetupToken = true;
  assert.equal((await request('/api/admin/credentials', credentials, 'PUT')).status, 200);
  const settings = (await request('/api/admin/settings')).data.settings; settings.name = 'deployment-before-upgrade';
  assert.equal((await request('/api/admin/settings', settings, 'PUT')).status, 200);
  await runtimeNode(`import {createStore} from './server/store.mjs';const s=createStore(process.env.KY_DATA_DIR);
    s.set('deploymentFixture',{project:${JSON.stringify(project)},stage:'baseline'});
    s.db.prepare('INSERT INTO calls(id,visitor,payload,created,day,tool,target,nodes,status,request_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run('deployment-fixture-call','fixture','{}',new Date().toISOString(),${JSON.stringify(fixtureDay)},'ping','fixture.invalid',2,'completed','deployment-fixture-request');
    s.db.prepare('INSERT INTO daily(day,attempts) VALUES(?,?)').run(${JSON.stringify(fixtureDay)},7);s.close();`);
  await fixtureMatches(); report.checks.runtimeCredentialDecryption = true;
  const beforeReinit = await persistentFingerprint(), envBeforeReinit = readFileSync(join(directory, '.env'));
  await mustFail(() => script(['init']), /\.env 已存在/);
  assert.equal((await request('/api/admin/setup', { password: 'replacement-fixture-password', setupToken: token })).status, 409);
  assert.equal(await persistentFingerprint(), beforeReinit); assert.equal(digest(readFileSync(join(directory, '.env'))), digest(envBeforeReinit));
  await login(); report.checks.repeatInitializationPreservesData = true;

  const runningBeforeBackup = await state(), dataBeforeBackup = await persistentFingerprint();
  await script(['backup', 'baseline']);
  const runningAfterBackup = await state(); assert.equal(runningAfterBackup.id, runningBeforeBackup.id); assert.equal(runningAfterBackup.running, true);
  assert.equal(await persistentFingerprint(), dataBeforeBackup);
  report.checks.backupPreservesRunningStateAndData = true;
  await compose(['stop', 'app']); const stoppedBeforeBackup = await state(); assert.equal(stoppedBeforeBackup.running, false);
  await script(['backup', 'stopped-baseline']); assert.deepEqual(await state(), stoppedBeforeBackup);
  await compose(['up', '-d', '--no-build', '--no-recreate', '--wait', '--wait-timeout', '90', 'app']); await fixtureMatches();
  report.checks.backupPreservesStoppedState = true;

  await privateNode("import * as f from 'node:fs';const src='/qa/backups/baseline',dst='/qa/backups/tampered';f.mkdirSync(dst+'/data',{recursive:true,mode:0o700});for(const name of ['manifest.json','image-id'])f.copyFileSync(src+'/'+name,dst+'/'+name);for(const name of f.readdirSync(src+'/data'))f.copyFileSync(src+'/data/'+name,dst+'/data/'+name);f.appendFileSync(dst+'/data/site.sqlite','damaged-fixture');");
  const beforeReject = await state(), dataBeforeReject = await persistentFingerprint(), envBeforeReject = digest(readFileSync(join(directory, '.env')));
  await mustFail(() => script(['restore', 'tampered']), /备份校验失败/);
  assert.deepEqual(await state(), beforeReject); assert.equal(await persistentFingerprint(), dataBeforeReject); assert.equal(digest(readFileSync(join(directory, '.env'))), envBeforeReject);
  report.checks.corruptBackupRejectedWithoutStoppingOrChangingData = true;

  writeFileSync(join(directory, 'Dockerfile.upgrade'), `FROM ${image}\nLABEL ${ownerLabel}="${project}"\nLABEL kydnspup.test-upgrade="${project}"\n`);
  await command('docker', ['build', '--network', 'none', '-f', 'Dockerfile.upgrade', '-t', upgraded, '.']);
  setImage(upgraded); await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90']);
  report.upgradedImage = (await state()).image; assert.notEqual(report.upgradedImage, report.originalImage);
  await login(); assert.equal((await request('/api/admin/settings')).data.settings.name, 'deployment-before-upgrade'); await fixtureMatches();
  report.checks.imageUpgradePreservesLoginSettingsDataAndCredentials = true;
  settings.name = 'deployment-after-upgrade'; assert.equal((await request('/api/admin/settings', settings, 'PUT')).status, 200);
  await runtimeNode(`import {createStore} from './server/store.mjs';const s=createStore(process.env.KY_DATA_DIR);s.set('deploymentFixture',{project:${JSON.stringify(project)},stage:'after-upgrade'});s.close();`);
  await fixtureMatches('after-upgrade');
  await script(['restore', 'baseline']); report.restoredImage = (await state()).image; assert.equal(report.restoredImage, report.originalImage);
  await login(); assert.equal((await request('/api/admin/settings')).data.settings.name, 'deployment-before-upgrade'); await fixtureMatches();
  report.checks.rollbackRestoresImageLoginSettingsDataAndCredentials = true;

  if (options.includes('--failed-upgrade')) {
    writeFileSync(join(directory, 'Dockerfile.broken'), `FROM ${upgraded}\nCMD ["node","-e","process.exit(23)"]\n`);
    await command('docker', ['build', '--network', 'none', '-f', 'Dockerfile.broken', '-t', broken, '.']);
    const brokenID = await command('docker', ['image', 'inspect', '--format', '{{.Id}}', broken]);
    setImage(broken); await mustFail(() => compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '15']));
    const failed = await state(); assert.equal(failed.image, brokenID); assert.ok(failed.restartCount > 0 || !failed.running);
    report.failedImage = brokenID;
    await script(['restore', 'baseline']); assert.equal((await state()).image, report.originalImage);
    await login(); assert.equal((await request('/api/admin/settings')).data.settings.name, 'deployment-before-upgrade'); await fixtureMatches();
    report.checks.failedUpgradeRollback = true;
  }
  assert.equal(await runtimeNode("import * as f from 'node:fs';const ok=process.getuid()===1000&&!f.existsSync('/app/.env')&&!f.existsSync('/app/node_modules');console.log(ok);if(!ok)process.exitCode=1;"), 'true');
  report.checks.nonRootMinimalRuntime = true;
  success = true;
} catch (error) { report.error = safeError(error); }
finally {
  report.cleanup.errors = [];
  try { await compose(['down', '--timeout', '30', '--remove-orphans']); } catch (error) { report.cleanup.errors.push(safeError(error)); }
  try {
    for (const label of [`com.docker.compose.project=${project}`, `${ownerLabel}=${project}`]) {
      const ids = (await command('docker', ['ps', '-aq', '--filter', `label=${label}`])).split(/\s+/).filter(Boolean);
      if (ids.length) await command('docker', ['rm', '-f', ...ids]);
    }
    await privateNode("import * as f from 'node:fs';for(const p of ['var','backups'])f.rmSync('/qa/'+p,{recursive:true,force:true});");
    report.cleanup.containers = !(await command('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])) && !(await command('docker', ['ps', '-aq', '--filter', `label=${ownerLabel}=${project}`]));
    report.cleanup.temporaryData = report.cleanup.containers;
  } catch (error) { report.cleanup.errors.push(safeError(error)); }
  try {
    // Only images created by this run carry this random owner label; the input image stays available.
    const ids = (await command('docker', ['image', 'ls', '-aq', '--filter', `label=${ownerLabel}=${project}`])).split(/\s+/).filter(Boolean);
    for (const id of new Set(ids)) {
      const fullID = await command('docker', ['image', 'inspect', '--format', '{{.Id}}', id]);
      assert.notEqual(fullID, report.baseImage);
      await command('docker', ['image', 'rm', id]);
    }
    report.cleanup.derivedImages = !(await command('docker', ['image', 'ls', '-aq', '--filter', `label=${ownerLabel}=${project}`]));
    report.cleanup.baseImageRetained = (await command('docker', ['image', 'inspect', '--format', '{{.Id}}', image])) === report.baseImage;
  } catch (error) { report.cleanup.errors.push(safeError(error)); }
  if (report.cleanup.temporaryData) {
    try { rmSync(directory, { recursive: true, force: true }); } catch (error) { report.cleanup.temporaryData = false; report.cleanup.errors.push(safeError(error)); }
  }
  report.success = success && report.cleanup.containers === true && report.cleanup.temporaryData === true && report.cleanup.derivedImages === true && report.cleanup.baseImageRetained === true;
  report.recordedAt = new Date().toISOString();
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.success) process.exitCode = 1;
}
