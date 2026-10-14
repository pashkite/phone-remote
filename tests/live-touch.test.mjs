import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync(new URL('../lib/remote/live-touch.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {LiveTouchSender}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
function setup(){const packets=[];let tick;let failed=0,cleared=0,open=true;const sender=new LiveTouchSender(p=>{if(!open)return false;packets.push(p);return true;},{setInterval(cb,ms){assert.equal(ms,40);tick=cb;return 1;},clearInterval(){cleared++;}},{x:.2,y:.3},'test-id',()=>failed++);return{sender,packets,tick:()=>tick(),close:()=>open=false,stats:()=>({failed,cleared})};}
test('live drag sends down immediately, bounded latest position before up, and keeps touch ID',()=>{const h=setup();assert.equal(h.packets[0].phase,'down');for(let i=0;i<100;i++)h.sender.move({x:i/100,y:.7});assert.equal(h.packets.length,1);h.tick();assert.equal(h.packets[1].phase,'move');assert.equal(h.packets[1].x,.99);h.sender.finish('up',{x:2,y:-1});assert.equal(h.packets[2].phase,'up');assert.equal(h.packets[2].x,1);assert.equal(h.packets[2].y,0);assert.ok(h.packets.every(p=>p.touchId==='test-id'));assert.equal(h.stats().cleared,1);});
test('stationary heartbeat preserves a hold and cancellation is idempotent',()=>{const h=setup();h.tick();assert.deepEqual(h.packets[1],{...h.packets[0],phase:'move'});h.sender.finish('cancel');h.sender.finish('cancel');assert.equal(h.packets.filter(p=>p.phase==='cancel').length,1);});
test('send failure stops timer and invokes cleanup instead of replaying a swipe',()=>{const h=setup();h.close();h.tick();assert.equal(h.sender.started,false);assert.equal(h.stats().failed,1);assert.equal(h.stats().cleared,1);});
