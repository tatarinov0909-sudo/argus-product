// Вход у каждой роли свой (07.10.2026).
//
// Раньше у всех кабинетов в браузере было одно место для входа
// (argus_token): вход продавца или грузчика в соседней вкладке затирал вход
// владельца, а истёкший вход в одной вкладке стирал его у всех сразу. Теперь
// у владельца, менеджера, работника и продавца своё место, и кабинеты разных
// ролей открыты рядом на одном компьютере.
//
// Вкладка помнит, под какой ролью работает (sessionStorage), — так страница
// печати, открытая из кабинета, берёт вход того же кабинета. Адрес может
// назвать роль явно: ?as=seller.
(function () {
  'use strict';
  const ROLES = ['owner', 'manager', 'worker', 'seller'];
  const slot = (role) => 'argus_auth_' + role;
  // Хранилище браузера может быть недоступно (приватный режим, запрет сайта):
  // тогда входа просто нет, а не страница падает.
  const safe = (fn) => { try { return fn(); } catch (e) { return null; } };

  function payload(token) {
    try {
      const bin = atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } catch (e) { return {}; }
  }
  const who = (p) => p.staffKeyId || p.sellerKeyId || p.ownerId || '';
  function sameUser(a, b) {
    const x = payload(a || ''); const y = payload(b || '');
    return !!x.role && x.role === y.role && who(x) === who(y) && x.warehouseId === y.warehouseId;
  }
  const alive = (token, role) => {
    const p = payload(token);
    return p.role === role && (!p.exp || p.exp * 1000 > Date.now());
  };

  // Старый общий вход переезжает на место своей роли — при первом открытии
  // любой страницы после обновления сайта. Он всегда свежее того, что уже
  // лежит на месте: новые страницы старое место не пишут, значит, туда вошли
  // только что.
  function migrate() {
    const old = safe(() => localStorage.getItem('argus_token'));
    if (old) {
      const role = payload(old).role;
      if (ROLES.includes(role)) safe(() => localStorage.setItem(slot(role), old));
    }
    safe(() => { localStorage.removeItem('argus_token'); localStorage.removeItem('argus_role'); });
  }

  // Вход для страницы. roles — какие роли она принимает, по порядку
  // предпочтения. Первой идёт роль из адреса (?as=), потом роль этой вкладки.
  function get(roles) {
    migrate();
    const asked = safe(() => new URLSearchParams(location.search).get('as'));
    const tab = safe(() => sessionStorage.getItem('argus_tab_role'));
    const first = [asked, tab].filter((r) => r && roles.includes(r));
    const order = first.concat(roles.filter((r) => !first.includes(r)));
    for (const role of order) {
      const token = safe(() => localStorage.getItem(slot(role)));
      if (token && alive(token, role)) {
        safe(() => sessionStorage.setItem('argus_tab_role', role));
        return { token, role };
      }
    }
    return null;
  }

  function set(role, token) {
    safe(() => localStorage.setItem(slot(role), token));
    safe(() => sessionStorage.setItem('argus_tab_role', role));
  }
  // Продлённый вход кладём на место, только если там вход того же человека:
  // в соседней вкладке под этой ролью мог войти другой.
  function renew(role, oldToken, newToken) {
    if (sameUser(safe(() => localStorage.getItem(slot(role))), oldToken)) {
      safe(() => localStorage.setItem(slot(role), newToken));
    }
  }
  // Выход и истёкший вход стирают только свою роль и только своего человека.
  function clear(role, token) {
    const current = safe(() => localStorage.getItem(slot(role)));
    if (current && (!token || sameUser(current, token))) safe(() => localStorage.removeItem(slot(role)));
  }

  window.ArgusAuth = { ROLES, get, set, renew, clear, payload, sameUser };
})();
