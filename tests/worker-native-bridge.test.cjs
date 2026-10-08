const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../mobile/native-bridge.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function bridge(lifecycle) {
  const listeners = new Map(), acknowledgements = [], delivered = [];
  let snapshot = { state: 'active', at: 1000, pending: [] }, nativeListener, failAck = false;
  const device = {
    addListener: (_name, listener) => { nativeListener = listener; return { remove: async () => {} }; },
    getLifecycle: async () => snapshot,
    ackLifecycle: async body => {
      if (failAck) { failAck = false; throw new Error('storage unavailable'); }
      acknowledgements.push(...body.ids);
      snapshot = { ...snapshot, pending: snapshot.pending.filter(event => !body.ids.includes(event.id)) };
    }
  };
  const worker = { lifecycle: async event => { delivered.push(event); return lifecycle ? lifecycle(event) : { ack: true }; } };
  const window = {
    ARGUS_WORKER_CONFIG: { native: true }, Capacitor: { Plugins: { WorkerDevice: device } },
    ArgusWorker: worker, addEventListener: (name, callback) => listeners.set(name, callback)
  };
  vm.runInNewContext(source, { window, document: { readyState: 'loading', addEventListener() {} }, console: { warn() {} } });
  await settle();
  return { window, worker, acknowledgements, delivered,
    emit: event => {
      snapshot = Array.isArray(event.pending) ? event : { state: event.state, at: event.at, pending: [event] };
      return nativeListener(event);
    },
    notify: event => nativeListener(event),
    setSnapshot: next => { snapshot = next; },
    ready: () => listeners.get('argus:worker-ready')(),
    failNextAck: () => { failAck = true; }
  };
}

test('native event is acknowledged only after the pause is durably saved', async () => {
  let save;
  const saved = new Promise(resolve => { save = resolve; });
  const app = await bridge(event => event.id ? saved : { ack: true });
  const event = { id: 'departure-1', state: 'background', at: 1000 };
  const delivery = app.emit(event);
  await settle();
  assert.deepEqual(app.acknowledgements, []);
  save({ ack: true });
  await delivery;
  assert.deepEqual(app.acknowledgements, ['departure-1']);
});

test('unready client keeps the native event and replays it after worker restoration', async () => {
  let restored = false;
  const app = await bridge(() => ({ ack: restored }));
  app.setSnapshot({ state: 'active', at: 30000, pending: [{ id: 'departure-2', state: 'screen-off', at: 1000, resumedAt: 30000 }] });
  await app.ready();
  assert.deepEqual(app.acknowledgements, []);
  restored = true;
  await app.ready();
  assert.deepEqual(app.acknowledgements, ['departure-2']);
  assert.equal(app.delivered.filter(event => event.id === 'departure-2').at(-1).resumedAt, 30000);
});

test('repeated native snapshot does not repeat an already acknowledged departure', async () => {
  const app = await bridge();
  const snapshot = { state: 'active', at: 30000, pending: [{ id: 'departure-3', state: 'background', at: 1000, resumedAt: 30000 }] };
  await Promise.all([app.emit(snapshot), app.emit(snapshot)]);
  assert.deepEqual(app.acknowledgements, ['departure-3']);
  assert.equal(app.delivered.filter(event => event.id === 'departure-3').length, 1);
});

test('failed native acknowledgement remains retryable with the same event id', async () => {
  const app = await bridge();
  const snapshot = { state: 'active', at: 2000, pending: [{ id: 'departure-4', state: 'background', at: 1000, resumedAt: 2000 }] };
  app.failNextAck();
  await app.emit(snapshot);
  assert.deepEqual(app.acknowledgements, []);
  await app.emit(snapshot);
  assert.deepEqual(app.acknowledgements, ['departure-4']);
  assert.equal(app.delivered.filter(event => event.id === 'departure-4').length, 2);
});

test('cold WebView without a client does not consume the native pending departure', async () => {
  const app = await bridge();
  app.window.ArgusWorker = undefined;
  app.setSnapshot({ state: 'active', at: 30000, pending: [{ id: 'departure-5', state: 'screen-off', at: 1000, resumedAt: 30000 }] });
  await app.ready();
  assert.deepEqual(app.acknowledgements, []);
  app.window.ArgusWorker = app.worker;
  await app.ready();
  assert.deepEqual(app.acknowledgements, ['departure-5']);
});

test('delayed screen-off callback reads the actual short resume before deciding to pause', async () => {
  const app = await bridge();
  app.setSnapshot({ state: 'active', at: 2000, pending: [{ id: 'departure-6', state: 'screen-off', at: 1000, resumedAt: 2000 }] });
  await app.notify({ state: 'screen-off', at: 1000, pending: [{ id: 'departure-6', state: 'screen-off', at: 1000 }] });
  const delivered = app.delivered.find(event => event.id === 'departure-6');
  assert.equal(delivered.resumedAt, 2000);
  assert.deepEqual(app.acknowledgements, ['departure-6']);
});
