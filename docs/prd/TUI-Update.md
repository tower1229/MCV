## 结论

最可行的路线是：

> 保留 TypeScript/Node.js 和现有命令协议，先把业务逻辑从终端交互中拆出来，再增加基于 Ink 的 TUI。

不建议现在重写 Go，也不建议直接在现有 `captureConfigurations()` / `deployConfigurations()` 外包一层全屏界面。当前安全闭环已经成立，主要问题是操作模块不够“深”：计划生成、输出、询问和执行混在一起，TUI 无法可靠复用。

当前测试基线正常：13 个测试文件、45 项测试全部通过，TypeScript 类型检查通过。

## 现状判断

已经具备的基础：

- Capture 已经过脱敏、参数化、冲突处理、预览、确认后才写入。
- Deploy 已有计划、备份、事务写入、失败回滚、幂等和 symlink 防护。
- Restore 会阻止覆盖部署后再次变化的文件，并保存恢复前状态。
- Status 已覆盖绑定、Git、IDE/Surface、环境变量和 Drift。
- Codex、Claude Code、Gemini 三个 Adapter 已形成真实架构。

这些能力可从 [README.md](C:/Workspace/tower1229/MCV/README.md:90) 和 [deploy.ts](C:/Workspace/tower1229/MCV/src/commands/deploy.ts:72) 看到。

主要缺口：

1. 无参数 `mcv` 仍是单行数字菜单，不是状态驱动的控制台。[index.ts](C:/Workspace/tower1229/MCV/src/index.ts:98)
2. Capture/Deploy 同时负责业务、输出、询问和副作用。[capture.ts](C:/Workspace/tower1229/MCV/src/commands/capture.ts:105)
3. Status 只会 `console.log`，无法直接供 TUI 首页或 JSON 协议消费。[status.ts](C:/Workspace/tower1229/MCV/src/commands/status.ts:10)
4. Restore 没有独立预览阶段，调用即执行。[restore.ts](C:/Workspace/tower1229/MCV/src/commands/restore.ts:17)
5. 已经定义了 `ChangePlan`，但当前没有真正成为统一操作接口。[types.ts](C:/Workspace/tower1229/MCV/src/adapters/types.ts:106)
6. `--json` 目前可能输出 JSON 后继续询问、执行并输出普通文本，尚不是可靠的机器协议。
7. PRD 已明确要求核心层不询问用户、CLI 只负责呈现和选择，代码尚未完全落实。[MCV 产品需求文档.md](C:/Workspace/tower1229/MCV/docs/prd/MCV%20产品需求文档.md:1475)

## 目标架构

```text
Commander Router
├─ Ink TUI ────────────┐
└─ CLI / JSON Renderers ─┤
                       ▼
              Operation Modules
                       ▼
       Adapters / Repository / State
```

建议建立以下操作模块：

```ts
inspectEnvironment(): Promise<EnvironmentReport>

inspectRepository(path): Promise<RepositoryReport>
createInitPlan(path): Promise<InitPlan>
applyInitPlan(plan): Promise<OperationResult>
createBindPlan(path): Promise<BindPlan>
applyBindPlan(plan): Promise<OperationResult>
createUnbindPlan(): Promise<UnbindPlan>
applyUnbindPlan(plan): Promise<OperationResult>
createMigrationPlan(path): Promise<MigrationPlan>
applyMigrationPlan(plan): Promise<OperationResult>

createCapturePlan(options): Promise<CapturePlan>
applyCapturePlan(plan, selection): Promise<OperationResult>

createDeployPlan(options): Promise<DeployPlan>
applyDeployPlan(plan, selection): Promise<OperationResult>

createRestorePlan(): RestorePlan
applyRestorePlan(plan): OperationResult

getStatus(): Promise<StatusReport>
```

数据仓库生命周期收敛在一个深的 `repository` 操作模块中，不按 Init、Bind、Unbind、Migration 机械拆成多个浅文件。`discover` 的核心能力并入 `inspectEnvironment()`；CLI 可以继续保留 `discover` 命令名作为该 Report 的直接入口。

