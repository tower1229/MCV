# AI Engineering Template

可复用的 **AI 工程基础设施** 项目模板：内置 IDE Agent skills、跨 IDE 同步脚本、Claude / AGENTS 双入口提示词，以及 issue → PRD → 实现 → review 工作流。

提炼自 [CangHai](https://github.com/tower1229/CangHai) 的生产实践。

## 快速开始

### 1. 从模板创建项目

```bash
# GitHub: Use this template → Create a new repository
# 或本地复制
cp -a AI-Engineering-Template/ my-new-project/
cd my-new-project
```

### 2. 定制项目入口

编辑 `CLAUDE.md`：

- 替换 `{Project Name}` 与项目定位
- 按需调整「必读入口」路径

`AGENTS.md` 保持一行 `CLAUDE.md` 即可（Codex 等工具读此文件）。

### 3. 配置 Agent 契约

首次使用建议运行 **`/setup-matt-pocock-skills`**，它会引导你配置：

| 文件 | 作用 |
|------|------|
| `docs/agents/issue-tracker.md` | Issue/PR 操作约定 |
| `docs/agents/triage-labels.md` | Triage 五态 label 映射 |
| `docs/agents/domain.md` | 域文档消费规则 |

也可直接编辑上述文件；默认假设 GitHub Issues + `gh` CLI。

### 4. 同步 Skills 到 IDE

```bash
npm run sync:skills
```

| 路径 | 角色 |
|------|------|
| `.agents/skills/` | **唯一编辑源**（提交 Git） |
| `.claude/skills/` | Claude Code 同步副本（gitignore） |
| `.cursor/skills/` | Cursor 同步副本（gitignore） |

Codex 直接读 `.agents/skills/`，无需同步。

## 目录结构

```
.
├── CLAUDE.md                 # 主 Agent 提示词（Claude Code / Cursor rules）
├── AGENTS.md                 # → CLAUDE.md（Codex 等）
├── CONTEXT.md                # 域词汇表（lazy 充实）
├── .agents/skills/           # IDE Agent skills 唯一源
├── docs/
│   ├── agents/               # Agent 契约三件套
│   ├── adr/                  # 架构决策记录
│   └── prd/                  # PRD 归档
├── scripts/
│   └── sync-ide-skills.sh    # 跨 IDE skills 同步
└── package.json              # npm run sync:skills
```

## 内置 Skills

| Skill | 用途 |
|-------|------|
| `setup-matt-pocock-skills` | 首次配置 issue tracker / labels / domain docs |
| `writing-great-skills` | Skill 写作规范 |
| `grilling` / `grill-with-docs` | 设计拷问 + 同步写 ADR/词汇表 |
| `to-prd` | 对话 → PRD → 发到 issue tracker |
| `to-issues` | 拆 issue |
| `triage` | Issue 状态机 + agent-ready brief |
| `implement` | 按 spec 实现 |
| `code-review` | Standards + Spec 双轴 review |
| `tdd` / `diagnosing-bugs` | 测试驱动与排障 |
| `research` | 背景调研 → Markdown |
| `domain-modeling` | 建/维护 CONTEXT |
| `codebase-design` | 深模块 / 接口设计 |
| `improve-codebase-architecture` | 架构改进 |
| `prototype` | 抛away 原型 |
| `handoff` | 会话交接 |
| `resolving-merge-conflicts` | 合并冲突 |

## 工作流示例

```
/grill-with-docs     → 敲定设计，写 ADR + CONTEXT
/to-prd              → 生成 PRD，发到 GitHub Issue（ready-for-agent）
/implement           → Agent 按 PRD 实现
/code-review         → 对照标准与 spec 审查
```

## 可选扩展

本模板**不包含**以下垂直模块，可按需从 CangHai 单独引入：

- **OpenClaw Runtime Skills** — `60_Archives/PersonalAgent/skills/` 风格的运行时 Agent
- **Cloudflare Public Ask Worker** — NLWeb / 公开问答 API 脚手架
- **Obsidian 知识库布局** — 编号目录、`[[双向链接]]`、RAG 分区

## License

Skills 源自 [mattpocock/skills](https://github.com/mattpocock/skills) 生态及 CangHai 本地扩展，使用时请遵循各 skill 上游许可。
