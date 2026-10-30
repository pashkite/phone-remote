import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../lib/remote/streaming.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {VideoStatsSampler,AdaptiveQuality,EMPTY_VIDEO_METRICS,parseSenderMetrics,preferredCodecs,requestLowBuffer,QUALITY_PRESETS,needsVp8Fallback}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const sample=(n, overrides={})=>[
 {id:'transport',type:'transport',selectedCandidatePairId:'pair'},
 {id:'bad-pair',type:'candidate-pair',state:'succeeded',currentRoundTripTime:99},
 {id:'pair',type:'candidate-pair',state:'succeeded',currentRoundTripTime:.02,localCandidateId:'local',remoteCandidateId:'remote'},
 {id:'local',type:'local-candidate',candidateType:'host'}, {id:'remote',type:'remote-candidate',candidateType:'relay'},
 {id:'codec',type:'codec',mimeType:'video/VP8'},
 {id:'video',type:'inbound-rtp',kind:'video',codecId:'codec',frameWidth:1080,frameHeight:2400,bytesReceived:n*100000,framesDecoded:n*30,packetsReceived:n*99,packetsLost:n,totalDecodeTime:n*.03,jitterBufferDelay:n*.15,jitterBufferEmittedCount:n*30,framesDropped:n,...overrides}
];
test('metrics use selected pair, interval loss, codec, bitrate and per-frame delays',()=>{
 const s=new VideoStatsSampler();assert.equal(s.sample(sample(1),1000,0).bitrateKbps,null);
 const m=s.sample(sample(2),2000,20);
 assert.equal(m.latency,20);assert.equal(m.path,'turn');assert.equal(m.packetLoss,1);
 assert.equal(m.fps,30);assert.equal(m.bitrateKbps,800);assert.equal(m.decodeMs,1);assert.equal(m.jitterMs,5);
 assert.equal(m.codec,'video/VP8');assert.equal(m.dropped,1);assert.equal(m.bufferedBytes,20);
});
test('counter reset, new RTP stream, missing stats and background gaps remain unknown',()=>{
 const s=new VideoStatsSampler();s.sample(sample(10),1000,0);
 assert.equal(s.sample(sample(1),2000,0).packetLoss,null);
 assert.equal(s.sample(sample(2),12000,0).bitrateKbps,null);
 const changed=sample(3);changed.at(-1).id='new';assert.equal(s.sample(changed,13000,0).fps,null);
 assert.equal(s.sample([],14000,0).codec,null);
});
test('freeze requires elapsed time and resets when frames resume',()=>{
 const s=new VideoStatsSampler();s.sample(sample(1),1000,0);
 assert.equal(s.sample(sample(1),2000,0).stalled,false);
 s.sample(sample(1),3000,0);assert.equal(s.sample(sample(1),4000,0).stalled,true);
 assert.equal(s.sample(sample(2),5000,0).stalled,false);
});
test('auto degrades only after sustained trouble and respects minimum interval',()=>{
 const a=new AdaptiveQuality(), bad={...EMPTY_VIDEO_METRICS,latency:300,fps:30};
 assert.equal(a.update(bad,null,0,true),null);assert.equal(a.update(bad,null,1000,true),null);
 assert.equal(a.update(bad,null,2000,true).edge,720);
 for(let t=3000;t<12000;t+=1000)assert.equal(a.update(bad,null,t,true),null);
 assert.equal(a.update(bad,null,12000,true).edge,540);
});
test('auto restores only after 20 stable samples; no oscillation for missing/static data',()=>{
 const a=new AdaptiveQuality(), good={...EMPTY_VIDEO_METRICS,latency:20,fps:30,packetLoss:0};
 for(let t=0;t<19000;t+=1000)assert.equal(a.update(good,null,t,true),null);
 assert.equal(a.update(good,null,19000,true).fps,60);
 a.reset();const still={...good,fps:0,stalled:true,bitrateKbps:0};
 for(let t=0;t<30000;t+=1000)assert.equal(a.update(still,null,t,true),null);
});
test('thermal/encoder pressure and old clients select supported limits; stale telemetry is ignored',()=>{
 const a=new AdaptiveQuality(), good={...EMPTY_VIDEO_METRICS,latency:20,fps:30,packetLoss:0};
 const sender=parseSenderMetrics({thermal:3,encoderOverloaded:true},0);
 a.update(good,sender,0,false);a.update(good,sender,1000,false);
 assert.equal(a.update(good,sender,2000,false).edge,540);
 a.reset();assert.equal(a.update(good,sender,9000,true),null);
});
test('sender telemetry validates untrusted values and does not invent hardware status',()=>{
 const m=parseSenderMetrics({captureFps:Infinity,sendFps:-1,thermal:99,encoder:'codec\nsecret',hardwareEncoder:'yes'},0);
 assert.equal(m.captureFps,null);assert.equal(m.sendFps,null);assert.equal(m.thermal,null);assert.equal(m.hardwareEncoder,null);
 assert.equal(parseSenderMetrics(null,0),null);
});
test('VP8 remains baseline and H264 opt-in retains fallback',()=>{
 const codecs=[{mimeType:'video/H264'},{mimeType:'video/VP8'},{mimeType:'video/AV1'}];
 assert.deepEqual(preferredCodecs(codecs,false),[codecs[1]]);
 assert.deepEqual(preferredCodecs(codecs,true),[codecs[0],codecs[1]]);
 assert.deepEqual(preferredCodecs([codecs[1]],true),[codecs[1]]);
 assert.deepEqual(preferredCodecs([codecs[0]],true),[]);
});
test('unsupported low-buffer hints do not break negotiation',()=>{
 const receiver={set jitterBufferTarget(v){throw Error('unsupported')},playoutDelayHint:2};
 assert.doesNotThrow(()=>requestLowBuffer(receiver));assert.equal(receiver.playoutDelayHint,0);
 assert.equal(QUALITY_PRESETS.balanced.fps,30);assert.equal(QUALITY_PRESETS.stable.edge,720);
});

test('a failed H264 first-frame path falls back once, never on an already visible video',()=>{
 assert.equal(needsVp8Fallback(true,false,9999,0,0),false);
 assert.equal(needsVp8Fallback(true,false,10000,0,0),true);
 assert.equal(needsVp8Fallback(true,false,10000,1080,null),false);
 assert.equal(needsVp8Fallback(true,false,10000,0,1),false);
 assert.equal(needsVp8Fallback(true,true,10000,0,0),false);
 assert.equal(needsVp8Fallback(false,false,10000,0,0),false);
});