它们的接口只接收数据、返回数据，不输出、不询问用户。复杂的脱敏、冲突处理、备份和事务写入继续隐藏在模块内部。

TUI 与非交互 CLI / JSON Renderer 只负责：

- 调用操作模块；
- 呈现计划；
- 收集选择；
- 调用 Apply；
- 呈现结果。

## 分阶段方案

| 阶段         | 主要改动                                                      | 完成标准                                                         |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| P0：协议收敛 | 提取结构化 Plan、Report、Result；拆分计划与执行；统一错误对象 | 所有核心流程可以在没有 TTY、没有 `console.log` mock 的情况下测试 |
| P1：CLI 优化 | 完善 JSON、退出码、错误建议、颜色和终端宽度适配               | CLI 可稳定用于脚本、CI 和 Agent                                  |
| P2：可用 TUI | 首页状态面板；Repository、Capture、Deploy、Restore 向导；文件选择和 Diff；终端恢复和基本 PTY 中断测试 | 普通用户无需记命令或编辑 `mcv.yaml` 即可完成 v0.1 闭环，且所有退出路径都恢复终端 |
| P3：体验打磨 | 补充快捷键、帮助面板、更完整的进度反馈、错误详情和响应式布局 | Windows Terminal/macOS 常见尺寸下稳定运行 |

### P0：先建立统一操作模型

目录建议：

```text
src/
├─ operations/
│  ├─ environment.ts
│  ├─ repository.ts
│  ├─ capture.ts
│  ├─ deploy.ts
│  ├─ restore.ts
│  └─ status.ts
├─ interfaces/
│  ├─ cli/
│  ├─ tui/
│  └─ renderers/
├─ adapters/
└─ utils/
```

这里不需要机械搬文件。重点是：

- `create*Plan()` 只读取和计算。
- `apply*Plan()` 才允许写入。
- Init、Bind、Unbind 和 Migration 与 Capture、Deploy、Restore 使用同一套 Plan、Issue 和 Result 契约。Unbind 只删除本机绑定，不删除数据仓库或 IDE 配置。
- Plan 是当前进程内的不可变快照，带有不透明操作 ID 和源文件、目标文件的前置哈希。Apply 必须验证 ID、用户选择和前置哈希；任一前置状态变化都必须拒绝执行并重新生成 Plan。
- TUI 只能提交计划中的可选项，不能自行拼接目标路径。
- 删除继续默认不选中。
- Capture Diff 只能展示已经脱敏、参数化后的内容，不能为了界面预览重新暴露原始秘密。

Restore 应拆成预览和执行，但首期保持当前安全策略：部署后发生的文件变化统一称为 Restore Conflict（恢复冲突），v0.1 必须拒绝恢复，列出冲突路径并建议先备份或手动处理，不提供二次确认强制覆盖。该概念与按照 Baseline Snapshot 判定的 Drift（漂移）不同。

### P1：把 CLI 变成稳定协议

建议统一以下规则：

```text
TTY 中无参数        → TUI 首页
TTY 中使用业务子命令 → 作为深链接直接进入同一套 TUI 对应页面或流程
显式 --dry-run、--yes、--json、只读命令的 --plain，或非 TTY → 纯文本 / JSON 协议，不启动 TUI
无参数 + 非 TTY      → 输出帮助并返回非错误状态
只读命令 + --plain   → 一次性英文文本 Report
写操作 + --dry-run → 一次性英文文本 Plan
写操作 + --yes  → 一次性英文文本 Result
只读命令 + --json    → 单个 Report JSON
写操作 + --json --dry-run → 单个 Plan JSON，不执行
写操作 + --json --yes    → 单个 Result JSON，非交互执行
写操作仅使用 --json   → 用法错误，不询问、不执行
```

