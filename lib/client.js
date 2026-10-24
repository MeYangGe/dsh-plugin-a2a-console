/**
 * 面板页面（浏览器原生模块形态）：由 /a2a 出 HTML，页面里的
 * 全部数据请求走同源代理 /a2a/api/* —— 网关 Key 只存在于插件
 * 服务端配置，浏览器不接触。
 *
 * 三个页面共用一套极简样式与工具函数；管理 API 的响应统一是
 * { success, data } 信封（agent2api 的既有口径），这里统一解包。
 */

const SHELL_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.6 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #0f1115; color: #e7e9ee; }
  header { display: flex; align-items: center; gap: 14px; padding: 12px 18px;
           border-bottom: 1px solid #23262e; background: #141821; position: sticky; top: 0; }
  header h1 { font-size: 15px; margin: 0; }
  nav { display: flex; gap: 4px; margin-left: auto; }
  nav a { color: #9aa1ad; text-decoration: none; padding: 5px 10px; border-radius: 6px; font-size: 12.5px; }
  nav a:hover { background: #1d222c; color: #e7e9ee; }
  main { padding: 16px 18px; max-width: 1080px; }
  .card { background: #141821; border: 1px solid #23262e; border-radius: 10px;
          padding: 14px 16px; margin-bottom: 14px; }
  .card h2 { font-size: 13.5px; margin: 0 0 10px; color: #c8cdd6; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #20242d; }
  th { color: #8b93a0; font-weight: 500; }
  tr.off td { opacity: .55; }
  button { background: #1d2634; color: #dfe4ec; border: 1px solid #2c3648; border-radius: 6px;
           padding: 4px 10px; font-size: 12px; cursor: pointer; }
  button:hover { background: #26334a; }
  button.danger { border-color: #5b2626; color: #f1a0a0; }
  button:disabled { opacity: .5; cursor: default; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .muted { color: #8b93a0; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  pre { background: #0c0e12; border: 1px solid #20242d; border-radius: 8px;
        padding: 10px; overflow: auto; max-height: 320px; font-size: 12px; }
  textarea { width: 100%; min-height: 96px; background: #0c0e12; color: #dfe4ec;
             border: 1px solid #2c3648; border-radius: 8px; padding: 8px;
             font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  .ok { color: #7fd18a; } .bad { color: #ef8a8a; } .warn { color: #e5c07b; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 99px;
           border: 1px solid #2c3648; font-size: 11px; color: #9aa1ad; }
`

const SHELL_TOOLS = `
  async function api(path, options) {
    const response = await fetch('/a2a/api/' + path, {
      headers: { 'content-type': 'application/json' },
      ...options,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    })
    let payload = null
    try { payload = await response.json() } catch { /* 非 JSON 按原文 */ }
    if (!response.ok) throw new Error(payload?.error || payload?.message || ('HTTP ' + response.status))
    return payload?.data !== undefined ? payload.data : payload
  }
  function el(id) { return document.getElementById(id) }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  }
  function toast(host, text, bad) {
    host.textContent = text
    host.className = bad ? 'bad' : 'ok'
    setTimeout(() => { host.textContent = '' }, 6000)
  }
`

function shell(title, active, body, script) {
  const link = (href, label) =>
    `<a href="${href}"${href === active ? ' style="color:#e7e9ee;background:#1d222c"' : ''}>${label}</a>`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Agent2API 控制台</title>
<style>${SHELL_CSS}</style></head>
<body>
<header>
  <h1>Agent2API 控制台</h1>
  <nav>
    ${link('/a2a', '账号管理')}${link('/a2a/checkin', '签到中心')}${link('/a2a/tasks', '任务中心')}
  </nav>
</header>
<main>${body}</main>
<script>
${SHELL_TOOLS}
${script}
</script>
</body></html>`
}

/* ─── 页面一：账号管理 ─────────────────────────────── */

const ACCOUNTS_BODY = `
<div class="card">
  <h2>账号队列</h2>
  <div class="row" style="margin-bottom:10px">
    <button id="btn-refresh">刷新列表</button>
    <button id="btn-usage">查询全部余额</button>
    <button id="btn-refresh-expiring">刷新临期凭证</button>
    <button id="btn-export">导出全部</button>
    <span id="accounts-status" class="muted"></span>
  </div>
  <div style="overflow:auto"><table id="accounts-table">
    <thead><tr>
      <th>名称</th><th>提供商</th><th>优先级</th><th>状态</th><th>操作</th>
    </tr></thead><tbody><tr><td colspan="5" class="muted">加载中…</td></tr></tbody>
  </table></div>
</div>
<div class="card">
  <h2>添加账号（粘贴凭证 JSON）</h2>
  <p class="muted">复杂登录流（网页 OAuth / 设备授权 / 短信）仍走网关的登录接口；
  这里支持直接粘贴带 accessToken / refreshToken 的 JSON（provider 必填）。</p>
  <textarea id="add-json" placeholder='{"provider":"workbuddy","accessToken":"...","refreshToken":"..."}'></textarea>
  <div class="row" style="margin-top:8px">
    <button id="btn-add">添加</button>
    <button id="btn-import">导入（合并）</button>
    <span id="add-status" class="muted"></span>
  </div>
</div>
`

const ACCOUNTS_SCRIPT = `
const status = el('accounts-status')
async function load() {
  status.textContent = '加载中…'
  try {
    const data = await api('accounts')
    const rows = (data.accounts || []).map(a => {
      const off = a.enabled === false
      const id = esc(a.id)
      return '<tr class="' + (off ? 'off' : '') + '">' +
        '<td>' + esc(a.name || a.nickname || a.id) +
          (a.available === false ? ' <span class="badge">不可用</span>' : '') + '</td>' +
        '<td>' + esc(a.providerLabel || a.provider || '') + '</td>' +
        '<td class="mono">' + esc(a.priority ?? '-') + '</td>' +
        '<td>' + (off ? '停用' : '<span class="ok">启用</span>') +
          (a.balance != null ? ' <span class="muted">' + esc(a.balance) + '</span>' : '') + '</td>' +
        '<td class="row">' +
          '<button data-act="toggle" data-id="' + id + '" data-on="' + (off ? '0' : '1') + '">' + (off ? '启用' : '停用') + '</button>' +
          '<button data-act="top" data-id="' + id + '">置顶</button>' +
          '<button data-act="refresh" data-id="' + id + '">刷新凭证</button>' +
          '<button data-act="usage" data-id="' + id + '">余额</button>' +
          '<button class="danger" data-act="del" data-id="' + id + '">删除</button>' +
        '</td></tr>'
    })
    el('accounts-table').querySelector('tbody').innerHTML =
      rows.length ? rows.join('') : '<tr><td colspan="5" class="muted">还没有账号</td></tr>'
    status.textContent = (data.accounts || []).length + ' 个账号'
  } catch (error) { toast(status, '读取失败：' + error.message, true) }
}
el('btn-refresh').onclick = load
el('btn-usage').onclick = async () => {
  status.textContent = '查询余额中…'
  try { await api('accounts/usage'); await load() } catch (e) { toast(status, e.message, true) }
}
el('btn-refresh-expiring').onclick = async () => {
  status.textContent = '刷新临期凭证中…'
  try { const r = await api('accounts/refresh-expiring', { method: 'POST', body: {} }); toast(status, '已触发刷新') } catch (e) { toast(status, e.message, true) }
}
el('btn-export').onclick = async () => {
  try {
    const data = await api('accounts/export')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'agent2api-accounts.json'; a.click()
  } catch (e) { toast(status, e.message, true) }
}
el('accounts-table').addEventListener('click', async event => {
  const button = event.target.closest('button[data-act]')
  if (!button) return
  const id = button.dataset.id
  const act = button.dataset.act
  button.disabled = true
  try {
    if (act === 'toggle') await api('accounts/' + encodeURIComponent(id), { method: 'PATCH', body: { enabled: button.dataset.on !== '1' } })
    if (act === 'top') await api('accounts/current', { method: 'POST', body: { id } })
    if (act === 'refresh') { status.textContent = '刷新中…'; await api('accounts/refresh', { method: 'POST', body: { id } }) }
    if (act === 'usage') { const r = await api('accounts/usage?id=' + encodeURIComponent(id)); toast(status, JSON.stringify(r)) }
    if (act === 'del') { if (!confirm('确定删除该账号？')) { button.disabled = false; return }
                         await api('accounts/' + encodeURIComponent(id), { method: 'DELETE' }) }
    await load()
  } catch (e) { toast(status, e.message, true); button.disabled = false }
})
async function submitPayload(path) {
  const text = el('add-json').value.trim()
  const host = el('add-status')
  if (!text) { toast(host, '请先粘贴 JSON', true); return }
  let payload
  try { payload = JSON.parse(text) } catch (e) { toast(host, 'JSON 解析失败：' + e.message, true); return }
  try {
    await api(path, { method: 'POST', body: payload })
    toast(host, '完成'); el('add-json').value = ''; load()
  } catch (e) { toast(host, e.message, true) }
}
el('btn-add').onclick = () => submitPayload('accounts')
el('btn-import').onclick = () => submitPayload('accounts/import')
load()
`

/* ─── 页面二：签到中心 ─────────────────────────────── */

const CHECKIN_BODY = `
<div class="card">
  <h2>签到总览</h2>
  <div class="row" style="margin-bottom:10px">
    <button id="btn-all">全部签到</button>
    <button id="btn-refresh">刷新</button>
    <button id="btn-auto-run">跑一次自动签到</button>
    <span id="checkin-status" class="muted"></span>
  </div>
  <div style="overflow:auto"><table id="checkin-table">
    <thead><tr><th>提供商</th><th>账号数</th><th>今日已签</th><th>操作</th></tr></thead>
    <tbody><tr><td colspan="4" class="muted">加载中…</td></tr></tbody>
  </table></div>
</div>
<div class="card">
  <h2>签到记录</h2>
  <div style="overflow:auto"><table id="records-table">
    <thead><tr><th>时间</th><th>账号</th><th>提供商</th><th>结果</th></tr></thead>
    <tbody><tr><td colspan="4" class="muted">加载中…</td></tr></tbody>
  </table></div>
</div>
`

const CHECKIN_SCRIPT = `
const status = el('checkin-status')
async function load() {
  try {
    const center = await api('checkin-center')
    const groups = center.groups || center.providers || []
    const rows = groups.map(g => '<tr><td>' + esc(g.label || g.provider) + '</td>' +
      '<td class="mono">' + esc(g.total ?? g.count ?? '-') + '</td>' +
      '<td class="mono">' + esc(g.done ?? g.checkedIn ?? '-') + '</td>' +
      '<td><button data-provider="' + esc(g.provider) + '">签到这家</button></td></tr>')
    el('checkin-table').querySelector('tbody').innerHTML =
      rows.length ? rows.join('') : '<tr><td colspan="4" class="muted">暂无数据（或没有可签到的账号）</td></tr>'
  } catch (e) { toast(status, e.message, true) }
  try {
    const records = await api('checkin-records?limit=50')
    const list = records.records || records.items || records || []
    const rows = (Array.isArray(list) ? list : []).slice(0, 50).map(r =>
      '<tr><td class="muted">' + esc(new Date(Number(r.ts) || r.createdAt || 0).toLocaleString()) + '</td>' +
      '<td>' + esc(r.accountName || r.account || '-') + '</td>' +
      '<td>' + esc(r.provider || '') + '</td>' +
      '<td class="' + (r.outcome === 'ok' || r.success ? 'ok' : 'bad') + '">' +
        esc(r.message || r.outcome || (r.success ? '成功' : '失败')) + '</td></tr>')
    el('records-table').querySelector('tbody').innerHTML =
      rows.length ? rows.join('') : '<tr><td colspan="4" class="muted">还没有签到记录</td></tr>'
  } catch (e) { /* 记录表失败不挡总览 */ }
}
el('btn-refresh').onclick = load
el('btn-all').onclick = async () => {
  status.textContent = '签到执行中（串行，可能较慢）…'
  try { await api('accounts/checkin', { method: 'POST', body: {} }); toast(status, '已触发全部签到'); load() }
  catch (e) { toast(status, e.message, true) }
}
el('btn-auto-run').onclick = async () => {
  try { await api('auto-checkin/run', { method: 'POST', body: {} }); toast(status, '已触发') ; load() }
  catch (e) { toast(status, e.message, true) }
}
el('checkin-table').addEventListener('click', async event => {
  const button = event.target.closest('button[data-provider]')
  if (!button) return
  button.disabled = true
  try { await api('accounts/checkin', { method: 'POST', body: { provider: button.dataset.provider } }); load() }
  catch (e) { toast(status, e.message, true); button.disabled = false }
})
load()
`

/* ─── 页面三：任务中心 ─────────────────────────────── */

const TASKS_BODY = `
<div class="card">
  <h2>猫猫旅行（WorkBuddy 国内版 · 成长任务）</h2>
  <div class="row">
    <button id="btn-travel-run">立即巡检（领养 / 派出 / 领奖）</button>
    <button id="btn-travel-state">读取排程状态</button>
    <span id="travel-status" class="muted"></span>
  </div>
  <pre id="travel-out" hidden></pre>
</div>
<div class="card">
  <h2>按账号执行任务</h2>
  <p class="muted">对指定账号执行成长任务 / 学院活动 / ZCode 套餐领取 / CodeArts 福利 / 新人引导领取。
  上游按天幂等，重复执行得到「今日已完成」的如实响应。</p>
  <div class="row" style="margin-bottom:10px">
    <select id="task-account" style="background:#0c0e12;color:#dfe4ec;border:1px solid #2c3648;border-radius:6px;padding:4px 8px"></select>
    <button data-task="growth">成长任务状态</button>
    <button data-task="growth-task">执行成长任务</button>
    <button data-task="growth-school">学院活动</button>
    <button data-task="growth-travel">旅行收尾</button>
    <button data-task="zcode-preview">ZCode 领取预览</button>
    <button data-task="zcode-claim">ZCode 领取</button>
    <button data-task="welfare-preview">CodeArts 福利预览</button>
    <button data-task="welfare">CodeArts 领福利</button>
    <button data-task="onboarding">新人引导领取</button>
  </div>
  <pre id="task-out">选择账号后点击动作。</pre>
</div>
`

const TASKS_SCRIPT = `
const status = el('travel-status')
const out = el('task-out')
async function loadAccounts() {
  try {
    const data = await api('accounts')
    const select = el('task-account')
    select.innerHTML = (data.accounts || []).map(a =>
      '<option value="' + esc(a.id) + '">' + esc((a.name || a.id) + ' · ' + (a.providerLabel || a.provider)) + '</option>'
    ).join('') || '<option value="">（没有账号）</option>'
  } catch (e) { out.textContent = '账号列表读取失败：' + e.message }
}
el('btn-travel-run').onclick = async () => {
  status.textContent = '巡检中…'
  try {
    const r = await api('travel-schedule/run', { method: 'POST', body: {} })
    const pre = el('travel-out'); pre.hidden = false; pre.textContent = JSON.stringify(r, null, 2)
    toast(status, '完成')
  } catch (e) { toast(status, e.message, true) }
}
el('btn-travel-state').onclick = async () => {
  try {
    const r = await api('travel-schedule')
    const pre = el('travel-out'); pre.hidden = false; pre.textContent = JSON.stringify(r, null, 2)
  } catch (e) { toast(status, e.message, true) }
}
document.querySelectorAll('button[data-task]').forEach(button => {
  button.onclick = async () => {
    const id = el('task-account').value
    if (!id) { out.textContent = '没有可用账号。'; return }
    const task = button.dataset.task
    button.disabled = true
    out.textContent = '执行中…（' + button.textContent + '）'
    try {
      let result
      if (task === 'growth') result = await api('accounts/' + encodeURIComponent(id) + '/growth')
      if (task === 'growth-task') result = await api('accounts/' + encodeURIComponent(id) + '/growth/task', { method: 'POST', body: {} })
      if (task === 'growth-school') result = await api('accounts/' + encodeURIComponent(id) + '/growth/school', { method: 'POST', body: {} })
      if (task === 'growth-travel') result = await api('accounts/' + encodeURIComponent(id) + '/growth/travel', { method: 'POST' })
      if (task === 'zcode-preview') result = await api('accounts/' + encodeURIComponent(id) + '/zcode-claim/preview')
      if (task === 'zcode-claim') result = await api('accounts/' + encodeURIComponent(id) + '/zcode-claim', { method: 'POST', body: {} })
      if (task === 'welfare-preview') result = await api('accounts/' + encodeURIComponent(id) + '/codearts-welfare/preview')
      if (task === 'welfare') result = await api('accounts/' + encodeURIComponent(id) + '/codearts-welfare', { method: 'POST', body: {} })
      if (task === 'onboarding') result = await api('accounts/' + encodeURIComponent(id) + '/onboarding/claim', { method: 'POST', body: {} })
      out.textContent = JSON.stringify(result, null, 2)
    } catch (e) {
      out.textContent = '失败：' + e.message
    } finally { button.disabled = false }
  }
})
loadAccounts()
`

/** 出指定页面的完整 HTML */
export function pageHtml(page) {
  if (page === 'checkin') return shell('签到中心', '/a2a/checkin', CHECKIN_BODY, CHECKIN_SCRIPT)
  if (page === 'tasks') return shell('任务中心', '/a2a/tasks', TASKS_BODY, TASKS_SCRIPT)
  return shell('账号管理', '/a2a', ACCOUNTS_BODY, ACCOUNTS_SCRIPT)
}
