const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPromptState } = require('../lib/prompt-state');

const tempDirs = [];
let stateFile;

test.beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yanghui-auto-save-'));
  tempDirs.push(dir);
  stateFile = path.join(dir, 'state.json');
});

test.afterEach(() => {
  const dir = tempDirs.pop();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('defaults to not handled and persists handled state', () => {
  const state = createPromptState({ fs, stateFile });
  assert.equal(state.wasHandled(), false);
  assert.equal(state.markHandled(), true);
  assert.equal(createPromptState({ fs, stateFile }).wasHandled(), true);
});

test('treats corrupt state as not handled and repairs it', () => {
  fs.writeFileSync(stateFile, '{bad json', 'utf8');
  const state = createPromptState({ fs, stateFile });
  assert.equal(state.wasHandled(), false);
  assert.doesNotThrow(() => state.markHandled());
  assert.equal(state.wasHandled(), true);
});

test('treats an unwritable state file as a non-fatal fallback', () => {
  const throwingFs = {
    readFileSync() { throw new Error('unreadable'); },
    writeFileSync() { throw new Error('unwritable'); }
  };
  const state = createPromptState({ fs: throwingFs, stateFile: 'unused' });
  assert.equal(state.wasHandled(), false);
  assert.equal(state.markHandled(), false);
});
