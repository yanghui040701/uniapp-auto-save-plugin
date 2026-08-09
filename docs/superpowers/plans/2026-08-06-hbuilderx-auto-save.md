# HBuilderX Auto Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package a free HBuilderX editor plugin that debounces edits, saves the still-active local document after 1000ms by default, and—with consent—enables HBuilderX native focus-loss saving.

**Architecture:** Keep all HBuilderX API calls in a runtime adapter and keep debounce/save policy in a dependency-injected controller that can be tested with a fake clock. A separate focus-save coordinator owns the one-time consent flow and a minimal local state marker. The root `extension.js` only wires these units together and exposes HBuilderX lifecycle functions.

**Tech Stack:** CommonJS JavaScript, HBuilderX extension API, Node.js built-in `node:test` and `assert`, PowerShell `Compress-Archive`, no runtime npm dependencies.

## Global Constraints

- Plugin ID: `yanghui-auto-save`; publisher display value: `yanghui040701`; initial version: `1.0.0`.
- HBuilderX engine floor: `^3.2.3`; verify on installed HBuilderX `5.15.2026070915` on Windows.
- Plugin configuration keys are exactly `hbuilderx-auto-save.enabled` and `hbuilderx-auto-save.delay`.
- `enabled` defaults to `true`; `delay` defaults to `1000` ms and is clamped at runtime to `200–10000` ms.
- Save only the document that is still active when the timer fires; never use `workbench.action.files.saveAll` and never write document contents directly with Node `fs`.
- Handle local, named, writable text documents; skip untitled, non-file, clean, stale, or detectably read-only documents.
- Successful background saves are silent; a failed save reports once and does not retry without a new edit.
- Native focus-loss setting key is `editor.saveOnFocusLost`; ask for consent before changing it and never edit HBuilderX `settings.json` directly.
- No code, file paths, usage analytics, credentials, or document content may be collected or transmitted.
- Distribution contains no `.git`, `node_modules`, tests, Superpowers documents, or runtime state file.
- MIT license; free plugin; no ads, data collection, or special permissions.

---

## File Structure

- `package.json` — HBuilderX manifest, plugin settings, command declaration, metadata, and development scripts.
- `extension.js` — activation/deactivation wiring; lazy-loads `hbuilderx` only inside `activate`.
- `lib/auto-save-controller.js` — pure debounce scheduling, document eligibility, identity checking, config normalization, and save error flow.
- `lib/hbuilderx-runtime.js` — the only production module that invokes HBuilderX APIs.
- `lib/focus-save-coordinator.js` — consent, native setting update, verification, and manual fallback flow.
- `lib/prompt-state.js` — minimal JSON marker for whether the first-run prompt was handled.
- `test/*.test.js` — Node built-in unit and contract tests.
- `scripts/validate-package.js` — validates manifest and distribution file allowlist.
- `scripts/package.ps1` — creates `dist/yanghui-auto-save.zip` with one top-level `yanghui-auto-save` directory.
- `README.md` — end-user installation, behavior, settings, limitations, privacy, and troubleshooting.
- `CHANGELOG.md` — version history.
- `LICENSE` — MIT license.
- `docs/publishing.md` — copy-ready DCloud marketplace fields and submission checklist.
- `.gitignore` — ignores distribution artifacts and runtime state.

---

### Task 1: Manifest and Test Foundation

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `test/manifest.test.js`

**Interfaces:**
- Consumes: None.
- Produces: npm scripts `test`, `validate`, and `package`; HBuilderX config keys and command ID `yanghui-auto-save.checkFocusSave` used by later tasks.

- [ ] **Step 1: Write the failing manifest contract test**

Create `test/manifest.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('manifest declares the exact plugin identity and entry point', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.id, 'yanghui-auto-save');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.publisher, 'yanghui040701');
  assert.equal(manifest.main, './extension');
  assert.deepEqual(manifest.activationEvents, ['*']);
  assert.equal(manifest.engines.HBuilderX, '^3.2.3');
});

test('manifest exposes only the two approved user settings', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const properties = manifest.contributes.configuration.properties;
  assert.deepEqual(Object.keys(properties).sort(), [
    'hbuilderx-auto-save.delay',
    'hbuilderx-auto-save.enabled'
  ]);
  assert.equal(properties['hbuilderx-auto-save.enabled'].default, true);
  assert.equal(properties['hbuilderx-auto-save.delay'].default, 1000);
});

test('manifest declares privacy, ads, and permission status', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dcloudext.declaration, {
    ads: '无',
    data: '无',
    permissions: '无'
  });
});
```

- [ ] **Step 2: Run the test and verify the missing manifest failure**

Run: `node --test test/manifest.test.js`

Expected: FAIL with `ENOENT` for `package.json`.

- [ ] **Step 3: Create the minimal HBuilderX manifest**

Create `package.json` with these exact functional fields:

