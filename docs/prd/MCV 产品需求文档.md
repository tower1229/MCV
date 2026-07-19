# MCV 产品需求文档

**项目名称：** MCV
**项目全称：** Mobile Configuration Vehicle
**版本：** PRD v0.1
**项目口号：** 可以随处部署的个人生产力，帝国的第一个建筑。
**项目属性：** 数字主权生态基础设施
**目标平台：** macOS、Windows
**首期目标 IDE：** Codex、Claude Code、Gemini (涵盖 Gemini CLI 和 Antigravity)
**实现状态（2026-07-19）：** schema v2；Gemini 为单目标双 Surface；capture/deploy/status 共用 Adapter 扫描契约；支持 bind、迁移预览、事务部署与漂移保护恢复。

---

## 1. 项目概述

MCV 是一套面向个人开发者的 AI IDE 配置收集、管理与跨设备部署工具。

它用于将散落在不同 AI IDE 和不同设备中的个人开发配置收归到一个由用户自行持有的本地数据仓库中，并支持在新设备上通过交互式 CLI 快速恢复和部署。Git 是可选且推荐的版本管理、备份和跨设备传输方式，但不是 MCV 数据仓库的前置条件。

MCV 不只是传统 dotfiles 工具。它重点管理与 AI 协作相关的个人生产力数据，包括：

- 通用开发规则；
- AI IDE 全局指令；
- Skills；
- MCP Server；
- 工作流和技术偏好；
- 各 AI IDE 独有的原生配置；
- macOS 与 Windows 平台差异配置。

MCV 的核心闭环为：

```text
当前设备
   ↓ Capture
人工确认
   ↓
个人 MCV 数据仓库
   ↓ Deploy
任意新设备
```

MCV 数据仓库是用户个人 AI 开发环境的唯一长期真相源。所谓“真相源”是指“经过人工确认的权威版本”，而非实时最新状态（两次 Capture 之间，设备端产生的新配置可能比仓库更新，这是预期设计）。设备上的配置是其部署副本，也可以通过人工确认被重新收集回仓库。

---

## 2. 产品愿景

随着 AI IDE 成为开发者主要的生产工具，开发者的规则、技能、工具网络、工作方式和 IDE 偏好逐渐构成一种新的个人数字资产。

目前这些数据分散在：

- 不同厂商的配置目录中；
- 不同格式的配置文件中；
- 不同操作系统和设备中；
- 不同 IDE 各自封闭的功能体系中。

MCV 致力于解决以下问题：

1. 个人 AI 开发配置不再依附于单一 IDE。
2. 更换设备时无需重新配置全部 AI 工具。
3. 用户可以查看、修改、迁移和长期保存自己的配置数据。
4. 通用能力可以在不同 AI IDE 之间复用。
5. IDE 独有配置也能够原样保留，不因统一抽象而丢失。
6. MCV 本身只是工具，数据仓库及其位置始终由用户控制。

MCV 在数字主权生态中的定位是：

> 个人 AI 开发能力的主权化封装与可迁移载体。

---

## 3. 产品目标

### 3.1 首期目标

MCV v0.1 应实现：

1. 用户在自行选择的目录中初始化 MCV 数据仓库。
2. 当前设备与该仓库建立稳定绑定。
3. 自动发现已安装或存在配置的 AI IDE。
4. 收集当前设备上的规则、Skills、MCP 和 IDE 原生配置。
5. 在写入仓库前进行逐项人工确认。
6. 自动过滤密钥、缓存、日志和设备运行状态。
7. 将路径等设备相关信息转换为可迁移变量。
8. 将仓库配置部署到新的 macOS 或 Windows 设备。
9. 部署前展示变更摘要并自动备份。
10. 检测仓库配置与当前设备之间的差异。
11. 支持恢复最近一次部署前的配置。
12. 所有普通操作均通过交互式 CLI 引导完成。

### 3.2 成功标准

用户应能够完成以下完整流程：

```text
创建或选择一个本地目录
        ↓
进入该目录执行 mcv init
        ↓
收集当前设备已有配置
        ↓
确认写入 MCV 数据仓库
        ↓
用用户选择的方式备份或传输到另一台设备
        ↓
执行 mcv bind
        ↓
执行 mcv deploy
        ↓
恢复主要 AI IDE 配置
```

理想情况下，用户不需要理解 Adapter、Profile、Schema、Overlay 等内部概念。

---

## 4. 非目标

MCV v0.1 暂不处理以下内容：

- AI IDE 会话记录和聊天历史；
- 云端托管服务；
- 多用户协作和权限系统；
- 自动双向实时同步；
- API Key、OAuth Token、Cookie 等凭据同步；
- IDE 安装及完整操作系统环境安装；
- Docker、字体、终端、系统软件等完整 dotfiles 管理；
- 企业级审批和审计系统；
- 自动将所有 IDE 配置转换成统一格式；
- 后台定时运行或持续监听配置变化；
- 自动执行 Git commit 或 push；
- 项目级仓库中的局部 IDE 配置管理。

后续版本可以逐步扩展软件安装、Shell、Git、终端和开发工具链，但第一阶段聚焦 AI IDE 的全局个人配置。

---

## 5. 目标用户

### 5.1 核心用户

