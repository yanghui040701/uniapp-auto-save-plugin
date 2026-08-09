function createFocusSaveCoordinator({ runtime, state }) {
  let currentFlight;

  async function isSuppressed() {
    try {
      return await state.isSuppressed() === true;
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

  async function suppress() {
    try {
      await state.suppress();
    } catch {
      // Persisting prompt state is best-effort and must not block the flow.
    }
  }

  async function runEnsure(flight) {
    try {
      if (await isNativeFocusSaveEnabled()) {
        if (flight.force) await runtime.showNativeFocusSaveEnabled();
        return;
      }

      if (!flight.force && await isSuppressed()) return;

      const choice = await runtime.promptNativeFocusSave();
      if (choice === 'suppress') {
        await suppress();
        return;
      }
      if (choice !== 'enable') return;

      try {
        await runtime.enableNativeFocusSave();
      } catch {
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
