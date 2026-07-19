# MCV

> 可以随处部署的个人生产力，帝国的第一座建筑。

MCV（Mobile Configuration Vehicle）是一个本地运行的 CLI，用来把 Codex、Claude Code 和 Gemini 的个人配置收集到用户自己的私有 Git 仓库，并在另一台 macOS 或 Windows 设备上安全部署。

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
| Codex | `~/.codex/AGENTS.md` | `~/.codex/skills/` | `~/.codex/config.toml` |
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | `~/.claude/settings.json`、`~/.claude.json` |
| Gemini | `~/.gemini/GEMINI.md` | `~/.gemini/skills/` | `~/.gemini/settings.json` |

Gemini Adapter 同时覆盖使用 `~/.gemini/` 的 Gemini CLI 与 Antigravity。Cursor 不属于 v0.1 支持范围。

MCV 仓库中的配置分为：

- `common/`：跨 IDE 的 Canonical Rules、Skills 和 MCP Registry。
- `ide/<ide>/native/`：仅对特定 IDE 有意义的 Native 配置。
- Local/Runtime：凭据、缓存、日志、会话和设备状态，不进入仓库。

## 快速开始

### 1. 创建私人配置仓库

创建一个空目录，并在其中初始化 MCV：

```bash
mkdir my-mcv-config
cd my-mcv-config
mcv init
```

该命令只会创建 `mcv.yaml`，并在本机状态目录记录设备 ID、仓库 ID、仓库路径和空的部署基线。它不会发现、收集或部署 IDE 配置，也不会执行任何 Git 操作。建议随后把这个目录初始化为私人 Git 仓库。

### 2. 查看可发现的配置

```bash
mcv discover
```

命令会报告三个 Adapter 的检测结果，以及已找到或缺失的已知配置路径。

### 3. 收集当前设备配置

```bash
mcv capture
```

MCV 会先输出经过处理的预览，只有确认后才写入仓库。处理包括：

- 按文件名排除 `.env`、credential 文件、私钥等已知敏感文件；
- 按字段名识别 `secret`、`token`、`key`、`password`、`credential`；
- 把识别出的敏感字段值替换为 `${env:VARIABLE_NAME}` 引用；
- 把 HOME 和已声明变量对应的绝对路径替换为便携变量；
- 结构化合并 JSON、YAML 和 TOML，保留未识别的 Native 字段；
- 多个 IDE 提供不同 Canonical Rules 时中止操作，避免静默覆盖。

确认预览安全后，再自行提交并推送私人仓库：

```bash
git add .
git commit -m "capture AI IDE configuration"
git push
```

### 4. 在另一台设备部署

克隆私人配置仓库，进入包含 `mcv.yaml` 的目录后执行：

```bash
mcv deploy
```

MCV 会显示写入计划并请求确认，然后把仓库中的配置展开到当前设备。仓库是经过用户确认的配置事实源，不是本机回滚备份。

如果目标文件已经存在且将被修改，MCV 会先把部署前的本机旧版本保存到本机状态目录下的 `backups/`，再使用临时文件加原子重命名完成写入。再次部署相同内容不会创建新备份。

当前 v0.1 没有 `mcv bind` 命令。新设备上直接在克隆后的仓库目录中执行 `mcv deploy` 即可。

### 5. 检查漂移与恢复

```bash
mcv status
mcv restore
```

- `status` 把当前文件哈希与最近一次部署基线比较，输出 `matching`、`missing` 或 `drifted`。
- `restore` 不读取仓库；它使用最近一次 deploy 覆盖前保存的本机旧版本，回滚对应文件。

## 命令

```text
mcv init       初始化仓库清单，并将当前设备绑定到该仓库
mcv discover   检测 Codex、Claude Code、Gemini 及已知配置路径
mcv capture    预览并收集本机配置到 MCV 仓库
mcv deploy     将仓库配置部署到本机；覆盖前保存本机旧版本
mcv status     检查相对最近部署基线的文件漂移
mcv restore    用最近一次部署前保存的本机旧版本回滚对应文件
```

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
    └── gemini/native/settings.json
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

MCV 的脱敏是防误提交保护，不是凭据保险库或完整的 secret scanner。

- v0.1 只做已知敏感文件名和字段名匹配，不扫描任意字符串中的密钥格式。
- 凭据、OAuth token、Cookie 和会话状态不在同步范围内。
- Capture 之前仍应人工检查预览，并只使用私人仓库。
- Deploy 会覆盖 managed 字段；未知 Native 和 Local 字段会按 Overlay 规则保留。
- MCV 不自动执行 Git commit、push 或 pull。

## 当前限制

- 仅支持 Codex、Claude Code 和 Gemini。
- 没有 `bind`、`doctor`、`plan`、`review`、Profile 或 GUI。
- `restore` 只恢复最近一次有效的本机部署前备份，不读取仓库。
- Deploy 新创建的文件不会进入备份，`restore` 也不会删除这些文件。
- 没有修改已有文件的 deploy 不会生成新备份；此时 `restore` 可能使用更早的有效备份。
- `restore` 不更新部署基线，执行后 `status` 可能显示 `drifted`。
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
