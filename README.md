# MCV

> 可以随处部署的个人生产力，帝国的第一座建筑。

MCV（Mobile Configuration Vehicle）是一个本地运行的 CLI，用来把 Codex、Claude Code 和 Gemini 的个人配置收集到用户自己掌控的本地数据仓库，并在另一台 macOS 或 Windows 设备上安全部署。Git 是可选且推荐的版本管理、备份和传输方式，但不是使用 MCV 的前置条件。

MCV v0.1 已完成最小闭环：发现配置、收集、脱敏与路径参数化、部署、漂移检查和最近一次备份恢复。它不会同步凭据，不会安装 IDE，也不会在后台自动修改配置。

> v0.1 仍是首个公开测试版本。请先使用私人测试仓库，并在 capture 预览中人工检查最终内容。

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

Gemini 对用户仍是一个目标，Adapter 内部把 Gemini CLI 与 Antigravity 当作两个独立 Surface 扫描和部署。仅存在 runtime 目录不会被误判为已安装。Cursor 不属于 v0.1 支持范围。

MCV 仓库中的配置分为：

- `common/`：跨 IDE 的 Canonical Rules、Skills 和 MCP Registry。
- `ide/<ide>/native/`：仅对特定 IDE 有意义的 Native 配置。
- `ide/<ide-or-surface>/mcp-overrides.yaml`：timeout、disabled、headers 等 Surface 独有 MCP 字段。
- Local/Runtime：凭据、缓存、日志、会话和设备状态，不进入仓库。

## 快速开始

在完整 TTY 中直接运行 `mcv` 会进入统一的 Ink Shell，并异步打开只读 Overview。一级导航固定为 Overview、Capture、Deploy、Restore Latest Deployment、Repository 和 Help；Overview 中按 `↑` / `↓` 移动焦点，按 `→` 或 `Enter` 打开焦点目标。`c`、`d`、`s`、`r`、`h` 继续分别作为 Capture、Deploy、Restore Latest Deployment、Repository、Help 的可选加速键。所有业务子命令都 deep-link 到同一个持久 Shell：`status` 打开 Overview，`discover` 打开 Environment Details，Capture/Deploy/Restore 打开各自 workflow，Repository 生命周期命令直接打开对应 Repository 页面或 Plan。Help、Environment Details 和 Result 页按 `↑` / `↓` 滚动；Help 与 Environment Details 按 `←` 或 `Escape` 返回 Overview，Result 页按 `←` 或 `Enter` 返回刷新后的 Overview。除 Repository 路径输入页需要保留完整文本输入外，任一非 Apply 页面按 `q` 正常退出，按 `Ctrl+C` 以 130 退出。direct subcommand 正常关闭后会在主屏留下对应摘要和 next action。Shell 使用 alternate screen，退出、失败、中断和异常后都会恢复主屏、光标和输入模式。

非 TTY 的无参数调用仍立即输出 help。显式使用 `--plain`、`--dry-run`、`--yes` 或 `--json` 的命令始终执行一次性协议，不进入 alternate screen。

发布门在 macOS 与 Windows CI 中分别运行 packaged real PTY/ConPTY 测试，并验证 alternate screen、光标和输入模式恢复；任一平台未实际执行对应终端测试时，发布门不会通过。

### 1. 创建私人配置仓库

创建一个空目录，并在其中初始化 MCV：

```bash
mkdir my-mcv-config
cd my-mcv-config
mcv init
```

该命令在 TTY 中直接打开 Repository Init Plan；确认后创建 schema v2 的 `mcv.yaml`、绑定当前设备，并继续 Environment discovery 与 Capture workflow。显式使用 `--dry-run`、`--yes` 或 `--json` 时保持一次性协议。MCV 不执行任何 Git 操作。

### 2. 查看可发现的配置

```bash
mcv discover --plain
mcv discover --json
```

两个模式复用同一份 Environment Report：`--plain` 输出英文文本，`--json` 输出单个结构化 JSON 文档。报告包含三个 Adapter 的检测结果，以及已找到或缺失的已知配置路径。

