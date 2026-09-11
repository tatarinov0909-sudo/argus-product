// Offline fixtures only; no request reaches the production API or Telegram.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:2048,height:1120}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let connected=false,status='new';
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin==='http://argus.test'){const f=path.join(root,u.pathname);return route.fulfill({body:fs.readFileSync(f),contentType:u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.css')?'text/css':'text/javascript'});}
   if(u.origin!=='https://api.argus-ai.online')return route.abort();
   const endpoint=u.pathname.replace('/api/leads/manage','');let data;
   if(endpoint==='/access')data={allowed:true};
   else if(endpoint==='/telegram/connect'){assert.equal(route.request().postDataJSON().token,'test-only-token');data={url:'https://t.me/Argus_test_bot?start=test-only',expiresIn:900};}
   else if(endpoint==='/telegram/confirm'){connected=true;data={connected};}
   else if(endpoint==='/telegram')data={connected,bot_username:'Argus_test_bot'};
   else if(endpoint==='/test/status'){status=route.request().postDataJSON().status;data={id:'test',status};}
   else if(endpoint==='')data={items:[{id:'test',name:'Тестовая заявка',contact:'test@example.invalid',message:'<img src=x onerror=alert(1)>',created_at:'2026-09-11T09:00:00Z',status,payload:{}}],counts:{new:status==='new'?1:0,total:1},hasMore:false};
   else throw Error('Unmocked endpoint '+endpoint);
   return route.fulfill({json:data});
  });
  await page.addInitScript(()=>localStorage.setItem('argus_token','offline-test-token'));
  await page.goto('http://argus.test/leads.html');await page.getByText('Тестовая заявка',{exact:true}).waitFor();
  assert.equal(await page.locator('tbody img').count(),0);
  await page.getByRole('button',{name:'Подключить Telegram',exact:true}).click();
  await page.getByLabel('Токен бота').fill('test-only-token');await page.getByRole('button',{name:'Сохранить и подключить'}).click();
  await page.getByRole('link',{name:'Открыть бота',exact:true}).waitFor();assert.equal(await page.getByLabel('Токен бота').inputValue(),'');
  await page.getByRole('button',{name:'Я нажал «Старт»'}).click();await page.getByRole('button',{name:'Изменить подключение'}).waitFor();
  await page.getByLabel('Статус заявки от Тестовая заявка').selectOption('contacted');
  await page.getByText('Новых: 0 · Всего: 1',{exact:true}).waitFor();
  for(const width of [2048,390]){await page.setViewportSize({width,height:1120});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[]);console.log('PASS leads UI: access, Telegram setup, token clearing, XSS, status, mobile overflow');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
