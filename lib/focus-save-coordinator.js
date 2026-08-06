function createFocusSaveCoordinator({ runtime, state }) {
  async function wasHandled() {
    try {
      return await state.wasHandled() === true;
    } catch {
      return false;
    }
  }

  async function isNativeFocusSaveEnabled() {
    try {
      return await runtime.isNativeFocusSaveEnabled() === true;
    } catch {
      return false;
    }
  }

  async function markHandled() {
    try {
      await state.markHandled();
    } catch {
      // Persisting prompt state is best-effort and must not block the flow.
    }
  }

  return {
    async ensure({ force = false } = {}) {
      try {
        if (!force && await wasHandled()) return;

        if (await isNativeFocusSaveEnabled()) {
          await markHandled();
          if (force) await runtime.showNativeFocusSaveEnabled();
          return;
        }

        const choice = await runtime.promptNativeFocusSave();
        if (choice !== 'enable') {
          await markHandled();
          return;
        }

        try {
          await runtime.enableNativeFocusSave();
          await markHandled();
        } catch {
          await markHandled();
          await runtime.showNativeFocusSaveManualFallback();
        }
      } catch {
        // Activation must remain safe if HBuilderX or local state APIs fail.
      }
    }
  };
}

module.exports = { createFocusSaveCoordinator };
