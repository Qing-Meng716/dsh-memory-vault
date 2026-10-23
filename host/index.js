// dsh-memory-vault — host half.
//
// 外挂记忆库：agent 可写不可读。
//   - 写入：memory_save（agent 在关键节点主动写；用户可在面板审阅/编辑/删除）
//   - 读取：必须先 memory_request 建申请 → 用户在 设置→记忆库 面板勾选批准 →
//           memory_read(requestId) 才能拿到内容；授权绑定到申请会话，会话结束自动失效。
//   - 索引：时间（at / localTime / localDate）+ 事件（project / category / tags / title）
//   - 存储：$DSH_HOME/memory-vault/projects/<项目 slug>/memories.jsonl
//           每个工作区另导出人类可读 <workspace>/MEMORY.md
//
// 安全说明：这是"不主动读"的行为约束，不是权限沙箱——本机同用户可以绕过。
// 敏感信息在写入时打码（API key / token / 密码 / 私钥 / IPv4 等）。

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'memory-vault'
export const inject = ['tools']

const CATEGORIES = ['progress', 'pitfall', 'decision', 'structure', 'experience', 'companion']
const CATEGORY_LABEL = {
  progress: '进度',
  pitfall: '踩坑',
  decision: '决策',
  structure: '结构',
  experience: '经验',
  companion: '陪伴',
}
const CATEGORY_ORDER = Object.fromEntries(CATEGORIES.map((c, i) => [c, i]))
const MAX_BODY = 24000
const MAX_TITLE = 140

// ---------------------------------------------------------------- paths

function vaultRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'memory-vault')
}
const projectsDir = () => path.join(vaultRoot(), 'projects')
const requestsFile = () => path.join(vaultRoot(), 'requests.json')
const grantsFile = () => path.join(vaultRoot(), 'grants.json')

// ---------------------------------------------------------------- helpers

const pad = (n) => String(n).padStart(2, '0')
function localStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
function sanitizeName(value, limit = 40) {
  const s = String(value || '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit)
  return s || 'workspace'
}
function slugFor(workspacePath) {
  const resolved = path.resolve(workspacePath)
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 8)
  return `${sanitizeName(path.basename(resolved))}-${hash}`
}
function newId(prefix) {
  const stamp = localStamp().replace(/[^\d]/g, '')
  return `${prefix}_${stamp}_${crypto.randomBytes(2).toString('hex')}`
}

async function readJson(file, fallback) {
  try {
    const text = await fs.readFile(file, 'utf8')
    if (!text.trim()) return fallback
    return JSON.parse(text)
  } catch {
    return fallback
  }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 1), 'utf8')
  await fs.rename(tmp, file)
}
async function readJsonl(file) {
  try {
    const text = await fs.readFile(file, 'utf8')
    const out = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        /* skip broken line */
      }
    }
    return out
  } catch {
    return []
  }
}
async function writeJsonl(file, entries) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''), 'utf8')
  await fs.rename(tmp, file)
}
async function appendJsonl(file, entry) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
}

// ---------------------------------------------------------------- redaction

