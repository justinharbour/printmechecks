#!/usr/bin/env node
// Simple smoke test for backend endpoints. If DB is down, will skip DB-dependent tests gracefully.

const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';

async function getJson(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, json: JSON.parse(text) }; } catch { return { ok: res.ok, status: res.status, text }; }
}

(async () => {
  console.log('Smoke test base:', BASE);
  const health = await getJson('/health');
  console.log('Health:', health);
  if (!health.ok) {
    console.error('Health endpoint failed. Exiting.');
    process.exit(1);
  }
  if (!health.json || health.json.db === false) {
    console.warn('DB unreachable; skipping document/send tests. Start Postgres (docker) and rerun.');
    process.exit(0);
  }

  // Attempt to upload a dummy PDF (requires existing test.pdf)
  const fs = await import('fs');
  const pdfPath = './data/test.pdf';
  if (!fs.existsSync(pdfPath)) {
    console.error('Missing test PDF at', pdfPath);
    process.exit(1);
  }

  // Build multipart form manually
  const boundary = '----pmcsmokeboundary' + Date.now();
  const pdfBuf = fs.readFileSync(pdfPath);
  const parts = [];
  parts.push(Buffer.from(`--${boundary}\r\n` + 'Content-Disposition: form-data; name="isCheck"\r\n\r\ntrue\r\n'));
  parts.push(Buffer.from(`--${boundary}\r\n` + 'Content-Disposition: form-data; name="file"; filename="test.pdf"\r\n' + 'Content-Type: application/pdf\r\n\r\n'));
  parts.push(pdfBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const uploadRes = await fetch(BASE + '/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body
  });
  const uploadTxt = await uploadRes.text();
  let uploadJson; try { uploadJson = JSON.parse(uploadTxt); } catch {}
  console.log('Upload response:', uploadRes.status, uploadJson || uploadTxt);
  if (!uploadRes.ok) {
    console.error('Upload failed');
    process.exit(1);
  }
  const docId = uploadJson.id;

  // Create POSTGRID send (simulated if secrets absent)
  const sendRes = await getJson('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'POSTGRID', checkDocumentId: docId, recipient: { name: 'Alice', address: { line1: '1 St' } } })
  });
  console.log('POSTGRID send:', sendRes);
  if (!sendRes.ok) process.exit(1);

  // Refresh status
  const refreshRes = await getJson(`/api/send/${sendRes.json.id}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  console.log('Refresh:', refreshRes);

  // Create EMAIL send (simulated if ACS not configured)
  const emailRes = await getJson('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'EMAIL', checkDocumentId: docId, recipient: { email: 'test@example.com' }, emailOptions: { subject: 'Test Email', message: 'Hello world' } })
  });
  console.log('EMAIL send:', emailRes);

  // List jobs
  const jobsRes = await getJson('/api/send');
  console.log('Jobs list count:', jobsRes.json && jobsRes.json.length);

  console.log('Smoke test completed successfully.');
  process.exit(0);
})();

