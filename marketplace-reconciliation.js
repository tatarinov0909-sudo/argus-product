(() => {
  'use strict';
  const API='https://api.argus-ai.online';
  const token=localStorage.getItem('argus_token');
  const $=id=>document.getElementById(id);
  const tbody=$('orders').querySelector('tbody');
  let next=null, current=null, pending=false;
  async function api(path,body){
    if(!token) throw new Error('Войдите в кабинет владельца склада.');
    const res=await fetch(API+'/api/marketplaces/reconciliation'+path,{
      method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined,
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(res.status===403?'Этот раздел доступен владельцу склада.':data.error||'Не удалось получить данные.');
    return data;
  }
  function cell(row,text,cls){const td=document.createElement('td');td.textContent=text;if(cls)td.className=cls;row.append(td);return td;}
  function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
  async function load(more=false){
    $('refresh').disabled=true;$('loadMore').disabled=true;
    try{
      const data=await api(more&&next?'?after='+encodeURIComponent(next):'');
      if(!more)tbody.replaceChildren();next=data.next;
      for(const order of data.rows){
        const tr=document.createElement('tr');cell(tr,order.number);cell(tr,order.company);
        cell(tr,order.mp_close_reason==='canceled'?'Отменён на WB':'Передан в доставку на WB');
        cell(tr,Number(order.picked_qty).toLocaleString('ru-RU'),'number');
        const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.textContent='Проверить';
        b.addEventListener('click',()=>show(order.id));td.append(b);tr.append(td);tbody.append(tr);
      }
      $('orders').hidden=!tbody.rows.length;$('loadMore').hidden=!next;
      message(tbody.rows.length?'Показано заказов: '+tbody.rows.length:'Заказов, требующих сверки, сейчас нет.');
    }catch(e){message(e.message,true);}finally{$('refresh').disabled=false;$('loadMore').disabled=false;}
  }
  async function show(id){
    if(pending)return;
    try{
      current=await api('/'+encodeURIComponent(id));$('detail').hidden=false;$('lines').replaceChildren();
      $('detailTitle').textContent=current.number+' · '+current.company;
      $('detailInfo').textContent=current.reason==='canceled'
        ?'Если товар ещё у ворот, физически верните весь указанный годный товар в исходные ячейки. Подтверждение запишет этот возврат и снимет резерв.'
        :'Убедитесь, что весь подобранный товар действительно уехал. Подтверждение зафиксирует отъезд в Аргусе.';
      for(const line of current.lines){const tr=document.createElement('tr');cell(tr,line.name+' ('+line.sku+')');cell(tr,line.cell);cell(tr,line.qty.toLocaleString('ru-RU'),'number');$('lines').append(tr);}
      const labels={return_to_cells:['Весь указанный товар фактически возвращён в исходные ячейки, его состояние годное.','Подтвердить возврат в ячейки'],
        confirm_departed:['Весь указанный товар фактически уехал со склада.','Подтвердить фактический отъезд'],
        remove_from_supply:['Товар по этому заказу не отбирали. Заказ нужно исключить из местной поставки.','Исключить из поставки']};
      const label=labels[current.action]||['','Подтвердить'];
      $('confirmationText').textContent=label[0];$('confirmButton').textContent=label[1];$('confirmed').checked=false;
      $('confirmButton').disabled=true;$('confirmForm').hidden=!current.canResolve;
      $('departureField').hidden=current.action!=='confirm_departed';$('departedAt').required=current.action==='confirm_departed';$('departedAt').value='';
      $('blocked').textContent=current.blocked||(current.resolved?'Этот заказ уже проверен.':'');
      $('resolutionMessage').textContent=current.supplyId?'Заказ будет исключён из местной поставки. Её состав нужно проверить повторно.':'';
      if(current.action==='remove_from_supply')$('detailInfo').textContent='Подбор по этому заказу в Аргусе не записан. Подтверждение изменит только состав местной поставки.';
      $('detail').focus();$('detail').scrollIntoView({block:'start',behavior:'instant'});
    }catch(e){message(e.message,true);}
  }
  $('confirmed').addEventListener('change',()=>{$('confirmButton').disabled=pending||!$('confirmed').checked;});
  $('confirmForm').addEventListener('submit',async e=>{
    e.preventDefault();if(pending||!current||!$('confirmed').checked)return;
    pending=true;$('confirmButton').disabled=true;$('resolutionMessage').textContent='Сохранение…';
    try{
      const departedAt=current.action==='confirm_departed'?new Date($('departedAt').value).toISOString():undefined;
      await api('/'+encodeURIComponent(current.id),{action:current.action,version:current.version,confirmed:true,departedAt});
      $('confirmForm').hidden=true;$('resolutionMessage').textContent='Подтверждение сохранено. Остатки и журнал обновлены.';
      await load();
    }catch(err){$('resolutionMessage').textContent=err.message+' Откройте проверку заказа заново.';}
    finally{pending=false;}
  });
  $('closeDetail').addEventListener('click',()=>{if(!pending)$('detail').hidden=true;});
  $('refresh').addEventListener('click',()=>load());$('loadMore').addEventListener('click',()=>load(true));
  load();
})();