- 同时使用多个 AI IDE 的个人开发者；
- 经常在 macOS 和 Windows 之间切换的开发者；
- 拥有大量自定义规则、Skills 和 MCP 的高级用户；
- 重视个人数据所有权和长期可迁移性的用户；
- 希望快速配置新电脑的开发者。

### 5.2 典型用户场景

#### 场景一：首次建立个人 MCV 仓库

用户已经在电脑上使用 Codex、Claude Code 和 Gemini，拥有大量现有配置。

用户选择一个本地目录作为 MCV 数据仓库，在该目录中执行：

```bash
mcv init
```

MCV 扫描现有配置，分类展示并让用户逐项决定哪些内容纳入仓库。

#### 场景二：部署到新设备

用户在新电脑上克隆自己的私人 MCV 仓库，进入目录执行：

```bash
mcv bind
mcv deploy
```

MCV 检测设备和已安装的 IDE，引导用户选择部署范围，并完成备份和写入。

#### 场景三：回收本地新增配置

用户在 Claude Code 中新增了一个 Skill，并修改了 Gemini 的部分设置。

用户在任意目录执行：

```bash
mcv capture
```

MCV 找到绑定仓库，显示本地新增和修改内容。用户确认后，变化被写入数据仓库。

#### 场景四：检查配置状态

用户执行：

```bash
mcv status
```

MCV 显示哪些 IDE 与仓库一致，哪些存在本地修改，哪些尚未部署。

---

## 6. 核心产品原则

### 6.1 数据由用户持有

MCV 不要求用户把数据放在 MCV 指定的位置。

用户可以将数据仓库放在：

- 任意本地目录；
- Git 仓库；
- 加密磁盘；
- 外置硬盘；
- 私人同步盘；
- NAS 挂载目录。

MCV 只绑定用户选择的位置，不擅自移动仓库。

### 6.2 仓库是唯一长期真相源

正常数据方向为：

```text
MCV 仓库 → 设备配置
```

设备配置需要回收时，必须经过：

```text
设备配置 → 候选变化 → 人工确认 → MCV 仓库
```

不得实现无确认的自动双向同步。

### 6.3 先保证数据不丢失，再追求统一

MCV 不强制理解每个 IDE 的全部配置字段。

对于暂时无法统一的 IDE 独有配置，应优先以原生格式保存，避免因为 MCV 尚未适配而丢失数据。

### 6.4 默认交互，底层可自动化

用户默认通过交互式 CLI 操作。

底层核心逻辑必须与交互层分离，以便：

- 自动测试；
- CI 验证；
- 高级脚本调用；
- 将来开发 GUI；
- 提供非交互参数。

### 6.5 实用优先

首期不引入用户难以理解的配置管理概念。

默认体验只围绕：

- 初始化；
- 收集；
- 部署；
- 查看状态；
- 恢复。

---

## 7. 系统总体架构

MCV 由两个独立部分组成。

### 7.1 公共 MCV CLI

公共开源程序，负责：

- 交互式终端界面；
- IDE 和配置发现；
- 配置收集；
- 配置过滤和转换；
- 差异计算；
- 配置部署；
- 自动备份；
- 仓库绑定；
- 平台兼容；
- 版本和结构迁移。

CLI 可独立升级，不与用户私人数据仓库中的内容耦合。

### 7.2 私人 MCV 数据仓库

由用户在自选本地路径中创建或复制，其备份、版本管理和跨设备传输方式由用户决定。Git 只是文档推荐方式，非 Git worktree 同样是合法的 MCV 数据仓库，不产生警告。

数据仓库只保存用户数据和声明，不保存 CLI 的完整实现代码。

推荐关系：

```text
公共 mcv-cli
      +
用户私人 my-mcv 仓库
      =
完整 MCV 使用体验
```

这样升级 CLI 时，不需要合并公共项目代码到用户私人仓库。

---

## 8. 数据分层模型

MCV 将配置数据分成三层。

### 8.1 通用主权层 Canonical

表达用户本人长期开发方式、可在多个 IDE 之间**复用和共享**的数据（跨 IDE 共享是 Canonical 的核心判别标准，而不只是跨设备迁移）。

包括：

- 通用编码规则；
- 架构和测试原则；
- Git 工作方式；
- 安全要求；
- 通用 Skills；
- MCP Server 定义；
- 技术栈偏好；
- 工作流；
- 项目初始化模板。

这些内容采用 MCV 统一格式，由 MCV 转换为不同 IDE 所需格式。

示例：

```text
common/
├─ AGENTS.md
├─ skills/
└─ mcp.yaml
```

### 8.2 IDE 原生个性层 Native

只对某个 IDE 有意义的配置，不强制转换成统一模型。

包括：

- 模型选择；
- IDE 权限模式；
- 沙箱模式；
- UI 和交互偏好；
- 编辑器行为；
- 实验性功能；
- 插件设置；
- IDE 特有 Hooks；
- IDE 特有 Agent 设置。

这些配置原则上保留原生格式：

```text
ide/
├─ codex/
├─ claude-code/
└─ gemini/
```

新增未知字段时，MCV 应尽可能保留，无须立即升级统一数据模型。

### 8.3 本机运行状态层 Local/Runtime

不适合跨设备同步和写入仓库的数据。

包括：

- 登录凭据；
- OAuth Token；
- API Key；
- Cookie；
- 缓存；
- 日志；
- 会话记录；
- 临时文件；
- 最近打开项目；
- 窗口状态；
- 设备标识；
- 崩溃报告；
- 遥测数据；
- IDE 内部索引；
- 自动更新状态。