const REDACT_RULES = [
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[已打码:api-key]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[已打码:token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[已打码:aws-key]'],
  [/(?<![A-Za-z])-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[已打码:私钥]'],
  [/(?:(?:api[_-]?key|apikey|token|secret|password|passwd|pwd|密码|密钥|通行证)\s*[:=：]\s*)("[^"]{4,}"|'[^']{4,}'|[^\s,;，；]{4,})/gi, '[已打码:凭据]'],
  [/\bbearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [已打码:token]'],
  [/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, '[已打码:ip]'],
]

function redact(text) {
  if (typeof text !== 'string' || !text) return { text: text || '', hits: 0 }
  let out = text
  let hits = 0
  for (const [re, replacement] of REDACT_RULES) {
    out = out.replace(re, () => {
      hits += 1
      return replacement
    })
  }
  return { text: out, hits }
}

// ---------------------------------------------------------------- projects & entries

async function ensureProject(workspacePath) {
  const resolved = path.resolve(workspacePath)
  const slug = slugFor(resolved)
  const dir = path.join(projectsDir(), slug)
  await fs.mkdir(dir, { recursive: true })
  const metaFile = path.join(dir, 'meta.json')
  const existing = await readJson(metaFile, null)
  const now = localStamp()
  const meta = {
    slug,
    path: resolved,
    title: existing?.title || path.basename(resolved) || slug,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  await writeJson(metaFile, meta)
  return { slug, dir, meta }
}

async function listProjects() {
  let names = []
  try {
    names = await fs.readdir(projectsDir())
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    const dir = path.join(projectsDir(), name)
    const meta = await readJson(path.join(dir, 'meta.json'), null)
    if (!meta) continue
    const entries = await readJsonl(path.join(dir, 'memories.jsonl'))
    out.push({ ...meta, count: entries.length })
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return out
}

async function readProjectEntries(slug) {
  const dir = path.join(projectsDir(), slug)
  const meta = await readJson(path.join(dir, 'meta.json'), null)
  if (!meta) return []
  return (await readJsonl(path.join(dir, 'memories.jsonl'))).map((entry) => ({ ...entry, project: meta }))
}

async function allEntries() {
  const projects = await listProjects()
  const out = []
  for (const project of projects) out.push(...(await readProjectEntries(project.slug)))
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return out
}

async function findEntry(slug, id) {
  return (await readProjectEntries(slug)).find((e) => e.id === id)
}

function regenerateMemoryMd(meta, entries) {
  const sorted = [...entries].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const lines = []
  lines.push(`# 记忆库 · ${meta.title}`)
  lines.push('')
  lines.push(`> 自动生成（dsh-memory-vault），共 ${sorted.length} 条。时间：${localStamp()}。`)
  lines.push(`> 项目：\`${meta.path}\``)
  lines.push('')
  for (const e of sorted) {
    lines.push(`## ${e.localTime || e.at} · [${CATEGORY_LABEL[e.category] || e.category}] ${e.title}`)
    const metaBits = []
    if (e.tags?.length) metaBits.push('tags: ' + e.tags.map((t) => `#${t}`).join(' '))
    if (e.related?.length) metaBits.push('related: ' + e.related.join(', '))
    if (e.source?.sessionId) metaBits.push('session: ' + e.source.sessionId.slice(0, 8))
    if (metaBits.length) lines.push('')
    for (const bit of metaBits) lines.push(`- ${bit}`)
    lines.push('')
    lines.push(e.body)
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  return lines.join('\n')
}

async function exportMemoryMd(meta, entries) {
  try {
    const file = path.join(meta.path, 'MEMORY.md')
    await fs.writeFile(file, regenerateMemoryMd(meta, entries), 'utf8')
    return file
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- requests & grants

async function readRequests() {
  return await readJson(requestsFile(), [])
}
async function writeRequests(list) {
  await writeJson(requestsFile(), list)
}
async function readGrants() {
  return await readJson(grantsFile(), [])
}
async function writeGrants(list) {
  await writeJson(grantsFile(), list)
}

function isSessionLive(ctx, sessionId) {
  if (!sessionId) return false
  const agents = ctx?.get?.('agents')
  if (!agents || typeof agents.get !== 'function') return true // 无法判定时按存活处理（桌面单进程）
  return Boolean(agents.get(sessionId))
}

async function activeGrantFor(ctx, requestId) {
  const grants = await readGrants()
  const grant = grants.find((g) => g.requestId === requestId && g.status === 'active')
  if (!grant) return { grant: null, reason: '没有有效授权' }
  if (grant.sessionId && !isSessionLive(ctx, grant.sessionId)) {
    grant.status = 'expired'
    grant.expiredAt = localStamp()
    await writeGrants(grants)
    return { grant: null, reason: '会话已结束，授权已自动失效' }
  }
  return { grant, reason: '' }
}

function matchEntries(entries, filters) {
  let list = entries
  if (filters.category) list = list.filter((e) => e.category === filters.category)
  if (filters.from) list = list.filter((e) => String(e.localDate || '') >= filters.from)
  if (filters.to) list = list.filter((e) => String(e.localDate || '') <= filters.to)
  if (filters.query) {
    const q = String(filters.query).toLowerCase()
    list = list.filter(
      (e) =>
        String(e.title).toLowerCase().includes(q) ||
        String(e.body).toLowerCase().includes(q) ||
        (e.tags || []).some((t) => String(t).toLowerCase().includes(q)),
    )
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 50)
  return list.slice(0, limit)
}

// ---------------------------------------------------------------- tool helpers

async function resolveCwd(ctx, exec) {
  const wd = ctx?.get?.('workingDirectory')
  if (wd && exec?.agent) {
    try {
      return await wd.ensure(exec.agent, exec.signal)
    } catch {
      /* fall through */
    }
  }
  return wd?.defaultDirectory || process.cwd()
}

function textBlock(text) {
  return [{ type: 'text', text }]
}

function toolOutput(render) {
  return {
    schema: { type: 'object', additionalProperties: true, properties: {} },
    render,
  }
}

function buildSaveTool(ctx) {
  return {
    name: 'memory_save',
    description:
      '把一条重要记忆写入外挂记忆库（用户可审阅/编辑/删除）。在关键节点主动调用：阶段完成、踩坑与修复、重要决策、项目结构变化、经验总结，或用户说「记住…」时。' +
      '一条记忆只写一件事；正文用 markdown（可以含路径、命令、结论、原因）。敏感信息（API key/密码/私钥）会被自动打码。' +
      '注意：写进去的记忆 agent 自己读不回来，只有用户在「设置→记忆库」里明确开放后才能读。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        category: {
          type: 'string',
          enum: CATEGORIES,
          description: '事件类别：progress=进度、pitfall=踩坑、decision=决策、structure=项目结构、experience=经验、companion=陪伴记忆。',
        },
        title: { type: 'string', description: '一句话标题（≤140 字），用来在时间线上索引这条记忆。' },
        body: { type: 'string', description: '正文 markdown；写清楚「发生了什么/为什么/结论或下一步」。' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '自由标签（≤12 个），例如 h3、配音、实例、canon。',
        },
        related: {
          type: 'array',
          items: { type: 'string' },
          description: '关联记忆的 id 列表（可选），用于串起前因后果。',
        },
        at: { type: 'string', description: '事件发生时间（ISO 或 YYYY-MM-DD HH:MM，可选，默认现在）。' },
      },
      required: ['category', 'title', 'body'],
    },
    output: toolOutput((_args, value) => {
      if (!value?.ok) return textBlock(`记忆写入失败：${value?.error || '未知错误'}`)
      return textBlock(
        `✅ 已写入记忆库\n- id: ${value.id}\n- 项目: ${value.project}\n- 类别: ${value.category}\n- 时间: ${value.localTime}\n- 文件: ${value.file}` +
          (value.redacted ? `\n- 已打码 ${value.redacted} 处敏感信息` : '') +
          `\n（agent 无法读回这条记忆；只有用户在 设置→记忆库 里开放后才能读。）`,
      )
    }),
    timeoutMs: 30000,
    isConcurrencySafe: () => false,
    presentCall: (args) => ({ card: 'generic', title: 'memory_save', kind: 'other', rawInput: args }),
    async execute(args, exec) {
      const category = String(args?.category || '')
      if (!CATEGORIES.includes(category)) throw new Error(`category 必须是 ${CATEGORIES.join('/')} 之一`)
      const rawTitle = String(args?.title || '').trim()
      const rawBody = String(args?.body || '').trim()
      if (!rawTitle) throw new Error('title 不能为空')
      if (!rawBody) throw new Error('body 不能为空')
      const titleRed = redact(rawTitle.slice(0, MAX_TITLE))
      const bodyRed = redact(rawBody.slice(0, MAX_BODY))
      const tags = (Array.isArray(args?.tags) ? args.tags : [])
        .map((t) => redact(String(t)).text.trim())
        .filter(Boolean)
        .slice(0, 12)
      const related = (Array.isArray(args?.related) ? args.related : []).map((r) => String(r)).slice(0, 20)
      const when = parseMoment(args?.at)
      const cwd = await resolveCwd(ctx, exec)
      const { slug, dir, meta } = await ensureProject(cwd)
      const entry = {
        id: newId('mem'),
        at: when.toISOString(),
        localTime: localStamp(when),
        localDate: localDate(when),
        category,
        title: titleRed.text,
        body: bodyRed.text,
        tags,
        related,
        source: {
          sessionId: exec?.agent?.id ? String(exec.agent.id) : '',
          agentKind: exec?.agent?.id ? 'agent' : 'unknown',
        },
        createdAt: localStamp(),
      }
      const file = path.join(dir, 'memories.jsonl')
      await appendJsonl(file, entry)
      const entries = await readProjectEntries(slug)
      const md = await exportMemoryMd(meta, entries)
      return {
        ok: true,
        id: entry.id,
        project: slug,
        category,
        localTime: entry.localTime,
        file: md || file,
        redacted: titleRed.hits + bodyRed.hits,
      }
    },
  }
}

function buildStatusTool(ctx) {
  return {
    name: 'memory_status',
    description:
      '查看当前会话的记忆库申请状态（只有元信息：申请 id、匹配条数、授权状态；不含记忆正文）。' +
      '当用户说「我批准了/开放好了」时先调它确认，再调 memory_read。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: toolOutput((_args, value) => {
      const lines = []
      lines.push(`待批准申请：${value.pending.length} 个`)
      for (const r of value.pending) lines.push(`- ${r.id}：匹配 ${r.matched} 条（${r.createdAt}）`)
      lines.push(`可用授权：${value.approved.length} 个`)
      for (const g of value.approved) lines.push(`- 申请 ${g.requestId}：${g.count} 条（本会话有效）`)
      if (!value.pending.length && !value.approved.length) lines.push('（暂无；可先用 memory_request 发起申请）')
      return textBlock(lines.join('\n'))
    }),
    timeoutMs: 15000,
    async execute(_args, exec) {
      const sessionId = exec?.agent?.id ? String(exec.agent.id) : ''
      const requests = (await readRequests()).filter((r) => r.sessionId === sessionId)
      const grants = (await readGrants()).filter(
        (g) => g.sessionId === sessionId && g.status === 'active' && isSessionLive(ctx, g.sessionId),
      )
      return {
        pending: requests
          .filter((r) => r.status === 'pending')
          .map((r) => ({ id: r.id, matched: r.matched.length, createdAt: r.createdAt })),
        approved: grants.map((g) => ({ requestId: g.requestId, count: g.entries.length })),
      }
    },
  }
}

function buildRequestTool(ctx) {
  return {
    name: 'memory_request',
    description:
      '当用户明确要求读取某段记忆（指定了时间 / 项目 / 事件类型）时调用：按条件筛选记忆并生成一个「开放申请」。' +
      '申请会出现在用户的 设置→记忆库 面板里，由用户勾选批准；批准前 agent 拿不到任何正文，只会得到匹配条数。' +
      '批准后调用 memory_read(requestId) 读取。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        project: {
          type: 'string',
          description: '项目筛选：工作区路径或 slug；* 表示所有项目；省略=当前工作区。',
        },
        category: { type: 'string', enum: CATEGORIES, description: '事件类别筛选（可选）。' },
        from: { type: 'string', description: '起始日期 YYYY-MM-DD（可选）。' },
        to: { type: 'string', description: '结束日期 YYYY-MM-DD（可选）。' },
        query: { type: 'string', description: '关键词（可选），在标题/正文/tags 里匹配。' },
        limit: { type: 'number', description: '最多匹配多少条（默认 20，上限 50）。' },
      },
    },
    output: toolOutput((_args, value) => {
      if (!value?.ok) return textBlock(`申请失败：${value?.error || '未知错误'}`)
      if (!value.requestId) {
        return textBlock(`没有匹配的记忆（条件：${value.filtersText}）。可以让用户放宽项目/日期/类别再试。`)
      }
      return textBlock(
        `📨 已创建记忆开放申请\n- requestId: ${value.requestId}\n- 匹配: ${value.matched} 条\n- 条件: ${value.filtersText}\n` +
          `请让用户到「设置 → 记忆库 → 待处理请求」里勾选批准；批准后调用 memory_read(requestId="${value.requestId}")。`,
      )
    }),
    timeoutMs: 20000,
    async execute(args, exec) {
      const cwd = await resolveCwd(ctx, exec)
      const projects = await listProjects()
      const currentSlug = projects.find((p) => path.resolve(p.path) === path.resolve(cwd))?.slug || slugFor(cwd)
      const entries = await allEntries()
      let scope = entries
      if (args?.project && args.project !== '*') {
        const wanted = String(args.project)
        const slug = projects.find((p) => p.slug === wanted || path.resolve(p.path) === path.resolve(wanted))?.slug
        scope = entries.filter((e) => e.project.slug === (slug || wanted) || e.project.path === wanted)
      } else if (!args?.project) {
        scope = entries.filter((e) => e.project.slug === currentSlug)
      }
      const matched = matchEntries(scope, args || {}).map((e) => ({ project: e.project.slug, id: e.id }))
      const filtersText = describeFilters(args || {}, args?.project ? String(args.project) : currentSlug)
      if (!matched.length) return { ok: true, matched: 0, filtersText }
      const sessionId = exec?.agent?.id ? String(exec.agent.id) : ''
      const request = {
        id: newId('req'),
        sessionId,
        createdAt: localStamp(),
        filters: args || {},
        filtersText,
        matched,
        status: 'pending',
      }
      const requests = await readRequests()
      requests.unshift(request)
      await writeRequests(requests.slice(0, 200))
      return { ok: true, requestId: request.id, matched: matched.length, filtersText }
    },
  }
}

function buildReadTool(ctx) {
  return {
    name: 'memory_read',
    description:
      '读取一条已被用户批准开放的记忆申请内容。必须先有 memory_request 且用户已在 设置→记忆库 里批准。' +
      '授权只对发起申请的会话有效，会话结束自动失效；未批准时返回错误并说明怎么申请。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requestId: { type: 'string', description: 'memory_request 返回的 requestId。' },
      },
      required: ['requestId'],
    },
    output: toolOutput((_args, value) => {
      if (!value?.ok) return textBlock(value?.error || '读取失败')
      const lines = [`📖 已开放的记忆（${value.entries.length} 条，仅本会话有效）：`]
      for (const e of value.entries) {
        lines.push('')
        lines.push(`## [${CATEGORY_LABEL[e.category] || e.category}] ${e.title}`)
        lines.push(`- 时间: ${e.localTime}`)
        lines.push(`- 项目: ${e.project?.path || e.project?.slug || ''}`)
        if (e.tags?.length) lines.push(`- tags: ${e.tags.join(' / ')}`)
        if (e.related?.length) lines.push(`- related: ${e.related.join(', ')}`)
        lines.push('')
        lines.push(e.body)
      }
      return textBlock(lines.join('\n'))
    }),
    timeoutMs: 20000,
    async execute(args, exec) {
      const requestId = String(args?.requestId || '').trim()
      if (!requestId) throw new Error('requestId 不能为空')
      const requests = await readRequests()
      const request = requests.find((r) => r.id === requestId)
      if (!request) throw new Error(`找不到申请 ${requestId}`)
      const sessionId = exec?.agent?.id ? String(exec.agent.id) : ''
      if (request.sessionId && request.sessionId !== sessionId) {
        throw new Error('这个申请属于另一个会话，当前会话无权读取')
      }
      if (request.status === 'denied') throw new Error('用户拒绝了这次开放申请')
      if (request.status !== 'approved') {
        throw new Error(
          `申请 ${requestId} 还在等待批准。请用户在「设置 → 记忆库 → 待处理请求」里勾选批准后重试。`,
        )
      }
      const { grant, reason } = await activeGrantFor(ctx, requestId)
      if (!grant) throw new Error(`无法读取：${reason}`)
      const wanted = new Set(grant.entries.map((ref) => `${ref.project}|${ref.id}`))
      const entries = (await allEntries()).filter((e) => wanted.has(`${e.project.slug}|${e.id}`))
      if (!entries.length) throw new Error('授权条目已不存在（可能被删除）')
      return { ok: true, entries }
    },
  }
}

