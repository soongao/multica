# Other — e2e

## 端到端测试模块

`e2e/` 是 Multica 的 Playwright 端到端测试套件。它覆盖真实后端登录、工作区路由、问题列表与详情、评论、设置页、Composio 集成、Agent MCP 权限入口、Onboarding V2，以及聊天附件的后端持久化契约。

这个模块的核心设计是：尽量通过真实后端 API 建立登录态和基础数据，只在外部服务或不可稳定复现的边界处做网络 mock。例如 Composio 连接、Agent 列表和 MCP allowlist 写入会用 `page.route()` 拦截；而认证、工作区、问题创建、评论提交等流程走真实服务。

```mermaid
flowchart TD
  A["测试用例"] --> B["loginAsDefault(page) 或 createTestApi()"]
  B --> C["TestApiClient.login(email, name)"]
  C --> D["调用 /auth/send-code"]
  D --> E["读取 verification_code"]
  E --> F["调用 /auth/verify-code"]
  F --> G["ensureWorkspace() + markUserOnboarded()"]
  G --> H["写入 localStorage.multica_token"]
  H --> I["访问 /{slug}/... 并断言界面"]
```

## 运行环境与配置

`e2e/env.ts` 会按顺序加载 `.env.worktree` 和 `.env`，找到第一个存在的文件后调用 `dotenv.config()`。多数测试依赖以下环境变量：

- `NEXT_PUBLIC_API_URL`：API 基址；为空字符串时会回退到 `http://localhost:${PORT || "8080"}`。
- `PORT`：默认 API 端口的回退值。
- `DATABASE_URL`：PostgreSQL 连接串；默认是 `postgres://multica:multica@localhost:5432/multica?sslmode=disable`。
- `MULTICA_DEV_VERIFICATION_CODE`：如果设置，`TestApiClient.login()` 会用该固定验证码代替数据库中的验证码。
- `TEST_PARALLEL_INDEX` / `TEST_WORKER_INDEX` / `E2E_RUN_ID`：用于生成隔离的测试邮箱和工作区 slug，降低并行测试之间的数据冲突。

## 测试数据客户端

`e2e/fixtures.ts` 定义了 `TestApiClient`，它是整个 E2E 模块的数据准备与清理入口。它只使用 `fetch` 和 `pg`，避免在测试层直接依赖 Web 应用的构建产物。

主要方法：

- `login(email, name)`：执行真实邮箱验证码登录流程。它会删除旧的 `verification_code`，调用 `/auth/send-code`，从数据库读取最新未使用验证码，再调用 `/auth/verify-code` 获取 JWT。登录后会保存 `token` 和 `email`，必要时通过 `PATCH /api/me` 更新用户名称。
- `getWorkspaces()`：调用 `/api/workspaces` 获取当前用户工作区。
- `ensureWorkspace(name, slug)`：优先复用指定 slug 的工作区；如果不存在但用户已有工作区，会复用第一个工作区；否则调用 `POST /api/workspaces` 创建。
- `markUserOnboarded()`：直接更新 `"user"` 表的 `onboarded_at` 和 `onboarding_questionnaire`，让测试用户跳过 onboarding。
- `createIssue(title, opts)`：调用 `POST /api/issues` 创建问题，并记录创建的 issue id。
- `deleteIssue(id)` 与 `cleanup()`：删除由当前 `TestApiClient` 创建并记录的问题。
- `setWorkspaceSlug(slug)` / `setWorkspaceId(id)`：控制后续私有 `authedFetch()` 附带 `X-Workspace-Slug` 或 `X-Workspace-ID`。
- `getToken()` / `getEmail()`：暴露当前登录态信息。

`TestApiClient.cleanup()` 只清理 `createdIssueIds` 中的问题。通过 SQL 手动插入的 `agent_runtime`、`agent`、`chat_session`、`attachment` 等数据，需要在对应 spec 的 `afterEach` 中自行删除。

## Playwright 辅助函数

`e2e/helpers.ts` 封装了最常见的浏览器侧测试流程：

- `waitForPageText(page, text, timeout)`：通过 `page.waitForFunction()` 等待 `document.body.innerText` 包含指定文本。它常用于等待 Next.js 页面完成客户端渲染。
- `reloadAppPage(page)`：刷新当前页面，等待 `"Issues"` 出现。
- `loginAsDefault(page)`：使用默认 E2E 用户登录，确保工作区存在，标记用户已 onboarding，然后通过 `page.addInitScript()` 写入 `localStorage.multica_token` 和 `multica:chat:isOpen = "false"`，最后进入 `/{workspace.slug}/issues`。
- `createTestApi()`：返回已登录、已确保工作区、已 onboarding 的 `TestApiClient`，但不会修改浏览器页面登录态。
- `preferManualCreateMode(page)`：写入 `multica_create_mode`，把问题创建模式切到 manual，然后刷新页面。
- `openWorkspaceMenu(page)`：点击侧边栏工作区切换按钮，并等待 popover 出现。