此类数据默认排除。

---

## 9. 混合配置管理策略

MCV 不采用“全部转换”或“整个目录原样复制”的极端方案，而采用混合模式。

### 9.1 通用能力采用语义适配

以下内容通过适配器转换：

```text
通用规则 (AGENTS.md) → 按各 IDE 规范重命名或分发 (如 CLAUDE.md)
通用 Skills → 直接复制目录到各 IDE 的 skills 路径
统一 MCP (mcp.yaml) → 合并 IDE 专属覆盖后转换为各 IDE 对应格式
```

### 9.2 IDE 独有配置采用原生托管

对于 IDE 独有配置：

- 保留原始 JSON、TOML、YAML 或 Markdown 格式；
- 不重新定义所有字段；
- 通过白名单收集指定配置文件；
- 通过黑名单排除凭据、缓存和运行状态；
- 保留 MCV 不认识的新字段。

### 9.3 不允许直接复制整个配置目录

每个 IDE 必须提供配置清单：

```yaml
files:
  - id: user-config
    source:
      macos: ~/.example/config.json
      windows: "%USERPROFILE%\\.example\\config.json"
    format: json
    portability: portable
    secretPolicy: sanitize

exclude:
  - cache/**
  - logs/**
  - sessions/**
  - credentials.json
```

清单负责描述：

- 配置文件位置；
- 不同平台路径；
- 是否收集；
- 是否由 MCV 生成；
- 是否需要脱敏；
- 是否属于运行状态；
- 部署目标位置。

---

## 10. Adapter 设计

适配器仍然是 MCV 的核心组成，但必须保持轻量。

### 10.1 通用能力适配器

负责真正的语义转换：

- 规则转换；
- Skill 目录转换；
- MCP 格式转换；
- 文件生成；
- IDE 能力差异处理。

### 10.2 原生配置薄适配器

只负责：

- 发现配置路径；
- 读取原生配置；
- 判断可迁移文件；
- 排除敏感内容；
- 替换路径变量；
- 结构化合并；
- 写入目标路径；
- 基础格式校验。

薄适配器不需要理解原生配置中的每一个字段。

只有以下变化通常需要更新薄适配器：

- IDE 修改配置文件位置；
- IDE 修改配置文件名称；
- IDE 更换配置格式；
- 新增必须排除的敏感字段；
- 配置写入方式发生变化。

普通新增字段应当自动被保留。

### 10.3 建议接口与内部组合

Adapter 采用单一接口 `IdeAdapter` 与内部组合（CanonicalTransformer + NativeFileHandler）的设计。

```ts
interface IdeAdapter {
  detect(context: DeviceContext): Promise<DetectedIde>;

  discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]>;

  capture(
    files: DetectedConfigFile[],
    context: CaptureContext,
  ): Promise<CaptureResult>;

  deploy(
    repository: RepositoryConfig,
    context: DeployContext,
  ): Promise<DeployResult>;

  validate(
    repository: RepositoryConfig,
    context: DeviceContext,
  ): Promise<ValidationResult>;
}
```

---

## 11. 配置所有权模型

每项配置必须明确由谁管理。

### 11.1 Generated

由 MCV 通用配置生成。

例如：

- 全局 `AGENTS.md`；
- 根据通用规则生成的 `CLAUDE.md`；
- 根据统一 MCP 注册表生成的配置块。

设备端被修改时，`capture` 应报告漂移，而不是直接将整个文件视为 IDE 原生配置。

### 11.2 Native

由 IDE 或用户在 IDE 中直接管理。

例如：

- IDE UI 设置；
- 模型偏好；
- 实验特性；
- IDE 特有权限配置。

本地变化可通过 `capture` 收集。

### 11.3 Merged

同一文件同时包含 MCV 管理字段和 IDE 原生字段。

例如一个 `settings.json` 中同时包含：

- MCV 管理的 MCP；
- IDE 原生管理的主题和界面设置。

MCV 必须进行结构化合并，不得直接覆盖整个文件。

### 11.4 Local

仅属于当前设备。

例如：

- 当前机器终端路径；
- 公司代理；
- 临时目录；
- 设备特有工具路径。

默认不得写入共享数据仓库。

---

## 12. 字段级 Overlay

当同一个配置文件同时包含通用配置和 IDE 独有配置时，应采用字段所有权机制。

示例：

```yaml
managedPaths:
  - $.mcpServers
  - $.rules.global

nativePaths:
  - $.ui
  - $.accessibility
  - $.experimental

localPaths:
  - $.preferredTerminal
  - $.workspaceRoot
```

部署过程：

```text
读取仓库中的原生基础配置
        ↓
注入 MCV 管理字段
        ↓
应用平台覆盖
        ↓
应用本机变量和密钥引用
        ↓
写入设备
```

收集过程：

```text
读取设备配置
        ↓
排除 MCV 管理字段
        ↓
提取 Native 字段变化
        ↓
生成候选变更
        ↓
人工确认
```

字段级合并采用“Managed 字段白名单，其余默认 Native”策略。
- `managedPaths`: 显式声明由 MCV Canonical 层生成的字段。
- 未声明字段: 默认属于 Native，采集和部署时保留原样。
- `localPaths`: 排除已知仅限本机的运行状态字段。

