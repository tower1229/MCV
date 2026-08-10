# MCV

> 可以随处部署的个人生产力，帝国的第一座建筑。

MCV（Mobile Configuration Vehicle）是一个本地运行的 CLI，用来把 Codex、Claude Code 和 Gemini 的个人配置忠实收集到用户自己掌控的本地数据仓库，并在另一台 macOS 或 Windows 设备上事务化部署。Git 是可选且推荐的版本管理、备份和传输方式，但不是使用 MCV 的前置条件。

MCV `0.3.0-beta.1` 在忠实 Capture / 事务化 Deploy 之上加入 Profile 选择、**项目为默认 Deploy scope**、项目 Managed Receipt，以及本地 MCP 上的 Profile 读写。当前未发布实现进一步将复杂的人类可读详情写入短期本地 Review Artifact，并提供 `--verbose` 显式打印完整终端输出。MCV 不判断配置内容是否敏感；Adapter 支持范围内发现的明文密钥、`.env`、credential、PEM/key 等文件会原样进入 Repository、Review Artifact、`--verbose` 终端输出、JSON 和备份。用户自行决定使用明文还是 `${env:*}`，并自行负责访问控制、加密、传输和泄漏风险。MCV 不会安装 IDE，也不会在后台自动修改配置。

> `0.3.0-beta.1` 是预发布版本。请把 Repository、Review Artifact、备份、`--verbose` 终端输出和 JSON 视为可能含明文密钥的数据，并按自己的安全要求管理。升级已有 Repository 前先运行 `mcv migrate --dry-run`。
>
> **Breaking：** 裸 `mcv deploy`（以及无 Profile 的 `mcv deploy --yes`）现在以退出码 2 报用法错误且不写任何文件。旧版“全量部署到设备全局”请改用 `mcv deploy --global`。消费 JSON 的脚本必须读取 `schemaVersion`，并拒绝未知的 operation schema 版本（Deploy 现为 v3）。

## 安装

要求 Node.js `>=22.12.0`。

```bash
npm install --global @tower1229/mcv
mcv --help
```

也可以临时运行：

```bash
npx @tower1229/mcv --help
```

## 支持范围

| IDE | 规则 | Skills | MCP / 原生配置 |
| --- | --- | --- | --- |
| Codex | `$CODEX_HOME/AGENTS.md` | `~/.agents/skills/`（旧 `$CODEX_HOME/skills` 仅收集兼容） | `$CODEX_HOME/config.toml` |
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | `~/.claude/settings.json`、`~/.claude.json` |
| Gemini | `~/.gemini/GEMINI.md` | Gemini CLI `~/.gemini/skills/`；Antigravity `~/.gemini/config/skills/` | Gemini CLI `settings.json`；Antigravity `config/`、IDE User 配置 |

Gemini 对用户仍是一个目标，Adapter 内部把 Gemini CLI 与 Antigravity 当作两个独立 Surface 扫描和部署。仅存在 runtime 目录不会被误判为已安装。Cursor 不属于当前支持范围。

MCV 仓库中的配置分为：

- `common/`：跨 IDE 的 Canonical Rules、Skills 和 MCP Registry。
- `ide/<ide>/native/`：仅对特定 IDE 有意义的 Native 配置。
- `ide/<ide-or-surface>/mcp-overrides.yaml`：timeout、disabled、headers 等 Surface 独有 MCP 字段。
- Local/Runtime：Adapter 未声明为可转移配置的缓存、日志、会话和设备状态，不进入仓库。是否包含密钥不是归类依据。

## 快速开始

直接运行 `mcv` 会打印简洁的 plain-text Overview（与 `mcv status` 同一份只读报告）后立即退出；无论 stdout 是否为 TTY 都不会进入 alternate screen，也不会把无参数调用改成 help。日常入口是 `mcv`、`mcv capture`、`mcv deploy` 和 `mcv profile`；`status` 保留为兼容别名，但不作为新的日常概念宣传。低频命令（`init`、`bind`、`unbind`、`migrate`、`restore`、`repo`、`discover`）仍可用。

