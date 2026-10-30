import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync(new URL('../lib/remote/connection-scope.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {ConnectionScope,boundedFetch}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('cancel aborts in-flight work and rejects responses from a noncompliant late fetch',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let finish;
 globalThis.fetch=()=>new Promise(resolve=>finish=resolve);const scope=new ConnectionScope();const request=scope.fetch('/local');scope.cancel();finish(new Response('late'));
 await assert.rejects(request,{name:'AbortError'});assert.equal(scope.active,false);assert.throws(()=>scope.check(),{name:'AbortError'});
});
test('request timeout is bounded and detaches its parent abort listener',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let aborted=false;
 globalThis.fetch=(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(init.signal.reason);},{once:true}));
 await assert.rejects(boundedFetch('/local',{},20),{name:'TimeoutError'});assert.equal(aborted,true);
});
test('a cancelled attempt cannot cancel a newer connection scope',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);globalThis.fetch=async()=>new Response('new');const first=new ConnectionScope(),next=new ConnectionScope();first.cancel();assert.equal(await (await next.fetch('/local')).text(),'new');assert.equal(next.active,true);next.cancel();
});
