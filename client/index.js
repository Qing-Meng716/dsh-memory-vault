// dsh-memory-vault — client half (Web UI).
//
// 设置 → 记忆库 整页：列表/搜索/筛选/查看/编辑/删除/勾选开放；
// 待处理请求（agent 发起）勾选批准；授权管理；陪伴记忆独立页签。
// 侧边栏底部的入口显示待处理请求小红点。
//
// 数据走同源 HTTP：GET/POST /memory-vault/api/*（由 host 半侧用 webServer 注册）。
// 参考了已装插件的模块形态（dsh-mcp-connector / dsh-archive-manager 的
// window.__ModuleLoader__ 客户端写法与 settings.section 注册方式），代码为本插件原创。

window.__ModuleLoader__.load({
  id: 'dsh-memory-vault',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React

    const NS = 'memory-vault'
    const API = '/memory-vault/api'

    const ZH = {
      nav: '记忆库',
      title: '记忆库',
      sub: 'agent 只写不读；只有你在这里明确开放某几条后，本会话的 agent 才能读到它们。',
      'tab.entries': '记忆',
      'tab.companion': '陪伴',
      'tab.requests': '待处理请求',
      'tab.grants': '已开放',
      'filters.project': '全部项目',
      'filters.category': '全部类别',
      'filters.query': '搜索标题 / 正文 / 标签',
      'filters.from': '起',
      'filters.to': '止',
      'action.refresh': '刷新',
      'action.clear': '清除筛选',
      'action.new': '新建记忆',
      'action.create': '保存',
      'form.title': '标题',
      'form.body': '正文（markdown）',
      'form.tags': 'tags（空格分隔）',
      'label.newItems': '条新记忆（上次查看后写入）',
      'action.edit': '编辑',
      'action.save': '保存',
      'action.cancel': '取消',
      'action.delete': '删除',
      'action.grant': '开放所选',
      'action.approve': '允许所选',
      'action.approveAll': '全部允许',
      'action.deny': '拒绝',
      'action.revoke': '收回授权',
      'action.close': '关闭',
      'empty.entries': '还没有记忆。agent 会在关键节点写入（进度 / 踩坑 / 决策 / 结构 / 经验 / 陪伴）。',
      'empty.requests': '没有待处理的开放申请。当你说“读一下某段时间/某个项目的记忆”，agent 会在这里发起申请。',
      'empty.grants': '没有生效中的授权。',
      'label.project': '项目',
      'label.category': '类别',
      'label.time': '时间',
      'label.tags': '标签',
      'label.session': '会话',
      'label.grantTo': '开放给',
      'label.selectSession': '选择一个会话',
      'label.related': '关联',
      'label.found': '共',
      'label.items': '条',
      'label.matched': '匹配',
      'msg.saved': '已保存',
      'msg.deleted': '已删除',
      'msg.granted': '已开放',
      'msg.approved': '已批准',
      'msg.denied': '已拒绝',
      'msg.revoked': '已收回',
      'msg.pickFirst': '先勾选至少一条记忆',
      'msg.pickSession': '先选择要开放给哪个会话',
      'msg.confirmDelete': '确定删除这条记忆？删除后不可恢复。',
      'msg.redacted': '已打码敏感信息',
      'badge.pending': '待批准',
    }
    const EN = {
      nav: 'Memory Vault',
      title: 'Memory Vault',
      sub: 'Agents write but never read. Only entries you explicitly open here become readable — for this session only.',
      'tab.entries': 'Memories',
      'tab.companion': 'Companion',
      'tab.requests': 'Pending',
      'tab.grants': 'Open',
      'filters.project': 'All projects',
      'filters.category': 'All categories',
      'filters.query': 'Search title / body / tags',
      'filters.from': 'From',
      'filters.to': 'To',
      'action.refresh': 'Refresh',
      'action.clear': 'Clear filters',
      'action.new': 'New memory',
      'action.create': 'Save',
      'form.title': 'Title',
      'form.body': 'Body (markdown)',
      'form.tags': 'tags (space separated)',
      'label.newItems': 'new memories since your last visit',
      'action.edit': 'Edit',
      'action.save': 'Save',
      'action.cancel': 'Cancel',
      'action.delete': 'Delete',
      'action.grant': 'Open selected',
      'action.approve': 'Allow selected',
      'action.approveAll': 'Allow all',
      'action.deny': 'Deny',
      'action.revoke': 'Revoke',
      'action.close': 'Close',
      'empty.entries': 'No memories yet. Agents write at key moments (progress / pitfalls / decisions / structure / experience / companion).',
      'empty.requests': 'No pending requests. Say “read the memory about X” and the agent will file a request here.',
      'empty.grants': 'No active grants.',
      'label.project': 'Project',
      'label.category': 'Category',
      'label.time': 'Time',
      'label.tags': 'Tags',
      'label.session': 'Session',
      'label.grantTo': 'Open to',
      'label.selectSession': 'Pick a session',
      'label.related': 'Related',
      'label.found': 'found',
      'label.items': 'items',
      'label.matched': 'matched',
      'msg.saved': 'Saved',
      'msg.deleted': 'Deleted',
      'msg.granted': 'Opened',
      'msg.approved': 'Approved',
      'msg.denied': 'Denied',
      'msg.revoked': 'Revoked',
      'msg.pickFirst': 'Select at least one memory first',
      'msg.pickSession': 'Pick a session first',
      'msg.confirmDelete': 'Delete this memory permanently?',
      'msg.redacted': 'Sensitive data redacted',
      'badge.pending': 'pending',
    }

    const CATEGORY_COLOR = {
      progress: 'var(--dsw-alias-state-success-primary)',
      pitfall: 'var(--dsw-alias-state-error-primary)',
      decision: 'var(--dsw-alias-brand-primary)',
      structure: '#8b5cf6',
      experience: 'var(--dsw-alias-state-warn-primary)',
      companion: '#e8618c',
    }

    // 自由 tag 按名字哈希取色，同一个 tag 永远同色
    const TAG_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
    function tagColor(tag) {
      let hash = 0
      const text = String(tag)
      for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
      return TAG_PALETTE[hash % TAG_PALETTE.length]
    }

    // ------------------------------------------------------------ data helpers

    async function apiGet(path) {
      const res = await fetch(API + path, { headers: { accept: 'application/json' } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status)
      return data
    }
    async function apiPost(path, body) {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status)
      if (data && data.ok === false) throw new Error(data.error || 'request failed')
      return data
    }

    function refKey(ref) {
      return `${ref.project}|${ref.id}`
    }

    const LAST_SEEN_KEY = 'memory-vault:lastSeenAt'
    function readLastSeen() {
      try {
        return window.localStorage.getItem(LAST_SEEN_KEY) || ''
      } catch {
        return ''
      }
    }
    function writeLastSeen(value) {
      try {
        if (value) window.localStorage.setItem(LAST_SEEN_KEY, value)
      } catch {
        /* ignore */
      }
    }

    // ------------------------------------------------------------ small UI atoms

    const chipStyle = (color) => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '1px 8px',
      borderRadius: '999px',
      border: `1px solid ${color}`,
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
      color,
      fontSize: '12px',
      lineHeight: '18px',
      whiteSpace: 'nowrap',
    })

    function TagChip(props) {
      const color = tagColor(props.tag)
      return h('span', { style: { ...chipStyle(color), padding: '0 6px', fontSize: '11px', lineHeight: '16px' } }, '#' + props.tag)
    }

    function Button(props) {
      const { label, onClick, kind, disabled, title } = props
      const primary = kind === 'primary'
      const danger = kind === 'danger'
      return h(
        'button',
        {
          type: 'button',
          title: title || label,
          disabled: disabled,
          onClick: disabled ? undefined : onClick,
          style: {
            appearance: 'none',
            font: 'inherit',
            fontSize: '13px',
            lineHeight: '20px',
            padding: '4px 12px',
            borderRadius: '8px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            border: '1px solid ' + (primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
            background: primary ? 'var(--dsw-alias-brand-primary)' : 'transparent',
            color: primary ? 'var(--dsw-alias-bg-base)' : danger ? 'var(--dsw-alias-state-error-primary)' : 'inherit',
          },
        },
        label,
      )
    }

    const inputStyle = {
      font: 'inherit',
      fontSize: '13px',
      padding: '5px 9px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'inherit',
      minWidth: '0',
    }

    function Field(props) {
      return h(
        'label',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
        props.label ? h('span', null, props.label) : null,
        props.children,
      )
    }

    function Tabs(props) {
      return h(
        'div',
        { role: 'tablist', style: { display: 'flex', gap: '6px', borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: '8px' } },
        props.tabs.map((tab) =>
          h(
            'button',
            {
              key: tab.id,
              role: 'tab',
              'aria-selected': tab.active,
              type: 'button',
              onClick: tab.onClick,
              style: {
                font: 'inherit',
                fontSize: '13px',
                padding: '5px 12px',
                borderRadius: '8px',
                border: '1px solid ' + (tab.active ? 'var(--dsw-alias-border-l2)' : 'transparent'),
                background: tab.active ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
                color: tab.active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                cursor: 'pointer',
              },
            },
            tab.label,
            tab.count ? h('span', { style: { marginLeft: '6px', opacity: 0.75 } }, `(${tab.count})`) : null,
          ),
        ),
      )
    }

    // ------------------------------------------------------------ settings page

    function MemoryVaultSection(props) {
      const t = props.t || ((k) => k)
      const [state, setState] = useState(null)
      const [entries, setEntries] = useState([])
      const [error, setError] = useState('')
      const [note, setNote] = useState('')
      const [tab, setTab] = useState('entries')
      const [filters, setFilters] = useState({ project: '', categories: [], query: '', from: '', to: '' })
      const [expanded, setExpanded] = useState('')
      const [selected, setSelected] = useState({})
      const [editing, setEditing] = useState(null)
      const [grantSession, setGrantSession] = useState('')
      const [requestSel, setRequestSel] = useState({})
      const [busy, setBusy] = useState(false)
      const [newCount, setNewCount] = useState(0)
      const [showForm, setShowForm] = useState(false)
      const [form, setForm] = useState({ project: '', category: 'experience', title: '', body: '', tags: '', at: '' })
      const seenInitRef = useRef(false)

      const flash = (msg) => {
        setNote(msg)
        setTimeout(() => setNote(''), 3000)
      }

      const refreshState = useCallback(async () => {
        try {
          const data = await apiGet('/state')
          setState(data)
          setError('')
          if (!grantSession && data.sessions?.length) setGrantSession(data.sessions[0].id)
        } catch (err) {
          setError(err.message)
        }
      }, [grantSession])

      const refreshEntries = useCallback(async () => {
        try {
          const params = new URLSearchParams()
          if (filters.project) params.set('project', filters.project)
          const categoryList = tab === 'companion' ? ['companion'] : filters.categories || []
          if (filters.query) params.set('query', filters.query)
          if (filters.from) params.set('from', filters.from)
          if (filters.to) params.set('to', filters.to)
          const data = await apiGet('/entries?' + params.toString())
          const list = data.entries || []
          const filtered = categoryList.length ? list.filter((entry) => categoryList.includes(entry.category)) : list
          setEntries(filtered)
          if (!seenInitRef.current) {
            seenInitRef.current = true
            const seen = readLastSeen()
            const newest = list.reduce((max, entry) => (entry.at > max ? entry.at : max), '')
            setNewCount(seen ? list.filter((entry) => entry.at > seen).length : 0)
            writeLastSeen(newest)
          }
        } catch (err) {
          setError(err.message)
        }
      }, [filters, tab])

      useEffect(() => {
        refreshState()
        const timer = setInterval(refreshState, 4000)
        return () => clearInterval(timer)
      }, [refreshState])

      useEffect(() => {
        if (tab !== 'entries' && tab !== 'companion') return undefined
        const timer = setTimeout(() => {
          refreshEntries().catch(() => {})
        }, 220)
        return () => clearTimeout(timer)
      }, [refreshEntries, tab])

      useEffect(() => {
        const pending = state?.requests || []
        const next = {}
        for (const request of pending) for (const ref of request.matched) next[refKey(ref)] = true
        setRequestSel(next)
      }, [state?.requests])

      const categories = state?.categories || []
      const selectedRefs = useMemo(
        () =>
          entries
            .filter((entry) => selected[refKey(entry)])
            .map((entry) => ({ project: entry.project, id: entry.id })),
        [entries, selected],
      )

      const toggleSelect = (entry) => {
        const key = refKey(entry)
        setSelected((prev) => {
          const next = { ...prev }
          if (next[key]) delete next[key]
          else next[key] = true
          return next
        })
      }

      const toggleRequestRef = (ref) => {
        const key = refKey(ref)
        setRequestSel((prev) => {
          const next = { ...prev }
          if (next[key]) delete next[key]
          else next[key] = true
          return next
        })
      }

      const run = async (fn, okMessage) => {
        setBusy(true)
        try {
          await fn()
          if (okMessage) flash(okMessage)
          await refreshState()
          if (tab === 'entries' || tab === 'companion') await refreshEntries()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }

      const grantSelected = () =>
        run(async () => {
          if (!selectedRefs.length) throw new Error(t('msg.pickFirst'))
          if (!grantSession) throw new Error(t('msg.pickSession'))
          await apiPost('/grants/create', { sessionId: grantSession, refs: selectedRefs })
          setSelected({})
        }, t('msg.granted'))

      const saveEdit = () =>
        run(async () => {
          if (!editing) return
          await apiPost('/entries/update', {
            project: editing.project,
            id: editing.id,
            title: editing.title,
            body: editing.body,
            category: editing.category,
            tags: String(editing.tags || '')
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          })
          setEditing(null)
        }, t('msg.saved'))

      const createEntry = () =>
        run(async () => {
          const project = form.project || filters.project || (state?.projects && state.projects[0] && state.projects[0].slug) || ''
          if (!project) throw new Error('没有可写入的项目')
          if (!String(form.title).trim() || !String(form.body).trim()) throw new Error('标题和正文不能为空')
          await apiPost('/entries/create', {
            project,
            category: form.category,
            title: form.title,
            body: form.body,
            tags: String(form.tags || '')
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean),
            at: form.at ? `${form.at}T12:00` : '',
          })
          setShowForm(false)
          setForm({ project, category: 'experience', title: '', body: '', tags: '', at: '' })
        }, t('msg.saved'))

      const deleteEntry = (entry) => {
        if (!window.confirm(t('msg.confirmDelete'))) return
        run(async () => {
          await apiPost('/entries/delete', { project: entry.project, id: entry.id })
          if (expanded === refKey(entry)) setExpanded('')
        }, t('msg.deleted'))
      }

      const approveRequest = (request, all) => {
        const refs = request.matched.filter((ref) => all || requestSel[refKey(ref)])
        run(async () => {
          if (!refs.length) throw new Error(t('msg.pickFirst'))
          await apiPost('/requests/approve', { requestId: request.id, refs })
        }, t('msg.approved'))
      }

      const denyRequest = (request) =>
        run(async () => {
          await apiPost('/requests/deny', { requestId: request.id })
        }, t('msg.denied'))

      const revokeGrant = (grant) =>
        run(async () => {
          await apiPost('/grants/revoke', { grantId: grant.id })
        }, t('msg.revoked'))

      const tabs = [
        { id: 'entries', label: t('tab.entries'), active: tab === 'entries', count: state?.counts?.entries || 0, onClick: () => setTab('entries') },
        { id: 'companion', label: t('tab.companion'), active: tab === 'companion', onClick: () => setTab('companion') },
        { id: 'requests', label: t('tab.requests'), active: tab === 'requests', count: state?.counts?.pending || 0, onClick: () => setTab('requests') },
        { id: 'grants', label: t('tab.grants'), active: tab === 'grants', count: state?.counts?.grants || 0, onClick: () => setTab('grants') },
      ]

      const toolbar =
        tab === 'entries' || tab === 'companion'
          ? h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
              h(
                'select',
                {
                  value: filters.project,
                  onChange: (ev) => setFilters((f) => ({ ...f, project: ev.target.value })),
                  style: inputStyle,
                },
                h('option', { value: '' }, t('filters.project')),
                (state?.projects || []).map((p) => h('option', { key: p.slug, value: p.slug }, `${p.title} (${p.count})`)),
              ),
              h('input', {
                type: 'search',
                value: filters.query,
                placeholder: t('filters.query'),
                onChange: (ev) => setFilters((f) => ({ ...f, query: ev.target.value })),
                style: { ...inputStyle, flex: '1 1 220px' },
              }),
              h(Field, { label: t('filters.from') }, h('input', { type: 'date', value: filters.from, onChange: (ev) => setFilters((f) => ({ ...f, from: ev.target.value })), style: inputStyle })),
              h(Field, { label: t('filters.to') }, h('input', { type: 'date', value: filters.to, onChange: (ev) => setFilters((f) => ({ ...f, to: ev.target.value })), style: inputStyle })),
              h(Button, { label: t('action.refresh'), onClick: refreshEntries, disabled: busy }),
              h(Button, {
                kind: showForm ? undefined : 'primary',
                label: showForm ? t('action.cancel') : t('action.new'),
                onClick: () => {
                  const next = !showForm
                  setShowForm(next)
                  if (next) setForm((f) => ({ ...f, project: filters.project || (state?.projects && state.projects[0] && state.projects[0].slug) || '' }))
                },
              }),
            )
          : null

      const grantBar =
        (tab === 'entries' || tab === 'companion') && selectedRefs.length
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '10px',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  flexWrap: 'wrap',
                },
              },
              h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, `${selectedRefs.length} ${t('label.items')} · ${t('label.grantTo')}`),
              h(
                'select',
                { value: grantSession, onChange: (ev) => setGrantSession(ev.target.value), style: inputStyle },
                (state?.sessions || []).length
                  ? (state?.sessions || []).map((s) => h('option', { key: s.id, value: s.id }, `${String(s.id).slice(0, 8)} · ${s.cwd || ''}`))
                  : h('option', { value: '' }, t('label.selectSession')),
              ),
              h(Button, { kind: 'primary', label: t('action.grant'), onClick: grantSelected, disabled: busy }),
            )
          : null

      const entryRow = (entry) => {
        const key = refKey(entry)
        const open = expanded === key
        const isEditing = editing && editing.project === entry.project && editing.id === entry.id
        return h(
          'div',
          {
            key,
            style: {
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: '10px',
              padding: '10px 12px',
              background: 'var(--dsw-alias-bg-layer-1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-start', gap: '10px' } },
            h('input', {
              type: 'checkbox',
              checked: Boolean(selected[key]),
              onChange: () => toggleSelect(entry),
              'aria-label': entry.title,
              style: { marginTop: '4px' },
            }),
            h(
              'div',
              { style: { flex: '1 1 auto', minWidth: 0, cursor: 'pointer' }, onClick: () => setExpanded(open ? '' : key) },
              h(
                'div',
                { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { style: chipStyle(CATEGORY_COLOR[entry.category] || 'var(--dsw-alias-border-l2)') }, (categories.find((c) => c.id === entry.category) || {}).label || entry.category),
                h('span', { style: { fontWeight: '600', fontSize: '14px', color: 'var(--dsw-alias-label-primary)' } }, entry.title),
              ),
              h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginTop: '4px' } },
                h('span', null, `${entry.localTime || ''} · ${entry.projectTitle || entry.project} · ${entry.id}`),
                (entry.tags || []).map((tag) => h(TagChip, { key: tag, tag })),
              ),
            ),
            h('div', { style: { display: 'flex', gap: '6px' } },
              h(Button, { label: t('action.edit'), onClick: () => setEditing({ project: entry.project, id: entry.id, title: entry.title, body: entry.body, category: entry.category, tags: (entry.tags || []).join(' ') }) }),
              h(Button, { kind: 'danger', label: t('action.delete'), onClick: () => deleteEntry(entry) }),
            ),
          ),
          open && !isEditing
            ? h(
                'div',
                { style: { borderTop: '1px dashed var(--dsw-alias-border-l1)', paddingTop: '8px' } },
                h('pre', { style: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: 'inherit', fontSize: '13px', lineHeight: '1.6' } }, entry.body),
                (entry.related || []).length ? h('div', { style: { marginTop: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, `${t('label.related')}: ${entry.related.join(', ')}`) : null,
                entry.source?.sessionId ? h('div', { style: { marginTop: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, `${t('label.session')}: ${String(entry.source.sessionId).slice(0, 8)}`) : null,
              )
            : null,
          isEditing
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px dashed var(--dsw-alias-border-l1)', paddingTop: '8px' } },
                h('input', { value: editing.title, onChange: (ev) => setEditing({ ...editing, title: ev.target.value }), style: inputStyle }),
                h(
                  'select',
                  { value: editing.category, onChange: (ev) => setEditing({ ...editing, category: ev.target.value }), style: inputStyle },
                  categories.map((c) => h('option', { key: c.id, value: c.id }, c.label)),
                ),
                h('textarea', {
                  value: editing.body,
                  rows: 10,
                  onChange: (ev) => setEditing({ ...editing, body: ev.target.value }),
                  style: { ...inputStyle, fontFamily: 'inherit', lineHeight: '1.6', resize: 'vertical' },
                }),
                h('input', { value: editing.tags, placeholder: 'tags', onChange: (ev) => setEditing({ ...editing, tags: ev.target.value }), style: inputStyle }),
                h(
                  'div',
                  { style: { display: 'flex', gap: '8px' } },
                  h(Button, { kind: 'primary', label: t('action.save'), onClick: saveEdit, disabled: busy }),
                  h(Button, { label: t('action.cancel'), onClick: () => setEditing(null) }),
                ),
              )
            : null,
        )
      }

      const requestsList = (state?.requests || []).map((request) =>
        h(
          'div',
          {
            key: request.id,
            style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1)', display: 'flex', flexDirection: 'column', gap: '8px' },
          },
          h('div', { style: { fontWeight: '600' } }, request.id, ' · ', `${request.matched.length} ${t('label.matched')}`),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, `${request.createdAt} · ${t('label.session')} ${String(request.sessionId || '').slice(0, 8)} · ${request.filtersText || ''}`),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            request.matched.map((ref) =>
              h(
                'label',
                { key: refKey(ref), style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' } },
                h('input', { type: 'checkbox', checked: Boolean(requestSel[refKey(ref)]), onChange: () => toggleRequestRef(ref) }),
                h('span', { style: chipStyle(CATEGORY_COLOR[ref.category] || 'var(--dsw-alias-border-l2)') }, ref.category || '?'),
                h('span', null, ref.title || ref.id),
                h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, ref.localTime || ''),
              ),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px' } },
            h(Button, { kind: 'primary', label: t('action.approve'), onClick: () => approveRequest(request, false), disabled: busy }),
            h(Button, { label: t('action.approveAll'), onClick: () => approveRequest(request, true), disabled: busy }),
            h(Button, { kind: 'danger', label: t('action.deny'), onClick: () => denyRequest(request), disabled: busy }),
          ),
        ),
      )

      const grantsList = (state?.grants || []).map((grant) =>
        h(
          'div',
          { key: grant.id, style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
          h('div', null,
            h('div', { style: { fontWeight: '600' } }, `${grant.count} ${t('label.items')} · ${String(grant.sessionId || '').slice(0, 8)}`),
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, `${grant.createdAt} · ${grant.requestId || grant.id}`),
          ),
          h(Button, { kind: 'danger', label: t('action.revoke'), onClick: () => revokeGrant(grant), disabled: busy }),
        ),
      )

      return h(
        'section',
        { style: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 2px 24px', color: 'var(--dsw-alias-label-primary)' } },
        h('header', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('h2', { style: { margin: 0, fontSize: '18px' } }, t('title')),
          h('p', { style: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, t('sub')),
          state ? h('p', { style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, `${t('label.found')} ${state.counts.entries} ${t('label.items')} · ${state.vaultRoot}`) : null,
          newCount ? h('p', { style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-brand-primary)' } }, `${newCount} ${t('label.newItems')}`) : null,
        ),
        h(Tabs, { tabs }),
        tab === 'entries'
          ? h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' } },
              categories.map((c) => {
                const color = CATEGORY_COLOR[c.id] || 'var(--dsw-alias-border-l2)'
                const active = (filters.categories || []).includes(c.id)
                return h(
                  'button',
                  {
                    key: c.id,
                    type: 'button',
                    'aria-pressed': active,
                    onClick: () =>
                      setFilters((f) => {
                        const current = f.categories || []
                        return {
                          ...f,
                          categories: current.includes(c.id) ? current.filter((x) => x !== c.id) : [...current, c.id],
                        }
                      }),
                    style: {
                      ...chipStyle(color),
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: '12px',
                      opacity: active ? 1 : 0.55,
                      background: active ? `color-mix(in srgb, ${color} 26%, transparent)` : 'transparent',
                      fontWeight: active ? 600 : 400,
                    },
                  },
                  (active ? '✓ ' : '') + c.label,
                )
              }),
              (filters.categories || []).length
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => setFilters((f) => ({ ...f, categories: [] })),
                      style: { font: 'inherit', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' },
                    },
                    t('action.clear'),
                  )
                : null,
            )
          : null,
        toolbar,
        showForm
          ? h(
              'div',
              {
                style: {
                  border: '1px solid var(--dsw-alias-border-l2)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  background: 'var(--dsw-alias-bg-layer-1)',
                },
              },
              h(
                'div',
                { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
                h(
                  'select',
                  { value: form.project, onChange: (ev) => setForm({ ...form, project: ev.target.value }), style: inputStyle },
                  (state?.projects || []).map((p) => h('option', { key: p.slug, value: p.slug }, p.title)),
                ),
                h(
                  'select',
                  { value: form.category, onChange: (ev) => setForm({ ...form, category: ev.target.value }), style: inputStyle },
                  categories.map((c) => h('option', { key: c.id, value: c.id }, c.label)),
                ),
                h('input', { type: 'date', value: form.at, onChange: (ev) => setForm({ ...form, at: ev.target.value }), style: inputStyle }),
                h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, t('label.time') + '（可空）'),
              ),
              h('input', { placeholder: t('form.title'), value: form.title, onChange: (ev) => setForm({ ...form, title: ev.target.value }), style: inputStyle }),
              h('textarea', {
                rows: 6,
                placeholder: t('form.body'),
                value: form.body,
                onChange: (ev) => setForm({ ...form, body: ev.target.value }),
                style: { ...inputStyle, fontFamily: 'inherit', lineHeight: '1.6', resize: 'vertical' },
              }),
              h('input', { placeholder: t('form.tags'), value: form.tags, onChange: (ev) => setForm({ ...form, tags: ev.target.value }), style: inputStyle }),
              h(
                'div',
                { style: { display: 'flex', gap: '8px' } },
                h(Button, { kind: 'primary', label: t('action.create'), onClick: createEntry, disabled: busy }),
                h(Button, { label: t('action.cancel'), onClick: () => setShowForm(false) }),
              ),
            )
          : null,
        grantBar,
        error ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px' } }, error) : null,
        note ? h('div', { style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: '13px' } }, note) : null,
        tab === 'requests'
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, requestsList.length ? requestsList : h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, t('empty.requests')))
          : tab === 'grants'
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, grantsList.length ? grantsList : h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, t('empty.grants')))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                entries.length ? entries.map(entryRow) : h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, t('empty.entries')),
              ),
      )
    }

    // ------------------------------------------------------------ overlay store
    // 侧边栏入口点击后打开自带浮层（settings 是独立覆盖层，layout.selectPanel 切不过去）。

    const overlayStore = {
      open: false,
      listeners: new Set(),
      setOpen(value) {
        this.open = Boolean(value)
        for (const listener of this.listeners) listener()
      },
      toggle() {
        this.setOpen(!this.open)
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
    }

    function useOverlayOpen() {
      const [open, setOpen] = useState(overlayStore.open)
      useEffect(() => overlayStore.subscribe(() => setOpen(overlayStore.open)), [])
      return open
    }

    function MemoryVaultOverlay(props) {
      const t = props.t || ((k) => k)
      const open = useOverlayOpen()
      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') overlayStore.setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])
      if (!open) return null
      return h(
        'div',
        {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('title'),
          onClick: (event) => {
            if (event.target === event.currentTarget) overlayStore.setOpen(false)
          },
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(0,0,0,0.35)',
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              width: 'min(980px, 100%)',
              maxHeight: 'min(82vh, 900px)',
              overflow: 'hidden',
              borderRadius: '16px',
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base))',
              boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
              color: 'var(--dsw-alias-label-primary)',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '12px 16px',
                borderBottom: '1px solid var(--dsw-alias-border-l1)',
              },
            },
            h('strong', { style: { fontSize: '15px' } }, t('title')),
            h(
              'button',
              {
                type: 'button',
                onClick: () => overlayStore.setOpen(false),
                'aria-label': t('action.close'),
                style: {
                  appearance: 'none',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  background: 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  fontSize: '13px',
                  padding: '2px 10px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                },
              },
              '✕',
            ),
          ),
          h(
            'div',
            { style: { overflow: 'auto', padding: '4px 16px 16px' } },
            h(MemoryVaultSection, { t }),
          ),
        ),
      )
    }


    function MemoryVaultFooter(props) {
      const t = props.t || ((k) => k)
      const [pending, setPending] = useState(0)
      const [unseen, setUnseen] = useState(false)
      useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const data = await apiGet('/state')
            if (alive) setPending(data?.counts?.pending || 0)
            const list = await apiGet('/entries')
            const newest = (list?.entries || []).reduce((max, entry) => (entry.at > max ? entry.at : max), '')
            const seen = readLastSeen()
            if (alive) setUnseen(Boolean(newest && (!seen || newest > seen)))
          } catch {
            /* ignore */
          }
        }
        tick()
        const timer = setInterval(tick, 6000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])
      const open = () => {
        try {
          props.openOverlay?.()
        } catch {
          /* ignore */
        }
      }
      const [hovered, setHovered] = useState(false)
      const reveal = hovered
      const badgeStyle = {
        minWidth: '16px',
        height: '16px',
        padding: '0 4px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-state-error-primary)',
        color: 'var(--dsw-alias-bg-base)',
        fontSize: '11px',
        lineHeight: '16px',
        textAlign: 'center',
      }
      const badgeText = pending > 99 ? '99+' : String(pending)
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            left: '10px',
            bottom: '72px',
            zIndex: 900,
            width: reveal ? '190px' : '44px',
            height: reveal ? '34px' : '6px',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-start',
            pointerEvents: 'auto',
            transition: 'width .2s ease, height .2s ease',
          },
        },
        h(
          'button',
          {
            type: 'button',
            onClick: open,
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
            onFocus: () => setHovered(true),
            onBlur: () => setHovered(false),
            title: t('nav') + (pending ? ` · ${pending} ${t('badge.pending')}` : ''),
            'aria-label': t('nav'),
            style: {
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: reveal ? 'flex-start' : 'center',
              gap: reveal ? '8px' : '0px',
              height: reveal ? '34px' : '6px',
              width: reveal ? '100%' : '42px',
              boxSizing: 'border-box',
              padding: reveal ? '0 10px' : '0',
              borderRadius: '10px',
              background: reveal ? 'rgba(127,127,127,0.18)' : 'rgba(127,127,127,0.28)',
              border: reveal ? '1px solid rgba(127,127,127,0.28)' : '1px solid transparent',
              backdropFilter: reveal ? 'blur(10px) saturate(1.15)' : 'none',
              WebkitBackdropFilter: reveal ? 'blur(10px) saturate(1.15)' : 'none',
              color: 'inherit',
              font: 'inherit',
              fontSize: '13px',
              cursor: 'pointer',
              overflow: 'hidden',
              transition: 'height .2s ease, width .2s ease, background .2s ease, padding .2s ease, gap .2s ease',
            },
          },
          h(
            'span',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
                opacity: reveal ? 1 : 0,
                transition: 'opacity .2s ease',
              },
            },
            h(
              'svg',
              { width: 18, height: 18, viewBox: '0 0 64 64', 'aria-hidden': 'true', style: { flex: 'none' } },
              h('rect', { x: 8, y: 14, width: 48, height: 38, rx: 7, fill: 'none', stroke: 'currentColor', strokeWidth: 4 }),
              h('circle', { cx: 44, cy: 30, r: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 3 }),
              h('path', { d: 'M14 22h24', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
            ),
          ),
          h(
            'span',
            {
              style: {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: reveal ? '160px' : '0px',
                opacity: reveal ? 1 : 0,
                transition: 'max-width .2s ease, opacity .2s ease',
              },
            },
            t('nav'),
          ),
          reveal && pending
            ? h('span', { style: { ...badgeStyle, marginLeft: 'auto' } }, badgeText)
            : null,
          reveal && unseen && !pending
            ? h('span', {
                style: {
                  marginLeft: 'auto',
                  width: '6px',
                  height: '6px',
                  borderRadius: '999px',
                  background: 'var(--dsw-alias-state-warn-primary)',
                  opacity: 0.7,
                },
              })
            : null,
        ),
        !reveal && pending
          ? h('span', { style: { ...badgeStyle, position: 'absolute', top: '-5px', right: '0px' } }, badgeText)
          : null,
        !reveal && unseen && !pending
          ? h('span', {
              style: {
                position: 'absolute',
                top: '-4px',
                left: '2px',
                width: '8px',
                height: '8px',
                borderRadius: '999px',
                background: 'var(--dsw-alias-state-warn-primary)',
                opacity: 0.65,
              },
            })
          : null,
      )
    }

    // ------------------------------------------------------------ plugin entry

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'memory-vault: locale zh')
      ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'memory-vault: locale en')
      const t = (key) => {
        try {
          return ctx.locale.bind(NS)(key)
        } catch {
          return key
        }
      }

      ctx.effect(() =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'memory-vault',
              order: 50,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ t }),
            },
            MemoryVaultSection,
          ),
        ),
      )

      ctx.effect(() =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'memory-vault-trigger',
              order: 110,
              locale: NS,
              inject: () => ({
                t,
                openOverlay: () => overlayStore.toggle(),
              }),
            },
            MemoryVaultFooter,
          ),
        ),
      )

      ctx.effect(() =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'memory-vault',
              order: 120,
              locale: NS,
              inject: () => ({ t }),
            },
            MemoryVaultOverlay,
          ),
        ),
      )

      console.log('[memory-vault] client apply done')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
