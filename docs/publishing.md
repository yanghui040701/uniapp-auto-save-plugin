# DCloud 插件市场发布资料

> 发布状态：尚未发布。本文是可复制的提交底稿，不表示 DCloud 已审核、已上架，也不表示插件 ID 的唯一性已经在登录后的提交门户完成最终校验。

## 字段底稿

| 字段 | 拟提交内容 |
| --- | --- |
| 插件名称 | 编辑时自动保存 |
| 插件 ID | yanghui-auto-save |
| 作者/发布者 | yanghui040701 |
| 版本 | 1.0.1 |
| 分类 | HBuilderX |
| 关键词/标签 | 自动保存、HBuilderX、防抖、autosave |
| 短描述 | 为 HBuilderX 提供编辑时防抖自动保存，并可引导开启原生失焦自动保存，避免快速切换文件时遗漏保存。 |
| 详细介绍 | 通用 HBuilderX 编辑器插件，不限于 uni-app 项目。防抖保存负责停止输入后的保存；原生失焦保存覆盖倒计时结束前切换文件或应用的场景。停止输入达到配置延迟后，插件会重新确认当前活动文件仍是原修改文件，并异步检查本地路径当时是否可写，再调用 HBuilderX 当前文件保存命令。只有用户点击“开启”后，插件才会修改 `editor.saveOnFocusLost`。 |
| 使用说明 | 安装并重启 HBuilderX 后即可使用；默认启用、延迟 1000 ms。启动时已开启的原生失焦保存保持静默；关闭时会询问是否开启。只有点击“开启”才会修改 HBuilderX 设置；点击“不再提示”才会停止自动提醒，关闭弹窗不会永久取消提醒。也可运行命令“编辑时自动保存：检查并开启 HBuilderX 原生失焦保存”重新检查。 |
| 更新日志 | 1.0.1（2026-08-09）：<br>- 插件显示名称调整为“编辑时自动保存”。<br>- 原生失焦自动保存开启时保持静默，之后若被关闭会再次提醒。<br>- 新增明确的“不再提示”选择；关闭弹窗不再永久抑制提醒。<br>- 旧版 `focusSavePromptHandled` 状态不再被视为永久拒绝。 |
| 价格 | 免费（平台产品类型规则） |
| 开源协议 | MIT |
| 隐私声明 | 不收集或上传文件内容、文件路径及使用数据；无遥测或统计分析。 |
| 权限声明 | 无 |
| 数据声明 | 无 |
| 广告声明 | 无 |
| 平台 | HBuilderX 桌面编辑器；不是手机 App 插件。当前仅 Windows 已验证，macOS 与 Linux 未声明为已验证。 |
| 最低 HBuilderX | 3.2.3+ |
| 已验证环境 | Windows，HBuilderX 5.15.2026070915；2026-08-09 已完成只读修复与命令入口真实宿主复测 |
| 源码地址 | [GitHub 仓库](https://github.com/yanghui040701/uniapp-auto-save-plugin) |
| 问题反馈 | [GitHub Issues](https://github.com/yanghui040701/uniapp-auto-save-plugin/issues) |
| 发行 ZIP | yanghui-auto-save.zip |
| 截图建议 | 插件配置页；首次原生失焦保存授权对话框；仅在当前门户明确要求时增加市场封面或功能图。 |
| 审核备注 | 仅监听 HBuilderX 文本与配置事件，并调用 workbench.action.files.save 保存当前活动文件；防抖到期后使用 Node.js `fs.promises.access(..., W_OK)` 查询本地路径权限，不读取文件内容、不获取写句柄、不执行全部保存、不直接改写文件、不联网，无第三方运行依赖。一次性提示状态在 appData 不可用时回退用户主目录；目录创建或写入失败时，状态可能无法持久化。 |
| 个人/学生发布说明 | 使用本人 DCloud 账号，按门户实际要求如实选择个人身份并完成页面当时要求的验证或联系信息；学生身份不预设额外豁免，也不虚构企业资料。 |
| 发布状态 | 未发布；插件 ID 唯一性尚未在提交门户完成最终校验。 |

## 发布准备状态

“已证实”表示已有官方规则、代码或 manifest 依据；“门户当天复核”只用于确实可能随账号、界面或规则调整的项目；“尚未完成”表示发布者仍须实际操作，不能凭文档勾选。

| 事项 | 状态 | 说明 |
| --- | --- | --- |
| 市场价格 | 已证实 | DCloud 当前规则只允许 uniCloud、App 原生或 uts 插件付费；HBuilderX 编辑器插件属于其他类型，不能设置价格，因此本插件面向用户免费。 |
| 开源许可证 | 已证实 | 作者为本项目选择 MIT；这是源码使用许可，与市场价格是两个独立概念。 |
| 权限、数据与广告声明 | 已证实 | 当前代码与 package.json 均声明为“无”；DCloud 规范要求这些声明如实填写。 |
| 个人身份与门户字段 | 门户当天复核 | 登录后按页面当时要求确认个人身份、联系信息、协议与实际必填字段；没有一手依据证明学生有独立入口或豁免。 |
| 图片规格、操作按钮与审核流程 | 门户当天复核 | 是否需要封面、图片规格、按钮名称以及是否进入审核，以提交时门户实际界面为准。 |
| 插件 ID 唯一性 | 尚未完成 | 必须在登录后的创建或提交表单最终校验；公开搜索不能替代此步骤。 |
| metadata 校验、打包与 ZIP 检查 | 已证实 | 2026-08-09 再次完成普通测试、`NODE_OPTIONS=--unhandled-rejections=strict` 完整测试、9 文件 metadata 校验、打包及 ZIP 条目检查；实际产物记录见下方验证结果。 |
| 干净环境导入与卸载 | 尚未完成 | staging 目录已在 HBuilderX 5.15 中全新安装；2026-08-09 第 8、9 项真实宿主阻塞项已通过，但发布候选卸载验收仍未执行。 |
| 截图制作 | 尚未完成 | 在空白测试项目中实拍并清除敏感信息。 |
| 仓库与 Issues 可访问性 | 已证实 | 2026-08-09 已将 `yanghui040701/uniapp-auto-save-plugin` 设为公开仓库，插件代码已合并到 `main`；源码与 Issues 地址可公开访问。 |
| 门户最终提交或发布 | 尚未完成 | 只有门户返回成功状态后才能对外声称已发布。 |

## 可复制的详细介绍

编辑时自动保存是通用 HBuilderX 编辑器插件，不只适用于 uni-app。防抖保存负责停止输入后的保存；HBuilderX 原生失焦保存覆盖倒计时结束前切换文件或应用的场景。它监听当前文本文件的编辑变化；停止输入达到设定延迟后，会重新检查插件状态、活动文档身份、dirty 状态、URI，并异步检查本地路径当时是否可写，全部满足才通过 HBuilderX 原生命令保存当前活动文件。HBuilderX 明确标记为只读，或本地权限检查返回 `EPERM` / `EACCES` 时会跳过保存。

持续输入会重新计时。快速切换标签页时，插件不会把旧任务误用到新文件；建议配合 HBuilderX 的“失去焦点自动保存”，由原生能力保存刚离开的文件。插件只执行 `workbench.action.files.save`，不执行全部保存，也不直接写磁盘。

默认启用，默认延迟 1000 ms；用户可将延迟设置为 200–10000 ms。正常保存不打扰用户，只有保存失败或内部错误才显示提示。启动时原生失焦保存已开启则保持静默；只有在用户点击“开启”后，插件才会修改 `editor.saveOnFocusLost`。只有明确点击“不再提示”才会停止自动提醒，直接关闭弹窗不会永久取消提醒。

提示状态采用 schema v2，记录 `schemaVersion` 与 `focusSavePromptSuppressed`。明确选择“不再提示”保存在用户数据目录，卸载并重新安装插件不会清除这项选择；删除状态文件才会重置它。

插件不收集或上传文件内容、文件路径与使用数据，不包含遥测、统计分析或广告，不发起网络请求，也不申请特殊权限。未命名、检查时可识别为只读、非本地或已切换的文档会被跳过；权限预检存在 TOCTOU，Windows ACL、网络盘或检查后的权限变化仍可能让实际保存失败。强制结束 HBuilderX、系统崩溃或断电仍可能使尚未完成正常保存的修改丢失。

按 DCloud 当前产品类型规则，HBuilderX 编辑器插件不能设置价格，因此本插件面向用户免费。源码采用作者选择的 MIT 许可证；免费价格与开源许可彼此独立。

## 可复制的使用说明

1. 从插件市场导入并重启 HBuilderX。
2. 默认情况下，编辑本地可写文本文件并停止输入 1000 ms 后，插件保存当前文件。
3. 在插件配置中可修改 `hbuilderx-auto-save.enabled` 和 `hbuilderx-auto-save.delay`；本插件只有这两个配置项。
4. 原生失焦保存已开启时保持静默；关闭时会询问是否开启。只有点击“开启”才会授权插件修改 HBuilderX 原生失焦保存。自动更新失败时，前往 `工具 → 设置 → 常用配置 → 失去焦点自动保存` 手动开启。
5. 只有明确点击“不再提示”才会停止自动提醒；直接关闭弹窗不会永久取消提醒。需要重新检查时，从命令面板执行“编辑时自动保存：检查并开启 HBuilderX 原生失焦保存”。

完整使用、限制、卸载和提示状态重置说明以仓库 `README.md` 为准。

## 发行 ZIP 与本地导入检查

发布候选应使用项目的打包流程生成 `yanghui-auto-save.zip`，不要上传源码仓库的随手压缩包。生成后至少确认：

- ZIP 内没有 `.git`、工作树、测试缓存或其他开发机文件；
- ZIP 根目录直接包含非空 `package.json`，不能再套一层 `yanghui-auto-save/` 目录，否则 DCloud HBuilderX 插件上传校验无法发现 manifest；
- 解包出的插件根目录包含 `package.json`、`extension.js`、运行所需 `lib`、README、CHANGELOG 与 LICENSE；
- `package.json` 的 ID、版本、发布者、最低 HBuilderX 和声明与本页一致；
- 在干净的 HBuilderX 测试环境中，将解包目录命名为 `yanghui-auto-save` 并放入 `plugins` 目录，重启后能加载、配置、保存及卸载；
- 最终上传前重新运行普通完整测试、`NODE_OPTIONS=--unhandled-rejections=strict` 完整测试、Task 7 metadata 严格校验和打包命令，并记录产物哈希。

## 2026-08-06 Windows / HBuilderX 5.15 发布验证

- 操作系统：Windows 10 家庭中文版（中国），版本 25H2，OS build `26200.8875`。
- HBuilderX：`5.15.2026070915`。
- 验证日期：`2026-08-06`。
- 安装方式：仅在确认目标不存在后，新建 `plugins/yanghui-auto-save` 并复制 staging；9 个文件逐项 SHA-256 与 `dist/yanghui-auto-save` 一致。HBuilderX 日志确认插件发现、激活成功。
- 自动验证：普通 `npm test` 与 `NODE_OPTIONS=--unhandled-rejections=strict npm test` 均为 156/156 PASS；`npm run validate` 验证 9 个发布文件；`npm run package`、`git diff --check` 均 PASS。
- 当时产物：`dist/yanghui-auto-save.zip`，12741 bytes，SHA-256 `BB626B2841F5409BE86DD5FA6A7B8B0555B7EFC9848364A5E344706156A69C93`；当时 ZIP 将 9 个文件放在 `yanghui-auto-save/` 子目录。该结构后来被 DCloud HBuilderX 插件上传校验明确拒绝，本条仅保留历史证据，不能再作为上传候选。
- 环境隔离：真实 HBuilderX 中原有 `z-auto-saver` 也会在 1000 ms 后保存。为避免归因歧义，仅通过 HBuilderX 插件配置 UI 临时设为 `false`；矩阵结束后已恢复为 `true`。测试文件均位于打包目录下的临时忽略目录，不涉及用户项目。

| 序号 | 结果 | 证据 |
| --- | --- | --- |
| 1 | PASS | 在另一自动保存插件禁用后复测默认 1000 ms：磁盘 mtime 相对最后输入约 992 ms 更新，日志只有本插件的一次 `workbench.action.files.save`，标签页 dirty `*` 清除。 |
| 2 | PASS | 连续输入 3.6 秒；12 次磁盘采样均未变化且 HBuilderX 全程响应，最后一次输入后约 966 ms 保存。 |
| 3 | PASS | 编辑后 528 ms 内切换文件；旧文件由已开启的 HBuilderX 原生失焦保存更新，新文件在旧 10000 ms 定时器到期后仍未变化，日志无旧任务保存命令。 |
| 4 | PASS | 编辑后 204 ms 切换至另一应用；旧文件约 54 ms 后由 HBuilderX 原生失焦保存更新。 |
| 5 | PASS | 插件配置 UI 将延迟改为 200 ms 后，磁盘 mtime 在输入后约 200 ms 更新；改为 10000 ms 后，1.4、5.3、9.3 秒采样均未更新，约 10.0 秒更新。两次均无需重启。 |
| 6 | PASS | 配置 UI 设 `enabled=false` 后，后续编辑等待 11 秒磁盘仍未变化，标签页保留 dirty `*`，期间无保存命令；配置变化同时清理已有控制器任务的自动测试也已通过。 |
| 7 | PASS | 配置 UI 重新设 `enabled=true`，下一次编辑约 992 ms 后恢复保存，无需重启。 |
| 8 | FAIL | Windows 只读属性的隔离文件仍可在 HBuilderX 中编辑；停止输入后插件调用保存并出现“无法保存文件，请检查权限或文件是否处于只读状态”。磁盘未被改写，但插件未在调用保存前识别该只读文件。未命名文件入口未另行执行。 |
| 9 | NOT_RUN | HBuilderX 5.15 中 `Ctrl+Shift+P` 未打开命令面板；当前 Computer Use helper 又无法执行 UI 输入/状态调用。为避免继续误输入测试文件，未猜测其他快捷键。测试前后只读配置均确认 `editor.saveOnFocusLost=true`，但这不能替代命令本身的验证。 |
| 10 | PASS | 通过隔离文件的可恢复只读属性制造保存失败；磁盘未变化，只出现一个可见 HBuilderX 保存失败对话框。额外等待 3 秒无新日志或重复对话框；取消后恢复文件可写。 |

当时结论：**阻塞发布**。上表保留 2026-08-06 修复前真实宿主结果，不回写历史。2026-08-09 已用重建 staging 关闭第 8、9 项宿主阻塞，见下方复测记录。

### 2026-08-09 Task 8 real-host fix 与复测

- 根因是 HBuilderX 5.15 未通过未文档化的 `editor.readonly` / `editor.isReadonly` 反映 Windows ReadOnly 属性。runtime 现保留这两个字段作为快速 hint，并在 debounce 到期后的活动快照阶段，仅对本地、已命名且具有 `uri.fsPath` 的文档执行异步 `fs.promises.access(fsPath, W_OK)`；I/O 完成后再次读取活动 editor，使 controller 能对等待期间的纯标签切换重新做文档 key 复核。
- `EPERM` / `EACCES` 映射为只读，controller 因而会在调用 `workbench.action.files.save` 前静默跳过；非 `file:` URI、未命名文档和缺少稳定路径的文档不触发文件系统访问。其他 access 错误不会作为未处理拒绝逃逸，也不会被静默伪装成只读，而是保留正常 HBuilderX 保存/报错路径。
- 自动化包含注入 filesystem 的 runtime 回归、custom thenable/同步异常/未知错误策略以及 Windows 系统临时目录 ReadOnly 集成探针；该探针在 `finally` 中恢复可写并删除 fixture。
- Phase 4 与最终新鲜证据：异步 access 标签切换回归 1/1，普通、`NODE_OPTIONS=--unhandled-rejections=strict` 与打包内置全量测试均 164/164；metadata 校验 9 个文件。最终 ZIP 含 9 个条目、13728 bytes、SHA-256 `12AE973F991D6B0629EDEC2A2320AE4592ADE6241039CE4864B84FE79F448B29`。
- 预检不是保存事务：检查与保存之间仍有 TOCTOU，Node `fs.access` 也不能完整覆盖所有 Windows ACL 或网络文件系统行为。下方使用重建 staging 的独立复测表记录新结果，不改写上方 2026-08-06 历史矩阵。

复测前确认已安装目录为 `plugins/yanghui-auto-save`、manifest ID 为 `yanghui-auto-save` 且仅含 9 个发布文件；关闭 HBuilderX 后从新鲜 `dist/yanghui-auto-save` 覆盖该目录，逐文件 SHA-256 9/9 一致，再启动 HBuilderX 5.15。真实宿主期间仅临时关闭 `z-auto-saver`，本插件保持 `enabled=true`、`delay=1000`，原生 `editor.saveOnFocusLost=true`。

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 3：切页与异步权限检查 | PASS（组合证据） | 2026-08-06 真实宿主快速切页结果仍为 PASS；新增的权限访问等待期切页回归 `does not save a new active document switched during filesystem access` 本次全量与 strict 全量均通过。由于权限访问窗口极短，不把普通手动切页伪装成命中该微时序。 |
| 8：Windows ReadOnly | PASS（新构建真实宿主） | 在独立 `readonly.vue` 设置 Windows ReadOnly 后仍可编辑；停止输入并等待 4 秒，磁盘 SHA-256 `8CB5294965AE15742DAED569DF8FB64DB8435747DA14615C207987C0CD799238` 与长度 52 均未变化，标签页持续显示 dirty `*`，未出现保存命令造成的错误对话框。之后已恢复可写。未命名入口未执行。 |
| 9：命令入口 | PASS（新构建真实宿主） | 关闭 HBuilderX 后备份用户 `keybindings.json`，临时绑定 `Ctrl+Alt+Shift+S` 到 `yanghui-auto-save.checkFocusSave`；重启后执行快捷键，出现“失去焦点自动保存 / HBuilderX 的失去焦点自动保存已开启。”信息框。移除临时绑定后，原始与恢复 SHA-256 均为 `7F6A4DCF5AE1028718FAE78FD420A3CEE3BB7359B4BBE06164C18F8EB75BCCC4`。 |
| 10：实际保存失败只提示一次 | PASS（沿用 2026-08-06 旧构建） | 旧构建真实宿主已用可恢复只读属性确认只出现一个保存失败对话框，额外等待 3 秒无重复。2026-08-09 曾以隐藏、10 秒上限的 `FileShare.None` helper 尝试新构建 TOCTOU，但 HBuilderX 最终写入成功，无法证明保存发生时锁仍有效，因此该次标记为 INCONCLUSIVE，不伪造新构建 PASS。自动测试 `reports one failed save and waits for a new edit before retrying` 本次仍通过。 |

环境恢复：HBuilderX 已关闭；`readonly.vue` 的 ReadOnly 已恢复为 `false`；`settings.json` 原始与恢复 SHA-256 均为 `6FC3E0FD4CB22DF44B1DD423024E4ACA9003CE1168A3D8D1B3B62E4D98A6F3C7`，确认 `auto-saver.autosave=true`、本插件 `enabled=true` / `delay=1000`、`editor.saveOnFocusLost=true`；临时快捷键无残留。

Task 8 宿主阻塞结论：**READY**。第 8、9 项阻塞均由新构建真实宿主证据关闭；第 10 项只沿用并明确标注旧构建 PASS，新锁尝试不计入通过。这里的 READY 仅表示 Task 8 本地宿主门禁通过；插件 ID 唯一性、公开仓库、截图、卸载验收和门户最终提交等发布清单项目仍未完成，不能声称已发布。

### 2026-08-09 DCloud 市场 ZIP 根目录修复

- 首次上传旧 ZIP 时，DCloud 返回“插件包中未包含文件 package.json 或 package.json 内容为空”。解包检查确认旧 ZIP 的首层是 `yanghui-auto-save/`，`package.json` 位于第二层，而 HBuilderX 插件上传校验要求它直接位于 ZIP 根目录。
- 打包测试先改为要求 9 个白名单文件直接位于 ZIP 根目录，并在旧脚本上以实际条目差异失败；随后打包脚本改用 `ZipFile.CreateFromDirectory(..., includeBaseDirectory: false)`，避免再引入 staging 目录名。
- 修复后定向打包测试通过；普通、`NODE_OPTIONS=--unhandled-rejections=strict` 和打包内置全量测试均为 167/167，通过 9 文件 metadata 校验。
- 新上传候选仍为 `dist/yanghui-auto-save.zip`：13,560 bytes，SHA-256 `F795ECC520B79A5FF3E8F1AF8418B1A79E59354B27762B1413951D590E9863FE`。ZIP 共 9 个文件，根目录中存在且仅存在一个非空 `package.json`，没有 `yanghui-auto-save/` 外层目录。

## 截图清单

1. 插件配置页：同时显示 `enabled` 与 `delay`，不带个人路径、项目源码或其他敏感信息。
2. 原生失焦保存授权对话框：展示开启与不再提示两个选择；使用空白测试项目拍摄。
3. 市场封面/功能图：只有当前提交门户明确要求尺寸和格式时再制作，按门户当时的规范导出，不在本文臆测固定规格。

提交前清除用户名、磁盘路径、项目名、通知历史、账号信息等非必要内容。不得用效果图暗示已经上架或已经通过审核。

## 审核备注

- 插件定位：HBuilderX 编辑器插件，不是 uni-app 运行时插件或 App 原生插件。
- 保存边界：只调用 `workbench.action.files.save` 保存当前活动文件；不会执行 save-all，也不会绕过 HBuilderX 直接写项目文件。
- 只读边界：防抖到期后异步查询本地路径的 `W_OK`，只把 `EPERM` / `EACCES` 视为只读；检查不读取文件内容，且存在 TOCTOU 与平台权限模型限制。
- 本地状态：采用 schema v2，持久化 `schemaVersion` 与用户明确选择“不再提示”后的 `focusSavePromptSuppressed`。首选 `<hx.env.appData>/extensions/yanghui-auto-save/state.json`；appData 不可用时回退 `~/.hbuilderx-auto-save/state.json`。卸载并重新安装不会清除这项明确选择。
- 网络与依赖：无网络请求、无第三方运行依赖、无遥测、无广告。
- 通知：成功静默；仅保存失败或内部错误时提示。
- 兼容性：manifest 最低 HBuilderX 3.2.3；Windows HBuilderX 5.15.2026070915 已执行修复前矩阵，并于 2026-08-09 完成第 8、9 项修复后真实宿主复测；第 10 项仍明确沿用旧构建真实宿主 PASS。较旧 HBuilderX 与 macOS/Linux 均未验证，不得外推。

## 个人/学生账号逐步提交

1. 使用发布者本人 DCloud 账号登录[插件市场发布入口](https://ext.dcloud.net.cn/publish)；不要借用企业或他人身份。
2. 按登录后门户当前显示的要求，如实选择个人身份并完成必要验证、联系方式或协议确认。本文没有找到足以证明“学生有单独发布入口或审核豁免”的一手资料，因此不作此承诺。
3. 选择 HBuilderX 插件类型/分类，先在公开市场检索插件名和 ID，再在创建表单中完成最终 ID 校验。公开搜索无结果不能证明 ID 已锁定。
4. 生成发行 ZIP，完成严格校验、解包检查和干净环境本地导入测试。
5. 从“字段底稿”复制名称、版本、介绍、兼容性、链接与声明；逐项与 ZIP 内 `package.json` 复核。
6. 上传不含敏感信息的配置页与授权对话框截图；封面或功能图仅按门户当时的必填规则准备。
7. 按已证实的平台产品类型规则以免费 HBuilderX 插件发布，不设置价格；另行确认源码许可证为作者选择的 MIT，不把“免费”与“开源”合并为一个选项。若门户意外显示与当前官方规则冲突的计价控件，暂停提交并向 DCloud 复核，不选择付费价格。
8. 预览详情页，确认没有声称已验证的平台、已获得的审核或不存在的能力，然后按门户当时提供的按钮提交或发布；若门户进入审核流程，再按页面要求处理。
9. 保存提交时间、表单快照与 ZIP 哈希；若有审核，再保存审核沟通记录。只有门户返回成功状态后，才能对外声称已发布。

## 提交检查清单

- [ ] 本人 DCloud 账号可以登录，身份与联系信息按当前页面真实填写。
- [ ] 已选择 HBuilderX 插件类型，分类显示正确。
- [ ] `yanghui-auto-save` 已在登录后的创建/提交表单完成最终唯一性检查。
- [ ] 发行 ZIP 来自项目打包流程，文件名和内部版本都是 1.0.1，且 `package.json` 直接位于 ZIP 根目录。
- [ ] 严格 metadata 校验、完整测试与干净环境本地导入测试均有本次记录。
- [ ] README、CHANGELOG、LICENSE、源码与问题反馈链接可访问。
- [ ] 权限、数据与广告声明均与实际代码及 `package.json` 一致。
- [ ] 市场价格为免费，这是 HBuilderX 插件当前不能设置价格的平台产品类型规则。
- [ ] 开源协议为 MIT，这是作者的许可证选择，不作为市场免费价格的依据。
- [ ] 平台只声称 Windows 已验证，最低 HBuilderX 为 3.2.3。
- [ ] 截图不含隐私；封面/功能图仅在门户要求时按当前规格提供。
- [ ] 已逐项查看预览内容和最新协议，没有声称“已发布”或“唯一性已最终通过”。
- [ ] 最后一次复核门户字段后再点击最终提交。

## 一手资料与核查边界

资料基准日为 2026-08-06；在线复核日期为 2026-08-07。使用的一手资料如下：

- DCloud 官方 HBuilderX 插件规范：[官方文档页](https://hx.dcloud.net.cn/ExtensionDocs/manifest)与[官方源码](https://github.com/dcloudio/hbuilderx-extension-docs/blob/master/zh-cn/ExtensionDocs/manifest.md)。用于核对插件目录唯一 ID、根 `package.json`、名称/显示名/版本/引擎/描述等 manifest 约束。
- DCloud 官方 HBuilderX 插件安装文档：[插件安装](https://hx.dcloud.net.cn/Tutorial/PluginsInstall)。用于核对市场导入、离线 ZIP 解压、目录名等于插件 ID、重启与运行日志排查。
- DCloud 官方插件制作和发布指南：[制作和发布插件指南](https://uniapp.dcloud.net.cn/plugin/publish.html)。用于核对插件市场分类背景、包内排除版本控制内容、HBuilderX 插件属于编辑器插件而非手机 App 插件，以及只有 uniCloud、App 原生或 uts 插件支持付费、其他类型不能设置价格的当前规则。本项目要求的发布前本地验证属于自己的质量门禁，不把 `uni_modules` 的发布步骤直接套用为 HBuilderX 插件门户事实。
- DCloud 官方 `uni_modules` `package.json` 规范：[uni_modules 插件配置](https://uniapp.dcloud.net.cn/plugin/uni_modules)。用于核对 `dcloudext.declaration.ads/data/permissions` 是需要如实填写的隐私、权限与商业化声明；只引用这项跨市场 metadata 规则，不把 `uni_modules` 的具体发布流程套用到本插件。
- DCloud 官方 HBuilderX 插件市场分类入口：[HBuilderX 插件市场](https://ext.dcloud.net.cn/?cat1=1&cat2=11&orderBy=TotalDownload)。用于提交前公开检索和详情页复核。
- DCloud 官方命令 API：[commands 源码](https://github.com/dcloudio/hbuilderx-extension-docs/blob/master/zh-cn/ExtensionDocs/Api/commands.md)。用于核对插件通过 HBuilderX 命令系统注册和执行命令的技术边界。

登录后的发布门户字段、身份验证要求、图片尺寸、审核策略和操作入口可能随时间变化，也可能因账号或插件类型不同而变化，提交时须按实际页面复核。此复核范围不包含已由官方规则证实的当前价格状态：HBuilderX 编辑器插件不能设置价格，本插件按平台产品类型规则免费；MIT 则是作者独立选择的开源许可证。

仓库状态复核：2026-08-09 已将 manifest 中填写的 GitHub 仓库设为公开，插件代码已通过 PR 合并到 `main`，源码与 Issues URL 均可公开访问。后续若调整仓库名称、可见性或 Issues 设置，发布新版本前仍需重新检查这些链接。
