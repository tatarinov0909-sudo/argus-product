(function () {
  'use strict';
  const config = window.ARGUS_WORKER_CONFIG || {};
  const form = document.getElementById('workerLogin'), button = document.getElementById('loginButton'), error = document.getElementById('loginError');
  if (config.native && window.Capacitor?.Plugins?.WorkerDevice?.setWorkActive) {
    Capacitor.Plugins.WorkerDevice.setWorkActive({ active: false, pendingPause: false }).catch(() => {});
  }
  if(config.environment === 'stand'){
    const notice = document.getElementById('buildNotice');
    notice.textContent = 'Тестовый стенд. Эта версия предназначена для проверки на учебных данных.';
    notice.hidden = false;
  }
  if (ArgusAuth.get(['worker'])) { location.replace('loader.html'); return; }
  if (config.native) document.getElementById('iosInstall').hidden = true;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    const key = document.getElementById('key').value.trim().toUpperCase();
    if (!key) return;
    button.disabled = true; button.textContent = 'Проверяем ключ…'; error.hidden = true;
    try {
      const res = await fetch(String(config.apiBase || '').replace(/\/$/, '') + '/api/auth/staff/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyCode: key, as: 'worker' })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data && data.error || 'Не удалось войти. Проверьте ключ или обратитесь к руководителю.');
      if (!data || data.role !== 'worker' || !data.token) throw new Error('Нужен ключ работника склада. Попросите его у руководителя.');
      ArgusAuth.set('worker', data.token);
      document.getElementById('key').value = '';
      location.replace('loader.html');
    } catch (e) {
      error.textContent = e instanceof TypeError ? 'Нет связи с сервером. Проверьте интернет и повторите вход.' : e.message;
      error.hidden = false;
    } finally { button.disabled = false; button.textContent = 'Войти в работу'; }
  });
  if ('serviceWorker' in navigator && !config.native) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
