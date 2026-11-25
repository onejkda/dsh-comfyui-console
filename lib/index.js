// DSH ComfyUI 控制台 · host 端
//
// 一句话：**给几张素材，它自己认工作流、自己接槽、自己跑。**
//
// 设计口径：
//   1. 只登记点名要用的工作流，别的流一眼不看。
//   2. 识别与配对是**工具自己的内置能力**，不是每次由模型人肉配对。
//   3. 豆包画布式：给 1 张图就接 1 个图槽，给 2 张图 1 段视频就接 2 图 1 视频；
//      AGV（COMFY_AUTOGROW_V3）槽位必须**从 0 开始连续**，多出来的旧接线全摘掉。
//   4. 只报秒，不报帧 —— 秒数节点（PrimitiveFloat / duration）直接填秒，换算交给工作流自己。
//   5. 模板里的默认值一律不管；不改用户本地 ComfyUI 的任何文件；
//      只有用户明确要求时才改工作流参数（步数等），改动记在返回里。
//
// 为什么不用 @deepseek-ai/dsh-tools：这台机器的 profile node_modules 里没有它
// （`ERR_MODULE_NOT_FOUND`，@deepseek-ai 下只有 cosmokit / schemastery）。
// 所以照 dsh-qq-link 的路子走：`agent.ctx.tools.register({...})` + 心跳挂载。

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, statSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, extname, resolve, sep } from 'node:path'

export const name = 'dsh-comfyui-console'
export const inject = ['webServer', 'timer', 'agents']

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 配置路径 = join(目录, 'comfyui-canvas.json')
const 工作流目录 = join(目录, 'comfyui-workflows')

const 默认配置 = {
  baseUrl: 'http://127.0.0.1:8188',
  // 素材/产物目录不在代码里写死某台机器的绝对路径；新机器首次使用时在面板「设置」里填本机 ComfyUI 的 input / output。
  inputDir: '',
  outputDir: '',
  workflows: [], // [{ id, name, file, note }]
  隐藏历史: [], // 面板上手动移除的已结束任务 prompt_id；只隐藏面板记录，不删磁盘产物文件
  // 跑完是否主动通知：true = 唤醒当前会话汇报，会话不可用时兜底直发配置好的 IM 桥；false = 只更新台账与产物，不打扰任何人。
  notifyOnDone: true,
}

// 产物墙只回最近 N 个（按修改时间倒序）；output 目录攒上千个文件时不全量回传
const 产物最近限量 = 60

// ───────────────────────── 小工具 ─────────────────────────

