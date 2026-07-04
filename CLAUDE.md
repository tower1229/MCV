# {Project Name}

{One or two sentences: what this project is and who it serves.}

## 必读入口

- 项目规范：`README.md`
- 域词汇表：`CONTEXT.md`（按需 lazy 创建）
- 架构决策：`docs/adr/`
- PRD 归档：`docs/prd/`

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout; read `CONTEXT.md` first, then `docs/adr/` when they exist. See `docs/agents/domain.md`.

## IDE Agent Skills

可复用工作流存放在 `.agents/skills/<skill-name>/SKILL.md`（唯一源目录，提交 Git）。

- 任务匹配某 skill 的 `description` 时，先读该 skill 的 `SKILL.md` 并按其流程执行；不要 eager load 全部 skills。
- 新增或修改 skill 后执行 `npm run sync:skills`，同步到 IDE 配置中。
- Codex 直接读取 `.agents/skills/`；Claude Code 与 Cursor 需要同步后的副本。

## 首次使用

1. 将本模板复制为新仓库后，编辑本文件中的 `{Project Name}` 与项目定位。
2. 运行 `/setup-matt-pocock-skills`（或手动编辑 `docs/agents/`）配置 issue tracker 与 triage 词汇表。
3. 执行 `npm run sync:skills`。
4. 按需通过 `/domain-modeling` 或 `/grill-with-docs` 充实 `CONTEXT.md` 与 ADR。