第一版需要支持 JSON/TOML/YAML 对象路径级合并。

---

## 13. 路径与平台差异

原生配置中的绝对路径不能直接跨设备部署。

收集时应识别：

```text
/Users/example/Projects
C:\Users\example\Projects
D:\Code
```

并转换为变量：

```text
${HOME}
${PROJECTS_HOME}
${MCV_REPO}
${USER_CONFIG_HOME}
```

仓库可以保存默认变量声明：

```yaml
variables:
  PROJECTS_HOME:
    macos: "${HOME}/Projects"
    windows: "D:\\Projects"
```

部署时由本机值覆盖。

平台差异目录（仅用于发生实际的文件级独有内容替换，其余差异通过变量机制处理）：

```text
overrides/
├─ macos/
└─ windows/
```

MCV v0.1 必须处理：

- 路径分隔符；
- 用户主目录；
- 环境变量语法；
- Windows 盘符；
- 路径中的空格；
- 路径中的中文；
- 文件权限；
- 符号链接限制；
- 可执行文件后缀。

默认部署方式采用文件渲染与原子写入，不依赖符号链接。

---

## 14. 密钥与敏感数据

MCV 数据仓库中禁止保存明文密钥，无论用户采用哪种备份或版本管理方式。

需要识别和排除：

- API Key；
- Bearer Token；
- OAuth Token；
- Cookie；
- 密码；
- SSH 私钥；
- 认证文件；
- 内网凭据；
- 数据库连接密码。

v0.1 的脱敏采取简单的两层策略：
1. 文件名黑名单：硬编码常见敏感文件（如 `.env`, `id_rsa`, `credentials.json` 等）。
2. 字段名匹配：对 JSON/YAML 中 key 包含 `secret`、`token`、`password` 等关键字的值，替换为引用：

```text
${env:OPENAI_API_KEY}
```

不集成外部正则扫描或专业泄漏工具。部署时，如果缺少所需变量，应提示用户设置，不得静默写入空值。

MCV 的最低安全保障为：

> 预览、备份、脱敏。

---

## 15. 仓库初始化和绑定

### 15.1 初始化规则

`mcv init` 默认将当前执行目录作为新的 MCV 数据仓库目录。

用户必须先自行创建或选择一个本地目录。该目录可以是：

- 创建目录；
- 克隆已有空仓库；
- 从模板创建的目录；
- 通过其他备份或同步方式获得的目录。

不强制要求当前目录是 Git worktree，也不因非 Git 状态显示警告。Git 仅作为文档中的推荐方式。

然后进入该目录执行：

```bash
mcv init
```

MCV 不得自动移动仓库到统一目录。

### 15.2 初始化确认

CLI 应明确提示：

```text
MCV will initialize the current directory as your repository:

/path/to/my-mcv

It will store:
- Canonical rules
- Skills
- MCP
- Native AI IDE configuration
- Platform overrides

It will not store:
- Plaintext secrets
- Login credentials
- Session history
- Caches or logs
```

用户确认后：

1. 创建仓库结构；
2. 创建稳定仓库 ID；
3. 扫描当前设备；
4. 引导收集配置；
5. 将当前设备绑定到该仓库。

### 15.3 仓库标识

仓库内部保存：

```yaml
# mcv.yaml
schemaVersion: 2
repositoryId: "稳定唯一标识"
initializedAt: "ISO 时间"
```

该配置与其他仓库配置一并存放在仓库根目录的 `mcv.yaml` 清单文件中，不再使用 `.mcv/repository.json`。

本机全局配置保存：

```json
{
  "defaultRepository": {
    "id": "稳定唯一标识",
    "path": "/absolute/path/to/my-mcv"
  }
}
```

每次运行时校验：

1. 路径存在；
2. 包含 MCV 仓库标识；
3. 仓库 ID 与绑定记录一致。

### 15.4 本机绑定文件位置

建议遵循操作系统规范：

```text
macOS:
~/Library/Application Support/mcv/config.json

Windows:
%APPDATA%\mcv\config.json
```

该文件只保存：

- 仓库定位信息；
- 当前设备标识；
- CLI 本地偏好；
- 最近部署状态；
- 备份位置。

不得保存主体配置数据和密钥。

### 15.5 绑定已有仓库

在新设备克隆已有仓库后：

```bash
cd my-mcv
mcv bind
```

`bind` 只负责：

- 校验仓库结构；
- 读取仓库 ID；
- 注册为当前设备默认仓库；
- 不修改仓库主体数据。

如果用户在已有 MCV 仓库中执行 `mcv init`，CLI 应识别并建议绑定，不能重复初始化。

### 15.6 仓库移动

用户移动或重命名仓库后，可进入新路径执行：

```bash
mcv bind
```

如果仓库 ID 与原绑定一致，更新路径即可。

### 15.7 解除绑定

```bash
mcv unbind
```

只删除当前设备绑定，不删除仓库或设备配置。

### 15.8 临时指定仓库

高级用法：

```bash
mcv --repo /path/to/other-mcv status
```

只对当前命令生效，不修改默认绑定。

第一版用户界面只突出单一默认仓库，但内部数据结构应允许未来扩展多仓库。

---

## 16. 命令设计

### 16.1 默认入口

用户执行：

```bash
mcv
```

进入交互式主菜单：

```text
MCV

> Overview
  Capture
  Deploy
  Restore Latest Deployment
  Repository
  Help
```

