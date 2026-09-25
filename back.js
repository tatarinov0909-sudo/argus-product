// Кнопка «назад» браузера и жест «назад» на телефоне.
//
// Экраны кабинета и грузчика — одна страница: переход между ними история
// браузера не видит. Поэтому «назад» уводил со страницы целиком — на вход,
// где выбирают кабинет, — хотя человек хотел на шаг назад внутри работы
// (владелец 26.09.2026).
//
// Как устроено: поверх страницы держим одну запись-заглушку. Когда человек
// жмёт «назад», браузер снимает заглушку, мы делаем шаг назад внутри
// страницы и ставим заглушку заново. Шаг назад — то же, что человек нажал бы
// сам: закрыть открытое окно, иначе нажать видимую стрелку «←» экрана,
// иначе — то, что страница передала в fallback (например, вернуться на
// прошлую вкладку). Если идти некуда, уходим со страницы как обычно.
//
// Заглушку ставим только после первого нажатия на странице: запись,
// добавленную без действия человека, Chrome при «назад» пропускает.
(function(){
  const OVERLAYS = '.ask-overlay, .wh-modal-overlay.open, .lightbox.open, .sheet-overlay.show';
  let armed = false;
  let leaving = false;
  let config = { buttons: '', fallback: null };

  const visible = (el) => el && el.offsetParent !== null;
  const lastVisible = (selector) => {
    if(!selector) return null;
    const list = Array.from(document.querySelectorAll(selector)).filter(visible);
    return list[list.length - 1] || null;
  };

  function stepBack(){
    // Внутри открытого окна своя стрелка («← Назад» к прошлому шагу) важнее,
    // чем закрыть окно целиком.
    const overlay = Array.from(document.querySelectorAll(OVERLAYS)).pop();
    if(overlay){
      const inner = config.buttons && Array.from(overlay.querySelectorAll(config.buttons)).filter(visible).pop();
      if(inner){ inner.click(); return true; }
      // У каждого такого окна «клик мимо» закрывает его — им и пользуемся.
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }
    const openDialog = Array.from(document.querySelectorAll('dialog[open]')).pop();
    if(openDialog){ openDialog.close(); return true; }
    const btn = lastVisible(config.buttons);
    if(btn){ btn.click(); return true; }
    return config.fallback ? config.fallback() === true : false;
  }

  function arm(){
    if(armed) return;
    armed = true;
    history.pushState({ argusBack: true }, '');
  }

  window.addEventListener('popstate', function(){
    if(!armed || leaving) return;
    armed = false;
    if(stepBack()){
      arm();
      return;
    }
    // Шагать внутри некуда — это настоящий уход со страницы.
    leaving = true;
    history.back();
  });

  ['pointerdown', 'keydown'].forEach(function(type){
    window.addEventListener(type, arm, { capture: true, passive: true });
  });

  // buttons — селектор видимых стрелок «←» экрана;
  // fallback() — свой шаг назад страницы, true — если шаг сделан.
  window.argusBackButton = function(options){
    config = Object.assign(config, options || {});
  };
})();
