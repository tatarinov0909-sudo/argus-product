'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../auth.js'), 'utf8');
const now = Math.floor(Date.now() / 1000);
function token(role, id, issued, expires) {
  return 'fixture.' + Buffer.from(JSON.stringify({ role, staffKeyId: id,
    warehouseId: 'synthetic-warehouse', iat: issued, exp: expires })).toString('base64url') + '.unsigned';
}
function auth(entries) {
  const stored = new Map(Object.entries(entries));
  const session = new Map();
  const storage = data => ({ getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) });
  const context = { window: {}, localStorage: storage(stored), sessionStorage: storage(session),
    location: { search: '' }, URLSearchParams, TextDecoder, Uint8Array,
    atob: value => Buffer.from(value, 'base64').toString('binary') };
  vm.runInNewContext(source, context, { filename: 'auth.js' });
  return { api: context.window.ArgusAuth, stored };
}

test('legacy expired or older worker login cannot replace a newer current worker session', () => {
  const current = token('worker', 'current-worker', now - 60, now + 86400);
  const owner = token('owner', 'owner', now - 120, now + 86400);
  for (const old of [token('worker', 'old-worker', now - 86400, now - 10),
    token('worker', 'old-worker', now - 3600, now + 3600)]) {
    const { api, stored } = auth({ argus_token: old, argus_role: 'worker',
      argus_auth_worker: current, argus_auth_owner: owner });
    assert.equal(api.get(['worker']).token, current);
    assert.equal(stored.get('argus_auth_worker'), current);
    assert.equal(stored.get('argus_auth_owner'), owner);
    assert.equal(stored.has('argus_token'), false);
    assert.equal(stored.has('argus_role'), false);
  }
});

test('live legacy worker login still migrates into an empty or expired worker slot', () => {
  const old = token('worker', 'worker', now - 60, now + 3600);
  for (const entries of [{}, { argus_auth_worker: token('worker', 'expired', now - 86400, now - 10) }]) {
    const { api, stored } = auth({ ...entries, argus_token: old });
    assert.equal(api.get(['worker']).token, old);
    assert.equal(stored.get('argus_auth_worker'), old);
    assert.equal(stored.has('argus_token'), false);
  }
});

test('migration of another role cannot replace or authorize the worker login', () => {
  const worker = token('worker', 'worker', now - 120, now + 3600);
  const owner = token('owner', 'owner', now - 60, now + 3600);
  const existing = auth({ argus_auth_worker: worker, argus_token: owner });
  assert.equal(existing.api.get(['worker']).token, worker);
  assert.equal(existing.stored.get('argus_auth_owner'), owner);
  const absent = auth({ argus_token: owner });
  assert.equal(absent.api.get(['worker']), null);
  assert.equal(absent.stored.has('argus_auth_worker'), false);
});