```json
{
  "id": "yanghui-auto-save",
  "name": "HBuilderX Auto Save",
  "displayName": "自动保存（防抖增强）",
  "description": "停止输入后防抖保存，并协同原生失焦保存",
  "version": "1.0.0",
  "publisher": "yanghui040701",
  "license": "MIT",
  "engines": { "HBuilderX": "^3.2.3" },
  "categories": ["Other"],
  "keywords": ["自动保存", "HBuilderX", "防抖", "autosave"],
  "main": "./extension",
  "activationEvents": ["*"],
  "contributes": {
    "configuration": {
      "title": "自动保存（防抖增强）",
      "properties": {
        "hbuilderx-auto-save.enabled": {
          "type": "boolean",
          "default": true,
          "description": "停止输入后自动保存当前文件"
        },
        "hbuilderx-auto-save.delay": {
          "type": "number",
          "default": 1000,
          "description": "停止输入到自动保存的延迟（毫秒，允许 200–10000）"
        }
      }
    },
    "commands": [
      {
        "command": "yanghui-auto-save.checkFocusSave",
        "title": "自动保存：检查并开启 HBuilderX 原生失焦保存"
      }
    ]
  },
  "repository": "https://github.com/yanghui040701/uniapp-auto-save-plugin",
  "bugs": "https://github.com/yanghui040701/uniapp-auto-save-plugin/issues",
  "scripts": {
    "test": "node --test",
    "validate": "node scripts/validate-package.js",
    "package": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1"
  },
  "dependencies": {},
  "dcloudext": {
    "category": ["HBuilderX", "HBuilderX"],
    "contact": { "qq": "" },
    "declaration": { "ads": "无", "data": "无", "permissions": "无" },
    "npmurl": ""
  }
}
```

Create `.gitignore`:

```gitignore
dist/
node_modules/
.auto-save-state.json
*.log
```

Create the standard MIT license in `LICENSE` with copyright line:

```text
Copyright (c) 2026 yanghui040701
```

- [ ] **Step 4: Run the manifest contract test**

Run: `npm test -- test/manifest.test.js`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the manifest foundation**

```powershell
git add package.json .gitignore LICENSE test/manifest.test.js
git commit -m "chore: scaffold HBuilderX plugin manifest"
```

---

### Task 2: Debounced Auto-Save Controller

**Files:**
- Create: `lib/auto-save-controller.js`
- Create: `test/auto-save-controller.test.js`

**Interfaces:**
- Consumes: Adapter functions `getSettings()`, `getActiveSnapshot()`, `saveActiveDocument()`, and `reportSaveError(error, document)`.
- Produces: `normalizeDelay(value)`, `documentKey(document)`, `isSaveCandidate(document, readOnly)`, and `createAutoSaveController(dependencies)` returning `handleDocumentChange(event)`, `handleConfigurationChange()`, and `dispose()`.

- [ ] **Step 1: Write failing controller tests with a fake clock**

Create `test/auto-save-controller.test.js` with a reusable fake clock and these cases:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAutoSaveController,
  normalizeDelay,
  documentKey,
  isSaveCandidate
} = require('../lib/auto-save-controller');

function createClock() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(fn, delay) {
      const id = nextId++;
      tasks.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    pending() { return [...tasks.values()]; },
    async runLatest() {
      const latest = [...tasks.entries()].at(-1);
      if (!latest) return;
      tasks.delete(latest[0]);
      await latest[1].fn();
    }
  };
}

function document(name, overrides = {}) {
  return {
    fileName: `C:\\project\\${name}`,
    uri: { scheme: 'file', fsPath: `C:\\project\\${name}` },
    isUntitled: false,
    isDirty: true,
    ...overrides
  };
}

test('normalizes delay to the safe range', () => {
  assert.equal(normalizeDelay(199), 200);
  assert.equal(normalizeDelay(1000), 1000);
  assert.equal(normalizeDelay(10001), 10000);
  assert.equal(normalizeDelay('bad'), 1000);
});

test('debounces repeated edits into one save', async () => {
  const clock = createClock();
  const active = document('index.vue');
  let saves = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => { saves += 1; },
    reportSaveError: () => assert.fail('unexpected error')
  });
  controller.handleDocumentChange({ document: active });
  controller.handleDocumentChange({ document: active });
  controller.handleDocumentChange({ document: active });
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].delay, 1000);
  await clock.runLatest();
  assert.equal(saves, 1);
});

test('does not save a new active document with an old timer', async () => {
  const clock = createClock();
  const changed = document('old.vue');
  const active = document('new.vue');
  let saves = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => { saves += 1; },
    reportSaveError: () => assert.fail('unexpected error')
  });
  controller.handleDocumentChange({ document: changed });
  await clock.runLatest();
  assert.equal(saves, 0);
});
```

Add these tests in the same file:

```js
test('disabled settings do not schedule and disabling cancels pending work', () => {
  const clock = createClock();
  const settings = { enabled: false, delay: 1000 };
  const active = document('index.vue');
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => settings,
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => {},
    reportSaveError: () => {}
  });
  controller.handleDocumentChange({ document: active });
  assert.equal(clock.pending().length, 0);
  settings.enabled = true;
  controller.handleDocumentChange({ document: active });
  assert.equal(clock.pending().length, 1);
  settings.enabled = false;
  controller.handleConfigurationChange();
  assert.equal(clock.pending().length, 0);
});

test('configuration change reschedules pending work with normalized delay', () => {
  const clock = createClock();
  const settings = { enabled: true, delay: 1000 };
  const active = document('index.vue');
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => settings,
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => {},
    reportSaveError: () => {}
  });
  controller.handleDocumentChange({ document: active });
  settings.delay = 50;
  controller.handleConfigurationChange();
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].delay, 200);
});

test('filters untitled, non-file, clean, and read-only documents', () => {
  assert.equal(isSaveCandidate(document('a.vue', { isUntitled: true }), false), false);
  assert.equal(isSaveCandidate(document('a.vue', { uri: { scheme: 'http' } }), false), false);
  assert.equal(isSaveCandidate(document('a.vue', { isDirty: false }), false), false);
  assert.equal(isSaveCandidate(document('a.vue'), true), false);
  assert.equal(isSaveCandidate(document('a.vue'), false), true);
});