常见模式是：需要操作 UI 时用 `loginAsDefault(page)`；需要先造数据或后续清理时保留一个 `TestApiClient` 实例。

```ts
test("示例：创建数据后验证页面", async ({ page }) => {
  const api = await createTestApi();
  try {
    const issue = await api.createIssue("E2E 示例 " + Date.now());
    const workspaceSlug = await loginAsDefault(page);

    await page.goto(`/${workspaceSlug}/issues/${issue.id}`, {
      waitUntil: "domcontentloaded",
    });
    await waitForPageText(page, issue.title);
  } finally {
    await api.cleanup();
  }
});
```

## 规格文件覆盖范围

`auth.spec.ts` 覆盖认证入口：登录页渲染、默认用户登录后跳转到 `/{slug}/issues`、未认证访问工作区问题页时跳回 `/login`，以及通过工作区菜单执行 logout 后回到登录页。

`navigation.spec.ts` 验证侧边栏路由：`Inbox`、`Agents`、`Issues`、`Settings` 都应能通过可访问角色定位器进入对应页面，并显示关键标题或 tab。它依赖 `loginAsDefault(page)` 建立浏览器登录态。

`issues.spec.ts` 覆盖问题列表和创建流程：看板列渲染、Board/List 切换、按创建时间和更新时间过滤、选择自定义日期、手动创建问题、进入问题详情页、按 Escape 关闭创建表单。`setIssueTimestamps()` 会直接更新 `issue.created_at` 和 `issue.updated_at`，用于构造日期过滤场景。

`comments.spec.ts` 验证问题详情页评论能力。它先用 `createIssue()` 建立问题，再进入详情页。评论框采用 readonly-first 模式，测试会先点击 `comment-composer-shell`，再定位 ProseMirror 编辑器输入内容，并用 `ControlOrMeta+Enter` 提交。另一个用例验证空评论状态下带 `lucide-arrow-up` 图标的提交按钮保持 disabled。

`settings.spec.ts` 覆盖两类设置页行为。第一个用例修改工作区名称并断言侧边栏立即更新，随后恢复原名以减少对其他测试的影响。第二个用例通过 `page.route()` mock Composio toolkit、connections 和 connect init 接口，模拟 `/settings?tab=integrations&connected=notion` 回调，验证成功 toast、连接列表刷新，以及 `connected=notion` 查询参数被移除。

`agent-mcp.spec.ts` 验证 Agent 详情页的 creator-only MCP Apps tab。`loginCapturingUser(page)` 会登录真实用户并返回 `userId`，使测试能构造 owner 为当前用户或其他用户的 mock agent。`mockApis(page, ownerId)` mock Composio toolkit/catalog、active connections、`GET /api/agents` 和 `PUT /api/agents/{AGENT_ID}`；PUT 请求会捕获 `composio_toolkit_allowlist`，用于断言点击 “Allow Notion for this agent” 后写出的 body 精确等于 `["notion"]`。

`chat-attachments.spec.ts` 是偏后端契约的 E2E 测试，不依赖真实 agent runtime。它通过 SQL 创建 `agent_runtime`、`agent` 和 `chat_session`，再调用 `/api/upload-file` 上传带 `chat_session_id` 的 PNG，随后调用 `/api/chat/sessions/{sessionId}/messages` 发送引用附件的消息。最后直接查询 `attachment.chat_message_id`，确认发送消息后附件行被回填到新消息 id。

`onboarding-v2-smoke.spec.ts` 是 Onboarding V2 冒烟测试。它使用新邮箱创建未 onboarding 用户，验证 welcome、source、role、use_case、workspace 步骤；同时覆盖连续 skip 三个问题的路径，以及设置 `multica-locale=zh-Hans` 后中文文案渲染。该文件会把截图写到 `/tmp/onboarding-v2-shots`。

## Mock 与真实边界

这个模块的默认策略是保持登录、工作区和核心业务 API 真实可用，mock 掉外部依赖或不稳定依赖：

- Composio：`/api/integrations/composio/toolkits`、`/connections`、`/connect/init` 在设置页和 MCP 测试中被 mock。
- Agent 列表与更新：`agent-mcp.spec.ts` 用 `page.route("**/api/agents**")` 同时处理 `GET /api/agents` 和 `PUT /api/agents/{AGENT_ID}`，其他子路由通过 `route.fallback()` 放行。
- 聊天附件：不 mock HTTP API，而是通过 SQL 直接构造所需 runtime、agent 和 session，最后用数据库断言持久化结果。

新增测试时，优先复用 `TestApiClient` 和 `helpers.ts` 中的登录、等待、清理函数。只有当依赖外部服务、后台 runtime 或难以稳定控制的数据状态时，才在 `page.route()` 或 SQL 层建立测试边界。