import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../lib/remote/shortcuts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { shortcutStep } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const key = (value, extra = {}) => ({ key: value, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, ...extra });
test('Alt+H sends recent apps once while Ctrl+H and text fields remain untouched', () => {
  assert.equal(shortcutStep(key('h', { altKey: true }), 0, 100, false).action.command, 'recents');
  assert.equal(shortcutStep(key('h', { altKey: true, repeat: true }), 0, 100, false).action, null);
  assert.equal(shortcutStep(key('h', { altKey: true, repeat: true }), 0, 100, false).consume, true);
  for (const event of [key('h', { ctrlKey: true }), key('h', { altKey: true, ctrlKey: true }), key('h', { altKey: true, isComposing: true })]) assert.equal(shortcutStep(event, 0, 100, false).consume, false);
  assert.equal(shortcutStep(key('h', { altKey: true }), 0, 100, true).consume, false);
});
test('shortcut prefix expires, cancels on unrelated keys and consumes only mapped actions', () => {
  const armed = shortcutStep(key('F8'), 0, 100, false).armedUntil;
  assert.equal(shortcutStep(key('h'), armed, 200, false).action.command, 'home');
  assert.equal(shortcutStep(key('r'), armed, 1600, false).consume, false);
  assert.equal(shortcutStep(key('x'), armed, 200, false).armedUntil, 0);
  assert.equal(shortcutStep(key('h'), 0, 200, false).consume, false);
});
