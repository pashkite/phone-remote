import assert from 'node:assert/strict';
import {createBrowserFixture} from './browser-fixture.mjs';
const f=await createBrowserFixture();const {page,base,errors}=f;
try{
 await page.goto(base);await page.getByRole('button',{name:'연결 시작',exact:true}).first().click();await page.locator('.connection-pill').filter({hasText:'연결됨'}).waitFor();
 await page.evaluate(()=>{let n=0;window.__peer.getStats=async()=>{n++;return new Map([
 ['video',{id:'video',type:'inbound-rtp',kind:'video',framesDecoded:n*30,framesPerSecond:30,frameWidth:1080,frameHeight:2400,bytesReceived:n*100000,packetsReceived:n*900,packetsLost:n*100}],
 ['pair',{id:'pair',type:'candidate-pair',state:'succeeded',nominated:true,currentRoundTripTime:.3}]
 ]);};});
 await page.locator('.display-settings > summary').click();await page.getByLabel('영상 품질 모드').selectOption('auto');
 await page.waitForFunction(()=>window.__sent.some(m=>m.type==='quality'&&m.shortEdge===720),null,{timeout:10000});
 await page.getByLabel('영상 품질 모드').selectOption('high');const count=await page.evaluate(()=>window.__sent.filter(m=>m.type==='quality').length);await page.waitForTimeout(3500);assert.equal(await page.getByLabel('화면 해상도').inputValue(),'1440');assert.equal(await page.evaluate(()=>window.__sent.filter(m=>m.type==='quality').length),count);
 console.log('PASS injected 300ms RTT/10% loss lowers opted-in auto; manual 1440p remains unchanged (no physical latency claim).');
 const c=page.getByLabel('모드별 조작 설정');await c.getByLabel('키·마우스 매핑 활성화',{exact:false}).check();await c.getByLabel('연속 멀티터치 실험에 동의',{exact:false}).check();
 const view=page.getByLabel('연결된 휴대폰 원격 화면');await view.scrollIntoViewIfNeeded();const b=await view.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
 const before=await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame').length);
 await view.evaluate(el=>{const r=el.getBoundingClientRect();for(let i=0;i<1000;i++)el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,pointerType:'mouse',clientX:r.x+r.width*(.3+(i%20)/100),clientY:r.y+r.height*.5}));});await page.waitForTimeout(220);await page.mouse.up();
 const after=await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame').length);assert.ok(after-before<20);assert.ok(await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame').at(-1).points.every(p=>p.phase==='up'||p.phase==='cancel')));
 console.log('PASS 1000 pointer moves coalesce into bounded snapshots with terminal release.');
 await page.getByRole('button',{name:'종료',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'연결 해제',exact:true}).click();
 await page.route('**/api/sessions/*',route=>route.request().method()==='GET'?route.abort('internetdisconnected'):route.fallback());
 await page.getByRole('button',{name:'연결 시작',exact:true}).first().click();await page.locator('.connection-pill').filter({hasText:'오류'}).waitFor();assert.equal(await page.evaluate(()=>window.__peer.connectionState),'closed');assert.equal(await page.locator('.phone-view.is-live').count(),0);
 console.log('PASS signaling network interruption fails visibly and releases the peer.');assert.deepEqual(errors,[]);
}finally{await f.browser.close();}
