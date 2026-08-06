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

test('save error redacts the document path from the underlying error reason', async () => {
  const hx = fakeHx();
  const fileName = 'C:\\private\\project\\index.vue';
  await createHBuilderXRuntime(hx).reportSaveError(
    new Error(`Unable to write ${fileName}`),
    { fileName }
  );
  const options = hx.calls.find(call => call[0] === 'messageBox')[1];
  assert.match(options.text, /Unable to write/);
  assert.match(options.text, /index\.vue/);
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

test('event and command registration return HBuilderX disposables', () => {
  const hx = fakeHx();
  const runtime = createHBuilderXRuntime(hx);
  assert.equal(typeof runtime.onDocumentChange(() => {}).dispose, 'function');
  assert.equal(typeof runtime.onConfigurationChange(() => {}).dispose, 'function');
  assert.equal(typeof runtime.registerCommand('command.id', () => {}).dispose, 'function');
});