function parseMoment(input) {
  if (!input) return new Date()
  const raw = String(input).trim()
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') : raw
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function describeFilters(filters, projectText) {
  const bits = [`项目=${projectText}`]
  if (filters.category) bits.push(`类别=${CATEGORY_LABEL[filters.category] || filters.category}`)
  if (filters.from) bits.push(`从=${filters.from}`)
  if (filters.to) bits.push(`到=${filters.to}`)
  if (filters.query) bits.push(`关键词=${filters.query}`)
  return bits.join('，')
}

// ---------------------------------------------------------------- HTTP API（给设置页用）

const API_PREFIX = '/memory-vault/api'

function json(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  return await new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function summaryOf(entry) {
  return {
    project: entry.project.slug,
    projectTitle: entry.project.title || entry.project.slug,
    projectPath: entry.project.path,
    id: entry.id,
    at: entry.at,
    localTime: entry.localTime,
    localDate: entry.localDate,
    category: entry.category,
    title: entry.title,
    tags: entry.tags || [],
    related: entry.related || [],
  }
}

async function buildState(ctx) {
  const projects = await listProjects()
  const entries = await allEntries()
  const requests = (await readRequests()).filter((r) => r.status === 'pending').slice(0, 50)
  const grants = (await readGrants())
    .filter((g) => g.status === 'active' && isSessionLive(ctx, g.sessionId))
    .slice(0, 50)
  const agents = ctx?.get?.('agents')
  const wd = ctx?.get?.('workingDirectory')
  const sessions = []
  if (agents && typeof agents.list === 'function') {
    for (const agent of agents.list().slice(0, 20)) {
      let cwd = ''
      try {
        cwd = wd ? await wd.ensure(agent) : ''
      } catch {
        cwd = ''
      }
      sessions.push({ id: String(agent.id), cwd })
    }
  }
  return {
    vaultRoot: vaultRoot(),
    categories: CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c] })),
    projects,
    sessions,
    counts: {
      entries: entries.length,
      pending: requests.length,
      grants: grants.length,
    },
    requests: requests.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      createdAt: r.createdAt,
      filtersText: r.filtersText,
      matched: r.matched.map((ref) => {
        const entry = entries.find((e) => e.project.slug === ref.project && e.id === ref.id)
        return entry ? summaryOf(entry) : { project: ref.project, id: ref.id, title: '(已删除)' }
      }),
    })),
    grants: grants.map((g) => ({
      id: g.id,
      requestId: g.requestId,
      sessionId: g.sessionId,
      createdAt: g.createdAt,
      count: g.entries.length,
    })),
  }
}

