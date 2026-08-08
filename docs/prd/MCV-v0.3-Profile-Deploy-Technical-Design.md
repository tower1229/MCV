# MCV v0.3 Profile 与 Deploy 技术方案

> 状态：产品决策已冻结，技术方案已定稿；`0.3.0-beta.1` 按本文与 ADR 0011–0014 实现
> 目标版本：MCV 0.3
> 设计日期：2026-08-06
> 当前实现基线：MCV 0.3.0-beta.1

## 1. 方案结论

MCV 0.3 在现有“Canonical Repository → Adapter → 事务化 Deploy”架构中增加两层：

1. Asset Catalog：把现有 Repository 内容映射成稳定、可引用的 AI 资产。
2. Profile Resolver：把一个或多个 Profile 解析成确定的资产集合。

Profile 只描述“选择哪些资产”；Deploy scope 只描述“写到哪里”。二者彻底解耦：

- mcv deploy dev：把 dev 部署到当前项目。
- mcv deploy dev design：把两个 Profile 的并集部署到当前项目。
- mcv deploy dev --global：把 dev 部署到当前设备的全局 Agent 位置。
- mcv deploy --global：把内置 global Profile 部署到当前设备全局。
- mcv deploy global：把 global Profile 当作普通 Profile 部署到当前项目。

global 是初始化时自动存在的内置 Profile。它采用与普通 Profile 完全相同的数据结构、查询、编辑和部署流程；唯一额外约束是不能删除。

用户 Agent 通过本地 MCV MCP Server 获得完整的 Profile 管理能力，可以读取资产、创建或替换多个 Profile、删除普通 Profile、编辑 global，并在用户明确要求时调用 Deploy。Profile 更新直接落盘，不强制经过 TUI。

## 2. 已冻结的产品约束

以下内容属于实现约束，不在开发阶段重新讨论：

1. 废除 install，不实现公开的 install 命令。
2. Deploy 默认目标为当前项目；增加 --global 时目标为设备全局。
3. Profile 与 Deploy scope 相互独立，任何 Profile 都可以部署到项目或全局。
4. global 是内置 Profile，除不可删除外不拥有另一套管理逻辑。
5. 不引入 tag、Profile 继承、Profile 组合声明或 Project Binding。
6. 多个 Profile 在 Deploy 时临时求并集，不保存组合关系。
7. MCV 不保存跨设备项目路径、项目列表或项目身份映射。
8. TUI 只用于 Profile 可视化维护；裸 mcv 不再进入全局全屏 Shell。
9. Agent 可以直接管理 Profile；MCV 负责约束写入边界、验证和并发控制。
10. 不引入内置模型，不引入 chezmoi，不自动执行 Git commit、pull 或 push。

## 3. 当前实现与改造边界

当前 0.2.0-beta.1 已具备成熟的能力：

- Canonical、Native、Local/Runtime 三层数据模型。
- Codex、Claude Code、Gemini 三个 Adapter。
- Rules、Skills、MCP 和 Native 配置的收集与转换。
- Deploy Plan/Apply、operationId、前置哈希、完整备份、失败回滚。
- managed whitelist Overlay。
- Canonical Skill Store、per-Skill 投影和符号链接拓扑防护。
- macOS 与 Windows 的 PTY/ConPTY 发布门。

0.3 不重写这些底层安全能力，而是在 Deploy Plan 生成之前增加资产选择与目标范围：

| 当前模块 | 0.3 处理方式 |
| --- | --- |
| Adapter 与 CanonicalTransformer | 保留，增加 project/global 双范围投影 |
| Deploy Plan/Apply 与事务引擎 | 保留，扩展 DeployRequest 和 Plan 元数据 |
| Capture | 保留，新增资产身份和 Profile 引用校验 |
| managed Skill layout | 全局 Deploy 继续复用 |
| 持久化 Ink Shell | 退出默认主路径，逐步移除 |
| Ink | 仅保留 Profile 管理界面 |
| Repository schema v3 | 迁移到 v4 |
| Operation schema v2 | 因 Deploy 语义变化升级到 v3 |

## 4. 核心领域模型

### 4.1 Asset

Asset 是 Repository 中可被 Profile 精确引用的最小部署单元。它不是新的物理存储格式，而是对现有文件结构的逻辑索引。

首期资产类型：

| Asset ID | 来源 | 粒度 |
| --- | --- | --- |
| rule:canonical | common/AGENTS.md | 当前单一 Canonical Rules 文件 |
| skill:<name> | common/skills/<name>/ | 一个完整 Skill 包 |
| mcp:<name> | common/mcp.yaml 的 servers.<name> | 单个 MCP Server |
| native:<target>/<file-id> | Adapter 声明的 Native 文件 | 一个 Adapter Native 配置单元 |

Surface MCP override、平台 override 和 Skill 内部文件不单独成为 Asset：

- 选择 mcp:<name> 时，自动携带该 Server 对应的 Surface override。
- 选择基础 Asset 时，部署阶段自动采用当前平台 override。
- 选择 Skill 时始终选择完整目录包。