业务子命令不再维护另一套逐行问答界面。例如，在 TTY 中运行 `mcv capture` 会跳过首页，直接打开与首页入口相同的 Capture TUI 流程；`mcv status` 打开 Overview，`mcv discover` 打开 Environment Details。`--help` 和 `--version` 仍是即时文本输出，不进入 TUI。

只读命令 `status` 和 `discover` 可以单独使用 `--plain` 或 `--json`，两者互斥，同时使用返回用法错误 `2`。计划型写操作如 `init`、`capture`、`deploy`、`restore`、`bind`、`unbind` 和 `migrate` 不提供冗余的 `--plain`：单独使用 `--dry-run` 即输出英文文本 Plan，单独使用 `--yes` 即输出英文文本 Result；与 `--json` 组合时则输出 JSON。所有显式文本 / JSON 模式都不得启动 TUI，即使当前处于 TTY。

`--dry-run` 与 `--yes` 互斥，同时使用返回用法错误 `2`。

Plan 不持久化，`--dry-run` 输出也不是可回放的授权凭证。`--yes` 在同一进程内重新生成 Plan，只有 Plan 中不存在 `warning`、`decisionRequired` 或 `error` 级别的 Issue 时才立即执行。之前运行 `--dry-run` 只是审阅建议，两次命令之间不建立技术关联。

### Issue 等级与 Apply 规则

Plan、Report 和 Result 不再使用无类型的字符串 `warnings`，统一返回结构化 Issue：

| 级别               | 含义                                                             | TUI 行为                   | `--yes` |
| ------------------ | ---------------------------------------------------------------- | -------------------------- | ------- |
| `notice`           | 预期信息，如脱敏数量、未安装 IDE、能力不受支持               | 展示后可继续             | 允许    |
| `warning`          | 操作安全但结果不完整，如 symlink 防护跳过、缺少环境变量 | 必须审阅并显式确认       | 阻断    |
| `decisionRequired` | 来源冲突、删除候选等必须由用户选择的事项                     | 解决每一项后才可 Apply | 阻断    |
| `error`            | 密钥扫描失败、Plan 前置状态失效、备份失败等不可继续错误      | 禁用 Apply                 | 阻断    |

`--yes` 必须在任何写入前完成上述检查，不得通过“先执行安全子集”返回部分成功。

### TUI 导航与退出契约

- TTY 下的 TUI 进入 alternate screen，不把界面刷新过程留在主屏滚动历史中。JSON 和非 TTY 模式永远不进入 alternate screen。
- 所有业务子命令都是同一 TUI Shell 的深链接，不是独立应用。从 `mcv` 首页或子命令进入的写操作，完成后都停留在结果页：按 Enter 返回已刷新的首页，按 `q` 直接退出。
- `status` 和 `discover` 等只读页面按 `Esc` 返回首页，按 `q` 直接退出。其他多步流程中 `Esc` 返回上一步；在首页按 `Esc` 或 `q` 退出。
- `Ctrl+C` 统一以退出码 `130` 退出。Apply 尚未开始时可以立即取消；进入写入事务后不响应普通取消，必须等待“写入成功”或“失败并回滚”完成后再退出。
- 所有正常退出、用户中断和未捕获异常路径都必须恢复主屏、光标和输入模式。通过直接子命令完成操作后，在恢复主屏后打印一条简洁结果摘要；失败时打印错误摘要和下一步建议。从首页启动且未执行任何操作时，退出后不打印内容。

JSON 顶层结构：

```json
{
  "schemaVersion": 1,
  "operation": "deploy",
  "status": "planned",
  "readyToApply": true,
  "repositoryPath": "...",
  "changes": [],
  "issues": [],
  "nextActions": []
}
```

同时补充：

