import { spawn } from 'node:child_process';

const port = process.env.BDK_DELIVERY_TEST_PORT || '3317';
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: port, DATABASE_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', d => { output += d.toString(); });
child.stderr.on('data', d => { output += d.toString(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitForHealth() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Server did not become healthy. Output: ${output}`);
}

async function request(path, options = {}) {
  const r = await fetch(`${base}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${r.status}: ${text}`);
  return body;
}

try {
  await waitForHealth();
  const health = await request('/health');
  if (!health.ok) throw new Error('Health check returned ok=false');

  const store = await request('/api/store');
  if (!store.store || !Array.isArray(store.products)) throw new Error('Store contract invalid');

  const preview = await request('/api/orders/preview', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: store.products[0].id, qty: 2 }] })
  });
  if (!(preview.total > 0) || preview.items.length !== 1) throw new Error('Order preview contract invalid');

  const parsed = await request('/api/whatsapp/parse-order', {
    method: 'POST',
    body: JSON.stringify({ text: `2 ${store.products[0].name} pix` })
  });
  if (!Array.isArray(parsed.items) || !parsed.items.length) throw new Error('WhatsApp parser failed to identify an item');

  console.log(JSON.stringify({
    status: 'PASS',
    checks: ['health', 'store-contract', 'order-preview', 'whatsapp-parse-order']
  }, null, 2));
} finally {
  child.kill('SIGTERM');
}
