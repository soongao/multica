#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = '/Users/bytedance/proj/multica/server';
const skillDir = '/Users/bytedance/.understand-anything/repo/understand-anything-plugin/skills/understand';
const uaDir = path.join(projectRoot, '.ua');
const tmpDir = path.join(uaDir, 'tmp');
const intermediateDir = path.join(uaDir, 'intermediate');

const scan = JSON.parse(fs.readFileSync(path.join(intermediateDir, 'scan-result.json'), 'utf8'));
const batches = JSON.parse(fs.readFileSync(path.join(intermediateDir, 'batches.json'), 'utf8')).batches;
const fileByPath = new Map(scan.files.map((file) => [file.path, file]));
const importMap = scan.importMap || {};

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(intermediateDir, { recursive: true });

const fileLevelTypes = new Set([
  'file',
  'config',
  'document',
  'service',
  'pipeline',
  'table',
  'schema',
  'resource',
  'endpoint',
]);

function baseName(filePath) {
  return path.basename(filePath);
}

function withoutExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

function sanitizeNodeName(name) {
  return String(name || 'unnamed')
    .replace(/\s+/g, '-')
    .replace(/[:/\\]/g, '-')
    .slice(0, 120);
}

function isTestFile(filePath) {
  return /(^|\/)(test|tests)\//.test(filePath)
    || /_test\.go$/.test(filePath)
    || /\.test\./.test(filePath)
    || /\.spec\./.test(filePath);
}

function complexity(nonEmptyLines, metrics = {}) {
  const weight = (metrics.functionCount || 0) + (metrics.classCount || 0) + (metrics.definitionCount || 0);
  if (nonEmptyLines > 220 || weight > 18) return 'complex';
  if (nonEmptyLines > 60 || weight > 5) return 'moderate';
  return 'simple';
}