### 16.2 一级命令

首期主要命令为：

```bash
mcv init
mcv bind
mcv capture
mcv deploy
mcv status
mcv restore
```

仓库管理命令：

```bash
mcv repo
mcv unbind
```

普通用户主要使用：

- `init`
- `capture`
- `deploy`
- `status`

其他命令可以通过菜单进入。

---

## 17. `mcv init` 需求

### 17.1 前置条件

- 当前目录可写；
- 当前目录不是另一个已绑定 MCV 仓库；
- 若存在文件，应提示是否继续；
- 不强制要求当前目录已经初始化 Git。

### 17.2 初始化方式

用户选择：

```text
● 收集当前设备已有配置
○ 创建空白 MCV 仓库
```

### 17.3 扫描结果

应展示：

- 当前操作系统；
- 已发现 IDE；
- IDE 配置文件数量；
- 规则文件数量；
- Skills 数量；
- MCP 数量；
- 疑似密钥数量；
- 本机绝对路径数量。

### 17.4 分类确认

用户可逐类选择是否纳入：

```text
Shared Rules
Skills
MCP
Codex Native Configuration
Claude Code Native Configuration
Gemini Native Configuration (Gemini CLI and Antigravity surfaces)
```

### 17.5 初始化结果

成功后：

- 创建仓库标识 (`mcv.yaml`)；
- 写入用户确认的配置；
- 创建 `.gitignore`；
- 绑定当前设备；
- 生成 Baseline Snapshot（基线快照），记录当前写入的所有文件哈希，作为后续 Capture 的参考点；
- 显示未处理警告；
- 不自动提交 Git。

---

## 18. `mcv capture` 需求

`capture` 用于反向收集当前设备变化。

### 18.1 数据方向

```text
设备配置
   ↓
发现变化
   ↓
脱敏和参数化
   ↓
候选变更 (已脱敏、已参数化的最终形式)
   ↓
人工确认
   ↓
数据仓库
```

Capture 呈现给用户确认的是处理后的“最终形态”（例如已经替换为 `${env:API_KEY}` 的内容），而非原始带有真实密钥的形态。

### 18.2 不允许直接写入

扫描完成后必须展示候选变化，包括：

- 新增文件；
- 修改文件；
- 删除文件；
- 新增 Skill；
- MCP 增删；
- 原生配置字段变化；
- MCV 生成文件被手动修改；
- 敏感信息被排除；
- 路径被参数化。

### 18.3 人工确认粒度

至少支持：

- 按 IDE 选择；
- 按配置文件选择；
- 按 Skill 或 MCP 选择；
- 接受全部安全变化；
- 取消全部变化。

字段级选择可以后续增强。

### 18.4 循环采集防护

部署时必须记录每个生成文件的哈希。

Capture 判断：

- 当前哈希等于部署哈希：忽略；
- 当前哈希不同：报告为本地修改；
- 文件不在部署记录中：报告为新配置；
- MCV 管理字段变化：报告漂移；
- Native 字段变化：允许收集。

### 18.5 删除操作

设备端删除配置时，默认不自动从仓库删除。

应明确询问：

```text
This configuration was deleted from the device. Remove it from the MCV repository too?
```

删除默认不选中。

### 18.6 审计简化

第一版不需要长期 Capture 状态机或复杂报告目录。

候选变化可以保存在临时目录或内存中；用户确认后直接写入仓库。

需要保留的只有：

- 变更摘要；
- 最近一次操作结果；
- 错误和警告；
- 自动备份。

---

## 19. `mcv deploy` 需求

### 19.1 设备检测

部署前显示：

- 当前平台；
- 已安装 IDE；
- 可部署 IDE；
- 未安装但仓库中有配置的 IDE；
- 缺失的环境变量；
- 可能的配置冲突。

### 19.2 部署范围选择

用户选择：

- 部署哪些 IDE；
- 是否部署通用规则；
- 是否部署 Skills；
- 是否部署 MCP；
- 是否部署各 IDE 原生配置；

不提供全局“覆盖本机已有配置”开关。对同时包含 MCV 管理字段和 Native 字段的文件，Deploy 始终遵守 Overlay 的 `managedPaths` 白名单，未声明的 Native 字段必须保留，`localPaths` 不得部署。用户选择的是具体计划变更，而不是改变所有权边界。

对由 MCV 完整拥有、确实会整文件替换的内容，预览和 Diff 必须明确标注“替换整个文件”。

默认选中：

- 已安装且仓库存在配置的 IDE；
- 安全且可迁移的配置。

### 19.3 部署预览

写入前必须显示：

```text
Planned deployment:

Add:              4 files
Modify:           3 files
Structured merge: 2 files
Skip:             2 fields with missing environment variables
Back up:          5 existing files
```

用户确认后才执行。

### 19.4 自动备份

所有将被修改或覆盖的文件必须在写入前备份。

建议位置：

```text
用户配置目录/mcv/backups/
```

至少保留：

- 最近一次完整部署备份；
- 对应部署时间；
- 原始文件路径映射。

第一版可只保证恢复最近一次部署。

### 19.5 原子写入

文件写入应采用：

```text
生成临时文件
→ 完成格式验证
→ 替换目标文件
```

避免中途中断导致配置损坏。

### 19.6 幂等性

相同仓库内容重复部署，结果必须一致。

