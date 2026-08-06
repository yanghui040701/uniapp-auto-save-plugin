const path = require('node:path');

const ENABLE_BUTTON = '开启';
const DECLINE_BUTTON = '暂不开启';
const SAVE_ERROR_FALLBACK = '请检查文件权限或磁盘状态后重试。';
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const URI_WITHOUT_SLASHES = /\b[a-z][a-z0-9+.-]*:(?=\S)/i;

function basename(candidate, isUri = false) {
  if (typeof candidate !== 'string' || candidate.length === 0) return '';
  let normalized = candidate;
  if (isUri) {
    normalized = normalized.replace(/[?#].*$/, '');
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      return '';
    }
  }
  if (CONTROL_CHARACTERS.test(normalized)) return '';
  normalized = normalized.replace(/[\\/]+$/, '');
  return path.win32.basename(path.posix.basename(normalized));
}

function safeSaveErrorReason(error) {
  const value = error && typeof error.message === 'string'
    ? error.message
    : typeof error === 'string' ? error : '';
  const reason = value.trim();
  if (
    !reason ||
    reason.length > 160 ||
    CONTROL_CHARACTERS.test(value) ||
    reason.includes('%') ||
    /[\\/]/.test(reason) ||
    URI_WITHOUT_SLASHES.test(reason)
  ) {
    return SAVE_ERROR_FALLBACK;
  }
  return reason;
}

function documentBasename(document) {
  if (!document) return '当前文件';
  const uri = document.uri;
  const candidates = [
    [document.fileName, false],
    [uri && uri.fsPath, false],
    [uri && uri.path, false]
  ];
  if (uri && typeof uri.toString === 'function') {
    try {
      const value = uri.toString();
      if (value !== '[object Object]') candidates.push([value, true]);
    } catch {
      // A display name is best-effort; fall through to the safe placeholder.
    }
  }
  for (const [candidate, isUri] of candidates) {
    const name = basename(candidate, isUri);
    if (name) return name;
  }
  return '当前文件';
}

function getConfiguration(hx, section) {
  try {
    return hx.workspace && typeof hx.workspace.getConfiguration === 'function'
      ? hx.workspace.getConfiguration(section)
      : null;
  } catch {
    return null;
  }
}

function getSetting(config, key, fallback) {
  if (!config || typeof config.get !== 'function') return fallback;
  try {
    return config.get(key, fallback);
  } catch {
    return fallback;
  }
}

function createHBuilderXRuntime(hx) {
  async function showMessageBox(options) {
    if (!hx.window || typeof hx.window.showMessageBox !== 'function') return undefined;
    try {
      return await hx.window.showMessageBox(options);
    } catch {
      return undefined;
    }
  }

  return {
    getSettings() {
      const config = getConfiguration(hx, 'hbuilderx-auto-save');
      return {
        enabled: getSetting(config, 'enabled', true),
        delay: getSetting(config, 'delay', 1000)
      };
    },

    async getActiveSnapshot() {
      if (!hx.window || typeof hx.window.getActiveTextEditor !== 'function') {
        return { document: null, readOnly: false };
      }
      const editor = await hx.window.getActiveTextEditor();
      return editor && editor.document
        ? {
            document: editor.document,
            readOnly: editor.readonly === true || editor.isReadonly === true
          }
        : { document: null, readOnly: false };
    },

    saveActiveDocument() {
      return hx.commands.executeCommand('workbench.action.files.save');
    },

    onDocumentChange(listener) {
      return hx.workspace.onDidChangeTextDocument(listener);
    },

    onConfigurationChange(listener) {
      return hx.workspace.onDidChangeConfiguration(listener);
    },

    registerCommand(id, listener) {
      return hx.commands.registerCommand(id, listener);
    },

    reportSaveError(error, document) {
      const fileName = documentBasename(document);
      const reason = safeSaveErrorReason(error);
      return showMessageBox({
        type: 'error',
        title: '自动保存失败',
        text: `自动保存 ${fileName} 失败：${reason}`,
        buttons: ['知道了']
      });
    },

    isNativeFocusSaveEnabled() {
      const config = getConfiguration(hx, 'editor');
      return getSetting(config, 'saveOnFocusLost', false) === true;
    },

    async enableNativeFocusSave() {
      const config = hx.workspace.getConfiguration('editor');
      await config.update('saveOnFocusLost', true);
      const freshConfig = hx.workspace.getConfiguration('editor');
      if (freshConfig.get('saveOnFocusLost', false) !== true) {
        throw new Error('HBuilderX 未确认 editor.saveOnFocusLost 已开启');
      }
    },

    async promptNativeFocusSave() {
      const selected = await showMessageBox({
        type: 'question',
        title: '开启 HBuilderX 原生保存',
        text: '是否开启 HBuilderX 的失去焦点自动保存？这可确保快速切换文件或应用时保存离开的文件。',
        buttons: [ENABLE_BUTTON, DECLINE_BUTTON]
      });
      return selected === ENABLE_BUTTON ? 'enable' : 'decline';
    },

    showNativeFocusSaveEnabled() {
      return showMessageBox({
        type: 'info',
        title: '失去焦点自动保存',
        text: 'HBuilderX 的失去焦点自动保存已开启。',
        buttons: ['知道了']
      });
    },

    showNativeFocusSaveManualFallback() {
      return showMessageBox({
        type: 'warning',
        title: '请手动开启失去焦点自动保存',
        text: '当前 HBuilderX 无法自动更新该设置。请前往：工具 → 设置 → 常用配置 → 失去焦点自动保存。',
        buttons: ['知道了']
      });
    },

    reportInternalError(_error) {
      return showMessageBox({
        type: 'error',
        title: '自动保存插件错误',
        text: '自动保存插件遇到内部错误。请重试；若问题持续，请重新加载 HBuilderX。',
        buttons: ['知道了']
      });
    }
  };
}

module.exports = { createHBuilderXRuntime };
