const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDelay,
  documentKey,
  isSaveCandidate,
  createAutoSaveController
} = require('../lib/auto-save-controller');
const { createHBuilderXRuntime } = require('../lib/hbuilderx-runtime');

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

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

test('uses a stable filesystem path as the document identity', () => {
  assert.equal(documentKey(document('index.vue')), 'C:\\project\\index.vue');
  assert.equal(documentKey({ fileName: 'fallback.vue' }), 'fallback.vue');
  assert.equal(documentKey(), '');
});

test('filters untitled, non-file, clean, and read-only documents', () => {
  assert.equal(isSaveCandidate(document('a.vue', { isUntitled: true }), false), false);
  assert.equal(isSaveCandidate(document('a.vue', { uri: { scheme: 'http' } }), false), false);
  assert.equal(isSaveCandidate(document('a.vue', { isDirty: false }), false), false);
  assert.equal(isSaveCandidate(document('a.vue'), true), false);
  assert.equal(isSaveCandidate(document('a.vue'), false), true);
});

test('rejects documents without a complete local file URI', () => {
  const fileNameOnly = document('file-name-only.vue');
  delete fileNameOnly.uri;
  const scenarios = [
    { name: 'missing URI', value: fileNameOnly },
    {
      name: 'missing scheme',
      value: document('missing-scheme.vue', {
        uri: { fsPath: 'C:\\project\\missing-scheme.vue' }
      })
    },
    {
      name: 'missing filesystem path',
      value: document('missing-path.vue', { uri: { scheme: 'file' } })
    },
    {
      name: 'empty filesystem path',
      value: document('empty-path.vue', { uri: { scheme: 'file', fsPath: '' } })
    },
    {
      name: 'non-string filesystem path',
      value: document('invalid-path.vue', { uri: { scheme: 'file', fsPath: null } })
    }
  ];

  for (const scenario of scenarios) {
    assert.equal(isSaveCandidate(scenario.value), false, scenario.name);
  }
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

test('serializes a debounced edit behind an unresolved save', async () => {
  const clock = createClock();
  const active = document('index.vue');
  const firstSave = createDeferred();
  let saveCalls = 0;
  let activeSaves = 0;
  let maxActiveSaves = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => {
      saveCalls += 1;
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      try {
        if (saveCalls === 1) await firstSave.promise;
      } finally {
        activeSaves -= 1;
      }
    },
    reportSaveError: () => assert.fail('unexpected error')
  });

  controller.handleDocumentChange({ document: active });
  const initialRun = clock.runLatest();
  await new Promise(setImmediate);
  assert.equal(saveCalls, 1);

  controller.handleDocumentChange({ document: active });
  const followUpRun = clock.runLatest();
  await new Promise(setImmediate);
  const callsBeforeInitialSaveSettled = saveCalls;

  firstSave.resolve();
  await Promise.all([initialRun, followUpRun]);

  assert.equal(callsBeforeInitialSaveSettled, 1);
  assert.equal(saveCalls, 2);
  assert.equal(maxActiveSaves, 1);
});

test('disabling cancels a follow-up waiting behind an issued save', async () => {
  const clock = createClock();
  const settings = { enabled: true, delay: 1000 };
  const active = document('index.vue');
  const firstSave = createDeferred();
  let saveCalls = 0;
  let initialSaveCompleted = false;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => settings,
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => {
      saveCalls += 1;
      if (saveCalls === 1) {
        await firstSave.promise;
        initialSaveCompleted = true;
      }
    },
    reportSaveError: () => assert.fail('unexpected error')
  });

  controller.handleDocumentChange({ document: active });
  const initialRun = clock.runLatest();
  await new Promise(setImmediate);

  controller.handleDocumentChange({ document: active });
  const followUpRun = clock.runLatest();
  await new Promise(setImmediate);
  settings.enabled = false;
  controller.handleConfigurationChange();

  firstSave.resolve();
  await Promise.all([initialRun, followUpRun]);

  assert.equal(initialSaveCompleted, true);
  assert.equal(saveCalls, 1);
});

test('an ineligible change cancels older pending work', () => {
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
  controller.handleDocumentChange({ document: document('index.vue', { isDirty: false }) });
  assert.equal(clock.pending().length, 0);
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

test('does not save a new active document switched during filesystem access', async () => {
  const clock = createClock();
  const access = createDeferred();
  const changed = document('old.vue');
  const next = document('new.vue');
  let activeDocument = changed;
  let saves = 0;
  const hx = {
    window: {
      async getActiveTextEditor() {
        return { document: activeDocument };
      }
    },
    commands: {
      async executeCommand(id) {
        assert.equal(id, 'workbench.action.files.save');
        saves += 1;
      }
    }
  };
  const runtime = createHBuilderXRuntime(hx, {
    promises: { access: () => access.promise },
    constants: { W_OK: 2 }
  });
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: () => runtime.getActiveSnapshot(),
    saveActiveDocument: () => runtime.saveActiveDocument(),
    reportSaveError: () => assert.fail('unexpected error')
  });

  controller.handleDocumentChange({ document: changed });
  const inFlight = clock.runLatest();
  await Promise.resolve();
  activeDocument = next;
  access.resolve();
  await inFlight;

  assert.equal(saves, 0);
});

test('saves when the active snapshot is a different object with the same key', async () => {
  const clock = createClock();
  const changed = document('index.vue');
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
  controller.handleDocumentChange({ document: changed });
  await clock.runLatest();
  assert.equal(saves, 1);
});

