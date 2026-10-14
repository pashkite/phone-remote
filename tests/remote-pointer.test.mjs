import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../app/remote-console.tsx', import.meta.url), 'utf8');
const handlers = source.slice(source.indexOf('  function onPointerDown('), source.indexOf('  function sendViewportSwipe('));
const js = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const payloads = [], captures = new Set(), ref = { current: null };
  const target = { ownerDocument: { defaultView: null }, setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
  const actions = new Function('connected', 'pointerStartRef', 'normalizedPointer', 'sendPayload', 'keyboardRef', 'detachedKeyboardRef', 'toolsRef', 'livePointerRef', js + '\nreturn {onPointerDown,onPointerMove,onPointerUp,onPointerCancel};')(true, ref, e => ({ x: Math.max(0, Math.min(1,e.clientX/100)), y: Math.max(0, Math.min(1,e.clientY/200)), inside:e.clientX>=0 && e.clientX<=100 && e.clientY>=0 && e.clientY<=200 }), p => payloads.push(p), {current:null}, {current:null}, {current:null}, {current:null});
  const event = (extra={}) => ({ currentTarget:target, clientX:50, clientY:100, pointerId:1, button:0, isPrimary:true, timeStamp:0, preventDefault(){}, ...extra });
  return { ...actions, event, payloads, captures, ref };
}
test('drag released outside screen clamps to edge and releases pointer capture', () => {
  const h=harness(); h.onPointerDown(h.event()); h.onPointerMove(h.event({clientY:140})); h.onPointerUp(h.event({clientY:250,timeStamp:900}));
  assert.deepEqual(h.payloads,[{type:'swipe',fromX:.5,fromY:.5,toX:.5,toY:1,durationMs:400}]);
  assert.equal(h.captures.size,0); assert.equal(h.ref.current,null);
});
test('pixel threshold preserves small drag on large displays; jitter remains a tap', () => {
  const h=harness(); h.onPointerDown(h.event()); h.onPointerUp(h.event({clientX:54,timeStamp:100})); assert.equal(h.payloads[0].type,'tap');
  h.onPointerDown(h.event()); h.onPointerUp(h.event({clientX:58,timeStamp:90})); assert.equal(h.payloads[1].type,'swipe'); assert.equal(h.payloads[1].durationMs,90);
});
test('secondary input cannot overwrite a drag; cancellation sends no gesture', () => {
  const h=harness(); h.onPointerDown(h.event({button:2})); assert.equal(h.ref.current,null);
  h.onPointerDown(h.event()); h.onPointerDown(h.event({pointerId:2})); h.onPointerUp(h.event({pointerId:2})); assert.equal(h.ref.current.pointerId,1);
  h.onPointerCancel(h.event()); h.onPointerUp(h.event()); assert.equal(h.payloads.length,0); assert.equal(h.captures.size,0);
});
test('letterbox input is ignored and stationary hold preserves long press', () => {
  const h=harness(); h.onPointerDown(h.event({clientX:-1})); assert.equal(h.captures.size,0);
  h.onPointerDown(h.event()); h.onPointerUp(h.event({timeStamp:650})); assert.equal(h.payloads[0].type,'longPress');
});
