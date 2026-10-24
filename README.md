# dsh-plugin-a2a-console

Agent2API 控制台 —— **账号管理 / 签到 / 任务**三大功能从 agent2api 面板剥离后的 dsh（DeepSeek Harness）插件形态。

## 架构

```
┌─ dsh 宿主 ──────────────────────────────┐
│  本插件（Cordis, inject: webServer）      │
│   ├─ /a2a          账号管理页 ┐           │
│   ├─ /a2a/checkin  签到中心页 ├ 同源页面   │
│   ├─ /a2a/tasks    任务中心页 ┘           │
│   ├─ /a2a/api/*    反向代理 ──┐（服务端注入网关 Key）│
│   ├─ /a2a/ready    健康探针   │           │
│   └─ 定时调度（每日签到 / 旅行巡检）        │
└──────────────┬──────────────────────────┘
               ▼ HTTP（管理 API /api/*）
        agent2api（保持独立运行，引擎不动）
```

agent2api 侧**只剥了面板里的三个页面**（导航 + 区块，见对仓库 `desktop-tauri/ui/` 的改动）；
全部后端能力原样保留，插件经 `/api/*` 驱动同一套实现 —— 判定、幂等、风控串行这些
语义都还是网关的，插件只负责「页面 + 到点触发」。

## 安装

官方 CLI（dsh.so 插件市场路径）：

```bash
dsh plugin --profile web add dsh-plugin-a2a-console
```

或本地开发（本目录）：

```bash
npm run build          # 语法自检（scripts/build.mjs）
dsh plugin --profile web add /path/to/dsh-plugin-a2a-console
```

## 配置（Cordis Config）

| 键 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:3065` | agent2api 地址 |
| `apiKey` | 空 | agent2api 网关 Key（建议单独建一把「dsh 插件」用途的 Key；留空 = 网关免鉴权模式） |
| `timeoutMs` | `60000` | 管理请求超时（签到这类串行批量接口较慢，默认给足） |
| `allowRemote` | `false` | 面板仅同源访问；放开前先读下面的安全一节 |
| `autoCheckin` | `false` | 插件每日定时执行全部签到 |
| `checkinTime` | `09:00` | 签到时刻（HH:mm） |
| `autoTravel` | `false` | 插件每日定时巡检猫猫旅行（领养 / 派出 / 领奖） |
| `travelTimes` | `09:00,21:00` | 旅行巡检时刻（逗号分隔） |

> 定时开关打开时，请把 agent2api 设置里**它自己的**「定时签到 / 旅行排程」关掉 ——
> 两边都开会重复触发（上游按天幂等，不会重复领取，但白打上游）。

## 页面与能力对照

| 插件页面 | 能力 | agent2api API |
|---|---|---|
| 账号管理 | 列表 / 启停 / 置顶 / 删除 / 刷新凭证 / 临期批量刷新 / 余额（含全部） / 导出 / 导入 / 粘贴 JSON 添加 | `/api/accounts*` |
| 签到中心 | 总览快照 / 全部签到 / 按家签到 / 记录 / 跑一次自动签到 | `/api/checkin-center`、`/api/accounts/checkin`、`/api/checkin-records`、`/api/auto-checkin/run` |
| 任务中心 | 猫猫旅行巡检与排程 / 按账号：成长任务、学院活动、旅行收尾、ZCode 套餐领取、CodeArts 福利、新人引导领取 | `/api/travel-schedule*`、`/api/accounts/{id}/growth*`、`/zcode-claim*`、`/codearts-welfare*`、`/onboarding/claim` |

复杂的网页登录流（OAuth / 设备授权 / 短信）没有搬进插件：那些流程要开授权窗口并接
回调，留在网关侧最稳；插件里拿到凭证后可直接粘贴添加。

## 安全

- 网关 Key 只存在于插件服务端配置，页面浏览器侧不接触；代理只放行 `/api` 前缀，
  `/v1` 转发面不经插件。
- 页面默认仅同源访问（校验 Origin/Referer 与 Host 一致）；`allowRemote: true` 放开前
  请确认 dsh 站点自身有认证边界（`deepseekPlugin.permissions` 声明了
  `a2a-console:access`，但按 dsh 约定**声明不自动保护路由**，访问控制由宿主/业务侧落实）。

## 双清单说明

`package.json` 同时带了两套声明：`dsh` 字段（官方 CLI / 插件市场路径，与
dsh-plugin-ai-gateway 同款）与 `deepseekPlugin`（schemaVersion 3，社区
dsh-plugin-manager 的 pack/verify 路径）。走哪条交付路径就用哪套，互不干扰。

## 健康探针

`GET /a2a/ready`：agent2api `/health` 可达即 200，否则 503 —— 供 healthPath 用，
不做鉴权、不泄数据。