Capture、Deploy、Restore 以及 Repository 生命周期命令一律走一次性 Command 层：TTY 中展示分组 Plan / Diff 摘要并确认，非交互场景使用 `--dry-run`、`--yes` 或 `--json`。只读命令直接打印 Report。全屏 TUI 已从默认路径移除；仅 `mcv profile`（以及无 mutation flag 的 `mcv profile edit <id>`）保留专用 Profile 维护界面。


### 1. 创建私人配置仓库

创建一个空目录，并在其中初始化 MCV：

```bash
mkdir my-mcv-config
cd my-mcv-config
mcv init --dry-run
mcv init --yes
```

`mcv init` 默认打印 Init Plan；确认后使用 `--yes` 创建 schema v4 的 `mcv.yaml`、`profiles.yaml`（含内置 global Profile）并绑定当前设备。显式使用 `--dry-run`、`--yes` 或 `--json` 时保持一次性协议。MCV 不执行任何 Git 操作。

### 2. 查看可发现的配置

```bash
mcv discover
mcv discover --json
```

两个模式复用同一份 Environment Report：默认输出英文文本，`--json` 输出单个结构化 JSON 文档。报告包含三个 Adapter 的检测结果，以及已找到或缺失的已知配置路径。

### 3. 收集当前设备配置

```bash
mcv capture
```

Capture 在终端打印按 IDE 与 File、Skill、MCP 分组的决策摘要，并把完整预览写入短期本地 Review Artifact（可能包含明文密钥）；交互模式在用户确认后写入仓库。可用 `--dry-run` 只审阅、`--verbose` 同时把完整预览打印到终端、`--yes` 在审阅后非交互应用默认非冲突变更，并可组合 `--json`。删除候选默认不选；warning 与 decision required 在交互路径中处理，`--yes` 不会执行有风险的决策。处理包括：

- 对 Adapter/Skill 已发现的支持内容保留原值和文件，不按文件名或字段名判断敏感性；
- 用户已选择的 `${env:VARIABLE_NAME}` 引用保持引用，明文值保持明文；
- 把 HOME 和已声明变量对应的绝对路径替换为便携变量；
- 结构化合并 JSON、YAML 和 TOML，保留未识别的 Native 字段；
- 多 IDE Rules 自动按 Markdown 块去重合并，并保留 Repository 已有规则；同名但内容不同的 Skill 自动选择完整包内最新修改时间较新的副本。
- 多个 IDE Skill 投影若解析到同一物理包，Capture 只产生一个 Canonical 候选与一份完整预览，并标明贡献的 Surface；设备上的投影链接属于拓扑，不会作为可移植 Skill 包内容写入仓库，包内符号链接仍会拒绝。
- MCP 自动合并不重名 Server；同名 MCP 的核心定义冲突等无法安全自动处理的候选仍要求选择权威来源，留空只跳过该项并显示 warning。
- Skill 以完整目录包收集，保留 scripts、references、examples、assets 和二进制资源。
- 只收集 Adapter 与 Skill Surface 声明的支持内容，不扩展为任意 HOME 文件扫描；runtime/cache/session 等非配置数据继续排除。

如果选择用 Git 管理和传输数据仓库，确认预览内容及其暴露风险可接受后可自行提交并推送：

```bash
git add .
git commit -m "capture AI IDE configuration"
git push
```

### 4. 部署到当前项目或设备全局

Deploy 的默认 scope 是**当前项目**（`process.cwd()`，可用 `--target` 显式指定；与 `--global` 互斥）。Profile 只决定“部署哪些 Asset”，scope 只决定“写到哪里”。通过用户选择的备份或传输方式将数据仓库带到新设备（使用 Git 时可克隆），进入包含 `mcv.yaml` 的目录后执行：

```bash
# 把 Profile 部署到当前项目（默认 scope）
mcv deploy dev
# 把内置 global Profile 部署到设备全局 IDE 位置
mcv deploy --global
# 把命名为 global 的 Profile 部署到当前项目（不是 --global scope）
mcv deploy global
```

裸 `mcv deploy` 不会静默写入当前目录或全局：它以退出码 2 提示必须指定 Profile，或使用 `mcv deploy --global`。

