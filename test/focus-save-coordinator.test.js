const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createFocusSaveCoordinator } = require('../lib/focus-save-coordinator');

function fixture(overrides = {}) {
  const calls = [];
  const runtime = {
    isNativeFocusSaveEnabled: () => { calls.push('native'); return false; },
    promptNativeFocusSave: async () => { calls.push('prompt'); return 'enable'; },
    enableNativeFocusSave: async () => { calls.push('update'); },
    showNativeFocusSaveEnabled: async () => { calls.push('enabled-info'); },
    showNativeFocusSaveManualFallback: async () => { calls.push('manual-fallback'); },
    ...overrides.runtime
  };
  const state = overrides.state || {
    isSuppressed: () => false,
    suppress: () => { calls.push('suppress'); return true; }
  };
  return { calls, coordinator: createFocusSaveCoordinator({ runtime, state }) };
}

function trackingState(calls, suppressed = false) {
  return {
    isSuppressed: () => { calls.push('state'); return suppressed; },
    suppress: () => { calls.push('suppress'); return true; }
  };
}

function rejectingThenable(error, onThen = () => {}) {
  return { then(_resolve, reject) { onThen(); reject(error); } };
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('automatic check ends silently when native focus save is already enabled', async () => {
  const item = fixture({ runtime: { isNativeFocusSaveEnabled: () => { item.calls.push('native'); return true; } } });
  await item.coordinator.ensure();
  assert.deepEqual(item.calls, ['native']);
});

test('forced check shows enabled information when native focus save is already enabled', async () => {
  const item = fixture({ runtime: { isNativeFocusSaveEnabled: () => { item.calls.push('native'); return true; } } });
  await item.coordinator.ensure({ force: true });
  assert.deepEqual(item.calls, ['native', 'enabled-info']);
});

test('automatic check ends after suppression when native focus save is disabled', async () => {
  const item = fixture({ state: null });
  item.coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { item.calls.push('native'); return false; },
      promptNativeFocusSave: async () => { item.calls.push('prompt'); return 'enable'; }
    },
    state: trackingState(item.calls, true)
  });
  await item.coordinator.ensure();
  assert.deepEqual(item.calls, ['native', 'state']);
});

test('forced check ignores suppression when native focus save is disabled', async () => {
  const item = fixture({ state: null });
  item.coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { item.calls.push('native'); return false; },
      promptNativeFocusSave: async () => { item.calls.push('prompt'); return 'dismiss'; }
    },
    state: trackingState(item.calls, true)
  });
  await item.coordinator.ensure({ force: true });
  assert.deepEqual(item.calls, ['native', 'prompt']);
});

test('enable choice updates native focus save without suppressing state', async () => {
  const item = fixture({ state: null });
  item.coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { item.calls.push('native'); return false; },
      promptNativeFocusSave: async () => { item.calls.push('prompt'); return 'enable'; },
      enableNativeFocusSave: async () => { item.calls.push('update'); }
    },
    state: trackingState(item.calls)
  });
  await item.coordinator.ensure();
  assert.deepEqual(item.calls, ['native', 'state', 'prompt', 'update']);
});

test('suppress choice persists suppression without updating native focus save', async () => {
  const item = fixture({ state: null });
  item.coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { item.calls.push('native'); return false; },
      promptNativeFocusSave: async () => { item.calls.push('prompt'); return 'suppress'; }
    },
    state: trackingState(item.calls)
  });
  await item.coordinator.ensure();
  assert.deepEqual(item.calls, ['native', 'state', 'prompt', 'suppress']);
});

test('dismiss choice does not persist suppression or update native focus save', async () => {
  const item = fixture({ state: null });
  item.coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { item.calls.push('native'); return false; },
      promptNativeFocusSave: async () => { item.calls.push('prompt'); return 'dismiss'; }
    },
    state: trackingState(item.calls)
  });
  await item.coordinator.ensure();
  assert.deepEqual(item.calls, ['native', 'state', 'prompt']);
});

test('failed native update shows manual fallback without suppressing state', async () => {
  const item = fixture({ state: null });
  item.coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { item.calls.push('native'); return false; },
      promptNativeFocusSave: async () => { item.calls.push('prompt'); return 'enable'; },
      enableNativeFocusSave: async () => { item.calls.push('update'); throw new Error('unsupported'); },
      showNativeFocusSaveManualFallback: async () => { item.calls.push('manual-fallback'); }
    },
    state: trackingState(item.calls)
  });
  await assert.doesNotReject(item.coordinator.ensure());
  assert.deepEqual(item.calls, ['native', 'state', 'prompt', 'update', 'manual-fallback']);
});

