const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHBuilderXRuntime } = require('../lib/hbuilderx-runtime');

function resolvingThenable(value) {
  return { then(resolve) { resolve(value); } };
}

function rejectingThenable(error) {
  return { then(resolve, reject) { reject(error); } };
}

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

test('uses plugin defaults while leaving delay normalization to the controller', () => {
  const hx = fakeHx();
  delete hx.values['hbuilderx-auto-save.enabled'];
  delete hx.values['hbuilderx-auto-save.delay'];
  assert.deepEqual(createHBuilderXRuntime(hx).getSettings(), {
    enabled: true,
    delay: 1000
  });

  hx.values['hbuilderx-auto-save.delay'] = 'not-normalized';
  assert.equal(createHBuilderXRuntime(hx).getSettings().delay, 'not-normalized');
});

test('plugin settings use defaults when the configuration getter is unavailable', () => {
  const hx = fakeHx();
  hx.workspace.getConfiguration = () => ({});

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

test('passes a rejected save command to the controller', async () => {
  const hx = fakeHx();
  const failure = new Error('save failed');
  hx.commands.executeCommand = async id => {
    hx.calls.push(['executeCommand', id]);
    throw failure;
  };

  await assert.rejects(
    createHBuilderXRuntime(hx).saveActiveDocument(),
    error => error === failure
  );
  assert.deepEqual(hx.calls, [['executeCommand', 'workbench.action.files.save']]);
});

test('save command assimilates a custom HBuilderX thenable', async () => {
  const hx = fakeHx();
  hx.commands.executeCommand = id => {
    hx.calls.push(['executeCommand', id]);
    return resolvingThenable('saved');
  };

  assert.equal(await createHBuilderXRuntime(hx).saveActiveDocument(), 'saved');
});

test('save command propagates synchronous HBuilderX errors', () => {
  const hx = fakeHx();
  const failure = new Error('command unavailable');
  hx.commands.executeCommand = () => { throw failure; };

  assert.throws(
    () => createHBuilderXRuntime(hx).saveActiveDocument(),
    error => error === failure
  );
});

test('updates and verifies native focus-loss saving', async () => {
  const hx = fakeHx();
  const runtime = createHBuilderXRuntime(hx);
  assert.equal(runtime.isNativeFocusSaveEnabled(), false);
  await runtime.enableNativeFocusSave();
  assert.equal(runtime.isNativeFocusSaveEnabled(), true);
  assert.deepEqual(hx.calls[0], ['update', 'editor', 'saveOnFocusLost', true]);
});

test('native setting update rejects when the fresh configuration cannot verify it', async () => {
  const hx = fakeHx();
  hx.workspace.getConfiguration = section => ({
    get(key, fallback) {
      return section === 'editor' && key === 'saveOnFocusLost' ? false : fallback;
    },
    async update(key, value) {
      hx.calls.push(['update', section, key, value]);
    }
  });

  await assert.rejects(
    createHBuilderXRuntime(hx).enableNativeFocusSave(),
    /saveOnFocusLost/
  );
  assert.deepEqual(hx.calls, [['update', 'editor', 'saveOnFocusLost', true]]);
});

test('native setting update exposes a rejected HBuilderX update', async () => {
  const hx = fakeHx();
  const failure = new Error('unsupported');
  hx.workspace.getConfiguration = () => ({
    get: () => false,
    update: async () => { throw failure; }
  });

  await assert.rejects(
    createHBuilderXRuntime(hx).enableNativeFocusSave(),
    error => error === failure
  );
});

test('native setting read returns false when the configuration getter is unavailable', () => {
  const hx = fakeHx();
  hx.workspace.getConfiguration = () => ({});
  assert.equal(createHBuilderXRuntime(hx).isNativeFocusSaveEnabled(), false);

  hx.workspace.getConfiguration = () => { throw new Error('unsupported'); };
  assert.equal(createHBuilderXRuntime(hx).isNativeFocusSaveEnabled(), false);
});

test('native setting update rejects when the update API is unavailable', async () => {
  const hx = fakeHx();
  hx.workspace.getConfiguration = () => ({ get: () => false });

  await assert.rejects(createHBuilderXRuntime(hx).enableNativeFocusSave());
});

test('native setting update verifies through a fresh configuration object', async () => {
  const hx = fakeHx();
  let configurationReads = 0;
  hx.workspace.getConfiguration = section => {
    assert.equal(section, 'editor');
    configurationReads += 1;
    if (configurationReads === 1) {
      return {
        get: () => false,
        update(key, value) {
          hx.calls.push(['update', section, key, value]);
          return resolvingThenable(undefined);
        }
      };
    }
    return { get: () => true };
  };

  await createHBuilderXRuntime(hx).enableNativeFocusSave();
  assert.equal(configurationReads, 2);
  assert.deepEqual(hx.calls, [['update', 'editor', 'saveOnFocusLost', true]]);
});

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

test('active snapshot preserves document scheme, path, and dirty state', async () => {
  const hx = fakeHx();
  const doc = {
    fileName: 'C:\\project\\index.vue',
    uri: { scheme: 'file', fsPath: 'C:\\project\\index.vue' },
    isDirty: true,
    isUntitled: false
  };
  hx.window.getActiveTextEditor = async () => ({ document: doc });

  assert.deepEqual(await createHBuilderXRuntime(hx).getActiveSnapshot(), {
    document: doc,
    readOnly: false
  });
});

test('active snapshot is empty when no editor is active', async () => {
  const hx = fakeHx();
  hx.window.getActiveTextEditor = async () => undefined;
  assert.deepEqual(await createHBuilderXRuntime(hx).getActiveSnapshot(), {
    document: null,
    readOnly: false
  });
});

test('active snapshot is empty when the editor API is unavailable', async () => {
  const hx = fakeHx();
  delete hx.window.getActiveTextEditor;

  assert.deepEqual(await createHBuilderXRuntime(hx).getActiveSnapshot(), {
    document: null,
    readOnly: false
  });
});

test('active snapshot assimilates a custom HBuilderX thenable', async () => {
  const hx = fakeHx();
  const doc = { fileName: 'C:\\project\\thenable.vue' };
  hx.window.getActiveTextEditor = () => resolvingThenable({ document: doc });

  assert.deepEqual(await createHBuilderXRuntime(hx).getActiveSnapshot(), {
    document: doc,
    readOnly: false
  });
});

test('active snapshot propagates synchronous and rejected HBuilderX errors', async () => {
  const hx = fakeHx();
  const synchronousFailure = new Error('editor unavailable');
  hx.window.getActiveTextEditor = () => { throw synchronousFailure; };
  await assert.rejects(
    createHBuilderXRuntime(hx).getActiveSnapshot(),
    error => error === synchronousFailure
  );

  const rejectedFailure = new Error('editor rejected');
  hx.window.getActiveTextEditor = () => rejectingThenable(rejectedFailure);
  await assert.rejects(
    createHBuilderXRuntime(hx).getActiveSnapshot(),
    error => error === rejectedFailure
  );
});

test('active snapshot is empty when the editor lacks a document', async () => {
  const hx = fakeHx();
  hx.window.getActiveTextEditor = async () => ({ readonly: true });

  assert.deepEqual(await createHBuilderXRuntime(hx).getActiveSnapshot(), {
    document: null,
    readOnly: false
  });
});

test('save error displays basename and does not expose the full path', async () => {
  const hx = fakeHx();
  await createHBuilderXRuntime(hx).reportSaveError(
    new Error('denied'),
    { fileName: 'C:\\private\\project\\index.vue' }
  );
  const options = hx.calls.find(call => call[0] === 'messageBox')[1];
  assert.match(options.text, /index\.vue/);
  assert.match(options.text, /文件权限或磁盘状态/);
  assert.doesNotMatch(options.text, /denied/);
  assert.doesNotMatch(options.text, /private|project/);
});

test('save errors use a basename and fixed reason for every supported document path shape', async () => {
  const scenarios = [
    {
      document: {
        fileName: 'index.vue',
        uri: { fsPath: 'C:\\private\\project\\index.vue' }
      },
      error: new Error('Unable to write c:/PRIVATE/PROJECT/INDEX.VUE')
    },
    {
      document: { uri: { path: '/private/project/index.vue' } },
      error: new Error('Unable to write /private/project/index.vue')
    },
    {
      document: {
        uri: { toString: () => 'file:///C:/private/project/index.vue' }
      },
      error: new Error('Unable to write file:///C:/private/project/index.vue')
    }
  ];

  for (const scenario of scenarios) {
    const hx = fakeHx();
    await createHBuilderXRuntime(hx).reportSaveError(
      scenario.error,
      scenario.document
    );
    const options = hx.calls.find(call => call[0] === 'messageBox')[1];
    assert.match(options.text, /index\.vue/);
    assert.match(options.text, /文件权限或磁盘状态/);
    assert.doesNotMatch(options.text, /private|project|Unable|file:\/\//i);
  }
});

test('save error preserves special characters in raw filesystem basenames', async () => {
  const scenarios = [
    { document: { fileName: 'C:\\project\\foo#bar.vue' }, expected: 'foo#bar.vue' },
    { document: { uri: { path: '/project/foo?bar.vue' } }, expected: 'foo?bar.vue' },
    { document: { fileName: 'C:\\project\\foo%23bar.vue' }, expected: 'foo%23bar.vue' },
    { document: { fileName: 'C:\\project\\foo%0Abar.vue' }, expected: 'foo%0Abar.vue' }
  ];

  for (const scenario of scenarios) {
    const hx = fakeHx();
    await createHBuilderXRuntime(hx).reportSaveError(
      new Error('denied'),
      scenario.document
    );
    const options = hx.calls.find(call => call[0] === 'messageBox')[1];
    assert.match(options.text, new RegExp(scenario.expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(options.text, /\n/);
  }
});

test('internal errors never expose their raw message', async () => {
  const hx = fakeHx();
  await createHBuilderXRuntime(hx).reportInternalError(
    new Error('Failure at C:\\private\\project\\index.vue token=secret')
  );
  const options = hx.calls.find(call => call[0] === 'messageBox')[1];
  assert.match(options.text, /重新加载 HBuilderX/);
  assert.doesNotMatch(options.text, /private|project|index\.vue|token|secret|Failure/i);
});

test('native prompt maps the selected Chinese button to a stable result', async () => {
  const hx = fakeHx();
  const runtime = createHBuilderXRuntime(hx);
  assert.equal(await runtime.promptNativeFocusSave(), 'enable');
  const options = hx.calls.find(call => call[0] === 'messageBox')[1];
  assert.deepEqual(options, {
    type: 'question',
    title: '开启 HBuilderX 原生保存',
    text: '是否开启 HBuilderX 的失去焦点自动保存？这可确保快速切换文件或应用时保存离开的文件。',
    buttons: ['开启', '暂不开启']
  });
});

test('native prompt assimilates a custom HBuilderX thenable', async () => {
  const hx = fakeHx();
  hx.window.showMessageBox = options => {
    hx.calls.push(['messageBox', options]);
    return resolvingThenable(options.buttons[1]);
  };

  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'decline');
});

test('native prompt maps dismissal and notification API failure to decline', async () => {
  const hx = fakeHx();
  hx.window.showMessageBox = async () => undefined;
  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'decline');

  hx.window.showMessageBox = async () => { throw new Error('window unavailable'); };
  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'decline');

  delete hx.window.showMessageBox;
  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'decline');
});

test('error and status notifications are best-effort', async () => {
  const hx = fakeHx();
  const runtime = createHBuilderXRuntime(hx);
  hx.window.showMessageBox = async () => { throw new Error('window unavailable'); };

  await assert.doesNotReject(runtime.reportSaveError(new Error('denied'), {
    fileName: 'C:\\project\\index.vue'
  }));
  await assert.doesNotReject(runtime.reportInternalError(new Error('prompt failed')));
  await assert.doesNotReject(runtime.showNativeFocusSaveEnabled());
  await assert.doesNotReject(runtime.showNativeFocusSaveManualFallback());

  delete hx.window.showMessageBox;
  await assert.doesNotReject(runtime.reportInternalError(new Error('missing API')));
});

test('best-effort notifications absorb synchronous message-box errors', async () => {
  const hx = fakeHx();
  hx.window.showMessageBox = () => { throw new Error('synchronous UI failure'); };
  const runtime = createHBuilderXRuntime(hx);

  await assert.doesNotReject(runtime.reportSaveError(new Error('denied'), {
    fileName: 'C:\\project\\index.vue'
  }));
  await assert.doesNotReject(runtime.reportInternalError(new Error('internal')));
  await assert.doesNotReject(runtime.showNativeFocusSaveEnabled());
  await assert.doesNotReject(runtime.showNativeFocusSaveManualFallback());
  assert.equal(await runtime.promptNativeFocusSave(), 'decline');
});

test('best-effort notifications assimilate rejected custom thenables', async () => {
  const hx = fakeHx();
  hx.window.showMessageBox = () => rejectingThenable(new Error('thenable UI failure'));
  const runtime = createHBuilderXRuntime(hx);

  await assert.doesNotReject(runtime.reportInternalError(new Error('internal')));
  assert.equal(await runtime.promptNativeFocusSave(), 'decline');
});

test('fire-and-forget notification failures do not create unhandled rejections', () => {
  const script = `
    const { createHBuilderXRuntime } = require('./lib/hbuilderx-runtime');
    const hx = { window: { showMessageBox() { return Promise.reject(new Error('UI failed')); } } };
    const runtime = createHBuilderXRuntime(hx);
    runtime.reportSaveError(new Error('save'), { fileName: 'index.vue' });
    runtime.reportInternalError(new Error('internal'));
    runtime.showNativeFocusSaveEnabled();
    runtime.showNativeFocusSaveManualFallback();
    setImmediate(() => process.exit(0));
  `;
  const result = spawnSync(
    process.execPath,
    ['--unhandled-rejections=strict', '-e', script],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
});

test('event and command registration return HBuilderX disposables', () => {
  const hx = fakeHx();
  const runtime = createHBuilderXRuntime(hx);
  assert.equal(typeof runtime.onDocumentChange(() => {}).dispose, 'function');
  assert.equal(typeof runtime.onConfigurationChange(() => {}).dispose, 'function');
  assert.equal(typeof runtime.registerCommand('command.id', () => {}).dispose, 'function');
});