- JSON 模式的 stdout 只能放一个完整 JSON 文档；诊断和进度只能放 stderr。
- `status`、`discover`、`restore` 也支持 `--json`。
- 退出码用于进程级快速分流：`0` 表示命令按请求完成（包括成功生成仍含待决 Issue 的 `--dry-run` Plan）；`1` 表示执行或系统失败；`2` 表示用法或输入错误；`3` 表示非交互执行因 `warning` 或 `decisionRequired` 被阻断；`130` 表示用户中断。
- JSON 中的 `status`、`readyToApply`、`issues` 和 `error.code` 是机器协议的主依据，退出码不替代结构化结果。
- 颜色按终端能力自动启用并遵循 `NO_COLOR`，不新增 `--color` 参数；Issue 级别和选中状态不得只依赖颜色区分。
- 引入结构化 `McvError`：错误码、用户消息、技术细节、建议动作。

## TUI 首期范围

TUI、CLI help、提示、错误、进度和结果摘要全部使用英文。命令名、参数名、JSON 字段名和 `error.code` 保持英文。README 继续使用中文；v0.1 不引入 i18n 框架，不展示中英双语界面。

首页只展示当前真实能力：

```text
MCV · Mobile Configuration Vehicle

Repository              C:\...\my-mcv        Git clean (shown only when Git is detected)
Last operation          deploy · success
Pending deployment      3 changes
Post-deploy local state 1 change
Environment             2 missing variables

IDE
✓ Codex
✓ Claude Code
! Gemini · Antigravity not detected

Suggested actions
› View local changes
  Capture current configuration
  Preview deployment
  Restore latest deployment
  Manage repository
```

一级导航建议控制为：

- Overview
- Capture
- Deploy
- Restore Latest Deployment
- Repository
- Help

首页不使用模糊的 “sync” 状态。“Pending deployment” 由当前数据仓库与本机状态生成的只读 Deploy Plan 计算，显示 add、modify 和 delete candidate 数量；“Post-deploy local state” 按 Baseline Snapshot 显示 unchanged、Drift 和 missing 数量。首页异步计算 Deploy Plan，计算中显示 “Checking…”，失败时显示结构化 Issue；详细 Diff 和选择只在进入 “Preview deployment” 后展示。首页不运行 Capture 扫描。

不应加入尚不存在的：

- Profile / Preset
- Cursor Adapter
- 长期操作历史
- Settings 中心
- 独立 `diff`、`rollback` 命令
- 命令面板
- 自动 Git commit/push

Diff 是 Capture/Deploy 计划内部的查看动作；Rollback 是内部概念，用户界面统一称 “Restore Latest Deployment”。

数据仓库是用户自选的本地目录。Git 状态只在检测到当前数据仓库是 Git worktree 时作为中性信息展示；非 Git 状态不产生 Issue，TUI 也不提示或代为执行 `git init`、commit、push 或 pull。

### 数据仓库与首次使用

- 未绑定且当前目录包含有效 `mcv.yaml`：首选 “Bind current repository”。
- 未绑定且当前目录不是 MCV 数据仓库：提供 “Initialize in current directory” 和 “Enter an existing repository path”。
- 已绑定且路径有效：展示路径、Repository ID、schema 版本和可选 Git 状态，提供重新绑定和解除绑定。
- 已绑定但路径失效或 Repository ID 不匹配：阻断 Capture、Deploy 和 Restore，提供 “Bind current directory”、“Enter a new path” 和 “Remove old binding”。
- 检测到旧 schema：先展示 Migration Plan，迁移成功前不进入其他写操作。

Init Apply 只负责创建合法空数据仓库并绑定当前设备。成功后继续进入环境扫描和 Capture 向导；如果用户取消 Capture，保留已初始化的空数据仓库，不回滚 `mcv.yaml` 或本机绑定。`mcv bind` 的路径参数应改为可选：未传入时默认使用当前目录，传入时使用显式路径。

### Capture 流程

```text
扫描 → 处理冲突 → 展示安全计划 → 按文件选择 → 确认 → 写入 → 验证
```

需要补齐当前缺失的分层选择：顶层按 IDE 选择，展开后按配置文件、Skill 或 MCP 选择；支持 “Accept all safe changes” 和 “Cancel all changes”，但不做字段级编辑。设备端已删除而仓库仍存在的配置作为删除候选展示，默认不选中。冲突选择继续支持 “Choose authoritative source” 或 “Skip”。

