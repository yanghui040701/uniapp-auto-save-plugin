# 编辑时自动保存

这是一个通用的 HBuilderX 编辑器插件：停止输入一段时间后，保存当前正在编辑的本地文件；它不只服务于 uni-app 项目，也适用于 HBuilderX 能编辑的其他文本项目。

插件把“输入后的延迟保存”和 HBuilderX 原生的“失去焦点自动保存”组合起来。前者照顾持续输入后的落盘，后者补上在计时结束前快速切换文件或应用的场景。

## 工作原理

1. 本地、已命名且有未保存修改的活动文本文件发生变化时，插件只启动或重排计时；不会在每次键入时访问文件系统。
2. 继续输入会重新计时。到达 delay 后，插件再次确认插件仍启用、当前文件仍是当初修改的文件，并异步检查本地文件在这一刻是否可写；Windows ReadOnly 属性导致的 `EPERM` / `EACCES` 会被视为只读。检查完成后还会重新读取活动编辑器，避免等待期间切换标签而保存新文件。
3. 条件满足时，仅调用 HBuilderX 的 `workbench.action.files.save` 保存当前活动文件；成功时保持安静，失败时才显示错误。
4. 如果用户在 delay 到期前切走，旧文件不会被插件误存为新活动文件；此时可由 HBuilderX 原生 `editor.saveOnFocusLost` 补充保存离开的文件。

三种机制不要混为一谈：

| 机制 | 作用 | 是否等于项目文件已落盘 |
| --- | --- | --- |
| HBuilderX 临时恢复/异常恢复 | 在 HBuilderX 当前版本提供且恢复成功时，帮助找回未保存的编辑状态 | 否，恢复缓存不能替代保存 |
| HBuilderX 原生失焦保存 | 文件或应用失去焦点时保存 | 是，由 HBuilderX 执行正常保存 |
| 本插件的输入后保存 | 停止输入达到 delay 后保存当前文件 | 是，由 HBuilderX 执行正常保存 |

插件不会执行“全部保存”，也不会绕过 HBuilderX 直接改写磁盘文件。可写性检查只查询权限，不读取文件内容，也不获取写句柄。

## 快速安装

### 从插件市场安装