这些前缀是稳定的技术命名空间，不是语义 tag。

### 4.2 Asset Catalog

Asset Catalog 每次从 Repository 确定性生成，不新增需要用户维护的 assets.yaml。

每个 Catalog Item 至少包含：

~~~ts
interface AssetCatalogItem {
  id: string;
  type: 'rule' | 'skill' | 'mcp' | 'native';
  displayName: string;
  description?: string;
  sourcePaths: string[];
  contentHash: string;
  sizeBytes: number;
  activation: 'always' | 'on-demand' | 'tool-surface' | 'configuration';
  supportedScopes: Array<'project' | 'global'>;
  supportedTargets: Array<'codex' | 'claude-code' | 'gemini'>;
}
~~~

activation、supportedScopes 和 supportedTargets 是由格式和 Adapter 确定的技术事实，不是模型生成的分类标签。

Skill 的 displayName 和 description 来自 SKILL.md frontmatter；MCP 使用 Server key 和传输信息；Native 使用 Adapter 的稳定 file-id。Catalog 不启动 MCP Server，也不推断业务 tag。

Catalog Revision 是所有 Asset ID、内容哈希和 Adapter 能力声明经过稳定排序后的 SHA-256，用于防止 Agent 基于旧资产清单覆盖新变化。

### 4.3 Profile

Profile 是 Asset ID 的无序集合，外加面向用户和 Agent 的简短说明。Profile 不包含目标平台、项目路径、设备、Agent 列表或安装状态。

~~~ts
interface Profile {
  title?: string;
  description?: string;
  assets: string[];
}
~~~

不支持：

- tag 查询；
- include、extends 或继承；
- Profile 内的条件表达式；
- 针对单个项目的绑定；
- 针对 Profile 内资产的参数 override。

需要组合时直接执行：

~~~bash
mcv deploy dev design
~~~

### 4.4 Unassigned

Unassigned 不是保存的分类，而是动态集合：

~~~text
Unassigned = Asset Catalog - 所有 Profile 引用过的 Asset
~~~

一个 Asset 可以同时出现在 global 和多个普通 Profile 中。Deploy 根据 Asset ID 去重。

### 4.5 Deploy Scope

~~~ts
type DeployScope = 'project' | 'global';
~~~

Scope 只决定目标路径解析和安全边界，不改变 Profile 内容。

## 5. Repository 与 Profile Schema

### 5.1 Repository schema v4

Repository 继续以 mcv.yaml 作为身份与配置清单，schemaVersion 升级到 4。Profile 数据单独存放在根目录 profiles.yaml，避免把用户资产集合塞入运行配置。

推荐结构：

~~~text
my-mcv-config/
├── mcv.yaml
├── profiles.yaml
├── common/
│   ├── AGENTS.md
│   ├── skills/
│   └── mcp.yaml
└── ide/
~~~

### 5.2 profiles.yaml

~~~yaml
schemaVersion: 1
profiles:
  global:
    title: Global
    description: Stable assets useful across most projects
    assets:
      - rule:canonical
      - skill:code-review
      - mcp:context7

  dev:
    title: Development
    description: General software development capabilities
    assets:
      - skill:debug
      - skill:testing
      - skill:code-review
~~~

选择单文件而不是 profiles/<id>.yaml 的原因：

- Agent 常常一次重组多个 Profile，单文件可以通过一次原子替换提交。
- global 必须存在的约束可以由一个 JSON Schema 完整验证。
- 50～100 个 Profile 以内文件仍然很小。
- Revision、并发控制和 Git diff 都更简单。
- 避免多文件 Profile 事务产生半完成状态。

profiles.yaml 的序列化规则：

- global 固定排在第一位，其余 Profile ID 按字典序。
- assets 去重并按 Asset ID 排序。
- 不写 updatedAt 等会产生无意义 Git diff 的字段。
- Profile ID 使用小写字母、数字和连字符，长度 1～64。
- ID 对所有 Profile 都是不可变标识；需要改变展示名称时修改 title。
- global 必须存在，且 delete 操作必须拒绝它。

Profiles Revision 是 profiles.yaml 规范化内容的 SHA-256。

## 6. Profile 生命周期

### 6.1 统一服务层

CLI、TUI 和 MCP 必须调用同一个 ProfileService：

~~~ts
interface ProfileService {
  inspect(): ProfileInventory;
  create(input: CreateProfileInput): ProfileMutationResult;
  update(input: UpdateProfileInput): ProfileMutationResult;
  delete(input: DeleteProfileInput): ProfileMutationResult;
  replaceAll(input: ReplaceProfilesInput): ProfileMutationResult;
}
~~~

所有写操作必须：

1. 验证 expectedProfilesRevision。
2. 验证 expectedCatalogRevision。
3. 验证所有 Asset ID 存在。
4. 验证 global 仍然存在。
5. 在内存中生成完整新文档并通过 profiles schema。
6. 使用现有 atomicWriteFile 进行单文件原子替换。
7. 返回结构化 diff 和新 Revision。

Profile 删除只删除集合定义：

