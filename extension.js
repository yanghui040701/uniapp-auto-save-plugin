const { createAutoSaveController } = require('./lib/auto-save-controller');
const { createHBuilderXRuntime } = require('./lib/hbuilderx-runtime');
const { createFocusSaveCoordinator } = require('./lib/focus-save-coordinator');
const { createPromptState } = require('./lib/prompt-state');

const CHECK_FOCUS_SAVE_COMMAND = 'yanghui-auto-save.checkFocusSave';

let activeInstance;

function reportInternalErrorSafely(runtime, error) {
  try {
    return Promise.resolve(runtime.reportInternalError(error)).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function invokeSafely(runtime, operation) {
  let result;
  try {
    result = operation();
  } catch (error) {
    return reportInternalErrorSafely(runtime, error);
  }

  return Promise.resolve(result).catch(error => reportInternalErrorSafely(runtime, error));
}

function startExtension(context, runtime, options = {}) {
  const setTimer = options.setTimeout || globalThis.setTimeout;
  const clearTimer = options.clearTimeout || globalThis.clearTimeout;
  const focusCoordinator = options.focusCoordinator;
  const controller = createAutoSaveController({
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    getSettings: () => runtime.getSettings(),
    getActiveSnapshot: () => runtime.getActiveSnapshot(),
    saveActiveDocument: () => runtime.saveActiveDocument(),
    reportSaveError: (error, document) => runtime.reportSaveError(error, document)
  });

  const documentSubscription = runtime.onDocumentChange(event => (
    invokeSafely(runtime, () => controller.handleDocumentChange(event))
  ));
  const configurationSubscription = runtime.onConfigurationChange(event => (
    invokeSafely(runtime, () => controller.handleConfigurationChange(event))
  ));
  const commandSubscription = runtime.registerCommand(CHECK_FOCUS_SAVE_COMMAND, () => (
    invokeSafely(runtime, () => focusCoordinator.ensure({ force: true }))
  ));
  context.subscriptions.push(
    documentSubscription,
    configurationSubscription,
    commandSubscription
  );

  const ready = invokeSafely(runtime, () => focusCoordinator.ensure({ force: false }));
  let disposed = false;

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      void invokeSafely(runtime, () => controller.dispose());
    }
  };
}

function activateWithRuntime(context, runtime, options) {
  const previousInstance = activeInstance;
  activeInstance = undefined;
  if (previousInstance) previousInstance.dispose();

  activeInstance = startExtension(context, runtime, options);
  return activeInstance.ready;
}

function activate(context) {
  const hx = require('hbuilderx');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const runtime = createHBuilderXRuntime(hx);
  const appData = hx && hx.env && typeof hx.env.appData === 'string'
    ? hx.env.appData.trim()
    : '';
  const stateDirectory = appData
    ? path.join(appData, 'extensions', 'yanghui-auto-save')
    : path.join(os.homedir(), '.hbuilderx-auto-save');

  try {
    fs.mkdirSync(stateDirectory, { recursive: true });
  } catch {
    // State persistence is best-effort; activation must remain available.
  }

  const state = createPromptState({
    fs,
    stateFile: path.join(stateDirectory, 'state.json')
  });
  const focusCoordinator = createFocusSaveCoordinator({ runtime, state });
  return activateWithRuntime(context, runtime, { focusCoordinator });
}

function deactivate() {
  const instance = activeInstance;
  activeInstance = undefined;
  if (instance) instance.dispose();
}

module.exports = {
  activate,
  deactivate,
  startExtension,
  activateWithRuntime
};
