# Other — docs

# Other — docs

`docs/` 模块不是运行时代码路径，而是项目的工程决策、产品文档规划、设计规范和运维 runbook 集合。Call graph 中没有入边、出边或执行流，说明这些文件不会被服务端、daemon、CLI 或前端直接调用；它们通过“约束开发行为”和“沉淀排障知识”连接到代码库。

## 模块职责

`docs/` 当前覆盖五类内容：

| 文件 | 作用 |
|---|---|
| `docs/agent-quick-create-plan.md` | Agent 快速创建的三阶段产品与架构设计：Template、Skill Finder、AI Create Agent。 |
| `docs/analytics.md` | 产品分析事件、Prometheus 指标、PostHog 退役历史和治理规则。 |
| `docs/codex-sandbox-troubleshooting.md` | macOS Codex Seatbelt 网络沙盒问题的排障说明和 daemon 配置策略。 |
| `docs/codex-usage-cache-backfill.md` | Codex usage cache 历史数据修复的一次性运维 runbook。 |
| `docs/custom-runtimes.md` | 自定义 runtime profile 的命令解析、启动方式和升级顺序说明。 |
| `docs/design.md` | Multica UI 设计系统：颜色、字体、间距、状态、图标、组件约束。 |
| `docs/docs-outline.md` | 对外 docs 站 v1 执行大纲和协作 tracker。 |
| `docs/docs-rewrite-plan.md` | docs 站重写的信息架构、读者画像和长期规划。 |

## 和代码库的关系

这些文档不是孤立说明，而是围绕真实代码结构写的维护层。

`docs/agent-quick-create-plan.md` 直接引用 Agent、Skill、Task、Daemon 的现有代码路径。它把 Phase 2/3 设计建立在现有 Quick-create Issue 模式上：`QuickCreateIssue` 入队任务，`EnqueueQuickCreateTask` 写入 `agent_task_queue.context`，daemon 通过 `buildQuickCreatePrompt` 组装 prompt，任务完成后用 `LinkTaskToIssue` 和 inbox 通知闭环。文档还明确要求复用 `detectImportSource`、`fetchFromSkillsSh`、`fetchFromGitHub`、`fetchFromClawHub` 等 skill import 代码，而不是引入新的 LLM 调用链路。

`docs/analytics.md` 是 analytics 与 metrics 的契约文件。它记录 `analytics.IsMetricsOnly` 如何让服务端事件只进入 Prometheus，不再发送到 PostHog；`metrics.RecordEvent`、`BusinessMetrics.RecordTask*`、`NormalizeSignupSource` 等名称在文档中作为代码事实被引用。新增或修改事件时，文档要求先更新这里，再同步 `server/internal/analytics/events.go`。

`docs/codex-sandbox-troubleshooting.md` 对应 daemon 写 Codex 配置的实现，核心文件是 `server/internal/daemon/execenv/codex_sandbox.go`。文档明确 `CodexDarwinNetworkAccessFixedVersion` 当前为空，表示 macOS 上没有已知修复版本；daemon 会在旧版或未知版本 Codex 上写入 `sandbox_mode = "danger-full-access"`，以绕过 Seatbelt 对 DNS 的拦截。

`docs/codex-usage-cache-backfill.md` 是只读迁移之外的人工修复流程。它要求通过已发布镜像运行 `backfill_codex_usage_cache`，先 dry-run，再显式加 `--execute`。这个 runbook 的关键约束是：不要把该修复写成自动 migration，因为 cutoff、审阅和执行都需要操作员判断。

`docs/custom-runtimes.md` 说明自定义 runtime profile 如何被 daemon 启动。文档中的关键模式是把用户输入拆成 `command_name` 和 `fixed_args`，最终由 `exec.Command(command_name, fixed_args...)` 直接启动，不经过 shell。因此它明确不支持管道、重定向、`;`、`&&`、变量展开或命令替换。

`docs/design.md` 约束前端实现风格。它要求使用 `packages/ui/styles/tokens.css` 中的 token，避免硬编码 Tailwind 色值；交互状态必须区分 hover、active、focus、disabled；图标统一使用 `lucide-react`。这份文档对 `packages/ui`、`packages/views` 和 app 层 UI 代码有实际约束意义。

`docs/docs-outline.md` 与 `docs/docs-rewrite-plan.md` 是 docs 站规划层。两者都强调“源码优先”：文档里的功能描述必须能在 handler、query、migration、CLI 或前端组件中找到依据。`docs-outline.md` 更偏执行 tracker，按 v1 页面列出 owner、状态、源码入口和写作边界；`docs-rewrite-plan.md` 更偏长期 IA 和定位。