### 3. 收集当前设备配置

```bash
mcv capture
```

TTY workflow 会按 IDE 与 File、Skill、MCP 显示经过处理的安全预览。按 `↑` / `↓` 移动焦点，按 `→` 打开 Diff 或推进到下一审阅面，按 `←` 关闭 Diff 或返回上一审阅面并恢复原焦点；`Home`、`End`、`Page Up`、`Page Down` 用于长列表。`Space` 选择项目、required choice 或 warning confirmation，只有最终确认面的 `Enter` 可以开始 Apply；`d` 仍是可选 Diff 快捷键。选择、warning、blocked、applying 与 Result 使用带显式符号和文字的共享状态语义，关闭颜色时信息不减少。删除候选默认不选，warning 必须逐项显式确认，decision required 与 error 未解决时 Apply 不可用。Apply 前后检测到 Plan 已过期时会重新生成预览并要求重新审阅，不会保留旧选择或授权。只有最终确认后才写入仓库。处理包括：

- 按文件名排除 `.env`、credential 文件、私钥等已知敏感文件；
- 按字段名识别 `secret`、`token`、`key`、`password`、`credential`；
- 把识别出的敏感字段值替换为 `${env:VARIABLE_NAME}` 引用；
- 把 HOME 和已声明变量对应的绝对路径替换为便携变量；
- 结构化合并 JSON、YAML 和 TOML，保留未识别的 Native 字段；
- 多 IDE Rules 自动按 Markdown 块去重合并，并保留 Repository 已有规则；同名但内容不同的 Skill 自动选择完整包内最新修改时间较新的副本。
- MCP 自动合并不重名 Server；同名 MCP 的核心定义冲突等无法安全自动处理的候选仍要求选择权威来源，留空只跳过该项并显示 warning。
- Skill 以完整目录包收集，保留 scripts、references、examples、assets 和二进制资源。
- 自动排除 runtime/cache/session MCP 与高置信明文密钥；无法安全处理的候选阻止写入。

如果选择用 Git 管理和传输数据仓库，确认预览安全后可自行提交并推送：

```bash
git add .
git commit -m "capture AI IDE configuration"
git push
```

### 4. 在另一台设备部署

通过用户选择的备份或传输方式将数据仓库带到新设备（使用 Git 时可克隆），进入包含 `mcv.yaml` 的目录后执行：

```bash
mcv deploy
```

MCV 会显示按 IDE/capability 分组的写入计划并请求确认，只执行该 Plan 中选中的 selection ID。Apply 会重新验证 operation ID、Repository 来源哈希和目标前置哈希；warning 必须交互确认，decision required 或 error 会阻止写入。仓库是经过用户确认的配置事实源，不是本机回滚备份。

每个选中变化都会在首次写入前备份并验证；写入或本机状态提交失败时，已写入变化会从验证过的备份回滚。成功后只更新实际 Apply 范围的 Baseline Snapshot、managed inventory，以及仅保存在本机、按 IDE/capability 记录的最近 Deploy selection。再次部署相同内容不会创建新备份。

Deploy TTY workflow 会复用最近一次成功的 IDE/capability selection。按 `↑` / `↓` 浏览可见树，按 `→` 展开分组或打开焦点文件 Diff，按 `←` 关闭 Diff、回到父节点、折叠分组或从树根返回 Overview；`Home`、`End`、`Page Up` 和 `Page Down` 用于长 Plan 和 warning 列表，`Space` 切换选择或确认 warning。Diff 明确标注 managed merge 或 whole-file replacement。删除候选只在默认折叠、带 `× Destructive` 状态的 Advanced Cleanup 中显示且默认不选；最终 Apply 只能由 `Enter` 启动。Apply 或 rollback 期间输入被禁用；Plan 过期时必须重新生成并重新审阅。结果页按 `Enter` 返回刷新后的 Overview，按 `q` 退出。