test('dispose cancels pending work and prevents later scheduling', () => {
  const clock = createClock();
  const active = document('index.vue');
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => {},
    reportSaveError: () => {}
  });
  controller.handleDocumentChange({ document: active });
  controller.dispose();
  controller.handleDocumentChange({ document: active });
  assert.equal(clock.pending().length, 0);
});

test('reports one failed save and waits for a new edit before retrying', async () => {
  const clock = createClock();
  const active = document('index.vue');
  let reports = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => { throw new Error('denied'); },
    reportSaveError: () => { reports += 1; }
  });
  controller.handleDocumentChange({ document: active });
  await clock.runLatest();
  await clock.runLatest();
  assert.equal(reports, 1);
  controller.handleDocumentChange({ document: active });
  await clock.runLatest();
  assert.equal(reports, 2);
});
```

- [ ] **Step 2: Run the controller tests and verify the missing module failure**

Run: `node --test test/auto-save-controller.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `lib/auto-save-controller.js`.

- [ ] **Step 3: Implement identity, filtering, and delay normalization**

Create `lib/auto-save-controller.js` starting with:

```js
const DEFAULT_DELAY = 1000;
const MIN_DELAY = 200;
const MAX_DELAY = 10000;

function normalizeDelay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_DELAY;
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(number)));
}

function documentKey(document) {
  if (!document) return '';
  if (document.uri && typeof document.uri.fsPath === 'string') return document.uri.fsPath;
  return typeof document.fileName === 'string' ? document.fileName : '';
}

function isSaveCandidate(document, readOnly = false) {
  if (!document || readOnly || document.isUntitled || !document.isDirty) return false;
  if (document.uri && document.uri.scheme && document.uri.scheme !== 'file') return false;
  return documentKey(document).length > 0;
}
```

- [ ] **Step 4: Implement the single-pending-task debounce controller**

Use one pending record `{ timer, document, key }`. On every document change: cancel the old timer, re-read settings, reject ineligible documents, and schedule exactly one callback. When the callback runs: clear pending state, await `getActiveSnapshot()`, compare keys, re-run eligibility, then await `saveActiveDocument()`. Catch errors only around the scheduled save and call `reportSaveError(error, document)` once.

`handleConfigurationChange()` must cancel when disabled; when enabled and a pending document exists, it must cancel and reschedule that document using the newly normalized delay. `dispose()` must permanently prevent new schedules and clear the current timer.

Export:

```js
module.exports = {
  DEFAULT_DELAY,
  MIN_DELAY,
  MAX_DELAY,
  normalizeDelay,
  documentKey,
  isSaveCandidate,
  createAutoSaveController
};
```

- [ ] **Step 5: Run the controller tests**

Run: `node --test test/auto-save-controller.test.js`

Expected: all controller tests PASS.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`

Expected: manifest and controller tests PASS.

- [ ] **Step 7: Commit the controller**

```powershell
git add lib/auto-save-controller.js test/auto-save-controller.test.js
git commit -m "feat: add safe debounced save controller"
```

---

### Task 3: HBuilderX Runtime Adapter

**Files:**
- Create: `lib/hbuilderx-runtime.js`
- Create: `test/hbuilderx-runtime.test.js`

**Interfaces:**
- Consumes: injected `hx` object matching the public HBuilderX extension API.
- Produces: `createHBuilderXRuntime(hx)` with settings, editor snapshot, save, subscriptions, command registration, prompt, native config update, and notification methods.

- [ ] **Step 1: Write failing adapter contract tests**

Create `test/hbuilderx-runtime.test.js` with a fake `hx` that records calls:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHBuilderXRuntime } = require('../lib/hbuilderx-runtime');

function fakeHx() {
  const calls = [];
  const values = {
    'hbuilderx-auto-save.enabled': true,
    'hbuilderx-auto-save.delay': 1000,
    'editor.saveOnFocusLost': false
  };
  return {
    calls,
    values,
    workspace: {
      getConfiguration(section) {
        return {
          get(key, fallback) {
            const full = `${section}.${key}`;
            return Object.hasOwn(values, full) ? values[full] : fallback;
          },
          async update(key, value) {
            values[`${section}.${key}`] = value;
            calls.push(['update', section, key, value]);
          }
        };
      },
      onDidChangeTextDocument(listener) {
        calls.push(['onDocumentChange', listener]);
        return { dispose() {} };
      },
      onDidChangeConfiguration(listener) {
        calls.push(['onConfigurationChange', listener]);
        return { dispose() {} };
      }
    },
    window: {
      async getActiveTextEditor() {
        return { document: { fileName: 'C:\\project\\index.vue' }, readonly: false };
      },
      async showMessageBox(options) {
        calls.push(['messageBox', options]);
        return options.buttons[0];
      }
    },
    commands: {
      async executeCommand(id) { calls.push(['executeCommand', id]); },
      registerCommand(id, listener) {
        calls.push(['registerCommand', id, listener]);
        return { dispose() {} };
      }
    }
  };
}

test('reads the two plugin settings', () => {
  const hx = fakeHx();
  assert.deepEqual(createHBuilderXRuntime(hx).getSettings(), {
    enabled: true,
    delay: 1000
  });
});

test('uses only the save-current-file command', async () => {
  const hx = fakeHx();
  await createHBuilderXRuntime(hx).saveActiveDocument();
  assert.deepEqual(hx.calls, [['executeCommand', 'workbench.action.files.save']]);
});

test('updates and verifies native focus-loss saving', async () => {
  const hx = fakeHx();
  const runtime = createHBuilderXRuntime(hx);
  assert.equal(runtime.isNativeFocusSaveEnabled(), false);
  await runtime.enableNativeFocusSave();
  assert.equal(runtime.isNativeFocusSaveEnabled(), true);
  assert.deepEqual(hx.calls[0], ['update', 'editor', 'saveOnFocusLost', true]);
});
```

