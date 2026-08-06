const path = require('node:path');

const ENABLE_BUTTON = '开启';
const DECLINE_BUTTON = '暂不开启';

function errorMessage(error) {
  if (error && typeof error.message === 'string') return error.message;
  return String(error);
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
      const config = hx.workspace.getConfiguration('hbuilderx-auto-save');
      return {
        enabled: config.get('enabled', true),
        delay: config.get('delay', 1000)
      };
    },

    async getActiveSnapshot() {
      const editor = await hx.window.getActiveTextEditor();
      return editor
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
      const filePath = document && (
        document.fileName || (document.uri && document.uri.fsPath)
      );
      const fileName = filePath ? path.basename(filePath) : '当前文件';
      const detail = errorMessage(error);
      const safeDetail = filePath && filePath !== fileName
        ? detail.split(filePath).join(fileName)
        : detail;
      return showMessageBox({
        type: 'error',
        title: '自动保存失败',
        text: `自动保存 ${fileName} 失败：${safeDetail}`,
        buttons: ['知道了']
      });
    },

    isNativeFocusSaveEnabled() {
      const config = hx.workspace.getConfiguration('editor');
      return config.get('saveOnFocusLost', false) === true;
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
        buttons: [ENABLE_BUTTON, DECLINE_BUTTON],
        defaultButton: ENABLE_BUTTON,
        cancelButton: DECLINE_BUTTON
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

    reportInternalError(error) {
      return showMessageBox({
        type: 'error',
        title: '自动保存插件错误',
        text: `自动保存插件遇到错误：${errorMessage(error)}`,
        buttons: ['知道了']
      });
    }
  };
}

module.exports = { createHBuilderXRuntime };
