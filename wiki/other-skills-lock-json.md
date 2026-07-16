# Other — skills-lock.json

## skills-lock.json

`skills-lock.json` 是一个技能依赖锁定文件，用来记录仓库依赖的外部 agent skill 的来源与内容哈希。它不是运行时代码模块，不包含函数、类、导入或调用关系；当前调用图中也没有检测到内部调用、外部调用、入站调用或执行流。

### 文件结构

```json
{
  "version": 1,
  "skills": {
    "frontend-design": {
      "source": "anthropics/skills",
      "sourceType": "github",
      "computedHash": "063a0e..."
    }
  }
}
```

顶层字段：

- `version`: 锁文件格式版本。当前为 `1`。
- `skills`: 技能名称到技能元数据的映射。

每个 `skills` 条目包含：

- `source`: 技能来源仓库，例如 `anthropics/skills`、`shadcn/ui`。
- `sourceType`: 来源类型。当前所有条目均为 `github`。
- `computedHash`: 对锁定内容计算出的哈希，用于确认技能内容没有漂移。
- `skillPath`: 可选字段。当技能不位于来源仓库默认位置时，指定具体 skill 文件路径。例如 `web-design-guidelines` 使用 `skills/web-design-guidelines/SKILL.md`。

### 当前锁定的技能

`frontend-design`

来源于 `anthropics/skills`，用于锁定 `frontend-design` 技能内容。

`shadcn`

来源于 `shadcn/ui`，用于锁定与 shadcn UI 相关的技能内容。

`ui-ux-pro-max`

来源于 `nextlevelbuilder/ui-ux-pro-max-skill`，用于锁定高级 UI/UX 技能内容。

`web-design-guidelines`

来源于 `vercel-labs/agent-skills`，并通过 `skillPath` 指向 `skills/web-design-guidelines/SKILL.md`。这是当前文件中唯一显式声明技能路径的条目。

### 工作方式

该文件的核心作用是把“技能名称”固定到“来源 + 内容哈希”的组合上。工具在安装、同步或校验技能时，可以用 `source` 和 `skillPath` 定位技能内容，再用 `computedHash` 判断本地或远端内容是否与锁文件记录一致。

典型解析逻辑是：

1. 读取 `version`，确认锁文件格式兼容。
2. 遍历 `skills` 对象。
3. 对每个技能读取 `sourceType` 和 `source`，确定获取方式。
4. 如果存在 `skillPath`，使用该路径定位具体 `SKILL.md`。
5. 使用 `computedHash` 校验解析到的内容是否匹配锁定版本。

### 与代码库的关系

`skills-lock.json` 不参与 Go 后端、Next.js 前端、Electron 桌面端或共享 TypeScript 包的运行时执行。它更接近工具链元数据，用于约束仓库级 agent skill 依赖的可重复性。

由于调用图没有检测到任何执行流，这个文件不会直接影响应用功能、React Query 状态管理、Zustand store、API client 或服务端路由。它的影响面主要在开发工具、自动化代理、技能安装与技能一致性校验流程中。

### 维护注意事项

修改技能来源时，应同步更新对应条目的 `source`、`sourceType`、可选 `skillPath` 和 `computedHash`。

如果只更新了远端技能内容，但没有更新 `computedHash`，后续校验可能会认为技能内容不一致。

新增技能时，应在 `skills` 下使用稳定的技能名称作为 key，并提供至少以下字段：

```json
{
  "source": "owner/repository",
  "sourceType": "github",
  "computedHash": "内容哈希"
}
```

只有当技能文件不在默认位置时，才需要添加 `skillPath`。