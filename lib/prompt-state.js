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

function readHandled(fs, stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')).focusSavePromptHandled === true;
  } catch {
    return false;
  }
}

function createPromptState({ fs, stateFile }) {
  return {
    wasHandled() {
      return readHandled(fs, stateFile);
    },
    markHandled() {
      let temporaryFile;
      try {
        temporaryFile = temporaryStateFile(stateFile);
        fs.writeFileSync(temporaryFile, JSON.stringify({ focusSavePromptHandled: true }), 'utf8');
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
        return readHandled(fs, stateFile);
      }
    }
  };
}

module.exports = { createPromptState };
