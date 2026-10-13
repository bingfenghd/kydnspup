import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createApp } from './app.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.KY_HOST || '127.0.0.1', port = Number(process.env.KY_PORT || 4178);
const publicOrigin = process.env.KY_PUBLIC_ORIGIN || '';
if (host !== '127.0.0.1' && !publicOrigin) throw new Error('非本机监听必须设置 KY_PUBLIC_ORIGIN');
const app = createApp({ root, dataDir: resolve(root, process.env.KY_DATA_DIR || 'var'), localSetup: host === '127.0.0.1' && !publicOrigin, setupToken: process.env.KY_SETUP_TOKEN || '', publicOrigin, secureCookie: publicOrigin.startsWith('https:'), trustLocalProxy: process.env.KY_TRUST_LOCAL_PROXY === '1' });
let vite;
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true, hmr: { server: app.server } }, appType: 'spa' });
  app.setMiddleware(vite.middlewares);
}
app.server.listen(port, host, () => console.log(`kydnspup 0.1.0 · http://${host}:${port}\n站长管理：http://${host}:${port}/admin`));
async function shutdown() { await vite?.close(); await app.close(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