新设备进入 Repository 后先执行 `mcv bind --dry-run` 审阅计划，再执行 `mcv bind --yes`；也可以通过 `mcv bind <path>` 显式指定路径。Bind 只校验 manifest 和 repository ID 并写入本机绑定；不会迁移或修改 Repository。普通命令不会因为当前目录恰好存在另一个 `mcv.yaml` 就越过已有绑定。

`mcv repo --plain` 检查当前绑定路径、Repository ID、schema version 和有效性；`mcv repo --json` 返回同一份结构化 Report。只有检测到 Git Repository 时才附带只读 Git 状态。非 Git Repository 是正常状态，MCV 不执行 Git mutation。

在 TTY 中直接运行 `mcv` 时，未绑定设备会先进入 Repository onboarding：当前目录是有效 Repository 时优先审阅 Bind Plan，否则可选择在当前目录 Init 或输入已有 Repository 路径。绑定路径失效、Repository ID 不匹配或 schema 需要迁移时，Capture/Deploy 会被阻断，必须先在 Repository 页面完成 Rebind、Unbind 或 Migration Plan。Init 成功后依次进入 Environment discovery 与 Capture；从 Capture 退出不会删除已创建的 `mcv.yaml` 或本机绑定。

### 5. 检查漂移与恢复

```bash
mcv status
mcv restore --dry-run
mcv restore
```

- `status --plain` 从同一份只读 Overview Report 汇总 Repository、可选 Git 状态、Pending Deployment Change、相对 Baseline Snapshot 的 unchanged/Drift/missing、IDE/Surface、缺失变量和最近操作；`status --json` 输出该 Report 的机器可读形式。生成 Overview 只读取 Deploy Plan，不运行 Capture 或执行写操作。
- `restore --dry-run` 只选择最近一次完整且内容可验证的 Deploy backup，展示备份时间、将恢复或删除的文件，并以独立的 Restore Conflict 阻止覆盖部署后的新变化。
- `restore` 默认在终端确认完整 Plan；自动化场景可在审阅后使用 `restore --yes`，并可组合 `--json` 取得结构化 Result。为避免无监督删除，包含删除的 Plan 必须交互确认，`--yes` 会在写入前阻断。Apply 会重验 operation ID、完整 selection、backup 来源和目标哈希；事务开始时先创建并验证当前状态 backup。事务前按 Ctrl+C 以 130 退出；写入、删除或本机状态提交失败时自动回滚，backup/commit/rollback 期间忽略普通取消。
- Restore TTY workflow 展示最近完整 backup 的时间、逐文件 write/delete 影响和 Restore Conflict 路径；按 `↑` / `↓` 浏览影响，按 `→` 打开焦点文件详情，按 `←` 关闭详情或返回 Overview，最终 Apply 仍只能由 `Enter` 启动。冲突或无可用 backup 时 Apply 被禁用，且不提供 force restore。Plan 过期会自动重新生成并要求重新审阅；成功或失败结果页按 `Enter` 或 `←` 返回刷新后的 Overview，按 `q` 退出。

## 命令

```text
mcv init       TTY 中 deep-link 到 Init Plan；--dry-run/--yes/--json 强制一次性 Plan/Result
mcv repo       TTY 中 deep-link 到 Repository；--plain/--json 强制一次性 Report
mcv bind [PATH] TTY 中 deep-link 到 Bind Plan；--dry-run/--yes/--json 强制一次性 Plan/Result
mcv unbind     TTY 中 deep-link 到 Unbind Plan；--dry-run/--yes/--json 强制一次性 Plan/Result
mcv migrate    TTY 中 deep-link 到 Migration Plan；--dry-run/--yes/--json 强制一次性 Plan/Result
mcv discover   TTY 中 deep-link 到 Environment Details；--plain/--json 强制一次性 Report
mcv capture    TTY 中 deep-link 到可选择 Capture workflow；--dry-run/--yes/--json 强制一次性 Plan/Result
mcv deploy     TTY 中 deep-link 到可选择 Deploy workflow；--dry-run/--yes/--json 强制一次性 Plan/Result
mcv status     TTY 中 deep-link 到只读 Overview；--plain/--json 强制一次性 Report
mcv restore    TTY 中 deep-link 到 Restore Latest Deployment；--dry-run/--yes/--json 强制一次性 Plan/Result
```