没有变化时：

- 不重复写入；
- 不生成无意义备份；
- 明确显示“无待部署变化”。

### 19.7 部署验证

部署后检查：

- 文件存在；
- 格式可解析；
- 哈希与预期一致；
- 必要路径已解析；
- 敏感变量未被写入明文；
- 可执行的基础校验通过。

---

## 20. `mcv status` 需求

状态输出应保持简洁：

```text
Repository: /path/to/my-mcv
Binding: normal
Git: 2 uncommitted changes (shown only when Git is detected)

Pending deployment:
Codex         0 changes
Claude Code   2 modifications
Gemini        Not deployed

Post-deploy local state:
Codex         0 changes
Claude Code   1 local managed change
```

应显示：

- 仓库绑定是否正常；
- 仓库 ID 是否匹配；
- 若检测到 Git，数据仓库是否存在未提交修改；非 Git 数据仓库不产生警告；
- 当前数据仓库相对本机是否存在 Pending Deployment Change（待部署变化）；
- 相对 Baseline Snapshot 是否存在 Drift 或缺失文件；
- 是否缺少必要密钥；
- 最近一次部署或 Capture 是否成功。

不需要展示企业级详细审计日志。

---

## 21. `mcv restore` 需求

`restore` 用于恢复最近一次部署前的状态。

交互中应展示：

- 备份时间；
- 涉及 IDE；
- 将恢复的文件数量；
- 当前文件是否在部署后被再次修改。

如果当前文件已经发生新变化，则形成 Restore Conflict（恢复冲突）。v0.1 必须阻断恢复，列出冲突文件并提示用户先备份或手动处理；不得通过二次确认强制覆盖。

恢复操作本身也应避免直接删除用户新文件，可将当前状态临时备份后再恢复。

---

## 22. 交互式体验要求

### 22.0 界面语言

v0.1 的所有产品界面文案统一使用英文，包括 TUI、CLI help、提示、错误、确认、进度和结果摘要。命令名、参数名、JSON 字段名和 `error.code` 同样使用英文。README 保持中文。首期不建设 i18n 框架，不在界面中做中英双语混排。

### 22.1 默认全程交互

除高级参数外，用户不需要编辑配置文件即可完成：

- 初始化；
- 收集；
- 部署；
- 状态检查；
- 恢复；
- 仓库重新绑定。

### 22.2 明确使用用户语言

避免直接展示内部术语：

| 内部术语           | 用户界面用语           |
| ------------------ | -------------------------- |
| Canonical          | Shared Configuration       |
| Native             | IDE-specific Configuration |
| Adapter            | IDE Support                |
| Profile            | 不在首期暴露             |
| Overlay            | Merge Behavior             |
| Drift              | Local Managed Change       |
| Repository Binding | Repository Location        |

### 22.3 安全默认值

- 删除默认不选中；
- 覆盖已有配置需要确认；
- 密钥默认排除；
- 未知文件默认不收集；
- 本机路径默认参数化；
- 失败时不保留半写入状态。

### 22.4 允许返回和取消

每个关键步骤都应支持：

- 返回上一步；
- 查看详细信息；
- 取消操作；
- 仅查看不修改。

---

## 23. Preset 设计

首期不向用户暴露 `Profile` 概念。

每台设备记录上一次部署选择，例如：

```yaml
enabled:
  ide:
    - codex
    - claude-code
    - cursor

  capabilities:
    - rules
    - skills
    - mcp
```

下次部署时询问：

```text
Use this device's previous selection?
```

未来可以增加：

```text
Save this selection as a deployment preset?
```

用户可以建立：

```text
personal
work
minimal
full
```

目录名称建议使用：

```text
presets/
```

而不是 `profiles/`。

Preset 属于后续增强功能，不应阻塞第一版。

---

## 24. 推荐数据仓库结构

```text
my-mcv/
├─ .mcv/
│  └─ repository.json
│
├─ mcv.yaml
│
├─ common/
│  ├─ AGENTS.md
│  ├─ skills/
│  └─ mcp.yaml
│
├─ ide/
│  ├─ codex/
│  │  ├─ native/
│  │  └─ metadata.yaml
│  ├─ claude-code/
│  └─ gemini/
│
├─ overrides/
│  ├─ macos/
│  └─ windows/
│
├─ presets/
│  └─ .gitkeep
│
├─ .gitignore
└─ README.md
```

空目录不应全部预生成。只有存在对应数据时才创建。

---

## 25. `mcv.yaml` 建议结构

```yaml
schemaVersion: 2
repositoryId: repository-unique-id
initializedAt: "ISO 时间"

targets:
  codex:
    enabled: true
  claudeCode:
    enabled: true
  gemini:
    enabled: true
    surfaces:
      geminiCli: auto
      antigravity: auto

variables:
  PROJECTS_HOME:
    macos: "${HOME}/Projects"
    windows: "D:\\Projects"

security:
  scanSecrets: true
  allowPlaintextSecrets: false

capture:
  preserveUnknownNativeFields: true

deploy:
  backupBeforeWrite: true
  useSymlinks: false
```

MCV 自己的配置应提供 Schema 校验和版本迁移。

IDE 原生配置优先使用 IDE 自己的格式和 Schema，不在 MCV 内重新定义全部字段。

---

## 26. 本机状态数据

本机状态与私人数据仓库分离。

建议记录：

