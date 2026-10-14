import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../lib/remote/shortcuts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { resolveShortcut } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const key = (value, extra = {}) => ({ key: value, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, ...extra });
test('Alt+R/H/B map to recent apps/home/back and repeated keys do not resend', () => {
  for (const [letter, command] of [['r', 'recents'], ['h', 'home'], ['b', 'back']]) {
    assert.equal(resolveShortcut(key(letter, { altKey: true }), false).action.command, command);
    assert.equal(resolveShortcut(key(letter.toUpperCase(), { altKey: true }), false).action.command, command);
    assert.equal(resolveShortcut(key(letter, { altKey: true, repeat: true }), false).action, null);
    assert.equal(resolveShortcut(key(letter, { altKey: true, repeat: true }), false).consume, true);
  }
});
test('function keys, browser modifiers, IME and editable fields remain untouched', () => {
  for (let n = 1; n <= 12; n++) assert.equal(resolveShortcut(key(`F${n}`), false).consume, false);
  for (const event of [key('h'), key('h', { ctrlKey: true }), key('h', { altKey: true, ctrlKey: true }), key('h', { altKey: true, shiftKey: true }), key('h', { altKey: true, metaKey: true }), key('h', { altKey: true, isComposing: true }), key('x', { altKey: true })]) assert.equal(resolveShortcut(event, false).consume, false);
  assert.equal(resolveShortcut(key('h', { altKey: true }), true).consume, false);
});
