# OpenClaw 记忆插件开发指南

本文档以一个经过测试、可运行的 LanceDB 记忆插件为蓝本，面向从未编写过 OpenClaw 插件的开发者，详细讲解插件的目录结构、配置文件、入口函数、各种注册 API 的用法及完整示例。

> **重要提示**：文档中所有示例代码均来自已通过测试的真实插件代码，请勿自行修改 `api.registerXXX` 相关的参数、变量名或结构。

---

## 目录

1. [插件目录结构](#1-插件目录结构)
2. [package.json 配置](#2-packagejson-配置)
3. [openclaw.plugin.json 插件清单](#3-openclawpluginjson-插件清单)
4. [types.d.ts 类型声明（可选）](#4-typesdts-类型声明可选)
5. [入口文件 index.ts](#5-入口文件-indexts)
6. [api 对象详解](#6-api-对象详解)
7. [注册 API 一览](#7-注册-api-一览)
   - 7.1 [api.registerTool — 注册 AI 工具](#71-apiregistertool--注册-ai-工具)
   - 7.2 [api.on("before_prompt_build") — 事件钩子（上下文注入）](#72-apionbefore_prompt_build--事件钩子上下文注入)
   - 7.3 [api.registerHook — 命令钩子](#73-apiregisterhook--命令钩子)
   - 7.4 [api.registerCommand — 斜杠命令](#74-apiregistercommand--斜杠命令)
   - 7.5 [api.registerCli — CLI 命令](#75-apiregistercli--cli-命令)
   - 7.6 [api.registerService — 后台服务](#76-apiregisterservice--后台服务)
8. [插件配置的读取方式](#8-插件配置的读取方式)
9. [完整示例：LanceDB 记忆插件](#9-完整示例lancedb-记忆插件)
10. [常见问题](#10-常见问题)

---

## 1. 插件目录结构

一个最小的 OpenClaw 插件目录如下：

```
my-plugin/
├── index.ts                  # 插件入口文件（必须）
├── openclaw.plugin.json      # 插件清单文件（必须）
├── package.json              # npm 包配置（必须）
└── types.d.ts                # 第三方库的类型声明（可选）
```

| 文件 | 作用 |
|------|------|
| `index.ts` | 插件的主入口，导出默认函数，接收 `api` 对象 |
| `openclaw.plugin.json` | 声明插件的 id、名称、版本、描述以及可接受的配置项 schema |
| `package.json` | 标准 npm 配置，额外需要 `openclaw.extensions` 字段指向入口文件 |
| `types.d.ts` | 如果使用了没有自带类型的第三方库，可在此补充声明 |

---

## 2. package.json 配置

```json
{
  "name": "test-plugin",
  "version": "0.1.0",
  "private": true,
  "description": "OpenClaw plugin 测试代码",
  "dependencies": {
    "@lancedb/lancedb": "^0.22.1"
  },
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `name` | 插件包名，建议与 `openclaw.plugin.json` 中的 `id` 保持一致 |
| `private` | 设为 `true` 防止意外发布到 npm |
| `dependencies` | 插件依赖的第三方库，安装时执行 `npm install` 即可 |
| **`openclaw.extensions`** | **核心字段**，数组形式，指定插件入口文件的相对路径。OpenClaw 会按这里声明的文件加载插件 |

---

## 3. openclaw.plugin.json 插件清单

```json
{
  "id": "test-plugin",
  "name": "test-plugin",
  "description": "OpenClaw plugin 测试代码",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "lanceDbPath": {
        "type": "string"
      },
      "tableName": {
        "type": "string"
      },
      "ftsColumns": {
        "type": "array",
        "items": { "type": "string" }
      },
      "selectColumns": {
        "type": "array",
        "items": { "type": "string" }
      },
      "resultLimit": {
        "type": "integer",
        "minimum": 1
      },
      "minPromptLength": {
        "type": "integer",
        "minimum": 1
      },
      "maxFieldLength": {
        "type": "integer",
        "minimum": 20
      },
      "embedBaseUrl": {
        "type": "string",
        "description": "Embedding 服务的 base URL，例如 https://api.openai.com/v1"
      },
      "embedModel": {
        "type": "string",
        "description": "Embedding 模型名称，例如 text-embedding-3-small"
      },
      "embedApiKey": {
        "type": "string",
        "description": "Embedding 服务的 API Key"
      },
      "rerankBaseUrl": {
        "type": "string",
        "description": "Rerank 服务的 base URL，例如 https://api.cohere.com/v1"
      },
      "rerankModel": {
        "type": "string",
        "description": "Rerank 模型名称，例如 rerank-multilingual-v3.0"
      },
      "rerankApiKey": {
        "type": "string",
        "description": "Rerank 服务的 API Key"
      },
      "topK": {
        "type": "integer",
        "minimum": 1,
        "description": "Rerank 前从向量库召回的候选数量，默认 10"
      }
    },
    "required": ["lanceDbPath", "tableName"]
  }
}
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `id` | 插件的唯一标识符，在配置读取时会作为 key 使用（详见[第 8 节](#8-插件配置的读取方式)） |
| `name` | 插件的显示名称 |
| `description` | 插件的简短描述 |
| `version` | 语义化版本号 |
| `configSchema` | **JSON Schema 格式**，声明插件可以接受哪些配置项。用户在 OpenClaw 的配置中为该插件提供的配置会按此 schema 校验 |

#### configSchema 编写要点

- 使用标准 JSON Schema（`type`、`properties`、`required`、`minimum` 等）
- 建议设置 `"additionalProperties": false` 防止拼写错误的配置项被静默接受
- `required` 数组中列出必填配置项
- 可为每个属性添加 `description` 以提供提示信息

---

## 4. types.d.ts 类型声明（可选）

如果你的插件依赖了没有自带 TypeScript 类型的第三方库，可以在 `types.d.ts` 中手动声明模块类型。例如本插件为 `@lancedb/lancedb` 提供了类型声明：

```typescript
declare module "@lancedb/lancedb" {
  export type LanceDbRow = Record<string, unknown>;

  export type LanceDbIndexConfig = {
    config?: {
      inner?: unknown;
    };
    replace?: boolean;
  };

  export type LanceDbTable = {
    search(
      query: string | number[] | Float32Array,
      queryType?: string,
      ftsColumns?: string[],
    ): {
      limit(limit: number): {
        toArray(): Promise<LanceDbRow[]>;
      };
    };
    add(data: LanceDbRow[]): Promise<unknown>;
    createIndex(column: string, options?: LanceDbIndexConfig): Promise<void>;
  };

  export class Index {
    static fts(): Index;
  }

  export function connect(uri: string): Promise<{
    tableNames(): Promise<string[]>;
    openTable(name: string): Promise<LanceDbTable>;
    createTable(name: string, data: LanceDbRow[]): Promise<LanceDbTable>;
  }>;
}
```

> 如果你使用的库已有 `@types/xxx` 包或内置类型，则不需要此文件。

---

## 5. 入口文件 index.ts

插件入口文件必须 **默认导出一个函数（`export default function`）**，该函数接收唯一参数 `api`。OpenClaw 在加载插件时会调用此函数，你需要在函数体内完成所有注册操作。

### 最小骨架

```typescript
export default function (api: any) {
  // 在这里调用 api.registerXXX / api.on 等方法注册插件功能
}
```

### 注意事项

- 函数是**同步**的，但注册的处理器（handler、execute 等）可以是 `async` 的
- 所有注册操作都必须在此函数体内完成，不能延迟注册
- `api` 参数目前没有独立的类型包，使用 `any` 即可

---

## 6. api 对象详解

`api` 是插件与 OpenClaw 宿主通信的唯一桥梁。以下是已知的属性和方法：

### 6.1 api.config — 获取插件配置

插件配置存储在 OpenClaw 的全局配置中，路径为：

```
api.config.plugins.entries.<PLUGIN_ID>.config
```

例如，对于 `id` 为 `"test-plugin"` 的插件：

```typescript
const PLUGIN_ID = "test-plugin";

function getPluginConfig(api: any): PluginConfig {
    return api.config?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
}
```

这里使用了可选链 `?.` 和空值合并 `??` 来安全地获取配置并在缺失时返回空对象。

### 6.2 api.logger — 日志输出

`api.logger` 提供标准日志方法，日志会输出到 OpenClaw 的日志系统中：

```typescript
api.logger.info("这是一条信息日志");
api.logger.warn("这是一条警告日志");
```

### 6.3 注册方法总览

| 方法 | 作用 |
|------|------|
| `api.registerTool(options)` | 注册一个可被 AI 调用的工具 |
| `api.on(eventName, handler)` | 监听 OpenClaw 事件 |
| `api.registerHook(hookName, handler, meta)` | 为已有命令注册前置/后置钩子 |
| `api.registerCommand(options)` | 注册自定义斜杠命令 |
| `api.registerCli(factory, meta)` | 注册 CLI 命令 |
| `api.registerService(options)` | 注册后台服务 |

---

## 7. 注册 API 一览

### 7.1 api.registerTool — 注册 AI 工具

注册一个 AI 可以在对话中主动调用的工具（类似 MCP Tools / Function Calling）。

#### 函数签名

```typescript
api.registerTool({
    name: string,
    description: string,
    parameters: JSONSchema,
    execute: (_id: string, params: object) => Promise<ToolResult>
})
```

#### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 工具名称，AI 通过此名称识别和调用工具 |
| `description` | `string` | 工具的描述，AI 据此判断何时使用该工具 |
| `parameters` | `object` | JSON Schema 格式的参数定义，描述工具接受的输入参数 |
| `execute` | `function` | 异步执行函数，接收 `_id`（调用标识）和 `params`（解析后的参数对象） |

#### execute 返回值格式

```typescript
{
    content: [
        { type: "text", text: "返回的文本内容" }
    ]
}
```

`content` 是数组，每个元素包含 `type` 和 `text` 字段。`type` 目前使用 `"text"`。

#### 完整示例

```typescript
api.registerTool({
    name: "get_weather",
    description: "测试获取天气",
    parameters: {
        type: "object",
        properties: {
            city: { type: "string" }
        }
    },
    async execute(_id: string, params: { city?: string }) {
        const { city } = params;
        return { content: [{ type: "text", text: `这是 ${city} 的天气：晴天，25度。` }] };
    }
});
```

---

### 7.2 api.on("before_prompt_build") — 事件钩子（上下文注入）

监听 `before_prompt_build` 事件，在每次用户提问时将检索到的上下文自动注入到 prompt 前面。**这是记忆插件的核心机制**。

#### 函数签名

```typescript
api.on(
    "before_prompt_build",
    async (event: { prompt: string }, ctx: { trigger?: string }) => {
        // 返回 undefined 表示不注入
        // 返回 { prependContext: string } 表示在 prompt 前追加内容
    }
)
```

#### 参数说明

| 参数 | 说明 |
|------|------|
| `event.prompt` | 用户本次输入的原始 prompt 文本 |
| `ctx.trigger` | 触发来源，值为 `"user"` 表示用户主动输入。可用来过滤非用户触发的场景 |

#### 返回值

| 返回值 | 说明 |
|--------|------|
| `undefined`（或不返回） | 不对 prompt 做任何修改 |
| `{ prependContext: string }` | 将指定字符串作为上下文追加到 prompt 之前 |

#### 完整示例

```typescript
api.on("before_prompt_build", async (event: { prompt: string }, ctx: { trigger?: string }) => {
    // 仅在用户主动输入时触发检索
    if (ctx?.trigger && ctx.trigger !== "user") {
        return;
    }

    const retrievedContext = await queryLanceDb(api, event.prompt);
    if (!retrievedContext) {
        return;
    }

    return {
        prependContext: retrievedContext,
    };
});
```

在这个示例中，`queryLanceDb` 函数根据用户的 prompt 在 LanceDB 中执行全文搜索或向量搜索，返回格式化后的检索结果字符串。如果有结果，就通过 `prependContext` 注入到 prompt 前面，AI 会看到这些上下文。

---

### 7.3 api.registerHook — 命令钩子

为已有的斜杠命令注册前置钩子，可在命令执行前对事件进行拦截或修改。

#### 函数签名

```typescript
api.registerHook(
    hookName: string,
    handler: (event: any) => Promise<any>,
    meta: { name: string; description: string }
)
```

#### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `hookName` | `string` | 钩子名称，格式为 `"command:<命令名>"` ，表示要拦截的命令 |
| `handler` | `function` | 异步处理函数，接收事件对象，返回（可能修改后的）事件对象 |
| `meta` | `object` | 元信息，包含 `name`（钩子标识名）和 `description`（功能描述） |

#### 完整示例

```typescript
api.registerHook(
    "command:new",
    async (event: any) => {
        api.logger.info("如果看到我，说明斜杠命令hook生效了！");
        api.logger.info("event:", event);
        console.log(event);

        return event;
    },
    {
        name: "test-plugin.command",
        description: "Append self-improvement note before /new",
    }
);
```

此示例为内置的 `/new` 命令注册了一个钩子。当用户执行 `/new` 时，钩子会先执行，可以在此对 `event` 进行修改后再返回，最终传递给命令本身。

---

### 7.4 api.registerCommand — 斜杠命令

注册一个全新的斜杠命令，用户可以在对话中通过 `/命令名` 触发。

#### 函数签名

```typescript
api.registerCommand({
    name: string,
    description: string,
    handler: (ctx: any) => Promise<{ text: string }>
})
```

#### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 命令名称，用户通过 `/name` 触发 |
| `description` | `string` | 命令的描述，显示在命令列表中 |
| `handler` | `function` | 异步处理函数，接收 `ctx` 上下文对象，返回包含 `text` 字段的对象 |

#### handler 返回值

```typescript
{ text: string }
```

返回的 `text` 会作为命令的响应文本展示给用户。

#### 完整示例

```typescript
api.registerCommand({
    name: "test_command",
    description: "这是一个测试命令",
    async handler(ctx: any) {
        console.log("测试命令被触发了！", ctx);

        try {
            const text = await seedTestData(api);
            return { text };
        } catch (error) {
            const message = `写入 LanceDB 测试数据失败: ${String(error)}`;
            api.logger.warn(message);
            return { text: message };
        }
    },
});
```

此示例注册了 `/test_command` 命令。执行时会向 LanceDB 写入测试数据，并将结果文本返回给用户。

---

### 7.5 api.registerCli — CLI 命令

注册可在终端中通过 OpenClaw CLI 执行的命令。

#### 函数签名

```typescript
api.registerCli(
    factory: ({ program }: { program: any }) => void,
    meta: { commands: string[] }
)
```

#### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `factory` | `function` | 接收 `{ program }` 参数的工厂函数，`program` 是 Commander.js 风格的命令注册器 |
| `meta.commands` | `string[]` | 声明本插件注册的 CLI 命令名数组 |

#### factory 内部用法

在 `factory` 函数内，使用 `program.command(name).description(desc).action(fn)` 链式 API 注册命令：

```typescript
program.command("命令名")
    .description("命令描述")
    .action(() => {
        // 命令执行逻辑
    });
```

#### 完整示例

```typescript
api.registerCli(
    ({ program }: { program: any }) => {
        program.command("test-cli")
            .description("这是一个测试CLI命令")
            .action(() => {
                console.log("测试CLI命令被执行了！");
                console.log(program);
            });
    },
    {
        commands: ["test-cli"],
    }
);
```

注意 `meta.commands` 中列出的命令名应与 `program.command(...)` 中注册的名称一致。

---

### 7.6 api.registerService — 后台服务

注册一个后台服务，OpenClaw 会在合适的时机调用 `start` 和 `stop`。

#### 函数签名

```typescript
api.registerService({
    id: string,
    start: () => void,
    stop: () => void
})
```

#### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 服务的唯一标识符 |
| `start` | `function` | 服务启动时执行的函数 |
| `stop` | `function` | 服务停止时执行的函数 |

#### 完整示例

```typescript
api.registerService({
    id: "my-service",
    start: () => {
        api.logger.info("我的服务启动了！");
    },
    stop: () => {
        api.logger.info("我的服务停止了！");
    },
});
```

可以在 `start` 中初始化定时器、WebSocket 连接等长期运行的任务，在 `stop` 中进行清理。

---

## 8. 插件配置的读取方式

OpenClaw 会将用户为每个插件设置的配置存储在一个统一的配置树中。插件通过 `api.config` 读取。

### 配置路径

```
api.config.plugins.entries.<PLUGIN_ID>.config
```

其中 `<PLUGIN_ID>` 就是 `openclaw.plugin.json` 中的 `id` 字段。

### 推荐的安全读取模式

```typescript
const PLUGIN_ID = "test-plugin";

type PluginConfig = {
    lanceDbPath?: string;
    tableName?: string;
    ftsColumns?: string[];
    selectColumns?: string[];
    resultLimit?: number;
    minPromptLength?: number;
    maxFieldLength?: number;
    embedBaseUrl?: string;
    embedModel?: string;
    embedApiKey?: string;
    rerankBaseUrl?: string;
    rerankModel?: string;
    rerankApiKey?: string;
    topK?: number;
};

function getPluginConfig(api: any): PluginConfig {
    return api.config?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
}
```

### 使用配置示例

```typescript
function getConfiguredDbTarget(api: any): { dbPath: string; tableName: string } | undefined {
    const cfg = getPluginConfig(api);
    const dbPath = cfg.lanceDbPath?.trim();
    const tableName = cfg.tableName?.trim();

    if (!dbPath || !tableName) {
        return undefined;
    }

    return { dbPath, tableName };
}
```

### 要点

- 始终使用可选链 `?.` 访问嵌套属性，因为配置可能为 `undefined`
- 使用 `??` 提供默认值
- 对字符串类型的配置调用 `.trim()` 清理空白
- 对数字类型的配置使用 `Math.max()` 确保下界合理

---

## 9. 完整示例：LanceDB 记忆插件

以下展示了本测试插件如何整合上述所有 API，实现一个**基于 LanceDB 的记忆检索插件**。

### 核心工作流

```
用户输入 prompt
    ↓
before_prompt_build 事件触发
    ↓
queryLanceDb() 执行检索（FTS 或向量搜索）
    ↓
可选：Rerank 重排序
    ↓
formatSearchResults() 格式化结果
    ↓
通过 prependContext 注入到 prompt 前面
    ↓
AI 看到检索上下文 + 用户原始问题，生成回答
```

### 检索函数（queryLanceDb）

```typescript
async function queryLanceDb(api: any, prompt: string): Promise<string | undefined> {
    const cfg = getPluginConfig(api);
    const lanceDbPath = cfg.lanceDbPath?.trim();
    const tableName = cfg.tableName?.trim();
    const minPromptLength = Math.max(cfg.minPromptLength ?? DEFAULT_MIN_PROMPT_LENGTH, 1);

    if (!lanceDbPath || !tableName) {
        api.logger.warn("LanceDB 未配置 lanceDbPath 或 tableName，已跳过检索。");
        return undefined;
    }

    const normalizedPrompt = prompt.trim();
    if (normalizedPrompt.length < minPromptLength) {
        return undefined;
    }

    const resultLimit = Math.max(cfg.resultLimit ?? DEFAULT_RESULT_LIMIT, 1);
    const hasEmbedding = !!(cfg.embedBaseUrl?.trim() && cfg.embedModel?.trim());
    const hasRerank = !!(cfg.rerankBaseUrl?.trim() && cfg.rerankModel?.trim());
    const topK = Math.max(cfg.topK ?? DEFAULT_TOP_K, resultLimit);
    const fetchLimit = hasRerank ? topK : resultLimit;

    try {
        const table = await getTable(lanceDbPath, tableName);
        let rows: LanceDbRow[];

        if (hasEmbedding) {
            // 向量搜索模式
            const vector = await generateEmbedding(normalizedPrompt, cfg);
            rows = await table.search(vector).limit(fetchLimit).toArray();
        } else {
            // 全文搜索模式
            const ftsColumns = normalizeStringArray(cfg.ftsColumns);
            rows = await table.search(normalizedPrompt, "fts", ftsColumns).limit(fetchLimit).toArray();
        }

        if (!Array.isArray(rows)) {
            rows = [];
        }

        // 可选的 Rerank 重排序
        if (hasRerank && rows.length > 1) {
            const documents = rows.map((row) =>
                ["title", "content", "summary"]
                    .map((k) => (typeof row[k] === "string" ? (row[k] as string) : ""))
                    .filter(Boolean)
                    .join(" "),
            );
            try {
                const rerankedIndices = await rerankDocuments(normalizedPrompt, documents, cfg, resultLimit);
                rows = rerankedIndices.map((i) => rows[i]).filter(Boolean);
            } catch (rerankError) {
                api.logger.warn(`Rerank 失败，回退到原始排序: ${String(rerankError)}`);
                rows = rows.slice(0, resultLimit);
            }
        } else {
            rows = rows.slice(0, resultLimit);
        }

        api.logger.info(
            `LanceDB 检索完成: table=${tableName}, rows=${rows.length}, embedding=${hasEmbedding}, rerank=${hasRerank}`,
        );

        return formatSearchResults(rows, cfg);
    } catch (error) {
        api.logger.warn(`LanceDB 检索失败: ${String(error)}`);
        return undefined;
    }
}
```

### 结果格式化函数（formatSearchResults）

```typescript
function formatSearchResults(rows: LanceDbRow[], cfg: PluginConfig): string | undefined {
    if (rows.length === 0) {
        return undefined;
    }

    const selectColumns = normalizeStringArray(cfg.selectColumns) ?? DEFAULT_SELECT_COLUMNS;
    const maxFieldLength = Math.max(cfg.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH, 20);

    const lines = rows
        .map((row, index) => {
            const fields = selectColumns
                .map((key) => {
                    const text = truncateText(row[key], maxFieldLength);
                    return text ? `${key}: ${text}` : undefined;
                })
                .filter((value): value is string => Boolean(value));

            return fields.length > 0 ? `${index + 1}. ${fields.join(" | ")}` : undefined;
        })
        .filter((value): value is string => Boolean(value));

    if (lines.length === 0) {
        return undefined;
    }

    return [
        "以下内容来自 LanceDB 检索结果，请仅在与用户问题直接相关时使用：",
        ...lines,
    ].join("\n");
}
```

### 入口函数中的注册汇总

```typescript
export default function (api: any) {

    // 1. 注册 AI 工具
    api.registerTool({
        name: "get_weather",
        description: "测试获取天气",
        parameters: {
            type: "object",
            properties: {
                city: { type: "string" }
            }
        },
        async execute(_id: string, params: { city?: string }) {
            const { city } = params;
            return { content: [{ type: "text", text: `这是 ${city} 的天气：晴天，25度。` }] };
        }
    });

    // 2. 事件钩子：上下文注入
    api.on("before_prompt_build", async (event: { prompt: string }, ctx: { trigger?: string }) => {
        if (ctx?.trigger && ctx.trigger !== "user") {
            return;
        }
        const retrievedContext = await queryLanceDb(api, event.prompt);
        if (!retrievedContext) {
            return;
        }
        return {
            prependContext: retrievedContext,
        };
    });

    // 3. 命令钩子
    api.registerHook(
        "command:new",
        async (event: any) => {
            api.logger.info("如果看到我，说明斜杠命令hook生效了！");
            api.logger.info("event:", event);
            console.log(event);
            return event;
        },
        {
            name: "test-plugin.command",
            description: "Append self-improvement note before /new",
        }
    );

    // 4. 斜杠命令
    api.registerCommand({
        name: "test_command",
        description: "这是一个测试命令",
        async handler(ctx: any) {
            console.log("测试命令被触发了！", ctx);
            try {
                const text = await seedTestData(api);
                return { text };
            } catch (error) {
                const message = `写入 LanceDB 测试数据失败: ${String(error)}`;
                api.logger.warn(message);
                return { text: message };
            }
        },
    });

    // 5. CLI 命令
    api.registerCli(
        ({ program }: { program: any }) => {
            program.command("test-cli")
                .description("这是一个测试CLI命令")
                .action(() => {
                    console.log("测试CLI命令被执行了！");
                    console.log(program);
                });
        },
        {
            commands: ["test-cli"],
        }
    );

    // 6. 后台服务
    api.registerService({
        id: "my-service",
        start: () => {
            api.logger.info("我的服务启动了！");
        },
        stop: () => {
            api.logger.info("我的服务停止了！");
        },
    });
}
```

---

## 10. 常见问题

### Q: 插件配置在哪里填写？

在 OpenClaw 的全局配置文件中，路径为 `plugins.entries.<PLUGIN_ID>.config`。例如：

```json
{
  "plugins": {
    "entries": {
      "test-plugin": {
        "config": {
          "lanceDbPath": "/path/to/lancedb",
          "tableName": "my_table"
        }
      }
    }
  }
}
```

### Q: 为什么 `before_prompt_build` 要检查 `ctx.trigger`？

因为 `before_prompt_build` 可能被各种来源触发（如系统内部调用），不一定都是用户主动输入。通过 `ctx.trigger !== "user"` 过滤可以避免不必要的检索开销。

### Q: `api.registerTool` 的 `execute` 的第一个参数 `_id` 是什么？

它是本次工具调用的唯一标识符。如果不需要使用，按惯例以下划线开头命名 `_id` 表示忽略。

### Q: 如何同时支持全文搜索和向量搜索？

本插件通过检测是否配置了 `embedBaseUrl` 和 `embedModel` 来自动选择搜索模式：

- **配置了** → 先调用 Embedding API 生成向量，再执行向量搜索
- **未配置** → 执行全文搜索（FTS），使用 `ftsColumns` 配置指定搜索列

### Q: 如何在独立的插件目录中安装依赖？

进入插件目录，运行 `npm install` 即可。确保 `package.json` 中不包含 `workspace:*` 这样的 monorepo 引用。

### Q: registerCli 中的 `program` 对象是什么？

它是一个 Commander.js 风格的命令注册器，支持标准的 `.command()` / `.description()` / `.action()` 链式调用。

---

## 附录：默认常量参考

以下是本插件中使用的默认值常量，可用作新插件的参考：

```typescript
const DEFAULT_RESULT_LIMIT = 3;          // 默认返回结果数
const DEFAULT_MIN_PROMPT_LENGTH = 5;     // 最小 prompt 长度（低于此值跳过检索）
const DEFAULT_MAX_FIELD_LENGTH = 240;    // 单个字段显示的最大字符数
const DEFAULT_SELECT_COLUMNS = ["id", "title", "content", "text", "summary", "source"]; // 默认选取的列
const DEFAULT_TEST_FTS_COLUMNS = ["title", "content", "summary"]; // 默认全文索引列
const DEFAULT_TOP_K = 10;               // Rerank 前召回的候选数量
```
