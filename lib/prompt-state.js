function createPromptState({ fs, stateFile }) {
  return {
    wasHandled() {
      try {
        return JSON.parse(fs.readFileSync(stateFile, 'utf8')).focusSavePromptHandled === true;
      } catch {
        return false;
      }
    },
    markHandled() {
      try {
        fs.writeFileSync(stateFile, JSON.stringify({ focusSavePromptHandled: true }), 'utf8');
        return true;
      } catch {
        return false;
      }
    }
  };
}

module.exports = { createPromptState };
