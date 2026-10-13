import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'remote-tests-'));
for (const name of ['protocol','diagnostics','media','files','client']) {
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
 const control=new Channel(), files=new Channel(), audio=new Channel();
 const client=new RemoteClient(control,files,audio,()=>null,()=>null);let snapshot;client.subscribe(s=>snapshot=s);
 client.send({type:'global',action:'home'});assert.deepEqual(JSON.parse(control.sent[0]),{type:'global',action:'home'});
 control.message({type:'capabilities',v:1,features:['commandAck']});
 client.send({type:'text',value:'한글🙂\nabc'});const m=JSON.parse(control.sent.at(-1));assert.equal(m.v,1);assert.equal(m.seq,1);assert.match(m.id,/^[a-f0-9-]{36}$/);
 control.message({type:'ack',v:1,id:m.id,status:'received'});assert.match(snapshot.result,/수신/);
 control.message({type:'ack',v:1,id:m.id,status:'completed'});assert.match(snapshot.result,/처리 완료/);
 assert.doesNotMatch(client.diagnostics.export(),/한글|abc/);client.close();
});
test('receiving requires approval and detects file corruption before download',async()=>{
 const channel=new Channel();let offer;let status;const files=new FileTransfer(channel,s=>status=s,o=>offer=o);
 const payload=new TextEncoder().encode('한글🙂\nbytes').buffer;
 channel.message({v:1,type:'offer',id,name:'../../test.txt',size:payload.byteLength,hash:await sha256(payload)});await tick();assert.ok(offer);assert.ok(!offer.name.includes('/'));assert.equal(channel.sent.length,0);
 files.accept();const bad=payload.slice(0);new Uint8Array(bad)[0]^=1;
 channel.message(encodeChunk(id,0,bad));channel.message({v:1,type:'end',id});await tick();assert.match(status,/중단/);assert.equal(JSON.parse(channel.sent.at(-1)).type,'cancel');files.close();
});
test('oversized offers, out-of-order data and cancelled old chunks are rejected',async()=>{
 const channel=new Channel();let status;const files=new FileTransfer(channel,s=>status=s,()=>{});
 channel.message({v:1,type:'offer',id,name:'file',size:MAX_FILE_SIZE+1,hash:'a'.repeat(64)});await tick();assert.match(status,/중단/);
 channel.message({v:1,type:'offer',id,name:'file',size:5,hash:'a'.repeat(64)});await tick();files.accept();channel.message(encodeChunk(id,2,new ArrayBuffer(1)));await tick();assert.match(status,/중단/);
 files.cancel();channel.message(encodeChunk(id,0,new ArrayBuffer(1)));await tick();files.close();
});
