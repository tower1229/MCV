**实现状态（2026-08-12）：已实现。** 当前界面由裸命令一次性任务启动器、一次性 Command/Report、分级 Capture Review、专用 Profile TUI 和本地 stdio MCP 组成。历史全局 Shell 仍已删除；任务启动器不是业务 Shell。

## 路由契约

- stdin/stdout 均为 TTY、`TERM` 非 `dumb`、locale 支持 Unicode、尺寸至少 `60×18` 时，裸 `mcv` 打开任务启动器。
- 非 TTY、重定向、低能力/过小终端回退一次性安全报告：有效绑定输出 Overview；未绑定或无效绑定输出 Repository Report。
- `mcv status`、`--help`、`--version`、JSON、MCP 和全部显式子命令永不进入启动器。
- 菜单渲染失败先恢复终端，再报告原因并回退安全报告。

## 主菜单状态模型

`MenuSnapshot` 只包含 Repository 绑定身份和 Deploy 选择所需的 Profile 名单。启动器打开前不扫描设备配置、不编 Deploy Plan、不计算 Pending Deployment Change 或 Drift、不展示 Overview。`MenuState` 只承担 home、inspect、more、Deploy/Restore 选择和 Bind 路径输入。`MenuAction` 只表达 Capture、Profiles、Inspect、Deploy、Init、Bind、Restore、Migrate、Unbind、Help 或 Quit 意图，不能携带 Plan、Change、Issue、授权或 Result。

分类优先级与默认焦点：

1. `unbound` → Create Repository。
2. `blocked` → Inspect System。
3. `bound` → Capture Local Configuration。

已绑定首页依次显示标题以及 Capture、Deploy、Profiles、Inspect、More、Quit。未绑定首页显示 Create、Bind、Inspect Detected IDEs、Help、Quit。Inspect 包含 Overview、Environment、Repository；More 包含 Restore、Migrate、Unbind、Discover、Help。Overview 只在用户选择 Inspect Overview 或运行 `mcv status` 后作为一次性报告出现。

## 任务交接与写边界

选择任务后必须先卸载 alternate screen，再交给现有 Command adapter。任务结束后进程退出，不返回菜单。菜单打开、导航、返回、取消不能修改 Repository、本机 state、目标、backup、Receipt 或 Review Artifact。

- Capture → 现有分级 Capture 审阅；Profiles → 现有 Profile TUI。
- Deploy 只收集 Scope/Profile/Project target；Project 默认当前目录且不预选 Profile，Global 预选 `global`。
- Restore 只收集 Project/Global Scope。
- Repository 生命周期由 Command 展示 Plan、确认并对同一进程内 Plan Apply；菜单不伪造 `--yes`。
- Help 在卸载菜单后输出 Commander help。

所有写入仍只发生在现有 Apply seam。显式 `--dry-run`、`--yes`、`--json` 契约保持不变。

## 键盘与呈现

- `↑/↓` 移动，Enter 选择，Esc 返回；首页 Esc/q 正常退出。
- Ctrl+C 返回 130；Space 只用于 Profile 多选。字母快捷键只能增强。
- `NO_COLOR` 不移除文字、符号、焦点或选择语义。
- 主菜单不创建 Review Artifact。其他复杂人类输出仍遵循短期私有 Artifact 契约；失败时先打印原因、回退行数和权限修复/重试提示，再完整输出详情。

## Operation 反馈

Operation 可发布 `as const` 定义的阶段事件：Inspecting repository、Scanning adapters、Building plan、Creating verified backup、Applying selected changes、Verifying result、Rolling back。只有交互式人类 TTY adapter 向 stderr 显示无百分比反馈；非 TTY、JSON 和 MCP 不显示。

成功 Next Actions：Init/Bind → Discover、Capture；Capture → Profiles、Deploy；Deploy → Status。Overview 分别报告 Baseline file Drift、Skill content Drift、topology Drift 和 missing，不能用未分层的总量掩盖具体含义。

## 测试契约

- 纯模型测试覆盖三种 Situation、顺序/默认焦点、导航/返回/取消/中断和 Deploy 默认值。
- packaged `dist/index.js` 测试覆盖路由、真实任务结果、退出码和取消零写入；不以大面积视图快照或私有调用顺序为契约。
- macOS real PTY 与 Windows native ConPTY 覆盖正常退出、Ctrl+C、render failure、alternate screen、光标和输入模式恢复，以及 `NO_COLOR`/Unicode。
- 非 TTY、Status、帮助、版本、JSON 单文档、MCP 和显式命令必须保持兼容。

## Out of Scope

持久化全局 Shell、业务 Result 页面、Settings、History、Doctor、Cursor Adapter、后台进程、GUI、自动 Git 写入和可重放 Plan 均不在范围内。历史 `TUI-Update.md` 继续仅作历史记录。