MCV 会显示按 IDE/capability 分组的写入计划并请求确认，只执行该 Plan 中选中的 selection ID。Apply 会重新验证 operation ID、Repository 来源哈希和目标前置哈希；warning 必须交互确认，decision required 或 error 会阻止写入。per-package divergent 外部 Skill 链接必须选择 Preserve 或 Replace：Replace 只备份并移除链接节点，再创建 managed link 或 copy，绝不写穿外部目标；shared-root divergent 只能 Preserve。`--yes` 不会执行这些决策或拓扑替换。仓库是经过用户确认的配置事实源，不是本机回滚备份。

Project-scope Deploy（`mcv deploy <profile>` 或 `--target <path>`）把选中的 Skills 以完整目录复制写入项目：Codex 与 Gemini CLI 共用 `<target>/.agents/skills/<name>/`，Claude Code 使用 `<target>/.claude/skills/<name>/`，不建立指向 Repository 或 HOME 的链接；相同内容视为已满足，未知或 divergent 包需要 Preserve/Replace，`--yes` 不会覆盖。写入记入 `<target>/.mcv/managed.json`（Managed Receipt v1），并参与备份与回滚。

每个选中变化都会在首次写入前备份并验证；写入或本机状态提交失败时，已写入变化会从验证过的备份回滚。成功后只更新实际 Apply 范围的 Baseline Snapshot、managed inventory，以及仅保存在本机、按 IDE/capability 记录的最近 Deploy selection。再次部署相同内容不会创建新备份。

新设备进入 Repository 后先执行 `mcv bind --dry-run` 审阅计划，再执行 `mcv bind --yes`；也可以通过 `mcv bind <path>` 显式指定路径。Bind 只校验 manifest 和 repository ID 并写入本机绑定；不会迁移或修改 Repository。普通命令不会因为当前目录恰好存在另一个 `mcv.yaml` 就越过已有绑定。

`mcv repo` 检查当前绑定路径、Repository ID、schema version 和有效性；`mcv repo --json` 返回同一份结构化 Report。只有检测到 Git Repository 时才附带只读 Git 状态。非 Git Repository 是正常状态，MCV 不执行 Git mutation。

未绑定设备应先 `mcv init --yes` 或 `mcv bind --yes`。绑定路径失效、Repository ID 不匹配或 schema 需要迁移时，Capture/Deploy 会被阻断，必须先完成 Rebind、Unbind 或 `mcv migrate --yes`。

### 5. 检查漂移与恢复

```bash
mcv
mcv status
mcv restore --dry-run
mcv restore
```

- 裸 `mcv` 与 `status` 从同一份只读 Overview Report 汇总 Repository、限定在 MCV Repository 路径内的可选 Git 状态、Pending Deployment Change、相对 Baseline Snapshot 的 unchanged/Drift/missing、IDE/Surface、实际配置缺失变量和本设备最近操作。Pending 对同一 Surface 的多文件 Skill projection 按 package 聚合，Canonical materialization 不重复计数，默认未选拓扑迁移进入 `optional`，Advanced Cleanup 只进入 `advancedCleanupExcluded`。Environment 只解释 manifest、MCP 和 Native structured configuration；Rules、Skills、references 和普通 Markdown 中的示例变量不检查。`status --json` 完全省略 `changes`，完整候选由 `deploy --dry-run --json` 提供。JSON Deploy operation 使用 schema v3；其他 JSON operation 使用其各自 schema。消费方必须检查 `schemaVersion` 并拒绝未知版本，不得假定字段集合固定。生成 Overview 只读取 Deploy Plan，不运行 Capture 或执行写操作。
- `restore --dry-run` 默认选择当前项目（`--target` 或 `process.cwd()`）最近一次完整且内容可验证的 project-scope Deploy backup；`--global` 选择最近一次全局 Deploy backup。展示备份时间、将恢复或删除的路径，并区分 ordinary file、managed-link projection、copy projection 与 physical package；内容或拓扑（链接重定向、目录/链接互换等）在部署后发生变化时，以独立的 Restore Conflict 阻止覆盖。
- `restore` 默认在终端确认完整 Plan；自动化场景可在审阅后使用 `restore --yes`，并可组合 `--json` 取得结构化 Result。`--target` 与 `--global` 互斥。为避免无监督删除，包含删除的 Plan 必须交互确认，`--yes` 会在写入前阻断。Apply 会重验 operation ID、完整 selection、backup 来源、当前节点类型、链接目标和物理身份；事务开始时先创建并验证当前状态 backup（含目录与符号链接拓扑）。事务前按 Ctrl+C 以 130 退出；写入、删除或本机状态提交失败时仅回滚已尝试路径，backup/commit/rollback 期间忽略普通取消；不完整回滚会保留并报告 recovery backup。成功 Restore 会清除 Baseline Snapshot、managed inventory 与 managed Skill layout，需重新 Deploy 或 Capture 建立事实基线。

