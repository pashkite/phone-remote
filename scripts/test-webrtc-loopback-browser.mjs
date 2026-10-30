// Native browser WebRTC on loopback only. No Android, TURN or external signaling.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.INTERACTION_TEST_URL??'http://127.0.0.1:5175';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local QA only');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();await page.goto(base+'/manifest.webmanifest');
 const result=await page.evaluate(async()=>{
  const outcomes=[];
  for(const codec of ['video/VP8','video/H264']){
   const capabilities=RTCRtpSender.getCapabilities('video').codecs.filter(c=>c.mimeType.toLowerCase()===codec.toLowerCase());
   if(!capabilities.length){outcomes.push({codec,status:'UNSUPPORTED'});continue;}
   const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]});const pendingA=[],pendingB=[];
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');let frame=0;
   const draw=setInterval(()=>{ctx.fillStyle=frame++%2?'#142233':'#67d8ca';ctx.fillRect(0,0,320,180);ctx.fillStyle='#fff';ctx.font='24px sans-serif';ctx.fillText(`LOCAL FRAME ${frame}`,30,90);},33);
   const stream=canvas.captureStream(30),video=document.createElement('video');video.muted=true;video.autoplay=true;document.body.append(video);const channel=a.createDataChannel('control');let echoes=0;
   b.ondatachannel=e=>e.channel.onmessage=m=>e.channel.send(m.data);channel.onmessage=()=>echoes++;
   a.onicecandidate=e=>{if(e.candidate){if(b.remoteDescription)void b.addIceCandidate(e.candidate);else pendingB.push(e.candidate);}};
   b.onicecandidate=e=>{if(e.candidate){if(a.remoteDescription)void a.addIceCandidate(e.candidate);else pendingA.push(e.candidate);}};
   b.ontrack=e=>{video.srcObject=e.streams[0];void video.play();};
   try{
    const sender=a.addTrack(stream.getVideoTracks()[0],stream);const transceiver=a.getTransceivers()[0];transceiver.setCodecPreferences(capabilities);
    await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription);for(const c of pendingB)await b.addIceCandidate(c);
    await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription);for(const c of pendingA)await a.addIceCandidate(c);
    const until=async predicate=>{const deadline=performance.now()+15000;while(!predicate()){if(performance.now()>deadline)throw Error('Native loopback timeout: '+JSON.stringify({codec,a:a.connectionState,b:b.connectionState,iceA:a.iceConnectionState,iceB:b.iceConnectionState,channel:channel.readyState,videoWidth:video.videoWidth,readyState:video.readyState,frames:video.getVideoPlaybackQuality().totalVideoFrames,echoes,origin:location.origin,secure:isSecureContext,gatheringA:a.iceGatheringState,gatheringB:b.iceGatheringState,hasIce:a.localDescription?.sdp.includes('a=ice-ufrag'),mediaLines:(a.localDescription?.sdp.match(/^m=/gm)??[]).length,frame,native:RTCPeerConnection.toString().slice(0,90)}));await new Promise(r=>setTimeout(r,25));}};
    await until(()=>channel.readyState==='open'&&video.videoWidth>0);channel.send('local QA echo');await until(()=>echoes===1);await until(()=>video.getVideoPlaybackQuality().totalVideoFrames>=5);
    const parameters=sender.getParameters();parameters.encodings[0].maxFramerate=24;parameters.encodings[0].maxBitrate=1000000;await sender.setParameters(parameters);
    const stats=[...(await b.getStats()).values()];const inbound=stats.find(s=>s.type==='inbound-rtp'&&s.kind==='video');const selected=stats.find(s=>s.id===inbound?.codecId);
    outcomes.push({codec,status:'PASS',negotiatedCodec:selected?.mimeType??null,decodedFrames:inbound?.framesDecoded??null,width:video.videoWidth,height:video.videoHeight,echoes,senderLimitAccepted:true});
   }finally{clearInterval(draw);channel.close();a.close();b.close();stream.getTracks().forEach(t=>t.stop());video.srcObject=null;video.remove();}
   if(a.connectionState!=='closed'||b.connectionState!=='closed'||stream.getTracks().some(t=>t.readyState!=='ended'))throw Error('Native resources remained active');
  }
  return outcomes;
 });
 assert.equal(result.find(r=>r.codec==='video/VP8')?.status,'PASS');const output=process.env.QA_OUTPUT_DIR??'outputs/integration-qa';mkdirSync(output,{recursive:true});writeFileSync(`${output}/native-webrtc.json`,JSON.stringify({scope:'Native Chromium loopback. Android/Internet latency/60fps UNVERIFIED.',results:result},null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
