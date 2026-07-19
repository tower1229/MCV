# MCV

MCV（Mobile Configuration Vehicle）是一个 TypeScript/Node.js CLI，面向希望把 Codex、Claude Code 和 Gemini 配置保存在自有私人 Git 仓库、并安全部署到 macOS 或 Windows 设备的开发者。

## 必读入口

- 用户与运行契约：`README.md`
- 域词汇表：`CONTEXT.md`
- 架构决策：`docs/adr/`
- 产品需求：`docs/prd/MCV 产品需求文档.md`
- Issue 工作流：`docs/agents/issue-tracker.md`

## 当前运行契约

- CLI 入口：`src/index.ts`；发布入口：`dist/index.js`。
- 已实现命令：`init`、`discover`、`capture`、`deploy`、`status`、`restore`。
- 已支持 Adapter：Codex、Claude Code、Gemini；不要把 Cursor 或规划中的命令描述为已实现。
- Canonical 数据位于 `common/`；Native 数据位于 `ide/<ide>/native/`；Local/Runtime 数据不得进入仓库。
- Overlay 使用 managed whitelist：仅显式 managed paths 由 Canonical 覆盖，未知字段默认保留为 Native。
- Capture 必须先脱敏、参数化并预览；Deploy 必须先预览，修改已有文件前必须备份。
- `dist/` 是提交和 npm 发布所需的编译产物。修改 `src/` 后运行 `npm run build` 并提交对应产物。

## 验证

代码或配置变更默认至少执行：

```bash
npm run typecheck
npm test
npm run build
node dist/index.js --help
```

发布相关变更还应执行：

```bash
npm pack --dry-run
```

不得替用户执行 `npm publish`，除非用户明确要求。当前 npm 包名为 `@tower1229/mcv`，要求 Node.js `>=22.12.0`。

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI；外部 PR 不作为 triage 请求入口。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五态角色词汇：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

先读 `CONTEXT.md`，再按需读取 `docs/adr/`。遵循 `docs/agents/domain.md`。

### IDE Agent Skills

可复用工作流存放在 `.agents/skills/<skill-name>/SKILL.md`，这是唯一提交到 Git 的源目录。

- 任务匹配某个 skill 的 `description` 时，先完整读取对应 `SKILL.md`。
- 不要 eager load 全部 skills。
- Codex 直接读取 `.agents/skills/`；其他 IDE 的同步副本不是编辑源。
