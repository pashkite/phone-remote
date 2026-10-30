// Local UI simulation. No production service or Android device.
export async function createBrowserFixture(options={}) {
const state=options.state??{};
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.INTERACTION_TEST_URL??'http://127.0.0.1:5175';
const target=new URL(base);if(!['localhost','127.0.0.1'].includes(target.hostname))throw Error('Local test server only');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:options.viewport??{width:1400,height:1000},extraHTTPHeaders:options.guest?{}:{'oai-authenticated-user-email':'onboarding@local.test'}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const sid='11111111-1111-4111-8111-111111111111';
await page.route('**/api/**',route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/api/devices'&&state.deviceError)return route.fulfill({status:state.deviceError,json:{error:'Test API failure'}});
 if(url.pathname==='/api/devices')return route.fulfill({json:{devices:state.noDevices?[]:[{id:'test-device',name:'Browser test phone',appVersion:'0.5.3',online:state.offline?false:true,lastSeenAt:state.unknownPresence?null:Date.now(),screenWidth:1080,screenHeight:2400}]}});
 if(url.pathname==='/api/pairing/start')return route.fulfill(state.pairError?{status:500,json:{error:'등록 코드 생성 실패: 다시 시도하세요.'}}:{json:{code:'123456',expiresAt:Date.now()+(state.expired?-1000:600000)}});
 if(url.pathname==='/api/build-info'&&state.buildHtml)return route.fulfill({contentType:'text/html',body:'<html>old site</html>'});
 if(url.pathname==='/api/build-info')return route.fulfill({json:{brand:'린로',englishName:'Linro',buildId:state.buildMismatch?'old-build':'linro-device-test-stage7',protocolVersion:1,signalingOrigin:url.origin,physicalDeviceVerified:false}});
 if(url.pathname==='/api/ice')return route.fulfill({json:{iceServers:[]}});
 if(url.pathname==='/api/sessions')return route.fulfill({status:201,json:{sessionId:sid}});
 if(url.pathname===`/api/sessions/${sid}`&&route.request().method()==='GET')return route.fulfill({json:{session:{state:state.sessionState??'answer_ready',answerType:state.sessionState&&state.sessionState!=='answer_ready'?null:'answer',answerSdp:state.sessionState&&state.sessionState!=='answer_ready'?null:'test-only'},candidates:[]}});
 return route.fulfill({json:{ok:true}});
});
await page.addInitScript(({sid,holdPeer})=>{
 window.__sent=[];window.__peers=0;window.__pad=null;
 Object.defineProperty(navigator,'getGamepads',{value:()=>window.__pad?[window.__pad]:[]});
 window.RTCPeerConnection=class{
  constructor(){window.__peers++;this.connectionState='new';this.localDescription=null;window.__peer=this;}
  addTransceiver(){return {receiver:{},setCodecPreferences(){}};}
  createDataChannel(){const channel={readyState:'connecting',bufferedAmount:0,send(text){const m=JSON.parse(text);window.__sent.push(m);if(m.id)setTimeout(()=>channel.onmessage?.({data:JSON.stringify({type:'ack',v:1,id:m.id,status:'completed'})}),0);},close(){this.readyState='closed';}};this.channel=channel;window.__control=channel;return channel;}
  async createOffer(){return {type:'offer',sdp:'test-only'};}
  async setLocalDescription(value){this.localDescription={...value,toJSON:()=>value};}
  async setRemoteDescription(){this.currentRemoteDescription={type:'answer'};setTimeout(()=>{
   if(this.connectionState==='closed')return;
   if(!holdPeer){this.connectionState='connected';this.onconnectionstatechange?.();}this.channel.readyState='open';this.channel.onopen?.();
   this.channel.onmessage?.({data:JSON.stringify({type:'capabilities',v:1,inputSessionId:sid,features:['commandAck','liveTouch','lowLatencyInput','multiTouchExperimental','quality720']})});
   const canvas=document.createElement('canvas');window.__canvas=canvas;canvas.width=360;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#142233';ctx.fillRect(0,0,360,800);ctx.fillStyle='white';ctx.font='16px sans-serif';ctx.fillText('LOCAL UI FIXTURE',25,50);ctx.font='12px sans-serif';ctx.fillStyle='#67d8ca';ctx.fillText('SIMULATED · NO ANDROID DEVICE',25,80);ctx.strokeStyle='#304158';for(let y=140;y<760;y+=100){ctx.strokeRect(25,y,310,70);ctx.fillStyle='#a5b5c8';ctx.fillText('Browser test content',40,y+40);};this.stream=canvas.captureStream(10);this.frameTimer=setInterval(()=>{if(this.connectionState==='closed')return;const c=canvas.getContext('2d');c.fillRect(0,canvas.height-1,1,1);},100);this.ontrack?.({streams:[this.stream],track:this.stream.getVideoTracks()[0]});
  },30);}
  async addIceCandidate(){}
  async getStats(){return new Map();}
  close(){this.connectionState='closed';clearInterval(this.frameTimer);this.stream?.getTracks().forEach(t=>t.stop());}
 };
},{sid,holdPeer:options.holdPeer??false});
return {browser,context,page,errors,sid,base,state};
}