### Deploy 流程

```text
环境预检 → 生成计划 → 查看文件/Diff → 选择 → 确认 → 备份并执行 → 验证
```

执行后增加显式验证：

- 目标存在；
- 内容哈希等于计划；
- 结构化文件可重新解析；
- 没有遗留临时文件；
- 基线和 managed inventory 写入成功。

Deploy 使用与 Capture 一致的分层选择：按 IDE 筛选，再按 Shared Rules、Skills、MCP 和 IDE-specific Configuration 展开到文件。已安装且仓库中存在配置的 IDE 及其安全变化默认选中；删除候选收纳在折叠的 Advanced Cleanup 区，默认不选中，且不得被 `--yes` 执行。

每次 Deploy 成功后，在本机状态中记录本次选中的 IDE 和能力范围。下次 Deploy 可选择 “Use this device's previous selection”；已不存在或已不受支持的项自动忽略，新增项按当前安全默认值处理。这只是本机交互便利状态，不命名为 Preset，不写入数据仓库，不在设备间共享。

Deploy 不提供全局 “Overwrite local configuration” 开关。对 Overlay 文件，计划只能修改 `managedPaths`，未声明的 Native 字段必须保留，`localPaths` 始终排除。对 MCV 完整拥有的文件，如果操作会替换全文，文件详情和 Diff 必须明确标注 “Replace entire file”。

### Restore 流程

```text
读取最近备份 → 展示时间和文件 → 检查部署后变化 → 确认 → 恢复
```

如果文件后来发生变化，显示 Restore Conflict（恢复冲突）的阻断原因和路径，建议用户先备份或手动处理，不提供危险的“一键强制恢复”。

## 技术选择

正式 TUI 建议继续使用 TypeScript + Ink，不迁移 Go。

理由：

- 现有业务和测试都在 TypeScript 中，重写会重新承担安全与跨平台风险。
- Ink 足以实现列表、键盘操作、Flexbox 布局和可测试输出。[Ink 官方仓库](https://github.com/vadimdemedes/ink)
- 当前 Ink 是 ESM 包，而 MCV 还是 CommonJS：[tsconfig.json](C:/Workspace/tower1229/MCV/tsconfig.json:1)、[package.json](C:/Workspace/tower1229/MCV/package.json:34)。

因此应把整个 MCV 包从 CommonJS 迁移到 NodeNext/ESM，作为独立变更完成并验证，再引入 Ink 7。MCV 已要求 Node `>=22.12.0`，高于 Ink 7 的 Node `>=22` 要求，不会因此抬高运行时下限。不维护 CommonJS / ESM 双构建，不为 TUI 增加独立加载桥。ESM 迁移必须先独立通过现有 CLI、typecheck、test、build 和 npm bin 验证，避免把模块系统迁移、核心重构和 TUI 一次性混在一起。不要同时引入 Ink、Clack、Inquirer 三套交互库。

## 推荐实施顺序

1. 抽取 `getStatus()` 和 `inspectEnvironment()`，先让首页有结构化数据。
2. 抽取 Repository Plan/Apply，覆盖 Init、Bind、Unbind 和 Migration。
3. 抽取 Deploy Plan/Apply，这是现有逻辑最清晰、测试最完整的流程。
4. 抽取 Capture Plan/Apply，并实现分层选择。
5. 抽取 Restore Plan/Apply。
6. 收紧 JSON、Issue、错误和退出码协议。
7. 独立完成整包 ESM 迁移。
8. 实现最小 TUI：首页、Capture、Deploy、Restore、Repository。
9. 在切换默认路由前，补充 TUI reducer 测试、输出快照、alternate screen 恢复和真实 PTY 中断测试。
10. 更新 ADR、PRD 实现状态和 README。

`codebase-design` skill 对方案的直接影响是：先建立可被 CLI、TUI、JSON 和测试共同复用的深模块接口，再建设界面；避免把新的 TUI 变成另一套业务实现。