```json
{
  "deviceId": "device-unique-id",
  "defaultRepositoryId": "repository-unique-id",
  "repositoryPath": "/path/to/my-mcv",
  "lastDeployment": {
    "time": "ISO time",
    "files": {
      "/target/config.json": {
        "source": "ide/example/native/config.json",
        "hash": "sha256"
      }
    }
  },
  "lastSelection": {
    "ides": ["codex", "claude-code"],
    "capabilities": ["rules", "skills", "mcp"]
  }
}
```

这些数据不属于需要跨设备同步的个人生产力内容。

---

## 27. 技术实现建议

### 27.1 技术栈

建议使用：

- TypeScript；
- Node.js；
- 单一跨平台核心；
- Shell 和 PowerShell 仅负责安装或启动；
- JSON Schema 校验 MCV 自身配置；
- 原生解析器处理 JSON、YAML、TOML 和 Markdown。

不要分别使用 Bash 和 PowerShell 实现完整业务逻辑，以免双平台行为长期分叉。

### 27.2 模块划分

```text
packages/
├─ cli/
│  ├─ commands/
│  ├─ prompts/
│  └─ renderer/
│
├─ core/
│  ├─ repository/
│  ├─ binding/
│  ├─ capture/
│  ├─ deploy/
│  ├─ diff/
│  ├─ backup/
│  ├─ secrets/
│  ├─ variables/
│  └─ merge/
│
├─ adapters/
│  ├─ codex/
│  ├─ claude-code/
│  ├─ cursor/
│  ├─ gemini-cli/
│  └─ antigravity/
│
└─ schemas/
```

### 27.3 核心层与交互层分离

核心 API 不应直接询问用户：

```ts
scanDevice();
captureCandidates();
applyCaptureSelection();
buildDeploymentPlan();
executeDeployment();
restoreBackup();
getStatus();
```

CLI 负责将结果呈现给用户，并收集选择。

### 27.4 变更计划

部署和 Capture 内部都应先生成结构化计划：

```ts
interface ChangePlan {
  additions: Change[];
  modifications: Change[];
  deletions: Change[];
  merges: Change[];
  skipped: Change[];
  warnings: Warning[];
}
```

用户不需要看到“Plan”这一术语，但所有修改应先经过计划阶段。

### 27.5 版本迁移

数据仓库包含 `schemaVersion`。

CLI 升级后发现旧版本时：

1. 展示需要迁移的内容；
2. 自动备份；
3. 执行迁移；
4. 校验结果；
5. 失败则恢复。

---

## 28. Git 集成边界

MCV 应检测 Git 状态，但不默认控制 Git 工作流。

可提供：

- 当前目录是否为 Git 仓库；
- 是否存在未提交变化；
- 是否检测到疑似密钥；
- 是否建议用户提交。

不默认执行：

- `git add`；
- `git commit`；
- `git push`；
- 创建远程仓库；
- 修改远程地址。

未来可以提供可选 Git 辅助功能，但必须由用户明确触发。

---

## 29. IDE 支持要求

每个 IDE 支持模块至少需要声明：

- IDE 名称；
- 支持的平台；
- 检测方式；
- 全局配置目录；
- 可收集文件；
- 排除目录；
- 敏感字段规则；
- MCV 生成文件；
- Native 文件；
- Merged 文件；
- 可支持的通用能力；
- 部署后的验证方法。

示例能力声明：

```yaml
capabilities:
  globalRules: true
  skills: true
  mcp: true
  nativeConfig: true
  structuredMerge: true
```

如果某 IDE 不支持某项能力，CLI 应明确显示“不支持”，不能模拟或静默忽略。

---

## 30. 错误处理

### 30.1 仓库不可用

如果绑定路径不存在：

```text
The bound MCV repository was not found.

Previous location:
/old/path/my-mcv

Choose an action:
- Bind the current directory
- Enter a repository path
- Remove the old binding
```

### 30.2 配置格式错误

如果原生配置无法解析：

- 不覆盖原文件；
- 报告具体文件；
- 提供跳过选项；
- 允许将文件作为未知原生文件保存；
- 部署时默认跳过无效配置。

### 30.3 写入中断

必须保证：

- 原文件备份仍存在；
- 临时文件不替换有效文件；
- 状态记录标记操作失败；
- 下次执行可以重新尝试。

### 30.4 未知 IDE 版本

如果 IDE 配置位置存在，但版本未知：

- 尝试使用现有薄适配器；
- 保留未知字段；
- 提示兼容性未经验证；
- 不因未知版本拒绝纯原生文件备份。

---

## 31. 测试要求

MCV v0.1 至少覆盖以下测试。

### 31.1 核心行为

1. 相同配置重复部署结果完全一致。
2. 无变化时不重复写入和备份。
3. 部署前始终备份已有文件。
4. Capture 未确认前不修改仓库。
5. 删除项默认不被接受。
6. 未知 Native 字段在收集和部署后仍然保留。
7. MCV 管理字段不会被 Native Capture 重复导入。
8. 缺少密钥时不会写入明文或空凭据。
9. 恢复后文件与部署前一致。
10. 仓库移动后可以通过仓库 ID 重新绑定。

### 31.2 平台兼容

1. macOS 用户目录。
2. Windows 用户目录。
3. Windows 不同盘符。
4. 路径包含空格。
5. 路径包含中文。
6. 文件只读或权限不足。
7. Windows 未开启开发者模式。
8. 配置文件使用不同换行符。
9. JSON、YAML、TOML 编码和格式保留。

