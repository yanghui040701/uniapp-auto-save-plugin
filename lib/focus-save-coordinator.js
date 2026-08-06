function createFocusSaveCoordinator({ runtime, state }) {
  let currentFlight;

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

  async function runEnsure(flight) {
    try {
      const handled = await wasHandled();
      if (!flight.force && handled) return;

      if (await isNativeFocusSaveEnabled()) {
        await markHandled();
        if (flight.force) await runtime.showNativeFocusSaveEnabled();
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
    } finally {
      if (currentFlight === flight) currentFlight = undefined;
    }
  }

  return {
    ensure({ force = false } = {}) {
      if (currentFlight) {
        if (force) currentFlight.force = true;
        return currentFlight.promise;
      }

      const flight = { force: force === true };
      currentFlight = flight;
      flight.promise = Promise.resolve().then(() => runEnsure(flight));
      return flight.promise;
    }
  };
}

module.exports = { createFocusSaveCoordinator };
