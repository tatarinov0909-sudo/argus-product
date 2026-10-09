(function () {
  'use strict';
  if (!window.ARGUS_WORKER_CONFIG?.native) return;
  const device = window.Capacitor?.Plugins?.WorkerDevice;
  if (!device) return;
  window.print = () => device.printCurrentPage().catch(() => {
    window.alert('Не удалось открыть печать. Повторите или откройте этот документ в браузере.');
  });
})();
