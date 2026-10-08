(function () {
  'use strict';
  if (!window.ARGUS_WORKER_CONFIG?.native) return;
  const device = window.Capacitor?.Plugins?.WorkerDevice;
  if (!device) return;
  const acknowledged = new Set();
  let delivery = Promise.resolve();
  function ready() {
    delivery = delivery.then(async () => {
      if (!window.ArgusWorker?.lifecycle) return;
      // Retained callbacks may predate a short screen lock. Read its recorded resume first.
      const snapshot = await device.getLifecycle();
      const events = Array.isArray(snapshot.pending) ? snapshot.pending : [snapshot];
      for (const event of events) {
        if (event.id && acknowledged.has(event.id)) continue;
        const result = await window.ArgusWorker.lifecycle(event);
        if (event.id && result?.ack === true) {
          await device.ackLifecycle({ ids: [event.id] });
          acknowledged.add(event.id);
        }
      }
      if (Array.isArray(snapshot.pending) && snapshot.state === 'active') {
        await window.ArgusWorker.lifecycle({ state: 'active', at: snapshot.at });
      }
    }).catch(error => console.warn('Lifecycle delivery will retry:', error.message));
    return delivery;
  }
  Promise.resolve(device.addListener('lifecycle', ready)).then(ready).catch(() => {});
  window.addEventListener('argus:worker-ready', ready);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
