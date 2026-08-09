const DEFAULT_DELAY = 1000;
const MIN_DELAY = 200;
const MAX_DELAY = 10000;

function normalizeDelay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_DELAY;
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(number)));
}

function documentKey(document) {
  if (!document) return '';
  if (document.uri && typeof document.uri.fsPath === 'string') return document.uri.fsPath;
  return typeof document.fileName === 'string' ? document.fileName : '';
}

function isSaveCandidate(document, readOnly = false) {
  if (!document || readOnly || document.isUntitled || !document.isDirty) return false;
  const uri = document.uri;
  return Boolean(
    uri &&
    uri.scheme === 'file' &&
    typeof uri.fsPath === 'string' &&
    uri.fsPath.length > 0
  );
}

function createAutoSaveController(dependencies) {
  const {
    setTimeout,
    clearTimeout,
    getSettings,
    getActiveSnapshot,
    saveActiveDocument
  } = dependencies;
  let pending = null;
  let saveInFlight = null;
  let disposed = false;
  let generation = 0;

  function cancelPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  }

  function handleDocumentChange(event) {
    if (disposed) return;
    const scheduledGeneration = ++generation;
    cancelPending();
    const settings = getSettings();
    if (!settings.enabled || !isSaveCandidate(event.document)) return;

    const changedDocument = event.document;
    const key = documentKey(changedDocument);
    const task = { timer: null, document: changedDocument, key };
    const releaseTask = () => {
      if (pending === task) pending = null;
    };
    task.timer = setTimeout(async () => {
      try {
        if (saveInFlight) await saveInFlight;
        const snapshot = await getActiveSnapshot();
        if (disposed || scheduledGeneration !== generation || !getSettings().enabled) return;
        if (documentKey(snapshot.document) !== key) return;
        if (!isSaveCandidate(snapshot.document, snapshot.readOnly)) return;
        releaseTask();
        const saveOperation = Promise.resolve().then(() => saveActiveDocument());
        const saveSettlement = saveOperation.then(
          () => undefined,
          () => undefined
        );
        saveInFlight = saveSettlement;
        try {
          await saveOperation;
        } finally {
          if (saveInFlight === saveSettlement) saveInFlight = null;
        }
      } catch (error) {
        releaseTask();
        try {
          await dependencies.reportSaveError(error, changedDocument);
        } catch {
          // Error reporting is best-effort and must not escape the timer task.
        }
      } finally {
        releaseTask();
      }
    }, normalizeDelay(settings.delay));
    pending = task;
  }

  function handleConfigurationChange() {
    if (disposed) return;
    generation += 1;
    if (!getSettings().enabled) {
      cancelPending();
      return;
    }
    if (pending) handleDocumentChange({ document: pending.document });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    cancelPending();
  }

  return {
    handleDocumentChange,
    handleConfigurationChange,
    dispose
  };
}

module.exports = {
  DEFAULT_DELAY,
  MIN_DELAY,
  MAX_DELAY,
  normalizeDelay,
  documentKey,
  isSaveCandidate,
  createAutoSaveController
};
