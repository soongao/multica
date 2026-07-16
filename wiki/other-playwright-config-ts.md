# Other — playwright.config.ts

## 模块概览

`playwright.config.ts` 是仓库的 Playwright 端到端测试配置文件。它通过 `@playwright/test` 的 `defineConfig()` 导出测试运行器配置，指定测试目录、浏览器项目、超时策略、并发策略以及测试访问的前端地址。

该模块本身不定义函数、类或业务逻辑；它在 Playwright 启动时被加载，用于控制 `e2e/` 目录下测试的运行环境。

## 加载顺序

```ts
import "./e2e/env";
import { defineConfig } from "@playwright/test";
```

`./e2e/env` 会在配置对象创建前执行。这个导入通常用于初始化端到端测试所需的环境变量或本地测试环境约定。由于它是副作用导入，调用方不需要接收导出值。

随后模块从 `@playwright/test` 导入 `defineConfig()`，并用它包装配置对象：

```ts
export default defineConfig({
  // Playwright 配置
});
```

`defineConfig()` 的作用是让配置获得 Playwright 的类型检查和结构校验。

## 核心配置

### 测试目录

```ts
testDir: "./e2e",
```

Playwright 只会从 `e2e/` 目录发现和运行测试文件。这将端到端测试与单元测试、组件测试和应用代码隔离。

### 超时策略

```ts
timeout: 60000,
```

每个测试的默认超时时间为 60 秒。适合包含页面加载、网络请求、WebSocket 初始化或后端状态准备的端到端测试。

### 并发策略

```ts
workers: 1,
```

测试以单 worker 串行运行。这降低了共享后端、数据库、端口或用户状态之间互相干扰的风险。代价是测试速度较慢，但结果更稳定。

### 重试策略

```ts
retries: 0,
```

失败的测试不会自动重试。这个设置有助于尽早暴露不稳定测试或真实回归，避免重试掩盖问题。

## 浏览器与运行环境

```ts
use: {
  baseURL: process.env.PLAYWRIGHT_BASE_URL ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  headless: true,
},
```

所有测试默认使用同一组运行参数。

`baseURL` 的解析顺序是：

1. `PLAYWRIGHT_BASE_URL`
2. `FRONTEND_ORIGIN`
3. `http://localhost:3000`

这允许同一套测试在本地开发、CI、预览环境或自定义前端地址上运行。测试代码中可以使用相对路径，例如：

```ts
await page.goto("/issues");
```

实际访问地址会由 `baseURL` 补全。

`headless: true` 表示浏览器以无界面模式运行，适合 CI 和自动化测试环境。

## 项目配置

```ts
projects: [
  {
    name: "chromium",
    use: { browserName: "chromium" },
  },
],
```

当前只配置了一个 Playwright project：`chromium`。因此所有端到端测试只在 Chromium 浏览器中运行。

如果未来需要覆盖 Firefox 或 WebKit，应在 `projects` 中新增项目，而不是修改测试代码本身。

## 服务启动约定

```ts
// Don't auto-start servers — they must be running already
// This avoids complexity and port conflicts during testing
```

该配置没有使用 Playwright 的 `webServer` 自动启动服务能力。运行测试前，前端和后端服务必须已经启动。

这个约定简化了 Playwright 配置，避免测试运行器在本地或 CI 中重复启动服务、抢占端口或与 `make dev`、`pnpm`、Turborepo 等已有启动流程冲突。

## 与代码库的关系

该模块连接的是测试基础设施，而不是业务执行流：

```mermaid
flowchart LR
  A["环境变量"] --> B["e2e/env"]
  B --> C["playwright.config.ts"]
  C --> D["Playwright 测试运行器"]
  D --> E["e2e/ 测试"]
  E --> F["已运行的前端服务"]
```

业务代码不会直接调用 `playwright.config.ts`。它的入口来自 Playwright CLI 或测试脚本。配置加载完成后，`e2e/` 下的测试会基于这里定义的 `baseURL`、浏览器和运行策略执行。

## 修改注意事项

修改该文件时应重点确认以下影响：

- 改动 `testDir` 会影响 Playwright 能发现哪些测试文件。
- 改动 `baseURL` 解析顺序会影响本地、CI 和预览环境测试入口。
- 增加 `workers` 可能暴露共享状态冲突，需要确保测试数据和后端状态隔离。
- 开启 `retries` 可能降低失败信号的清晰度。
- 添加 `webServer` 会改变当前“服务需预先启动”的约定，可能与现有开发命令或 CI 流程冲突。
- 增加浏览器项目会扩大测试矩阵，也会增加运行时间和浏览器兼容维护成本。