'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('../../mobile/node_modules/playwright');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'test-results/worker-fixes-012/browser'); fs.mkdirSync(output, {recursive:true});
const site = 'http://127.0.0.1:8769';
const api = 'https://api.argus-ai.online';
const ids = { invoice: '10000000-0000-4000-8000-000000000001', invoice2: '10000000-0000-4000-8000-000000000002', item:'20000000-0000-4000-8000-000000000001', company:'30000000-0000-4000-8000-000000000001', supply:'40000000-0000-4000-8000-000000000001' };
const token = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({role:'worker', staffKeyId:'50000000-0000-4000-8000-000000000001', warehouseId:'60000000-0000-4000-8000-000000000001', name:'Тестовый работник', exp:Math.floor(Date.now()/1000)+3600})).toString('base64url') + '.synthetic-not-valid-on-server';
const invoice = {id:ids.invoice, number:'ПР-2026-001', direction:'in', status:'open', company_id:ids.company, company_name:'Учебный продавец', created_at:'2026-10-09T08:00:00Z', arrived_at:'2026-10-09T08:00:00Z', items:[{id:ids.item, name:'Учебный товар', sku:'SKU-TEST-001', barcode:'4600000000001', declared_qty:12, receiving_id:null, accepted_qty:null, placed_qty:0}], work:null};
const supply = {id:ids.supply, number:'ПОСТ-2026-001', status:'collecting', company_id:ids.company, company_name:'Учебный продавец', orders:1,picked:0, created_at:'2026-10-09T08:00:00Z', destination:'Учебный склад', products:[], items:[], invoices:[]};
function defaults(url, state){
 const p = url.pathname;
 if (p === '/api/invoices') return state.invoices ?? [invoice];
 if (p.startsWith('/api/invoices/')) return (state.invoices ?? [invoice]).find(x=>x.id===p.split('/').at(-1)) || invoice;
 if (p === '/api/supplies') return state.supplies ?? [supply];
 if (p.startsWith('/api/supplies/')) return {...supply, ...(state.supplies??[supply]).find(x=>x.id===p.split('/').at(-1)), products:[]};
 if (p==='/api/cells/rows') return [];
 if (p==='/api/shipping/pick-list') return [];
 if (p==='/api/inventory/tasks' || p==='/api/defects/tasks' || p==='/api/vwarehouses/move-tasks' || p==='/api/inventory/products' || p==='/api/vwarehouses') return [];
 if (p==='/api/auth/staff/login') return {token, role:'worker'};
 return null;
}
async function create(browser, {width=390, height=844, authenticated=true, state={}, handler}={}) {
 const context = await browser.newContext({viewport:{width,height}, serviceWorkers:'block', reducedMotion:'reduce', storageState: {cookies:[], origins: authenticated ? [{origin:site,localStorage:[{name:'argus_auth_worker',value:token}]}] : []}});
 const calls=[], errors=[], blocked=[];

 await context.route('**/*', async route=>{
   const req=route.request(), u=new URL(req.url());
   if(u.origin===api){
    calls.push({path:u.pathname+u.search, method:req.method()});
    if(handler && await handler(route,u,req,state)) return;
    const data=defaults(u,state);
    if(data===null){ await route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Unmocked endpoint'})}); return; }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)}); return;
   }
   if(u.origin===site){
    let p=path.resolve(root,'.'+decodeURIComponent(u.pathname));
    if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){await route.fulfill({status:404,body:'not found'});return;}
    const ext=path.extname(p);const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.woff2':'font/woff2','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
    await route.fulfill({status:200,contentType:types[ext]||'application/octet-stream',body:fs.readFileSync(p)});return;
   }
   blocked.push(req.url()); await route.abort('blockedbyclient');
 });
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.setDefaultTimeout(6000);
 return {context,page,calls,errors,blocked,state};
}
async function home(x){await x.page.goto(site+'/loader.html');await x.page.locator('#homeBody[aria-busy=\"false\" ]').waitFor();}
async function snapshot(page,file){await page.screenshot({path:path.join(output,file),fullPage:true,animations:'disabled'});}
async function geometry(page){return page.evaluate(()=>({width:innerWidth,docWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth, overflow:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width&&r.height&&s.visibility!=='hidden'&&(r.left < -1 || r.right>innerWidth+1);}).slice(0,30).map(e=>({tag:e.tagName,id:e.id,cls:e.className,text:e.textContent.trim().slice(0,80),rect:{x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width}}))}));}
module.exports={chromium,webkit,create,home,snapshot,geometry,site,api,ids,invoice,supply,root,output};