### 31.3 安全测试

1. API Key 不得写入仓库。
2. Token 不得出现在 Capture 候选文件中。
3. 私钥文件不得被收集。
4. 认证文件默认被排除。
5. 密钥扫描失败时应阻止危险写入。
6. 备份目录不得被误收集回仓库。

### 31.4 交互测试

1. 所有关键操作可以取消。
2. 用户可返回上一步。
3. 非交互终端中给出明确错误或要求参数。
4. 输出在常见终端宽度下可读。
5. 失败信息提供可执行的处理方式。

---

## 32. 性能要求

MCV 面向个人设备，不追求大规模并发。

基本要求：

- 普通状态检查应在可感知的短时间内完成；
- 扫描时避免读取整个 IDE 缓存目录；
- 通过白名单减少文件遍历；
- 大型 Skill 目录应流式计算哈希；
- 未变化文件不重复解析；
- 不上传任何数据到远程服务；
- 默认完全本地运行。

---

## 33. 隐私要求

MCV 默认遵循：

1. 所有扫描在本地执行。
2. 不将配置内容上传到 MCV 服务。
3. 不收集遥测，或首期直接不实现遥测。
4. 不要求用户登录 MCV 账号。
5. 不要求使用指定 Git 托管平台。
6. 不自动访问用户远程仓库。
7. 用户可以完全离线使用本地仓库。
8. 用户可以随时解除绑定并删除 CLI，而不影响数据仓库。

---

## 34. 第一版范围

### 34.1 必须完成

- macOS 和 Windows；
- 仓库当前目录初始化；
- 仓库 ID 与本机绑定；
- 绑定、重新绑定和解除绑定；
- 交互式主菜单；
- IDE 检测；
- Codex、Claude Code、Gemini (涵盖 Gemini CLI 和 Antigravity) 的配置清单；
- 通用规则管理；
- Skills 收集和部署；
- MCP 统一注册与部署；
- IDE 原生配置白名单收集；
- Capture 人工确认；
- 路径参数化；
- 密钥扫描和排除；
- 部署预览；
- 自动备份；
- 原子写入；
- 状态检查；
- 最近一次恢复；
- 哈希和漂移检测。

### 34.2 可以简化

- 只支持一个默认 MCV 仓库；
- 只恢复最近一次部署；
- JSON 优先实现字段级 Overlay；
- TOML 和 YAML 先采用预定义字段合并；
- 不提供复杂 Capture 历史；
- 不提供图形界面；
- 不自动操作 Git；
- 不提供自定义 Preset；
- 不安装 IDE；
- 不同步凭据。

---

## 35. 后续路线

### v0.2：体验和配置能力增强

- 部署 Preset；
- 多仓库切换；
- 更完整的 TOML/YAML Overlay；
- Git 辅助提交；
- 原生配置 Schema 自动校验；
- IDE 版本兼容性提示；
- 配置迁移报告；
- MCP 权限说明。

### v0.3：完整开发环境扩展

- Git 全局配置；
- Shell 配置；
- Cursor 和 VS Code 扩展；
- Node、包管理器和常用 CLI；
- Windows Terminal；
- WSL；
- Docker；
- Cloudflare 和 GitHub CLI。

### v1.0：个人生产力基础设施

- 稳定数据格式；
- 完整跨平台测试矩阵；
- 独立二进制分发；
- 可选加密 Secret Provider；
- 可选 GUI；
- 配置模块市场或共享模板；
- 更丰富的个人开发环境蓝图。

---

## 36. 验收标准

MCV v0.1 达到可发布状态，需要满足：

1. 用户可以在自选目录成功初始化数据仓库。
2. 初始化后可以在任意目录调用 MCV。
3. MCV 始终只操作已绑定仓库，除非用户显式指定其他路径。
4. 新设备可以绑定克隆后的同一仓库。
5. 至少三个目标 IDE (Codex, Claude Code, Gemini) 都能被正确检测。
6. 每个目标 IDE 至少支持原生配置收集和恢复。
7. 支持的通用规则、Skills 和 MCP 可以跨 IDE 部署。
8. Capture 不会未经确认修改仓库。
9. 部署不会未经确认覆盖本机配置。
10. 所有覆盖操作都有可恢复备份。
11. 明文密钥不会进入数据仓库。
12. 未知 IDE 原生字段不会因为 MCV 不认识而丢失。
13. macOS 与 Windows 的核心流程行为一致。
14. 仓库移动后可以重新绑定。
15. 普通用户只通过交互式菜单即可完成完整流程。

---

## 37. 最终产品定义

MCV 不是一个简单的配置备份脚本，也不是试图重建所有 AI IDE 配置协议的统一平台。

它由两部分组成：

```text
统一主权配置层
负责跨 IDE 迁移规则、Skills、MCP 和工作方式

IDE 原生配置托管层
负责忠实保存各 IDE 独有的个人设置
```

其核心产品承诺是：

> 用户可以在一台设备上收拢自己的 AI 开发生产力配置，将其存入自己掌控的私人仓库，并在任何新的 macOS 或 Windows 设备上重新展开。

MCV CLI 只是基地车的部署和回收装置。

真正属于用户的，是其中保存的个人生产力蓝图。
