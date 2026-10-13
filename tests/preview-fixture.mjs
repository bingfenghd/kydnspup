// Isolated browser QA only. Never imported by the application entry point.
import { harness } from './helpers.mjs';
const h = await harness({ port: 4189 });
h.control.delay = Math.min(10000, Math.max(0, Number(process.env.KY_QA_DELAY_MS) || 0));
h.app.store.saveCredentials({ apiKey: 'fake-key', apiSecret: 'fake-secret', sourceMode: 'ip', sourceDomain: '' });
const settings = h.app.store.settings(); h.app.store.set('settings', { ...settings, requestsPerMinute: 60 });
console.log('Browser QA fixture only: ' + h.origin);
process.on('SIGTERM', async () => { await h.close(); process.exit(0); });
process.on('SIGINT', async () => { await h.close(); process.exit(0); });
