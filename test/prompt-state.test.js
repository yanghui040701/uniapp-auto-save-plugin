const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
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

test('publishes handled state through unique same-directory temporary files', () => {
  const writes = [];
  const renames = [];
  const fakeFs = {
    readFileSync() { throw new Error('missing'); },
    writeFileSync(file, contents, encoding) {
      writes.push({ file, contents, encoding });
    },
    renameSync(from, to) {
      renames.push({ from, to });
    },
    unlinkSync() {}
  };
  const state = createPromptState({ fs: fakeFs, stateFile });

  assert.equal(state.markHandled(), true);
  assert.equal(state.markHandled(), true);
  assert.equal(writes.length, 2);
  assert.notEqual(writes[0].file, stateFile);
  assert.notEqual(writes[0].file, writes[1].file);
  assert.equal(path.dirname(writes[0].file), path.dirname(stateFile));
  assert.equal(writes[0].contents, '{"focusSavePromptHandled":true}');
  assert.equal(writes[0].encoding, 'utf8');
  assert.deepEqual(renames, [
    { from: writes[0].file, to: stateFile },
    { from: writes[1].file, to: stateFile }
  ]);
});

test('cleans the temporary file when atomic publication fails', () => {
  const calls = [];
  const fakeFs = {
    readFileSync() { throw new Error('missing'); },
    writeFileSync(file) { calls.push(['write', file]); },
    renameSync(from, to) {
      calls.push(['rename', from, to]);
      throw new Error('publish failed');
    },
    unlinkSync(file) { calls.push(['unlink', file]); }
  };
  const state = createPromptState({ fs: fakeFs, stateFile });

  assert.equal(state.markHandled(), false);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], 'write');
  assert.deepEqual(calls[1], ['rename', calls[0][1], stateFile]);
  assert.deepEqual(calls[2], ['unlink', calls[0][1]]);
});

test('waits for a transient Windows target lock before publishing', {
  skip: process.platform !== 'win32',
  timeout: 5000
}, async () => {
  const state = createPromptState({ fs, stateFile });
  assert.equal(state.markHandled(), true);

  const lockScript = `
    $stream = [System.IO.File]::Open(
      $env:YANGHUI_AUTO_SAVE_STATE_FILE,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::Read
    )
    try {
      [Console]::Out.WriteLine('locked')
      [Console]::Out.Flush()
      Start-Sleep -Milliseconds 250
    } finally {
      $stream.Dispose()
    }
  `;
  const child = spawn('powershell', [
    '-NoProfile',
    '-Command',
    lockScript
  ], {
    windowsHide: true,
    env: { ...process.env, YANGHUI_AUTO_SAVE_STATE_FILE: stateFile }
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('locked')) resolve();
    });
    child.once('exit', code => reject(new Error(`lock process exited ${code}: ${stderr}`)));
    child.once('error', reject);
  });

  const marked = state.markHandled();
  assert.equal(await exit, 0, stderr);
  assert.equal(marked, true);
  assert.equal(state.wasHandled(), true);
});

test('concurrent readers never observe partial handled-state writes', { timeout: 30000 }, async () => {
  const state = createPromptState({ fs, stateFile });
  assert.equal(state.markHandled(), true);

  const workerCount = 4;
  const writesPerWorker = 500;
  const slots = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4));
  const modulePath = path.resolve(__dirname, '../lib/prompt-state.js');
  const workerSource = `
    const fs = require('node:fs');
    const { workerData } = require('node:worker_threads');
    const { createPromptState } = require(workerData.modulePath);
    const slots = new Int32Array(workerData.buffer);
    const state = createPromptState({ fs, stateFile: workerData.stateFile });
    Atomics.add(slots, 0, 1);
    Atomics.notify(slots, 0);
    Atomics.wait(slots, 1, 0);
    for (let index = 0; index < workerData.writeCount; index += 1) {
      Atomics.add(slots, state.markHandled() ? 2 : 3, 1);
    }
    Atomics.add(slots, 1, 1);
    Atomics.notify(slots, 1);
  `;
  const workers = Array.from({ length: workerCount }, () => new Worker(workerSource, {
    eval: true,
    workerData: {
      buffer: slots.buffer,
      modulePath,
      stateFile,
      writeCount: writesPerWorker
    }
  }));
  const exits = workers.map(worker => new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)));
  }));
  const exitResults = Promise.allSettled(exits);
  let workersFinished = false;

  try {
    const readyDeadline = Date.now() + 5000;
    while (Atomics.load(slots, 0) < workerCount && Date.now() < readyDeadline) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(Atomics.load(slots, 0), workerCount, 'all writers should become ready');
    Atomics.store(slots, 1, 1);
    Atomics.notify(slots, 1, workerCount);

    let falseReads = 0;
    let samples = 0;
    const writeDeadline = Date.now() + 20000;
    while (Atomics.load(slots, 1) <= workerCount && Date.now() < writeDeadline) {
      for (let index = 0; index < 100; index += 1) {
        samples += 1;
        if (!state.wasHandled()) falseReads += 1;
      }
      if (Atomics.load(slots, 1) === workerCount + 1) break;
      await new Promise(resolve => setImmediate(resolve));
    }

    assert.equal(Atomics.load(slots, 1), workerCount + 1, 'all writers should finish');
    const results = await exitResults;
    workersFinished = true;
    for (const result of results) {
      assert.equal(result.status, 'fulfilled', result.reason && result.reason.stack);
    }

    assert.ok(samples > 0, 'reader should sample while writers run');
    assert.equal(Atomics.load(slots, 2), workerCount * writesPerWorker);
    assert.equal(Atomics.load(slots, 3), 0);
    assert.equal(falseReads, 0);
    assert.equal(state.wasHandled(), true);
    assert.deepEqual(fs.readdirSync(path.dirname(stateFile)), ['state.json']);
  } finally {
    Atomics.store(slots, 1, 1);
    Atomics.notify(slots, 1, workerCount);
    if (!workersFinished) {
      await Promise.allSettled(workers.map(worker => worker.terminate()));
      await exitResults;
    }
  }
});