Add these exact adapter assertions:

```js
test('active snapshot detects both supported readonly flags', async () => {
  const hx = fakeHx();
  const doc = { fileName: 'C:\\project\\index.vue' };
  hx.window.getActiveTextEditor = async () => ({ document: doc, isReadonly: true });
  assert.deepEqual(await createHBuilderXRuntime(hx).getActiveSnapshot(), {
    document: doc,
    readOnly: true
  });
  hx.window.getActiveTextEditor = async () => ({ document: doc, readonly: true });
  assert.equal((await createHBuilderXRuntime(hx).getActiveSnapshot()).readOnly, true);
});

test('save error displays basename and does not expose the full path', async () => {
  const hx = fakeHx();
  await createHBuilderXRuntime(hx).reportSaveError(
    new Error('denied'),
    { fileName: 'C:\\private\\project\\index.vue' }
  );
  const options = hx.calls.find(call => call[0] === 'messageBox')[1];
  assert.match(options.text, /index\.vue/);
  assert.match(options.text, /denied/);
  assert.doesNotMatch(options.text, /private|project/);
});

test('native prompt maps the selected Chinese button to a stable result', async () => {
  const hx = fakeHx();
  const runtime = createHBuilderXRuntime(hx);
  assert.equal(await runtime.promptNativeFocusSave(), 'enable');
  const options = hx.calls.find(call => call[0] === 'messageBox')[1];
  assert.deepEqual(options.buttons, ['开启', '暂不开启']);
  assert.match(options.text, /失去焦点自动保存/);
});

test('event and command registration return HBuilderX disposables', () => {
  const hx = fakeHx();
  const runtime = createHBuilderXRuntime(hx);
  assert.equal(typeof runtime.onDocumentChange(() => {}).dispose, 'function');
  assert.equal(typeof runtime.onConfigurationChange(() => {}).dispose, 'function');
  assert.equal(typeof runtime.registerCommand('command.id', () => {}).dispose, 'function');
});
```

- [ ] **Step 2: Run adapter tests and verify the missing module failure**

Run: `node --test test/hbuilderx-runtime.test.js`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the HBuilderX runtime adapter**

Create `lib/hbuilderx-runtime.js`. Use `path.basename` for user-facing save errors. Required methods and exact responsibilities:

```js
function createHBuilderXRuntime(hx) {
  return {
    getSettings() {
      const config = hx.workspace.getConfiguration('hbuilderx-auto-save');
      return {
        enabled: config.get('enabled', true),
        delay: config.get('delay', 1000)
      };
    },
    async getActiveSnapshot() {
      const editor = await hx.window.getActiveTextEditor();
      return editor
        ? { document: editor.document, readOnly: editor.readonly === true || editor.isReadonly === true }
        : { document: null, readOnly: false };
    },
    saveActiveDocument() {
      return hx.commands.executeCommand('workbench.action.files.save');
    },
    onDocumentChange(listener) {
      return hx.workspace.onDidChangeTextDocument(listener);
    },
    onConfigurationChange(listener) {
      return hx.workspace.onDidChangeConfiguration(listener);
    },
    registerCommand(id, listener) {
      return hx.commands.registerCommand(id, listener);
    }
  };
}
```

Add `reportSaveError`, `isNativeFocusSaveEnabled`, `enableNativeFocusSave`, `promptNativeFocusSave`, `showNativeFocusSaveEnabled`, `showNativeFocusSaveManualFallback`, and `reportInternalError`. `enableNativeFocusSave()` must update `editor.saveOnFocusLost`, then obtain a fresh configuration object and throw if verification is still false.

Use `hx.window.showMessageBox` with buttons `['开启', '暂不开启']`. Map the result to `'enable'` or `'decline'` so the coordinator never depends on localized button text.

- [ ] **Step 4: Run adapter tests**

Run: `node --test test/hbuilderx-runtime.test.js`

Expected: all adapter tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit the adapter**

```powershell
git add lib/hbuilderx-runtime.js test/hbuilderx-runtime.test.js
git commit -m "feat: add HBuilderX runtime adapter"
```

---

### Task 4: Native Focus-Save Consent and Prompt State

**Files:**
- Create: `lib/prompt-state.js`
- Create: `lib/focus-save-coordinator.js`
- Create: `test/prompt-state.test.js`
- Create: `test/focus-save-coordinator.test.js`

**Interfaces:**
- Consumes: runtime methods from Task 3 and a state object with `wasHandled()` and `markHandled()`.
- Produces: `createPromptState({ fs, stateFile })` and `createFocusSaveCoordinator({ runtime, state })` with `ensure({ force })`.

- [ ] **Step 1: Write failing prompt-state tests**

Create `test/prompt-state.test.js` with this setup and assertions:

```js
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
```

- [ ] **Step 2: Write failing focus coordinator tests**

