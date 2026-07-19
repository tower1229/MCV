## 结论

最可行的路线是：

> 保留 TypeScript/Node.js 和现有命令协议，先把业务逻辑从终端交互中拆出来，再增加基于 Ink 的 TUI。

不建议现在重写 Go，也不建议直接在现有 `captureConfigurations()` / `deployConfigurations()` 外包一层全屏界面。当前安全闭环已经成立，主要问题是操作模块不够“深”：计划生成、输出、询问和执行混在一起，TUI 无法可靠复用。

当前测试基线正常：13 个测试文件、44 项测试全部通过，TypeScript 类型检查通过。

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
7. PRD 已明确要求核心层不询问用户、CLI 只负责呈现和选择，代码尚未完全落实。[MCV 产品需求文档.md](C:/Workspace/tower1229/MCV/docs/prd/MCV%20产品需求文档.md:1465)

## 目标架构

```text
Commander CLI ─┐
               ├─> Operation Modules ─> Adapters / Repository / State
Ink TUI ───────┤
JSON Renderer ─┘
```

建议建立四个操作模块：

```ts
inspectEnvironment(): Promise<EnvironmentReport>

createCapturePlan(options): Promise<CapturePlan>
applyCapturePlan(plan, selection): Promise<OperationResult>

createDeployPlan(options): Promise<DeployPlan>
applyDeployPlan(plan, selection): Promise<OperationResult>

createRestorePlan(): RestorePlan
applyRestorePlan(plan): OperationResult

getStatus(): Promise<StatusReport>
```

它们的接口只接收数据、返回数据，不输出、不询问用户。复杂的脱敏、冲突处理、备份和事务写入继续隐藏在模块内部。

CLI 和 TUI 只负责：

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
| P2：可用 TUI | 首页状态面板；Capture、Deploy、Restore 向导；文件选择和 Diff  | 普通用户无需记命令或编辑 `mcv.yaml` 即可完成 v0.1 闭环           |
| P3：体验打磨 | 快捷键、帮助面板、进度反馈、错误详情、终端恢复和 PTY 测试     | Windows Terminal/macOS 常见尺寸下稳定运行                        |

### P0：先建立统一操作模型

目录建议：

```text
src/
├─ operations/
│  ├─ environment.ts
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
- Plan 带稳定 ID，Apply 必须验证所执行的是未经篡改或过期的计划。
- TUI 只能提交计划中的可选项，不能自行拼接目标路径。
- 删除继续默认不选中。
- Capture Diff 只能展示已经脱敏、参数化后的内容，不能为了界面预览重新暴露原始秘密。

Restore 应拆成预览和执行，但首期保持当前安全策略：部署后发生变化时拒绝恢复，不急于增加强制覆盖。

### P1：把 CLI 变成稳定协议

建议统一以下规则：

```text
有子命令             → 普通 CLI
无参数 + TTY         → TUI
无参数 + 非 TTY      → 输出帮助并返回非错误状态
--json --dry-run     → 单个计划 JSON，不执行
--json --yes         → 单个最终结果 JSON，非交互执行
--json 单独使用      → 明确报错，避免“输出后又询问”
```

JSON 顶层结构：

```json
{
  "schemaVersion": 1,
  "operation": "deploy",
  "status": "planned",
  "repositoryPath": "...",
  "changes": [],
  "warnings": [],
  "nextActions": []
}
```

同时补充：

- stdout 只放最终结果；诊断和进度放 stderr。
- `status`、`discover`、`restore` 也支持 `--json`。
- 退出码先保持简单：`0` 成功，`1` 执行失败，`2` 需要人工决策。
- 支持 `--color=auto|always|never` 和 `NO_COLOR`。
- 引入结构化 `McvError`：错误码、用户消息、技术细节、建议动作。

## TUI 首期范围

首页只展示当前真实能力：

```text
MCV · Mobile Configuration Vehicle

数据仓库    C:\...\my-mcv        Git clean
最近操作    deploy · success
部署状态    12 同步 · 1 本地变化
环境变量    缺少 2 项

IDE
✓ Codex
✓ Claude Code
! Gemini · Antigravity 未检测到

建议操作
› 查看本地变化
  收集当前配置
  预览部署
  恢复最近部署
  管理数据仓库
```

一级导航建议控制为：

- 环境总览
- 收集配置
- 部署配置
- 最近恢复
- 数据仓库
- 帮助

不应加入尚不存在的：

- Profile / Preset
- Cursor Adapter
- 长期操作历史
- Settings 中心
- 独立 `diff`、`rollback` 命令
- 命令面板
- 自动 Git commit/push

Diff 是 Capture/Deploy 计划内部的查看动作；Rollback 在用户界面继续称“恢复最近部署”。

### Capture 流程

```text
扫描 → 处理冲突 → 展示安全计划 → 按文件选择 → 确认 → 写入 → 验证
```

需要补齐当前缺失的按文件选择，但不做字段级编辑。冲突选择继续支持“选择权威来源”或“跳过”。

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

### Restore 流程

```text
读取最近备份 → 展示时间和文件 → 检查部署后变化 → 确认 → 恢复
```

如果文件后来发生变化，首期显示阻断原因和路径，不提供危险的“一键强制恢复”。

## 技术选择

正式 TUI 建议继续使用 TypeScript + Ink，不迁移 Go。

理由：

- 现有业务和测试都在 TypeScript 中，重写会重新承担安全与跨平台风险。
- Ink 足以实现列表、键盘操作、Flexbox 布局和可测试输出。[Ink 官方仓库](https://github.com/vadimdemedes/ink)
- 当前 Ink 是 ESM 包，而 MCV 还是 CommonJS：[tsconfig.json](C:/Workspace/tower1229/MCV/tsconfig.json:1)、[package.json](C:/Workspace/tower1229/MCV/package.json:34)。

因此应把“CommonJS → NodeNext/ESM”作为独立变更完成并验证，再引入 Ink，避免把模块系统迁移、核心重构和 TUI 一次性混在一起。不要同时引入 Ink、Clack、Inquirer 三套交互库。

## 推荐实施顺序

1. 抽取 `getStatus()` 和 `inspectEnvironment()`，先让首页有结构化数据。
2. 抽取 Deploy Plan/Apply，这是现有逻辑最清晰、测试最完整的流程。
3. 抽取 Capture Plan/Apply，并实现文件级选择。
4. 抽取 Restore Plan/Apply。
5. 收紧 JSON、错误和退出码协议。
6. 独立完成 ESM 迁移。
7. 实现最小 TUI：首页、Capture、Deploy、Restore、Repository。
8. 补充 TUI reducer 测试、输出快照和真实 PTY 中断测试。
9. 更新 ADR、PRD 实现状态和 README。

`codebase-design` skill 对方案的直接影响是：先建立可被 CLI、TUI、JSON 和测试共同复用的深模块接口，再建设界面；避免把新的 TUI 变成另一套业务实现。