## 主要主题

### Agent 快速创建设计

`agent-quick-create-plan.md` 把 Agent 创建降低为三个阶段：

1. Template：静态 JSON 模板预填 instructions，并导入模板引用的 skill。
2. Skill Finder：用户描述需求，由现有 agent 通过 quick-create 模式推荐 skill。
3. AI Create Agent：agent 自己选择 skill、写 instructions、调用 CLI 创建 agent。

设计的关键点是复用现有任务执行基础设施，不在 server 侧新增 LLM SDK、SSE 或新的 WebSocket channel。文档中提到的 `createSkillWithFilesInTx` 是计划重构目标，用来解决现有 `createSkillWithFiles` 自行 `Begin()` / `Commit()`、无法组合进外层事务的问题。

### 产品分析与指标治理

`analytics.md` 记录了 PostHog 从产品分析链路中退役后的状态：

- 服务端产品事件保留 `analytics.Event` 构造，但通过 `analytics.IsMetricsOnly` 只进入 Prometheus。
- 前端 funnel 事件大多移除。
- PostHog 仅保留 `$exception`、`client_crash`、`client_unresponsive` 这类没有数据库等价物的错误与稳定性信号。
- 数据库仍是产品事实源，Prometheus/Grafana 是运行指标源。

这份文档也是事件治理入口：新增、重命名或删除事件前，必须先改文档，再改 `server/internal/analytics/events.go`。

### Codex 运维知识

Codex 相关两份文档分别处理“执行环境故障”和“历史数据修复”。

`sandbox troubleshooting` 解释 macOS `workspace-write` 模式下 DNS 被 Seatbelt 拦截时，为什么 Go 会报 `dial tcp: lookup HOST: no such host`。daemon 的当前策略是写入带 marker 的 multica-managed TOML block，并在 macOS 旧版 Codex 上回退到 `danger-full-access`。

`usage cache backfill` 则说明如何修复旧 Codex usage 行中 cached input 被重复计入 `input_tokens` 的问题。命令只处理满足 `provider = 'codex'`、`cache_read_tokens > 0`、`input_tokens > 0`、`updated_at/created_at < --cutoff` 的行。

### 自定义 Runtime

`custom-runtimes.md` 定义 custom runtime profile 的用户输入边界。它支持 argv 风格命令、引号和反斜杠转义，但不支持 shell 语义。这个限制直接来自 daemon 启动进程的方式：`exec.Command(command_name, fixed_args...)` 不会经过 shell。

文档还说明桌面环境下 `PATH` 可能不同于交互式 shell，因此提供 `multica runtime profile set-path <profile-id> --path /abs/path/to/agent` 作为修复路径。

### UI 设计系统

`design.md` 是前端 UI 的硬约束文档。它定义：

- surface 层级：`app-shell`、`page-canvas`、`surface`、`surface-raised`
- 字号纪律：只用 `text-xs`、`text-sm`、`text-base` 和 shadcn 小按钮专用 `text-[0.8rem]`
- 字重纪律：只用 `font-normal` 和 `font-medium`
- hover / active / focus / disabled / invalid 的状态表达
- 图标库：统一 `lucide-react`
- 组件规范：shadcn 优先，dropdown/popover 使用 `w-auto`
- 反模式：硬编码颜色、任意像素、`font-bold`、大字号、装饰性 gradient、hover scale 等

这份文档应在修改 `packages/ui`、`packages/views`、`apps/web`、`apps/desktop` 的可视界面前阅读。

## 维护原则

`docs/` 模块的共同原则是：文档必须跟源码同步，不能替代码“许愿”。

新增文档时，应优先引用真实代码名、文件路径、命令名和配置项。例如可以写 `QuickCreateIssue`、`buildQuickCreatePrompt`、`CodexDarwinNetworkAccessFixedVersion`、`BusinessMetrics.RecordTaskTerminal`，但不要创造不存在的 API 名称。

修改既有文档时，要区分三种内容：

- 当前行为：必须能在代码中验证。
- 设计计划：必须标明状态，例如 draft、未动工、phase。
- 历史说明：可以保留，但要明确它已经退役或仅作参考。

如果代码行为已经变化，优先更新文档中的事实描述和引用位置；如果文档是规划文件，则保留决策背景，但要补充新状态，避免后续实现者误把旧计划当成当前系统行为。