- 不删除任何 Asset。
- 不寻找或修改曾经部署过的项目。
- 不修改全局设备配置。
- 不触发 Deploy。

### 6.2 CLI 生命周期

Profile 子命令属于可发现的管理命名空间，不增加顶层心智负担：

~~~bash
# 专用 TUI
mcv profile
mcv profile edit dev

# 只读
mcv profile list
mcv profile show dev

# 生命周期
mcv profile create dev --title "Development"
mcv profile edit dev --add skill:debug skill:testing
mcv profile edit dev --remove skill:writing
mcv profile edit dev --description "General development assets"
mcv profile delete dev
~~~

所有只读命令支持 --json。写命令支持 --json 和 --expected-revision，方便脚本使用。

不增加 rename ID 命令：所有 Profile ID 都不可变，因此 global 除“不可删除”外不需要另一套身份规则。用户可以修改 title；确需更换 ID 时，创建新 Profile 后删除旧 Profile。

## 7. Deploy CLI 协议

### 7.1 命令语法

~~~bash
mcv deploy [profiles...] [options]
~~~

核心参数：

| 参数 | 语义 |
| --- | --- |
| profiles | 一个或多个 Profile ID |
| --global | 将目标从当前项目切换为设备全局 |
| --target <path> | 项目范围下显式指定目标目录；默认 process.cwd() |
| --dry-run | 输出 Plan，不执行 |
| --yes | 非交互执行安全 Plan |
| --json | 输出 operation schema v3 JSON |
| --prune-managed | 把不再需要且由 MCV 拥有的项目列为删除候选 |

--target 与 --global 互斥。默认项目根目录严格等于当前工作目录，不自动向上寻找 Git Root，避免在 monorepo 中把资产部署到用户没有选择的位置。

### 7.2 无参数安全行为

0.2 中 mcv deploy 表示全局部署；0.3 中 Deploy 默认是项目范围。因此不能让无参数命令静默改变含义。

冻结以下规则：

- mcv deploy：退出码 2，提示必须指定 Profile，或者使用 mcv deploy --global。
- mcv deploy --global：等价于 mcv deploy global --global。
- mcv deploy --yes：同样返回用法错误，不得在当前目录写文件。

这是一项有意的安全型 breaking change。

### 7.3 Profile 合并

Resolver 按用户给出的 Profile ID 读取集合，生成去重后的 AssetSelection：

~~~ts
interface AssetSelection {
  profileIds: string[];
  profilesRevision: string;
  catalogRevision: string;
  assetIds: string[];
}
~~~

规则：

- 同一 Asset 出现在多个 Profile 中只部署一次。
- Profile 顺序不改变内容和冲突优先级。
- 不存在的 Profile 是输入错误。
- Profile 引用不存在 Asset 时整个 Plan 失败，不执行安全子集。
- Asset 不支持当前 scope 时产生 notice 并跳过；其他可部署资产继续。
- 如果所有 Asset 都不支持当前 scope，返回成功的空 Plan 和明确 notice。

### 7.4 Operation schema v3

Deploy Plan 和 Result 新增：

~~~ts
interface DeployContextFields {
  scope: 'project' | 'global';
  targetRoot: string;
  profileIds: string[];
  profilesRevision: string;
  catalogRevision: string;
  assetIds: string[];
}
~~~

Apply 重新计算 Profile 和 Catalog Revision，并继续执行当前 operationId、Repository 来源哈希、目标前置哈希与链接拓扑验证。任一 Revision 变化都返回 deploy.stalePlan。

## 8. Deploy 架构

~~~mermaid
flowchart TD
    R["Repository Reader"] --> C["Asset Catalog"]
    C --> P["Profile Resolver"]
    P --> S["Selected Repository View"]
    S --> A["Adapter Projectors"]
    A --> D["Deploy Plan / Transaction"]
~~~

### 8.1 DeployRequest

~~~ts
interface DeployRequest {
  scope: 'project' | 'global';
  targetRoot: string;
  profileIds: string[];
  selection: AssetSelection;
}
~~~

### 8.2 SelectedRepositoryView

当前 Adapter 直接接收 repositoryPath 并读取全部 Canonical/Native 内容，这会让每个 Adapter 都承担 Profile 过滤。0.3 应把选择统一放到核心层：

~~~ts
interface SelectedRepositoryView {
  rules?: {
    id: 'rule:canonical';
    content: string;
  };
  skills: Array<{
    id: string;
    name: string;
    files: Array<{ relativePath: string; content: Buffer }>;
  }>;
  mcpServers: Record<string, unknown>;
  mcpOverrides: Record<string, Record<string, unknown>>;
  nativeAssets: Map<string, Buffer>;
}
~~~

Adapter 只接收已选内容和 DeployRequest，不能自行读取 Profile：

~~~ts
interface IdeAdapter {
  detect(context: DeviceContext): Promise<DetectedIde>;
  capture(files: DetectedConfigFile[], context: DeviceContext): Promise<CaptureResult>;
  project(
    source: SelectedRepositoryView,
    request: DeployRequest,
    context: DeviceContext,
  ): Promise<DeployOperation>;
}
~~~

