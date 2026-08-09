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

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function strictFireAndForgetResult(branch, failureKind) {
  const script = `
    const assert = require('node:assert/strict');
    const { createFocusSaveCoordinator } = require('./lib/focus-save-coordinator');
    const branch = ${JSON.stringify(branch)};
    const calls = [];
    const failureCall = branch === 'prompt'
      ? 'prompt'
      : branch === 'enabled confirmation' ? 'already-enabled' : 'manual';
    const failures = {
      sync: () => { calls.push(failureCall); throw new Error('UI failed'); },
      promise: () => { calls.push(failureCall); return Promise.reject(new Error('UI failed')); },
      thenable: () => {
        calls.push(failureCall);
        return { then(_resolve, reject) { reject(new Error('UI failed')); } };
      }
    };
    const failure = failures[${JSON.stringify(failureKind)}];
    const runtime = {
      isNativeFocusSaveEnabled: () => { calls.push('native-read'); return false; },
      promptNativeFocusSave: () => { calls.push('prompt'); return Promise.resolve('enable'); },
      enableNativeFocusSave: () => { calls.push('enable'); return Promise.resolve(); },
      showNativeFocusSaveEnabled: () => { calls.push('already-enabled'); return Promise.resolve(); },
      showNativeFocusSaveManualFallback: () => { calls.push('manual'); return Promise.resolve(); }
    };
    const force = branch === 'enabled confirmation';
    if (branch === 'prompt') runtime.promptNativeFocusSave = failure;
    if (branch === 'enabled confirmation') {
      runtime.isNativeFocusSaveEnabled = () => { calls.push('native-read'); return true; };
      runtime.showNativeFocusSaveEnabled = failure;
    }
    if (branch === 'manual fallback') {
      runtime.enableNativeFocusSave = () => {
        calls.push('enable');
        return Promise.reject(new Error('unsupported'));
      };
      runtime.showNativeFocusSaveManualFallback = failure;
    }
    const coordinator = createFocusSaveCoordinator({
      runtime,
      state: {
        wasHandled: () => false,
        markHandled: () => { calls.push('handled'); return true; }
      }
    });
    coordinator.ensure({ force });
    setImmediate(() => {
      const expected = {
        prompt: ['native-read', 'prompt'],
        'enabled confirmation': ['native-read', 'handled', 'already-enabled'],
        'manual fallback': ['native-read', 'prompt', 'enable', 'handled', 'manual']
      };
      assert.deepEqual(calls, expected[branch]);
      assert.equal(calls.includes('already-enabled'), branch === 'enabled confirmation');
      process.exit(0);
    });
  `;
  return spawnSync(
    process.execPath,
    ['--unhandled-rejections=strict', '-e', script],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }
  );
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

for (const branch of ['prompt', 'enabled confirmation', 'manual fallback']) {
  for (const failureKind of ['sync', 'promise', 'thenable']) {
    test(`fire-and-forget ${branch} absorbs ${failureKind} failures`, () => {
      const result = strictFireAndForgetResult(branch, failureKind);
      assert.equal(result.status, 0, result.stderr);
    });
  }
}

test('overlapping automatic checks share one prompt update and state write', async () => {
  const prompt = deferred();
  const calls = [];
  let handled = false;
  const coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => false,
      promptNativeFocusSave: async () => {
        calls.push('prompt');
        return prompt.promise;
      },
      enableNativeFocusSave: async () => { calls.push('enable'); }
    },
    state: {
      wasHandled: () => handled,
      markHandled: () => {
        calls.push('handled');
        handled = true;
        return true;
      }
    }
  });

  const first = coordinator.ensure({ force: false });
  const second = coordinator.ensure({ force: false });
  assert.equal(second, first);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['prompt']);

  prompt.resolve('enable');
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['prompt', 'enable', 'handled']);

  const afterCompletion = coordinator.ensure({ force: false });
  assert.notEqual(afterCompletion, first);
  await afterCompletion;
  assert.deepEqual(calls, ['prompt', 'enable', 'handled']);
});

test('a forced check upgrades and joins an overlapping automatic check', async () => {
  const handledRead = deferred();
  const calls = [];
  const coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => {
        calls.push('native-read');
        return true;
      },
      showNativeFocusSaveEnabled: async () => { calls.push('already-enabled'); }
    },
    state: {
      wasHandled: async () => {
        calls.push('handled-read');
        return handledRead.promise;
      },
      markHandled: () => { calls.push('handled'); return true; }
    }
  });

  const automatic = coordinator.ensure({ force: false });
  await Promise.resolve();
  const forced = coordinator.ensure({ force: true });
  assert.equal(forced, automatic);
  handledRead.resolve(true);

  await Promise.all([automatic, forced]);
  assert.deepEqual(calls, ['handled-read', 'native-read', 'handled', 'already-enabled']);
});

test('a forced check after the decision point starts a new flight', async () => {
  const calls = [];
  let forced;
  let scheduled = false;
  let coordinator;
  coordinator = createFocusSaveCoordinator({
    runtime: {
      isNativeFocusSaveEnabled: () => {
        calls.push('native-read');
        return true;
      },
      showNativeFocusSaveEnabled: async () => { calls.push('already-enabled'); }
    },
    state: {
      wasHandled: () => {
        calls.push('handled-read');
        return false;
      },
      markHandled: () => ({
        then(resolve) {
          calls.push('handled');
          resolve();
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(() => queueMicrotask(() => {
              calls.push('forced-called');
              forced = coordinator.ensure({ force: true });
            }));
          }
        }
      })
    }
  });

  const automatic = coordinator.ensure({ force: false });
  await automatic;
  assert.ok(forced);
  assert.notEqual(forced, automatic);
  await forced;
  assert.deepEqual(calls, [
    'handled-read', 'native-read', 'handled', 'forced-called',
    'handled-read', 'native-read', 'handled', 'already-enabled'
  ]);
});

test('forced check ignores handled state and confirms enabled status', async () => {
  const item = fixture({
    runtime: { isNativeFocusSaveEnabled: () => true },
    state: { wasHandled: () => true }
  });
  await item.coordinator.ensure({ force: true });
  assert.deepEqual(item.calls, ['handled', 'already-enabled']);
});
