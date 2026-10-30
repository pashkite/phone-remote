// App lifecycle tests with controlled local signaling. These are not Android tests.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createBrowserFixture} from './browser-fixture.mjs';
const output=process.env.QA_OUTPUT_DIR??'outputs/integration-qa';mkdirSync(output,{recursive:true});
const results=[];
async function scenario(name,run){const f=await createBrowserFixture();try{await run(f);assert.deepEqual(f.errors,[]);results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:e.message});await f.page.screenshot({path:`${output}/failure-${results.length}.png`,fullPage:true}).catch(()=>{});throw e;}finally{await f.browser.close();writeFileSync(`${output}/browser-results.json`,JSON.stringify(results,null,2));}}
const connected=async f=>{await f.page.goto(f.base);await f.page.getByRole('button',{name:'연결 시작',exact:true}).first().click();await f.page.locator('.connection-pill').filter({hasText:'연결됨'}).waitFor();};
await scenario('cancel during delayed session response cannot resurrect a peer',async({page,base})=>{
 let release;const gate=new Promise(r=>release=r);let posted=false;
 await page.route('**/api/sessions',async route=>{posted=true;await gate;await route.fulfill({status:201,json:{sessionId:'11111111-1111-4111-8111-111111111111'}}).catch(()=>{});});
 await page.goto(base);await page.getByRole('button',{name:'연결 시작',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('.connection-pill').textContent==='연결 요청 중');assert.ok(posted);
 await page.getByRole('button',{name:'종료',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'연결 해제',exact:true}).click();release();await page.waitForTimeout(700);
 assert.equal(await page.evaluate(()=>window.__peers),0);assert.equal(await page.locator('.phone-view.is-live').count(),0);
});
await scenario('selecting another device closes the previous device control',async f=>{
 const {page}=f;await page.route('**/api/devices',route=>route.fulfill({json:{devices:['test-device','second-device'].map(id=>({id,name:id,appVersion:'0.5.3',online:true,lastSeenAt:Date.now()}))}}));
 await connected(f);await page.getByLabel('원격 기기 선택').selectOption('second-device');await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>window.__peer.connectionState),'closed');assert.equal(await page.locator('.phone-view.is-live').count(),0);
});
await scenario('authentication expiry terminates open control and prevents reconnect',async f=>{
 await connected(f);const {page,state}=f;state.deviceError=401;
 await page.getByRole('alert').filter({hasText:'로그인이 만료'}).waitFor();assert.equal(await page.evaluate(()=>window.__peer.connectionState),'closed');
 assert.equal(await page.locator('.phone-view.is-live').count(),0);
});
await scenario('100 connection cycles release peers, streams, timers and input; listener/heap samples',async f=>{
 const {page,base,context}=f;
 await page.addInitScript(()=>{
  const original=window.RTCPeerConnection;window.__active=0;
  window.RTCPeerConnection=class extends original{constructor(...args){super(...args);window.__active++;this.__closed=false;}close(){if(!this.__closed){window.__active--;this.__closed=true;}super.close();}};
  const start=window.setInterval.bind(window),clear=window.clearInterval.bind(window);window.__intervals=new Set();
  window.setInterval=(fn,delay,...args)=>{const id=start(fn,delay,...args);window.__intervals.add(id);return id;};window.clearInterval=id=>{window.__intervals.delete(id);return clear(id);};
 });
 await page.goto(base);const cdp=await context.newCDPSession(page);let baseline;
 for(let i=0;i<100;i++){
  await page.getByRole('button',{name:'연결 시작',exact:true}).first().click();await page.locator('.connection-pill').filter({hasText:'연결됨'}).waitFor();
  await page.getByRole('group',{name:'빠른 모드 전환'}).getByRole('button',{name:i%2?'게임':'소설',exact:true}).click();
  await page.getByRole('button',{name:'종료',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'연결 해제',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__active),0);assert.equal(await page.evaluate(()=>window.__peer.stream.getTracks().every(t=>t.readyState==='ended')),true);
  if(i===9){await cdp.send('HeapProfiler.collectGarbage');baseline={dom:await cdp.send('Memory.getDOMCounters'),heap:await cdp.send('Runtime.getHeapUsage'),intervals:await page.evaluate(()=>window.__intervals.size)};}
 }
 await cdp.send('HeapProfiler.collectGarbage');const final={dom:await cdp.send('Memory.getDOMCounters'),heap:await cdp.send('Runtime.getHeapUsage'),intervals:await page.evaluate(()=>window.__intervals.size)};
 assert.ok(final.dom.jsEventListeners<=baseline.dom.jsEventListeners+10,JSON.stringify({baseline,final}));assert.equal(final.intervals,baseline.intervals);assert.equal(await page.evaluate(()=>window.__peers),100);
 writeFileSync(`${output}/cycle-resources.json`,JSON.stringify({cycles:100,baselineAfter10:baseline,after100:final,note:'Simulated peers; heap samples are observations, not a general memory-leak proof.'},null,2));
});
await scenario('wall-clock reading soak stops after hidden/network disconnect',async f=>{
 const {page}=f;await connected(f);const c=page.getByLabel('모드별 조작 설정');await c.getByRole('button',{name:'소설',exact:true}).click();await c.getByRole('button',{name:'자동 스크롤 시작',exact:true}).click();await c.locator('output[data-state=running]').waitFor();
 const seconds=Number(process.env.QA_SOAK_SECONDS??30);assert.ok(seconds>=1&&seconds<=600);const started=Date.now();await page.waitForTimeout(seconds*1000);
 const before=await page.evaluate(()=>window.__sent.filter(m=>m.type==='swipe').length);assert.ok(before>0);
 // Controlled visibility event, not a claim about a physical mobile browser.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await c.locator('output[data-state=stopped]').waitFor();
 const hiddenCount=await page.evaluate(()=>window.__sent.filter(m=>m.type==='swipe').length);await page.waitForTimeout(1700);assert.equal(await page.evaluate(()=>window.__sent.filter(m=>m.type==='swipe').length),hiddenCount);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await c.getByRole('button',{name:'자동 스크롤 시작',exact:true}).click();await c.locator('output[data-state=running]').waitFor();
 await page.evaluate(()=>{window.__peer.connectionState='disconnected';window.__peer.onconnectionstatechange();});await c.locator('output[data-state=stopped]').waitFor();
 const stoppedCount=await page.evaluate(()=>window.__sent.filter(m=>m.type==='swipe').length);await page.waitForTimeout(1700);assert.equal(await page.evaluate(()=>window.__sent.filter(m=>m.type==='swipe').length),stoppedCount);
 await page.getByRole('button',{name:'종료',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'연결 해제',exact:true}).click();assert.equal(await page.evaluate(()=>window.__peer.connectionState),'closed');
 writeFileSync(`${output}/reading-soak.json`,JSON.stringify({requestedSeconds:seconds,elapsedMs:Date.now()-started,swipes:before,hiddenCount,stoppedCount,actualAndroid:false},null,2));
});