## 命令

```text
mcv            打印简洁 Overview 后退出；TTY 与非 TTY 行为一致
mcv capture    一次性 Capture Plan/确认/Apply；--dry-run/--yes/--json/--verbose
mcv deploy     一次性 Deploy Plan/确认/Apply；默认项目 scope；需 Profile 或 --global；支持 --verbose；裸调用 exit 2
mcv profile    Profile 维护 TUI（TTY）或 list/show/create/edit/delete 子命令

mcv status     Overview 兼容别名；--plain/--json/--verbose
mcv init       打印 Init Plan；--yes/--dry-run/--json 控制写入
mcv repo       打印 Repository Report；--json 输出结构化 Report
mcv bind [PATH] 打印 Bind Plan；--yes/--dry-run/--json 控制写入
mcv unbind     打印 Unbind Plan；--yes/--dry-run/--json 控制写入
mcv migrate    打印 Migration Plan；--yes/--dry-run/--json/--verbose
mcv discover   打印 Environment Report；--plain/--json/--verbose
mcv restore    一次性 Restore Plan/确认/Apply；--dry-run/--yes/--json/--verbose
mcv mcp        本地 stdio MCP Server（集成入口；含 inspect_inventory / read_assets / update_profiles / deploy_profiles）
```

人类可读的 Capture、Deploy 和 Restore Plan 默认只在终端保留变更数量、选择状态、删除/拓扑迁移等破坏性标记、Issues 和 Next Action；完整 Diff、路径、hash 与技术详情写入用户本地的短期 Review Artifact，并同时打印标准 `file://` URL 与绝对路径。macOS 使用 `~/Library/Application Support/mcv/reviews/`，Windows 使用 `%LOCALAPPDATA%\mcv\reviews\`，Linux 使用 `${XDG_STATE_HOME:-~/.local/state}/mcv/reviews/`。Artifact 原子写入；POSIX 目录/文件权限为 `0700`/`0600`，Windows 继承每用户 `%LOCALAPPDATA%` 的 ACL。每次创建 Artifact 时会 best-effort 清理超过 24 小时的旧 `.txt` 文件，并在始终保留本次新文件的前提下将目录收敛到 10 个文件、50 MiB 的目标上限；如果本次文件自身超限或旧文件删除失败，目录可能暂时超过目标。如果之后不再运行 MCV，过期文件不会由后台进程主动删除。Artifact 可能包含与原预览相同的明文配置值，不应分享。写入失败时 MCV 会把完整详情回退到终端，绝不会在不可审阅时继续隐藏内容。`--verbose` 在保留 Artifact 的同时把完整详情输出到终端。

Overview/status、discover、Profile list/show、Migration 和失败 Result 仅在详情超过 40 行或 8 KiB 时采用相同策略；短输出保持直接显示。Review Artifact 属于 Local/Runtime 展示副作用，不修改 Repository、部署目标、Managed Receipt、backup、Baseline Snapshot 或 device operation state，也不能重放或充当 Apply 授权。`--json` 和 MCP 始终保留原有完整结构化契约且不创建 Review Artifact。

删除默认不执行。只有 `mcv deploy --prune-managed` 经交互确认后，才会清理不再需要且仍由 MCV 拥有的内容：全局 scope 删除本机 state 中已记录为 managed、但仓库已不再生成的文件，以及与本次 Canonical 部署逐文件完全一致的旧 `$CODEX_HOME/skills` Skill 副本；项目 scope 仅删除出现在 `<target>/.mcv/managed.json`、哈希未漂移、且当前 selection 已不再需要的资产（Rules 只去掉未修改的 Managed Block）。`--yes` 永远拒绝删除、topology migration 与项目 prune 候选。普通 deploy 检测到 legacy Codex Skill 重复时会提示，不会自动删除；内容不同或包含链接的 legacy Skill 会保留。缺少 `managed.json` 时项目 Deploy 退回保守模式，不执行清理。

对于 managed Skill layout：禁用某一个 IDE 只会把该 IDE 的 projection 列为 Advanced Cleanup 候选，不会在其他已启用 projection 仍引用同一 Canonical Device Skill Store package 时删除物理 package。当 Skill 已从仓库移除且所有 projection 都不再需要时，最终物理 package 会作为单独的 Advanced Cleanup 候选（`physical-materialization`，默认不选中），且仅当该 package 完全由 MCV 拥有（记录在 managed Skill layout）时才会出现；外部链接与外部拥有的物理 package 永远不会成为 Restore 写入目标或 cleanup 删除候选。Store 中未登记但与 Canonical 完全一致的 package 会原样复用，只有 MCV 新建的 projection link 会进入 managed state；未登记且内容不同、含额外文件、链接不可验证或拓扑不安全的 package 会阻断 Deploy，不会被覆盖、认领或生成整包 cleanup。

Deploy 不会穿过已有 symlink/junction 写文件。对于已有的 Canonical Skill package 链接，Plan 会按 Skill package 或共享 link root 识别其有效内容：与期望内容一致时显示一个 `Satisfied via link` 外部所有权 outcome，不产生该链接路径的写入候选，也不进入 Pending Deployment Change 或 managed cleanup；若同一物理事实路径本轮有等价的正常 Deploy 候选，只写该事实路径。内容 divergent、dangling、cycle、物理目标冲突等情况会合并为一个带 affected-file count 的受保护 outcome；同一物理 package 被多个 IDE Surface 引用时，Overview 只显示一个 `Needs decision` 事实。IDE Surface 上的 divergent 外部链接会从写入和清理候选中隔离，用户确认警告后可继续部署其余选择；dangling、cycle、Canonical Store 冲突等无法安全分类或继续的拓扑仍作为错误并阻止 Apply。其他未分类链接同样不会被遍历、替换、写入或删除，包括 copy layout 和 Advanced Cleanup。

在 macOS 将 `deploy.useSymlinks` 设为 `true` 后，MCV 会把每个选中的 Canonical Skill package 物理材料化一次到 Canonical Device Skill Store（当前解析为生态约定的 `~/.agents/skills/`），再为已有 loader 证据的 Surface 创建 per-Skill managed link：Claude Code 使用 `~/.claude/skills/<skill>`，Gemini CLI 使用 `~/.gemini/skills/<skill>`。Antigravity 在单独证据记录前继续复制到 `~/.gemini/config/skills/`，不会因为与 Gemini CLI 共享部分 `.gemini` 层级而共用整个 Skills root 或继承链接策略。Store 属于 MCV 的 Canonical Skill 设备布局，不属于 Codex；即使 Codex 未启用，只要任一已验证 Surface 仍需要该 Skill，Store 仍会被规划和维护。MCV 永远不会链接整个 IDE Skills root，也不会吸收未拥有或 IDE-exclusive 的 Skills。材料化内容写入并验证成功后，per-Skill 投影才会生效；备份和回滚覆盖本轮尝试的内容与链接，Restore 会按 backup 中的拓扑元数据恢复目录、文件或符号链接，而不会留下悬空 projection 或错配副本。若 Surface 上已有与 Canonical 完全一致的物理 Skill 目录，Plan 会将其列为默认不选中的 topology migration 候选，需显式交互确认后才会替换为 managed link；内容 divergent 的物理副本与外部链接会被保留，`--yes` 也不会执行 topology migration。Windows、未验证支持目录链接的 Surface，以及 `useSymlinks: false` 继续使用 copy projection；已经正确的链接会保留，不会被目录覆盖。平台与 Surface 兼容矩阵见 `docs/compatibility/canonical-skill-loader-evidence.md`；`deploy.useSymlinks` 默认仍为 `false`。

Deploy 的 Skill JSON 中 `ide` 始终是 `codex | claude-code | gemini`，`surface` 标识具体的 `codex | claude-code | gemini-cli | antigravity`；Canonical Store change 使用 `owner: "canonical-store"`，不携带这两个字段。

命令不支持按参数临时选择 IDE。需要启用或禁用目标时，编辑 `mcv.yaml`：

```yaml
targets:
  codex:
    enabled: true
  claudeCode:
    enabled: true
  gemini:
    enabled: true
