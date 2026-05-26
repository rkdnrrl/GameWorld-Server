#!/usr/bin/env node

/**
 * Core smoke test for auth/character/world critical paths.
 *
 * Usage:
 *   node scripts/smoke-core.mjs
 *
 * Optional env:
 *   API_BASE=https://airliveplay.com/api
 *   SMOKE_EMAIL=...
 *   SMOKE_PASSWORD=...
 */

const API_BASE = (process.env.API_BASE || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';

function logStep(name, ok, detail = '') {
  const mark = ok ? 'OK ' : 'ERR';
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function jfetch(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { res, data };
}

async function main() {
  let failed = false;

  // 1) health
  {
    const { res, data } = await jfetch('/health');
    const ok = res.ok && data?.status === 'ok';
    logStep('GET /health', ok, `status=${res.status}`);
    if (!ok) failed = true;
  }

  if (!EMAIL || !PASSWORD) {
    logStep('Auth flow', true, 'skipped (set SMOKE_EMAIL / SMOKE_PASSWORD to enable)');
    process.exit(failed ? 1 : 0);
  }

  // 2) login
  let accessToken = '';
  {
    const { res, data } = await jfetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    accessToken = data?.session?.access_token || '';
    const ok = res.ok && !!accessToken;
    logStep('POST /auth/login', ok, `status=${res.status}`);
    if (!ok) {
      failed = true;
      console.log('  response:', JSON.stringify(data));
      process.exit(1);
    }
  }

  // 3) exchange
  let platformToken = '';
  {
    const { res, data } = await jfetch('/auth/exchange', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    platformToken = data?.token || '';
    const ok = res.ok && !!platformToken;
    logStep('POST /auth/exchange', ok, `status=${res.status}`);
    if (!ok) {
      failed = true;
      console.log('  response:', JSON.stringify(data));
      process.exit(1);
    }
  }

  // 4) me
  {
    const { res, data } = await jfetch('/me', {
      headers: { Authorization: `Bearer ${platformToken}` },
    });
    const ok = res.ok && !!data?.id;
    logStep('GET /me', ok, `status=${res.status}`);
    if (!ok) {
      failed = true;
      console.log('  response:', JSON.stringify(data));
    }
  }

  // 5) character list
  {
    const { res, data } = await jfetch('/characters', {
      headers: { Authorization: `Bearer ${platformToken}` },
    });
    const ok = res.ok && Array.isArray(data?.characters);
    logStep('GET /characters', ok, `status=${res.status}`);
    if (!ok) {
      failed = true;
      console.log('  response:', JSON.stringify(data));
    }
  }

  // 6) public worlds
  {
    const { res, data } = await jfetch('/worlds/public');
    const ok = res.ok && Array.isArray(data?.worlds);
    logStep('GET /worlds/public', ok, `status=${res.status}`);
    if (!ok) {
      failed = true;
      console.log('  response:', JSON.stringify(data));
    }
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('ERR smoke-core crashed:', err?.message || err);
  process.exit(1);
});

