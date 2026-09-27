// Клавиатура в формах кабинетов (владелец 27.09.2026, решение 2 к заданию
// «приёмка и склад»): стрелки ↑/↓ и Enter переходят к соседнему полю, как
// Tab. Форма отправляется только кнопкой: Enter в последнем поле ничего не
// отправляет. В полях даты, времени и числа стрелки меняют значение, как у
// браузера, — там к следующему полю ведёт Enter. В многострочном поле Enter
// переносит строку, как всегда.
//
// Один файл на кабинет склада и кабинет продавца: поведение формы не должно
// отличаться от экрана к экрану.
//
// Форма — это <form>, окно (dialog, .wh-modal) или блок с data-form. Поля
// вне формы (поиск над таблицей) стрелками не прыгают. data-keys="native" —
// оставить форме браузерное поведение (вход: Enter там — «Войти»).
(function () {
  const TEXT = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'password', 'number',
    'date', 'time', 'datetime-local', 'month', 'week']);
  // Здесь стрелки — свои: меняют значение.
  const OWN_ARROWS = new Set(['number', 'date', 'time', 'datetime-local', 'month', 'week']);
  const typeOf = (el) => (el.getAttribute('type') || '').toLowerCase();
  const isField = (el) => Boolean(el) && ((el.tagName === 'INPUT' && TEXT.has(typeOf(el)))
    || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  const usable = (el) => !el.disabled && !el.readOnly && el.tabIndex >= 0
    && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const scopeOf = (el) => el.closest('form, [data-form], dialog, .wh-modal, [role="dialog"]');

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
    const el = e.target;
    if (!isField(el) || el.closest('[data-keys="native"]')) return;
    let dir = 0;
    if (e.key === 'Enter') {
      if (el.tagName === 'TEXTAREA') return;
      dir = 1;
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Список подсказок (datalist, свой выпадающий) листается стрелками сам.
      if (el.tagName !== 'INPUT' || OWN_ARROWS.has(typeOf(el)) || el.list
        || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-expanded') === 'true') return;
      dir = e.key === 'ArrowDown' ? 1 : -1;
    } else return;
    const scope = scopeOf(el);
    if (!scope) return;
    const fields = [...scope.querySelectorAll('input, select, textarea')].filter((f) => isField(f) && usable(f));
    const at = fields.indexOf(el);
    if (at === -1) return;
    // Enter не отправляет форму и не жмёт кнопку; стрелка не двигает каретку.
    e.preventDefault();
    const next = fields[at + dir];
    if (!next) return;
    next.focus();
    if (next.tagName === 'INPUT' && !OWN_ARROWS.has(typeOf(next)) && typeof next.select === 'function') {
      try { next.select(); } catch (err) { /* у некоторых полей выделения нет */ }
    }
  });
}());
