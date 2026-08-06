const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
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

function rejectingThenable(error, onThen = () => {}) {
  return {
    then(_resolve, reject) {
      onThen();
      reject(error);
    }
  };
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

test('state write failure does not suppress manual fallback', async () => {
  const item = fixture({
    runtime: {
      enableNativeFocusSave: async () => {
        item.calls.push('enable');
        throw new Error('unsupported');
      }
    },
    state: {
      markHandled: () => {
        item.calls.push('handled');
        throw new Error('unwritable');
      }
    }
  });
  await assert.doesNotReject(item.coordinator.ensure({ force: false }));
  assert.deepEqual(item.calls, ['prompt', 'enable', 'handled', 'manual']);
});

test('rejected handled-state thenable is treated as not handled', async () => {
  const item = fixture({
    state: {
      wasHandled: () => rejectingThenable(new Error('unreadable'), () => {
        item.calls.push('handled-read');
      })
    }
  });
  await assert.doesNotReject(item.coordinator.ensure({ force: false }));
  assert.deepEqual(item.calls, ['handled-read', 'prompt', 'enable', 'handled']);
});

test('rejected native-setting thenable is treated as disabled', async () => {
  const item = fixture({
    runtime: {
      isNativeFocusSaveEnabled: () => rejectingThenable(new Error('unreadable'), () => {
        item.calls.push('native-read');
      })
    }
  });
  await assert.doesNotReject(item.coordinator.ensure({ force: false }));
  assert.deepEqual(item.calls, ['native-read', 'prompt', 'enable', 'handled']);
});

test('rejected state-write thenable does not suppress manual fallback', async () => {
  const item = fixture({
    runtime: {
      enableNativeFocusSave: async () => {
        item.calls.push('enable');
        throw new Error('unsupported');
      }
    },
    state: {
      markHandled: () => {
        item.calls.push('handled');
        return rejectingThenable(new Error('unwritable'), () => {
          item.calls.push('state-write');
        });
      }
    }
  });
  await assert.doesNotReject(item.coordinator.ensure({ force: false }));
  assert.deepEqual(item.calls, ['prompt', 'enable', 'handled', 'state-write', 'manual']);
});

test('fire-and-forget rejected state writes do not create unhandled rejections', () => {
  const script = `
    const { createFocusSaveCoordinator } = require('./lib/focus-save-coordinator');
    const coordinator = createFocusSaveCoordinator({
      runtime: {
        isNativeFocusSaveEnabled: () => false,
        promptNativeFocusSave: () => Promise.resolve('decline')
      },
      state: {
        wasHandled: () => false,
        markHandled: () => Promise.reject(new Error('unwritable'))
      }
    });
    coordinator.ensure({ force: false });
    setImmediate(() => process.exit(0));
  `;
  const result = spawnSync(
    process.execPath,
    ['--unhandled-rejections=strict', '-e', script],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
});

test('forced check ignores handled state and confirms enabled status', async () => {
  const item = fixture({
    runtime: { isNativeFocusSaveEnabled: () => true },
    state: { wasHandled: () => true }
  });
  await item.coordinator.ensure({ force: true });
  assert.deepEqual(item.calls, ['handled', 'already-enabled']);
});