Create `test/focus-save-coordinator.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFocusSaveCoordinator } = require('../lib/focus-save-coordinator');

function fixture(overrides = {}) {
  const calls = [];
  const runtime = {
    isNativeFocusSaveEnabled: () => false,
    promptNativeFocusSave: async () => { calls.push('prompt'); return 'enable'; },
    enableNativeFocusSave: async () => { calls.push('enable'); },
    showNativeFocusSaveEnabled: async () => { calls.push('already-enabled'); },
    showNativeFocusSaveManualFallback: async () => { calls.push('manual'); },
    ...overrides.runtime
  };
  const state = {
    wasHandled: () => false,
    markHandled: () => { calls.push('handled'); return true; },
    ...overrides.state
  };
  return { calls, coordinator: createFocusSaveCoordinator({ runtime, state }) };
}

test('already-enabled native setting skips prompt and marks handled', async () => {
  const item = fixture({ runtime: { isNativeFocusSaveEnabled: () => true } });
  await item.coordinator.ensure({ force: false });
  assert.deepEqual(item.calls, ['handled']);
});

test('handled state skips the automatic check', async () => {
  const item = fixture({ state: { wasHandled: () => true } });
  await item.coordinator.ensure({ force: false });
  assert.deepEqual(item.calls, []);
});

test('decline marks handled without changing HBuilderX settings', async () => {
  const item = fixture({
    runtime: {
      promptNativeFocusSave: async () => { item.calls.push('prompt'); return 'decline'; }
    }
  });
  await item.coordinator.ensure({ force: false });
  assert.deepEqual(item.calls, ['prompt', 'handled']);
});

test('consent updates native setting and marks handled', async () => {
  const item = fixture();
  await item.coordinator.ensure({ force: false });
  assert.deepEqual(item.calls, ['prompt', 'enable', 'handled']);
});

test('failed update falls back to manual instructions without throwing', async () => {
  const item = fixture({
    runtime: {
      enableNativeFocusSave: async () => {
        item.calls.push('enable');
        throw new Error('unsupported');
      }
    }
  });
  await assert.doesNotReject(item.coordinator.ensure({ force: false }));
  assert.deepEqual(item.calls, ['prompt', 'enable', 'handled', 'manual']);
});

test('forced check ignores handled state and confirms enabled status', async () => {
  const item = fixture({
    runtime: { isNativeFocusSaveEnabled: () => true },
    state: { wasHandled: () => true }
  });
  await item.coordinator.ensure({ force: true });
  assert.deepEqual(item.calls, ['handled', 'already-enabled']);
});
```

- [ ] **Step 3: Run both test files and verify missing module failures**

Run: `node --test test/prompt-state.test.js test/focus-save-coordinator.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for both production modules.

- [ ] **Step 4: Implement the minimal prompt-state store**

Create `lib/prompt-state.js`:

```js
function createPromptState({ fs, stateFile }) {
  return {
    wasHandled() {
      try {
        return JSON.parse(fs.readFileSync(stateFile, 'utf8')).focusSavePromptHandled === true;
      } catch {
        return false;
      }
    },
    markHandled() {
      try {
        fs.writeFileSync(stateFile, JSON.stringify({ focusSavePromptHandled: true }), 'utf8');
        return true;
      } catch {
        return false;
      }
    }
  };
}

module.exports = { createPromptState };
```

- [ ] **Step 5: Implement the coordinator state machine**

Create `lib/focus-save-coordinator.js`. `ensure({ force = false } = {})` must follow this exact order:

1. Return if not forced and state is already handled.
2. Check native setting; if enabled, mark handled and show confirmation only when forced.
3. Prompt the user.
4. If declined, mark handled and return.
5. Try update/verification; on success mark handled.
6. On update/verification error, mark handled and show manual instructions.

The coordinator must never throw into activation. Export `createFocusSaveCoordinator`.

- [ ] **Step 6: Run focus and state tests**

Run: `node --test test/prompt-state.test.js test/focus-save-coordinator.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 8: Commit the focus-save flow**

```powershell
git add lib/prompt-state.js lib/focus-save-coordinator.js test/prompt-state.test.js test/focus-save-coordinator.test.js
git commit -m "feat: add native focus-save consent flow"
```

---

### Task 5: Extension Lifecycle Integration

**Files:**
- Create: `extension.js`
- Create: `test/extension.test.js`

**Interfaces:**
- Consumes: controller, runtime adapter, prompt state, and focus coordinator from Tasks 2–4.
- Produces: HBuilderX exports `activate(context)` and `deactivate()`, plus testable `startExtension(context, runtime, options)` and `activateWithRuntime(context, runtime, options)`.

- [ ] **Step 1: Write failing lifecycle integration tests**

Create `test/extension.test.js`. Importing the module in Node must not attempt `require('hbuilderx')`. Test `startExtension` with a fake runtime and fake clock:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, activateWithRuntime, deactivate } = require('../extension');

function createRuntimeFixture() {
  const listeners = {};
  const settings = { enabled: true, delay: 1000 };
  const active = {
    fileName: 'C:\\project\\index.vue',
    uri: { scheme: 'file', fsPath: 'C:\\project\\index.vue' },
    isUntitled: false,
    isDirty: true
  };
  const context = { subscriptions: [], extensionPath: 'C:\\plugin' };
  const runtime = {
    getSettings: () => settings,
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => {},
    reportSaveError: () => {},
    reportInternalError: error => assert.fail(error),
    onDocumentChange(listener) {
      listeners.change = listener;
      return { dispose() {} };
    },
    onConfigurationChange(listener) {
      listeners.config = listener;
      return { dispose() {} };
    },
    registerCommand(id, listener) {
      assert.equal(id, 'yanghui-auto-save.checkFocusSave');
      listeners.command = listener;
      return { dispose() {} };
    }
  };
  return { active, context, listeners, runtime, settings };
}