async function filterEntriesForApi(params) {
  const entries = await allEntries()
  const project = params.get('project') || ''
  const categories = (params.get('category') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const q = (params.get('query') || '').toLowerCase()
  return entries
    .filter((e) => (!project || e.project.slug === project))
    .filter((e) => (!categories.length || categories.includes(e.category)))
    .filter((e) => (!from || String(e.localDate) >= from))
    .filter((e) => (!to || String(e.localDate) <= to))
    .filter(
      (e) =>
        !q ||
        String(e.title).toLowerCase().includes(q) ||
        String(e.body).toLowerCase().includes(q) ||
        (e.tags || []).some((t) => String(t).toLowerCase().includes(q)),
    )
    .map((e) => ({
      ...summaryOf(e),
      body: e.body,
      source: e.source || {},
    }))
}

async function handleApi(ctx, req, res) {
  const url = new URL(req.url, 'http://memory-vault.local')
  const route = url.pathname.slice(API_PREFIX.length) || '/'
  if (req.method === 'GET' && route === '/state') return json(res, 200, await buildState(ctx))
  if (req.method === 'GET' && route === '/entries') {
    return json(res, 200, { entries: await filterEntriesForApi(url.searchParams) })
  }
  if (req.method === 'POST') {
    const body = await readBody(req)
    if (route === '/requests/approve') return json(res, 200, await approveRequest(ctx, body))
    if (route === '/requests/deny') return json(res, 200, await denyRequest(body))
    if (route === '/grants/revoke') return json(res, 200, await revokeGrant(body))
    if (route === '/grants/create') return json(res, 200, await manualGrant(ctx, body))
    if (route === '/entries/update') return json(res, 200, await updateEntryApi(body))
    if (route === '/entries/delete') return json(res, 200, await deleteEntryApi(body))
    if (route === '/entries/create') return json(res, 200, await createEntryApi(ctx, body))
  }
  return json(res, 404, { error: 'unknown route', route })
}

async function approveRequest(ctx, body) {
  const requests = await readRequests()
  const request = requests.find((r) => r.id === body?.requestId)
  if (!request) return { ok: false, error: '申请不存在' }
  if (request.status !== 'pending') return { ok: false, error: `申请状态为 ${request.status}` }
  let refs = request.matched
  if (Array.isArray(body?.refs) && body.refs.length) {
    const wanted = new Set(body.refs.map((r) => `${r.project}|${r.id}`))
    refs = request.matched.filter((ref) => wanted.has(`${ref.project}|${ref.id}`))
  }
  if (!refs.length) return { ok: false, error: '至少要勾选一条记忆' }
  const grants = await readGrants()
  const grant = {
    id: newId('grant'),
    requestId: request.id,
    sessionId: request.sessionId,
    createdAt: localStamp(),
    entries: refs,
    status: 'active',
  }
  grants.unshift(grant)
  await writeGrants(grants.slice(0, 200))
  request.status = 'approved'
  request.approvedAt = localStamp()
  request.grantId = grant.id
  await writeRequests(requests)
  return { ok: true, grantId: grant.id, count: refs.length }
}

async function denyRequest(body) {
  const requests = await readRequests()
  const request = requests.find((r) => r.id === body?.requestId)
  if (!request) return { ok: false, error: '申请不存在' }
  request.status = 'denied'
  request.deniedAt = localStamp()
  await writeRequests(requests)
  return { ok: true }
}

async function revokeGrant(body) {
  const grants = await readGrants()
  const grant = grants.find((g) => g.id === body?.grantId)
  if (!grant) return { ok: false, error: '授权不存在' }
  grant.status = 'revoked'
  grant.revokedAt = localStamp()
  await writeGrants(grants)
  return { ok: true }
}

async function manualGrant(ctx, body) {
  const sessionId = String(body?.sessionId || '')
  if (!sessionId) return { ok: false, error: '缺少 sessionId' }
  const refs = Array.isArray(body?.refs) ? body.refs.filter((r) => r?.project && r?.id) : []
  if (!refs.length) return { ok: false, error: '至少要勾选一条记忆' }
  const grants = await readGrants()
  const grant = {
    id: newId('grant'),
    requestId: body?.requestId || '',
    sessionId,
    createdAt: localStamp(),
    entries: refs,
    status: 'active',
  }
  grants.unshift(grant)
  await writeGrants(grants.slice(0, 200))
  return { ok: true, grantId: grant.id, count: refs.length }
}

async function updateEntryApi(body) {
  const slug = String(body?.project || '')
  const id = String(body?.id || '')
  if (!slug || !id) return { ok: false, error: '缺少 project/id' }
  const entries = await readProjectEntries(slug)
  const entry = entries.find((e) => e.id === id)
  if (!entry) return { ok: false, error: '记忆不存在' }
  if (typeof body.title === 'string') entry.title = redact(body.title.slice(0, MAX_TITLE)).text
  if (typeof body.body === 'string') entry.body = redact(body.body.slice(0, MAX_BODY)).text
  if (typeof body.category === 'string' && CATEGORIES.includes(body.category)) entry.category = body.category
  if (Array.isArray(body.tags)) entry.tags = body.tags.map((t) => String(t).slice(0, 40)).slice(0, 12)
  if (Array.isArray(body.related)) entry.related = body.related.map(String).slice(0, 20)
  entry.editedAt = localStamp()
  const dir = path.join(projectsDir(), slug)
  await writeJsonl(path.join(dir, 'memories.jsonl'), entries.map(({ project, ...rest }) => rest))
  const meta = await readJson(path.join(dir, 'meta.json'), null)
  if (meta) {
    meta.updatedAt = localStamp()
    await writeJson(path.join(dir, 'meta.json'), meta)
    await exportMemoryMd(meta, await readProjectEntries(slug))
  }
  return { ok: true }
}

async function deleteEntryApi(body) {
  const slug = String(body?.project || '')
  const id = String(body?.id || '')
  if (!slug || !id) return { ok: false, error: '缺少 project/id' }
  const entries = await readProjectEntries(slug)
  const next = entries.filter((e) => e.id !== id)
  if (next.length === entries.length) return { ok: false, error: '记忆不存在' }
  const dir = path.join(projectsDir(), slug)
  await writeJsonl(path.join(dir, 'memories.jsonl'), next.map(({ project, ...rest }) => rest))
  const meta = await readJson(path.join(dir, 'meta.json'), null)
  if (meta) {
    meta.updatedAt = localStamp()
    await writeJson(path.join(dir, 'meta.json'), meta)
    await exportMemoryMd(meta, await readProjectEntries(slug))
  }
  return { ok: true }
}

async function createEntryApi(ctx, body) {
  const slug = String(body?.project || '')
  const category = CATEGORIES.includes(body?.category) ? body.category : 'experience'
  const title = redact(String(body?.title || '').trim().slice(0, MAX_TITLE)).text
  const bodyText = redact(String(body?.body || '').trim().slice(0, MAX_BODY)).text
  if (!slug) return { ok: false, error: '缺少 project' }
  if (!title || !bodyText) return { ok: false, error: '标题和正文不能为空' }
  const dir = path.join(projectsDir(), slug)
  const meta = await readJson(path.join(dir, 'meta.json'), null)
  if (!meta) return { ok: false, error: '项目不存在' }
  const when = parseMoment(body?.at)
  const entry = {
    id: newId('mem'),
    at: when.toISOString(),
    localTime: localStamp(when),
    localDate: localDate(when),
    category,
    title,
    body: bodyText,
    tags: Array.isArray(body?.tags) ? body.tags.map((t) => String(t).slice(0, 40)).slice(0, 12) : [],
    related: Array.isArray(body?.related) ? body.related.map(String).slice(0, 20) : [],
    source: { sessionId: '', agentKind: 'user' },
    createdAt: localStamp(),
    createdBy: 'user',
  }
  await appendJsonl(path.join(dir, 'memories.jsonl'), entry)
  meta.updatedAt = localStamp()
  await writeJson(path.join(dir, 'meta.json'), meta)
  await exportMemoryMd(meta, await readProjectEntries(slug))
  return { ok: true, id: entry.id }
}

// ---------------------------------------------------------------- plugin

export function apply(ctx) {
  const disposers = []

  ctx.effect(() => {
    disposers.push(ctx.tools.register(buildSaveTool(ctx)))
    disposers.push(ctx.tools.register(buildStatusTool(ctx)))
    disposers.push(ctx.tools.register(buildRequestTool(ctx)))
    disposers.push(ctx.tools.register(buildReadTool(ctx)))
    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
    }
  })

  const webServer = ctx.get?.('webServer')
  if (webServer && typeof webServer.register === 'function') {
    ctx.effect(() =>
      webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => handleApi(ctx, req, res),
      }),
    )
  } else {
    console.warn('[memory-vault] webServer 不可用：设置页无法加载记忆库数据')
  }
}

