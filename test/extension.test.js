const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const {
  activate,
  startExtension,
  activateWithRuntime,
  deactivate
} = require('../extension');

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
  let subscriptionDisposals = 0;
  const disposable = () => ({
    dispose() { subscriptionDisposals += 1; }
  });
  const runtime = {
    getSettings: () => settings,
    getActiveSnapshot: async () => ({ document: active, readOnly: false }),
    saveActiveDocument: async () => {},
    reportSaveError: () => {},
    reportInternalError: error => assert.fail(error),
    onDocumentChange(listener) {
      listeners.change = listener;
      return disposable();
    },
    onConfigurationChange(listener) {
      listeners.config = listener;
      return disposable();
    },
    registerCommand(id, listener) {
      assert.equal(id, 'yanghui-auto-save.checkFocusSave');
      listeners.command = listener;
      return disposable();
    }
  };
  return {
    active,
    context,
    listeners,
    runtime,
    settings,
    subscriptionDisposals: () => subscriptionDisposals
  };
}

function createProductionHx(appData) {
  const disposable = { dispose() {} };
  return {
    env: appData === undefined ? {} : { appData },
    workspace: {
      getConfiguration(section) {
        return {
          get(key, fallback) {
            if (section === 'editor' && key === 'saveOnFocusLost') return true;
            return fallback;
          },
          update() { return Promise.resolve(); }
        };
      },
      onDidChangeTextDocument() { return disposable; },
      onDidChangeConfiguration() { return disposable; }
    },
    commands: {
      executeCommand() { return Promise.resolve(); },
      registerCommand() { return disposable; }
    },
    window: {}
  };
}

async function withMockedModules(replacements, action) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.hasOwn(replacements, request)) return replacements[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await action();
  } finally {
    Module._load = originalLoad;
  }
}

test.afterEach(() => {
  deactivate();
});

