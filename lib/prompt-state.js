const { randomBytes } = require('node:crypto');

const RENAME_RETRY_DELAYS = [5, 10, 20, 40, 80, 160];
const RETRYABLE_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM']);
const retryWait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function temporaryStateFile(stateFile) {
  return `${stateFile}.${process.pid}.${Date.now()}.${randomBytes(8).toString('hex')}.tmp`;
}

function publishStateFile(fs, temporaryFile, stateFile) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temporaryFile, stateFile);
      return;
    } catch (error) {
      const retryable = error && RETRYABLE_RENAME_ERRORS.has(error.code);
      if (!retryable || attempt === RENAME_RETRY_DELAYS.length) throw error;
      Atomics.wait(retryWait, 0, 0, RENAME_RETRY_DELAYS[attempt]);
    }
  }
}

function readSuppressed(fs, stateFile) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return state.schemaVersion === 2 && state.focusSavePromptSuppressed === true;
  } catch {
    return false;
  }
}

function createPromptState({ fs, stateFile }) {
  return {
    isSuppressed() {
      return readSuppressed(fs, stateFile);
    },
    suppress() {
      let temporaryFile;
      try {
        temporaryFile = temporaryStateFile(stateFile);
        fs.writeFileSync(temporaryFile, JSON.stringify({
          schemaVersion: 2,
          focusSavePromptSuppressed: true
        }), 'utf8');
        publishStateFile(fs, temporaryFile, stateFile);
        return true;
      } catch {
        if (temporaryFile) {
          try {
            fs.unlinkSync(temporaryFile);
          } catch {
            // Temporary-file cleanup is best-effort.
          }
        }
        return readSuppressed(fs, stateFile);
      }
    }
  };
}

module.exports = { createPromptState };
