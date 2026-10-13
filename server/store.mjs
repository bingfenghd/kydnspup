import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from 'node:crypto';
import { DEFAULT_SETTINGS } from './config.mjs';

export function createStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = join(directory, '.key');
  if (!existsSync(keyPath)) {
    if (existsSync(join(directory, 'site.sqlite'))) throw new Error('数据库存在但加密密钥缺失，请恢复原 var/.key');
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  const key = readFileSync(keyPath);
  const db = new DatabaseSync(join(directory, 'site.sqlite'));
  chmodSync(join(directory, 'site.sqlite'), 0o600);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, visitor TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL, day TEXT NOT NULL, tool TEXT NOT NULL, target TEXT NOT NULL, nodes INTEGER NOT NULL, status TEXT NOT NULL, request_id TEXT, message TEXT);
    CREATE INDEX IF NOT EXISTS calls_day ON calls(day);
    CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL);
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(calls)').all().map(row => row.name));
  for (const name of ['error_code', 'summary', 'upstream_job']) if (!columns.has(name)) db.exec(`ALTER TABLE calls ADD COLUMN ${name} TEXT`);
  db.prepare("UPDATE calls SET status='unknown', message='服务重启，执行结果未知，请勿自动重试' WHERE status='running' AND upstream_job IS NULL").run();
  function get(id, fallback = null) { const row = db.prepare('SELECT value FROM config WHERE id=?').get(id); return row ? JSON.parse(row.value) : fallback; }
  function set(id, value) { db.prepare('INSERT INTO config(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, JSON.stringify(value)); }
  function encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  function credentials() {
    const saved = get('credentials'); if (!saved) return null;
    const buf = Buffer.from(saved, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString());
  }
  return { db, key, get, set, credentials, saveCredentials: value => set('credentials', value ? encrypt(value) : null), settings: () => get('settings', structuredClone(DEFAULT_SETTINGS)), close: () => db.close() };
}
export function passwordHash(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function verifyPassword(password, stored) { if (!stored || typeof password !== 'string') return false; const [salt, expected] = stored.split(':'); const actual = scryptSync(password, salt, 64); return actual.length === expected.length / 2 && timingSafeEqual(actual, Buffer.from(expected, 'hex')); }
export function dayKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
