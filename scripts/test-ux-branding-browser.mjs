// Actual Chromium rendering / interactions; the phone and account API are local fixtures.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {createBrowserFixture} from './browser-fixture.mjs';
const output=process.env.UX_SCREENSHOT_DIR??'outputs/ux-branding/after';mkdirSync(output,{recursive:true});
const f=await createBrowserFixture({holdPeer:true});
const {page,browser,state,base,errors}=f;
const controls=page.getByLabel('모드별 조작 설정');
const check=async(label,fn)=>{await fn();console.log(`PASS ${label}`);};
const screenshot=async(name)=>page.screenshot({path:`${output}/${name}.png`,fullPage:true});
try {
 await page.goto(base);await page.getByRole('heading',{name:'Browser test phone',exact:true}).waitFor();
 await check('branding metadata and real favicon/PNG/manifest MIME responses',async()=>{
  assert.equal(await page.title(),'Galaxy Remote 2.0');
  assert.equal(await page.locator('meta[name="application-name"]').getAttribute('content'),'Galaxy Remote 2.0');
  assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'),'Galaxy Remote 2.0');
  for(const [path,mime] of [['/favicon.svg?v=2','image/svg+xml'],['/favicon.ico?v=2','image/'],['/brand/icon-180.png','image/png'],['/manifest.webmanifest?v=2','manifest']]){
   const response=await page.request.get(base+path);assert.equal(response.status(),200);assert.ok(response.headers()['content-type'].includes(mime),response.headers()['content-type']);
  }
  const manifest=await (await page.request.get(base+'/manifest.webmanifest')).json();assert.equal(manifest.name,'Galaxy Remote 2.0');assert.equal(manifest.short_name,'Galaxy Remote');
  for(const icon of manifest.icons){assert.equal((await page.request.get(base+icon.src)).status(),200);}
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'),'/brand/icon-180.png');
 });
 await screenshot('01-devices-1400-dark');
 await check('pairing error, retry, expiry, keyboard focus trap and Escape return',async()=>{
  state.pairError=true;await page.getByRole('button',{name:'+ 새 기기 등록'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('alert').waitFor();await screenshot('02-pair-error');
  state.pairError=false;state.expired=true;await dialog.getByRole('button',{name:'새 코드',exact:true}).click();await dialog.getByText('코드가 만료되었습니다.',{exact:false}).waitFor();
  state.expired=false;await dialog.getByRole('button',{name:'새 코드',exact:true}).click();await dialog.getByText('123 456').waitFor();
  await dialog.getByRole('button',{name:'닫기',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'등록됐는지 확인');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'닫기');
  await screenshot('03-pair-code');await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.match(await page.evaluate(()=>document.activeElement.textContent),/새 기기 등록/);
 });
 await check('request / response / consent / negotiation and no premature connected state',async()=>{
  state.sessionState='requested';await page.getByRole('button',{name:'연결 시작',exact:true}).first().click();await page.locator('.connection-pill').filter({hasText:'기기 응답 대기'}).waitFor();
  state.sessionState='consent_pending';await page.locator('.connection-pill').filter({hasText:'화면 공유 승인 대기'}).waitFor();await screenshot('04-consent');
  state.sessionState='answer_ready';await page.waitForFunction(()=>window.__control?.readyState==='open');
  assert.equal(await page.locator('.connection-pill').textContent(),'WebRTC 협상 중');
  await page.evaluate(()=>{window.__peer.connectionState='connected';window.__peer.onconnectionstatechange();});await page.locator('.connection-pill').filter({hasText:'연결됨'}).waitFor();
 });
 await check('unknown stats, read-only panel OFF safety, collapsible panels keep peer',async()=>{
  await page.getByText('스트리밍 통계',{exact:true}).click();await page.getByLabel('연결 정보').waitFor();assert.match(await page.getByLabel('연결 정보').innerText(),/네트워크 RTT\n확인 불가/);
  await page.getByText('화면 OFF 실험 · 미검증',{exact:true}).click();const safety=page.locator('.safety-info');assert.equal(await safety.getByRole('button').count(),0);assert.match(await safety.innerText(),/외부 복구 경로/);
  await page.getByRole('button',{name:'패널 숨김',exact:true}).click();assert.equal(await controls.isVisible(),false);await page.getByRole('button',{name:'패널 열기',exact:true}).click();assert.equal(await page.evaluate(()=>window.__peers),1);
 });
 await check('marker drag + keyboard coordinates, duplicate key / invalid coordinate and edit input isolation',async()=>{
  await controls.getByRole('button',{name:'키 매핑 편집',exact:true}).click();
  const marker=page.getByRole('button',{name:'KeyF 위치 이동',exact:true});await marker.scrollIntoViewIfNeeded();const b=await marker.boundingBox();const before=await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame'||m.type==='tap'||m.type==='swipe').length);
  const old=Number(await controls.getByLabel('매핑 X 좌표').inputValue());await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2-30,b.y+b.height/2-40,{steps:5});await page.mouse.up();
  assert.ok(Number(await controls.getByLabel('매핑 X 좌표').inputValue())<old);
  await marker.focus();const x=Number(await controls.getByLabel('매핑 X 좌표').inputValue());await page.keyboard.press('ArrowRight');assert.ok(Math.abs(Number(await controls.getByLabel('매핑 X 좌표').inputValue())-x-.01)<1e-6);
  assert.equal(await page.evaluate(()=>window.__sent.filter(m=>m.type==='pointerFrame'||m.type==='tap'||m.type==='swipe').length),before);
  await controls.getByLabel('매핑 키 할당').focus();await page.keyboard.press('e');await controls.getByRole('status').filter({hasText:'중복 키 KeyE'}).waitFor();assert.equal(await controls.getByLabel('매핑 키 할당').inputValue(),'KeyF');
  await controls.getByLabel('매핑 X 좌표').fill('2');await controls.getByRole('status').filter({hasText:'좌표는 0부터 1'}).waitFor();assert.ok(Number(await controls.getByLabel('매핑 X 좌표').inputValue())<=1);
  await controls.getByLabel('표시 확대',{exact:false}).fill('1.5');
  await marker.scrollIntoViewIfNeeded();const zoomed=await marker.boundingBox();const video=await page.getByLabel('연결된 휴대폰 화면').boundingBox();const oldZoomed=Number(await controls.getByLabel('매핑 X 좌표').inputValue());
  await page.mouse.move(zoomed.x+zoomed.width/2,zoomed.y+zoomed.height/2);await page.mouse.down();await page.mouse.move(zoomed.x+zoomed.width/2-20,zoomed.y+zoomed.height/2);await page.mouse.up();assert.ok(Math.abs(Number(await controls.getByLabel('매핑 X 좌표').inputValue())-(oldZoomed-20/video.width))<.015);
  await controls.getByRole('button',{name:'창에 맞춤',exact:true}).click();await page.evaluate(()=>{window.__canvas.width=800;window.__canvas.height=360;window.__canvas.getContext('2d').fillRect(0,0,800,360);});
  await page.waitForFunction(()=>document.querySelector('.phone-view')?.classList.contains('is-landscape'));await marker.focus();const rotated=Number(await controls.getByLabel('매핑 X 좌표').inputValue());await page.keyboard.press('ArrowLeft');assert.ok(Math.abs(Number(await controls.getByLabel('매핑 X 좌표').inputValue())-rotated+.01)<1e-6);
  await page.evaluate(()=>{window.__canvas.width=360;window.__canvas.height=800;const ctx=window.__canvas.getContext('2d');ctx.fillStyle='#142233';ctx.fillRect(0,0,360,800);ctx.fillStyle='#e3edf7';ctx.font='16px sans-serif';ctx.fillText('LOCAL UI FIXTURE',25,50);ctx.font='12px sans-serif';ctx.fillStyle='#67d8ca';ctx.fillText('SIMULATED · NO ANDROID DEVICE',25,80);ctx.strokeStyle='#304158';for(let y=140;y<760;y+=100){ctx.strokeRect(25,y,310,70);ctx.fillStyle='#a5b5c8';ctx.fillText('Browser test content',40,y+40);}});
  await page.waitForFunction(()=>document.querySelector('.phone-view')?.classList.contains('is-portrait'));
  await screenshot('05-mapping-editor');await controls.getByRole('button',{name:'편집 종료 · 플레이'}).click();await controls.getByRole('button',{name:'매핑 숨김',exact:true}).click();assert.equal(await page.locator('.interaction-overlay').count(),0);
 });
 await check('all requested responsive sizes, modes, no overflow, light/dark and reduced motion',async()=>{
  await controls.locator('details').filter({has:page.getByText('프로필 · 화질 · 도움말',{exact:true})}).evaluate(el=>el.open=false);
  const sizes=[[1920,1080],[1440,900],[1280,720],[1024,768],[390,844]];
  for(const [width,height] of sizes){
   await page.setViewportSize({width,height});
   for(const mode of ['게임','소설','웹툰']){
    await page.getByRole('group',{name:'빠른 모드 전환'}).getByRole('button',{name:mode,exact:true}).click();
    await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector(".control-rail").scrollTop=0;});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${mode}: horizontal overflow`);
    const v=await page.getByLabel('연결된 휴대폰 화면').boundingBox();assert.ok(v.width>100&&v.height>200,`${width} ${mode}: visible player`);
    await screenshot(`06-${width}x${height}-${mode==='게임'?'game':mode==='소설'?'novel':'webtoon'}-dark`);
   }
  }
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'라이트 테마로 변경'}).click();await screenshot('07-light-1440');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);assert.equal(await page.locator('.card-heading').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.getByRole('button',{name:'다크 테마로 변경'}).click();
  assert.equal(await page.evaluate(()=>window.__peers),1);
 });
 await check('disconnect confirmation cancels / confirms, reconnect UI and fullscreen failure',async()=>{
  await page.getByRole('button',{name:'전체화면',exact:true}).evaluate(()=>{Element.prototype.requestFullscreen=()=>Promise.reject(new Error('blocked by test'));});
  await page.getByRole('button',{name:'전체화면',exact:true}).click();await page.getByRole('status').filter({hasText:'브라우저가 전체화면 전환'}).waitFor();
  await page.evaluate(()=>{window.__peer.connectionState='disconnected';window.__peer.onconnectionstatechange();});await page.locator('.connection-pill').filter({hasText:'재연결 중'}).waitFor();
  await page.evaluate(()=>{window.__peer.connectionState='connected';window.__peer.onconnectionstatechange();});await page.locator('.connection-pill').filter({hasText:'연결됨'}).waitFor();
  await page.getByRole('button',{name:'종료',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'취소',exact:true}).click();assert.equal(await page.evaluate(()=>window.__peer.connectionState),'connected');
  await page.getByRole('button',{name:'종료',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'연결 해제',exact:true}).click();await page.locator('.connection-pill').filter({hasText:'연결 종료'}).waitFor();
 });
 await check('offline, unknown device, API/session expiry, no devices and recovery actions',async()=>{
  state.offline=true;await page.reload();await page.getByRole('heading',{name:'Browser test phone',exact:true}).waitFor();await page.getByRole('button',{name:'연결 시작',exact:true}).first().click();await page.locator('.connection-pill').filter({hasText:'오류'}).waitFor();await screenshot('08-offline');
  state.offline=false;state.unknownPresence=true;await page.reload();await page.getByText('상태 확인 불가 · 게임과 독서를 하나의 공간에서',{exact:true}).waitFor();
  state.deviceError=401;await page.reload();await page.getByRole('alert').filter({hasText:'로그인이 만료'}).waitFor();await screenshot('09-login-expired');
  state.deviceError=null;state.noDevices=true;await page.getByRole('button',{name:'기기 목록 다시 시도',exact:true}).click();await page.getByRole('heading',{name:'나의 기기',exact:true}).waitFor();await screenshot('10-empty-devices');
 });
 assert.deepEqual(errors,[]);
 console.log('PASS stage 5: local Chromium UI/brand checks. Device behavior and production OAuth UNVERIFIED.');
} finally {await browser.close();}

await check('guest login and small-size icons render in real Chromium',async()=>{
 const guest=await createBrowserFixture({guest:true});try{
  await guest.page.goto(guest.base);await guest.page.getByRole('link',{name:'로그인하여 연결',exact:true}).waitFor();await guest.page.screenshot({path:`${output}/11-guest.png`,fullPage:true});
  assert.ok((await guest.page.locator('.phone-view').boundingBox()).height>200);
  assert.match(await guest.page.getByRole('link',{name:'로그인하여 연결',exact:true}).getAttribute('href'),/signin-with-chatgpt/);
  const icons=await guest.context.newPage();await icons.goto(guest.base+"/manifest.webmanifest");await icons.setContent(`<html><body style="margin:0;background:#f1f5f9;font:14px sans-serif;padding:32px"><h1>Galaxy Remote 2.0 — asset rendering check</h1><p>True size 16 / 32 / 48 / 192 / 512. Round masks are browser previews, not a Galaxy launcher.</p><div style="display:flex;align-items:center;gap:32px">${[16,32,48,192,512].map(n=>`<figure><img src="${guest.base}/brand/icon-${n}.png" width="${n}" height="${n}"><figcaption>${n}px</figcaption></figure>`).join('')}</div><div style="display:flex;gap:24px;padding:32px;background:#111c2a"><img src="${guest.base}/brand/icon-192.png" width="120" style="border-radius:50%"><img src="${guest.base}/brand/icon-192.png" width="120" style="border-radius:25%"><img src="${guest.base}/brand/maskable-512.png" width="120" style="border-radius:50%"></div></body></html>`);
  await icons.waitForFunction(()=>document.images.length===8&&[...document.images].every(i=>i.complete&&i.naturalWidth>0));await icons.screenshot({path:`${output}/12-brand-sizes-masks.png`,fullPage:true});
 }finally{await guest.browser.close();}
});

await check('version 1 settings survive personal/public switching; quota errors never claim saved',async()=>{
 const old=JSON.parse((await import('node:fs')).readFileSync(new URL('../tests/fixtures/interaction-v1-stage4.json',import.meta.url),'utf8'));
 const fixture=await createBrowserFixture();const {page,base}=fixture;const key='gr-interaction:v1:onboarding%40local.test:test-device';
 try{
  await page.addInitScript(({old,key})=>{localStorage.setItem('galaxy-remote-pc-mode','personal');localStorage.setItem(key,JSON.stringify(old));},{old,key});
  await page.goto(base);const c=page.getByLabel('모드별 조작 설정');await c.getByLabel('표시 확대',{exact:false}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[aria-label="사용 모드"] [aria-pressed=true]')?.textContent==='웹툰');assert.equal(await c.getByLabel('표시 확대',{exact:false}).inputValue(),'1.4');
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'공용 PC',exact:false}).click();await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
  await c.getByRole('button',{name:'웹툰',exact:true}).click();await c.getByLabel('표시 확대',{exact:false}).fill('1.9');
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).profiles.find(p=>p.mode==='webtoon').zoom,key),1.4);
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'개인 PC',exact:false}).click();await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="모드별 조작 설정"] input[type=range][min="0.5"]')?.value==='1.4');
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).profiles.find(p=>p.mode==='game').bindings[0].x,key),.63);
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('gr-interaction:'))throw new DOMException('Quota exceeded','QuotaExceededError');return original.call(this,k,v);};});
  await c.getByLabel('표시 확대',{exact:false}).fill('1.6');
  await c.getByRole('button',{name:'프로필 저장',exact:true}).click();await c.getByRole('alert').filter({hasText:'저장 실패'}).waitFor();assert.equal(await c.getByLabel('표시 확대',{exact:false}).inputValue(),'1.6');assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).profiles.find(p=>p.mode==='webtoon').zoom,key),1.4);
  await page.screenshot({path:`${output}/13-storage-failure.png`,fullPage:true});assert.deepEqual(fixture.errors,[]);
 }finally{await fixture.browser.close();}
});
await check('corrupt stored profile remains intact until explicit replacement',async()=>{
 const fixture=await createBrowserFixture();const {page,base}=fixture;const key='gr-interaction:v1:onboarding%40local.test:test-device';
 try{
  await page.addInitScript(key=>{localStorage.setItem('galaxy-remote-pc-mode','personal');localStorage.setItem(key,'{broken-profile');},key);
  await page.goto(base);await page.getByRole('alert').filter({hasText:'저장 프로필이 손상'}).waitFor();assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'{broken-profile');
  await page.getByRole('group',{name:'빠른 모드 전환'}).getByRole('button',{name:'소설',exact:true}).click();await page.waitForTimeout(100);assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'{broken-profile');assert.deepEqual(fixture.errors,[]);
 }finally{await fixture.browser.close();}
});
