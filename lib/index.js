/**
 * dsh-plugin-a2a-console —— Agent2API 控制台（账号管理 / 签到 / 任务）
 *
 * 形态：adapter 插件。agent2api 保持独立进程运行（引擎 + 全部管理 API），
 * 本插件在 dsh 里提供这三块功能的面板页面、同源代理与定时调度 ——
 * 与 dsh 生态的 dsh-plugin-ai-gateway（插件包装外部网关服务）同一架构。
 *
 * 页面（浏览器原生模块，见 lib/client.js）：
 *   GET /a2a            账号管理
 *   GET /a2a/checkin    签到中心
 *   GET /a2a/tasks      任务中心
 *   GET /a2a/ready      健康探针（检查 agent2api /health，供 healthPath 用）
 *
 * 代理（同源，Key 在服务端注入，浏览器不接触网关 Key）：
 *   ANY /a2a/api/*  →  agent2api /api/*（只放行 /api 前缀，/v1 转发面不经这里）
 *
 * 定时（lib/scheduler.js，配置开关驱动）：每日签到 / 猫猫旅行巡检。
 *
 * 硬约束：管理 API 的响应原样透传（包括错误状态码与 JSON 信封），
 * 页面自己解 { success, data } 信封 —— 代理不做二次包装，两侧行为可对照。
 */

/**
 * 配置 Schema：dsh 宿主提供 @deepseek-ai/schemastery（与 dsh-plugin-ai-gateway
 * 同款、零运行时依赖）。宿主外（本地 node 直接加载 / 自检）退到内置的等价
 * 描述器 —— 只承担「声明字段与默认值」，不做校验。
 */
const Schema = await import('@deepseek-ai/schemastery')
  .then(module => module.default ?? module)
  .catch(() => localSchema())

function localSchema() {
  const chain = () => {
    const api = { default: value => (api._default = value, api), description: () => api }
    return api
  }
  return {
    object: shape => ({ _shape: shape, _local: true }),
    string: chain, number: chain, boolean: chain,
  }
}

export const name = 'a2a-console'
export const inject = ['webServer']

import { pageHtml } from './client.js'
import { startScheduler } from './scheduler.js'

/**
 * 配置。apiKey 是 agent2api 的网关 Key（建议在管理页单独建一把
 * 「dsh 插件」用途的 Key，只授给它需要的范围）。
 */
export const Config = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:3065').description('agent2api 地址'),
  apiKey: Schema.string().default('').description('agent2api 网关 Key（留空 = 免鉴权模式）'),
  timeoutMs: Schema.number().default(60000).description('转发管理请求的超时（毫秒）'),
  allowRemote: Schema.boolean().default(false).description('允许非同源浏览器访问面板（默认仅同源）'),
  autoCheckin: Schema.boolean().default(false).description('由插件每日定时执行全部签到'),
  checkinTime: Schema.string().default('09:00').description('定时签到的每日时刻（HH:mm）'),
  autoTravel: Schema.boolean().default(false).description('由插件每日定时巡检猫猫旅行（派出/领奖）'),
  travelTimes: Schema.string().default('09:00,21:00').description('旅行巡检时刻列表（逗号分隔 HH:mm）'),
})

/** 代理转发：method/body/headers → agent2api，响应透传。只吃 /api 前缀。 */
async function proxyApi(config, req, res, subPath) {
  const target = `${config.baseUrl.replace(/\/+$/, '')}/api/${subPath.replace(/^\/+/, '')}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs))
  let upstream
  try {
    upstream = await fetch(target, {
      method: req.method,
      signal: controller.signal,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        ...(config.apiKey
          ? { authorization: `Bearer ${config.apiKey}`, 'x-api-key': config.apiKey }
          : {}),
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req),
    })
  } catch (error) {
    clearTimeout(timer)
    sendJson(res, 502, { success: false, error: `agent2api 不可达: ${describeError(error)}` })
    return
  }
  clearTimeout(timer)
  const body = Buffer.from(await upstream.arrayBuffer())
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') || 'application/json',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function describeError(error) {
  if (error?.name === 'AbortError') return `请求超时（${Math.max(1000, 0)}ms 上限由配置决定）`
  return String(error?.cause?.code || error?.message || error)
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(body)
}

function sendHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html)
}

/** 同源判定：面板页面只允许同源访问（与 dsh-plugin-ai-gateway 的做法一致）。 */
function sameOrigin(req) {
  const host = req.headers.host
  const origin = req.headers.origin || req.headers.referer
  if (!origin) return true // 非浏览器（探针 / 同源 fetch 不一定带 Origin）
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** 健康探针：agent2api 活着就 200，否则 503。不做鉴权、不泄数据。 */
async function ready(config, res) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (response.ok) sendJson(res, 200, { ok: true })
    else sendJson(res, 503, { ok: false, status: response.status })
  } catch {
    clearTimeout(timer)
    sendJson(res, 503, { ok: false })
  }
}

export function apply(ctx) {
  const config = ctx.config || {}
  const log = (...args) => ctx.logger?.info?.('[a2a-console]', ...args)

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: '/a2a',
      handler: (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const path = url.pathname
        // 页面与代理都在 /a2a 前缀下；探针之外的浏览器请求做同源校验
        if (path === '/a2a/ready') {
          void ready(config, res)
          return
        }
        if (!sameOrigin(req) && !config.allowRemote) {
          sendJson(res, 403, { success: false, error: '仅允许同源访问（allowRemote 可放开）' })
          return
        }
        if (req.method === 'GET' && (path === '/a2a' || path === '/a2a/')) {
          sendHtml(res, pageHtml('accounts'))
          return
        }
        if (req.method === 'GET' && path === '/a2a/checkin') {
          sendHtml(res, pageHtml('checkin'))
          return
        }
        if (req.method === 'GET' && path === '/a2a/tasks') {
          sendHtml(res, pageHtml('tasks'))
          return
        }
        if (path.startsWith('/a2a/api/')) {
          void proxyApi(config, req, res, path.slice('/a2a/api'.length))
          return
        }
        sendJson(res, 404, { success: false, error: `Not found: ${req.method} ${path}` })
      },
    })
    log(`面板就绪：/a2a（账号） /a2a/checkin（签到） /a2a/tasks（任务） → ${config.baseUrl}`)

    const stopScheduler = startScheduler(ctx)
    return () => {
      dispose?.()
      stopScheduler()
    }
  })
}
