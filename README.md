# dsh-memory-vault

> 外挂记忆库：**agent 可写不可读**。按「时间 + 事件」索引，只有用户明确开放某几条后，agent 才能读到对应记忆。

![version](https://img.shields.io/badge/version-0.1.0-blue) ![dsh](https://img.shields.io/badge/DSH-plugin-5a7fa6) ![license](https://img.shields.io/badge/license-MIT-green)

## 目录

- [功能特性](#功能特性)
- [工作流程](#工作流程)
- [安装](#安装)
- [使用说明](#使用说明)
- [工具一览](#工具一览)
- [数据与存储](#数据与存储)
- [界面](#界面)
- [安全与边界](#安全与边界)
- [已知限制](#已知限制)
- [目录结构](#目录结构)
- [License](#license)

## 功能特性

- **写入即索引**：每条记忆自带时间、项目、类别、标题、正文、标签与关联，按「时间 + 事件」组织。
- **读写分离**：agent 只能写；读取必须先由用户在面板里勾选开放，且授权只对发起申请的会话有效。
- **申请式授权**：agent 按「项目 / 类别 / 日期范围 / 关键词」发起申请，申请里只有元信息，不含正文。
- **六类事件**：进度、踩坑、决策、结构、经验、陪伴（面板独立页签），外加自由标签。
- **可审阅**：面板支持查看、编辑、删除、手动新建、多选开放；所有条目可随时收回授权。
- **人类可读导出**：每个工作区自动维护 `MEMORY.md`，可直接进 git。
- **敏感信息打码**：写入时自动将 API key、token、密码、私钥、IPv4 替换为占位符。

## 工作流程

```text
用户让 agent 记住某件事
        │
        ▼
memory_save  ──►  memories.jsonl  ──►  MEMORY.md
        │
用户说「读一下 X 时间 / Y 项目的 Z 类记忆」
        │
        ▼
memory_request（只返回匹配条数，不含正文）
        │
        ▼
用户在 设置 → 记忆库 → 待处理请求 勾选批准
        │
        ▼
memory_read(requestId)  ──►  仅返回被批准的那几条（本会话有效）
```

## 安装

### Plugin Manager（推荐）

在 DSH 的 设置 → 插件 中安装本目录（填写绝对路径），随后：

1. 注册 4 个工具：`memory_save` / `memory_status` / `memory_request` / `memory_read`；
2. 在 Web 端注册 设置 → 记忆库 整页，以及侧边栏悬浮入口；
3. 通过 `ctx.webServer` 注册同源 HTTP API `/memory-vault/api/*`，供设置页读写。

### 手动挂载

`cordis.patch.yml` 已声明插入行：

```yaml
- insert:
    - id: memory-vault
      name: 'dsh-memory-vault'
      config: {}
```

## 使用说明

### 写入

| 场景 | 做法 |
| --- | --- |
| 阶段完成 / 踩坑 / 决策 / 结构变化 / 经验总结 | agent 主动调用 `memory_save` |
| 用户说「记住……」 | agent 调用 `memory_save` |
| 用户审阅、修改、删除 | 设置 → 记忆库 → 记忆页签 |

### 请求与开放

1. 用户明确说出要读的**时间 / 项目 / 事件类型**；
2. agent 调用 `memory_request`，按条件筛选并生成申请（只返回匹配数量）；
3. 用户在 **设置 → 记忆库 → 待处理请求** 里勾选要开放的条目，点「允许所选」或「全部允许」；
4. agent 调用 `memory_read(requestId)` 读取；
5. 授权在「已开放」里可随时收回，会话结束自动失效。

### 面板

- **记忆页签**：列表、搜索（防抖）、项目筛选、日期范围、分类多选、查看 / 编辑 / 删除 / 手动新建。
- **陪伴页签**：只显示「陪伴」类记忆。
- **待处理请求**：条目的勾选框与批准 / 拒绝操作。
- **已开放**：当前生效的授权与收回操作。

## 工具一览

| 工具 | 作用 | 关键参数 | 返回 |
| --- | --- | --- | --- |
| `memory_save` | 写入一条记忆 | `category`、`title`、`body`、`tags?`、`related?`、`at?` | 条目 id、项目、打码数量 |
| `memory_status` | 查看当前会话的申请/授权元信息 | — | 待批申请、可用授权（不含正文） |
| `memory_request` | 按条件发起开放申请 | `project?`、`category?`、`from?`、`to?`、`query?`、`limit?` | `requestId`、匹配条数 |
| `memory_read` | 读取已获授的条目 | `requestId` | 记忆正文（仅限本次授权） |

## 数据与存储

### 目录结构

```text
$DSH_HOME/memory-vault/
├── projects/
│   └── <项目-slug>/
│       ├── meta.json        # 工作区路径、标题、更新时间
│       └── memories.jsonl   # 一条一行
├── requests.json            # 开放申请
└── grants.json              # 生效中的授权

<工作区>/MEMORY.md            # 人类可读导出（自动维护）
```

`slug` = 工作区目录名 + 绝对路径 sha1 前 8 位；移动目录不会串库。

### 记忆条目字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 条目 id，如 `mem_202610240036_8ba5` |
| `at` | string | 事件时间（ISO） |
| `localTime` / `localDate` | string | 本地时间显示 / 日期筛选键 |
| `category` | string | `progress` `pitfall` `decision` `structure` `experience` `companion` |
| `title` | string | 一句话标题 |
| `body` | string | 正文（markdown） |
| `tags` | string[] | 自由标签 |
| `related` | string[] | 关联条目 id |
| `source` | object | 来源会话 id 等 |

### 导出格式

`MEMORY.md` 按时间倒序，每条一段：

```markdown
## 2026-10-24 01:01 · [进度] 标题

- tags: #plugin #memory-vault
- related: mem_xxx
- session: xxxxxxxx

正文……
```

## 界面

- **设置 → 记忆库**：整页管理界面。
- **侧边栏悬浮入口**：收起为 44×6 细条，悬停展开为磨砂按钮，不占用布局空间。
  - **红点**：有待批申请；
  - **灰点**：上次查看后有新记忆写入。
- **分类彩色 chip**：踩坑红、进度绿、决策蓝、结构紫、经验橙、陪伴粉；可多选筛选。
- **自由标签**：按名称哈希取色，同名标签恒定同色。

## 安全与边界

- 这是**行为约束**，不是权限沙箱：本机同一用户仍可直接读取 `$DSH_HOME/memory-vault` 下的文件，或直接请求本机 API。
- 插件只保证 agent 的工具链路里**没有主动读取通道**；是否读取由用户在面板中决定。
- 授权规则：只开放被勾选的条目；绑定发起申请的会话；会话结束自动失效；可手动收回。
- 打码规则：`sk-` 开头密钥、GitHub token、AWS key、私钥块、`api_key/token/secret/password` 赋值、Bearer token、IPv4 地址。

## 已知限制

- 插件是 profile 级：需要每个 profile 单独安装。
- Host 端代码改动需要重载插件 / 重启 DSH 才会生效；Client 端改动刷新页面即可。
- 本插件不实现语义检索（向量搜索），按时间、项目、类别、标签、关键词过滤。

## 目录结构

```text
dsh-memory-vault/
├── package.json         # bundle 清单（dsh.bundle / dsh.client / 导出）
├── cordis.patch.yml     # 插件行插入
├── host/
│   └── index.js         # 工具注册、HTTP API、存储与打码
├── client/
│   └── index.js         # 设置页、悬浮入口、浮层面板
├── locale/
│   ├── zh.json          # 插件展示元信息（中文）
│   └── en.json          # 插件展示元信息（英文）
├── icon.png             # 256×256 图标（用户提供的角色立绘裁剪）
├── README.md
└── LICENSE
```

## License

[MIT](LICENSE)

图标素材由用户提供，仅用于本插件展示。