test('importing the extension in Node does not load HBuilderX', () => {
  const script = `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      assert.notEqual(request, 'hbuilderx');
      return originalLoad.call(this, request, parent, isMain);
    };
    require('./extension');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
});

test('wires subscriptions, command, controller, and first-run check', async () => {
  const fixture = createRuntimeFixture();
  const focusCoordinator = {
    calls: [],
    ensure(options) {
      this.calls.push(options);
      return Promise.resolve();
    }
  };
  const instance = startExtension(fixture.context, fixture.runtime, {
    focusCoordinator,
    setTimeout() { return 1; },
    clearTimeout() {}
  });

  await instance.ready;
  assert.deepEqual(focusCoordinator.calls, [{ force: false }]);
  assert.equal(fixture.context.subscriptions.length, 3);
  await fixture.listeners.command();
  assert.deepEqual(focusCoordinator.calls.at(-1), { force: true });
});

test('document change schedules save and dispose cancels only controller state', () => {
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
  instance.dispose();
  assert.equal(cleared, 1);
  assert.equal(fixture.subscriptionDisposals(), 0);
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

test('activateWithRuntime replaces the previous instance and deactivate is idempotent', async () => {
  const first = createRuntimeFixture();
  const second = createRuntimeFixture();
  let firstCleared = 0;
  let secondCleared = 0;

  await activateWithRuntime(first.context, first.runtime, {
    focusCoordinator: { ensure: async () => {} },
    setTimeout: () => 9,
    clearTimeout: () => { firstCleared += 1; }
  });
  first.listeners.change({ document: first.active });

  await activateWithRuntime(second.context, second.runtime, {
    focusCoordinator: { ensure: async () => {} },
    setTimeout: () => 10,
    clearTimeout: () => { secondCleared += 1; }
  });
  assert.equal(firstCleared, 1);
  second.listeners.change({ document: second.active });

  deactivate();
  deactivate();
  assert.equal(secondCleared, 1);
});

test('first-run failures from sync, Promise, and custom thenable inputs never reject ready', async () => {
  const failures = [
    {
      name: 'sync',
      fail(error) { throw error; }
    },
    {
      name: 'Promise',
      fail(error) { return Promise.reject(error); }
    },
    {
      name: 'custom thenable',
      fail(error) {
        return { then(_resolve, reject) { reject(error); } };
      }
    }
  ];

  for (const failure of failures) {
    const fixture = createRuntimeFixture();
    const reports = [];
    fixture.runtime.reportInternalError = error => { reports.push(error.message); };
    const instance = startExtension(fixture.context, fixture.runtime, {
      focusCoordinator: {
        ensure() { return failure.fail(new Error(`${failure.name} prompt failed`)); }
      }
    });

    await assert.doesNotReject(instance.ready, failure.name);
    assert.deepEqual(reports, [`${failure.name} prompt failed`]);
    instance.dispose();
  }
});

test('internal error reporting failures never reject ready', async () => {
  const failures = [
    error => { throw error; },
    error => Promise.reject(error),
    error => ({ then(_resolve, reject) { reject(error); } })
  ];

  for (const reportInternalError of failures) {
    const fixture = createRuntimeFixture();
    fixture.runtime.reportInternalError = reportInternalError;
    const instance = startExtension(fixture.context, fixture.runtime, {
      focusCoordinator: { ensure() { throw new Error('prompt failed'); } }
    });

    await assert.doesNotReject(instance.ready);
    instance.dispose();
  }
});

test('ignored command and event callbacks are strict-unhandled-safe', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { startExtension } = require('./extension');
    const failures = {
      sync(error) { throw error; },
      promise(error) { return Promise.reject(error); },
      thenable(error) { return { then(_resolve, reject) { reject(error); } }; }
    };
    const kinds = Object.keys(failures);
    let reports = 0;
    for (const ensureKind of kinds) {
      for (const reporterKind of kinds) {
        const listeners = {};
        const runtime = {
          getSettings() { throw new Error('settings failed'); },
          getActiveSnapshot: async () => ({ document: null, readOnly: false }),
          saveActiveDocument: async () => {},
          reportSaveError: () => {},
          reportInternalError(error) {
            reports += 1;
            return failures[reporterKind](error);
          },
          onDocumentChange(listener) {
            listeners.change = listener;
            return { dispose() {} };
          },
          onConfigurationChange(listener) {
            listeners.config = listener;
            return { dispose() {} };
          },
          registerCommand(_id, listener) {
            listeners.command = listener;
            return { dispose() {} };
          }
        };
        startExtension({ subscriptions: [] }, runtime, {
          focusCoordinator: {
            ensure({ force }) {
              if (!force) return undefined;
              return failures[ensureKind](new Error('command failed'));
            }
          }
        });
        listeners.command();
        listeners.change({ document: { isDirty: true } });
        listeners.config({});
      }
    }
    setImmediate(() => {
      assert.equal(reports, 27);
    });
  `;
  const result = spawnSync(
    process.execPath,
    ['--unhandled-rejections=strict', '-e', script],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
});

test('production activation stores state under HBuilderX appData, never extensionPath', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanghui-extension-appdata-'));
  const appData = path.join(root, 'app-data');
  const extensionPath = path.join(root, 'published-extension');
  fs.mkdirSync(extensionPath, { recursive: true });
  const context = { subscriptions: [], extensionPath };
  const stateFile = path.join(appData, 'extensions', 'yanghui-auto-save', 'state.json');

  try {
    await withMockedModules({ hbuilderx: createProductionHx(appData) }, () => activate(context));

    assert.equal(fs.existsSync(stateFile), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), {
      focusSavePromptHandled: true
    });
    assert.deepEqual(fs.readdirSync(extensionPath), []);
    assert.equal(context.subscriptions.length, 3);
  } finally {
    deactivate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production activation falls back to the user home when appData is unavailable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanghui-extension-home-'));
  const fallbackHome = path.join(root, 'home');
  const extensionPath = path.join(root, 'published-extension');
  fs.mkdirSync(extensionPath, { recursive: true });
  const context = { subscriptions: [], extensionPath };
  const stateFile = path.join(fallbackHome, '.hbuilderx-auto-save', 'state.json');

  try {
    await withMockedModules({
      hbuilderx: createProductionHx(undefined),
      'node:os': { homedir: () => fallbackHome }
    }, () => activate(context));

    assert.equal(fs.existsSync(stateFile), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), {
      focusSavePromptHandled: true
    });
    assert.deepEqual(fs.readdirSync(extensionPath), []);
  } finally {
    deactivate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
