# ComfyUI 控制台（comfyui-console）

侧边栏独立入口的 ComfyUI 交互控制台：把本机已接入的工作流、可填参数、参考素材、LoRA、任务与产物集中展示，可直接在页面上改参数、传素材、提交运行、查看结果。同时向 DSH 会话暴露一组出片工具，可被 AI 调度调用。

## 能做什么

### 工作流
- 列表显示名称、节点数、类型（图 / 视频）与摘要；可从本地 JSON 导入，也可删除。
- 选中后查看节点结构与可改参数；装了新节点或节点表认不全时，点顶栏「刷新节点清单」重拉一份。

### 参数与素材
- 参数：提示词、秒数、画幅、像素 MP、步数（按节点）、种子、额外 LoRA（按文件夹分组、逐个体重）。
- 参考素材：图片 / 视频 / 音频，可本地上传，也可从 input 目录挑选已有素材；没给的槽绕过不填。
- 默认参数：把当前基础参数与已选 LoRA 存为这条流的默认，下次打开自动带上；提示词与素材不存，重复保存按项覆盖（本次填了的覆盖、没动的保留）。

### 运行与产物
- 按当前填好的素材和参数提交到本机 ComfyUI 运行；可取消排队、中断当前任务。
- 实时进度、队列位置、耗时；图 / 视频 / 音频产物在页面直接预览；历史产物可隐藏或清理。

## 两种使用方式

### 1. 面板手动使用（不依赖 AI 调度）
装好后在侧边栏打开控制台：设置里填地址与目录 → 导入 / 登记工作流 → 选流填参数传素材 → 点「运行」→ 在任务 / 产物标签页看进度和结果。整套流程不需要人格、记忆或任何 IM 桥。

### 2. AI 会话调度（可选）
插件通过心跳把下面一组工具挂进 DSH 会话。在自己的 agent 提示词里约定调用方式后，模型可按任务直接调用。触发规则（收到图片 / 视频任务就自动调用、跑完主动汇报）属于人格提示词 / 记忆侧的约定，不在本插件内；换环境时需要在那边重新写一遍。

### AI 工具清单（`comfyui_console_*`）

| 工具 | 用途 |
| --- | --- |
| `comfyui_console_list` | 列出已登记工作流及各自识别出的槽位 / 提示词节点 / 秒数节点 / 画幅 / 产物类型 |
| `comfyui_console_register` | 登记一个 API 格式 json 工作流，自动分析槽位与可改参数 |
| `comfyui_console_unregister` | 划掉一个工作流（只删登记，不动文件） |
| `comfyui_console_inspect` | 细看某条流的分析结果：槽位、提示词 / 秒数节点、产物节点、可改参数 |
| `comfyui_console_run` | 按工作流出片：素材自动接槽，给秒数 / 画幅 / 像素 / 步数 / 种子 / 额外 LoRA，提交后返回 prompt_id |
| `comfyui_console_job` | 查询单任务状态、进度与产物路径 |
| `comfyui_console_cancel` | 取消还在排队、尚未开始的任务 |
| `comfyui_console_interrupt` | 中断正在跑的任务 |
| `comfyui_console_jobs` | 任务汇总：队列 + 作业 + 产物归属 |
| `comfyui_console_watch` | 查看正在盯的作业：工作流、耗时、是否已汇报 |
| `comfyui_console_status` | 看 ComfyUI 连通性与队列忙碌情况 |
| `comfyui_console_loras` | 列出 models/loras 下可用 LoRA 相对路径，可按关键词筛 |

## 连接配置

首次使用前在「设置」里填三项：

- **ComfyUI 地址**：本机默认 `http://127.0.0.1:8188`；远程或容器填 `http://IP:端口`，网络可达即可。
- **素材目录 input**：ComfyUI 的 `input` 绝对路径，参考素材上传到这里。
- **产物目录 output**：ComfyUI 的 `output` 绝对路径，运行结果从这里读取。

目录留空时素材上传和产物读取不可用；配置保存即生效，无需重启。工作流依赖的模型、LoRA、自定义节点需要在本机 ComfyUI 里装好，本插件只负责调度。

## 完成通知（可选开关）

设置里「跑完主动通知」（配置项 `notifyOnDone`）默认开启：任务结束后唤醒当前会话汇报；会话不可用时兜底推送到已配置的 IM 桥。关闭后只更新台账和产物，不打扰任何人。IM 桥地址与目标在本机桥配置文件里，本插件不内置任何账号或目标。

## 数据来源

- 工作流与连接配置：`~/.dsh/comfyui-canvas.json`；默认参数表：`~/.dsh/comfyui-param-defaults.json`；工作流文件目录：`~/.dsh/comfyui-workflows/`；作业台账：`~/.dsh/comfyui-jobs-ledger.json`。
- ComfyUI 节点能力与提交：`http://127.0.0.1:8188` 的 `/object_info`、`/prompt`、`/history`、`/queue`、`/system_stats`。

## 路由

Host 端 HTTP 路由统一前缀 `/comfy-console/*`：

- `GET state` — 配置与 ComfyUI 探活
- `GET refresh-schema` — 刷新节点清单
- `GET defaults` / `POST defaults/save` — 默认参数读取 / 保存
- `POST config` — 保存连接配置（含通知开关）
- `GET workflows` — 工作流列表与摘要
- `POST workflows/import` / `POST workflows/delete` — 导入 / 删除工作流
- `POST analyze` — 单个工作流完整节点结构
- `POST upload` — 上传素材到 input 目录
- `GET assets?kind=input|output` — 列出素材 / 产物
- `GET loras` — 可用 LoRA 清单
- `POST run` — 组装并提交运行
- `GET job?promptId=` — 查询单任务状态 / 产物
- `GET jobs` — 任务汇总（队列 + 作业 + 产物归属）
- `POST cancel` / `POST interrupt` — 取消排队 / 中断当前
- `POST history/hide` / `POST history/clear` — 隐藏 / 清理历史产物
- `GET asset?kind&sub&file` — 产物预览

## 卸载

卸载只移除本插件注册的侧边栏入口与其 host 路由、已挂进会话的工具，不触碰其它 tab、不改动连接配置、不清空侧栏、不刷新页面。
