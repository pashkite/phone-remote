import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'remote-tests-'));
for (const name of ['protocol','diagnostics','media','files','streaming','client']) {
 const code=ts.transpileModule(fs.readFileSync(new URL(`../lib/remote/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from "\.\/(\w+)"/g,'from "./$1.mjs"');
 fs.writeFileSync(path.join(tmp,`${name}.mjs`),code);
}
const {encodeChunk,decodeChunk,sha256,MAX_FILE_SIZE}=await import(pathToFileURL(path.join(tmp,'protocol.mjs')));
const {Diagnostics}=await import(pathToFileURL(path.join(tmp,'diagnostics.mjs')));
const {RemoteClient}=await import(pathToFileURL(path.join(tmp,'client.mjs')));
const {FileTransfer}=await import(pathToFileURL(path.join(tmp,'files.mjs')));
class Channel {
 readyState='open';bufferedAmount=0;sent=[];onmessage=null;
 send(data){this.sent.push(data);}
 message(data){this.onmessage?.({data:typeof data==='object'&&!(data instanceof ArrayBuffer)?JSON.stringify(data):data});}
}
const tick=()=>new Promise(r=>setTimeout(r,15));
const id='6b6f61b2-6251-4fc5-92bc-ae2207c5f82a';
test('binary chunks preserve UUID, absolute byte offset and all byte values',()=>{
 const bytes=Uint8Array.from({length:16384},(_,i)=>i%256).buffer;
 const result=decodeChunk(encodeChunk(id,16384,bytes));
 assert.equal(result.id,id);assert.equal(result.offset,16384);assert.deepEqual(result.bytes,bytes);
 assert.throws(()=>decodeChunk(new ArrayBuffer(19)));assert.throws(()=>encodeChunk(id,MAX_FILE_SIZE+1,bytes));
});
test('diagnostics reject payloads, tokens, filenames and IPs',()=>{
 const logs=new Diagnostics();for(let i=0;i<600;i++)logs.record('command',{status:'completed',token:'secret',text:'password',filename:'private.txt',path:'192.168.1.1:5000'});
 const output=logs.export();assert.equal(JSON.parse(output).events.length,500);assert.doesNotMatch(output,/secret|password|private|192\.168/);
});
test('old app uses original commands; new app gets IDs and increasing sequence; acknowledgements are tracked',()=>{
 const control=new Channel();let opened=0;const peer={createDataChannel(){opened++;return new Channel();}};
 const client=new RemoteClient(control,peer,()=>null,()=>null);let snapshot;client.subscribe(s=>snapshot=s);
 client.send({type:'global',action:'home'});assert.equal(opened,0);assert.deepEqual(JSON.parse(control.sent[0]),{type:'global',action:'home'});
 control.message({type:'capabilities',v:1,features:['commandAck','files','pcmAudio']});assert.equal(opened,2);
 control.message({type:'capabilities',v:1,features:['commandAck','files','pcmAudio']});assert.equal(opened,2);
 client.send({type:'text',value:'한글🙂\nabc'});const m=JSON.parse(control.sent.at(-1));assert.equal(m.v,1);assert.equal(m.seq,1);assert.match(m.id,/^[a-f0-9-]{36}$/);
 control.message({type:'ack',v:1,id:m.id,status:'received'});assert.match(snapshot.result,/수신/);
 control.message({type:'ack',v:1,id:m.id,status:'completed'});assert.match(snapshot.result,/처리 완료/);
 assert.doesNotMatch(client.diagnostics.export(),/한글|abc/);client.close();
});
test('receiving requires approval and detects file corruption before download',async t=>{
 const channel=new Channel();let offer;let status;const files=new FileTransfer(channel,s=>status=s,o=>offer=o);t.after(()=>files.close());
 const payload=new TextEncoder().encode('한글🙂\nbytes').buffer;
 channel.message({v:1,type:'offer',id,name:'../../test.txt',size:payload.byteLength,hash:await sha256(payload)});await tick();assert.ok(offer);assert.ok(!offer.name.includes('/'));assert.equal(channel.sent.length,0);
 files.accept();const bad=payload.slice(0);new Uint8Array(bad)[0]^=1;
 channel.message(encodeChunk(id,0,bad));channel.message({v:1,type:'end',id});
 // SHA-256 completes asynchronously; a fixed 15ms sleep races under parallel build load.
 const deadline=performance.now()+2000;while(!status?.includes('중단')&&performance.now()<deadline)await tick();
 assert.match(status,/중단/);assert.equal(JSON.parse(channel.sent.at(-1)).type,'cancel');files.close();
});
test('oversized offers, out-of-order data and cancelled old chunks are rejected',async()=>{
 const channel=new Channel();let status;const files=new FileTransfer(channel,s=>status=s,()=>{});
 channel.message({v:1,type:'offer',id,name:'file',size:MAX_FILE_SIZE+1,hash:'a'.repeat(64)});await tick();assert.match(status,/중단/);
 channel.message({v:1,type:'offer',id,name:'file',size:5,hash:'a'.repeat(64)});await tick();files.accept();channel.message(encodeChunk(id,2,new ArrayBuffer(1)));await tick();assert.match(status,/중단/);
 files.cancel();channel.message(encodeChunk(id,0,new ArrayBuffer(1)));await tick();files.close();
});
test('approved transfers save byte-identical files and advance the queue',async()=>{
 const downloads=[];globalThis.window={setTimeout(){return 0;}};
 globalThis.document={createElement(){return {href:'',download:'',click(){downloads.push({url:this.href,name:this.download});}};}};
 const a=new Channel(),b=new Channel();
 a.send=data=>{a.sent.push(data);queueMicrotask(()=>b.message(data));};b.send=data=>{b.sent.push(data);queueMicrotask(()=>a.message(data));};
 let completed=0;
 const sender=new FileTransfer(a,s=>{if(s.includes('저장을 완료'))completed++;},()=>{});
 const receiver=new FileTransfer(b,()=>{},offer=>{if(offer)receiver.accept();});
 const bytes=Uint8Array.from({length:70000},(_,i)=>i%251);
 sender.enqueue([new File([bytes],'한글🙂.bin'),new File(['second'],'second.txt')]);
 for(let i=0;i<80&&completed<2;i++)await tick();
 assert.equal(completed,2);assert.equal(downloads.length,2);assert.equal(downloads[0].name,'한글🙂.bin');
 assert.deepEqual(new Uint8Array(await (await fetch(downloads[0].url)).arrayBuffer()),bytes);
 assert.equal(await (await fetch(downloads[1].url)).text(),'second');
 for(const item of downloads)URL.revokeObjectURL(item.url);sender.close();receiver.close();
});
test('command timeout reports uncertainty instead of successful execution',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const channel=new Channel();const client=new RemoteClient(channel,{createDataChannel(){return new Channel();}},()=>null,()=>null);let state;client.subscribe(s=>state=s);
 channel.message({type:'capabilities',v:1,features:['commandAck']});client.send({type:'global',action:'lock'});
 t.mock.timers.tick(6001);assert.match(state.result,/시간 초과/);assert.doesNotMatch(state.result,/완료/);client.close();
});
test('recording streams chunks to the chosen file and finalizes on disconnect',async t=>{
 const {ScreenRecording}=await import(pathToFileURL(path.join(tmp,'media.mjs')));
 const oldRecorder=globalThis.MediaRecorder,oldWindow=globalThis.window;t.after(()=>{globalThis.MediaRecorder=oldRecorder;globalThis.window=oldWindow;});
 const recorders=[];let closed=false;const parts=[];let message='';
 globalThis.window={showSaveFilePicker:async()=>({createWritable:async()=>({write:async data=>parts.push(await data.text()),close:async()=>{closed=true;},abort:async()=>{}})})};
 globalThis.MediaRecorder=class {static isTypeSupported(){return true;}state='inactive';constructor(){recorders.push(this);}start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}pause(){this.state='paused';}resume(){this.state='recording';}};
 const recording=new ScreenRecording(m=>message=m);await recording.start({getVideoTracks:()=>[{readyState:'live'}]});const recorder=recorders[0];
 recorder.ondataavailable({data:new Blob(['first'])});recorder.ondataavailable({data:new Blob(['last'])});recording.stop();await tick();
 assert.deepEqual(parts,['first','last']);assert.equal(closed,true);assert.match(message,/저장했습니다/);
});
test('recording write failures never report a successful save',async t=>{
 const {ScreenRecording}=await import(pathToFileURL(path.join(tmp,'media.mjs')));
 const oldRecorder=globalThis.MediaRecorder,oldWindow=globalThis.window;t.after(()=>{globalThis.MediaRecorder=oldRecorder;globalThis.window=oldWindow;});
 const recorders=[];let message='';globalThis.window={showSaveFilePicker:async()=>({createWritable:async()=>({write:async()=>{throw new Error('disk full');},close:async()=>{},abort:async()=>{}})})};
 globalThis.MediaRecorder=class {static isTypeSupported(){return true;}state='inactive';constructor(){recorders.push(this);}start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}pause(){this.state='paused';}resume(){this.state='recording';}};
 const recording=new ScreenRecording(m=>message=m);await recording.start({getVideoTracks:()=>[{readyState:'live'}]});const recorder=recorders[0];recorder.ondataavailable({data:new Blob(['partial'])});await tick();
 assert.match(message,/오류/);assert.doesNotMatch(message,/저장했습니다/);
});

test('essential touch release gets bounded headroom even when move budget is full',()=>{
 const channel=new Channel();const client=new RemoteClient(channel,{},()=>null,()=>null);
 channel.message({type:'capabilities',v:1,features:['liveTouch']});channel.bufferedAmount=3000;
 assert.equal(client.sendTouch({phase:'move'}),false);assert.equal(client.sendTouch({phase:'up'}),true);
 assert.equal(client.sendTouch({phase:'cancel'}),true);channel.bufferedAmount=70000;
 assert.equal(client.sendTouch({phase:'up'}),false);client.close();
});
test('old app telemetry stays unknown, new telemetry expires at consumer and clears on close',()=>{
 const channel=new Channel();const client=new RemoteClient(channel,{},()=>null,()=>null);
 assert.equal(client.senderMetrics,null);channel.message({type:'streamMetrics',v:1,data:{captureFps:60,sendFps:30,encodeMs:2}});
 assert.equal(client.senderMetrics.sendFps,30);assert.equal(client.senderMetrics.hardwareEncoder,null);
 client.close();assert.equal(client.senderMetrics,null);
});

test('pointer frame transport requires a negotiated session and uses bounded move/release budgets',()=>{
 const channel=new Channel();const client=new RemoteClient(channel,{},()=>null,()=>null);
 const point={pointerId:'p1',phase:'down',x:.5,y:.5};assert.equal(client.sendPointerFrame([point]),false);
 channel.message({type:'capabilities',v:1,inputSessionId:id,features:['multiTouchExperimental']});
 assert.equal(client.sendPointerFrame([point]),true);const first=JSON.parse(channel.sent.at(-1));assert.equal(first.sessionId,id);assert.equal(first.pointerSeq,1);
 channel.bufferedAmount=3000;assert.equal(client.sendPointerFrame([{...point,phase:'move'}]),false);assert.equal(client.sendPointerFrame([{...point,phase:'up'}]),true);
 const second=JSON.parse(channel.sent.at(-1));assert.equal(second.pointerSeq,2);assert.equal(client.sendPointerFrame(Array(6).fill(point)),false);
 client.close();assert.equal(client.inputSessionId,null);
});