function fileNodeType(file) {
  if (file.fileCategory === 'config') return 'config';
  if (file.fileCategory === 'docs') return 'document';
  if (file.fileCategory === 'infra') {
    if (/\.github\/workflows\/|\.gitlab-ci\.yml$|Jenkinsfile$|\.circleci\//.test(file.path)) return 'pipeline';
    if (/\.tf$|\.tfvars$|Vagrantfile$/.test(file.path)) return 'resource';
    return 'service';
  }
  if (file.fileCategory === 'data') {
    if (/\.(graphql|gql|proto|prisma)$/.test(file.path)) return 'schema';
    if (/(openapi|swagger).*\.(ya?ml|json)$/i.test(file.path)) return 'endpoint';
    return 'table';
  }
  return 'file';
}

function fileNodeId(file) {
  const type = fileNodeType(file);
  if (type === 'table') return `table:${file.path}:${sanitizeNodeName(withoutExt(baseName(file.path)))}`;
  if (type === 'endpoint') return `endpoint:${file.path}:${sanitizeNodeName(withoutExt(baseName(file.path)))}`;
  if (type === 'schema') return `schema:${file.path}`;
  return `${type}:${file.path}`;
}

function existingFileNodeId(filePath) {
  const file = fileByPath.get(filePath);
  return file ? fileNodeId(file) : `file:${filePath}`;
}

function tagsForFile(file) {
  const tags = new Set();
  const p = file.path;
  if (isTestFile(p)) tags.add('test');
  if (/^cmd\//.test(p)) tags.add('entry-point');
  if (/^internal\/handler\//.test(p)) tags.add('api-handler');
  if (/^internal\/middleware\//.test(p)) tags.add('middleware');
  if (/^internal\/service\//.test(p)) tags.add('service');
  if (/^internal\/daemon\//.test(p)) tags.add('daemon');
  if (/^internal\/integrations\//.test(p)) tags.add('integration');
  if (/^pkg\/db\/generated\//.test(p)) tags.add('sqlc');
  if (/^pkg\/db\//.test(p)) tags.add('data-access');
  if (/^migrations\//.test(p)) tags.add('migration');
  if (/^internal\/events\//.test(p)) tags.add('event-bus');
  if (/^internal\/scheduler\//.test(p)) tags.add('scheduler');
  if (/^internal\/util\//.test(p)) tags.add('utility');
  if (/^internal\/metrics\//.test(p)) tags.add('metrics');
  if (/^internal\/auth\//.test(p)) tags.add('auth');
  if (file.fileCategory === 'config') tags.add('configuration');
  if (file.fileCategory === 'docs') tags.add('documentation');
  if (file.fileCategory === 'data') tags.add('database');
  if (file.language) tags.add(file.language === 'mod' || file.language === 'sum' ? 'go' : file.language);
  tags.add(file.fileCategory);
  return Array.from(tags).slice(0, 5);
}

function roleForPath(filePath) {
  if (filePath === 'cmd/server/main.go') return '后端 HTTP 服务入口，负责初始化配置、依赖和服务生命周期。';
  if (filePath === 'cmd/server/router.go') return 'Chi 路由装配中心，集中注册 API 路由、中间件和 WebSocket 入口。';
  if (/^cmd\/multica\//.test(filePath)) return 'Multica CLI 命令实现，用于本地 daemon、agent 和运维操作。';
  if (/^cmd\//.test(filePath)) return '后端命令入口或一次性运维任务，封装可执行程序的启动流程。';
  if (/^internal\/handler\//.test(filePath)) return 'HTTP API handler，处理请求解析、权限校验、业务服务调用和响应转换。';
  if (/^internal\/middleware\//.test(filePath)) return 'HTTP middleware，承载认证、workspace 上下文、请求保护和跨切面处理。';
  if (/^internal\/service\//.test(filePath)) return '业务服务模块，封装 issues、agents、tasks、autopilot 等核心协作流程。';
  if (/^internal\/daemon\//.test(filePath)) return '本地 daemon 运行时模块，管理 agent 执行、连接状态和本机任务执行。';
  if (/^internal\/integrations\//.test(filePath)) return '外部集成模块，连接 Slack、Lark、GitHub、Composio 等渠道和第三方系统。';
  if (/^internal\/events\//.test(filePath)) return '事件总线模块，用于发布和订阅后端域事件。';
  if (/^internal\/scheduler\//.test(filePath)) return '调度任务模块，执行定时作业和后台维护流程。';
  if (/^internal\/auth\//.test(filePath)) return '认证与访问控制模块，处理 JWT、PAT、成员缓存和权限辅助逻辑。';
  if (/^internal\/metrics\//.test(filePath)) return '指标与观测模块，记录业务事件、Prometheus 指标和运行状态。';
  if (/^internal\/util\//.test(filePath)) return '共享工具模块，提供 UUID、文本、进程、数据库等通用辅助能力。';
  if (/^pkg\/db\/generated\//.test(filePath)) return 'sqlc 生成的数据访问代码，封装 PostgreSQL 查询、参数和结果类型。';
  if (/^pkg\/db\//.test(filePath)) return '数据库访问支持代码，连接 SQL 查询定义、生成代码和事务边界。';
  if (/^pkg\/protocol\//.test(filePath)) return '客户端与后端/daemon 之间共享的协议类型和消息定义。';
  if (/^pkg\//.test(filePath)) return '可复用后端包，向 cmd 和 internal 模块提供共享能力。';
  if (/^migrations\//.test(filePath)) return 'PostgreSQL schema migration，用于演进 Multica 后端数据库结构。';
  return '后端项目文件，参与 Multica 服务的构建、运行或维护。';
}

function summaryForFile(file, result = {}) {
  const p = file.path;
  if (file.fileCategory === 'config') {
    if (p === 'go.mod') return 'Go module 清单，声明后端模块路径、Go 版本和 Chi、pgx、OpenAI、Redis 等运行依赖。';
    if (p === 'go.sum') return 'Go module 校验文件，锁定依赖版本的完整性哈希。';
    if (p === 'sqlc.yaml') return 'sqlc 配置文件，定义 SQL 查询输入、Go 生成代码输出和 PostgreSQL 方言设置。';
    return `配置文件 ${p} 控制后端项目的构建、代码生成或运行参数。`;
  }
  if (file.fileCategory === 'docs') return `文档 ${p} 记录后端相关说明、约定或内置 skill 内容，帮助理解运行和扩展方式。`;
  if (file.fileCategory === 'data') return `${roleForPath(p)}该文件包含 ${result.totalLines || file.sizeLines || 0} 行 SQL/数据定义，用于数据库版本迁移。`;
  const role = roleForPath(p);
  const details = [];
  if (result.functions?.length) details.push(`${result.functions.length} 个函数`);
  if (result.classes?.length) details.push(`${result.classes.length} 个类型`);
  if (isTestFile(p)) details.push('测试覆盖');
  const suffix = details.length ? `结构上包含 ${details.join('、')}。` : '';
  return `${role}${suffix}`;
}

function summaryForFunction(filePath, fn) {
  if (fn.name === 'main') return `启动 ${filePath} 对应的命令入口，串联配置、依赖初始化和主执行流程。`;
  if (/^Test/.test(fn.name)) return `测试 ${filePath} 中相关后端行为，验证边界条件和回归场景。`;
  if (/^handle|Handler$|^Serve/.test(fn.name)) return `处理 ${fn.name} 对应的请求或事件流程，连接输入校验、业务调用和结果返回。`;
  if (/^load|^get|^list|^fetch/i.test(fn.name)) return `读取或组装 ${fn.name} 所需的数据，供 handler 或 service 层使用。`;
  if (/^create|^update|^delete|^insert|^ensure/i.test(fn.name)) return `执行 ${fn.name} 对应的写入或状态变更逻辑，并维护后端一致性。`;
  return `实现 ${fn.name} 逻辑，是 ${filePath} 中的主要执行单元之一。`;
}

function tagsForFunction(filePath, name) {
  const tags = new Set(['function', 'go']);
  if (isTestFile(filePath) || /^Test/.test(name)) tags.add('test');
  if (/handle|Handler|Serve/.test(name) || /^internal\/handler\//.test(filePath)) tags.add('api-handler');
  if (/load|get|list|fetch/i.test(name)) tags.add('query');
  if (/create|update|delete|insert|ensure/i.test(name)) tags.add('mutation');
  if (/auth|token|permission|access/i.test(filePath + name)) tags.add('auth');
  if (/workspace/i.test(filePath + name)) tags.add('workspace');
  if (/agent/i.test(filePath + name)) tags.add('agent');
  if (/issue/i.test(filePath + name)) tags.add('issue');
  if (/task/i.test(filePath + name)) tags.add('task');
  return Array.from(tags).slice(0, 5);
}

function summaryForClass(filePath, cls) {
  const kind = /^[A-Z]/.test(cls.name) ? '导出类型' : '内部类型';
  if (/Config|Options|Params|Request|Response|Payload|Input|Output/.test(cls.name)) {
    return `${kind} ${cls.name} 定义 ${filePath} 中请求、配置或参数传递的数据结构。`;
  }
  if (/Store|Repo|Repository|Client|Service|Manager|Handler/.test(cls.name)) {
    return `${kind} ${cls.name} 封装 ${filePath} 中的状态、依赖或服务协作边界。`;
  }
  return `${kind} ${cls.name} 表达 ${filePath} 中使用的领域数据或内部状态。`;
}

function tagsForClass(filePath, name) {
  const tags = new Set(['type-definition', 'go']);
  if (/Request|Response|Payload|Input|Output|DTO/.test(name)) tags.add('api-contract');
  if (/Config|Options|Params/.test(name)) tags.add('configuration');
  if (/Store|Repo|Repository/.test(name)) tags.add('data-access');
  if (/Service|Manager/.test(name)) tags.add('service');
  if (isTestFile(filePath)) tags.add('test');
  return Array.from(tags).slice(0, 5);
}

function addEdge(edges, source, target, type, weight) {
  if (!source || !target || source === target) return;
  edges.push({ source, target, type, direction: 'forward', weight });
}

function generateFragment(batch, extract) {
  const nodes = [];
  const edges = [];
  const batchImportData = batch.batchImportData || {};
  const resultByPath = new Map((extract.results || []).map((r) => [r.path, r]));

  for (const file of batch.files) {
    const result = resultByPath.get(file.path) || {};
    const nodeType = fileNodeType(file);
    const id = fileNodeId(file);
    nodes.push({
      id,
      type: nodeType,
      name: nodeType === 'table' ? withoutExt(baseName(file.path)) : baseName(file.path),
      filePath: file.path,
      summary: summaryForFile(file, result),
      tags: tagsForFile(file),
      complexity: complexity(result.nonEmptyLines ?? file.sizeLines ?? 0, result.metrics || {}),
      ...(file.language === 'go' ? { languageNotes: 'Go 后端代码以 package 为组织单元，通过显式错误返回和接口边界保持服务层清晰。' } : {}),
    });

    if (nodeType === 'file') {
      for (const targetPath of batchImportData[file.path] || []) {
        addEdge(edges, id, existingFileNodeId(targetPath), 'imports', 0.7);
      }
    }

    if (file.fileCategory === 'code' || file.fileCategory === 'script') {
      const functions = result.functions || [];
      const classes = result.classes || [];
      const classNames = new Set(classes.map((c) => c.name));

      for (const cls of classes) {
        const lineCount = (cls.endLine || 0) - (cls.startLine || 0) + 1;
        const exported = /^[A-Z]/.test(cls.name);
        const significant = exported || lineCount >= 20 || (cls.methods || []).length >= 2 || (cls.properties || []).length >= 4;
        if (!significant) continue;
        const classId = `class:${file.path}:${sanitizeNodeName(cls.name)}`;
        nodes.push({
          id: classId,
          type: 'class',
          name: cls.name,
          filePath: file.path,
          lineRange: [cls.startLine || 1, cls.endLine || cls.startLine || 1],
          summary: summaryForClass(file.path, cls),
          tags: tagsForClass(file.path, cls.name),
          complexity: complexity(lineCount, { classCount: 1, functionCount: (cls.methods || []).length }),
        });
        addEdge(edges, id, classId, 'contains', 1.0);
      }

      for (const fn of functions) {
        const lineCount = (fn.endLine || 0) - (fn.startLine || 0) + 1;
        const exported = /^[A-Z]/.test(fn.name);
        const isMethodName = classNames.has(fn.name);
        const significant = !isMethodName && (exported || lineCount >= 10 || fn.name === 'main' || /^Test/.test(fn.name));
        if (!significant) continue;
        const fnId = `function:${file.path}:${sanitizeNodeName(fn.name)}`;
        nodes.push({
          id: fnId,
          type: 'function',
          name: fn.name,
          filePath: file.path,
          lineRange: [fn.startLine || 1, fn.endLine || fn.startLine || 1],
          summary: summaryForFunction(file.path, fn),
          tags: tagsForFunction(file.path, fn.name),
          complexity: complexity(lineCount, { functionCount: 1 }),
        });
        addEdge(edges, id, fnId, 'contains', 1.0);
      }

      for (const call of result.callGraph || []) {
        if (!call.caller || !call.callee) continue;
        const callerId = `function:${file.path}:${sanitizeNodeName(call.caller)}`;
        const calleeName = String(call.callee).split(/[.(\s]/)[0];
        if (!calleeName || calleeName === call.caller) continue;
        const calleeId = `function:${file.path}:${sanitizeNodeName(calleeName)}`;
        if (nodes.some((n) => n.id === callerId) && nodes.some((n) => n.id === calleeId)) {
          addEdge(edges, callerId, calleeId, 'calls', 0.8);
        }
      }
    }

    if (file.fileCategory === 'config') {
      if (file.path === 'go.mod' && fileByPath.has('cmd/server/main.go')) addEdge(edges, id, existingFileNodeId('cmd/server/main.go'), 'configures', 0.6);
      if (file.path === 'sqlc.yaml' && fileByPath.has('pkg/db/generated/db.go')) addEdge(edges, id, existingFileNodeId('pkg/db/generated/db.go'), 'configures', 0.6);
    }

    if (file.fileCategory === 'docs') {
      const main = fileByPath.has('cmd/server/main.go') ? 'cmd/server/main.go' : 'go.mod';
      addEdge(edges, id, existingFileNodeId(main), 'documents', 0.5);
    }
  }

  return { nodes, edges };
}

function writeBatch(index, fragment) {
  const out = path.join(intermediateDir, `batch-${index}.json`);
  fs.writeFileSync(out, JSON.stringify(fragment, null, 2));
}

let analyzedFiles = 0;
let totalNodes = 0;
let totalEdges = 0;
const failures = [];

for (const batch of batches) {
  const index = batch.batchIndex;
  const inputPath = path.join(tmpDir, `ua-file-analyzer-input-${index}.json`);
  const extractPath = path.join(tmpDir, `ua-file-extract-results-${index}.json`);
  const input = {
    projectRoot,
    batchFiles: batch.files,
    batchImportData: batch.batchImportData || {},
  };
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

  const result = spawnSync('node', [
    path.join(skillDir, 'extract-structure.mjs'),
    inputPath,
    extractPath,
  ], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });

  if (result.status !== 0 || !fs.existsSync(extractPath)) {
    failures.push({ batchIndex: index, stderr: result.stderr || 'missing extract output' });
    writeBatch(index, generateFragment(batch, { results: [] }));
    continue;
  }

  const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
  const fragment = generateFragment(batch, extract);
  writeBatch(index, fragment);
  analyzedFiles += extract.filesAnalyzed || batch.files.length;
  totalNodes += fragment.nodes.length;
  totalEdges += fragment.edges.length;
  console.error(`batch ${index}: files=${batch.files.length} nodes=${fragment.nodes.length} edges=${fragment.edges.length}`);
}

fs.writeFileSync(path.join(tmpDir, 'backend-graph-build-summary.json'), JSON.stringify({
  analyzedFiles,
  totalNodes,
  totalEdges,
  failures,
}, null, 2));

console.log(JSON.stringify({ analyzedFiles, totalNodes, totalEdges, failures: failures.length }, null, 2));
