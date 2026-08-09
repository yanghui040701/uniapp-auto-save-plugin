const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHBuilderXRuntime } = require('../lib/hbuilderx-runtime');

function resolvingThenable(value) {
  return { then(resolve) { resolve(value); } };
}

function rejectingThenable(error) {
  return { then(resolve, reject) { reject(error); } };
}

function localDocument(filePath = 'C:\\project\\index.vue') {
  return {
    fileName: filePath,
    uri: { scheme: 'file', fsPath: filePath },
    isDirty: true,
    isUntitled: false
  };
}

function filesystemWithAccess(access) {
  return { promises: { access }, constants: { W_OK: 2 } };
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
  const doc = localDocument();
  let filesystemAccesses = 0;
  const filesystem = filesystemWithAccess(() => {
    filesystemAccesses += 1;
  });
  hx.window.getActiveTextEditor = async () => ({ document: doc, isReadonly: true });
  assert.deepEqual(await createHBuilderXRuntime(hx, filesystem).getActiveSnapshot(), {
    document: doc,
    readOnly: true
  });
  hx.window.getActiveTextEditor = async () => ({ document: doc, readonly: true });
  assert.equal((await createHBuilderXRuntime(hx, filesystem).getActiveSnapshot()).readOnly, true);
  assert.equal(filesystemAccesses, 0);
});

test('active snapshot maps a Windows permission rejection to readonly', async () => {
  const hx = fakeHx();
  const doc = localDocument('C:\\project\\readonly.vue');
  const calls = [];
  const filesystem = filesystemWithAccess(async (filePath, mode) => {
    calls.push([filePath, mode]);
    const error = new Error('operation not permitted');
    error.code = 'EPERM';
    throw error;
  });
  hx.window.getActiveTextEditor = async () => ({ document: doc });

  assert.deepEqual(await createHBuilderXRuntime(hx, filesystem).getActiveSnapshot(), {
    document: doc,
    readOnly: true
  });
  assert.deepEqual(calls, [['C:\\project\\readonly.vue', 2]]);
});

test('active snapshot keeps an accessible local file writable', async () => {
  const hx = fakeHx();
  const doc = localDocument();
  const calls = [];
  const filesystem = filesystemWithAccess(async (filePath, mode) => {
    calls.push([filePath, mode]);
  });
  hx.window.getActiveTextEditor = async () => ({ document: doc });

  assert.deepEqual(await createHBuilderXRuntime(hx, filesystem).getActiveSnapshot(), {
    document: doc,
    readOnly: false
  });
  assert.deepEqual(calls, [['C:\\project\\index.vue', 2]]);
});

test('active snapshot does not inspect ineligible documents', async () => {
  const scenarios = [
    { name: 'non-local', document: { ...localDocument(), uri: { scheme: 'untitled', fsPath: 'C:\\project\\index.vue' } } },
    { name: 'untitled', document: { ...localDocument(), isUntitled: true } },
    { name: 'missing path', document: { ...localDocument(), uri: { scheme: 'file' } } },
    { name: 'empty path', document: { ...localDocument(), uri: { scheme: 'file', fsPath: '' } } }
  ];

  for (const { name, document } of scenarios) {
    const hx = fakeHx();
    let filesystemAccesses = 0;
    const filesystem = filesystemWithAccess(() => {
      filesystemAccesses += 1;
    });
    hx.window.getActiveTextEditor = async () => ({ document });

    assert.deepEqual(
      await createHBuilderXRuntime(hx, filesystem).getActiveSnapshot(),
      { document, readOnly: false },
      name
    );
    assert.equal(filesystemAccesses, 0, name);
  }
});

test('filesystem access assimilates a custom rejecting thenable', async () => {
  const hx = fakeHx();
  const doc = localDocument();
  const error = new Error('permission denied');
  error.code = 'EACCES';
  const filesystem = filesystemWithAccess(() => rejectingThenable(error));
  hx.window.getActiveTextEditor = async () => ({ document: doc });

  assert.equal(
    (await createHBuilderXRuntime(hx, filesystem).getActiveSnapshot()).readOnly,
    true
  );
});

test('filesystem access handles synchronous permission errors', async () => {
  const hx = fakeHx();
  const doc = localDocument();
  const filesystem = filesystemWithAccess(() => {
    const error = new Error('operation not permitted');
    error.code = 'EPERM';
    throw error;
  });
  hx.window.getActiveTextEditor = async () => ({ document: doc });

  assert.equal(
    (await createHBuilderXRuntime(hx, filesystem).getActiveSnapshot()).readOnly,
    true
  );
});

