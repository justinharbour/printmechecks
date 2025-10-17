// Lightweight API client for send job tracking (PostGrid) used by the frontend
// Uses a global window.PRINTME_API_BASE if present, otherwise defaults to http://localhost:3000
const API_BASE = (typeof window !== 'undefined' && window.PRINTME_API_BASE) || 'http://localhost:3000';

export async function listSendJobs() {
  const res = await fetch(`${API_BASE}/api/send`);
  if (!res.ok) throw new Error(`listSendJobs failed: ${res.status}`);
  return res.json();
}

export async function refreshJob(id) {
  const res = await fetch(`${API_BASE}/api/send/${encodeURIComponent(id)}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`refreshJob failed: ${res.status}`);
  return res.json();
}

export async function simulateWebhook(providerId, status = 'DELIVERED') {
  const res = await fetch(`${API_BASE}/api/webhook/postgrid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, status }),
  });
  if (!res.ok) throw new Error(`simulateWebhook failed: ${res.status}`);
  return res.json();
}