这样 Profile 语义只存在于核心层，Adapter 继续只负责 IDE 格式和路径。

## 9. Project 与 Global 路径矩阵

下表以 2026-08-06 的官方文档为依据。Adapter 应集中维护路径，测试不得在各命令中复制字符串。

| Surface | Asset | global scope | project scope |
| --- | --- | --- | --- |
| Codex | Rules | $CODEX_HOME/AGENTS.md | <target>/AGENTS.md |
| Codex | Skills | $HOME/.agents/skills | <target>/.agents/skills |
| Codex | MCP | $CODEX_HOME/config.toml | <target>/.codex/config.toml |
| Claude Code | Rules | user CLAUDE.md | <target>/CLAUDE.md |
| Claude Code | Skills | user .claude/skills | <target>/.claude/skills |
| Claude Code | MCP | user-scope .claude.json | <target>/.mcp.json |
| Gemini CLI | Rules | $HOME/.gemini/GEMINI.md | <target>/GEMINI.md |
| Gemini CLI | Skills | user Skill Surface | <target>/.agents/skills |
| Gemini CLI | MCP | $HOME/.gemini/settings.json | <target>/.gemini/settings.json |
| Antigravity | 当前已验证全局 Surface | 保持现有 Adapter | 0.3 暂不支持 |

依据：