// ---------------------------------------------------------------- self-test

export const __internals = {
  vaultRoot,
  slugFor,
  redact,
  localStamp,
  localDate,
  ensureProject,
  listProjects,
  readProjectEntries,
  allEntries,
  exportMemoryMd,
  matchEntries,
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mv-selftest-'))
  process.env.DSH_HOME = tmp
  const { slug, meta } = await ensureProject(path.join(tmp, 'demo-project'))
  const entry = {
    id: 'mem_test_1',
    at: new Date().toISOString(),
    localTime: localStamp(),
    localDate: localDate(),
    category: 'pitfall',
    title: '测试踩坑',
    body: 'password: hunter2\napi_key=sk-' + 'a'.repeat(24) + '\nIP 1.2.3.4',
    tags: ['test'],
    related: [],
    source: { sessionId: 'sess-123' },
    createdAt: localStamp(),
  }
  const red = redact(entry.body)
  await appendJsonl(path.join(tmp, 'memory-vault', 'projects', slug, 'memories.jsonl'), { ...entry, body: red.text })
  const entries = await readProjectEntries(slug)
  const md = await exportMemoryMd(meta, entries)
  console.log(JSON.stringify({ slug, redactedHits: red.hits, body: red.text, mdWritten: Boolean(md), count: entries.length }, null, 1))
  await fs.rm(tmp, { recursive: true, force: true })
}
