/**
 * 定时调度：每日签到与猫猫旅行巡检。
 *
 * ── 为什么由插件做（而不是 agent2api 自己的定时任务）──────────
 * 三大功能剥离到插件后，「定时执行」也跟着走：agent2api 侧的
 * auto-checkin / growth-scheduler 开关保持关闭（它们本来就可配），
 * 统一由这里的调度驱动同一批手动接口 —— 判定与执行仍是网关的，
 * 插件只负责「到点触发」。
 *
 * ── 幂等与去重 ──────────────────────────────────────────────
 * 进程内按「日期 + 任务」去重（重启会重跑一次当天的任务，但
 * agent2api 的签到与领奖接口本身按天幂等 —— 重复触发只会得到
 * 「今天已签」的如实响应，不产生重复领取）。
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 今天本地日期的 HH:mm 是否已到点（含） */
function dueNow(times, now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return times.some(time => {
    const [h, m] = String(time).split(':').map(part => Number(part))
    if (!Number.isFinite(h) || !Number.isFinite(m)) return false
    return minutes >= h * 60 + m
  })
}

function parseTimes(text) {
  return String(text || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function todayKey(now = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 调用 agent2api 的管理接口（与 index.js 的代理同一套头注入）。
 * 返回 { status, body }；异常不抛出（调度循环不能被一次失败打断）。
 */
async function callApi(config, path, method = 'POST', body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs || 60000))
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey
          ? { authorization: `Bearer ${config.apiKey}`, 'x-api-key': config.apiKey }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    clearTimeout(timer)
    let payload = null
    try {
      payload = await response.json()
    } catch {
      /* 非 JSON 响应按 null 处理，状态码仍然如实 */
    }
    return { status: response.status, body: payload }
  } catch (error) {
    clearTimeout(timer)
    return { status: 0, body: { message: String(error?.cause?.code || error?.message || error) } }
  }
}

/**
 * 启动调度循环。返回停止函数（apply 的 effect 清理时调用）。
 */
export function startScheduler(ctx) {
  const config = ctx.config || {}
  const log = (...args) => ctx.logger?.info?.('[a2a-console/sched]', ...args)
  const warn = (...args) => ctx.logger?.warn?.('[a2a-console/sched]', ...args)
  /** 已完成的「日期 + 任务」标记（进程内） */
  const done = new Set()

  const jobs = [
    {
      key: 'checkin',
      enabled: () => config.autoCheckin === true,
      times: () => parseTimes(config.checkinTime || '09:00'),
      // 全部账号签到：串行语义由网关侧保证（避免多账号并发触发风控）
      run: async () => callApi(config, 'accounts/checkin', 'POST', {}),
      describe: result =>
        `每日签到 HTTP ${result.status}${result.body?.message ? `：${result.body.message}` : ''}`,
    },
    {
      key: 'travel',
      enabled: () => config.autoTravel === true,
      times: () => parseTimes(config.travelTimes || '09:00,21:00'),
      // 猫猫旅行巡检（无猫领养 / idle 派出 / arrived 领奖），网关按天幂等
      run: async () => callApi(config, 'travel-schedule/run', 'POST', {}),
      describe: result =>
        `旅行巡检 HTTP ${result.status}${result.body?.message ? `：${result.body.message}` : ''}`,
    },
  ]

  const tick = () => {
    const day = todayKey()
    for (const job of jobs) {
      if (!job.enabled()) continue
      const mark = `${day}:${job.key}`
      if (done.has(mark)) continue
      if (!dueNow(job.times())) continue
      done.add(mark)
      job.run().then(result => {
        if (result.status >= 200 && result.status < 300) log(job.describe(result))
        else warn(job.describe(result))
      })
    }
    // 防止标记表跨月无限增长（保留最近两天即可）
    if (done.size > 16) {
      const keep = new Set([...done].filter(mark => mark.startsWith(day)))
      done.clear()
      for (const mark of keep) done.add(mark)
    }
  }

  const timer = setInterval(tick, 60 * 1000)
  timer.unref?.()
  tick()
  return () => clearInterval(timer)
}

// 供页面「立即执行」复用同一调用器
export { callApi }