for (const [branch, force, nativeEnabled, choice] of [
  ['prompt', false, false, 'enable'],
  ['enabled-info', true, true, 'enable'],
  ['manual-fallback', false, false, 'enable']
]) {
  for (const failureKind of ['sync', 'promise', 'thenable']) {
    test(`fire-and-forget ${branch} absorbs ${failureKind} failures`, () => {
      const script = `
        const assert = require('node:assert/strict');
        const { createFocusSaveCoordinator } = require('./lib/focus-save-coordinator');
        const calls = [];
        const failure = {
          sync: () => { calls.push(${JSON.stringify(branch)}); throw new Error('UI failed'); },
          promise: () => { calls.push(${JSON.stringify(branch)}); return Promise.reject(new Error('UI failed')); },
          thenable: () => ({ then(_resolve, reject) { calls.push(${JSON.stringify(branch)}); reject(new Error('UI failed')); } })
        }[${JSON.stringify(failureKind)}];
        const runtime = {
          isNativeFocusSaveEnabled: () => ${nativeEnabled},
          promptNativeFocusSave: () => Promise.resolve(${JSON.stringify(choice)}),
          enableNativeFocusSave: () => ${branch === 'manual-fallback' ? "Promise.reject(new Error('unsupported'))" : 'Promise.resolve()'},
          showNativeFocusSaveEnabled: () => Promise.resolve(),
          showNativeFocusSaveManualFallback: () => Promise.resolve()
        };
        runtime[${JSON.stringify(branch === 'enabled-info' ? 'showNativeFocusSaveEnabled' : branch === 'manual-fallback' ? 'showNativeFocusSaveManualFallback' : 'promptNativeFocusSave')}] = failure;
        createFocusSaveCoordinator({ runtime, state: { isSuppressed: () => false, suppress: () => true } }).ensure({ force: ${force} });
        setImmediate(() => process.exit(0));
      `;
      const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8'
      });
      assert.equal(result.status, 0, result.stderr);
    });
  }
}

test('rejected suppression-state thenable is treated as unsuppressed', async () => {
  const item = fixture({
    state: {
      isSuppressed: () => rejectingThenable(new Error('unreadable'), () => item.calls.push('state')),
      suppress: () => { item.calls.push('suppress'); return true; }
    }
  });
  await assert.doesNotReject(item.coordinator.ensure());
  assert.deepEqual(item.calls, ['native', 'state', 'prompt', 'update']);
});

test('overlapping automatic checks share one flight', async () => {
  const prompt = deferred();
  const calls = [];
  const coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { calls.push('native'); return false; },
      promptNativeFocusSave: () => { calls.push('prompt'); return prompt.promise; },
      enableNativeFocusSave: async () => { calls.push('update'); }
    },
    state: trackingState(calls)
  });
  const first = coordinator.ensure();
  const second = coordinator.ensure();
  assert.equal(second, first);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['native', 'state', 'prompt']);
  prompt.resolve('enable');
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['native', 'state', 'prompt', 'update']);
});

test('forced call upgrades an automatic flight before it reads suppression', async () => {
  const native = deferred();
  const calls = [];
  let stateReads = 0;
  const coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { calls.push('native'); return native.promise; },
      promptNativeFocusSave: async () => { calls.push('prompt'); return 'dismiss'; }
    },
    state: {
      isSuppressed: () => { stateReads += 1; calls.push('state'); return true; },
      suppress: () => { calls.push('suppress'); return true; }
    }
  });
  const automatic = coordinator.ensure();
  await Promise.resolve();
  const forced = coordinator.ensure({ force: true });
  assert.equal(forced, automatic);
  native.resolve(false);
  await Promise.all([automatic, forced]);
  assert.equal(stateReads, 0);
  assert.deepEqual(calls, ['native', 'prompt']);
});

test('forced call upgrades an automatic flight while suppression read is pending', async () => {
  const suppression = deferred();
  const stateStarted = deferred();
  const calls = [];
  const coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { calls.push('native'); return false; },
      promptNativeFocusSave: async () => { calls.push('prompt'); return 'dismiss'; }
    },
    state: {
      isSuppressed: () => {
        calls.push('state');
        stateStarted.resolve();
        return suppression.promise;
      },
      suppress: () => { calls.push('suppress'); return true; }
    }
  });
  const automatic = coordinator.ensure();
  await stateStarted.promise;
  assert.deepEqual(calls, ['native', 'state']);

  const forced = coordinator.ensure({ force: true });
  assert.equal(forced, automatic);
  suppression.resolve(true);
  await Promise.all([automatic, forced]);

  assert.deepEqual(calls, ['native', 'state', 'prompt']);
});

test('a completed flight is cleared so a later check runs again', async () => {
  const item = fixture();
  const first = item.coordinator.ensure();
  await first;
  const second = item.coordinator.ensure();
  assert.notEqual(second, first);
  await second;
  assert.deepEqual(item.calls, ['native', 'prompt', 'update', 'native', 'prompt', 'update']);
});

test('a user who later disables native focus save is prompted again', async () => {
  const calls = [];
  let nativeReads = 0;
  const coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => { calls.push('native'); return nativeReads++ === 0; },
      promptNativeFocusSave: async () => { calls.push('prompt'); return 'dismiss'; }
    },
    state: trackingState(calls)
  });
  await coordinator.ensure();
  await coordinator.ensure();
  assert.deepEqual(calls, ['native', 'native', 'state', 'prompt']);
});