test('a new edit invalidates an in-flight save check', async () => {
  const clock = createClock();
  const snapshot = createDeferred();
  const changed = document('old.vue');
  const next = document('new.vue');
  let saves = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: () => snapshot.promise,
    saveActiveDocument: async () => { saves += 1; },
    reportSaveError: () => assert.fail('unexpected error')
  });
  controller.handleDocumentChange({ document: changed });
  const inFlight = clock.runLatest();
  controller.handleDocumentChange({ document: next });
  snapshot.resolve({ document: changed, readOnly: false });
  await inFlight;
  assert.equal(saves, 0);
  assert.equal(clock.pending().length, 1);
});

test('rechecks every active document eligibility rule when the timer fires', async () => {
  const cases = [
    { name: 'clean', active: document('index.vue', { isDirty: false }), readOnly: false },
    { name: 'non-file', active: document('index.vue', { uri: { scheme: 'http' } }), readOnly: false },
    { name: 'untitled', active: document('index.vue', { isUntitled: true }), readOnly: false },
    { name: 'read-only', active: document('index.vue'), readOnly: true }
  ];

  for (const scenario of cases) {
    const clock = createClock();
    const changed = document('index.vue');
    let saves = 0;
    const controller = createAutoSaveController({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      getSettings: () => ({ enabled: true, delay: 1000 }),
      getActiveSnapshot: async () => ({
        document: scenario.active,
        readOnly: scenario.readOnly
      }),
      saveActiveDocument: async () => { saves += 1; },
      reportSaveError: () => assert.fail('unexpected error')
    });
    controller.handleDocumentChange({ document: changed });
    await clock.runLatest();
    assert.equal(saves, 0, scenario.name);
  }
});

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

test('disabling settings invalidates an in-flight save check', async () => {
  const clock = createClock();
  const snapshot = createDeferred();
  const settings = { enabled: true, delay: 1000 };
  const active = document('index.vue');
  let saves = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => settings,
    getActiveSnapshot: () => snapshot.promise,
    saveActiveDocument: async () => { saves += 1; },
    reportSaveError: () => assert.fail('unexpected error')
  });
  controller.handleDocumentChange({ document: active });
  const inFlight = clock.runLatest();
  settings.enabled = false;
  controller.handleConfigurationChange();
  snapshot.resolve({ document: active, readOnly: false });
  await inFlight;
  assert.equal(saves, 0);
});

test('an in-flight save check re-reads the enabled setting before saving', async () => {
  const clock = createClock();
  const snapshot = createDeferred();
  const settings = { enabled: true, delay: 1000 };
  const active = document('index.vue');
  let saves = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => settings,
    getActiveSnapshot: () => snapshot.promise,
    saveActiveDocument: async () => { saves += 1; },
    reportSaveError: () => assert.fail('unexpected error')
  });
  controller.handleDocumentChange({ document: active });
  const inFlight = clock.runLatest();
  settings.enabled = false;
  snapshot.resolve({ document: active, readOnly: false });
  await inFlight;
  assert.equal(saves, 0);
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

test('delay changes replace an in-flight save check without dropping the save', async () => {
  const clock = createClock();
  const firstSnapshot = createDeferred();
  const settings = { enabled: true, delay: 1000 };
  const changed = document('index.vue');
  const active = document('index.vue');
  let snapshotCalls = 0;
  let saves = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => settings,
    getActiveSnapshot: () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return firstSnapshot.promise;
      return Promise.resolve({ document: active, readOnly: false });
    },
    saveActiveDocument: async () => { saves += 1; },
    reportSaveError: () => assert.fail('unexpected error')
  });
  controller.handleDocumentChange({ document: changed });
  const staleRun = clock.runLatest();

  settings.delay = 50;
  controller.handleConfigurationChange();
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].delay, 200);

  settings.delay = 400;
  controller.handleConfigurationChange();
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].delay, 400);

  firstSnapshot.resolve({ document: changed, readOnly: false });
  await staleRun;
  assert.equal(saves, 0);

  await clock.runLatest();
  await clock.runLatest();
  assert.equal(saves, 1);
  assert.equal(snapshotCalls, 2);
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

test('dispose invalidates an in-flight save check', async () => {
  const clock = createClock();
  const snapshot = createDeferred();
  const active = document('index.vue');
  let saves = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: () => snapshot.promise,
    saveActiveDocument: async () => { saves += 1; },
    reportSaveError: () => assert.fail('unexpected error')
  });
  controller.handleDocumentChange({ document: active });
  const inFlight = clock.runLatest();
  controller.dispose();
  snapshot.resolve({ document: active, readOnly: false });
  await inFlight;
  assert.equal(saves, 0);
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

test('absorbs a synchronous error from the save error reporter', async () => {
  const clock = createClock();
  const active = document('index.vue');
  let reports = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => { throw new Error('save failed'); },
    reportSaveError: () => {
      reports += 1;
      throw new Error('report failed');
    }
  });
  controller.handleDocumentChange({ document: active });
  await assert.doesNotReject(clock.runLatest());
  assert.equal(reports, 1);
});

test('absorbs a rejected promise from the save error reporter', async () => {
  const clock = createClock();
  const active = document('index.vue');
  let reports = 0;
  const controller = createAutoSaveController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getSettings: () => ({ enabled: true, delay: 1000 }),
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => { throw new Error('save failed'); },
    reportSaveError: async () => {
      reports += 1;
      throw new Error('report failed');
    }
  });
  controller.handleDocumentChange({ document: active });
  await assert.doesNotReject(clock.runLatest());
  await new Promise(setImmediate);
  assert.equal(reports, 1);
});
