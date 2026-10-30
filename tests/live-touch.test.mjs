import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync(new URL('../lib/remote/live-touch.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {LiveTouchSender}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
function setup(){const packets=[];let tick;let failed=0,cleared=0,open=true;const sender=new LiveTouchSender(p=>{if(!open)return false;packets.push(p);return true;},{setInterval(cb,ms){assert.equal(ms,32);tick=cb;return 1;},clearInterval(){cleared++;}},{x:.2,y:.3},'test-id',()=>failed++);return{sender,packets,tick:()=>tick(),close:()=>open=false,stats:()=>({failed,cleared})};}
test('live drag sends down immediately, bounded latest position before up, and keeps touch ID',()=>{const h=setup();assert.equal(h.packets[0].phase,'down');for(let i=0;i<100;i++)h.sender.move({x:i/100,y:.7});assert.equal(h.packets.length,1);h.tick();assert.equal(h.packets[1].phase,'move');assert.equal(h.packets[1].x,.99);h.sender.finish('up',{x:2,y:-1});assert.equal(h.packets[2].phase,'up');assert.equal(h.packets[2].x,1);assert.equal(h.packets[2].y,0);assert.ok(h.packets.every(p=>p.touchId==='test-id'));assert.equal(h.stats().cleared,1);});
test('stationary heartbeat preserves a hold and cancellation is idempotent',()=>{const h=setup();for(let i=0;i<16;i++)h.tick();assert.deepEqual(h.packets[1],{...h.packets[0],phase:'move'});h.sender.finish('cancel');h.sender.finish('cancel');assert.equal(h.packets.filter(p=>p.phase==='cancel').length,1);});
test('send failure stops timer and invokes cleanup instead of replaying a swipe',()=>{const h=setup();h.close();h.sender.move({x:.7,y:.8});h.tick();assert.equal(h.sender.started,false);assert.equal(h.stats().failed,1);assert.equal(h.stats().cleared,1);});
test('a retired queued timer cannot transmit movement after pointer release',()=>{const h=setup();h.sender.finish('up');const count=h.packets.length;h.tick();assert.equal(h.packets.length,count);assert.equal(h.stats().failed,0);});
test('initial send failure never starts heartbeat or fabricates a held touch',()=>{let timers=0;const sender=new LiveTouchSender(()=>false,{setInterval(){timers++;return 1;},clearInterval(){}},{x:.5,y:.5},'test-id',()=>{});assert.equal(sender.started,false);assert.equal(timers,0);sender.finish('cancel');});

test('stationary drag does not flood the phone with move packets',()=>{const h=setup();for(let i=0;i<15;i++)h.tick();assert.equal(h.packets.length,1);h.tick();assert.equal(h.packets.length,2);});

test('opted-in low-latency samples at 16ms and preserves boundaries/heartbeat',()=>{
 const packets=[];let tick;const sender=new LiveTouchSender(p=>{packets.push(p);return true;},{setInterval(cb,ms){assert.equal(ms,16);tick=cb;return 1;},clearInterval(){}},{x:.2,y:.3},'id',()=>{},16);
 sender.move({x:.8,y:.9});tick();assert.equal(packets[1].phase,'move');
 for(let i=0;i<31;i++)tick();assert.equal(packets.length,2);tick();assert.equal(packets[2].phase,'move');
 sender.finish('cancel');tick();assert.deepEqual(packets.map(p=>p.phase),['down','move','move','cancel']);
});
