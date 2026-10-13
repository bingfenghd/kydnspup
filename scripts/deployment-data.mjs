import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, chownSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function entries(directory) {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('数据目录必须为真实目录');
  return readdirSync(directory).sort().map(name => {
    if (!lstatSync(join(directory, name)).isFile() || lstatSync(join(directory, name)).isSymbolicLink()) throw new Error('数据目录包含非普通文件，停止备份或恢复');
    return name;
  });
}
function digest(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
function checkDatabase(directory) {
  if (readFileSync(join(directory, '.key')).length !== 32) throw new Error('备份加密密钥长度不正确');
  const db = new DatabaseSync(join(directory, 'site.sqlite'), { readOnly: true });
  try { if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('备份数据库完整性检查失败'); }
  finally { db.close(); }
}
export function verifyBackup(backup) {
  const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'));
  const data = join(backup, 'data'), names = entries(data);
  if (manifest.format !== 'kydnspup-backup-v1' || !manifest.files || !Object.hasOwn(manifest.files, '.key') || !Object.hasOwn(manifest.files, 'site.sqlite')) throw new Error('备份格式不正确');
  // SQLite may recreate its transient shared-memory file during a read-only check.
  const stable = names.filter(name => name !== 'site.sqlite-shm');
  if (JSON.stringify(stable) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error('备份文件清单不匹配');
  for (const name of stable) if (digest(join(data, name)) !== manifest.files[name]) throw new Error('备份校验失败，请勿混用数据库与密钥');
  checkDatabase(data);
}
export function snapshot(source, backup) {
  if (existsSync(backup)) throw new Error('备份目录已存在，请使用新名称');
  const names = entries(source);
  mkdirSync(join(backup, 'data'), { recursive: true, mode: 0o700 });
  const data = join(backup, 'data');
  for (const name of names) { copyFileSync(join(source, name), join(data, name)); chmodSync(join(data, name), 0o600); }
  checkDatabase(data);
  const files = Object.fromEntries(entries(data).filter(name => name !== 'site.sqlite-shm').map(name => [name, digest(join(data, name))]));
  writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ format: 'kydnspup-backup-v1', created: new Date().toISOString(), files }, null, 2), { mode: 0o600 });
  verifyBackup(backup);
}
export function restore(backup, target) {
  verifyBackup(backup);
  const data = join(backup, 'data');
  if (resolve(data) === resolve(target)) throw new Error('不能恢复到备份自身');
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const oldFiles = entries(target), names = entries(data).filter(name => name !== 'site.sqlite-shm');
  for (const name of oldFiles) rmSync(join(target, name));
  for (const name of names) { copyFileSync(join(data, name), join(target, name)); chmodSync(join(target, name), 0o600); }
  chmodSync(target, 0o700);
  if (process.getuid?.() === 0) {
    chownSync(target, 1000, 1000);
    for (const name of names) chownSync(join(target, name), 1000, 1000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, source, destination, image] = process.argv.slice(2);
    if (command === 'backup') { snapshot(source, destination); if (image) writeFileSync(join(destination, 'image-id'), image + '\n', { mode: 0o600 }); }
    else if (command === 'verify') verifyBackup(source);
    else if (command === 'restore') restore(source, destination);
    else if (command === 'image') { const id = readFileSync(join(source, 'image-id'), 'utf8').trim(); if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('备份镜像 ID 不正确'); console.log(id); }
    else throw new Error('只支持 backup / verify / restore / image');
    if (command !== 'image') console.log(`${command}: ok`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