test('filesystem access leaves unknown errors for the normal save path', async () => {
  const hx = fakeHx();
  const doc = localDocument();
  const filesystem = filesystemWithAccess(async () => {
    const error = new Error('device unavailable');
    error.code = 'EIO';
    throw error;
  });
  hx.window.getActiveTextEditor = async () => ({ document: doc });

  await assert.doesNotReject(async () => {
    assert.equal(
      (await createHBuilderXRuntime(hx, filesystem).getActiveSnapshot()).readOnly,
      false
    );
  });
});

test('default filesystem capability detects a Windows ReadOnly temp file', {
  skip: process.platform !== 'win32'
}, async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yanghui-readonly-'));
  const filePath = path.join(tempDirectory, 'readonly.vue');
  try {
    fs.writeFileSync(filePath, '<template />', 'utf8');
    fs.chmodSync(filePath, 0o444);
    const hx = fakeHx();
    const doc = localDocument(filePath);
    hx.window.getActiveTextEditor = async () => ({ document: doc });

    assert.equal(
      (await createHBuilderXRuntime(hx).getActiveSnapshot()).readOnly,
      true
    );
  } finally {
    try {
      if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o666);
    } finally {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } finally {
        if (fs.existsSync(tempDirectory)) fs.rmdirSync(tempDirectory);
      }
    }
  }
  assert.equal(fs.existsSync(tempDirectory), false);
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

  assert.deepEqual(await createHBuilderXRuntime(
    hx,
    filesystemWithAccess(async () => undefined)
  ).getActiveSnapshot(), {
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
  assert.match(options.text, /denied/);
  assert.doesNotMatch(options.text, /private|project/);
});

test('save errors preserve short ordinary reasons', async () => {
  const reasons = [
    'denied',
    'EACCES: permission denied',
    '权限不足',
    '  temporarily unavailable  '
  ];

  for (const reason of reasons) {
    const hx = fakeHx();
    await createHBuilderXRuntime(hx).reportSaveError(
      new Error(reason),
      { fileName: 'C:\\project\\index.vue' }
    );
    const options = hx.calls.find(call => call[0] === 'messageBox')[1];
    assert.equal(
      options.text,
      `自动保存 index.vue 失败：${reason.trim()}`
    );
  }
});

