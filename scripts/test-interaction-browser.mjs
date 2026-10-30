// UI/protocol simulation only: never connects to a real Android phone or production endpoint.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.INTERACTION_TEST_URL??'http://127.0.0.1:5175';
const target=new URL(base);if(!['localhost','127.0.0.1'].includes(target.hostname))throw Error('Local test server only');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1400,height:1000},extraHTTPHeaders:{'oai-authenticated-user-email':'onboarding@local.test'}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const sid='11111111-1111-4111-8111-111111111111';
await page.route('**/api/**',route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/api/devices')return route.fulfill({json:{devices:[{id:'test-device',name:'Browser test phone',appVersion:'0.5.3',online:true,lastSeenAt:Date.now(),screenWidth:1080,screenHeight:2400}]}});
 if(url.pathname==='/api/ice')return route.fulfill({json:{iceServers:[]}});
 if(url.pathname==='/api/sessions')return route.fulfill({status:201,json:{sessionId:sid}});
 if(url.pathname===`/api/sessions/${sid}`&&route.request().method()==='GET')return route.fulfill({json:{session:{state:'answer_ready',answerType:'answer',answerSdp:'test-only'},candidates:[]}});
 return route.fulfill({json:{ok:true}});
});
await page.addInitScript(({sid})=>{
 window.__sent=[];window.__peers=0;window.__pad=null;
 Object.defineProperty(navigator,'getGamepads',{value:()=>window.__pad?[window.__pad]:[]});
 window.RTCPeerConnection=class{
  constructor(){window.__peers++;this.connectionState='new';this.localDescription=null;}
  addTransceiver(){return {receiver:{},setCodecPreferences(){}};}
  createDataChannel(){const channel={readyState:'connecting',bufferedAmount:0,send(text){const m=JSON.parse(text);window.__sent.push(m);if(m.id)setTimeout(()=>channel.onmessage?.({data:JSON.stringify({type:'ack',v:1,id:m.id,status:'completed'})}),0);},close(){this.readyState='closed';}};this.channel=channel;window.__control=channel;return channel;}
  async createOffer(){return {type:'offer',sdp:'test-only'};}
  async setLocalDescription(value){this.localDescription={...value,toJSON:()=>value};}
  async setRemoteDescription(){this.currentRemoteDescription={type:'answer'};setTimeout(()=>{
   this.connectionState='connected';this.onconnectionstatechange?.();this.channel.readyState='open';this.channel.onopen?.();
   this.channel.onmessage?.({data:JSON.stringify({type:'capabilities',v:1,inputSessionId:sid,features:['commandAck','liveTouch','lowLatencyInput','multiTouchExperimental','quality720']})});
   const canvas=document.createElement('canvas');window.__canvas=canvas;canvas.width=360;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#142233';ctx.fillRect(0,0,360,800);ctx.fillStyle='white';ctx.fillText('Simulated phone',30,50);this.stream=canvas.captureStream(10);this.ontrack?.({streams:[this.stream],track:this.stream.getVideoTracks()[0]});
  },30);}
  async addIceCandidate(){}
  async getStats(){return new Map();}
  close(){this.connectionState='closed';this.stream?.getTracks().forEach(t=>t.stop());}
 };
},{sid});
try{
 await page.goto(base);await page.getByRole('button',{name:'연결 시작',exact:true}).first().click();
 await page.getByLabel('연결된 휴대폰 원격 화면').waitFor();
 await page.waitForFunction(()=>window.__sent.some(m=>m.type==='hello'));
 const controls=page.getByLabel('모드별 조작 설정');
 await controls.getByLabel('키·마우스 매핑 활성화',{exact:false}).check();
 await controls.getByLabel('연속 멀티터치 실험에 동의',{exact:false}).check();
 await controls.getByRole('button',{name:'화면 입력 활성화'}).click();
 await page.keyboard.down('w');await page.keyboard.down('d');await page.keyboard.down('f');
 await page.waitForFunction(()=>window.__sent.some(m=>m.type==='pointerFrame'&&m.points.length===2&&m.points.some(p=>p.pointerId==='joystick'&&p.x>.22&&p.y<.76)));
 await page.keyboard.up('w');await page.keyboard.up('d');await page.keyboard.up('f');
 await page.waitForFunction(()=>window.__sent.some(m=>m.type==='pointerFrame'&&m.points.some(p=>p.phase==='up')));
 await controls.getByRole('button',{name:'화면 입력 활성화'}).click();await page.keyboard.down('w');
 const heldView=page.getByLabel('연결된 휴대폰 원격 화면');await heldView.scrollIntoViewIfNeeded();const heldBox=await heldView.boundingBox();
 await page.mouse.move(heldBox.x+heldBox.width/2,heldBox.y+heldBox.height/2);await page.mouse.down();
 await heldView.dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',bubbles:true});
 await page.waitForFunction(()=>window.__sent.filter(m=>m.type==='pointerFrame').some(m=>m.points.some(p=>p.pointerId==='mouse:1'&&p.phase==='cancel')&&m.points.some(p=>p.pointerId==='joystick'&&p.phase==='move')));
 await page.mouse.up();await page.keyboard.up('w');
 const beforeModifier=await page.evaluate(()=>window.__sent.length);
 await page.keyboard.down('w');await page.keyboard.down('Control');await page.keyboard.up('w');await page.keyboard.up('Control');
 await page.waitForFunction(n=>window.__sent.slice(n).some(m=>m.type==='pointerFrame'&&m.points.some(p=>p.pointerId==='joystick'&&p.phase==='up')),beforeModifier);
 const peerCount=await page.evaluate(()=>window.__peers);
 const qualityCount=await page.evaluate(()=>window.__sent.filter(m=>m.type==='quality').length);
 // Profiles/editor must not send input while selecting positions.
 await controls.getByRole('button',{name:'키 매핑 편집',exact:true}).click();
 const before=await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame').length);
 await page.getByLabel('연결된 휴대폰 원격 화면').click({position:{x:100,y:160}});
 assert.equal(await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame').length),before);
 await controls.getByRole('button',{name:'편집 종료 · 플레이'}).click();
 // Gamepad bridge is standard Gamepad API -> touch, never native Android gamepad.
 await controls.getByLabel('표준 게임패드 → 터치 매핑').check();
 await controls.getByRole('button',{name:'화면 입력 활성화'}).click();
 await page.evaluate(()=>{window.__pad={connected:true,mapping:'standard',axes:[.7,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===0,value:i===0?1:0}))};});
 await page.waitForFunction(()=>window.__sent.some(m=>m.type==='pointerFrame'&&m.points.some(p=>p.pointerId==='mapped:Pad0')));
 await page.getByRole('button',{name:'설정',exact:true}).focus();
 await page.waitForTimeout(150);
 const end=await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame').at(-1));
 assert.ok(end.points.every(p=>p.phase==='cancel'));
 const countAfterBlur=await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame').length);
 await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame').length),countAfterBlur);
 await page.evaluate(()=>{window.__pad=null;});
 // A mode switch releases, keeps exactly the same peer, and starts no auto scroll.
 await controls.getByRole('button',{name:'소설',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__peers),peerCount);
 await controls.getByRole('button',{name:'화면 입력 활성화'}).click();
 await page.keyboard.press('PageDown');await page.waitForFunction(()=>window.__sent.some(m=>m.type==='swipe'));
 await controls.getByRole('button',{name:'자동 스크롤 시작',exact:true}).click();await controls.locator('output').filter({hasText:'running'}).waitFor();
 await controls.getByRole('button',{name:'일시정지',exact:true}).click();await controls.locator('output').filter({hasText:'paused'}).waitFor();
 await controls.getByRole('button',{name:'재개',exact:true}).click();await controls.locator('output').filter({hasText:'running'}).waitFor();
 await page.evaluate(()=>{window.__canvas.width=800;window.__canvas.height=360;window.__canvas.getContext('2d').fillRect(0,0,800,360);});
 await controls.locator('output').filter({hasText:'stopped'}).waitFor();
 await controls.getByRole('button',{name:'자동 스크롤 시작',exact:true}).click();await controls.locator('output').filter({hasText:'running'}).waitFor();
 await page.evaluate(()=>{window.__control.onmessage({data:JSON.stringify({type:'inputError',code:'ACCESSIBILITY_DISABLED'})});});
 await controls.locator('output').filter({hasText:'stopped'}).waitFor();
 await controls.getByRole('button',{name:'웹툰',exact:true}).click();await controls.locator('output').filter({hasText:'stopped'}).waitFor();
 await controls.getByLabel('표시 확대',{exact:false}).fill('1.5');
 const viewport=page.getByLabel('연결된 휴대폰 원격 화면');await viewport.scrollIntoViewIfNeeded();
 const box=await viewport.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.keyboard.down('Shift');await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+20);await page.mouse.up();await page.keyboard.up('Shift');
 await page.waitForFunction(()=>document.querySelector('[aria-label="연결된 휴대폰 화면"]').style.transform.includes('40px'));
 await controls.getByRole('button',{name:'창에 맞춤'}).click();assert.equal(await controls.getByLabel('표시 확대',{exact:false}).inputValue(),'1');
 await controls.getByRole('button',{name:'화면 입력 활성화'}).click();await page.keyboard.press('Space');
 await page.getByRole('button',{name:'전체화면',exact:true}).click();
 await page.waitForFunction(()=>Boolean(document.fullscreenElement));
 await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement);
 if(process.env.INTERACTION_SCREENSHOT)await page.screenshot({path:process.env.INTERACTION_SCREENSHOT,fullPage:true});
 assert.equal(await page.evaluate(()=>window.__peers),peerCount);
 assert.equal(await page.evaluate(()=>window.__sent.filter(m=>m.type==='quality').length),qualityCount);
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('gr-interaction:')).length),0);
 await page.getByRole('button',{name:'설정',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'개인 PC',exact:false}).click();
 await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
 await controls.getByRole('button',{name:'소설',exact:true}).click();
 await controls.getByLabel('표시 확대',{exact:false}).fill('1.25');
 await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('gr-interaction:')&&JSON.parse(localStorage[k]).mode==='novel'&&JSON.parse(localStorage[k]).profiles.find(p=>p.mode==='novel').zoom===1.25));
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('[aria-label="사용 모드"] button[aria-pressed="true"]')?.textContent==='소설');
 assert.equal(await controls.getByLabel('표시 확대',{exact:false}).inputValue(),'1.25');
 assert.equal(await page.evaluate(()=>window.__sent.length),0);
 await controls.locator('output').filter({hasText:'stopped'}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: simulated WebRTC kept across modes; WASD/multi snapshots, editor isolation, gamepad mapping, reading keys, auto pause/resume/stop, zoom/fit, rotation/error release, focus-safe gamepad and personal/public profile restoration. Real Android behavior UNVERIFIED.');
}finally{await browser.close();}