test('wires subscriptions, command, controller, and first-run check', async () => {
  const subscriptions = [];
  const listeners = {};
  const active = {
    fileName: 'C:\\project\\index.vue',
    uri: { scheme: 'file', fsPath: 'C:\\project\\index.vue' },
    isUntitled: false,
    isDirty: true
  };
  let saves = 0;
  const clock = {
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  const runtime = {
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => { saves += 1; },
    reportSaveError: () => {},
    onDocumentChange(listener) {
      listeners.change = listener;
      return { dispose() {} };
    },
    onConfigurationChange(listener) {
      listeners.config = listener;
      return { dispose() {} };
    },
    reportInternalError: error => assert.fail(error),
    registerCommand(id, listener) {
      listeners.command = listener;
      assert.equal(id, 'yanghui-auto-save.checkFocusSave');
      return { dispose() {} };
    }
  };
  const focusCoordinator = {
    calls: [],
    async ensure(options) { this.calls.push(options); }
  };
  const instance = startExtension(
    { subscriptions, extensionPath: 'C:\\plugin' },
    runtime,
    { focusCoordinator, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }
  );
  await instance.ready;
  assert.deepEqual(focusCoordinator.calls, [{ force: false }]);
  assert.equal(subscriptions.length, 3);
  await listeners.command();
  assert.deepEqual(focusCoordinator.calls.at(-1), { force: true });
});
```

Add these concrete lifecycle cases in the same file:

```js
test('document change schedules save and dispose cancels it', () => {
  let scheduled;
  let cleared = 0;
  const fixture = createRuntimeFixture();
  const instance = startExtension(fixture.context, fixture.runtime, {
    focusCoordinator: { ensure: async () => {} },
    setTimeout(fn, delay) {
      scheduled = { fn, delay };
      return 7;
    },
    clearTimeout(id) {
      assert.equal(id, 7);
      cleared += 1;
    }
  });
  fixture.listeners.change({ document: fixture.active });
  assert.equal(scheduled.delay, 1000);
  instance.dispose();
  assert.equal(cleared, 1);
});

test('configuration disable cancels pending work', () => {
  const fixture = createRuntimeFixture();
  let cleared = 0;
  const instance = startExtension(fixture.context, fixture.runtime, {
    focusCoordinator: { ensure: async () => {} },
    setTimeout: () => 8,
    clearTimeout: () => { cleared += 1; }
  });
  fixture.listeners.change({ document: fixture.active });
  fixture.settings.enabled = false;
  fixture.listeners.config({});
  assert.equal(cleared, 1);
  instance.dispose();
});

test('deactivate disposes the globally activated runtime instance', async () => {
  const fixture = createRuntimeFixture();
  let cleared = 0;
  await activateWithRuntime(fixture.context, fixture.runtime, {
    focusCoordinator: { ensure: async () => {} },
    setTimeout: () => 9,
    clearTimeout: () => { cleared += 1; }
  });
  fixture.listeners.change({ document: fixture.active });
  deactivate();
  assert.equal(cleared, 1);
});

test('first-run errors are reported without rejecting activation', async () => {
  const fixture = createRuntimeFixture();
  const errors = [];
  fixture.runtime.reportInternalError = error => errors.push(error.message);
  const instance = startExtension(fixture.context, fixture.runtime, {
    focusCoordinator: { ensure: async () => { throw new Error('prompt failed'); } }
  });
  await assert.doesNotReject(instance.ready);
  assert.deepEqual(errors, ['prompt failed']);
});
```

- [ ] **Step 2: Run lifecycle tests and verify the missing entry failure**

Run: `node --test test/extension.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `extension.js`.

- [ ] **Step 3: Implement dependency-injected extension wiring**

Create `extension.js` with module-level `activeInstance`. The production `activate(context)` must lazy-load APIs:

```js
function activate(context) {
  const hx = require('hbuilderx');
  const fs = require('node:fs');
  const path = require('node:path');
  const runtime = createHBuilderXRuntime(hx);
  const state = createPromptState({
    fs,
    stateFile: path.join(context.extensionPath, '.auto-save-state.json')
  });
  const focusCoordinator = createFocusSaveCoordinator({ runtime, state });
  activeInstance = startExtension(context, runtime, { focusCoordinator });
  return activeInstance.ready;
}
```

`startExtension` must create the controller, register the two event subscriptions and command, push all three disposables into `context.subscriptions`, start `focusCoordinator.ensure({ force: false })`, catch that promise with `runtime.reportInternalError`, and return `{ ready, dispose }`. Its `dispose` must be idempotent and dispose only controller-owned runtime state; HBuilderX owns subscriptions through `context.subscriptions`.

`activateWithRuntime()` disposes any previous global instance, assigns the result of `startExtension`, and returns its `ready` promise. Production `activate()` calls it after building the real dependencies. `deactivate()` calls `activeInstance.dispose()` and clears the reference.

- [ ] **Step 4: Run lifecycle tests**

Run: `node --test test/extension.test.js`

Expected: all lifecycle tests PASS.

- [ ] **Step 5: Run the full suite and static syntax checks**

Run:

```powershell
npm test
node --check extension.js
Get-ChildItem lib -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Expected: tests PASS and every syntax check exits 0.

- [ ] **Step 6: Commit lifecycle integration**

```powershell
git add extension.js test/extension.test.js
git commit -m "feat: integrate HBuilderX auto-save lifecycle"
```

---

### Task 6: User and Marketplace Documentation

**Files:**
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `docs/publishing.md`
- Create: `test/docs.test.js`

**Interfaces:**
- Consumes: exact manifest values and behavior implemented in Tasks 1–5.
- Produces: user instructions and copy-ready DCloud marketplace submission content.

- [ ] **Step 1: Write failing documentation contract tests**

Create `test/docs.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('README documents behavior, settings, privacy, and limitations', () => {
  const readme = read('README.md');
  for (const required of [
    'hbuilderx-auto-save.enabled',
    'hbuilderx-auto-save.delay',
    'editor.saveOnFocusLost',
    '不收集',
    'workbench.action.files.save',
    '快速切换'
  ]) assert.match(readme, new RegExp(required.replaceAll('.', '\\.')));
});

test('marketplace document contains every submission field', () => {
  const publishing = read('docs/publishing.md');
  for (const heading of [
    '插件名称', '插件 ID', '作者', '短描述', '详细介绍', '使用说明',
    '兼容性', '权限声明', '数据声明', '广告声明', '开源协议',
    '源码地址', '问题反馈', '更新日志', '截图清单', '提交检查清单'
  ]) assert.match(publishing, new RegExp(heading));
});

test('changelog contains the initial release', () => {
  assert.match(read('CHANGELOG.md'), /## \[1\.0\.0\] - 2026-08-06/);
});
```

- [ ] **Step 2: Run documentation tests and verify missing file failures**

Run: `node --test test/docs.test.js`

Expected: FAIL with `ENOENT` for `README.md`.

- [ ] **Step 3: Write the user README**

`README.md` must include:

- Clear positioning as a general HBuilderX plugin, not a uni-app-only plugin.
- Difference among HBuilderX temporary recovery, native focus-loss real-file save, and this plugin's after-delay real-file save.
- Installation from marketplace and local test installation.
- Default behavior and the two exact configuration keys.
- First-run consent prompt and manual path `工具 → 设置 → 常用配置 → 失去焦点自动保存`.
- Explanation that the plugin uses only `workbench.action.files.save`, never save-all or direct disk rewriting.
- Limitations for untitled/read-only/non-local documents and force-kill/crash behavior.
- Privacy statement: no collection, upload, analytics, ads, or special permissions.
- GitHub repository and issue links.
- MIT license and author `yanghui040701`.

- [ ] **Step 4: Write changelog and copy-ready marketplace fields**

Create `CHANGELOG.md` with version `1.0.0`, date `2026-08-06`, and bullets for debounced save, configurable delay, stale-document protection, native focus-save consent, silent success/error-only notification, and privacy.

Create `docs/publishing.md` with these final values:

- 插件名称：`自动保存（防抖增强）`
- 插件 ID：`yanghui-auto-save`
- 作者/发布者：`yanghui040701`
- 版本：`1.0.0`
- 分类：`HBuilderX`
- 关键词：`自动保存、HBuilderX、防抖、autosave`
- 短描述：不超过 30 个中文字符。
- Detailed introduction and usage copied consistently from README.
- Compatibility: HBuilderX `3.2.3+`; verified on Windows HBuilderX `5.15.2026070915`.
- 权限/数据/广告：均为 `无`.
- License: MIT.
- Source and issue URLs.
- Screenshot list: plugin configuration page, first-run consent dialog, marketplace cover/feature image only if the marketplace requires it.
- Submission checklist: DCloud login, unique ID check, archive upload, version check, declarations, local import test, final submit.

- [ ] **Step 5: Run documentation tests**

Run: `node --test test/docs.test.js`

Expected: all documentation tests PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit documentation**

```powershell
git add README.md CHANGELOG.md docs/publishing.md test/docs.test.js
git commit -m "docs: add user and marketplace documentation"
```

---

### Task 7: Distribution Validation and Packaging

**Files:**
- Create: `scripts/validate-package.js`
- Create: `scripts/package.ps1`
- Create: `test/package-validation.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: final runtime file list from all prior tasks.
- Produces: `validateDistribution(root)` and release artifact `dist/yanghui-auto-save.zip`.

- [ ] **Step 1: Write failing package validation tests**

Create `test/package-validation.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateDistribution } = require('../scripts/validate-package');

test('repository contains every required distribution file', () => {
  const result = validateDistribution(path.resolve(__dirname, '..'));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.files.sort(), [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'extension.js',
    'lib/auto-save-controller.js',
    'lib/focus-save-coordinator.js',
    'lib/hbuilderx-runtime.js',
    'lib/prompt-state.js',
    'package.json'
  ]);
});

test('distribution allowlist excludes development and sensitive paths', () => {
  const { files } = validateDistribution(path.resolve(__dirname, '..'));
  for (const file of files) {
    assert.doesNotMatch(file, /(^|\/)(\.git|node_modules|test|docs|dist)(\/|$)/);
    assert.notEqual(file, '.auto-save-state.json');
  }
});
```

- [ ] **Step 2: Run package validation tests and verify the missing module failure**

Run: `node --test test/package-validation.test.js`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the distribution validator**

Create `scripts/validate-package.js` with exact exported function:

```js
function validateDistribution(root) {
  const files = [
    'package.json', 'extension.js', 'README.md', 'CHANGELOG.md', 'LICENSE',
    'lib/auto-save-controller.js',
    'lib/hbuilderx-runtime.js',
    'lib/focus-save-coordinator.js',
    'lib/prompt-state.js'
  ];
  const errors = [];
  for (const file of files) {
    if (!fs.existsSync(path.join(root, file))) errors.push(`缺少发布文件: ${file}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.id !== 'yanghui-auto-save') errors.push('插件 ID 不正确');
  if (manifest.version !== '1.0.0') errors.push('插件版本不是 1.0.0');
  if (Object.keys(manifest.dependencies || {}).length) errors.push('发布包不应包含运行时依赖');
  return { files, errors };
}
```

When executed directly, print each error to stderr and exit 1, otherwise print the validated file count and exit 0. Export `{ validateDistribution }`.

- [ ] **Step 4: Implement a safe PowerShell packaging script**

Create `scripts/package.ps1` that:

1. Resolves repository root from `$PSScriptRoot`.
2. Runs `npm test` and `npm run validate`; stops on any nonzero exit.
3. Resolves `$distDir = Join-Path $root 'dist'` and verifies its full path starts with the resolved repository root before removing an old staging directory.
4. Creates `dist/yanghui-auto-save/`.
5. Copies only the validator's nine allowlisted files, preserving `lib/`.
6. Creates `dist/yanghui-auto-save.zip` with the top-level `yanghui-auto-save` directory.
7. Leaves both staging directory and zip available for inspection; never deletes anything outside `dist`.

Use native `New-Item`, `Copy-Item -LiteralPath`, `Remove-Item -LiteralPath`, and `Compress-Archive -LiteralPath` throughout. Do not enumerate files in PowerShell and hand them to another shell.

- [ ] **Step 5: Add local build instructions to README**

Add commands:

```powershell
npm test
npm run validate
npm run package
```

Explain that the final upload candidate is `dist/yanghui-auto-save.zip` and that the archive contains a single top-level `yanghui-auto-save` directory.

- [ ] **Step 6: Run unit and validation tests**

Run:

```powershell
npm test
npm run validate
```

Expected: all tests PASS; validator reports 9 distribution files and exits 0.

- [ ] **Step 7: Build and inspect the archive**

Run: `npm run package`

Then inspect without extracting over the workspace:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path 'dist/yanghui-auto-save.zip'))
$zip.Entries | Select-Object -ExpandProperty FullName
$zip.Dispose()
```

