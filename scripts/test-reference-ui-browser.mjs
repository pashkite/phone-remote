// Real Chromium UI, local simulated phone/signaling. Never a Galaxy success claim.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createBrowserFixture} from './browser-fixture.mjs';

const output=process.env.REFERENCE_UI_OUTPUT??'outputs/reference-ui';
mkdirSync(output,{recursive:true});
const f=await createBrowserFixture({viewport:{width:1440,height:900}});
const {page,base,errors,state}=f;
const results=[];
async function check(name,run){await run();results.push({name,status:'PASS'});console.log('PASS',name);}
async function capture(name){await page.screenshot({path:`${output}/${name}.png`,fullPage:true});}
try {
  await page.goto(base);
  await page.getByRole('heading',{name:'Browser test phone',exact:true}).waitFor();
  const nav=page.getByRole('navigation',{name:'기본 탐색'});
  await check('real API device cards, empty video, navigation, registration and focus return',async()=>{
    assert.equal(await page.locator('.device-card').count(),1);
    assert.match(await page.locator('.device-card').innerText(),/Browser test phone/);
    assert.doesNotMatch(await page.locator('.device-panel').innerText(),/Galaxy S24|Tab S9/);
    assert.equal(await page.locator('video').evaluate(v=>v.srcObject),null);
    assert.match(await page.locator('.session-identity').innerText(),/연결 경로 확인 불가/);
    await nav.getByRole('button',{name:'내 기기',exact:true}).click();
    await page.getByRole('dialog',{name:'내 기기',exact:true}).waitFor();
    assert.equal(await nav.getByRole('button',{name:'내 기기',exact:true}).getAttribute('aria-current'),'page');
    await capture('devices-dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'기기 추가',exact:true}).click();
    await page.getByRole('dialog').getByText('123 456').waitFor();
    await capture('pair-dialog');await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'기기 추가');
    await capture('waiting-1440-dark');
  });
  await check('live navigation commands and capability-gated tools',async()=>{
    await page.getByRole('button',{name:'연결 시작',exact:true}).first().click();
    await page.locator('.connection-pill').filter({hasText:'연결됨'}).waitFor();
    for (const [label,command] of [['Android 홈','home'],['Android 뒤로','back'],['Android 최근 앱','recents']]) {
      await page.getByRole('button',{name:label,exact:true}).click();
      await page.waitForFunction(command=>window.__sent.some(m=>m.type==='global'&&m.action===command),command);
    }
    const tools=page.locator('.remote-tools');
    await tools.getByText('양방향 클립보드',{exact:true}).click();
    assert.equal(await tools.getByRole('button',{name:'텍스트 보내기',exact:true}).isDisabled(),true);
    await tools.getByText('파일 전송 (최대 100MiB)',{exact:true}).click();
    assert.equal(await tools.locator('input[type=file]').isDisabled(),true);
    assert.match(await tools.innerText(),/연결 또는 앱 지원이 필요/);
    await page.evaluate(()=>{
      window.__filesSent=[];
      const peer=window.__peer, original=peer.createDataChannel.bind(peer);
      peer.createDataChannel=(name,...args)=>{
        if(name!=='files')return original(name,...args);
        const channel={readyState:'open',bufferedAmount:0,send(text){window.__filesSent.push(JSON.parse(text));},close(){this.readyState='closed';}};
        return channel;
      };
      window.__control.onmessage({data:JSON.stringify({type:'capabilities',v:1,features:['commandAck','liveTouch','lowLatencyInput','multiTouchExperimental','quality720','files','clipboard','diagnostics','standby']})});
    });
    await tools.getByLabel('휴대폰으로 보낼 텍스트').fill('LOCAL UI CLIPBOARD CHECK');
    await tools.getByRole('button',{name:'텍스트 보내기',exact:true}).click();
    await page.waitForFunction(()=>window.__sent.some(m=>m.type==='clipboardSet'&&m.text==='LOCAL UI CLIPBOARD CHECK'));
    await tools.locator('input[type=file]').setInputFiles({name:'local-ui-check.txt',mimeType:'text/plain',buffer:Buffer.from('LOCAL UI FILE OFFER ONLY')});
    await page.waitForFunction(()=>window.__filesSent.some(m=>m.type==='offer'&&m.name==='local-ui-check.txt'));
    await tools.getByRole('button',{name:'전송 취소',exact:true}).click();
    await page.waitForFunction(()=>window.__filesSent.some(m=>m.type==='cancel'));
    await capture('tools-actions');
    // The offer/cancel are local transport fixtures; no real Android file approval occurred.
    await tools.locator('details[open]').evaluateAll(list=>list.forEach(el=>el.open=false));
  });
  await check('fit/zoom, manual quality, theme and mode changes retain the same peer and video',async()=>{
    const controls=page.getByLabel('모드별 조작 설정');
    await page.locator('.display-settings>summary').click();
    await page.getByLabel('화면 해상도',{exact:true}).selectOption('720');
    await page.getByLabel('화면 프레임',{exact:true}).selectOption('60');
    const quality=await page.evaluate(()=>window.__sent.filter(m=>m.type==='quality').length);
    await page.getByRole('button',{name:'화면 확대',exact:true}).click();
    assert.equal(await controls.getByLabel('표시 확대',{exact:false}).inputValue(),'1.25');
    await page.getByRole('button',{name:'화면 맞춤',exact:true}).click();
    assert.equal(await controls.getByLabel('표시 확대',{exact:false}).inputValue(),'1');
    await page.evaluate(()=>window.__retainedVideo=document.querySelector('.phone-view video'));
    await page.locator('.inspector-section').evaluate(el=>el.open=false);
    await page.locator('.display-settings').evaluate(el=>el.open=false);
    const sizes=[[1920,1080],[1440,900],[1280,720],[1024,768],[390,844]];
    for(const theme of ['dark','light']){
      if(theme==='light')await page.getByRole('button',{name:'라이트 테마로 변경'}).click();
      for(const [width,height] of sizes){
        await page.setViewportSize({width,height});
        for(const [mode,label] of [['game','게임'],['novel','소설'],['webtoon','웹툰']]){
          await page.getByRole('group',{name:'빠른 모드 전환'}).getByRole('button',{name:label,exact:true}).click();
          await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.control-rail').scrollTop=0;});
          assert.equal(await page.evaluate(()=>document.querySelector('.phone-view video')===window.__retainedVideo),true);
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} ${mode} ${theme}: overflow`);
          const video=await page.getByLabel('연결된 휴대폰 화면',{exact:true}).boundingBox();
          assert.ok(video.width>100&&video.height>200,`${width} ${mode}: video size`);
          for(const name of ['원격 제어','내 기기','설정'])assert.equal(await nav.getByRole('button',{name,exact:true}).count(),1);
          await capture(`${width}x${height}-${mode}-${theme}`);
        }
      }
    }
    assert.equal(await page.evaluate(()=>window.__peers),1);
    assert.equal(await page.evaluate(()=>window.__sent.filter(m=>m.type==='quality').length),quality);
    assert.equal(await page.getByLabel('화면 해상도',{exact:true}).inputValue(),'720');
    assert.equal(await page.getByLabel('화면 프레임',{exact:true}).inputValue(),'60');
  });
  await check('small-screen device drawer, settings, disconnect and honest unknown states',async()=>{
    const drawer=page.getByRole('button',{name:'Browser test phone',exact:false}).filter({has:page.locator('svg')});
    await page.locator('.device-panel-toggle').click();
    await page.getByRole('button',{name:'기기 추가',exact:true}).waitFor();
    assert.ok(await drawer.count()>0);
    await nav.getByRole('button',{name:'설정',exact:true}).click();
    await page.getByRole('dialog').getByText('테스트 연결 정보',{exact:true}).click();
    await page.getByRole('dialog').getByText('웹·시그널링 주소:',{exact:false}).waitFor();
    await capture('mobile-settings');await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'종료',exact:true}).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'연결 해제',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__peer.connectionState),'closed');
    state.noDevices=true;await page.reload();
    await page.getByRole('heading',{name:'나의 기기',exact:true}).waitFor();
    assert.equal(await page.locator('.device-card').count(),0);
    assert.match(await page.locator('.player-title').innerText(),/FPS 확인 불가/);
    assert.match(await page.locator('.session-identity').innerText(),/연결 경로 확인 불가/);
    assert.equal(await page.locator('video').evaluate(v=>v.srcObject),null);
    await capture('empty-mobile-light');
  });
  assert.deepEqual(errors,[]);
} finally {
  writeFileSync(`${output}/results.json`,JSON.stringify({results,physicalDeviceVerified:false,transport:'local simulation',consolePageErrors:errors},null,2)+'\n');
  await f.browser.close();
}