- Codex 会从项目路径层级读取 AGENTS.md；项目 Skills 使用 .agents/skills；项目 MCP 可使用可信项目内的 .codex/config.toml。参见 [AGENTS.md](https://developers.openai.com/codex/agent-configuration/agents-md)、[Skills](https://developers.openai.com/codex/build-skills) 和 [MCP](https://developers.openai.com/codex/mcp)。
- Claude Code 的项目 Skills 位于 .claude/skills，项目 MCP 位于根目录 .mcp.json，项目 CLAUDE.md 位于项目根或 .claude 目录。参见 [Claude Skills](https://code.claude.com/docs/en/skills)、[Claude MCP](https://code.claude.com/docs/en/mcp-quickstart) 和 [Claude Directory](https://code.claude.com/docs/en/claude-directory)。
- Gemini CLI 支持项目 .gemini/skills 和可互操作的 .agents/skills alias；项目设置与 MCP 位于 .gemini/settings.json；GEMINI.md 支持工作区层级。参见 [Gemini Skills](https://geminicli.com/docs/cli/skills/)、[Configuration](https://geminicli.com/docs/reference/configuration/)、[GEMINI.md](https://geminicli.com/docs/cli/gemini-md/) 和 [MCP](https://geminicli.com/docs/tools/mcp-server/)。

项目级 Gemini Skills 选择 .agents/skills，是因为 Codex 与 Gemini CLI 都正式识别该路径，可以避免在同一个项目复制第二份 Gemini Skill；Claude Code 仍必须生成独立的 .claude/skills 结构。

Antigravity 的项目级 loader 尚无可靠官方或本项目 smoke evidence，因此 0.3 只保留已有全局 copy projection，并返回 projectScopeUnsupported notice。

## 10. 各资产类型的项目部署策略

### 10.1 Rules

项目通常已经存在自己的 AGENTS.md、CLAUDE.md 或 GEMINI.md，不能整文件覆盖。Project scope 使用受管理 Markdown Block：

~~~markdown
<!-- mcv:begin rule:canonical -->
...MCV managed content...
<!-- mcv:end rule:canonical -->
~~~

规则：

- 文件不存在时创建。
- 文件存在时只更新对应 Block。
- Block 外内容完全保留。
- Block 被本地修改后视为 Drift，不静默覆盖。
- --prune-managed 只删除未漂移的 MCV Block，不删除文件中的其他内容。
- Global scope 保留当前完整文件事务与备份行为，避免不必要的迁移。

### 10.2 Skills

Project scope 使用完整目录复制，不建立指向 MCV Repository 或用户 HOME 的符号链接：

- Codex 与 Gemini CLI：<target>/.agents/skills/<name>/。
- Claude Code：<target>/.claude/skills/<name>/。
- 一个 Skill 包内的 scripts、references、assets 和二进制资源全部保留。
- 不链接整个 Skills Root。
- 目标路径已有未知或 divergent 包时，生成 decisionRequired，不写穿或覆盖。
- 相同内容视为 satisfied，不重复写入。

Project copy 是有意选择：项目移动、跨设备克隆和 Windows 环境不应依赖另一台设备上的 MCV Repository 绝对路径。Global scope 继续使用当前 Canonical Device Skill Store 与 per-Skill projection 策略。

### 10.3 MCP

Profile 可以精确选择单个 MCP Server。Project scope 进行 Server key 级 Overlay：

- Codex：合并 .codex/config.toml 的 mcp_servers。
- Claude Code：合并 .mcp.json 的 mcpServers。
- Gemini CLI：合并 .gemini/settings.json 的 mcpServers。

MCV 只拥有自己部署的 Server key；其他项目 MCP 定义保留。Surface override 随所选 Server 自动应用。

同名 Server 已存在且内容不同：

- 已记录为 MCV managed：按正常 Drift 与 Plan 规则处理。
- 未记录：生成 decisionRequired，要求 Preserve 或 Replace。
- 非交互 --yes 不解决此冲突。

### 10.4 Native

Native Asset 是否支持 project scope 由 Adapter 明确声明，不能依据文件名猜测：

- 首期优先支持官方已有项目配置层的 managed 字段。
- 仅有用户级位置的 Native Asset 标记为 global-only。
- Profile 可以引用 global-only Asset；项目 Deploy 时产生 notice 并跳过。

这使 global Profile 与普通 Profile 保持相同结构，同时让物理兼容性留在 Adapter。

## 11. Project Managed Receipt，而不是 Project Binding

安全删除或更新以前部署的资产，需要知道哪些项目文件由 MCV 创建。完全不保存所有权会导致两种坏结果：永不清理旧资产，或者误删用户文件。

因此项目内保存一个最小 Managed Receipt：

~~~text
<target>/.mcv/managed.json
~~~

示例：

~~~json
{
  "schemaVersion": 1,
  "repositoryId": "uuid",
  "managed": {
    ".agents/skills/debug": {
      "assetId": "skill:debug",
      "hash": "sha256..."
    },
    "AGENTS.md#mcv:rule:canonical": {
      "assetId": "rule:canonical",
      "hash": "sha256..."
    }
  }
}
~~~

它不是 Project Binding：

- MCV 全局状态中没有项目列表。
- 不保存项目名称或绝对路径。
- 不跨项目查询、推荐或自动部署。
- 项目移动到任意目录后仍然有效。
- 删除项目不需要通知 MCV。
- 用户删除 managed.json 后，MCV 只会失去清理所有权并退回保守模式。

Receipt 与文件写入属于同一个 Deploy 事务，最后提交。MCV 不自动修改 .gitignore，也不自动提交该文件；是否纳入项目版本控制由用户决定。

## 12. Deploy 事务、安全与恢复

### 12.1 复用现有 Plan/Apply

现有 Deploy 引擎已具备 operationId、Plan 再生成、来源与目标哈希、备份、写入后验证和反向回滚。0.3 在其上增加：

- scope、targetRoot、Profile Revision 和 Catalog Revision 前置条件；
- 项目根目录 containment；
- Managed Receipt 前置哈希；
- project/global 不同目标解析；
- Asset 级来源信息。

### 12.2 项目路径安全

Project scope 必须：

1. targetRoot 存在且是目录。
2. targetRoot 使用 realpath 规范化。
3. 所有输出路径必须严格位于 targetRoot 内。
4. 拒绝把 HOME、文件系统根目录或已绑定 MCV Repository 当作隐式项目目标。
5. 不穿过符号链接、junction 或 reparse-point ancestor 写入。
6. Windows 与 macOS 使用同一 containment 契约和平台专门测试。
7. --target 必须是显式路径；不得由环境变量空值解析成宽泛目录。

### 12.3 Cleanup

普通 Deploy 只增加或更新所选资产。只有 --prune-managed 才生成旧资产删除候选，并且候选必须同时满足：

- 出现在 Managed Receipt。
- 当前内容或拓扑仍等于 Receipt 哈希。
- 当前 selection 已不再需要。
- 没有未解决 Drift。

删除继续沿用当前 Advanced Cleanup、默认不选中和非交互阻断规则。

### 12.4 Backup 与 Restore

- Apply 首次写入前备份每个将被修改的节点及其拓扑。
- 写入失败时立即按逆序回滚。
- Receipt 提交失败也触发文件回滚。
- mcv restore 默认针对当前项目最近一次可验证 Deploy backup。
- mcv restore --global 针对最近一次全局 Deploy backup。
- Backup 中记录 targetRoot 只是本机恢复所需的操作事实，不被用作 Project Binding 或跨设备识别。
- 恢复时发现部署后修改继续使用 Restore Conflict 阻断，不提供 force。

### 12.5 并发

- profiles.yaml 使用 Profiles Revision 和单文件原子替换。
- Deploy 继续使用 operationId 与 Plan snapshot。
- 同一 Repository 同时发生 Capture/Profile 写入时，后提交者必须因 Revision 变化失败。
- 同一 targetRoot 同时 Deploy 时使用短期文件锁；锁只用于互斥，不写入项目注册表。

## 13. Capture 与 Profile 的关系

Capture 负责把内容纳入 Asset Catalog，Profile 负责决定内容在哪些集合中。两者不能隐式耦合。

冻结行为：

- 已存在 Asset 的内容更新后，Profile 引用保持不变。
- 新 Capture 的 Asset 默认进入 Unassigned，不自动进入 global。
- Capture 结果显示新增 Unassigned 数量，并提示使用 Agent 或 mcv profile 归类。
- 删除一个仍被 Profile 引用的 Asset 时，Capture Plan 生成 decisionRequired，并列出引用它的 Profile。
- Capture 不自动重写 Profile。
- v3 → v4 迁移是唯一例外：为保持 0.2 的“全部全局部署”行为，迁移时把现有全部 Asset 放入 global。

项目本地资产的反向 Capture 不进入 0.3 首期；未来可增加显式 project source，但不能通过保存 Project Binding 实现。

## 14. MCV MCP Server

### 14.1 形态

首期使用本地 stdio：

~~~bash
mcv mcp
~~~

该命令属于 Agent 集成入口，不放进日常主命令提示。实现采用官方 TypeScript SDK v2 的 @modelcontextprotocol/server，并固定兼容的 MCP protocol version。官方 SDK 已提供 stdio、Tools、Resources 和结构化结果能力，参见 [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。

不首发 HTTP Server、账号体系或远程授权；MCV 是单用户本地工具。

### 14.2 不生成常驻 Agent 声明文件

不额外把 MCV 管理说明写进全局 AGENTS.md、CLAUDE.md 或 GEMINI.md，因为这会让所有会话持续携带 MCV 上下文，违背“减少注意力分散”的产品目标。

改用：

1. MCP server instructions：提供很短的使用原则。
2. Tool description：描述每个受限操作。
3. mcv://guides/profile-classification Resource：Agent 需要全面归类时按需读取完整准则。

MCP 规范允许 Server 在发现阶段提供 instructions，并允许 Tools/Resources 承载结构化能力，参见 [MCP Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)、[Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) 和 [Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)。

### 14.3 工具集合

| Tool | 权限 | 作用 |
| --- | --- | --- |
| inspect_inventory | 只读 | 返回 Profile、Asset 摘要、Unassigned 和 Revisions |
| read_assets | 只读 | 批量读取 Agent 选择的 Asset 内容 |
| update_profiles | 写 | 原子创建、替换、更新或删除多个 Profile |
| deploy_profiles | 写 | 按 project/global scope 调用现有 Deploy 引擎 |

工具数量保持少，但不把所有动作塞入一个含糊的万能接口。

#### inspect_inventory

默认只返回资产摘要、description、大小、activation 和当前所属 Profile，不返回所有文件正文。这样 Agent 可以先用 50 个 Skill 的 frontmatter 做初步归类，只对模糊项调用 read_assets。

支持 cursor 与 limit，返回 Catalog Revision 和 Profiles Revision。

#### read_assets

~~~json
{
  "assetIds": ["skill:debug", "skill:code-review"],
  "includeFiles": true
}
~~~

限制单次返回大小并提供 continuation，避免 50 个完整 Skill 一次塞满 Agent 上下文。

#### update_profiles

支持一个原子批次：

~~~json
{
  "expectedCatalogRevision": "catalog-sha256",
  "expectedProfilesRevision": "profiles-sha256",
  "mutations": [
    {
      "operation": "upsert",
      "id": "global",
      "description": "Stable cross-project assets",
      "assets": ["skill:code-review", "mcp:context7"]
    },
    {
      "operation": "upsert",
      "id": "dev",
      "description": "General development assets",
      "assets": ["skill:debug", "skill:testing"]
    },
    {
      "operation": "delete",
      "id": "old-profile"
    }
  ]
}
~~~

MCV 先验证全部 mutation，再一次替换 profiles.yaml。删除 global 返回结构化错误；删除普通 Profile 不删除 Asset。

返回：

~~~json
{
  "status": "updated",
  "created": ["dev"],
  "updated": ["global"],
  "deleted": ["old-profile"],
  "diff": {
    "global": { "added": 2, "removed": 8, "total": 12 },
    "dev": { "added": 30, "removed": 0, "total": 30 }
  },
  "profilesRevision": "new-sha256"
}
~~~

#### deploy_profiles

~~~json
{
  "profiles": ["dev"],
  "scope": "project",
  "targetDirectory": "/absolute/current/project",
  "dryRun": false
}
~~~

- scope 默认 project。
- project 必须提供明确 targetDirectory，不能依赖 MCP Server 进程的启动目录。
- global 忽略 targetDirectory。
- 工具内部仍先生成并验证 Plan；安全 Plan 可在一次调用内 Apply。
- warning、decisionRequired、delete 和拓扑迁移沿用现有阻断规则，并返回可供 Agent 解释或重试的结构化 Issue。
- MCV 不强制打开 TUI；Agent Host 是否显示工具授权由 Host 安全策略决定。

### 14.4 MCP 工具安全标注

- inspect_inventory、read_assets：readOnlyHint=true，openWorldHint=false。
- update_profiles：readOnlyHint=false，destructiveHint=true，idempotentHint=true。
- deploy_profiles：readOnlyHint=false，destructiveHint=true，openWorldHint=false。
- 所有结果提供 outputSchema 和 structuredContent。
- 业务错误放入工具结果，使 Agent 能读取错误并修正；协议级错误只用于无效方法或协议失败。

### 14.5 Agent 默认归类准则

该准则存在于按需 MCP Resource，而不存入 tag：

- global：跨领域、高频、长期稳定、低冲突、低权限风险。
- 普通 Profile：开发、设计、写作等领域性或阶段性资产。
- Rules 比 Skill 更严格，因为它们通常持续进入上下文。
- MCP 比 Skill 更严格，因为它扩大工具面和权限面。
- 无法可靠判断的 Asset 留在 Unassigned，不为了覆盖率强行归类。
- 一个 Asset 可以进入多个 Profile。
- Agent 写入的是明确 Asset ID 集合，不保存模型推断出的 tag 或分数。

### 14.6 配置数据中立

现有 MCV 允许 Repository 含明文配置值。MCP 必须延续这一事实：

- inspect_inventory 默认只返回不含完整值的派生摘要。
- read_assets 返回忠实内容，可能包含明文凭据。
- MCV 不做秘密识别、遮罩或自动替换。
- 文档必须提醒：Agent Host、工具日志和模型上下文可能获得所读取内容。

## 15. CLI 与 TUI 收缩

### 15.1 顶层日常入口

~~~text
mcv
mcv capture
mcv deploy
mcv profile
~~~

- 裸 mcv 输出简洁 Overview，不进入 alternate screen。
- status 保留为兼容别名，但不作为新的日常概念宣传。
- init、bind、unbind、migrate、restore 等低频能力保留，后续可收进 repo 和 advanced help。

### 15.2 移除全局 Shell

当前 src/tui/shell.tsx 和 shell-state.ts 承担 Overview、Capture、Deploy、Restore、Repository 路由及大量键盘状态。0.3 不继续扩展这套 Shell：

- Capture 和 Deploy 调用现有一次性 Command 层，输出分组 Plan、Diff 摘要和确认。
- Read-only 命令直接输出 Report。
- Result 输出摘要和 next action 后退出。
- alternate screen、全局路由和 deep-link 语义从默认路径移除。

### 15.3 Profile 专用 TUI

mcv profile 使用 Ink，只有一个任务：维护 Profile。

推荐布局：

- 左侧：global 和普通 Profile 列表。
- 中间：支持搜索的 Asset 列表。
- 右侧：当前 Profile 已选资产与数量。
- 底部：保存、取消和变更摘要。

允许按 Asset 类型和技术兼容性过滤，但不提供 tag 系统。TUI 调用 ProfileService，不直接写 YAML。

## 16. Schema 与迁移

### 16.1 版本

| 对象 | 当前 | 目标 |
| --- | --- | --- |
| Repository schema | 3 | 4 |
| Operation schema | 2 | 3 |
| Device state | 2 | 3 |
| Profiles schema | 无 | 1 |
| Project Managed Receipt | 无 | 1 |

### 16.2 v3 → v4

mcv migrate --dry-run 展示：

1. 扫描当前 Repository Asset Catalog。
2. 创建 profiles.yaml。
3. 创建 global 并放入当前全部 Asset，保持旧版本全局部署结果。
4. 更新 mcv.yaml schemaVersion。
5. 保留 Canonical、Native、MCP override 和平台 override 文件原样。
6. 设备 managed inventory 映射为 global scope 的历史状态。

Apply 使用 Repository 事务和回滚；profiles.yaml 创建失败不得只更新 mcv.yaml。

### 16.3 CLI 迁移提示

- 旧 mcv deploy → 提示改用 mcv deploy --global。
- install 从未进入当前正式命令，不新增兼容别名。
- README 明确 project 是 Deploy 默认 scope。
- JSON consumer 必须按 operation schemaVersion 拒绝未知版本。

## 17. 模块规划

建议新增：

~~~text
src/
├── assets/
│   ├── catalog.ts
│   ├── ids.ts
│   └── selected-repository-view.ts
├── profiles/
│   ├── store.ts
│   ├── service.ts
│   ├── resolver.ts
│   └── contracts.ts
├── mcp/
│   ├── server.ts
│   ├── tools.ts
│   └── resources.ts
├── tui/
│   └── profile/
│       ├── app.tsx
│       ├── reducer.ts
│       └── view.tsx
└── operations/
    └── deploy.ts

schemas/
├── mcv.schema.json
└── profiles.schema.json
~~~

Profile、Asset 和 Deploy Request 类型不得定义在 TUI 或 MCP 层。MCP、CLI 和 TUI 都只做参数转换。

## 18. 测试策略

### 18.1 Unit

- Asset ID 的确定性和非法路径拒绝。
- Skill、MCP、Rule、Native Catalog 生成。
- Profile schema、global 必须存在、global 删除拒绝。
- 多 Profile 并集、去重、缺失引用和 Revision 冲突。
- Project/global 路径矩阵。
- Rules managed block 与 MCP key-level Overlay。
- MCP input/output schema 和 tool annotation。

### 18.2 Integration

- 50 个 Skill 中原子创建包含 30 个 Skill 的 dev Profile。
- Agent 一次调用同时更新 global、创建多个 Profile、删除旧 Profile。
- Codex、Claude Code、Gemini CLI 项目目录正确生成。
- 同一 Skill 在 .agents/skills 与 .claude/skills 正确投影。
- 项目现有 Rules 与 MCP 未管理内容保持不变。
- Managed Receipt 缺失时不执行清理。
- --prune-managed 只删除哈希未漂移的 MCV-owned 内容。
- Apply 中任意写入失败时文件和 Receipt 全部回滚。
- v3 → v4 迁移后 mcv deploy --global 与旧 Deploy 结果等价。

### 18.3 CLI contract

- mcv deploy 无参数返回 2，且不写当前目录。
- mcv deploy --global 默认使用 global。
- --target 与 --global 冲突返回 2。
- stdout JSON 仍然只包含单个文档。
- warning/decisionRequired 非交互返回 3。
- Ctrl+C 返回 130。

### 18.4 PTY/ConPTY

只保留 Profile TUI 的真实终端验证：

- alternate screen 恢复；
- 方向键、Space、Enter、Escape；
- 搜索输入和中文宽度；
- macOS PTY 与 Windows ConPTY。

Capture、Deploy 和状态不再需要全局 Shell 路由测试。

## 19. 实施顺序

### Phase 1：Profile 与 Catalog 内核

- Repository schema v4、profiles schema v1。
- Asset Catalog、ProfileStore、ProfileService。
- v3 → v4 migration。
- Profile CLI 的 list/show/create/edit/delete。

验收：可以在不实现 TUI 和 MCP 的情况下，用 CLI 创建 dev Profile 并得到稳定 JSON。

### Phase 2：双范围 Deploy

- DeployRequest、SelectedRepositoryView。
- Adapter project/global 路径。
- Rules Block、Skill copy、MCP Overlay。
- Managed Receipt、project containment、备份与回滚。
- Deploy operation schema v3。

验收：mcv deploy dev 在临时项目中生成正确的 Codex、Claude Code、Gemini CLI 资产；mcv deploy --global 保持旧能力。

### Phase 3：CLI 收缩与 Profile TUI

- 裸 mcv 改为 plain Overview。
- Capture/Deploy/Restore 退出全局 Shell。
- Profile 专用 Ink App。
- 删除不再需要的 Shell route、state 和对应快照。

验收：除 mcv profile 外，没有命令进入全屏 TUI。

### Phase 4：Agent 集成

- @modelcontextprotocol/server stdio Server。
- Inventory、Read Assets、Update Profiles、Deploy Profiles。
- Server instructions 与分类 Resource。
- Codex、Claude Code、Gemini CLI 的配置示例和工具调用契约测试。

验收：用户 Agent 可在一次 Profile mutation 中把 50 个 Skill 自动归类并直接保存。

### Phase 5：发布

- README、CONTEXT、PRD、CHANGELOG、release checklist。
- ADR：Profile 存储、双范围 Deploy、Project Receipt、MCP Server、TUI 收缩。
- macOS/Windows 全量 CI、npm pack。
- 发布 0.3 beta，不自动 npm publish。

## 20. 验收标准

0.3 只有同时满足以下条件才算完成：

1. global 永远存在，无法删除，但可以像普通 Profile 一样完整编辑和部署。
2. 用户可以创建 50 个 Asset 中包含任意 30 个 Asset 的 dev Profile，无需运行 30 次命令。
3. Agent 可以直接完成多 Profile 自动归类，不需要用户打开 TUI Apply。
4. mcv deploy dev 默认只写当前项目。
5. mcv deploy --global 使用 global，并保持现有全局事务安全。
6. Codex、Claude Code、Gemini CLI 的项目目录符合官方加载规则。
7. 不存在跨设备 Project Binding 或中央项目路径表。
8. 项目清理只作用于有 Managed Receipt 且未漂移的内容。
9. 旧 Repository 迁移后不会丢失原本全局部署的资产。
10. TUI 维护范围只剩 Profile。

## 21. 明确延期

以下内容不阻塞 0.3：

- 项目本地资产反向 Capture。
- 多文件、可组合的 Canonical Rules。
- Profile 继承与条件表达式。
- 自动生成语义 tag。
- Antigravity 项目级 Skills/MCP，等待正式 loader 证据。
- GUI 或 Web 管理界面。
- 远程 MCP、账号与云端同步。
- 自动 Git 操作。
- chezmoi 集成。

## 22. ADR 建议

实施前新增四份 ADR：

1. 0011-single-profiles-file-and-derived-asset-catalog.md
2. 0012-deploy-scope-independent-from-profile.md
3. 0013-project-managed-receipt-without-project-binding.md
4. 0014-agent-mcp-and-profile-only-tui.md

这些 ADR 与本文共同构成 0.3 的冻结设计基线。

## 23. 参考资料

- [MCV 当前 README](https://github.com/tower1229/MCV)
- [OpenAI Codex AGENTS.md](https://developers.openai.com/codex/agent-configuration/agents-md)
- [OpenAI Codex Skills](https://developers.openai.com/codex/build-skills)
- [OpenAI Codex MCP](https://developers.openai.com/codex/mcp)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp-quickstart)
- [Claude Code Settings](https://code.claude.com/docs/en/settings)
- [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)
- [Gemini CLI Configuration](https://geminicli.com/docs/reference/configuration/)
- [Gemini CLI GEMINI.md](https://geminicli.com/docs/cli/gemini-md/)
- [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/)
- [MCP 2026-07-28 Specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
