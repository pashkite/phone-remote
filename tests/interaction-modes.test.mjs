import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'interaction-tests-'));
for(const name of ['profiles','engine'])fs.writeFileSync(path.join(tmp,`${name}.mjs`),ts.transpileModule(fs.readFileSync(new URL(`../lib/interaction/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('"./profiles"','"./profiles.mjs"'));
const {InteractionEngine,joystickPoint}=await import(pathToFileURL(path.join(tmp,'engine.mjs')));
const {defaultProfile,defaultStore,parseStore,profileStorageKey,sanitizeProfile}=await import(pathToFileURL(path.join(tmp,'profiles.mjs')));
function setup(mode='game',multi=false){const frames=[],commands=[];let available=true,ok=true;const profile=defaultProfile(mode);profile.mappingEnabled=true;profile.experimentalMulti=multi;const engine=new InteractionEngine(profile,{available:()=>available,pointers:p=>{frames.push(structuredClone(p));return ok;},command:c=>{commands.push(c);return ok;}});return {engine,profile,frames,commands,disconnect:()=>{available=false},fail:()=>{ok=false}};}
test('WASD diagonal is normalized, key repeats ignored and last key-up releases joystick',()=>{
 const h=setup();h.engine.key('KeyW',true);h.engine.key('KeyD',true);h.engine.tick(32);const p=h.frames.at(-1).find(p=>p.pointerId==='joystick');
 assert.ok(Math.abs(p.x-(.22+.1/Math.sqrt(2)))<1e-6);assert.ok(p.y<.76);
 const count=h.frames.length;h.engine.key('KeyD',true,true);assert.equal(h.frames.length,count);
 h.engine.key('KeyW',false);h.engine.tick(64);assert.equal(h.frames.at(-1)[0].y,.76);
 h.engine.key('KeyD',false);assert.equal(h.engine.pointerCount,0);assert.equal(h.frames.at(-1)[0].phase,'up');
});
test('multiple independent down/move/up/cancel snapshots preserve remaining pointers',()=>{
 const h=setup('game',true);h.engine.key('KeyW',true);h.engine.key('KeyF',true);assert.equal(h.engine.pointerCount,2);
 assert.equal(h.frames.at(-1).filter(p=>p.phase==='down').length,1);assert.equal(h.frames.at(-1).length,2);
 h.engine.key('KeyF',false);assert.equal(h.engine.pointerCount,1);assert.equal(h.frames.at(-1).find(p=>p.pointerId==='mapped:KeyF').phase,'up');
 h.engine.cancel('blur');assert.equal(h.engine.pointerCount,0);assert.equal(h.frames.at(-1)[0].phase,'cancel');
});
test('single-pointer default refuses simultaneous mapping and explicit multi caps at five',()=>{
 const single=setup();single.engine.key('KeyW',true);single.engine.key('KeyF',true);assert.equal(single.engine.pointerCount,1);
 const h=setup('game',true);for(let i=0;i<10;i++)h.engine.down(`p:${i}`,{x:.5,y:.5});assert.equal(h.engine.pointerCount,5);
});
test('move flood is coalesced into one bounded tick and terminals are immediate',()=>{
 const h=setup();h.engine.down('mouse:1',{x:.1,y:.1});for(let i=0;i<10000;i++)h.engine.move('mouse:1',{x:i/10000,y:.5});assert.equal(h.frames.length,1);
 h.engine.tick(32);assert.equal(h.frames.length,2);assert.equal(h.frames[1][0].x,.9999);
 h.engine.up('mouse:1');assert.equal(h.frames[2][0].phase,'up');h.engine.tick(500);assert.equal(h.frames.length,3);
});
test('hold heartbeat is bounded and timed tap/long press end without key repeat',()=>{
 const h=setup();h.profile.bindings[0].action='tap';h.engine.time(1000);h.engine.key('KeyF',true);h.engine.tick(1060);assert.equal(h.engine.pointerCount,1);h.engine.tick(1070);assert.equal(h.engine.pointerCount,0);
 h.profile.bindings[0].action='longPress';h.engine.key('KeyF',true);h.engine.tick(1600);assert.equal(h.engine.pointerCount,1);h.engine.tick(1720);assert.equal(h.engine.pointerCount,0);
});
test('profile/mode switch, disconnect and send failure clear all held input and auto work',()=>{
 const h=setup();h.engine.key('KeyW',true);h.engine.configure(defaultProfile('novel'));assert.equal(h.engine.pointerCount,0);assert.equal(h.frames.at(-1)[0].phase,'cancel');
 h.engine.startAuto();h.disconnect();h.engine.tick(1000);assert.equal(h.engine.auto,'stopped');
 const f=setup();f.fail();assert.equal(f.engine.down('x',{x:.5,y:.5}),false);assert.equal(f.engine.pointerCount,0);
});
test('standard gamepad stick/dpad/buttons map to touch and disconnect releases both',()=>{
 const h=setup('game',true);h.profile.gamepadEnabled=true;const pad={connected:true,mapping:'standard',axes:[.6,-.6],buttons:Array.from({length:17},(_,i)=>({pressed:i===0,value:i===0?1:0}))};
 h.engine.pad(pad);assert.equal(h.engine.pointerCount,2);h.engine.tick(32);assert.ok(h.frames.at(-1).some(p=>p.pointerId==='mapped:Pad0'));
 const count=h.frames.length;h.engine.pad(pad);assert.equal(h.frames.length,count);h.engine.pad(null);assert.equal(h.engine.pointerCount,0);
});
test('triggers and shoulders use configurable buttons; nonstandard pads never inject',()=>{
 const h=setup('game',true);h.profile.gamepadEnabled=true;const pad={connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===4,value:i===6?.7:0}))};
 h.engine.pad(pad);assert.equal(h.engine.pointerCount,2);h.engine.pad({...pad,mapping:''});assert.equal(h.engine.pointerCount,0);
});
test('reading keys, click zones, navigation modes and reverse produce bounded commands',()=>{
 const h=setup('novel');h.profile.reading.clickPages=true;h.engine.key('PageDown',true);assert.equal(h.commands[0].type,'swipe');assert.ok(h.commands[0].fromY>h.commands[0].toY);
 h.engine.tick(400);h.profile.reading.reverse=true;h.engine.key('PageDown',true);assert.ok(h.commands.at(-1).fromY<h.commands.at(-1).toY);
 h.engine.tick(800);h.profile.reading.navigation='tap';assert.equal(h.engine.pageClick(.9),true);assert.equal(h.commands.at(-1).x,.15);
 h.engine.tick(1200);h.profile.reading.navigation='horizontal';h.engine.key('PageUp',true);assert.ok(h.commands.at(-1).fromX>h.commands.at(-1).toX);
 assert.equal(h.engine.pageClick(.5),false);
});
test('wheel storms merge, line/page units clamp and scroll rate stays at most four per second',()=>{
 const h=setup('webtoon');for(let i=0;i<5000;i++)h.engine.wheel(1);h.engine.tick(32);assert.equal(h.commands.length,1);
 for(let t=40;t<=1000;t+=10){h.engine.wheel(1000,2);h.engine.tick(t);}assert.ok(h.commands.length<=4);
 assert.ok(h.commands.every(c=>c.durationMs===220&&c.fromY>=0&&c.toY<=1));
});
test('auto scroll explicit start/pause/resume/stop and manual input safety',()=>{
 const h=setup('webtoon');h.engine.tick(0);assert.equal(h.commands.length,0);assert.equal(h.engine.startAuto(),true);h.engine.tick(32);assert.equal(h.commands.length,1);
 h.engine.pauseAuto();h.engine.tick(4000);assert.equal(h.commands.length,1);h.engine.resumeAuto();h.engine.tick(4100);assert.equal(h.commands.length,2);
 h.engine.wheel(-100);assert.equal(h.engine.auto,'stopped');h.engine.startAuto();h.engine.manual();assert.equal(h.engine.auto,'stopped');
 h.engine.startAuto();h.engine.configure(defaultProfile('game'));assert.equal(h.engine.auto,'stopped');
});
test('auto speed and direction change are effective, error stops generation',()=>{
 const h=setup('novel');h.profile.reading.autoSpeed=3;h.profile.reading.autoDirection=-1;h.engine.startAuto();h.engine.tick(0);assert.ok(h.commands[0].fromY<h.commands[0].toY);
 h.engine.tick(499);assert.equal(h.commands.length,1);h.engine.tick(500);assert.equal(h.commands.length,2);h.fail();h.engine.tick(1000);assert.equal(h.engine.auto,'stopped');
});
test('profiles are versioned, bounded, sanitized and exclude tokens/content',()=>{
 const store=defaultStore();store.profiles[0].name='My game';const json=JSON.stringify({...store,token:'secret',video:'private',profiles:store.profiles.map(p=>({...p,password:'secret'}))});
 const parsed=parseStore(json);assert.equal(parsed.profiles[0].name,'My game');assert.doesNotMatch(JSON.stringify(parsed),/secret|private|password|token/);
 assert.equal(parseStore('{').mode,'game');assert.equal(parseStore('{"version":999}').profiles.length,3);
 const bad=sanitizeProfile({...defaultProfile('novel'),zoom:100,reading:{speed:-99,leftZone:1,rightZone:0},bindings:[{key:'KeyF',x:Infinity,y:-100,size:1},{key:'Alt+KeyH'}]},'novel');
 assert.equal(bad.zoom,3);assert.equal(bad.reading.speed,.25);assert.equal(bad.bindings.length,1);assert.equal(bad.bindings[0].x,.5);assert.equal(bad.bindings[0].y,0);
});
test('mode/device/owner namespaces and saved settings remain separate; defaults do not auto-run',()=>{
 assert.notEqual(profileStorageKey('a','phone1'),profileStorageKey('a','phone2'));assert.notEqual(profileStorageKey('a','phone1'),profileStorageKey('b','phone1'));
 const store=defaultStore();store.profiles.find(p=>p.mode==='novel').reading.speed=2;const loaded=parseStore(JSON.stringify(store));assert.equal(loaded.profiles.find(p=>p.mode==='webtoon').reading.speed,1);
 const h=setup('novel');h.engine.tick(100000);assert.equal(h.engine.auto,'stopped');assert.equal(h.commands.length,0);
});
test('joystick normalization clamps coordinates and never depends on pixel resolution',()=>{
 const p=defaultProfile('game');const point=joystickPoint(p,1,-1);assert.ok(point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1);
 p.joystick.x=.95;p.joystick.radius=.2;p.sensitivity=3;assert.equal(joystickPoint(p,1,0).x,1);
});

test('oversized imports still retain all three modes within the profile resource cap',()=>{
 const profiles=Array.from({length:20},(_,i)=>({...defaultProfile('game'),id:`game-${i}`}));
 const result=parseStore(JSON.stringify({version:1,profiles}));assert.ok(result.profiles.length<=12);
 for(const mode of ['game','novel','webtoon'])assert.ok(result.profiles.some(p=>p.mode===mode));
});
test('nonfinite input coordinates never turn into a center-screen tap',()=>{
 const h=setup();assert.equal(h.engine.down('bad',{x:NaN,y:.5}),false);assert.equal(h.frames.length,0);
 h.engine.down('ok',{x:.5,y:.5});h.engine.move('ok',{x:Infinity,y:.2});assert.equal(h.engine.pointerCount,0);assert.equal(h.frames.at(-1)[0].phase,'cancel');
});

test('zoom/pan and fullscreen letterboxing use the actual transformed video rectangle',async()=>{
 const source=fs.readFileSync(new URL('../app/remote-geometry.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {normalizedVideoPoint}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const point=normalizedVideoPoint(250,450,{left:-50,top:-150,width:600,height:1200},{width:1080,height:2160});
 assert.equal(point.x,.5);assert.equal(point.y,.5);assert.equal(point.inside,true);
 const bar=normalizedVideoPoint(10,300,{left:0,top:0,width:1200,height:600},{width:1080,height:2400});assert.equal(bar.inside,false);
});

test('two standard sticks and custom dpad buttons map independently',()=>{
 const h=setup('game',true);h.profile.gamepadEnabled=true;h.profile.lookStick.enabled=true;
 h.profile.bindings.push({id:'custom-dpad',key:'Pad12',x:.9,y:.2,size:.08,action:'hold'});
 const pad={connected:true,mapping:'standard',axes:[.7,0,0,-.8],buttons:Array.from({length:17},(_,i)=>({pressed:i===12,value:i===12?1:0}))};
 h.engine.pad(pad);assert.equal(h.engine.pointerCount,3);h.engine.tick(32);
 const frame=h.frames.at(-1);assert.ok(frame.some(p=>p.pointerId==='look'&&p.y<h.profile.lookStick.y));
 assert.ok(frame.some(p=>p.pointerId==='mapped:Pad12'));h.engine.pad(null);assert.equal(h.engine.pointerCount,0);
});
test('wheel sensitivity changes swipe distance and reading profiles accept custom keys',()=>{
 const a=setup('novel'),b=setup('novel');a.profile.reading.speed=.25;b.profile.reading.speed=2;
 a.engine.wheel(120);b.engine.wheel(120);a.engine.tick(32);b.engine.tick(32);
 assert.ok(Math.abs(a.commands[0].fromY-a.commands[0].toY)<Math.abs(b.commands[0].fromY-b.commands[0].toY));
 a.profile.reading.nextKey='KeyN';a.engine.tick(400);assert.equal(a.engine.key('KeyN',true),true);assert.equal(a.commands.length,2);
});
