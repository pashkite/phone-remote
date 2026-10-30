import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {apiHarness} from './helpers/api-harness.mjs';
await mkdir('.sites-runtime',{recursive:true});
const oldOwner=process.env.OWNER_EMAIL;process.env.OWNER_EMAIL='owner@local.test';
const h=await apiHarness();const {db,call}=h;
test.after(async()=>{if(oldOwner===undefined)delete process.env.OWNER_EMAIL;else process.env.OWNER_EMAIL=oldOwner;await h.close();});
const hash=s=>createHash('sha256').update(s).digest('hex');
const now=Date.now();
async function device(id,owner='owner@local.test'){await db.prepare('INSERT INTO devices (id,owner_email,name,platform,app_version,token_hash,last_seen_at,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,owner,id,'android','0.5.3',hash('token-'+id),now,now).run();}
async function session(id,deviceId,owner,state='answer_ready',expiry=Date.now()+60000){await db.prepare('INSERT INTO remote_sessions(id,device_id,owner_email,state,offer_type,offer_sdp,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,deviceId,owner,state,'offer','local SDP',now,now,expiry).run();}
test('session DELETE cannot erase another owner’s ICE candidates',async()=>{
 await device('other','other@local.test');await session('foreign-session','other','other@local.test');
 await db.prepare('INSERT INTO remote_session_candidates(id,session_id,sender,candidate,created_at) VALUES(?,?,?,?,?)').bind('foreign-ice','foreign-session','device','test-only',now).run();
 const response=await call('session',{method:'DELETE',id:'foreign-session'});
 assert.equal(response.status,404);
 assert.equal((await call('session',{method:'GET',id:'foreign-session'})).status,404);assert.equal((await call('createSession',{body:{deviceId:'other'}})).status,404);assert.equal((await call('candidate',{id:'foreign-session',body:{candidate:'intrusion'}})).status,409);assert.equal((await call('removeDevice',{method:'DELETE',id:'other'})).status,404);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM remote_session_candidates WHERE id=?').bind('foreign-ice').first()).n,1);
});
test('malformed JSON field types fail as 400 instead of crashing handlers',async()=>{
 await device('malformed');
 for(const [name,options] of [['pairComplete',{body:{code:123456}}],['candidate',{id:'unknown',body:{candidate:{}}}],['deviceSession',{user:null,deviceId:'malformed',token:'token-malformed',body:{sessionId:123}}],['pairComplete',{body:{code:'111111',platform:{}}}]]){
  const result=await call(name,options);assert.ok(result.status>=400&&result.status<500,`${name} ${result.status}`);
 }
});
test('closed device decisions never claim approval/open/rejection success',async()=>{
 await device('closed-device');await session('closed-session','closed-device','owner@local.test','closed');
 for(const decision of ['opened','approve','reject','invalid'])assert.equal((await call('decision',{user:null,token:'token-closed-device',deviceId:'closed-device',body:{sessionId:'closed-session',decision}})).status,409);
});
test('parallel invalid pairing attempts cannot bypass the 20-attempt window',async()=>{
 const responses=await Promise.all(Array.from({length:25},()=>call('pairComplete',{user:null,headers:{'cf-connecting-ip':'203.0.113.56'},body:{code:'000000'}})));
 assert.equal(responses.filter(r=>r.status===429).length,5);
 const key='pair:'+hash('203.0.113.56|unknown');await db.prepare('UPDATE pairing_rate_limits SET window_started_at=? WHERE key=?').bind(Date.now()-600001,key).run();assert.equal((await call('pairComplete',{user:null,headers:{'cf-connecting-ip':'203.0.113.56'},body:{code:'000000'}})).status,410);assert.equal((await db.prepare('SELECT attempts FROM pairing_rate_limits WHERE key=?').bind(key).first()).attempts,1);
});
test('real handlers complete pairing, consent, SDP, ICE, live lease and revocation in local D1',async()=>{
 assert.equal((await call('devices',{method:'GET',user:null})).status,401);
 assert.equal((await call('devices',{method:'GET',user:'intruder@local.test'})).status,401);
 const code=await (await call('pairStart')).json();assert.match(code.code,/^\d{6}$/);
 const claimed=await Promise.all([1,2].map(()=>call('pairComplete',{user:null,headers:{'cf-connecting-ip':'203.0.113.88'},body:{code:code.code,name:'QA device',platform:'android',appVersion:'0.5.3'}})));
 assert.equal(claimed.filter(r=>r.status===201).length,1);assert.ok(claimed.some(r=>[409,410].includes(r.status)));
 const registration=await claimed.find(r=>r.status===201).json();const {deviceId,deviceToken}=registration;
 const deviceAuth={user:null,deviceId,token:deviceToken};
 const rows=await (await call('devices',{method:'GET'})).json();assert.doesNotMatch(JSON.stringify(rows),/deviceToken|tokenHash|token_hash/);
 const created=await (await call('createSession',{body:{deviceId}})).json();const id=created.sessionId;
 assert.equal((await call('offer',{id,body:{type:'offer',sdp:'local SDP offer'}})).status,200);
 assert.equal((await call('offer',{id,body:{type:'offer',sdp:'replay'}})).status,409);
 assert.equal((await call('deviceSession',{...deviceAuth,body:{sessionId:'foreign-session'}})).status,410);
 assert.equal((await call('decision',{...deviceAuth,body:{sessionId:id,decision:'opened'}})).status,200);
 assert.equal((await call('decision',{...deviceAuth,body:{sessionId:id,decision:'approve'}})).status,200);
 assert.equal((await call('candidate',{id,body:{candidate:'browser ICE'}})).status,201);
 assert.equal((await call('deviceCandidate',{...deviceAuth,body:{sessionId:id,candidate:'device ICE'}})).status,201);
 assert.equal((await call('answer',{...deviceAuth,body:{sessionId:id,type:'answer',sdp:'local SDP answer'}})).status,200);
 assert.equal((await call('answer',{...deviceAuth,body:{sessionId:id,type:'answer',sdp:'replay'}})).status,409);
 assert.equal((await (await call('session',{method:'GET',id})).json()).candidates[0].candidate,'device ICE');
 assert.equal((await (await call('deviceSession',{...deviceAuth,body:{sessionId:id}})).json()).candidates[0].candidate,'browser ICE');
 await db.prepare('UPDATE remote_sessions SET expires_at=0 WHERE id=?').bind(id).run();
 assert.equal((await call('session',{method:'GET',id})).status,410);assert.equal((await call('candidate',{id,body:{candidate:'expired'}})).status,409);
 assert.equal((await (await call('lease',{...deviceAuth,body:{sessionId:id}})).json()).active,true,'existing live lease is distinct from expired negotiation');
 assert.equal((await call('session',{method:'DELETE',id})).status,200);assert.equal((await (await call('lease',{...deviceAuth,body:{sessionId:id}})).json()).active,false);
 assert.equal((await call('removeDevice',{method:'DELETE',id:deviceId})).status,200);assert.equal((await call('lease',{...deviceAuth,body:{sessionId:id}})).status,401);
});
test('expired or superseded pairing codes cannot register a device',async()=>{
 const first=await (await call('pairStart')).json();const second=await (await call('pairStart')).json();
 assert.equal((await call('pairComplete',{user:null,body:{code:first.code}})).status,410);
 await db.prepare('UPDATE pairing_codes SET expires_at=0 WHERE code=?').bind(second.code).run();assert.equal((await call('pairComplete',{user:null,body:{code:second.code}})).status,410);
});
test('changing the configured owner revokes old-owner device polling and live leases',async()=>{
 await device('revoked-owner','previous-owner@local.test');await session('revoked-owner-session','revoked-owner','previous-owner@local.test');
 const auth={user:null,deviceId:'revoked-owner',token:'token-revoked-owner',body:{sessionId:'revoked-owner-session'}};
 assert.equal((await call('lease',auth)).status,401);assert.equal((await call('heartbeat',{...auth,body:{}})).status,401);
});

test('Linro build identity is owner-authenticated, read-only and contains no credentials',async()=>{
 assert.equal((await call('buildInfo',{method:'GET',user:null})).status,401);
 assert.equal((await call('buildInfo',{method:'GET',user:'other@local.test'})).status,401);
 const response=await call('buildInfo',{method:'GET'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.equal(body.brand,'린로');assert.equal(body.englishName,'Linro');assert.equal(body.buildId,'linro-device-test-stage7');assert.equal(body.signalingOrigin,'https://qa.local');assert.equal(body.protocolVersion,1);assert.equal(body.physicalDeviceVerified,false);assert.doesNotMatch(JSON.stringify(body),/deviceToken|tokenHash|Bearer/);
});