Expected: only the top-level `yanghui-auto-save/` directory and the nine allowlisted files; no tests, `.git`, `node_modules`, docs, state, or distribution recursion.

- [ ] **Step 8: Commit packaging support**

```powershell
git add scripts/validate-package.js scripts/package.ps1 test/package-validation.test.js README.md
git commit -m "build: add validated plugin packaging"
```

---

### Task 8: Final Verification and HBuilderX Manual Test Handoff

**Files:**
- Modify: `docs/publishing.md`

**Interfaces:**
- Consumes: completed plugin and distribution archive.
- Produces: verified release evidence and a manual HBuilderX checklist with actual results.

- [ ] **Step 1: Run all automated verification from a clean process**

Run:

```powershell
npm test
npm run validate
npm run package
git diff --check
git status --short
```

Expected: tests and validation PASS; archive rebuild succeeds; no whitespace errors; only the expected ignored `dist/` artifacts remain outside Git tracking.

- [ ] **Step 2: Install the staging directory into HBuilderX for manual testing**

Use a copy of `dist/yanghui-auto-save` in the HBuilderX plugin directory or import it through HBuilderX's local plugin development workflow. Do not overwrite another plugin. Restart HBuilderX if required by the installation workflow.

- [ ] **Step 3: Execute the manual behavior matrix**