test('save errors replace suspicious reasons with one fixed explanation', async () => {
  const reasons = [
    'Unable to write C:\\private\\project\\index.vue',
    'Unable to write c:/PRIVATE/PROJECT/INDEX.VUE',
    'Unable to write /private/project/index.vue',
    'Unable to write file:///C:/private/project/index.vue',
    'see mailto:user@example.com',
    'see(mailto:user@example.com)',
    'data:text/plain,secret',
    'C:index.vue',
    'C%3A%5Cprivate%5Cproject%5Cindex.vue',
    '%2Fprivate%2Fproject%2Findex.vue',
    'file%3A%2F%2F%2FC%3A%2Fprivate%2Fproject%2Findex.vue',
    'C%253A%255Cprivate%255Cproject%255Cindex.vue',
    'c%3a%5cprivate%5cproject%5cindex.vue',
    'disk is 100% full',
    'secret\nnext line',
    'secret\ttab',
    '\ndenied',
    'denied\t',
    'secret\u0085next line',
    '\u0085denied',
    'secret\u009Fcontrol',
    'secret\u2028line separator',
    '\u2028denied',
    'secret\u2029paragraph separator',
    'denied\u2029',
    `too long ${'x'.repeat(200)}`,
    ''
  ];

  for (const reason of reasons) {
    const hx = fakeHx();
    await createHBuilderXRuntime(hx).reportSaveError(
      new Error(reason),
      { fileName: 'C:\\project\\index.vue' }
    );
    const options = hx.calls.find(call => call[0] === 'messageBox')[1];
    assert.equal(
      options.text,
      '自动保存 index.vue 失败：请检查文件权限或磁盘状态后重试。'
    );
  }
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

test('raw filenames fail closed on Unicode controls and separators', async () => {
  const unsafeNames = [
    'foo\u0085bar.vue',
    'foo\u009Fbar.vue',
    'foo\u2028bar.vue',
    'foo\u2029bar.vue'
  ];

  for (const fileName of unsafeNames) {
    const hx = fakeHx();
    await createHBuilderXRuntime(hx).reportSaveError(
      new Error('denied'),
      { fileName: `C:\\project\\${fileName}` }
    );
    const options = hx.calls.find(call => call[0] === 'messageBox')[1];
    assert.equal(options.text, '自动保存 当前文件 失败：denied');
    assert.doesNotMatch(options.text, /[\u007F-\u009F\u2028\u2029]/);
  }
});

test('URI filenames decode before applying Windows and POSIX basename rules', async () => {
  const scenarios = [
    {
      uri: 'file:///placeholder/C%3A%5Cprivate%5Cproject%5Cindex.vue',
      expected: 'index.vue'
    },
    {
      uri: 'file:///placeholder/%2Fprivate%2Fproject%2Findex.vue',
      expected: 'index.vue'
    },
    {
      uri: 'file:///safe/index%23name.vue?token=secret#fragment',
      expected: 'index#name.vue'
    }
  ];

  for (const scenario of scenarios) {
    const hx = fakeHx();
    await createHBuilderXRuntime(hx).reportSaveError(
      new Error('denied'),
      { uri: { toString: () => scenario.uri } }
    );
    const options = hx.calls.find(call => call[0] === 'messageBox')[1];
    assert.equal(options.text, `自动保存 ${scenario.expected} 失败：denied`);
    assert.doesNotMatch(options.text, /private|project|placeholder|token|fragment/i);
  }
});

test('URI filenames fail closed on malformed encoding and decoded control characters', async () => {
  const unsafeUris = [
    'file:///safe/foo%0Abar.vue',
    'file:///safe/foo%00bar.vue',
    'file:///safe/foo%7Fbar.vue',
    'file:///safe/foo%C2%85bar.vue',
    'file:///safe/foo%C2%9Fbar.vue',
    'file:///safe/foo%E2%80%A8bar.vue',
    'file:///safe/foo%E2%80%A9bar.vue',
    'file:///safe/foo%ZZbar.vue'
  ];

  for (const uri of unsafeUris) {
    const hx = fakeHx();
    await createHBuilderXRuntime(hx).reportSaveError(
      new Error('denied'),
      { uri: { toString: () => uri } }
    );
    const options = hx.calls.find(call => call[0] === 'messageBox')[1];
    assert.equal(options.text, '自动保存 当前文件 失败：denied');
    assert.doesNotMatch(options.text, /[\u0000-\u001F\u007F-\u009F\u2028\u2029%]/);
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
    title: '\u5f00\u542f HBuilderX \u5931\u53bb\u7126\u70b9\u81ea\u52a8\u4fdd\u5b58',
    text: '\u68c0\u6d4b\u5230 HBuilderX \u7684\u201c\u5931\u53bb\u7126\u70b9\u81ea\u52a8\u4fdd\u5b58\u201d\u5df2\u5173\u95ed\u3002\u5f00\u542f\u540e\uff0c\u5373\u4f7f\u5728\u81ea\u52a8\u4fdd\u5b58\u5012\u8ba1\u65f6\u7ed3\u675f\u524d\u5207\u6362\u6587\u4ef6\u6216\u5e94\u7528\uff0c\u4e5f\u80fd\u4fdd\u5b58\u521a\u79bb\u5f00\u7684\u6587\u4ef6\u3002\u662f\u5426\u73b0\u5728\u5f00\u542f\uff1f',
    buttons: ['\u5f00\u542f', '\u4e0d\u518d\u63d0\u793a']
  });
});

test('native prompt assimilates a custom HBuilderX thenable', async () => {
  const hx = fakeHx();
  hx.window.showMessageBox = options => {
    hx.calls.push(['messageBox', options]);
    return resolvingThenable(options.buttons[1]);
  };

  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'suppress');
});

test('native prompt distinguishes dismissal and unknown selections', async () => {
  const hx = fakeHx();
  hx.window.showMessageBox = async () => undefined;
  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'dismiss');

  hx.window.showMessageBox = async () => '\u672a\u77e5\u6309\u94ae';
  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'dismiss');
});

test('native prompt maps notification API failure to dismiss', async () => {
  const hx = fakeHx();

  hx.window.showMessageBox = async () => { throw new Error('window unavailable'); };
  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'dismiss');

  delete hx.window.showMessageBox;
  assert.equal(await createHBuilderXRuntime(hx).promptNativeFocusSave(), 'dismiss');
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
  assert.equal(await runtime.promptNativeFocusSave(), 'dismiss');
});

test('best-effort notifications assimilate rejected custom thenables', async () => {
  const hx = fakeHx();
  hx.window.showMessageBox = () => rejectingThenable(new Error('thenable UI failure'));
  const runtime = createHBuilderXRuntime(hx);

  await assert.doesNotReject(runtime.reportInternalError(new Error('internal')));
  assert.equal(await runtime.promptNativeFocusSave(), 'dismiss');
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