删除默认不执行。只有 `mcv deploy --prune-managed` 经交互确认后，才会删除本机 state 中已记录为 MCV managed、但仓库已不再生成的文件，以及与本次 Canonical 部署逐文件完全一致的旧 `$CODEX_HOME/skills` Skill 副本；`--yes` 永远拒绝删除。普通 deploy 检测到后一种重复时会提示，不会自动删除；内容不同或包含链接的 legacy Skill 会保留。

Deploy 不会穿过已有 symlink/junction 写文件。对于已有的 Canonical Skill package 链接，Plan 会按 Skill package 或共享 link root 识别其有效内容：与期望内容一致时显示一个 `Satisfied via link` 外部所有权 outcome，不产生该链接路径的写入候选，也不进入 Pending Deployment Change 或 managed cleanup；若同一物理事实路径本轮有等价的正常 Deploy 候选，只写该事实路径。内容 divergent、dangling、cycle、物理目标冲突等情况会合并为一个带 affected-file count 的 blocking outcome。其他未分类链接仍不会被遍历、替换、写入或删除，包括 copy layout 和 Advanced Cleanup。

在 macOS 将 `deploy.useSymlinks` 设为 `true` 后，MCV 会把每个选中的 Canonical Skill package 物理材料化一次到 Canonical Device Skill Store（当前解析为生态约定的 `~/.agents/skills/`），再为已有 loader 证据的 Surface 创建 per-Skill managed link：Claude Code 使用 `~/.claude/skills/<skill>`，Gemini CLI 使用 `~/.gemini/skills/<skill>`。Antigravity 在单独证据记录前继续复制到 `~/.gemini/config/skills/`，不会因为与 Gemini CLI 共享部分 `.gemini` 层级而共用整个 Skills root 或继承链接策略。Store 属于 MCV 的 Canonical Skill 设备布局，不属于 Codex；即使 Codex 未启用，只要任一已验证 Surface 仍需要该 Skill，Store 仍会被规划和维护。MCV 永远不会链接整个 IDE Skills root，也不会吸收未拥有或 IDE-exclusive 的 Skills。材料化内容写入并验证成功后，per-Skill 投影才会生效；备份和回滚覆盖本轮尝试的内容与链接。若 Surface 上已有与 Canonical 完全一致的物理 Skill 目录，Plan 会将其列为默认不选中的 topology migration 候选，需显式交互确认后才会替换为 managed link；内容 divergent 的物理副本与外部链接会被保留，`--yes` 也不会执行 topology migration。Windows、未验证支持目录链接的 Surface，以及 `useSymlinks: false` 继续使用 copy projection；已经正确的链接会保留，不会被目录覆盖。平台与 Surface 兼容矩阵见 `docs/compatibility/canonical-skill-loader-evidence.md`；`deploy.useSymlinks` 默认仍为 `false`。

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

## 安全边界

MCV 的脱敏是防误提交保护，不是凭据保险库。

- 扫描敏感文件名、结构化敏感字段和高置信密钥格式；环境变量名称不会被误当作秘密值。
- 凭据、OAuth token、Cookie 和会话状态不在同步范围内。
- Capture 之前仍应人工检查预览，并只使用私人仓库。
- Deploy 会覆盖 managed 字段；未知 Native 和 Local 字段会按 Overlay 规则保留。
- MCV 不自动执行 Git commit、push 或 pull。

## 当前限制

- 仅支持 Codex、Claude Code 和 Gemini。
- 没有 `doctor`、Profile 或 GUI；计划通过 capture/deploy 的 `--dry-run`、`--json`、`--verbose` 输出。
- `restore` 只恢复最近一次有效的本机部署前备份，不读取仓库。
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

只检查将进入 npm 的文件：

```bash
npm pack --dry-run
```

## License

[ISC](LICENSE)