插件在 DCloud 插件市场上架后，打开插件详情页并点击“导入插件”，HBuilderX 会完成导入。当前仓库和发布资料不代表插件已经上架；请以实际市场页面为准。DCloud 的[插件安装说明](https://hx.dcloud.net.cn/Tutorial/PluginsInstall)介绍了市场导入和离线安装流程。

### 本地测试安装

1. 取得发行 ZIP 并解压。
2. 将插件目录放入 HBuilderX 安装目录的 `plugins` 目录，并确保目录名是 `yanghui-auto-save`，不要附加版本号。
3. 确认该目录根部包含 `package.json` 和 `extension.js`，然后重启 HBuilderX。

本插件没有第三方运行依赖。若未加载，先检查目录层级，再通过“帮助 → 查看运行日志”查看原因。

## 配置

本插件只有以下两个配置项：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `hbuilderx-auto-save.enabled` | boolean | `true` | 是否启用停止输入后的自动保存 |
| `hbuilderx-auto-save.delay` | number | `1000` | 停止输入到保存的延迟，范围 `200–10000 ms`；非整数会四舍五入，越界值会被限制到最近边界，无效数值回退到默认值 |

可在 HBuilderX 的插件配置中搜索“编辑时自动保存”并修改。等价的默认配置示例可用于核对配置文件：

```json
{
  "hbuilderx-auto-save.enabled": true,
  "hbuilderx-auto-save.delay": 1000
}
```

`editor.saveOnFocusLost` 是 HBuilderX 的原生设置，不是本插件的第三个配置项。

## 原生失焦保存授权

插件启动时会先检查 HBuilderX 的“失去焦点自动保存”。已开启时保持静默；关闭时会询问是否开启。只有在你点击“开启”后，插件才会修改 `editor.saveOnFocusLost`，并再次读取确认；自动更新失败时，按 `工具 → 设置 → 常用配置 → 失去焦点自动保存` 手动开启。

点击“不再提示”后，插件才会停止自动提醒；直接关闭弹窗不会永久取消提醒，也不影响输入后保存。你也可以随时运行“编辑时自动保存：检查并开启 HBuilderX 原生失焦保存”重新检查。

提示状态采用 schema v2，状态文件会记录 `schemaVersion` 与 `focusSavePromptSuppressed`。只有用户明确选择“不再提示”时才会持久化抑制状态。卸载并重新安装插件不会清除这项用户已明确作出的选择；如需重置，请按下文删除状态文件。

这项授权只改 HBuilderX 原生配置。卸载本插件不会自动关闭已经开启的失焦保存。

## 命令

| 命令面板标题 | 命令 ID | 作用 |
| --- | --- | --- |
| 编辑时自动保存：检查并开启 HBuilderX 原生失焦保存 | `yanghui-auto-save.checkFocusSave` | 随时重新检查；未开启时再次询问，已开启时显示确认信息 |

## 支持与跳过的文件

会参与延迟保存的对象：HBuilderX 文本编辑事件中的当前活动文档，且文档是 `file:` 本地文件、已有文件名、处于 dirty 状态并且不是只读。

以下情况会安全跳过：

- 未命名的新文件；
- HBuilderX 明确标记为只读的编辑器，或在保存前权限检查中返回 `EPERM` / `EACCES` 的本地文件（包括 Windows ReadOnly 属性文件）；
- 非本地 URI，例如远程或虚拟文档；
- 已经没有未保存修改的文件；
- delay 到期时已经切换到另一个文件；
- 插件已关闭或 HBuilderX 正在卸载插件实例。

## 隐私、权限与通知

- 不收集、不上传任何文件内容、文件路径或使用数据；
- 不包含遥测、统计分析或广告；
- 不发起网络请求；
- 不申请 DCloud 插件市场的特殊权限；
- 仅通过 HBuilderX API 监听编辑/配置事件、读取与更新相关设置、执行当前文件保存命令，并在本机保存一次性提示状态；保存前会用 Node.js 文件系统 API 异步检查当前本地路径是否可写，但不读取文件内容；
- 正常保存无通知，保存失败或插件内部错误时才提示。

## 限制

- 本插件不是持续同步或备份工具，不能替代 Git、云盘或备份方案。
- 未命名、检查时可识别为只读、非本地的文档不会保存。可写性预检与实际保存之间存在竞态（TOCTOU），Windows ACL、网络盘或权限在检查后变化等情况也可能无法由 `fs.access` 完整判断；此时 HBuilderX 仍可能拒绝保存并显示错误。
- 非权限类检查错误（例如暂时性设备或网络错误）不会被静默伪装成“只读”；插件继续走 HBuilderX 正常保存路径，由实际保存结果决定是否提示失败。
- HBuilderX 被强制结束、系统崩溃或断电时，如果 delay 尚未到期或正常保存尚未完成，最近修改仍可能丢失。
- 快速切换文件时，插件会主动放弃旧计时任务以避免保存错文件；建议同时启用原生失焦保存。
- 最低兼容版本声明是 HBuilderX 3.2.3。Windows ReadOnly 探针已在 HBuilderX 5.15.2026070915 随附的 Node 18/22 环境验证；修复后的完整 HBuilderX 宿主矩阵、较旧 HBuilderX 及其他桌面系统仍需在发布前另行核验。

## 故障排查

### 输入后没有保存

确认插件配置已启用、文件是可写的本地已命名文件，并等待配置的 delay。若问题发生在快速切换文件时，检查原生失焦保存是否开启。插件只保存当前活动文件，不会保存其他标签页。

### 无法自动开启失焦保存

使用命令“编辑时自动保存：检查并开启 HBuilderX 原生失焦保存”重试；仍失败时，按 `工具 → 设置 → 常用配置 → 失去焦点自动保存` 手动开启。

### 显示保存失败

检查文件权限、磁盘空间、文件是否被其他程序占用，以及 HBuilderX 是否能手动保存该文件。错误通知只显示安全的文件名和简化原因，不显示完整路径。

### 首次提示不再出现

检测到原生设置已经开启时不会提示；原生设置关闭时，插件会继续询问，除非你已明确选择“不再提示”。直接关闭对话框不会永久取消提醒。通常直接运行上面的命令即可再次检查。若要重置“不再提示”选择，参见下一节。

## 卸载与重置提示状态

在 HBuilderX 的“工具 → 插件安装 → 已安装插件”中卸载本插件，然后重启 HBuilderX。若使用的是本地测试安装，也可在 HBuilderX 完全退出后删除 `plugins/yanghui-auto-save` 目录。

首次提示状态不存放在插件安装目录。状态文件位置为：

- HBuilderX 提供 `hx.env.appData` 时：`<hx.env.appData>/extensions/yanghui-auto-save/state.json`；
- appData 不可用时：`~/.hbuilderx-auto-save/state.json`（即当前系统用户主目录下）。

要重置提示：完全退出 HBuilderX，删除对应的 `state.json`，再启动 HBuilderX。删除状态文件只会移除 schema v2 中 `focusSavePromptSuppressed` 所代表的“不再提示”选择，不会改变 `editor.saveOnFocusLost` 当前值；需要关闭原生失焦保存时，请在 HBuilderX 设置中手动关闭。

## 本地验证与打包

在 Windows PowerShell 中进入仓库根目录，依次运行：

```powershell
npm test
npm run validate
npm run package
```

`npm run package` 会先重复运行完整测试和发布白名单校验，任一步失败都会停止。最终上传候选文件是 `dist/yanghui-auto-save.zip`；压缩包根目录直接包含 `package.json`、`extension.js`、文档文件和运行所需的 `lib/`，共 9 个经过校验的发布文件，以满足 DCloud 插件市场的上传校验。`dist/yanghui-auto-save/` 暂存目录也会保留，便于发布前检查。

## 反馈与许可证

- 作者：`yanghui040701`
- 源码：[yanghui040701/uniapp-auto-save-plugin](https://github.com/yanghui040701/uniapp-auto-save-plugin)
- 问题反馈：[GitHub Issues](https://github.com/yanghui040701/uniapp-auto-save-plugin/issues)
- 市场价格：按 DCloud 当前产品类型规则，HBuilderX 编辑器插件不能设置价格，因此本插件面向用户免费
- 开源许可证：作者选择 MIT，详见 `LICENSE`；市场免费与开源许可是两个独立概念