const 读JSON = (p) => {
  try {
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

const 写JSON = (p, o) => {
  try {
    const 临时 = p + '.tmp-' + Date.now()
    writeFileSync(临时, JSON.stringify(o, null, 2), 'utf8')
    renameSync(临时, p)
    return true
  } catch {
    return false
  }
}

const 读配置 = () => ({ ...默认配置, ...(读JSON(配置路径) || {}) })
const 写配置 = (c) => 写JSON(配置路径, { ...默认配置, ...c })

// 已被面板移除的任务 prompt_id 集合（持久化在配置里；只隐藏记录，不删 output 目录里的产物文件）
const 隐藏上限 = 5000
const 读隐藏集合 = () => {
  const c = 读配置()
  return Array.isArray(c.隐藏历史) ? c.隐藏历史.map(文本).filter(Boolean) : []
}
const 存隐藏集合 = (ids) => {
  const 去重 = [...new Set((ids || []).map(文本).filter(Boolean))]
  const 裁剪 = 去重.length > 隐藏上限 ? 去重.slice(去重.length - 隐藏上限) : 去重
  const c = 读配置()
  c.隐藏历史 = 裁剪
  写配置(c)
  return 裁剪
}

const 文本 = (x) => (x == null ? '' : String(x))
const 目录已配 = (v) => 文本(v).trim().length > 0

const 是链接 = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number'

const 新id = (graph) => {
  let 大 = 0
  for (const k of Object.keys(graph)) {
    const n = Number(k)
    if (Number.isFinite(n) && n > 大) 大 = n
  }
  return String(大 + 1)
}

// 秒 → 帧（H3 要求 17n+5）
const 秒变帧 = (秒) => {
  const 粗 = Math.max(5, Math.round(Number(秒) * 24))
  return 粗 + ((5 - (粗 % 17)) % 17 + 17) % 17
}

// ───────────────────── ComfyUI HTTP 客户端 ─────────────────────

// ───────────────────── 节点档案（object_info）本地缓存 ─────────────────────
// 档案体积大（全量 8~10MB）、冷启动首拉约 3 秒；落盘到配置目录，二次启动读本地盘，
// 内存层只作短时复用。读取顺序：内存 → 磁盘 → 网络；并发分析共享同一个在途请求。
const 档案缓存路径 = join(目录, 'comfyui-object-info-cache.json')
let 档案内存 = { at: 0, data: null, baseUrl: '' }
let 档案在途 = null
const 档案内存有效期 = 30 * 60 * 1000

// 口值裁剪：COMBO 留选项数组；AGV 槽留规格（template/prefix/max）；普通数值/字符串口只留类型，丢掉默认值、min/max/step、tooltip
function 裁剪口值(v) {
  if (typeof v === 'string') return v
  if (!Array.isArray(v)) return v
  const head = v[0]
  if (Array.isArray(head)) return [head] // COMBO：head 即选项数组
  let second = v[1]
  if (second && typeof second === 'object' && !Array.isArray(second)) {
    if (head === 'COMFY_AUTOGROW_V3') {
      const keep = {}
      for (const k of ['template', 'prefix', 'max']) if (k in second) keep[k] = second[k]
      second = Object.keys(keep).length ? keep : undefined
    } else if (second.options) {
      second = { options: second.options }
    } else {
      second = undefined
    }
  }
  return second === undefined ? [head] : [head, second]
}

function 裁剪输入(inp) {
  if (!inp || typeof inp !== 'object') return inp
  const out = {}
  for (const 段 of ['required', 'optional']) {
    if (!inp[段]) continue
    out[段] = {}
    for (const [k, v] of Object.entries(inp[段])) out[段][k] = 裁剪口值(v)
  }
  return out
}

// 分层裁剪：核心识别字段（input/output/output_name）必留；display_name/category 体积小，留着供以后分组/展示
function 裁剪档案(原始) {
  const out = {}
  for (const [cls, def] of Object.entries(原始 || {})) {
    if (!def || typeof def !== 'object') continue
    const o = {}
    if (def.input != null) o.input = 裁剪输入(def.input)
    if (def.output != null) o.output = def.output
    if (def.output_name != null) o.output_name = def.output_name
    if (def.display_name != null) o.display_name = def.display_name
    if (def.category != null) o.category = def.category
    out[cls] = o
  }
  return out
}

async function 读磁盘档案(baseUrl) {
  const c = 读JSON(档案缓存路径)
  if (!c || !c.档案 || !c.指纹 || c.指纹.baseUrl !== baseUrl) return null
  if (typeof c.档案 !== 'object') return null
  // 实例升级 / 增删节点插件后，旧档案自动失效重拉；探不到当前版本（纯离线）时保留旧档案兜底
  const 旧版 = c.指纹.版本 || null
  let 新版 = null
  try {
    const 探 = await 探活(baseUrl)
    if (探 && 探.通) 新版 = 探.comfyui || null
  } catch {}
  if (新版 && 旧版 && 新版 !== 旧版) return null
  return c.档案
}

function 写磁盘档案(baseUrl, 档案, 版本, 类数) {
  try {
    const 临时 = 档案缓存路径 + '.tmp-' + Date.now()
    // 落盘不做美化缩进，缩小体积、加快读盘解析
    writeFileSync(临时, JSON.stringify({ 指纹: { baseUrl, 拉取时间: Date.now(), 版本: 版本 || null, 类数: 类数 || 0 }, 档案 }), 'utf8')
    renameSync(临时, 档案缓存路径)
  } catch {}
}

async function 拉取档案(baseUrl) {
  const r = await fetch(baseUrl.replace(/\/+$/, '') + '/object_info', { signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error('取 /object_info 失败：HTTP ' + r.status)
  const 原始 = await r.json()
  const 档案 = 裁剪档案(原始)
  let 版本 = null
  try {
    const 探 = await 探活(baseUrl)
    if (探 && 探.通) 版本 = 探.comfyui || null
  } catch {}
  写磁盘档案(baseUrl, 档案, 版本, Object.keys(档案).length)
  档案内存 = { at: Date.now(), data: 档案, baseUrl }
  return 档案
}

async function 取对象信息(baseUrl, 强制 = false) {
  if (!强制 && 档案内存.data && 档案内存.baseUrl === baseUrl && Date.now() - 档案内存.at < 档案内存有效期) return 档案内存.data
  if (!强制) {
    const 磁盘 = await 读磁盘档案(baseUrl)
    if (磁盘) {
      档案内存 = { at: Date.now(), data: 磁盘, baseUrl }
      return 磁盘
    }
  }
  // 在途合并：已有请求在飞，并发方直接等同一个 Promise，不重复拉全量
  if (档案在途) return 档案在途
  档案在途 = (async () => {
    try {
      return await 拉取档案(baseUrl)
    } finally {
      档案在途 = null
    }
  })()
  return 档案在途
}

// 后台预热：插件起来后空闲时先把档案拉好落盘，进面板直接命中缓存；失败不影响面板
function 预热档案() {
  try {
    const { baseUrl } = 读配置()
    if (!目录已配(baseUrl)) return
    const t = setTimeout(function () {
      取对象信息(baseUrl).catch(function () {})
    }, 1500)
    if (typeof t.unref === 'function') t.unref()
  } catch {}
}

async function 探活(baseUrl) {
  try {
    const r = await fetch(baseUrl.replace(/\/+$/, '') + '/system_stats', { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return { 通: false, 为什么: 'HTTP ' + r.status }
    const j = await r.json()
    return {
      通: true,
      comfyui: j?.system?.comfyui_version,
      vram总: j?.devices?.[0]?.vram_total,
      vram闲: j?.devices?.[0]?.vram_free,
      设备: j?.devices?.[0]?.name,
    }
  } catch (e) {
    return { 通: false, 为什么: 文本(e?.name || e?.message || e) }
  }
}

async function 提交(baseUrl, graph) {
  const r = await fetch(baseUrl.replace(/\/+$/, '') + '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'dsh-comfyui-console' }),
    signal: AbortSignal.timeout(30000),
  })
  const t = await r.text()
  let j = null
  try { j = JSON.parse(t) } catch {}
  if (!r.ok) {
    const 细 = j?.node_errors ? JSON.stringify(j.node_errors).slice(0, 1200) : t.slice(0, 800)
    throw new Error('提交被拒（HTTP ' + r.status + '）：' + 细)
  }
  return j
}

async function 取历史(baseUrl, promptId) {
  const r = await fetch(baseUrl.replace(/\/+$/, '') + '/history/' + encodeURIComponent(promptId), {
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) return null
  const j = await r.json()
  return j?.[promptId] || null
}

// 一次拉全量 history：pid → 记录；重启后台账清空时用来回填任务归属与产物
async function 取全历史(baseUrl) {
  try {
    const r = await fetch(baseUrl.replace(/\/+$/, '') + '/history', { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return {}
    const j = await r.json()
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

// 队列快照：谁在跑、谁在等（查进度用，失败就当拿不到）
async function 取队列(baseUrl) {
  try {
    const r = await fetch(baseUrl.replace(/\/+$/, '') + '/queue', { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    const j = await r.json()
    const 跑 = Array.isArray(j?.queue_running) ? j.queue_running : []
    const 等 = Array.isArray(j?.queue_pending) ? j.queue_pending : []
    return { 正在跑: 跑.map((x) => 文本(Array.isArray(x) ? x[1] : '')), 在排队: 等.map((x) => 文本(Array.isArray(x) ? x[1] : '')) }
  } catch {
    return null
  }
}

// 回写本地台账终态：中断/取消后用来收敛界面状态，避免一直挂“跑着”
function 标记终态(pid, 状态) {
  const 记 = 作业.get(pid)
  if (记) 记.状态 = 状态
}

// 从队列摘掉指定排队任务；正在跑的摘不掉（要停当前走中断）
async function 取消排队(baseUrl, pid) {
  const 队 = await 取队列(baseUrl)
  if (!队) return { ok: false, 说: '拿不到队列（ComfyUI 连不上）' }
  if (队.正在跑.includes(pid)) return { ok: false, 说: '这条正在跑，排队摘不掉；要停当前任务请用中断。' }
  if (!队.在排队.includes(pid)) return { ok: false, 说: '队列里没有这个任务（可能已跑完、已取消或 id 不对）。' }
  const r = await fetch(baseUrl.replace(/\/+$/, '') + '/queue', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [pid] }), signal: AbortSignal.timeout(4000),
  })
  if (!r.ok) return { ok: false, 说: '取消失败（HTTP ' + r.status + '）' }
  标记终态(pid, 'cancelled')
  return { ok: true, 说: '已从队列取消：' + pid }
}

// 中断当前正在跑的任务（ComfyUI 一次只跑一条）
async function 中断当前(baseUrl) {
  const 队 = await 取队列(baseUrl)
  const r = await fetch(baseUrl.replace(/\/+$/, '') + '/interrupt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    signal: AbortSignal.timeout(4000),
  })
  if (!r.ok) return { ok: false, 说: '中断失败（HTTP ' + r.status + '）' }
  // 中断的任务不会写完整历史，本地台账直接收敛为已取消，避免界面一直挂“运行中”
  if (队) (队.正在跑 || []).forEach((pid) => 标记终态(pid, 'cancelled'))
  return { ok: true, 说: '已发出中断指令，当前正在跑的任务会停下（这条出不完，不会有完整产物）。' }
}

// 队列详情：保留原始项并把提交图带回来（兜底抠提示词摘要用）
async function 取队列详情(baseUrl) {
  try {
    const r = await fetch(baseUrl.replace(/\/+$/, '') + '/queue', { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    const j = await r.json()
    const 解 = (x) => {
      if (Array.isArray(x)) return { pid: 文本(x[1] || ''), 图: x[3] || null }
      return { pid: 文本(x?.prompt_id || ''), 图: x?.prompt || null }
    }
    return {
      正在跑: (Array.isArray(j?.queue_running) ? j.queue_running : []).map(解),
      在排队: (Array.isArray(j?.queue_pending) ? j.queue_pending : []).map(解),
    }
  } catch {
    return null
  }
}

// 从提交图里抠一段提示词摘要（CLIPTextEncode 类节点的 text）
function 抠摘要(图) {
  if (!图 || typeof 图 !== 'object') return ''
  const 段 = []
  for (const n of Object.values(图)) {
    const 类 = 文本(n?.class_type || '')
    if (/CLIPTextEncode|TextEncode|Prompt/i.test(类)) {
      const t = n?.inputs?.text ?? n?.inputs?.prompt ?? n?.inputs?.string
      if (typeof t === 'string' && t.trim()) 段.push(t.trim())
    }
  }
  return 段.join('，').replace(/\s+/g, ' ').trim().slice(0, 40)
}

// 本地登记流的 节点id → class_type 映射表，用于给 history 回填任务反推归属
function 建本地流表(配置) {
  const 表 = []
  for (const w of 配置.workflows || []) {
    try {
      const g = 读工作流图(w)
      const map = {}
      for (const [id, n] of Object.entries(g)) map[id] = n?.class_type
      表.push({ id: w.id, name: w.name || '', map })
    } catch { /* 单个流读失败就跳过，不影响其余 */ }
  }
  return 表
}

// 用节点 id+类型 一致数匹配本地流；历图运行时可能多出 LoRA 等节点，不计入一致数
function 匹配流(历图, 表) {
  if (!历图 || typeof 历图 !== 'object' || !表.length) return null
  const hIds = Object.keys(历图)
  if (!hIds.length) return null
  let 最佳 = null, 最佳同 = 0
  for (const 条 of 表) {
    let 同 = 0
    for (const id of hIds) {
      if (条.map[id] && 条.map[id] === 历图[id]?.class_type) 同++
    }
    if (同 > 最佳同) { 最佳同 = 同; 最佳 = 条 }
  }
  // 至少对上 4 个节点，且覆盖历图一半以上节点，才认定归属；否则宁可兜底未命名流
  if (!最佳 || 最佳同 < 4 || 最佳同 / hIds.length < 0.5) return null
  return 最佳
}

// 汇总全部作业：正在跑 + 排队 + 本地台账（含已完成），按状态排序
function 隐藏集合(配置) {
  return new Set(Array.isArray(配置.隐藏历史) ? 配置.隐藏历史.map(文本) : [])
}

// 一次汇总出全量任务行（含被手动隐藏的已结束任务）；普通组/全量组在外面按隐藏集合过滤
async function 构建汇总行(配置) {
  const baseUrl = 配置.baseUrl
  const 队 = await 取队列详情(baseUrl)
  const running = new Map(), pending = new Map()
  if (队) {
    队.正在跑.forEach((x) => running.set(x.pid, x.图))
    队.在排队.forEach((x, i) => pending.set(x.pid, { 图: x.图, 位置: i }))
  }
  const 行 = new Map()
  const 加入 = (pid, 额外) => { if (pid && !行.has(pid)) 行.set(pid, Object.assign({ pid }, 额外)) }

  for (const [pid, 记] of 作业) {
    加入(pid, { 工作流: 记.工作流, 工作流名: 记.工作流名 || '', 摘要: 记.摘要 || '', 类型: 记.类型 || '', 起来: 记.起来, 状态: 记.状态 || '', 输入: 记.输入 || null, 计划: 记.计划 || [], 台账: true, 台账产物: 记.产物 || [] })
  }
  for (const [pid, 图] of running) 加入(pid, { 摘要: 抠摘要(图), 外部: true, 图 })
  for (const [pid, e] of pending) 加入(pid, { 摘要: 抠摘要(e.图), 外部: true, 图: e.图 })

  // 全量 history 回填：重启后台账清空时，已结束/报错任务仍能按归属列出来
  const 全史 = await 取全历史(baseUrl)
  const 本地表 = 建本地流表(配置)
  for (const [pid, 历] of Object.entries(全史)) {
    if (!pid) continue
    if (!行.has(pid)) {
      // history 的 prompt 是数组 [编号, prompt_id, 图, 附加数据, 产物]，图在第 3 项；附加数据里有 create_time（毫秒）
      const 历图 = Array.isArray(历?.prompt) ? 历.prompt[2] : 历?.prompt
      const 附加 = Array.isArray(历?.prompt) ? 历.prompt[3] : null
      const 起来 = Number(附加?.create_time) || null
      const 匹配 = 匹配流(历图, 本地表)
      加入(pid, {
        摘要: 抠摘要(历图), 外部: true, 历, 起来,
        工作流: 匹配?.id || '', 工作流名: 匹配?.name || '',
      })
    }
  }

  const 结果 = []
  for (const [pid, 基础] of 行) {
    let 状态, 位置 = null
    // 先看 history（终态权威）：已完成/报错以 history 为准，避免队列残留快照把已结束任务盖回“运行中”
    const 历 = 全史[pid] || 基础.历 || null
    if (历?.status?.status_str) 状态 = 历.status.status_str
    else if (历?.status?.completed) 状态 = 'success'
    else if (running.has(pid)) 状态 = 'running'
    else if (pending.has(pid)) { 状态 = 'queued'; 位置 = pending.get(pid).位置 }
    else if (基础.状态 && 基础.状态 !== '跑着') 状态 = 基础.状态
    else if (基础.状态 === '跑着' && 基础.起来 && Date.now() - 基础.起来 < 10000) 状态 = 'running'
    else 状态 = 'cancelled'
    // 产物优先从 history 记录抠；history 为空（重启后 ComfyUI 历史被清）时，用本地台账里存的产物兜底，避免归属断成平铺孤儿
    const 产物 = 历 ? 抠产物(历) : (基础.台账产物 || [])
    const 进度记 = 进度.get(pid) || null
    // 总耗时：完成时刻（execution_success）减提交时刻；进行中/排队中或取不到时间戳则为 null
    const 完成时刻 = 取结束时刻(历)
    let 耗时毫秒 = null
    if (状态 !== 'running' && 状态 !== 'queued' && 基础.起来 && 完成时刻) 耗时毫秒 = 完成时刻 - 基础.起来
    // 台账/回填都没带上工作流名时，用图结构再反推一次（队列外部任务等）
    let 工作流 = 基础.工作流 || '', 工作流名 = 基础.工作流名 || ''
    if (!工作流名) {
      const 历图 = Array.isArray(历?.prompt) ? 历.prompt[2] : 历?.prompt
      const 匹配 = 匹配流(基础.图 || 历图, 本地表)
      if (匹配) { 工作流 = 匹配.id; 工作流名 = 匹配.name }
    }
    结果.push({
      prompt_id: pid, 编号: 文本(pid).slice(0, 8),
      状态, 工作流, 工作流名,
      类型: 基础.类型 || '', 摘要: 基础.摘要 || '',
      排队位置: 位置 != null ? 位置 + 1 : null,
      起来: 基础.起来 || null,
      耗时毫秒,
      进度: 进度记,
      产物: 产物带Url(产物),
      报错: 提取报错(历?.status?.messages) || '',
      输入: 基础.输入 || null,
      计划: 基础.计划 || [],
      台账: !!基础.台账,
    })
  }
  const 序 = { running: 0, queued: 1 }
  // 先按状态分组（运行中→排队→已结束）；排队组内按队列位置，其余同组按提交时间倒序（最新在最上面）
  结果.sort((a, b) => {
    const sa = 序[a.状态] ?? 2, sb = 序[b.状态] ?? 2
    if (sa !== sb) return sa - sb
    if (a.排队位置 != null || b.排队位置 != null) return (a.排队位置 ?? 999) - (b.排队位置 ?? 999)
    return (b.起来 || 0) - (a.起来 || 0)
  })
  return 结果
}

async function 汇总作业(配置, 含隐藏) {
  const 全量 = await 构建汇总行(配置)
  if (含隐藏) return 全量
  const 隐藏 = 隐藏集合(配置)
  return 全量.filter((r) => r.状态 === 'running' || r.状态 === 'queued' || !隐藏.has(r.prompt_id))
}

// 一次汇总同时给两组：普通（任务清单，过滤手动隐藏）+ 全量（历史产物墙分组用，含隐藏）
async function 汇总两组(配置) {
  const 全量 = await 构建汇总行(配置)
  const 隐藏 = 隐藏集合(配置)
  const 普通 = 全量.filter((r) => r.状态 === 'running' || r.状态 === 'queued' || !隐藏.has(r.prompt_id))
  return { 普通, 全量 }
}

// 从 history messages 里取结束时刻（毫秒）：取最后一条带 timestamp 的流水
// 成功是 execution_success，中断/失败是 execution_interrupted；completed 本身只是布尔值
function 取结束时刻(记录) {
  const 流水 = 记录?.status?.messages || []
  let 末 = null
  for (const m of Array.isArray(流水) ? 流水 : []) {
    if (Array.isArray(m) && m[1] && Number(m[1].timestamp)) 末 = Number(m[1].timestamp)
  }
  return 末
}

// 从 history 记录里抠产物（images 和 gifs 都算，VHS 视频在 gifs）
function 抠产物(记录) {
  const 出 = []
  if (!记录 || !记录.outputs) return 出
  for (const [nodeId, o] of Object.entries(记录.outputs)) {
    for (const 键 of ['images', 'gifs', 'videos', 'audio']) {
      for (const f of o?.[键] || []) {
        if (!f || !f.filename) continue
        if (f.type === 'temp') continue
        出.push({
          节点: nodeId,
          文件: f.filename,
          子目录: f.subfolder || '',
          类型: f.type || 'output',
          本地: join(读配置().outputDir || '', f.subfolder || '', f.filename),
        })
      }
    }
  }
  return 出
}

// 产物补一条面板可访问的相对 url（与 /job 路由一致）
function 产物带Url(产物) {
  return (产物 || []).map((x) => ({
    节点: x.节点, 文件: x.文件, 子目录: x.子目录, 类型: x.类型,
    url: '/comfy-console/asset?kind=output&sub=' + encodeURIComponent(x.子目录 || '') + '&file=' + encodeURIComponent(x.文件),
  }))
}

// 从 history messages 里只挑真报错；start/cached/success 这类正常流水不算报错
function 提取报错(messages) {
  if (!Array.isArray(messages)) return null
  const 行 = []
  for (const m of messages) {
    if (!Array.isArray(m)) continue
    const 类型 = String(m[0] || '')
    const 体 = m[1] || {}
    if (类型 === 'execution_error') {
      const 段 = []
      if (体.node_type) 段.push('节点 ' + 体.node_id + '（' + 体.node_type + '）')
      if (体.exception_message) 段.push(体.exception_message)
      if (体.exception_type) 段.push('[' + 体.exception_type + ']')
      行.push(段.join('：') || JSON.stringify(体))
    } else if (/error/i.test(类型) && 类型 !== 'execution_success') {
      行.push(类型 + ' ' + JSON.stringify(体).slice(0, 500))
    }
  }
  return 行.length ? 行.join('\n') : null
}

// ───────────────────── 工作流分析（核心） ─────────────────────

const 图片加载类 = /^(LoadImage|LoadImageMask|LoadImageOutput|ETN_LoadImageBase64)$/i
const 视频加载类 = /^(VHS_LoadVideo|LoadVideo|LoadVideoFromPath|VideoInput)$/i
const 音频加载类 = /^(LoadAudio|VHS_LoadAudio|LoadAudioUpload)$/i
const 图片保存类 = /^(SaveImage|PreviewImage)$/i
const 视频保存类 = /^(VHS_VideoCombine|SaveVideo|SaveWEBM|CreateVideo|VideoCombine)$/i

// ── 按 object_info 口类型泛化判定节点角色（不依赖写死的类名；类名正则仅作兜底加分）──

// 节点输入口类型集合（COMBO 选项归为 COMBO）
function 入类型集(类定义) {
  const 集 = new Set()
  if (!类定义?.input) return 集
  for (const 段 of ['required', 'optional']) {
    for (const v of Object.values(类定义.input[段] || {})) {
      const 型 = Array.isArray(v) ? v[0] : v
      if (typeof 型 === 'string') 集.add(型)
    }
  }
  return 集
}
function 出类型集(类定义) { return new Set(类定义?.output || []) }
// 是否存在名字匹配的输入口
function 有输入口(类定义, 名正则) {
  if (!类定义?.input) return false
  for (const 段 of ['required', 'optional']) {
    for (const k of Object.keys(类定义.input[段] || {})) if (名正则.test(k)) return true
  }
  return false
}
// 承接上游模型/条件/潜空间/媒体的类型：素材加载器不应带这些入参
const 上游媒体类型 = new Set(['MODEL', 'CLIP', 'VAE', 'LATENT', 'CONDITIONING', 'CLIP_VISION', 'SIGMAS', 'SAMPLER', 'IMAGE', 'AUDIO', 'VHS_VIDEOINFO'])

/**
 * 泛化判定一个节点的角色。
 * 返回 { 缺失, 采样器, 图加载, 音加载, 视频加载, 图保存, 视频保存, 类定义, 入, 出 }
 * 口类型规则为主；类名白名单只在规则判不出时兜底。
 */
function 节点角色(schema, n) {
  const 类定义 = 取类(schema, n.class_type)
  if (!类定义) return { 缺失: true, 类定义: null }
  const 入 = 入类型集(类定义), 出 = 出类型集(类定义)
  const 名 = n.class_type
  const 无上游媒体 = ![...上游媒体类型].some((t) => 入.has(t))
  const 采样器 = (入.has('MODEL') && 入.has('LATENT') && 入.has('CONDITIONING') && 出.has('LATENT'))
    || /^(KSampler|KSamplerAdvanced)$/i.test(名)
  const 图加载 = (出.has('IMAGE') && 无上游媒体) || 图片加载类.test(名)
  const 音加载 = (出.has('AUDIO') && 无上游媒体) || 音频加载类.test(名)
  const 视频加载 = (出.has('AUDIO') && 出.has('IMAGE')) || 视频加载类.test(名)
  const 图保存 = (入.has('IMAGE') && (有输入口(类定义, /filename_prefix|filename/i) || /^(PreviewImage)$/i.test(名)))
    || 图片保存类.test(名)
  const 视频保存 = (入.has('IMAGE') && (出.has('VHS_FILENAMES') || 入.has('AUDIO')))
    || 视频保存类.test(名)
  return { 缺失: false, 类定义, 入, 出, 采样器, 图加载, 音加载, 视频加载, 图保存, 视频保存 }
}

// 顺着上游找真正的加载节点（穿过 ImageScale 之类的中间节点）；谓词按口类型角色判定，正则兜底
function 找上游加载(graph, 链接, 谓词, 深度 = 0) {
  if (!是链接(链接) || 深度 > 8) return null
  const n = graph[链接[0]]
  if (!n) return null
  if (谓词(n)) return 链接[0]
  for (const v of Object.values(n.inputs || {})) {
    const r = 找上游加载(graph, v, 谓词, 深度 + 1)
    if (r) return r
  }
  return null
}

// 视频保存节点的音频口：换成原始视频自带的声音
// 把没用到的加载节点从图里彻底删掉：上传几个就只留几个，不留模板自带的空壳
function 清掉没用的加载(graph, 用到的Id, schema) {
  const 留 = new Set(用到的Id.map(String))
  const 删 = []
  const 被引用 = (id) => {
    for (const [nid, n] of Object.entries(graph)) {
      if (nid === id) continue
      for (const v of Object.values(n.inputs || {})) {
        if (是链接(v) && String(v[0]) === String(id)) return true
      }
    }
    return false
  }
  for (const id of Object.keys(graph)) {
    if (留.has(String(id))) continue
    const 角色 = 节点角色(schema, graph[id])
    if (!角色.缺失 && !(角色.图加载 || 角色.音加载 || 角色.视频加载)) continue
    if (被引用(id)) continue
    delete graph[id]
    删.push(id)
  }
  return 删
}

function 接原始声音(graph, schema, 视频加载Id) {
  if (!视频加载Id) return []
  const 类 = 取类(schema, graph[视频加载Id].class_type)
  const 名 = 类?.output_name || 类?.output || []
  const 音位 = Array.isArray(名) ? 名.indexOf('AUDIO') : -1
  if (音位 < 0) return []
  const 改过 = []
  for (const [id, n] of Object.entries(graph)) {
    if (!节点角色(schema, n).视频保存) continue
    const 入 = n.inputs || {}
    const 有音口 = Object.keys(入).some((k) => /^audio$/i.test(k))
    if (!有音口) continue
    入.audio = [视频加载Id, 音位]
    改过.push(id)
  }
  return 改过
}

function 取类(schema, cls) {
  return schema?.[cls] || null
}

// COMBO 下拉：前端给的是短码（16:9），节点要完整标签（16:9 (Widescreen)）。
// 在节点选项里按「全等 → 前缀 → 包含」逐级匹配，匹配不到就原样返回。
function 匹配Combo(类定义, 键, 入值) {
  if (!类定义 || 入值 == null) return 入值
  const 段 = 类定义.input?.required?.[键] || 类定义.input?.optional?.[键]
  let 选项 = null
  if (Array.isArray(段)) {
    if (Array.isArray(段[0])) 选项 = 段[0]
    else if (段[1] && Array.isArray(段[1].options)) 选项 = 段[1].options
  }
  if (!选项 || !选项.length) return 入值
  if (选项.includes(入值)) return 入值
  const 串 = String(入值)
  return 选项.find(o => typeof o === 'string' && o.startsWith(串 + ' '))
    || 选项.find(o => typeof o === 'string' && o.includes(串))
    || 入值
}

// 取出某 COMBO 键的完整选项列表（给前端下拉用，避免写死节点根本不支持的比例）
function comboOptions(类定义, 键) {
  if (!类定义) return []
  const 段 = 类定义.input?.required?.[键] || 类定义.input?.optional?.[键]
  if (!Array.isArray(段)) return []
  if (Array.isArray(段[0])) return 段[0]
  if (段[1] && Array.isArray(段[1].options)) return 段[1].options
  return []
}

// 从节点输入里取出所有 AGV 槽（返回 [{key, 前缀, 已接:[{i, 链接}]}）
function 找AGV槽(节点, 类定义) {
  const 出 = []
  if (!类定义) return 出
  for (const 段 of ['required', 'optional']) {
    for (const [键, 值] of Object.entries(类定义.input?.[段] || {})) {
      const 型 = Array.isArray(值) ? 值[0] : 值
      if (型 !== 'COMFY_AUTOGROW_V3') continue
      // 真实结构：值[1] = { template: { input: {...}, prefix, min, max } }
      // 有的版本把 prefix/max 放在值[1] 顶层 —— 两处都认。
      const 规格 = 值?.[1] || {}
      const 模 = 规格.template || {}
      const 前 = 规格.prefix || 模.prefix || 键 + '_'
      const 上限数 = typeof 规格.max === 'number' ? 规格.max : typeof 模.max === 'number' ? 模.max : 9
      const 已 = []
      for (const [k, v] of Object.entries(节点.inputs || {})) {
        const m = k.match(new RegExp('^' + 键.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.' + 前.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$'))
        if (m && 是链接(v)) 已.push({ i: Number(m[1]), 链接: v, 键: k })
      }
      已.sort((a, b) => a.i - b.i)
      出.push({ 键, 前缀: 前, 上限: 上限数, 已接: 已 })
    }
  }
  return 出
}

// 穿透「开关/中继」类节点，找到真正产出条件或文本的那个节点
const 中继类 = /^(ComfySwitchNode|Reroute|ComfyIfElse|ComfySwitch|Switch|LatentSwitch|Any Switch.*)$/i

function 穿透(graph, 链接, 深度 = 0) {
  if (!是链接(链接) || 深度 > 8) return null
  const n = graph[链接[0]]
  if (!n) return null
  if (中继类.test(n.class_type)) {
    const 入 = n.inputs || {}
    // 先看 switch 指向哪边
    const sw = 追溯(graph, 入.switch)
    const 走真 = sw && (sw.值 === true || sw.值 === 1 || sw.值 === 'true')
    const 目标 = 走真 ? (入.on_true ?? 入.true ?? 入.a) : (入.on_false ?? 入.false ?? 入.b)
    const 下一个 = 目标 ?? 入.on_false ?? 入.on_true ?? 入.input ?? 入.any
    const r = 穿透(graph, 下一个, 深度 + 1)
    if (r) return r
  }
  return { 节点: n, id: 链接[0], 类: n.class_type, 值: n.inputs?.value, 输入: n.inputs || {} }
}

/**
 * 本地提示词优化器（自带 LLM/模型调用、会自己展开改写提示词）的类名特征。
 * 注意：不能用裸 Prompt 匹配，否则 CR Prompt Text / Prompt Text 这类纯文本框会被误判成优化器。
 */
const 优化器类名正则 = /Enhancer|Optimizer|LLM|Qwen|Ollama|Instruct|PromptLocal|H3Prompt|LocalPrompt/i

// 口类型佐证：除文本口外还挂着模型/技能选择口，或带 AGV 参考槽 → 视为本地优化器；纯文本框没有这些，不会被误判
function 口类型像优化器(schema, n) {
  const 类定义 = 取类(schema, n.class_type)
  if (!类定义) return false
  const 入 = 入类型集(类定义)
  if (!入.has('STRING')) return false
  const 口名 = Object.keys(类定义.input?.required || {}).concat(Object.keys(类定义.input?.optional || {}))
  const 选择口 = 口名.some((k) => /model|llm|skill|engine|bot|agent|preset/i.test(k))
  const 有槽 = 找AGV槽(n, 类定义).length > 0
  return 选择口 || 有槽
}
// 优化器判定：类名关键词命中，或口类型特征像优化器
function 是优化器(schema, n) {
  return !!(n && (优化器类名正则.test(n.class_type) || 口类型像优化器(schema, n)))
}

/**
 * 从某个链接往回找「真正能写字的提示词字段」，穿透开关节点与 CLIPTextEncode。
 * 返回 { 节点, 类, 字段, 优化器, 当前 } 或 null
 */
function 追提示词(graph, 链接, schema, 深度 = 0) {
  if (!是链接(链接) || 深度 > 8) return null
  const 命中 = 穿透(graph, 链接)
  if (!命中) return null
  const n = 命中.节点
  const 类 = 取类(schema, n.class_type)

  // 情况 A：本地提示词优化器 / 直接可写文本的节点
  if (是优化器(schema, n)) {
    // 优化器真正的「用户输入」常挂在 request / input / user_prompt 这类口子上，
    // 顺着它追到那个 PrimitiveStringMultiline —— 那才是该写字的地方。
    for (const 口 of ['request', 'input', 'user_prompt', 'query', 'instruction']) {
      const v = n.inputs?.[口]
      const 源 = 追溯(graph, v)
      if (源 && typeof 源.值 === 'string') {
        return { 节点: 源.id, 类: 源.类, 字段: 'value', 优化器: true, 当前: 源.值.slice(0, 300), 经: n.class_type + '.' + 口 }
      }
    }
    const 字段 = 找文本字段(命中, 类)
    if (字段) {
      let 当前 = 文本(n.inputs?.[字段]).slice(0, 300)
      if (!当前) {
        for (const v of Object.values(n.inputs || {})) {
          const 源 = 追溯(graph, v)
          if (源 && typeof 源.值 === 'string' && 源.值.trim()) { 当前 = 源.值.slice(0, 300); break }
        }
      }
      return { 节点: 命中.id, 类: n.class_type, 字段, 优化器: true, 当前 }
    }
  }

  // 情况 B：CLIPTextEncode 一类编码器 → 继续追它的 text
  if (/TextEncode|CLIPTextEncode/i.test(n.class_type)) {
    const t = n.inputs?.text
    const 源 = 追溯(graph, t)
    if (源 && typeof 源.值 === 'string') {
      return { 节点: 源.id, 类: 源.类, 字段: 'value', 优化器: 优化器类名正则.test(源.类), 当前: 文本(源.值).slice(0, 300) }
    }
    if (typeof t === 'string') {
      return { 节点: 命中.id, 类: n.class_type, 字段: 'text', 优化器: false, 当前: t.slice(0, 300) }
    }
    // text 是链接但追不到值 → 往上再穿一层
    return 追提示词(graph, t, schema, 深度 + 1)
  }

  // 情况 C：本身就是能写字的字符串节点
  const 字段 = 找文本字段(命中, 类)
  if (字段) {
    return { 节点: 命中.id, 类: n.class_type, 字段, 优化器: 是优化器(schema, n), 当前: 文本(n.inputs?.[字段]).slice(0, 300) }
  }
  return null
}
function 追溯(graph, 链接, 深度 = 0) {
  if (!是链接(链接) || 深度 > 6) return null
  const n = graph[链接[0]]
  if (!n) return null
  return { 节点: n, id: 链接[0], 类: n.class_type, 值: n.inputs?.value, 输入: n.inputs || {} }
}

// 枚举全图步数：所有采样/调度节点的 steps，追溯到 PrimitiveInt/数字，标阶段（一采/二采/调度）；阶段编号按连通段各自起算
function 枚举步数(graph, schema) {
  const 项 = []
  const 段 = 检测段(graph, schema)
  const 节点段 = {}
  段.forEach((s, i) => s.forEach((id) => { 节点段[id] = i }))
  const 采计数 = 段.map(() => 0)
  const 采样器 = []
  for (const [id, n] of Object.entries(graph)) {
    if (!n || typeof n.class_type !== 'string') continue
    const 角色 = schema ? 节点角色(schema, n) : null
    const 是调度 = /Scheduler/i.test(n.class_type)
    const 是采样 = (角色 && 角色.采样器) || /Sampler/i.test(n.class_type)
    if (是采样 || 是调度) 采样器.push({ id, n, 是调度 })
  }
  const 采名 = ['一采', '二采', '三采', '四采']
  for (const { id, n, 是调度 } of 采样器) {
    const st = n.inputs?.steps
    if (st == null) continue
    const 源 = 追溯(graph, st)
    let 节点, 字段, 当前
    if (源 && typeof 源.值 === 'number') { 节点 = 源.id; 字段 = 'value'; 当前 = 源.值 }
    else if (typeof st === 'number') { 节点 = id; 字段 = 'steps'; 当前 = st }
    else continue
    const 段号 = 节点段[id] || 0
    const 阶段 = 是调度 ? '调度' : (采名[采计数[段号]++] || ('第' + (采计数[段号] + 1) + '采'))
    项.push({ 节点, 类: n.class_type, 字段, 阶段, 当前, 采样器: id })
  }
  return 项
}

// 检测画布上互不连通的独立流程段（拼画布）：按产物节点做无向弱连通分量
function 检测段(graph, schema) {
  const 邻 = {}
  const 加边 = (a, b) => { (邻[a] = 邻[a] || []).push(b); (邻[b] = 邻[b] || []).push(a) }
  for (const [id, n] of Object.entries(graph)) {
    邻[id] = 邻[id] || []
    for (const v of Object.values(n.inputs || {})) if (是链接(v)) 加边(id, v[0])
  }
  const 产物 = Object.entries(graph)
    .filter(([, n]) => { const 角色 = 节点角色(schema, n); return 角色.图保存 || 角色.视频保存 })
    .map(([id]) => id)
  const 段 = []
  const 已归属 = new Set()
  for (const p of 产物) {
    if (已归属.has(p)) continue
    const 集 = new Set(); const 栈 = [p]
    while (栈.length) {
      const x = 栈.pop(); if (集.has(x)) continue
      集.add(x)
      for (const s of (邻[x] || [])) if (!集.has(s)) 栈.push(s)
    }
    for (const x of 集) 已归属.add(x)
    段.push([...集])
  }
  return 段
}

/**
 * 分析一份 API 格式工作流。
 * 返回结构见文件顶部注释；失败时 ok:false + error。
 */
async function 分析(baseUrl, graph) {
  const 结果 = {
    ok: false,
    error: '',
    节点数: Object.keys(graph).length,
    类型: 'unknown',
    素材: { images: null, videos: null, audios: null, video_audios: null },
    提示词: null,
    秒数: null,
    尺寸: null,
    产物: [],
    可改: [],
    缺失节点: [],
    警告: [],
  }

  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    结果.error = '不是工作流对象'
    return 结果
  }
  if (Array.isArray(graph.nodes)) {
    结果.error = '这是 UI 格式（有 nodes 数组）。请在 ComfyUI 里开 Dev mode → Save (API Format) 再给我。'
    return 结果
  }
  for (const [id, n] of Object.entries(graph)) {
    if (!n || typeof n !== 'object' || typeof n.class_type !== 'string') {
      结果.error = '节点 ' + id + ' 不是 API 格式（缺 class_type）'
      return 结果
    }
  }

  let schema = await 取对象信息(baseUrl)

  // 0) 缺失节点：档案里查不到的 class_type（插件没装/没启用）。档案拉空（连不上服务器）时不报，避免误判
  if (schema && typeof schema === 'object' && Object.keys(schema).length) {
    const 找缺失 = (sch) => Object.entries(graph).filter(([, n]) => !取类(sch, n?.class_type))
    let 缺失 = 找缺失(schema)
    // 本地档案可能过时（装了新插件后缓存没刷新）：有类查不到时强制重拉一次再判，避免旧缓存把新节点误报成缺失；只补拉一次
    if (缺失.length) {
      try {
        const 新 = await 取对象信息(baseUrl, true)
        if (新 && typeof 新 === 'object' && Object.keys(新).length) {
          schema = 新
          缺失 = 找缺失(schema)
        }
      } catch {}
    }
    for (const [id, n] of 缺失) 结果.缺失节点.push({ 节点: id, 类: 文本(n.class_type) })
    if (结果.缺失节点.length) {
      const 名 = [...new Set(结果.缺失节点.map((x) => x.类))]
      const 展示 = 名.slice(0, 8).join('、') + (名.length > 8 ? ' 等 ' + 名.length + ' 类' : '')
      结果.警告.push('有 ' + 结果.缺失节点.length + ' 个节点本机 ComfyUI 档案里查不到（' + 展示 + '），对应插件可能未安装或未启用；装齐后再分析、运行')
    }
  }

  // 1) 找宿主节点：带 AGV 参考槽的那个（优先 class 名里有 Reference / H3 的）
  let 宿主 = null
  let 宿主槽 = []
  const 候选 = []
  for (const [id, n] of Object.entries(graph)) {
    const 类 = 取类(schema, n.class_type)
    const 槽 = 找AGV槽(n, 类)
    if (!槽.length) continue
    const 参考槽 = 槽.filter((s) => /^(ref_|reference)/i.test(s.前缀) || /^(ref_|reference)/i.test(s.键))
    if (!参考槽.length) continue
    const 分 = 参考槽.reduce((a, s) => a + s.已接.length, 0) + (/Reference|H3/i.test(n.class_type) ? 100 : 0)
    候选.push({ id, n, 槽: 参考槽, 分 })
  }
  候选.sort((a, b) => b.分 - a.分)
  if (候选.length) {
    宿主 = 候选[0].n
    宿主槽 = 候选[0].槽
    结果.宿主 = { id: 候选[0].id, 类: 宿主.class_type }
  }

  // 2) 素材槽归类
  const 归类 = (槽) => {
    const 前 = 槽.前缀.toLowerCase()
    const 键 = 槽.键.toLowerCase()
    const 全部 = 前 + 键
    if (/video_audio/.test(全部)) return 'video_audios'
    if (/audio/.test(全部)) return 'audios'
    if (/video/.test(全部)) return 'videos'
    if (/image/.test(全部)) return 'images'
    return null
  }
  for (const 槽 of 宿主槽) {
    const 类 = 归类(槽)
    if (!类) continue
    if (结果.素材[类]) continue
    结果.素材[类] = { 节点: 结果.宿主.id, 键: 槽.键, 前缀: 槽.前缀, 上限: 槽.上限, 已接: 槽.已接.length }
  }

  // 3) 提示词：宿主 inputs.prompt 往回追（穿透开关/编码器）
  if (宿主) {
    const 提示 = 追提示词(graph, 宿主.inputs?.prompt, schema)
    if (提示) {
      结果.提示词 = 提示
      // 优化器自带 duration（秒）→ 最干净的秒数入口
      const 优化节点 = graph[提示.节点]
      if (提示.优化器 && 优化节点 && 优化节点.inputs && 'duration' in 优化节点.inputs) {
        const d = 优化节点.inputs.duration
        if (是链接(d)) {
          const p = 追溯(graph, d)
          if (p && typeof p.值 === 'number') 结果.秒数 = { 节点: p.id, 字段: 'value', 模式: 'seconds', 当前: p.值, 来源: 'duration 链 ' + p.类 }
        } else if (typeof d === 'number') {
          结果.秒数 = { 节点: 提示.节点, 字段: 'duration', 模式: 'seconds', 当前: d, 来源: '优化器 duration' }
        }
      }
    } else if (typeof 宿主.inputs?.prompt === 'string') {
      结果.提示词 = { 节点: 结果.宿主.id, 类: 宿主.class_type, 字段: 'prompt', 优化器: false, 当前: 宿主.inputs.prompt.slice(0, 300) }
    }
  }

  // 4) 秒数：宿主 inputs.length 往回追（没被优化器覆盖时才用）
  if (宿主 && !结果.秒数) {
    const 长度链 = 追溯(graph, 宿主.inputs?.length)
    if (长度链) {
      if (/Math/i.test(长度链.类)) {
        // 数学表达式里找 value 输入
        const 候选键 = Object.keys(长度链.输入).filter((k) => k !== 'expression')
        for (const k of 候选键) {
          const p = 追溯(graph, 长度链.输入[k])
          if (p && typeof p.值 === 'number') {
            结果.秒数 = { 节点: p.id, 字段: 'value', 模式: 'seconds', 当前: p.值, 来源: 'length ← ' + 长度链.类 + '.' + k + ' ← ' + p.类 }
            break
          }
        }
      } else if (typeof 长度链.值 === 'number') {
        结果.秒数 = { 节点: 长度链.id, 字段: 'value', 模式: 'frames', 当前: 长度链.值, 来源: 'length ← ' + 长度链.类 + '（帧）' }
      }
    }
  }

  // 5) 尺寸 / 比例
  if (宿主) {
    const w = 追溯(graph, 宿主.inputs?.width)
    const h = 追溯(graph, 宿主.inputs?.height)
    if (w && h && w.id === h.id && /Resolution|Aspect|Size/i.test(w.类)) {
      结果.尺寸 = {
        节点: w.id,
        类: w.类,
        比例: 文本(w.节点.inputs?.aspect_ratio),
        像素: w.节点.inputs?.megapixels,
        选项: comboOptions(取类(schema, w.类), 'aspect_ratio'),
      }
    }
  }

  // 6) 产物
  for (const [id, n] of Object.entries(graph)) {
    const 角色 = 节点角色(schema, n)
    if (角色.视频保存) 结果.产物.push({ id, 类: n.class_type, 类型: 'video' })
    else if (角色.图保存) 结果.产物.push({ id, 类: n.class_type, 类型: 'image' })
  }
  if (结果.产物.some((p) => p.类型 === 'video')) 结果.类型 = 'video'
  else if (结果.产物.some((p) => p.类型 === 'image')) 结果.类型 = 'image'

  // 7) 可改（步数全图枚举 + seed）——只列出来，改不改由用户说了算
  for (const s of 枚举步数(graph, schema)) 结果.可改.push(s)
  for (const [id, n] of Object.entries(graph)) {
    if (!节点角色(schema, n).采样器) continue
    if (typeof n.inputs?.seed === 'number') 结果.可改.push({ 节点: id, 类: n.class_type, 字段: 'seed', 当前: n.inputs.seed })
    if (typeof n.inputs?.noise_seed === 'number') 结果.可改.push({ 节点: id, 类: n.class_type, 字段: 'noise_seed', 当前: n.inputs.noise_seed })
  }

  if (!结果.宿主) 结果.警告.push('没找到带参考槽的节点 —— 只做纯文生的话忽略这条')
  if (!结果.提示词) 结果.警告.push('没认出提示词节点')
  if (!结果.秒数) 结果.警告.push('没认出秒数节点')
  if (!结果.产物.length) 结果.警告.push('没认出产物节点（SaveImage / VHS_VideoCombine）')

  // 没有参考槽宿主 = 纯文生图/文生视频流 → 换一套追法（positive 链 + EmptyLatent 链）
  if (!结果.宿主) {
    const 文生 = 分析文生图(graph, schema)
    // 用文生结果补齐（提示词/尺寸/产物/可改），素材仍为空
    for (const k of ['提示词', '尺寸', '产物', '可改']) {
      if ((!结果[k] || (Array.isArray(结果[k]) && !结果[k].length)) && 文生[k] && (!Array.isArray(文生[k]) || 文生[k].length)) 结果[k] = 文生[k]
    }
    if (!结果.提示词 && 文生.提示词) 结果.提示词 = 文生.提示词
    if (!结果.尺寸 && 文生.尺寸) 结果.尺寸 = 文生.尺寸
    if (!结果.产物.length && 文生.产物.length) 结果.产物 = 文生.产物
    if (!结果.可改.length && 文生.可改.length) 结果.可改 = 文生.可改
    if (结果.产物.some((p) => p.类型 === 'video')) 结果.类型 = 'video'
    else if (结果.产物.some((p) => p.类型 === 'image')) 结果.类型 = 'image'
    // 兜底警告以文生一套为准；只把「本机缺节点」这类不可恢复的警告摘出来保留，不被覆盖
    const 缺失警告 = 结果.警告.filter((w) => w.includes('档案里查不到'))
    结果.警告 = [...new Set([...文生.警告, ...缺失警告])]
  }

  // 6.5) 多段独立流程检测（拼画布）：按产物节点反向连通集，>1 段只接主链
  const 段 = 检测段(graph, schema)
  结果.段 = 段.map((s) => [...s])
  if (段.length > 1) 结果.警告.push('画布上检测到 ' + 段.length + ' 段互不连通的独立流程，当前只接入主链（第一段），其余流程不会参与运行；如需分别运行请把它们拆成单独工作流')

  结果.ok = true
  return 结果
}

/**
 * 纯文生图（t2i）流的分析：没有参考槽宿主，就从 KSampler 的 positive 往回追提示词，
 * 从 EmptyLatent / KSampler 的 latent 追 ResolutionSelector。
 */
function 分析文生图(graph, schema) {
  const 结果 = {
    ok: true, error: '', 节点数: Object.keys(graph).length, 类型: 'image',
    素材: { images: null, videos: null, audios: null, video_audios: null },
    提示词: null, 秒数: null, 尺寸: null, 产物: [], 可改: [], 缺失节点: [], 警告: [],
  }

  // 采样器
  let 采样 = null
  for (const [id, n] of Object.entries(graph)) {
    if (节点角色(schema, n).采样器) { 采样 = { id, n }; break }
  }

  // 提示词：顺 positive 追（穿透开关 + CLIPTextEncode + 本地优化器）
  if (采样) {
    const 提示 = 追提示词(graph, 采样.n.inputs?.positive, schema)
    if (提示) 结果.提示词 = 提示
  }

  // 尺寸：找 ResolutionSelector（被 EmptyLatent / EmptyFlux2LatentImage / KSampler 消费的那个）
  for (const [id, n] of Object.entries(graph)) {
    if (!/^(EmptyLatentImage|EmptyFlux2LatentImage|EmptySD3LatentImage|EmptyMochiLatentVideo)$/.test(n.class_type)) continue
    const w = 追溯(graph, n.inputs?.width)
    const h = 追溯(graph, n.inputs?.height)
    if (w && h && w.id === h.id && /Resolution|Aspect/i.test(w.类)) {
      结果.尺寸 = { 节点: w.id, 类: w.类, 比例: 文本(w.节点.inputs?.aspect_ratio), 像素: w.节点.inputs?.megapixels, 选项: comboOptions(取类(schema, w.类), 'aspect_ratio') }
      break
    }
  }
  if (!结果.尺寸) {
    for (const [id, n] of Object.entries(graph)) {
      if (!/^ResolutionSelector$/.test(n.class_type)) continue
      结果.尺寸 = { 节点: id, 类: n.class_type, 比例: 文本(n.inputs?.aspect_ratio), 像素: n.inputs?.megapixels, 选项: comboOptions(取类(schema, n.class_type), 'aspect_ratio') }
      break
    }
  }

  // 产物
  for (const [id, n] of Object.entries(graph)) {
    const 角色 = 节点角色(schema, n)
    if (角色.视频保存) 结果.产物.push({ id, 类: n.class_type, 类型: 'video' })
    else if (角色.图保存) 结果.产物.push({ id, 类: n.class_type, 类型: 'image' })
  }
  if (结果.产物.some((p) => p.类型 === 'video')) 结果.类型 = 'video'

  // 可改：步数全图枚举（一采/二采/调度）+ seed
  for (const s of 枚举步数(graph, schema)) 结果.可改.push(s)
  for (const [id, n] of Object.entries(graph)) {
    if (!节点角色(schema, n).采样器) continue
    if (typeof n.inputs?.seed === 'number') 结果.可改.push({ 节点: id, 类: n.class_type, 字段: 'seed', 当前: n.inputs.seed })
    if (typeof n.inputs?.noise_seed === 'number') 结果.可改.push({ 节点: id, 类: n.class_type, 字段: 'noise_seed', 当前: n.inputs.noise_seed })
  }

  if (!结果.提示词) 结果.警告.push('没认出提示词节点')
  if (!结果.产物.length) 结果.警告.push('没认出产物节点（SaveImage）')
  return 结果
}

// 在节点里找一个「能直接写字的」字段
function 找文本字段(链, 类定义) {
  const 输入 = 链.节点.inputs || {}
  const 常见 = ['prompt', 'text', 'value', 'string', 'positive']
  for (const k of 常见) if (typeof 输入[k] === 'string') return k
  // 从 schema 里找 STRING 型
  if (类定义) {
    for (const 段 of ['required', 'optional']) {
      for (const [k, v] of Object.entries(类定义.input?.[段] || {})) {
        const 型 = Array.isArray(v) ? v[0] : v
        if (型 === 'STRING' && typeof 输入[k] === 'string') return k
      }
    }
  }
  return null
}

// ───────────────────── 组装（接槽 + 填参数） ─────────────────────

function 备料(文件, 配置) {
  // 文件已经在 ComfyUI input 里就直接用名字；否则拷进去
  const 名 = basename(文件)
  if (!existsSync(文件)) return { ok: false, error: '文件不存在：' + 文件 }
  if (!目录已配(配置.inputDir)) return { ok: false, error: '未配置素材目录（input），请在面板「设置」里填写 ComfyUI 的 input 目录' }
  const 目标 = join(配置.inputDir, 名)
  if (文件.replace(/\\/g, '/').toLowerCase() === 目标.replace(/\\/g, '/').toLowerCase()) return { ok: true, 名 }
  if (!existsSync(配置.inputDir)) return { ok: false, error: 'inputDir 不存在：' + 配置.inputDir }
  const 目录已存 = existsSync(目标)
  if (!目录已存) {
    copyFileSync(文件, 目标)
    return { ok: true, 名, 拷贝: true }
  }
  // 同名但内容不同 → 换一个名字，别覆盖用户已有的图
  if (statSync(文件).size !== statSync(目标).size) {
    const 基 = 名.replace(/\.[^.]+$/, '')
    const 扩 = extname(名)
    const 新名 = 基 + '_' + Date.now().toString().slice(-6) + 扩
    copyFileSync(文件, join(配置.inputDir, 新名))
    return { ok: true, 名: 新名, 拷贝: true }
  }
  return { ok: true, 名 }
}

/**
 * 组装工作流。
 * req: { images:[], videos:[], audios:[], prompt, seconds, aspect, megapixels, steps, seed }
 */
async function 组装(baseUrl, graph, 分析结果, req, 配置) {
  const g = JSON.parse(JSON.stringify(graph))
  const 日志 = []
  const schema = await 取对象信息(baseUrl)

  // ── 素材：每类独立按 0..N-1 连续接
  const 类表 = [
    { 键: 'images', 加载: 'LoadImage', 字段: 'image', 例匹配: 图片加载类, 判: (n) => 节点角色(schema, n).图加载 },
    { 键: 'videos', 加载: 'VHS_LoadVideo', 字段: 'video', 例匹配: 视频加载类, 判: (n) => 节点角色(schema, n).视频加载 },
    { 键: 'audios', 加载: 'LoadAudio', 字段: 'audio', 例匹配: 音频加载类, 判: (n) => 节点角色(schema, n).音加载 },
  ]

  for (const 一类 of 类表) {
    const 文件们 = Array.isArray(req[一类.键]) ? req[一类.键].filter(Boolean) : []
    const 槽信息 = 分析结果.素材?.[一类.键]
    if (!文件们.length) {
      // 没给这一类素材 → 把旧的接线全摘掉（豆包画布语义：没加就没有）
      if (槽信息) {
        const 宿主 = g[槽信息.节点]
        const 前缀 = 槽信息.前缀
        const 键基 = 槽信息.键
        let 摘 = 0
        for (const k of Object.keys(宿主.inputs || {})) {
          if (k.startsWith(键基 + '.' + 前缀)) { delete 宿主.inputs[k]; 摘++ }
        }
        // 优化节点上的镜像也摘掉
        for (const [id, n] of Object.entries(g)) {
          if (id === 槽信息.节点) continue
          const 类 = 取类(schema, n.class_type)
          const 别槽 = 找AGV槽(n, 类)
          for (const s of 别槽) {
            if (!/image|video|audio/i.test(s.前缀)) continue
            const 这键 = s.键.toLowerCase() + s.前缀.toLowerCase()
            if (!new RegExp(一类.键.replace(/s$/, '')).test(这键)) continue
            for (const k of Object.keys(n.inputs || {})) {
              if (k.startsWith(s.键 + '.' + s.前缀)) { delete n.inputs[k]; 摘++ }
            }
          }
        }
        if (摘) 日志.push(一类.键 + '：没给素材，摘掉 ' + 摘 + ' 个旧接线')
      }
      continue
    }
    if (!槽信息) {
      日志.push(一类.键 + '：这个工作流没有这一类的参考槽，跳过 ' + 文件们.length + ' 个文件')
      continue
    }

    // 备料
    const 名们 = []
    for (const f of 文件们) {
      const r = 备料(f, 配置)
      if (!r.ok) throw new Error(r.error)
      名们.push(r.名)
      if (r.拷贝) 日志.push(一类.键 + '：' + basename(f) + ' → 拷进 input（' + r.名 + '）')
    }

    // 复用已有的加载节点（前 N 个），不够的再新建
    const 宿主Id = 槽信息.节点
    const 宿主 = g[宿主Id]
    const 前缀 = 槽信息.前缀
    const 键基 = 槽信息.键
    const 现有点 = []
    for (const k of Object.keys(宿主.inputs || {})) {
      const m = k.match(new RegExp('^' + 键基.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.' + 前缀.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$'))
      if (m && 是链接(宿主.inputs[k])) 现有点.push({ i: Number(m[1]), 键: k, 链接: 宿主.inputs[k] })
    }
    现有点.sort((a, b) => a.i - b.i)

    // 先摘掉所有旧接线（保证从 0 连续）
    for (const p of 现有点) delete 宿主.inputs[p.键]

    const 用到的加载 = []
    const 原链接 = {}
    const 镜像链接 = {}
    for (let i = 0; i < 名们.length; i++) {
      let 加载Id = null
      if (i < 现有点.length) {
        const 旧 = 现有点[i].链接
        const 旧节点 = g[旧[0]]
        if (旧节点 && (一类.判(旧节点) || 一类.例匹配.test(旧节点.class_type))) {
          加载Id = 旧[0]
          旧节点.inputs = 旧节点.inputs || {}
          旧节点.inputs[一类.字段] = 名们[i]
        } else {
          // 中间隔着 ImageScale / VideoInfo 之类：找到真正的加载节点，就地换文件名，
          // 保住原有的取帧、取音链路（不然声音会串成模板里那条旧视频的声）
          const 上游 = 找上游加载(g, 旧, (m) => 一类.判(m) || 一类.例匹配.test(m.class_type))
          if (上游) {
            加载Id = 上游
            g[上游].inputs = g[上游].inputs || {}
            g[上游].inputs[一类.字段] = 名们[i]
            原链接[i] = 旧
            日志.push(一类.键 + '：沿用原有链路，只换文件名（加载节点 ' + 上游 + ' ← ' + 名们[i] + '）')
          }
        }
      }
      if (!加载Id) {
        加载Id = 新id(g)
        const 新节点 = { class_type: 一类.加载, inputs: {} }
        新节点.inputs[一类.字段] = 名们[i]
        if (一类.键 === 'videos') {
          新节点.inputs = {
            video: 名们[i], force_rate: 24, custom_width: 0, custom_height: 0,
            frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff',
          }
          日志.push(一类.键 + '：新建加载节点 ' + 加载Id + '（' + 名们[i] + '）')
        } else {
          if (!取类(schema, 一类.加载)) throw new Error('服务器没有节点类 ' + 一类.加载)
          日志.push(一类.键 + '：新建加载节点 ' + 加载Id + '（' + 名们[i] + '）')
        }
        g[加载Id] = 新节点
      }
      宿主.inputs[键基 + '.' + 前缀 + i] = 原链接[i] || [加载Id, 0]
      用到的加载.push(加载Id)
      镜像链接[i] = 原链接[i] || [加载Id, 0]
    }
    日志.push(一类.键 + '：接 ' + 名们.length + ' 个槽（' + 前缀 + '0..' + 前缀 + (名们.length - 1) + '）')

    // 镜像到别的带同类 AGV 的节点（本地提示词优化器）
    for (const [id, n] of Object.entries(g)) {
      if (id === 宿主Id) continue
      const 类 = 取类(schema, n.class_type)
      if (!类) continue
      const 别槽 = 找AGV槽(n, 类)
      for (const s of 别槽) {
        const 这键 = (s.键 + s.前缀).toLowerCase()
        const 该是 = 一类.键 === 'images' ? /image/ : 一类.键 === 'videos' ? /video/ : /audio/
        if (!该是.test(这键)) continue
        // 只镜像原本就接了这套加载节点的（说明它们本来是连着的）
        const 原本接 = Object.keys(n.inputs || {}).filter((k) => k.startsWith(s.键 + '.' + s.前缀))
        if (!原本接.length) continue
        for (const k of 原本接) delete n.inputs[k]
        for (let i = 0; i < 名们.length; i++) n.inputs[s.键 + '.' + s.前缀 + i] = 镜像链接[i] || [用到的加载[i], 0]
        日志.push(一类.键 + '：同步到 ' + n.class_type + '（' + id + '）的 ' + s.键 + ' ' + 名们.length + ' 个')
      }
    }

    // 视频：保存节点直接用原始视频自带的声音，不让模型另生成音轨顶上
    if (一类.键 === 'videos') {
      const 改 = 接原始声音(g, schema, 用到的加载[0])
      if (改.length) 日志.push('声音：用原始视频自带的音轨 → 节点 ' + 改.join('/'))
    }
  }

  // ── 清理：模板自带但本次没用到的加载节点，一律删掉（上传几个就只留几个）
  {
    const 要留 = []
    for (const [id, n] of Object.entries(g)) {
      const ct = n.class_type || ''
      const 角色 = 节点角色(schema, n)
      if (角色.缺失 || !(角色.图加载 || 角色.音加载 || 角色.视频加载)) continue
      // 还有谁引用它 —— 被引用的必须留
      let 有人用 = false
      for (const [nid, m] of Object.entries(g)) {
        if (nid === id) continue
        for (const v of Object.values(m.inputs || {})) {
          if (是链接(v) && String(v[0]) === String(id)) { 有人用 = true; break }
        }
        if (有人用) break
      }
      if (有人用) 要留.push(id)
      else { delete g[id]; 日志.push('清理：删掉没用到的加载节点 ' + id + '（' + ct + '）') }
    }
  }

  // ── 秒数
  if (req.seconds != null && 分析结果.秒数) {
    const 秒 = Number(req.seconds)
    if (!Number.isFinite(秒) || 秒 <= 0) throw new Error('秒数不对：' + req.seconds)
    const s = 分析结果.秒数
    if (s.模式 === 'seconds') {
      g[s.节点].inputs = g[s.节点].inputs || {}
      g[s.节点].inputs[s.字段] = 秒
      日志.push('秒数：' + 秒 + ' 秒 → 节点 ' + s.节点 + '（' + (g[s.节点].class_type) + '），换算交给工作流自己')
    } else {
      const 帧 = 秒变帧(秒)
      g[s.节点].inputs[s.字段] = 帧
      日志.push('秒数：' + 秒 + ' 秒 → 节点 ' + s.节点 + '（帧由本插件换算）')
    }
  }

  // ── 比例 / 像素
  if (分析结果.尺寸) {
    const n = g[分析结果.尺寸.节点]
    if (n) {
      n.inputs = n.inputs || {}
      if (req.aspect) {
        const 类定义 = 取类(schema, n.class_type)
        const 选项 = comboOptions(类定义, 'aspect_ratio')
        const 比例值 = 匹配Combo(类定义, 'aspect_ratio', req.aspect)
        if (选项.length && !选项.includes(比例值)) {
          日志.push('比例：' + req.aspect + ' 不在可选列表里，保留原设置 ' + 文本(n.inputs.aspect_ratio))
        } else {
          n.inputs.aspect_ratio = 比例值
          日志.push('比例：' + 比例值)
        }
      }
      if (req.megapixels != null) { n.inputs.megapixels = Number(req.megapixels); 日志.push('像素：' + req.megapixels + ' MP') }
    }
  }

  // ── 提示词
  if (req.prompt && 分析结果.提示词 && 分析结果.提示词.字段) {
    const p = 分析结果.提示词
    g[p.节点].inputs = g[p.节点].inputs || {}
    g[p.节点].inputs[p.字段] = 文本(req.prompt)
    日志.push('提示词：写进节点 ' + p.节点 + '（' + p.类 + (p.优化器 ? '，本地优化器会自己展开' : '') + '）')
  }

  // ── 参数（只有明确要求才改）
  const 步数映射 = Array.isArray(req.stepsList)
    ? Object.fromEntries(req.stepsList.map((s) => [s.节点, s.值 != null ? s.值 : s.steps]))
    : null
  if (req.steps != null || req.stepsList != null || req.seed != null) {
    for (const c of 分析结果.可改) {
      const n = g[c.节点]
      if (!n) continue
      if (c.字段 === 'seed' && req.seed != null) { n.inputs.seed = Number(req.seed); 日志.push('seed：' + req.seed + '（节点 ' + c.节点 + '）') }
      else if (c.字段 === 'noise_seed' && req.seed != null) { n.inputs.noise_seed = Number(req.seed); 日志.push('seed：' + req.seed + '（节点 ' + c.节点 + '）') }
      else if (c.阶段) {
        const 新值 = 步数映射 && 步数映射[c.节点] != null ? 步数映射[c.节点] : (req.steps != null ? req.steps : null)
        if (新值 != null) { n.inputs[c.字段] = Number(新值); 日志.push('步数（' + c.阶段 + '）：' + 新值 + '（节点 ' + c.节点 + '）') }
      }
    }
  }

  // ── 额外 LoRA（只在明确要求时加，串在现有模型链末端）
  if (Array.isArray(req.loras) && req.loras.length) {
    for (const 要 of req.loras) {
      const 文件名 = 文本(要.文件名 || 要.lora || 要.name)
      if (!文件名) continue
      const 权重 = 要.权重 != null ? Number(要.权重) : 要.strength != null ? Number(要.strength) : 1
      // 找当前模型链末端：有 LoraLoaderModelOnly 就接最后一个，否则接 UNETLoader
      let 末端 = null
      let 末端类 = null
      for (const [id, n] of Object.entries(g)) {
        if (/^LoraLoader(ModelOnly)?$/.test(n.class_type)) { 末端 = id; 末端类 = n.class_type }
      }
      if (!末端) {
        for (const [id, n] of Object.entries(g)) {
          if (/^(UNETLoader|CheckpointLoaderSimple|UnetLoaderGGUF|UNETLoaderGGUF)$/i.test(n.class_type)) { 末端 = id; 末端类 = n.class_type }
        }
      }
      if (!末端) { 日志.push('LoRA：没找到模型链，跳过 ' + 文件名); continue }
      // 谁在用这个模型的输出，改指到新节点
      const 新id = String(900 + req.loras.indexOf(要))
      const 用者 = []
      for (const [id, n] of Object.entries(g)) {
        for (const [k, v] of Object.entries(n.inputs || {})) {
          if (Array.isArray(v) && String(v[0]) === String(末端)) 用者.push([id, k])
        }
      }
      g[新id] = {
        class_type: 'LoraLoaderModelOnly',
        inputs: { lora_name: 文件名, strength_model: 权重, model: [末端, 0] },
        _meta: { title: '额外 LoRA' },
      }
      for (const [id, k] of 用者) g[id].inputs[k] = [新id, 0]
      日志.push('LoRA：' + 文件名 + ' @' + 权重 + ' → 节点 ' + 新id + '（接在 ' + 末端 + ' 后面，改指 ' + 用者.length + ' 处）')
    }
  }

  return { graph: g, 日志 }
}

// ───────────────────── 作业台账 ─────────────────────

// promptId → { 起来, 工作流, 计划, 状态, 产物, 错误, 汇报, 已汇报, 催 }
const 作业 = new Map()
// 还在盯着的轮询器：promptId → { 停, 起于 }
const 盯着 = new Map()
// 汇报时往哪叫：agent 引用（可能失效）＋ 会话键，用来重新找到它
const 叫谁 = new Map()
// ws 实时进度：promptId → { 节点, 步数, 上限 }（拿不到就空，不影响轮询）
const 进度 = new Map()

// 作业台账落盘：重启后 ComfyUI /history 被清、内存 Map 丢失时，仍能按台账把产物归到对应任务
const 台账路径 = join(目录, 'comfyui-jobs-ledger.json')
const 台账上限 = 200
function 存台账() {
  try {
    const 条目 = [...作业.entries()].sort((a, b) => (b[1].起来 || 0) - (a[1].起来 || 0))
    const 出 = {}
    for (const [pid, 记] of 条目.slice(0, 台账上限)) {
      出[pid] = {
        起来: 记.起来, 工作流: 记.工作流, 工作流名: 记.工作流名 || '', 类型: 记.类型 || '',
        摘要: 记.摘要 || '', 计划: 记.计划 || [], 输入: 记.输入 || null,
        状态: 记.状态 || '', 产物: 记.产物 || [], 已汇报: !!记.已汇报,
        采样映射: 记.采样映射 || [], 总上限: 记.总上限 || 0,
      }
    }
    writeFileSync(台账路径, JSON.stringify({ 作业: 出 }), 'utf8')
  } catch {}
}
function 读台账() {
  try {
    const j = 读JSON(台账路径)
    if (!j || !j.作业) return
    for (const [pid, 记] of Object.entries(j.作业)) {
      if (记 && !作业.has(pid)) 作业.set(pid, 记)
    }
  } catch {}
}
读台账()

// 工作流默认参数：按工作流 id 存一套常用参数（基础参数 + LoRA）；提示词和参考素材不存
const 默认参数路径 = join(目录, 'comfyui-param-defaults.json')
let 默认参数表 = {}
function 读默认参数表() {
  try {
    const j = 读JSON(默认参数路径)
    if (j && j.表 && typeof j.表 === 'object') 默认参数表 = j.表
  } catch {}
}
function 存默认参数表() { 写JSON(默认参数路径, { 表: 默认参数表 }) }
function 规范默认参数(入) {
  const o =入 || {}
  const 出 = {}
  const 秒 = Number(o.seconds)
  if (o.seconds != null && 文本(o.seconds).trim() !== '' && Number.isFinite(秒) && 秒 > 0) 出.seconds = 秒
  if (o.aspect) 出.aspect = 文本(o.aspect)
  const 兆 = Number(o.megapixels)
  if (o.megapixels != null && 文本(o.megapixels).trim() !== '' && Number.isFinite(兆) && 兆 > 0) 出.megapixels = 兆
  const 种 = Number(o.seed)
  if (o.seed != null && 文本(o.seed).trim() !== '' && Number.isFinite(种)) 出.seed = 种
  if (o.steps && typeof o.steps === 'object') {
    const st = {}
    for (const [节点, 值] of Object.entries(o.steps)) {
      const n = Number(值)
      if (文本(节点) && 文本(值).trim() !== '' && Number.isFinite(n) && n > 0) st[文本(节点)] = n
    }
    if (Object.keys(st).length) 出.steps = st
  }
  if (Array.isArray(o.loras) && o.loras.length) {
    出.loras = o.loras.map((l) => {
      const 文件名 = 文本(l.文件名 || l.name || l.lora)
      const 原始权重 = l.权重 == null ? l.weight : l.权重
      const 权重 = 原始权重 == null ? 1 : Number(原始权重)
      return 文件名 ? { 文件名, 权重: Number.isFinite(权重) ? 权重 : 1 } : null
    }).filter(Boolean)
  }
  return 出
}
读默认参数表()

const 盯间隔毫秒 = 8000
const 盯最长毫秒 = 3 * 60 * 60 * 1000

const 秒数话 = (毫秒) => {
  const s = Math.max(0, Math.round(毫秒 / 1000))
  if (s < 60) return s + ' 秒'
  const m = Math.floor(s / 60)
  return m + ' 分 ' + (s % 60) + ' 秒'
}

/** 给本轮（或指定 agent）递一句「系统自己说的话」，让它醒过来继续干。 */
function 叫醒(agent, 文案) {
  try {
    if (!agent) return '没有 agent，叫不醒'
    const 消息 = {
      id: 'comfy-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      role: 'user',
      content: [{ type: 'text', text: String(文案) }],
      source: { kind: 'qq' },
    }
    const 直接 = typeof agent.followup === 'function'
    const 会话层 = agent.session && typeof agent.session.followup === 'function' ? agent.session : null
    if (!直接 && !会话层) return '这个 agent 没有 followup，叫不醒'
    const 正忙 = agent.status === 'running' && typeof agent.steer === 'function'
    const 发 = 直接
      ? (正忙 ? agent.steer(消息) : agent.followup(消息))
      : 会话层.followup(消息)
    Promise.resolve(发).catch(() => {})
    return 'ok'
  } catch (e) {
    return '叫醒失败：' + 文本(e?.message || e)
  }
}

/** 一条作业收尾时该说的话（给人看，也给模型看）。 */
function 收尾话(记, id, 状态, 产物) {
  const 花了 = 秒数话(Date.now() - (记?.起来 || Date.now()))
  const 头 = '【ComfyUI 完成】' + (记?.工作流 || '') + '　状态 ' + 状态 + '　耗时 ' + 花了
  const 行们 = (产物 || []).map((x, i) => '  ' + (i + 1) + '. ' + (x.本地 || x.文件))
  const 体 = 产物 && 产物.length
    ? 头 + '\nprompt_id ' + id + '\n产物：\n' + 行们.join('\n')
    : 头 + '\nprompt_id ' + id + '\n⚠ 这条没有产物 —— 检查产物节点。'
  return 体
}

/** 读 QQ 桥的配置，用来在叫不醒的时候直接把话甩到手机。 */
function 读QQ桥() {
  const p = join(目录, 'qq-bridge-config.json')
  const j = 读JSON(p)
  if (!j) return null
  return {
    NapCat: 文本(j.NapCat || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    令牌: 文本(j.令牌 || ''),
    私聊QQ: 文本(j.私聊QQ || ''),
  }
}

/** 兜底直发：不经会话，直接 NapCat 发一条私聊纯文本。 */
async function 直发QQ(文案) {
  const c = 读QQ桥()
  if (!c || !c.私聊QQ) return '没读到 QQ 桥配置，发不出去'
  try {
    const r = await fetch(c.NapCat + '/send_private_msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.令牌 ? { Authorization: 'Bearer ' + c.令牌 } : {}) },
      body: JSON.stringify({ user_id: Number(c.私聊QQ), message: [{ type: 'text', data: { text: String(文案) } }] }),
      signal: AbortSignal.timeout(10000),
    })
    const j = await r.json().catch(() => null)
    return j?.status === 'ok' || j?.retcode === 0 ? 'ok' : '失败：' + JSON.stringify(j).slice(0, 200)
  } catch (e) {
    return '失败：' + 文本(e?.message || e)
  }
}

/** 开始盯一条作业：跑完 → 叫醒这一轮（让它去发 QQ）；叫不醒就自己发。 */
function 盯住(agent, baseUrl, id) {
  if (盯着.has(id)) return
  if (agent) 叫谁.set(id, agent)
  const 起于 = Date.now()
  let 定时器 = null
  let 收手 = false
  const 停 = () => {
    if (收手) return
    收手 = true
    if (定时器) clearTimeout(定时器)
    盯着.delete(id)
  }
  const 再排 = () => {
    if (收手) return
    定时器 = setTimeout(查, 盯间隔毫秒)
    if (typeof 定时器.unref === 'function') 定时器.unref()
  }
  async function 查() {
    if (收手) return
    try {
      if (Date.now() - 起于 > 盯最长毫秒) { 停(); return }
      const 记 = 作业.get(id)
      if (记 && 记.已汇报) { 停(); return }
      const 历 = await 取历史(baseUrl, id)
      if (!历) { 再排(); return }
      const 状态 = 历?.status?.status_str || (历?.status?.completed ? 'success' : 'unknown')
      const 产物 = 抠产物(历)
      if (记) {
        记.状态 = 状态
        记.产物 = 产物
      }
      if (状态 === 'success' || 状态 === 'error') {
        if (记) 记.已汇报 = true
        存台账()
        停()
        // 通知开关关闭：只留台账与产物，不唤醒会话、不推 IM。
        const 配置 = 读配置()
        if (配置.notifyOnDone === false) return
        const 话 = 收尾话(记, id, 状态, 产物)
        const 谁 = 叫谁.get(id) || agent
        叫谁.delete(id)
        const 叫 = 叫醒(谁, 话 + '\n\n（跑完自动汇报：这条任务已结束，产物见上。）')
        if (叫 !== 'ok') await 直发QQ(话)
        return
      }
    } catch (e) {
      // 网络抖动就下一轮再看
    }
    再排()
  }
  盯着.set(id, { 停, 起于 })
  再排()
}

// ───────────────────── 配置里的工作流 ─────────────────────

function 找工作流(配置, 关键词) {
  const 列 = 配置.workflows || []
  const k = 文本(关键词).trim()
  if (!k) return null
  return 列.find((w) => w.id === k) || 列.find((w) => w.name === k)
    || 列.find((w) => 文本(w.id).includes(k)) || 列.find((w) => 文本(w.name).includes(k)) || null
}

function 读工作流图(条目) {
  const p = 条目.file
  if (!existsSync(p)) throw new Error('工作流文件不存在：' + p)
  const j = JSON.parse(readFileSync(p, 'utf8'))
  if (Array.isArray(j?.nodes)) throw new Error('这是 UI 格式。请在 ComfyUI 里 Dev mode → Save (API Format) 另存后再登记。')
  return j
}

// 工作流分析结果缓存：按文件路径 + mtime/size 命中；文件没变就不重复跑分析
const 工作流分析缓存 = new Map()

async function 分析工作流(配置, w) {
  const g = 读工作流图(w)
  const st = statSync(w.file)
  const 节点数 = Object.keys(g).length
  const 命中 = 工作流分析缓存.get(w.file)
  if (命中 && 命中.mtimeMs === st.mtimeMs && 命中.size === st.size) {
    return { 节点数, 分析: 命中.分析 }
  }
  const a = await 分析(配置.baseUrl, g)
  const 分析摘要 = 摘要分析(a)
  工作流分析缓存.set(w.file, { mtimeMs: st.mtimeMs, size: st.size, 节点数, 分析: 分析摘要 })
  return { 节点数, 分析: 分析摘要 }
}

// 由名字生成不重复的 slug id；中文等无拉丁字符时用时间戳后缀，避免多个流都落到 workflow
const slugify = (s, 配置) => {
  const 拉丁 = 文本(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const base = 拉丁 || ('wf-' + Date.now().toString(36))
  const 已有 = new Set((配置.workflows || []).map((w) => w.id))
  let id = base, i = 2
  while (已有.has(id)) id = base + '-' + (i++)
  return id
}

// ───────────────────── 工具定义 ─────────────────────

/** 通用输出合同：DSH 要求每个工具声明 output.schema，这里给一个宽松的对象 + 文本渲染。 */
function 通用输出() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_参数, 值) => {
      let 文 = ''
      try {
        if (值 && typeof 值 === 'object') {
          const 先 = 值.说 || 值.工作流 || ''
          文 = 先 ? String(先) + '\n' : ''
          文 += JSON.stringify(值, null, 1)
        } else 文 = String(值 ?? '')
      } catch (e) {
        文 = String(值 ?? '')
      }
      return [{ type: 'text', text: 文 }]
    },
  }
}

function 做工具(本agent) {
  const 表 = [
    {
      name: 'dsh_comfyui_console_list',
      description:
        '看 ComfyUI 画布登记了哪些工作流，以及每个流自己认出来的东西：' +
        '有几路参考图/参考视频/参考音频槽、提示词节点在哪（是不是本地优化器）、秒数节点、画幅比例、产物类型。' +
        '只列登记过的，不扫本地全部工作流。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const 配置 = 读配置()
        const 探 = await 探活(配置.baseUrl)
        const 行 = []
        for (const w of 配置.workflows || []) {
          let 摘要 = '（还没分析）'
          try {
            const 图 = 读工作流图(w)
            const a = await 分析(配置.baseUrl, 图)
            摘要 = 摘要话(a)
          } catch (e) {
            摘要 = '分析失败：' + 文本(e?.message || e)
          }
          行.push('· ' + w.id + '｜' + (w.name || '') + '\n  ' + 摘要)
        }
        return {
          ok: 探.通,
          ComfyUI: 探,
          工作流: 行.length ? 行.join('\n') : '（一个都没登记。用 dsh_comfyui_console_register 登记要用的流）',
        }
      },
    },
    {
      name: 'dsh_comfyui_console_register',
      description:
        '登记一个要用的 ComfyUI 工作流（API 格式 json 文件）。登记后它会自动分析出参考槽/提示词/秒数/比例/产物。' +
        '不用的工作流不用登记，插件也不会去碰它们。',
      parameters: {
        type: 'object',
        properties: {
          文件: { type: 'string', description: '工作流 json 的绝对路径（必须是 API 格式）' },
          名字: { type: 'string', description: '给它起个短名，比如「角色替换」' },
          标识: { type: 'string', description: '调用时用的 id，不给就用文件名' },
          备注: { type: 'string', description: '可选' },
        },
        required: ['文件'],
      },
      execute: async (p) => {
        const 配置 = 读配置()
        const 文件 = 文本(p?.文件).trim()
        if (!文件) return { ok: false, 说: '要给我工作流文件的路径' }
        let 图
        try {
          图 = 读工作流图({ file: 文件 })
        } catch (e) {
          return { ok: false, 说: 文本(e?.message || e) }
        }
        const 标识 = 文本(p?.标识).trim() || basename(文件).replace(/\.json$/i, '')
        const 名 = 文本(p?.名字).trim() || 标识
        配置.workflows = (配置.workflows || []).filter((w) => w.id !== 标识)
        配置.workflows.push({ id: 标识, name: 名, file: 文件, note: 文本(p?.备注) })
        写配置(配置)
        const a = await 分析(配置.baseUrl, 图)
        return { ok: true, 说: '登记好了：' + 标识 + '（' + 名 + '）', 认出来的: 摘要话(a) }
      },
    },
    {
      name: 'dsh_comfyui_console_unregister',
      description: '把一个工作流从画布里划掉（只删登记，不动文件）。',
      parameters: {
        type: 'object',
        properties: { 工作流: { type: 'string', description: 'id 或名字' } },
        required: ['工作流'],
      },
      execute: async (p) => {
        const 配置 = 读配置()
        const w = 找工作流(配置, p?.工作流)
        if (!w) return { ok: false, 说: '没这个工作流：' + 文本(p?.工作流) }
        配置.workflows = (配置.workflows || []).filter((x) => x.id !== w.id)
        写配置(配置)
        return { ok: true, 说: '划掉了：' + w.id }
      },
    },
    {
      name: 'dsh_comfyui_console_inspect',
      description: '细看一个已登记工作流的分析结果：每一路槽接了没、提示词节点是不是本地优化器、秒数从哪个节点来、产物节点在哪、哪些参数可改。',
      parameters: {
        type: 'object',
        properties: { 工作流: { type: 'string', description: 'id 或名字' } },
        required: ['工作流'],
      },
      execute: async (p) => {
        const 配置 = 读配置()
        const w = 找工作流(配置, p?.工作流)
        if (!w) return { ok: false, 说: '没这个工作流' }
        const a = await 分析(配置.baseUrl, 读工作流图(w))
        return { ok: a.ok, 工作流: w.id, 分析: a }
      },
    },
    {
      name: 'dsh_comfyui_console_run',
      description:
        '用登记过的工作流出片。像豆包画布一样：给几张图就自动接几个图槽，给几段视频就接几个视频槽，给了音频就接音频槽；' +
        '没给的那一类会清空旧接线。秒数直接给秒（不用管帧）。提示词写进流里自己的提示词节点/本地优化器。' +
        '先提交再看产物：默认不等，返回 prompt_id，用 dsh_comfyui_console_job 查。',
      parameters: {
        type: 'object',
        properties: {
          工作流: { type: 'string', description: '登记时的 id 或名字' },
          图片: { type: 'array', items: { type: 'string' }, description: '参考图绝对路径，按顺序接 0、1、2…' },
          视频: { type: 'array', items: { type: 'string' }, description: '参考视频绝对路径' },
          音频: { type: 'array', items: { type: 'string' }, description: '参考音频绝对路径' },
          提示词: { type: 'string', description: '写进工作流里的提示词（按给的图/视频写）' },
          秒数: { type: 'number', description: '要多少秒' },
          比例: { type: 'string', description: '比如 16:9 (Widescreen) / 9:16 (Portrait Widescreen)' },
          像素: { type: 'number', description: 'megapixels，比如 1 / 1.5 / 2' },
          步数: { type: 'number', description: '只有明确要求改才给' },
          seed: { type: 'number' },
          额外LoRA: {
            type: 'array',
            description: '要额外挂的 LoRA，串在流里现有模型链末端。只在明确要求时给',
            items: {
              type: 'object',
              properties: {
                文件名: { type: 'string', description: 'models/loras 下的相对路径，比如 lora_name.safetensors' },
                权重: { type: 'number', description: '默认 1' },
              },
              required: ['文件名'],
            },
          },
          只看不跑: { type: 'boolean', description: 'true = 只回一份计划，不提交' },
        },
        required: ['工作流'],
      },
      execute: async (p) => {
        const 配置 = 读配置()
        const w = 找工作流(配置, p?.工作流)
        if (!w) return { ok: false, 说: '没有这个工作流。已登记：' + (配置.workflows || []).map((x) => x.id).join('、') }
        const 探 = await 探活(配置.baseUrl)
        if (!探.通) return { ok: false, 说: 'ComfyUI 没连上（' + 配置.baseUrl + '）：' + 探.为什么 }

        const 图 = 读工作流图(w)
        const a = await 分析(配置.baseUrl, 图)
        if (!a.ok) return { ok: false, 说: '分析失败：' + a.error }

        const req = {
          images: p?.图片 || [],
          videos: p?.视频 || [],
          audios: p?.音频 || [],
          prompt: p?.提示词,
          seconds: p?.秒数,
          aspect: p?.比例,
          megapixels: p?.像素,
          steps: p?.步数,
          seed: p?.seed,
          loras: p?.额外LoRA || [],
        }
        let 组装结果
        try {
          组装结果 = await 组装(配置.baseUrl, 图, a, req, 配置)
        } catch (e) {
          return { ok: false, 说: '组装失败：' + 文本(e?.message || e) }
        }
        const 计划 = 组装结果.日志.join('\n')

        if (p?.只看不跑) return { ok: true, 只看不跑: true, 工作流: w.id, 计划 }

        let 回
        try {
          回 = await 提交(配置.baseUrl, 组装结果.graph)
        } catch (e) {
          return { ok: false, 说: 文本(e?.message || e), 计划 }
        }
        const id = 回?.prompt_id
        if (!id) return { ok: false, 说: '提交没拿到 prompt_id：' + JSON.stringify(回).slice(0, 300), 计划 }
        作业.set(id, {
          起来: Date.now(), 工作流: w.id, 工作流名: w.name || '', 类型: a.类型 || '',
          摘要: 文本(p?.提示词 || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          计划, 状态: '跑着', 产物: [], 错误: '', 汇报: true, 已汇报: false,
        })
        存台账()
        // 提交成功就开始盯：跑完主动叫醒这一轮，不用再来查
        盯住(本agent, 配置.baseUrl, id)
        return {
          ok: true,
          prompt_id: id,
          工作流: w.id,
          类型: a.类型,
          计划,
          说: '提交了，我在后台盯着，跑完会主动叫你（prompt_id=' + id + '）。'
            + (a.类型 === 'video' ? '出片后产物是视频文件。' : ''),
        }
      },
    },
    {
      name: 'dsh_comfyui_console_job',
      description:
        '查一次跑得怎么样：状态、进度（正在跑/排队第几）、产物文件在哪。跑完会给出本地绝对路径。' +
        '（提交后插件自己会盯，跑完主动叫你，一般不用手动查。）',
      parameters: {
        type: 'object',
        properties: { prompt_id: { type: 'string' } },
        required: ['prompt_id'],
      },
      execute: async (p) => {
        const 配置 = 读配置()
        const id = 文本(p?.prompt_id).trim()
        if (!id) return { ok: false, 说: '给我 prompt_id' }
        const 记 = await 取历史(配置.baseUrl, id)
        const 台账 = 作业.get(id)
        const 已跑 = 台账 ? 秒数话(Date.now() - 台账.起来) : ''
        if (!记) {
          const 队 = await 取队列(配置.baseUrl)
          let 进度 = '还没完成（或还在排队）'
          if (队) {
            if (队.正在跑.includes(id)) 进度 = '正在跑'
            else {
              const 位 = 队.在排队.indexOf(id)
              if (位 >= 0) 进度 = '排队中，前面还有 ' + 位 + ' 个'
            }
          }
          return {
            ok: true,
            状态: 进度,
            prompt_id: id,
            已跑,
            盯着: 盯着.has(id) ? '是（跑完会主动叫你）' : '否',
            队列: 队 ? { 正在跑: 队.正在跑.length, 在排队: 队.在排队.length } : null,
          }
        }
        const 状态 = 记?.status?.status_str || (记?.status?.completed ? 'success' : 'unknown')
        const 产物 = 抠产物(记)
        if (台账) {
          台账.状态 = 状态
          台账.产物 = 产物
        }
        // 手动查到了也算「汇报过」：省得后台轮询器再叫一遍，重复发同一批图
        if (状态 === 'success' || 状态 === 'error') {
          if (台账) 台账.已汇报 = true
          存台账()
          const 盯记 = 盯着.get(id)
          if (盯记 && typeof 盯记.停 === 'function') { try { 盯记.停() } catch {} }
          盯着.delete(id)
        }
        const 提示词行 = []
        for (const [nid, o] of Object.entries(记.outputs || {})) {
          for (const t of o?.text || []) if (typeof t === 'string') 提示词行.push('[' + nid + '] ' + t.slice(0, 800))
        }
        return {
          ok: 状态 === 'success',
          prompt_id: id,
          状态,
          已跑,
          产物,
          产物数: 产物.length,
          文字输出: 提示词行,
          计划: 台账?.计划,
          注意: 产物.length ? '' : '这条没有视频/图片产物 —— 检查产物节点是否被绕过或没接上。',
        }
      },
    },
    {
      name: 'dsh_comfyui_console_cancel',
      description: '取消一个还在排队、尚未开始跑的任务（按 prompt_id 从队列摘掉）。正在跑的任务摘不掉，那种用 dsh_comfyui_console_interrupt。',
      parameters: {
        type: 'object',
        properties: { prompt_id: { type: 'string', description: '要取消的任务 prompt_id' } },
        required: ['prompt_id'],
      },
      execute: async (p) => {
        const 配置 = 读配置()
        const pid = 文本(p?.prompt_id).trim()
        if (!pid) return { ok: false, 说: '给我 prompt_id' }
        return await 取消排队(配置.baseUrl, pid)
      },
    },
    {
      name: 'dsh_comfyui_console_interrupt',
      description: '中断当前正在跑的那一条任务。只能打断当前正在执行的这条；打断后这条出不完、没有完整产物，排队的其他任务不受影响。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const 配置 = 读配置()
        return await 中断当前(配置.baseUrl)
      },
    },
    {
      name: 'dsh_comfyui_console_jobs',
      description: '列出全部任务：正在跑、排队中、已完成的都在，每条带状态、工作流、提示词摘要、排队位置、产物和报错。一次看清队列和各条产物归属。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const 配置 = 读配置()
        const 作业行 = await 汇总作业(配置)
        return { ok: true, 总数: 作业行.length, 作业: 作业行 }
      },
    },
    {
      name: 'dsh_comfyui_console_watch',
      description:
        '看现在有哪些作业在盯着：workflow、跑了多久、有没有已经汇报过。' +
        '也用来「现在到底有没有活在跑」——不用猜。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const 配置 = 读配置()
        const 队 = await 取队列(配置.baseUrl)
        const 行 = []
        for (const [id, 记] of 作业) {
          行.push({
            prompt_id: id,
            工作流: 记.工作流,
            已跑: 秒数话(Date.now() - (记.起来 || Date.now())),
            状态: 记.状态,
            已汇报: !!记.已汇报,
            盯着: 盯着.has(id),
            产物数: (记.产物 || []).length,
          })
        }
        return {
          ok: true,
          作业数: 行.length,
          作业: 行,
          队列: 队 ? { 正在跑: 队.正在跑.length, 在排队: 队.在排队.length } : null,
          说: 行.length ? '' : '手上没有作业。',
        }
      },
    },
    {
      name: 'dsh_comfyui_console_status',
      description: '看 ComfyUI 本身通不通、显存在忙什么、队列里还有几个。',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const 配置 = 读配置()
        const 探 = await 探活(配置.baseUrl)
        let 队列 = null
        try {
          const r = await fetch(配置.baseUrl.replace(/\/+$/, '') + '/queue', { signal: AbortSignal.timeout(5000) })
          const j = await r.json()
          队列 = { 跑着: (j?.queue_running || []).length, 等着: (j?.queue_pending || []).length }
        } catch {}
        return { ok: 探.通, ComfyUI: 探, 队列, baseUrl: 配置.baseUrl }
      },
    },
    {
      name: 'dsh_comfyui_console_loras',
      description: '列出 ComfyUI 里所有能挂的 LoRA 文件名（models/loras 下的相对路径），挂额外 LoRA 时照抄这里的名字。',
      parameters: {
        type: 'object',
        properties: {
          关键词: { type: 'string', description: '可选，按名字筛，比如 风格 / 模型名 / 角色' },
        },
        required: [],
      },
      execute: async (p) => {
        const 配置 = 读配置()
        let 列 = []
        try {
          const r = await fetch(配置.baseUrl.replace(/\/+$/, '') + '/models/loras', { signal: AbortSignal.timeout(8000) })
          列 = await r.json()
          if (!Array.isArray(列)) 列 = []
        } catch (e) {
          return { ok: false, 说: '拿不到 LoRA 列表：' + 文本(e?.message || e) }
        }
        const 问 = 文本(p?.关键词).trim().toLowerCase()
        const 过 = 问 ? 列.filter((x) => String(x).toLowerCase().includes(问)) : 列
        return { ok: true, 总数: 列.length, 命中: 过.length, loras: 过, 说: '一共 ' + 列.length + ' 个，命中 ' + 过.length + ' 个' }
      },
    },
  ]
  for (const 工具 of 表) {
    if (!工具.output) 工具.output = 通用输出()
    if (工具.parameters && 工具.parameters.additionalProperties === undefined) {
      工具.parameters.additionalProperties = false
    }
  }
  return 表
}

function 摘要话(a) {
  if (!a?.ok) return '分析失败：' + (a?.error || '?')
  const 片 = []
  片.push('类型 ' + a.类型)
  const 素 = a.素材 || {}
  const 数 = (x) => (x ? x.已接 + '/' + x.上限 : '无')
  片.push('图槽 ' + 数(素.images))
  片.push('视频槽 ' + 数(素.videos))
  片.push('音频槽 ' + 数(素.audios))
  if (a.提示词) 片.push('提示词 ' + (a.提示词.优化器 ? '本地优化器（' + a.提示词.类 + '）' : a.提示词.类))
  else 片.push('提示词 没认出')
  if (a.秒数) 片.push('秒数 直接填秒（当前 ' + a.秒数.当前 + '）')
  else 片.push('秒数 没认出')
  if (a.尺寸) 片.push('比例 ' + (a.尺寸.比例 || '?') + ' / ' + (a.尺寸.像素 ?? '?') + 'MP')
  片.push('产物 ' + (a.产物.map((x) => x.类).join(',') || '无'))
  if (a.警告.length) 片.push('⚠ ' + a.警告.join('；'))
  return 片.join('｜')
}

// ───────────────────── 插件入口（交互控制台 HTTP API） ─────────────────────

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
}
const mimeOf = (f) => MIME[extname(文本(f)).toLowerCase()] || 'application/octet-stream'

const 回JSON = (res, o, status = 200) => {
  try {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(o))
  } catch {}
}

const 读body = async (req) => {
  let body = ''
  for await (const 块 of req) body += 块
  try { return JSON.parse(body || '{}') } catch { return {} }
}

// client 传的是 inputDir 下的文件名；归一成完整路径，备料() 就直接认
const 归一素材 = (配置, arr) => (Array.isArray(arr)
  ? arr.filter(Boolean).map((f) => join(配置.inputDir, basename(文本(f))))
  : [])

function 摘要分析(a) {
  if (!a || !a.ok) return { ok: false, error: a?.error || '分析失败', 节点数: a?.节点数 || 0 }
  const 槽 = {}
  for (const [k, v] of Object.entries(a.素材 || {})) {
    if (v) 槽[k] = { 节点: v.节点, 键: v.键, 前缀: v.前缀, 上限: v.上限, 已接: (v.已接 || []).length }
  }
  return {
    ok: true, 节点数: a.节点数, 类型: a.类型,
    宿主: a.宿主, 素材: 槽,
    提示词: a.提示词 ? { 节点: a.提示词.节点, 类: a.提示词.类, 字段: a.提示词.字段, 优化器: a.提示词.优化器 } : null,
    秒数: a.秒数 ? { 节点: a.秒数.节点, 字段: a.秒数.字段, 模式: a.秒数.模式, 当前: a.秒数.当前 } : null,
    尺寸: a.尺寸 ? { 比例: a.尺寸.比例, 像素: a.尺寸.像素, 选项: a.尺寸.选项 || [] } : null,
    产物: (a.产物 || []).map((x) => x.类),
    可改: (a.可改 || []).map((x) => ({ 节点: x.节点, 类: x.类, 字段: x.字段, 阶段: x.阶段, 当前: x.当前 })),
    缺失节点: a.缺失节点 || [],
    警告: a.警告 || [],
  }
}

export function apply(ctx) {
  if (!existsSync(配置路径)) {
    try { mkdirSync(目录, { recursive: true }) } catch {}
    写配置(默认配置)
  }

  // ── AI 工具挂载：心跳把 12 个 dsh_comfyui_console_* 工具挂进每个会话 ──
  const 挂着 = new Map() // agentId → 卸载函数们

  function 挂工具到(agent) {
    const id = 文本(agent?.id || agent?.session?.id)
    if (!id || 挂着.has(id)) return
    if (!agent?.ctx?.tools || typeof agent.ctx.tools.register !== 'function') return
    const 卸们 = []
    for (const 工具 of 做工具(agent)) {
      try {
        const off = agent.ctx.tools.register(工具)
        卸们.push(typeof off === 'function' ? off : () => {})
      } catch (e) {
        try { ctx.logger?.warn?.('dsh-comfyui-console 挂 ' + 工具.name + ' 失败：' + 文本(e?.message || e)) } catch {}
      }
    }
    if (卸们.length) 挂着.set(id, () => { for (const off of 卸们) { try { off() } catch {} } })
  }

  function 心跳() {
    try {
      const 服务 = typeof ctx.get === 'function' ? ctx.get('agents') : null
      const 活 = []
      if (服务 && typeof 服务.list === 'function') {
        for (const a of 服务.list()) 活.push(a)
      }
      for (const a of 活) 挂工具到(a)
    } catch (e) {
      try { ctx.logger?.warn?.('dsh-comfyui-console 心跳出错：' + 文本(e?.message || e)) } catch {}
    }
  }

  // 连 ComfyUI 的 ws 拿实时节点/步数进度；连不上就定时重连，不影响既有 fetch 轮询
  function 连进度Ws() {
    let ws = null, 重连 = null, 已停 = false
    function 开() {
      if (已停) return
      try {
        const 配置 = 读配置()
        const wsUrl = 配置.baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/ws?clientId=dsh-comfyui-console'
        ws = new WebSocket(wsUrl)
        ws.onmessage = (ev) => {
          try {
            const d = ev.data
            if (typeof d !== 'string') return
            const m = JSON.parse(d)
            const data = m.data || {}
            const pid = 文本(data.prompt_id)
            if (!pid) return
            if (m.type === 'executing') {
              if (data.node == null) { 进度.delete(pid); return }
              const node = 文本(data.node)
              const 现 = 进度.get(pid) || { 节点: node, 步数: null, 上限: null, 各节点: {} }
              现.节点 = node
              if (!现.各节点[node]) {
                const 记 = 作业.get(pid)
                const 已知 = 记?.采样映射?.find((x) => x.采样器 === node)
                现.各节点[node] = { 步数: 0, 上限: 已知 ? 已知.上限 : null }
              }
              进度.set(pid, 现)
            } else if (m.type === 'progress') {
              const node = 文本(data.node)
              const 现 = 进度.get(pid) || { 节点: node, 步数: null, 上限: null, 各节点: {} }
              const value = Number(data.value), max = Number(data.max)
              const 旧 = 现.各节点[node] || { 步数: 0, 上限: null }
              旧.步数 = value
              if (max > 0) 旧.上限 = max
              else if (!旧.上限) {
                const 记 = 作业.get(pid)
                const 已知 = 记?.采样映射?.find((x) => x.采样器 === node)
                if (已知) 旧.上限 = 已知.上限
              }
              现.各节点[node] = 旧
              现.节点 = node
              现.步数 = value
              现.上限 = 旧.上限
              // 整条工作流完成度：已走步数 / 总采样步数。
              // 口径：只算采样器节点；分母优先用 progress 消息带的真实 max 之和，台账解析总上限兜底；
              // 上限未知的采样器先不计入分母，避免台账追溯偏小把进度提前顶到 100%。
              const 记0 = 作业.get(pid)
              const 采样集合 = 记0?.采样映射?.length ? new Set(记0.采样映射.map((x) => x.采样器)) : null
              let 已走 = 0, 动态上限 = 0
              for (const [nid, e] of Object.entries(现.各节点)) {
                if (采样集合 && !采样集合.has(nid)) continue
                if (!e.上限) continue
                已走 += Math.min(e.步数 || 0, e.上限)
                动态上限 += e.上限
              }
              const 总上限 = 动态上限 > 0 ? 动态上限 : (记0?.总上限 && 记0.总上限 > 0 ? 记0.总上限 : 0)
              现.总上限 = 总上限 > 0 ? 总上限 : null
              现.已走 = 已走
              现.全局 = 总上限 > 0 ? Math.max(0, Math.min(100, Math.round(已走 / 总上限 * 100))) : null
              进度.set(pid, 现)
            } else if (m.type === 'execution_success') {
              进度.delete(pid)
              标记终态(pid, 'success')
            } else if (m.type === 'execution_error') {
              进度.delete(pid)
              标记终态(pid, 'error')
            } else if (m.type === 'execution_interrupted') {
              进度.delete(pid)
              标记终态(pid, 'cancelled')
            }
          } catch {}
        }
        ws.onerror = () => {}
        ws.onclose = () => { if (!已停) 重连 = setTimeout(开, 5000) }
      } catch {
        if (!已停) 重连 = setTimeout(开, 5000)
      }
    }
    开()
    return () => {
      已停 = true
      clearTimeout(重连)
      try { ws?.close() } catch {}
    }
  }

  // 启动就来一次，之后每 20 秒补挂一次（新会话进来也能用）；卸载时清掉所有已挂工具
  ctx.effect(() => {
    心跳()
    预热档案()
    const 卸Ws = 连进度Ws()
    const t = setInterval(心跳, 20000)
    if (typeof t.unref === 'function') t.unref()
    return () => {
      clearInterval(t)
      try { 卸Ws() } catch {}
      for (const [, off] of 挂着) { try { off() } catch {} }
      挂着.clear()
    }
  })

  const 路由 = [
    ['GET', '/comfy-console/state', async () => {
      const 配置 = 读配置()
      const 目录状态 = {
        input: 目录已配(配置.inputDir) && existsSync(配置.inputDir),
        output: 目录已配(配置.outputDir) && existsSync(配置.outputDir),
        inputSet: 目录已配(配置.inputDir),
        outputSet: 目录已配(配置.outputDir),
      }
      return { ok: true, 配置, 目录: 目录状态, ComfyUI: await 探活(配置.baseUrl) }
    }],

    // 强制重拉节点档案并刷新本地缓存（装新插件后手动兜底；前端按钮可后接）
    ['GET', '/comfy-console/refresh-schema', async () => {
      const 配置 = 读配置()
      try {
        const 档案 = await 取对象信息(配置.baseUrl, true)
        return { ok: true, 类数: Object.keys(档案 || {}).length }
      } catch (e) {
        return { ok: false, 说: '刷新节点档案失败：' + 文本(e?.message || e) }
      }
    }],

    ['GET', '/comfy-console/defaults', async () => ({ ok: true, 表: 默认参数表 })],

    ['POST', '/comfy-console/defaults/save', async (url, req) => {
      const p = await 读body(req)
      const id = 文本(p.工作流).trim()
      if (!id) return { ok: false, 说: '缺少工作流标识' }
      const 规范 = 规范默认参数(p.默认)
      if (!Object.keys(规范).length) {
        delete 默认参数表[id]
      } else {
        const 旧 = (默认参数表[id] && typeof 默认参数表[id] === 'object') ? 默认参数表[id] : {}
        const 合并 = {}
        // 基础字段：本次有值才覆盖，缺省保留旧值，避免把没填的步数/种子冲掉
        ;['seconds', 'aspect', 'megapixels', 'seed'].forEach((k) => {
          if (规范[k] != null) 合并[k] = 规范[k]
          else if (旧[k] != null) 合并[k] = 旧[k]
        })
        // 步数：按节点合并，旧节点保留，本次同节点覆盖
        const 步 = {}
        if (旧.steps && typeof 旧.steps === 'object') for (const n in 旧.steps) 步[n] = 旧.steps[n]
        if (规范.steps) for (const n in 规范.steps) 步[n] = 规范.steps[n]
        if (Object.keys(步).length) 合并.steps = 步
        // LoRA：本次勾选列表整体替换；本次没传则保留旧列表
        if (Array.isArray(规范.loras)) 合并.loras = 规范.loras
        else if (Array.isArray(旧.loras)) 合并.loras = 旧.loras
        默认参数表[id] = 合并
      }
      存默认参数表()
      return { ok: true, 表: 默认参数表 }
    }],

    ['POST', '/comfy-console/config', async (url, req) => {
      const p = await 读body(req)
      const 配置 = 读配置()
      const 地址 = 文本(p.baseUrl).trim().replace(/\/+$/, '')
      if (地址 && !/^https?:\/\/\S+/.test(地址)) return { ok: false, 说: '连接地址需以 http:// 或 https:// 开头' }
      const 入 = {
        baseUrl: 地址 || 配置.baseUrl,
        inputDir: 文本(p.inputDir).trim(),
        outputDir: 文本(p.outputDir).trim(),
        notifyOnDone: typeof p.notifyOnDone === 'boolean' ? p.notifyOnDone : 配置.notifyOnDone,
      }
      写配置(Object.assign({}, 配置, 入))
      const 新配置 = 读配置()
      const 目录状态 = {
        input: 目录已配(新配置.inputDir) && existsSync(新配置.inputDir),
        output: 目录已配(新配置.outputDir) && existsSync(新配置.outputDir),
        inputSet: 目录已配(新配置.inputDir),
        outputSet: 目录已配(新配置.outputDir),
      }
      return { ok: true, 配置: 新配置, 目录: 目录状态, ComfyUI: await 探活(新配置.baseUrl) }
    }],

    ['GET', '/comfy-console/workflows', async () => {
      const 配置 = 读配置()
      const 列 = await Promise.all((配置.workflows || []).map(async (w) => {
        try {
          const r = await 分析工作流(配置, w)
          return { ...w, 节点数: r.节点数, 分析: r.分析 }
        } catch (e) {
          return { ...w, error: 文本(e?.message || e), 分析: { ok: false } }
        }
      }))
      return { ok: true, workflows: 列 }
    }],

    ['POST', '/comfy-console/workflows/import', async (url, req) => {
      const p = await 读body(req)
      const 配置 = 读配置()
      let 图 = null
      if (p.json != null) {
        try { 图 = typeof p.json === 'string' ? JSON.parse(p.json) : p.json }
        catch { return { ok: false, 说: 'JSON 解析失败：不是合法的工作流文件。' } }
      } else if (文本(p.file).trim()) {
        const 源 = 文本(p.file).trim()
        if (!existsSync(源)) return { ok: false, 说: '本地文件不存在：' + 源 }
        try { 图 = JSON.parse(readFileSync(源, 'utf8')) }
        catch { return { ok: false, 说: 'JSON 解析失败：不是合法的工作流文件。' } }
      } else {
        return { ok: false, 说: '要提供工作流内容（json）或本地文件路径（file）。' }
      }
      // 格式校验：必须是 API 格式，不是画布 UI 格式
      if (Array.isArray(图?.nodes)) return { ok: false, 说: '这是画布 UI 格式（带 nodes 数组），不是适配格式。请在 ComfyUI 开发者模式下用 Save (API Format) 重新导出后再导入。' }
      if (!图 || typeof 图 !== 'object') return { ok: false, 说: '不是适配格式：工作流内容应为 ComfyUI API 格式的 JSON 对象。' }
      const 节点数 = Object.keys(图).length
      if (!节点数) return { ok: false, 说: '工作流是空的，没有节点。' }

      const 名 = 文本(p.name).trim() || basename(文本(p.file) || '未命名流').replace(/\.json$/i, '') || '未命名流'
      const id = 文本(p.id).trim() || slugify(名, 配置)
      try { mkdirSync(工作流目录, { recursive: true }) } catch {}
      const 目标 = join(工作流目录, id + '.json')
      writeFileSync(目标, JSON.stringify(图, null, 2), 'utf8')
      配置.workflows = (配置.workflows || []).filter((w) => w.id !== id)
      配置.workflows.push({ id, name: 名, file: 目标, note: 文本(p.note || '') })
      写配置(配置)
      const a = await 分析(配置.baseUrl, 图)
      return { ok: true, id, name: 名, file: 目标, 节点数, 分析: 摘要分析(a) }
    }],

    ['POST', '/comfy-console/workflows/delete', async (url, req) => {
      const p = await 读body(req)
      const 配置 = 读配置()
      const w = 找工作流(配置, p.id || p.name || p.工作流)
      if (!w) return { ok: false, 说: '没这个工作流：' + 文本(p.id || p.name) }
      配置.workflows = (配置.workflows || []).filter((x) => x.id !== w.id)
      写配置(配置)
      if (w.file) 工作流分析缓存.delete(w.file)
      // 连统一目录内的本地副本一起删；Downloads 等原件不动
      try {
        if (w.file && existsSync(w.file)) {
          const 基 = resolve(工作流目录), 目 = resolve(w.file)
          if (目 === 基 || 目.startsWith(基 + sep)) unlinkSync(w.file)
        }
      } catch {}
      return { ok: true, 说: '已删除：' + w.id + '（' + (w.name || '') + '）' }
    }],

    ['POST', '/comfy-console/analyze', async (url, req) => {
      const p = await 读body(req)
      const 配置 = 读配置()
      const 条目 = 找工作流(配置, p.id || p.file || p.工作流)
        || (文本(p.file) ? { file: 文本(p.file) } : null)
      if (!条目) return { ok: false, 说: '找不到工作流' }
      const g = 读工作流图(条目)
      const a = await 分析(配置.baseUrl, g)
      const 节点 = Object.entries(g).map(([id, n]) => ({ id, 类: n.class_type, 标题: n._meta?.title || '' }))
      return { ok: true, id: 文本(条目.id), name: 文本(条目.name), 节点数: 节点.length, 节点, 分析: a }
    }],

    ['POST', '/comfy-console/upload', async (url, req) => {
      const p = await 读body(req)
      const 配置 = 读配置()
      const 名 = basename(文本(p.name || p.文件名)).replace(/[\\/:*?"<>|]/g, '_')
      if (!名 || 名 === '.' || 名 === '..') return { ok: false, 说: '要合法 name' }
      let data = 文本(p.dataBase64 || p.data).replace(/^data:[^;]+;base64,/, '')
      if (!data) return { ok: false, 说: '要 dataBase64' }
      if (!目录已配(配置.inputDir)) return { ok: false, 说: '未配置素材目录（input），请在面板「设置」里填写' }
      try { mkdirSync(配置.inputDir, { recursive: true }) } catch {}
      const 目标 = join(配置.inputDir, 名)
      writeFileSync(目标, Buffer.from(data, 'base64'))
      return { ok: true, name: 名, file: 目标, size: statSync(目标).size }
    }],

    ['GET', '/comfy-console/assets', async (url) => {
      const 配置 = 读配置()
      const kind = 文本(url.searchParams.get('kind') || 'input') === 'output' ? 'output' : 'input'
      const 基 = kind === 'output' ? 配置.outputDir : 配置.inputDir
      const 正则 = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv|mp3|wav|flac|ogg|m4a|json)$/i
      let 列 = []
      let total = 0
      let truncated = false
      if (目录已配(基)) {
        try {
          const 全部 = readdirSync(基).filter((f) => 正则.test(f))
          total = 全部.length
          if (kind === 'output') {
            // 按修改时间倒序，只取最近 N 个；stat 失败的 mtime 记 0，排到最后
            const 带时 = 全部.map((f) => {
              let m = 0
              try { m = statSync(join(基, f)).mtimeMs } catch {}
              return { f, m }
            }).sort((a, b) => b.m - a.m)
            truncated = 带时.length > 产物最近限量
            列 = 带时.slice(0, 产物最近限量).map((x) => x.f)
          } else {
            列 = 全部
          }
        } catch {}
      }
      return { ok: true, kind, files: 列, total, truncated }
    }],

    ['GET', '/comfy-console/loras', async () => {
      const 配置 = 读配置()
      let 列 = []
      try {
        const r = await fetch(配置.baseUrl.replace(/\/+$/, '') + '/models/loras', { signal: AbortSignal.timeout(8000) })
        列 = await r.json()
        if (!Array.isArray(列)) 列 = []
      } catch (e) {
        return { ok: false, 说: '拿不到 LoRA 列表：' + 文本(e?.message || e) }
      }
      return { ok: true, loras: 列 }
    }],

    ['POST', '/comfy-console/run', async (url, req) => {
      const p = await 读body(req)
      const 配置 = 读配置()
      const 条目 = 找工作流(配置, p.工作流 || p.workflow || p.id)
      if (!条目) return { ok: false, 说: '找不到工作流：' + 文本(p.工作流 || p.workflow || p.id) }
      const graph = 读工作流图(条目)
      const a = await 分析(配置.baseUrl, graph)
      if (!a.ok) return { ok: false, 说: '分析失败：' + a.error, 分析: a }
      const 有素材 = (Array.isArray(p.images) && p.images.length) || (Array.isArray(p.videos) && p.videos.length) || (Array.isArray(p.audios) && p.audios.length)
      if (有素材 && !目录已配(配置.inputDir)) return { ok: false, 说: '带了参考素材，但未配置素材目录（input），请在面板「设置」里填写' }
      const 请求 = {
        images: 归一素材(配置, p.images),
        videos: 归一素材(配置, p.videos),
        audios: 归一素材(配置, p.audios),
        prompt: 文本(p.prompt),
        seconds: p.seconds != null ? Number(p.seconds) : null,
        aspect: 文本(p.aspect || '16:9'),
        megapixels: p.megapixels != null ? Number(p.megapixels) : null,
        steps: p.steps != null ? Number(p.steps) : null,
        seed: p.seed != null ? Number(p.seed) : null,
        loras: Array.isArray(p.loras) ? p.loras : [],
      }
      const { graph: g, 日志 } = await 组装(配置.baseUrl, graph, a, 请求, 配置)
      const 提交结果 = await 提交(配置.baseUrl, g)
      const promptId = 文本(提交结果?.prompt_id)
      // 枚举最终图里各采样节点步数，作为整条工作流进度的分母（一采/二采都算上）
      const 采样映射 = 枚举步数(g).map((x) => ({ 采样器: x.采样器, 上限: Number(x.当前) || 0 }))
      const 总上限 = 采样映射.reduce((s, x) => s + x.上限, 0)
      const 输入回显 = {
        工作流: 文本(条目.name || 条目.id), id: 文本(条目.id),
        images: p.images || [], videos: p.videos || [], audios: p.audios || [],
        prompt: 请求.prompt, seconds: 请求.seconds, aspect: 请求.aspect,
        megapixels: 请求.megapixels, steps: 请求.steps, seed: 请求.seed,
        loras: 请求.loras,
      }
      if (promptId) {
        作业.set(promptId, {
          起来: Date.now(),
          工作流: 条目.id, 工作流名: 条目.name || '', 类型: a.类型 || '',
          摘要: 文本(请求.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          计划: 日志, 输入: 输入回显, 状态: '跑着', 已汇报: false,
          采样映射, 总上限,
        })
        存台账()
      }
      return { ok: true, prompt_id: promptId, 输入回显, 计划: 日志, 提交: 提交结果 }
    }],

    ['GET', '/comfy-console/job', async (url) => {
      const 配置 = 读配置()
      const promptId = 文本(url.searchParams.get('promptId'))
      if (!promptId) return { ok: false, 说: '要 promptId' }
      const 记 = 作业.get(promptId) || {}
      const 历 = await 取历史(配置.baseUrl, promptId)
      const 队 = await 取队列(配置.baseUrl)
      const 在跑 = !!(队?.正在跑?.includes(promptId))
      const 在排 = !!(队?.在排队?.includes(promptId))
      let 状态
      if (历?.status?.status_str) 状态 = 历.status.status_str
      else if (历?.status?.completed) 状态 = 'success'
      else if (在跑) 状态 = 'running'
      else if (在排) 状态 = 'queued'
      else if (记.状态 && 记.状态 !== '跑着') 状态 = 记.状态
      else if (记.状态 === '跑着' && 记.起来 && Date.now() - 记.起来 < 10000) 状态 = 'running'
      else 状态 = 'cancelled'
      // completed 是布尔值，不是时间戳；完成时刻从 messages 的 execution_success.timestamp 取（毫秒）
      const 完成时间 = 取结束时刻(历)
      const 耗时 = 记.起来 ? ((完成时间 || Date.now()) - 记.起来) : null
      const 队列位置 = 队?.在排队?.indexOf(promptId)
      const 产物 = (抠产物(历) || []).map((x) => ({
        节点: x.节点, 文件: x.文件, 子目录: x.子目录, 类型: x.类型,
        url: '/comfy-console/asset?kind=output&sub=' + encodeURIComponent(x.子目录 || '')
          + '&file=' + encodeURIComponent(x.文件),
      }))
      return {
        ok: true, prompt_id: promptId, 状态,
        队列位置: 队列位置 != null && 队列位置 >= 0 ? 队列位置 + 1 : null,
        正在跑: 队?.正在跑 || [], 在排队: 队?.在排队 || [], 耗时毫秒: 耗时,
        输入回显: 记.输入 || null, 计划: 记.计划 || [],
        进度: 进度.get(promptId) || null,
        产物, 报错: 提取报错(历?.status?.messages),
      }
    }],

    ['GET', '/comfy-console/jobs', async (url) => {
      const 配置 = 读配置()
      const 全量参数 = 文本(url.searchParams.get('all')) === '1'
      const { 普通, 全量 } = await 汇总两组(配置)
      const 作业行 = 全量参数 ? 全量 : 普通
      return { ok: true, 作业: 作业行, 全量, 总数: 作业行.length }
    }],

    ['POST', '/comfy-console/cancel', async (url, req) => {
      const p = await 读body(req)
      const 配置 = 读配置()
      const pid = 文本(p.prompt_id || p.id).trim()
      if (!pid) return { ok: false, 说: '要 prompt_id' }
      return await 取消排队(配置.baseUrl, pid)
    }],

    ['POST', '/comfy-console/interrupt', async () => {
      const 配置 = 读配置()
      return await 中断当前(配置.baseUrl)
    }],

    // 单条移除：把已结束任务记入隐藏集合（只隐藏面板记录，不删产物文件），并清掉内存台账
    ['POST', '/comfy-console/history/hide', async (url, req) => {
      const p = await 读body(req)
      const pid = 文本(p.prompt_id || p.id).trim()
      if (!pid) return { ok: false, 说: '要 prompt_id' }
      const 隐藏 = 读隐藏集合()
      if (!隐藏.includes(pid)) 隐藏.push(pid)
      存隐藏集合(隐藏)
      作业.delete(pid)
      存台账()
      return { ok: true, 隐藏: 隐藏.length }
    }],

    // 一键清空：把当前可见的已结束任务全部记入隐藏集合；正在跑/排队的保留
    ['POST', '/comfy-console/history/clear', async () => {
      const 配置 = 读配置()
      const 作业行 = await 汇总作业(配置)
      const 隐藏 = 读隐藏集合()
      let 清除 = 0
      for (const 行 of 作业行) {
        if (行.状态 === 'running' || 行.状态 === 'queued') continue
        if (!隐藏.includes(行.prompt_id)) { 隐藏.push(行.prompt_id); 清除++ }
        作业.delete(行.prompt_id)
      }
      存隐藏集合(隐藏)
      存台账()
      return { ok: true, 清除, 隐藏: 隐藏.length }
    }],

    ['GET', '/comfy-console/asset', async (url, req, res) => {
      const 配置 = 读配置()
      const kind = 文本(url.searchParams.get('kind') || 'output') === 'input' ? 'input' : 'output'
      const 原始基 = kind === 'input' ? 配置.inputDir : 配置.outputDir
      if (!目录已配(原始基)) { 回JSON(res, { ok: false, 说: '未配置目录，请在面板「设置」里填写' }, 404); return null }
      const 基 = resolve(原始基)
      const 子 = 文本(url.searchParams.get('sub')).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      const 名 = basename(文本(url.searchParams.get('file')))
      const 目标 = resolve(基, 子, 名)
      if (!名 || (目标 !== 基 && !目标.startsWith(基 + sep))) {
        回JSON(res, { ok: false, 说: '路径不合法' }, 403)
        return null
      }
      if (!existsSync(目标)) {
        回JSON(res, { ok: false, 说: '文件不存在：' + 名 }, 404)
        return null
      }
      const size = statSync(目标).size
      try {
        res.setHeader('Content-Type', mimeOf(名))
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Cache-Control', 'public, max-age=3600')
        const range = 文本(req.headers?.range)
        const m = /bytes=(\d+)-(\d*)/.exec(range)
        if (m) {
          const start = Math.min(Number(m[1]), Math.max(0, size - 1))
          const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
          if (end >= start) {
            res.statusCode = 206
            res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + size)
            res.setHeader('Content-Length', end - start + 1)
            res.end(readFileSync(目标).subarray(start, end + 1))
            return null
          }
        }
        res.setHeader('Content-Length', size)
        res.end(readFileSync(目标))
      } catch {}
      return null
    }],
  ]

  for (const [方法, 路径, handler] of 路由) {
    try {
      ctx.webServer?.register?.({
        kind: 'exact',
        path: 路径,
        handler: async (req, res) => {
          try {
            if (文本(req.method).toUpperCase() !== 方法) {
              回JSON(res, { ok: false, 说: '请用 ' + 方法 }, 405)
              return
            }
            const url = new URL(req.url || 路径, 'http://localhost')
            const out = await handler(url, req, res)
            if (out != null) 回JSON(res, out)
          } catch (e) {
            try { 回JSON(res, { ok: false, 说: 文本(e?.message || e) }) } catch {}
          }
        },
      })
    } catch (e) {
      try { ctx.logger?.warn?.('dsh-comfyui-console 注册 ' + 路径 + ' 失败：' + 文本(e?.message || e)) } catch {}
    }
  }
}

// 给离线测试用（不依赖 ctx）
export const _内部 = {
  分析, 组装, 秒变帧, 探活, 摘要话, 读配置, 写配置, 默认配置,
  取队列, 抠产物, 收尾话, 秒数话, 作业, 盯着,
  读隐藏集合, 存隐藏集合,
  取全历史, 汇总作业, 汇总两组, 取对象信息,
  规范默认参数,
}