Record PASS/FAIL for each item in `docs/publishing.md`:

1. Edit a local file and stop for 1000ms; disk content updates and dirty marker clears.
2. Type continuously for at least 3 seconds; no save occurs between keystrokes and HBuilderX remains responsive.
3. Type and switch tabs within 1000ms; old file is saved by native focus-loss behavior and the new file is not saved by the old timer.
4. Type and switch to another application; current file is saved.
5. Set delay to 200ms and 10000ms; both values take effect without restart.
6. Disable plugin setting; pending timer is canceled and later edits are not saved by the plugin.
7. Re-enable plugin; later edits resume delayed saving.
8. Open an untitled or read-only file; plugin does not force a write.
9. Run `自动保存：检查并开启 HBuilderX 原生失焦保存`; enabled state is reported or consent flow appears.
10. Temporarily cause a save failure; one error appears and no repeated errors appear without another edit.

- [ ] **Step 4: Update actual verification metadata**

In `docs/publishing.md`, record:

- OS edition used.
- HBuilderX exact version `5.15.2026070915`.
- Date `2026-08-06`.
- Each matrix result.
- Any behavior that differs from the design; a difference blocks release until fixed and re-tested.

- [ ] **Step 5: Rebuild after documentation update**

Run:

```powershell
npm test
npm run package
```

Expected: all tests PASS and final archive is rebuilt successfully.

- [ ] **Step 6: Commit verification evidence**

```powershell
git add docs/publishing.md
git commit -m "test: document HBuilderX release verification"
```

- [ ] **Step 7: Review release scope**

Run:

```powershell
git log --oneline --decorate -10
git status --short --branch
```

Expected: focused commits for manifest, controller, runtime, focus consent, integration, documentation, packaging, and verification; clean tracked worktree; local branch ahead of remote until the user explicitly requests a push.
