// Actual route handlers + Drizzle + local Miniflare D1. Auth headers are controlled fixtures.
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export async function apiHarness(){
 const root=process.cwd(),dir=await mkdtemp(path.join(root,'.sites-runtime/qa-api-'));
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("local QA")}}',d1Databases:['DB'],log:undefined});
 const db=await mf.getD1Database('DB');
 const context=new AsyncLocalStorage();globalThis.__qaApi={db,context};
 for(const file of ['0000_parallel_morlocks.sql','0001_shallow_hulk.sql','0002_dear_bastion.sql']){
  const sql=await readFile(path.join(root,'drizzle',file),'utf8');for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();
 }
 const names={buildInfo:'build-info',devices:'devices',removeDevice:'devices/[id]',createSession:'sessions',session:'sessions/[id]',offer:'sessions/[id]/offer',candidate:'sessions/[id]/candidate',pairStart:'pairing/start',pairComplete:'pairing/complete',deviceSession:'device/session',decision:'device/decision',answer:'device/answer',deviceCandidate:'device/candidate',lease:'device/lease',heartbeat:'device/heartbeat'};
 const contents=Object.entries(names).map(([name,p])=>`export * as ${name} from ${JSON.stringify(path.join(root,'app/api',p,'route.ts'))};`).join('\n');
 const outfile=path.join(dir,'routes.mjs');
 await build({stdin:{contents,resolveDir:root,loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'qa-runtime',setup(b){
  b.onResolve({filter:/^(next\/headers|next\/navigation|cloudflare:workers)$/},args=>({path:args.path,namespace:'qa'}));
  b.onLoad({filter:/.*/,namespace:'qa'},({path:p})=>({contents:p==='next/headers'?'export async function headers(){return globalThis.__qaApi.context.getStore();}':p==='next/navigation'?'export function redirect(path){throw new Error("redirect "+path);}':'export const env={get DB(){return globalThis.__qaApi.db;}};',loader:'js'}));
 }}]});
 const routes=await import(pathToFileURL(outfile));
 const call=(name,{method='POST',user='owner@local.test',token,deviceId,body,id,headers={}}={})=>{
  const h=new Headers({'content-type':'application/json',...headers});if(user)h.set('oai-authenticated-user-email',user);if(token)h.set('authorization',`Bearer ${token}`);if(deviceId)h.set('x-device-id',deviceId);
  const request=new Request('https://qa.local/api/'+names[name],{method,headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return context.run(h,()=>routes[name][method](request,{params:Promise.resolve({id})}));
 };
 return {db,call,async close(){delete globalThis.__qaApi;await mf.dispose();await rm(dir,{recursive:true,force:true});}};
}