```

## 仓库结构

```text
my-mcv-config/
├── mcv.yaml
├── profiles.yaml
├── common/
│   ├── AGENTS.md
│   ├── skills/
│   └── mcp.yaml
└── ide/
    ├── codex/native/config.toml
    ├── claude-code/native/
    │   ├── settings.json
    │   └── .claude.json
    └── gemini/native/
        ├── gemini-cli/settings.json
        └── antigravity/
            ├── config.json
            ├── mcp_config.json
            └── ide-settings.json
```

Canonical 内容在部署时转换为各 IDE 的原生位置。Native 文件使用 Overlay：MCV 只拥有显式声明的 managed 字段，其他未知字段默认归 Native 所有并被保留。已知 Local 字段会从 capture 中排除。

## 路径变量

`mcv.yaml` 可以声明跨平台路径：

```yaml
variables:
  TOOLS_HOME:
    windows: "${HOME}\\Tools"
    macos: "${HOME}/Tools"
```

仓库配置可以引用 `${HOME}`、`${MCV_REPO}` 和自定义变量。deploy 会根据目标平台解析路径，并保留 URL 中的斜杠。

## 数据责任边界

MCV 对配置内容保持中立，不提供保密保证。

- 支持范围内发现的敏感字段名和敏感文件名按普通配置传输；Diff、JSON 和备份不遮罩。
- 用户自行决定写明文还是 `${env:*}`，并自行管理 Repository、备份和终端访问权限。
- Adapter 未声明的缓存、日志、会话状态和任意 HOME 文件仍不收集；这属于数据所有权边界，不是密钥识别。
- Deploy 会覆盖 managed 字段；未知 Native 和 Local 字段会按 Overlay 规则保留。
- MCV 不写穿外部链接，不自动执行 Git commit、push 或 pull。

## 当前限制

- 仅支持 Codex、Claude Code 和 Gemini。
- Profile 管理：TTY 中 `mcv profile` / `mcv profile edit <id>` 打开专用全屏 TUI；非交互 mutation 走 `mcv profile` 子命令；Agent 集成走 `mcv mcp`（`inspect_inventory`、`read_assets`、`update_profiles`、`deploy_profiles`，以及按需 `mcv://guides/profile-classification` Resource）。
- `restore` 只恢复本机 Deploy backup（默认当前项目；`--global` 选择全局），不读取仓库。
- 没有变化的重复 deploy 不生成新备份。
- restore 后清除部署基线，要求重新 deploy 或 capture 后再建立事实基线。
- Capture 默认不传播删除操作。
- 不安装 IDE、Node.js、MCP Server 或其他系统依赖。
- 不同步完整 dotfiles、凭据或 AI 会话历史。

## 本地开发

```bash
npm install
npm run typecheck
npm test
npm run build
node dist/index.js --help
```

发布包之前，npm 会通过 `prepack` 自动运行 typecheck、完整测试和 build。

变更记录与完整发布门见 [CHANGELOG.md](CHANGELOG.md) 和 [docs/release-checklist.md](docs/release-checklist.md)。

只检查将进入 npm 的文件：

```bash
npm pack --dry-run
```

## License

[ISC](LICENSE)
