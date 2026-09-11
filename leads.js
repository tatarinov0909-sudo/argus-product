(() => {
  'use strict';
  const base='https://api.argus-ai.online/api/leads/manage';
  const token=localStorage.getItem('argus_token');
  const $=id=>document.getElementById(id);
  let offset=0,hasMore=false,connected=false,busy=false;
  const labels={new:'Новая',contacted:'Связались',closed:'Закрыта'};
  const date=s=>s ? new Date(s).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}) : '—';
  function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
  async function api(path='',method='GET',body){
    const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    if(r.status===401)throw Error('Сессия завершилась. Войдите в кабинет и снова откройте заявки.');
    if(!r.ok)throw Error(data.error||'Не удалось получить данные. Повторите позже.');
    return data;
  }
  function element(tag,text,cls){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;}
  async function action(button,fn){button.disabled=true;try{await fn();}catch(e){message('pageMessage',e.message,true);}finally{button.disabled=false;}}
  async function settings(){
    const s=await api('/telegram');connected=s.connected;
    $('configure').textContent=connected?'Изменить подключение':'Подключить Telegram';
    $('disconnect').hidden=!connected;
    $('telegramStatus').textContent=connected ? `Подключён @${s.bot_username}. ${s.last_error?'Последняя отправка не удалась — повторим автоматически.':s.last_delivered_at?'Последняя доставка: '+date(s.last_delivered_at):'Новые заявки будут приходить сюда.'}`:'Ещё не подключён';
  }
  async function load(){
    if(busy)return;busy=true;$('refresh').disabled=true;
    try{
      const data=await api('?status='+encodeURIComponent($('status').value)+'&offset='+offset);
      $('count').textContent=`Новых: ${data.counts.new} · Всего: ${data.counts.total}`;
      const fragment=document.createDocumentFragment();
      for(const lead of data.items){
        const tr=element('tr');
        const cell=(label,child)=>{const td=element('td');td.dataset.label=label;td.append(child);tr.append(td);};
        cell('Когда',element('div',date(lead.created_at),'date'));
        const contact=element('div');contact.append(element('strong',lead.name||'Имя не указано'),element('p',lead.contact));cell('Контакт',contact);
        const note=element('div');note.append(element('p',lead.message||'Без сообщения'));
        const extras=Object.entries(lead.payload||{}).filter(([k])=>!['name','contact','phone','email','message','comment','source'].includes(k));
        if(extras.length){const details=element('details');details.append(element('summary','Поля формы'));for(const [k,v] of extras)details.append(element('p',k+': '+v,'muted'));note.append(details);}
        cell('Сообщение',note);
        const status=element('select');status.setAttribute('aria-label','Статус заявки от '+(lead.name||lead.contact));
        for(const [v,l]of Object.entries(labels)){const o=element('option',l);o.value=v;status.append(o);}status.value=lead.status;
        status.addEventListener('change',()=>action(status,async()=>{try{await api('/'+lead.id+'/status','PATCH',{status:status.value});await load();}catch(e){status.value=lead.status;throw e;}}));cell('Статус',status);
        const delivery=element('div',lead.notified_at?'Доставлена '+date(lead.notified_at):lead.notify_error?'Повтор отправки: '+date(lead.notify_next_at):'Не доставлена','muted');
        if(!lead.notified_at&&connected&&lead.status!=='closed'){const send=element('button','Отправить в Telegram');send.onclick=()=>action(send,async()=>{await api('/'+lead.id+'/notify','POST',{});message('pageMessage','Заявка поставлена в очередь отправки.');});delivery.append(send);}cell('Telegram',delivery);fragment.append(tr);
      }
      $('rows').replaceChildren(fragment);$('empty').hidden=!!data.items.length;
      hasMore=data.hasMore;$('previous').disabled=offset===0;$('next').disabled=!hasMore;$('page').textContent='Страница '+(offset/30+1);
    }finally{busy=false;$('refresh').disabled=false;}
  }
  $('configure').onclick=()=>{$('setup').hidden=!$('setup').hidden;if(!$('setup').hidden)$('botToken').focus();};
  $('connectForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;message('setupMessage','Проверяем бота…');
    const secret=$('botToken').value;$('botToken').value='';
    try{const r=await api('/telegram/connect','POST',{token:secret});$('startBot').href=r.url;$('confirmStep').hidden=false;message('setupMessage','Откройте бота и нажмите «Старт».');}catch(e){message('setupMessage',e.message,true);}finally{button.disabled=false;}};
  $('confirm').onclick=()=>action($('confirm'),async()=>{const s=await api('/telegram/confirm','POST',{});if(!s.connected){message('setupMessage','Нажатие «Старт» ещё не получено. Откройте ссылку выше и попробуйте снова.');return;}$('confirmStep').hidden=true;$('startBot').removeAttribute('href');$('setup').hidden=true;await settings();await load();message('pageMessage','Telegram подключён. Новые заявки будут приходить автоматически.');});
  $('disconnect').onclick=()=>{if(window.confirm('Отключить Telegram? Заявки продолжат сохраняться в Аргусе.'))action($('disconnect'),async()=>{await api('/telegram','DELETE');await settings();await load();});};
  $('refresh').onclick=()=>action($('refresh'),async()=>{await settings();await load();message('pageMessage','Данные обновлены.');});
  $('status').onchange=()=>{offset=0;load().catch(e=>message('pageMessage',e.message,true));};
  $('previous').onclick=()=>{offset=Math.max(0,offset-30);load().catch(e=>message('pageMessage',e.message,true));};
  $('next').onclick=()=>{if(hasMore){offset+=30;load().catch(e=>message('pageMessage',e.message,true));}};
  (async()=>{if(!token){message('pageMessage','Войдите в кабинет владельца Аргуса, затем откройте эту страницу.');return;}try{await api('/access');$('content').hidden=false;message('pageMessage','');await settings();await load();}catch(e){message('pageMessage',e.message,true);}})();
})();
