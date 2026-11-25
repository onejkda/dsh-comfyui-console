/* ComfyUI 控制台 · 浏览器半边（v2 重做版）
 * 布局：左栏工作流列表 + 选中流分析摘要；右栏步骤流：素材槽 → 参数/提示词 → 运行与产物 → 节点结构。
 * 所有读写走本插件 host 的 /comfy-console/* 同源接口；不碰别的插件状态，不改 ComfyUI 文件。
 */
;(function () {
  var PKG = 'dsh-comfyui-console'
  var KIND = 'comfy-console'
  var NS = 'comfyConsole'
  var CSS_ID = 'comfy-console-style-v2'

  var T = {
    title: 'ComfyUI 控制台',
    subtitle: '选工作流 → 传素材 → 填参数 → 运行 → 看结果',
    online: '已连接',
    offline: '未连接',
    refresh: '刷新',
    refreshSchema: '刷新节点清单',
    schemaReloading: '节点清单更新中…',
    run: '运行',
    running: '提交中…',
    workflows: '工作流',
    import: '导入工作流',
    delete: '删除',
    delConfirm: '确认删除？',
    hide: '移除',
    hideConfirm: '确认移除这条记录？',
    clearDone: '清空已结束',
    clearDoneConfirm: '确认清空全部已结束任务？',
    clearHint: '只隐藏面板记录，不删 output 里的结果文件',
    cancel: '取消',
    unclassified: '未分类',
    noWorkflow: '没有可用工作流',
    loadingWf: '正在加载工作流…',
    loadingJobs: '正在加载任务…',
    loadingAssets: '正在加载结果…',
    loadingLora: '正在加载 LoRA…',
    summary: '这个流认出来的',
    slots: '参考素材',
    images: '参考图片',
    videos: '参考视频',
    audios: '参考音频',
    upload: '上传',
    fromInput: '素材库',
    empty: '未选素材 —— 不给就不接',
    params: '参数',
    prompt: '提示词',
    promptPh: '写这一条要什么画面；有图就写「图一是…、图二是…」对号入座',
    seconds: '秒数',
    aspect: '画幅',
    megapixels: '像素 MP',
    steps: '步数（可空）',
    seed: '种子（可空）',
    lora: '额外 LoRA（可多选，权重可调）',
    loraEmpty: '没读到 LoRA 列表（models/loras 为空或连不上）',
    output: '运行结果',
    tabJobs: '任务清单',
    tabHistory: '历史结果',
    tabStruct: '节点结构',
    idle: '还没跑过。选好工作流和素材，点右上「运行」。',
    status: '状态',
    elapsed: '耗时',
    queue: '队列',
    echo: '本次填写',
    plan: '素材接法',
    assets: '生成结果',
    history: '历史结果（output 目录）',
    logs: '日志 / 报错',
    structure: '节点结构',
    loadStructure: '查看节点',
    nodes: '个节点',
    pickerEmpty: '目录里没有符合的文件',
    type: '类型',
    promptNode: '提示词',
    duration: '秒数',
    size: '画幅 / 像素',
    product: '结果',
    warn: '警告',
    optimizer: '提示词优化',
    external: '普通文本',
    noPrompt: '没认出提示词节点',
    noDuration: '没认出秒数节点',
    direct: '直接填秒',
    detail: '详细',
    detailHide: '收起',
    previewClose: '关闭预览',
    settings: '设置',
    cfgTitle: '连接与目录',
    cfgBase: 'ComfyUI 地址',
    cfgBasePh: 'http://127.0.0.1:8188（本机或远程 http://IP:端口）',
    cfgInput: '素材目录 input',
    cfgOutput: '结果目录 output',
    cfgDirPh: 'ComfyUI 安装目录下 input / output 的绝对路径',
    cfgSave: '保存',
    cfgCancel: '取消',
    cfgSaved: '已保存',
    cfgHint: '保存即生效；远程 ComfyUI 填它的 IP 与端口，网络可达即可。目录留空时素材上传和结果读取不可用。',
    cfgNotify: '跑完主动通知',
    cfgNotifyHint: '开：任务结束后唤醒当前会话汇报，会话不可用时兜底推送到已配置的 IM 桥；关：只更新台账和产物，不打扰任何人。',
    cfgDirBad: '路径不存在',
    hintSettings: '连接地址、素材目录和结果目录；连不上或目录读不到时在这里改',
    hintRefresh: '重新拉一遍工作流、任务和结果，不会重跑已提交的任务',
    hintSchema: '刚装了新插件/节点，或节点表认不全、提示缺失节点时，点这里重新拉一份清单',
    hintRun: '按当前填好的素材和参数提交运行',
    hintStruct: '查看这条工作流用到了哪些节点',
    missHint: '装好对应插件后，点顶栏「刷新节点清单」更新',
    saveDefault: '存默认参数',
    savedDefault: '已存 ✓',
    savingDefault: '保存中…',
    needSelect: '先选一条工作流',
    saveFail: '保存失败：',
    hintSaveDefault: '把当前参数（秒数、画幅、像素、步数、种子、已选 LoRA）存为这条流的默认，下次打开自动带上；提示词和素材不存',
    noteSaveDefault: '保存这条流的参数（秒数、画幅、像素、步数、种子、已选 LoRA），下次打开自动带上；提示词、素材不存；再次保存时，本次填了的项覆盖旧值，没动的项保留。',
  }

  // 兜底短码表；真实以下拉里后端给的 尺寸.选项 为准（节点不支持的比例不会出现）
  var ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9']

  var CSS = [
    '.cc-root{display:flex;flex-direction:column;height:100%;min-height:560px;box-sizing:border-box;overflow:hidden;',
    'background:var(--dsw-alias-bg-default,#101318);color:var(--dsw-alias-fg-default,#d6d9e0);',
    'font-size:13px;line-height:1.6;-webkit-font-smoothing:antialiased}',
    '.cc-top{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:14px 20px;',
    'border-bottom:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.26));position:sticky;top:0;z-index:3;',
    'background:var(--dsw-alias-bg-default,#101318)}',
    '.cc-title{font-size:16px;font-weight:700;letter-spacing:.2px}',
    '.cc-sub{font-size:12px;color:var(--dsw-alias-fg-muted,#9aa0aa);margin-top:2px}',
    '.cc-host{font-size:11px;color:var(--dsw-alias-fg-muted,#7c828c);margin-top:1px}',
    '.cc-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px}',
    '.cc-badge{display:inline-flex;align-items:center;font-size:12px;padding:4px 12px;border-radius:12px;',
    'border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.3));white-space:nowrap}',
    '.cc-spacer{flex:1 1 auto}',
    '.cc-progress{height:6px;border-radius:6px;background:rgba(127,127,127,.15);overflow:hidden;margin-top:4px}',
    '.cc-progress-bar{height:100%;border-radius:6px;width:40%;background:var(--dsw-alias-accent-fg,#4c9aff);animation:cc-slide 1.2s linear infinite}',
    '.cc-progress.done .cc-progress-bar{width:100%;animation:none;background:#3fb950}',
    '.cc-progress.err .cc-progress-bar{width:100%;animation:none;background:#f85149}',
    '@keyframes cc-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}',
    '.cc-prog-txt{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cc-body{flex:1 1 auto;min-height:0;display:flex;gap:18px;padding:20px 22px 56px;overflow:auto;align-items:flex-start}',
    '.cc-side{flex:0 0 300px;display:flex;flex-direction:column;gap:14px;position:sticky;top:0}',
    '.cc-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:16px}',
    '.cc-card{border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.26));border-radius:14px;',
    'background:var(--dsw-alias-bg-subtle,rgba(127,127,127,.07));overflow:hidden}',
    '.cc-h{display:flex;align-items:center;gap:8px;padding:11px 15px;font-size:12px;font-weight:700;',
    'letter-spacing:.4px;color:var(--dsw-alias-fg-muted,#9aa0aa);',
    'border-bottom:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.2))}',
    '.cc-h .cc-step{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;',
    'background:var(--dsw-alias-accent-emphasis,#2f7fe0);color:#fff;font-size:11px;font-weight:700}',
    '.cc-b{padding:14px 15px}',
    '.cc-wf{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:12px 13px;margin:0 0 9px;border-radius:10px;',
    'border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;font:inherit}',
    '.cc-wf:hover{background:rgba(127,127,127,.12)}',
    '.cc-wf.on{border-color:var(--dsw-alias-accent-fg,#4c9aff);background:rgba(76,154,255,.13)}',
    '.cc-wf-main{flex:1 1 auto;min-width:0}',
    '.cc-wf-n{font-size:13px;font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cc-wf-m{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cc-wf-actions{display:inline-flex;align-items:center;gap:6px}',
    '.cc-del-confirm{display:inline-flex;align-items:center;gap:6px}',
    '.cc-del-confirm .cc-btn.pri{background:rgba(248,81,73,.15);border-color:#f85149;color:#f85149}',
    '.cc-wf-warn{color:#d29922}',
    '.cc-hint{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;border-radius:50%;',
    'border:1px solid currentColor;font-size:9px;line-height:1;opacity:.55;margin-left:4px;font-style:italic;pointer-events:none}',
    '.cc-steps{display:flex;flex-direction:column;gap:6px}',
    '.cc-step-item{display:flex;align-items:center;gap:6px}',
    '.cc-step-tag{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);min-width:30px}',
    '.cc-step-item .cc-in{flex:1 1 auto}',
    '.cc-lora-group{margin-bottom:10px}',
    '.cc-lora-g{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);margin:2px 0 5px}',
    '.cc-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
    '.cc-grid5{display:grid;grid-template-columns:repeat(auto-fit,minmax(124px,1fr));gap:12px}',
    '@media(max-width:1100px){.cc-body{flex-direction:column}.cc-side{flex:1 1 auto;width:100%;position:static}.cc-grid5{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-grid3{grid-template-columns:1fr}}',
    '.cc-field{min-width:0}',
    '.cc-lb{font-size:11px;letter-spacing:.3px;color:var(--dsw-alias-fg-muted,#9aa0aa);margin-bottom:4px;display:block}',
    '.cc-in,.cc-sel,.cc-ta{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-default,#101318);',
    'color:inherit;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.3));border-radius:9px;',
    'padding:8px 10px;font:inherit;outline:none}',
    '.cc-in:focus,.cc-sel:focus,.cc-ta:focus{border-color:var(--dsw-alias-accent-fg,#4c9aff)}',
    '.cc-ta{min-height:110px;resize:vertical;line-height:1.6}',
    '.cc-btn{display:inline-flex;align-items:center;gap:5px;cursor:pointer;font:inherit;font-size:12px;',
    'padding:7px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.32));',
    'background:rgba(127,127,127,.1);color:inherit;white-space:nowrap}',
    '.cc-btn:hover{background:rgba(127,127,127,.2)}',
    '.cc-btn:disabled{opacity:.45;cursor:default}',
    '.cc-btn.pri{background:var(--dsw-alias-accent-emphasis,#2f7fe0);border-color:transparent;color:#fff;font-weight:600}',
    '.cc-btn.pri:hover{filter:brightness(1.1)}',
    '.cc-btn.sm{padding:5px 10px;font-size:11px}',
    '.cc-sticky{position:sticky;top:0;z-index:5}',
    '.cc-tabs{display:flex;gap:4px;align-items:center;border-bottom:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.26))}',
    '.cc-tab{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;font-size:12px;font-weight:600;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--dsw-alias-fg-muted,#9aa0aa);cursor:pointer;border-radius:8px 8px 0 0}',
    '.cc-tab:hover{color:var(--dsw-alias-fg-default,#d6d9e0)}',
    '.cc-tab.on{color:var(--dsw-alias-fg-default,#d6d9e0);border-bottom-color:var(--dsw-alias-accent-fg,#4c9aff)}',
    '.cc-tab-n{font-size:10px;color:var(--dsw-alias-fg-muted,#7c828c);font-weight:500}',
    '.cc-panel{padding-top:14px;display:flex;flex-direction:column;gap:12px}',
    '.cc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.cc-focus{border-bottom:1px solid rgba(127,127,127,.15);padding-bottom:10px}',
    '.cc-jobs{display:flex;flex-direction:column;gap:10px}',
    '.cc-job{border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.22));border-radius:12px;padding:11px 12px;background:rgba(127,127,127,.05);cursor:pointer}',
    '.cc-job.on{border-color:var(--dsw-alias-accent-fg,#4c9aff);background:rgba(76,154,255,.08)}',
    '.cc-job-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.cc-job-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}',
    '.cc-job-type{font-size:10px;color:var(--dsw-alias-fg-muted,#9aa0aa);border:1px solid rgba(127,127,127,.25);border-radius:6px;padding:1px 6px}',
    '.cc-job-id{font-size:10px;color:var(--dsw-alias-fg-muted,#7c828c);font-family:ui-monospace,Consolas,monospace}',
    '.cc-job-sub{display:flex;gap:10px;margin-top:6px;font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);flex-wrap:wrap}',
    '.cc-job-prompt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}',
    '.cc-job-queue{color:#58a6ff}',
    '.cc-detail-btn{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);background:transparent;border:1px solid rgba(127,127,127,.25);border-radius:6px;padding:2px 9px;cursor:pointer}',
    '.cc-detail-btn:hover{color:var(--dsw-alias-fg-default,#d6d9e0);border-color:rgba(127,127,127,.45)}',
    '.cc-job-detail{margin-top:10px;padding-top:10px;border-top:1px solid rgba(127,127,127,.16);display:flex;flex-direction:column;gap:10px}',
    '.cc-job-detail .cc-kv{font-size:11px}',
    '.cc-preview-mask{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:32px;cursor:zoom-out}',
    '.cc-preview-box{max-width:min(1100px,92vw);max-height:88vh;display:flex;flex-direction:column;gap:10px;align-items:center;cursor:default}',
    '.cc-preview-box img,.cc-preview-box video{max-width:100%;max-height:78vh;border-radius:12px;object-fit:contain;background:#000}',
    '.cc-preview-cap{font-size:12px;color:#cfd3da;word-break:break-all;max-width:90vw;text-align:center}',
    '.cc-preview-close{position:absolute;top:18px;right:22px;font-size:13px;color:#e6e9ee;background:rgba(127,127,127,.25);border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:6px 12px;cursor:pointer}',
    '.cc-setup-box{width:min(520px,92vw);background:var(--dsw-alias-bg-default,#101318);border:1px solid rgba(127,127,127,.3);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px;cursor:default;box-shadow:0 18px 50px rgba(0,0,0,.5)}',
    '.cc-setup-title{font-size:15px;font-weight:700}',
    '.cc-setup-hint{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);line-height:1.6}',
    '.cc-setup-rows{display:flex;flex-direction:column;gap:12px}',
    '.cc-setup-row{display:flex;flex-direction:column;gap:5px}',
    '.cc-setup-row .cc-lb{display:flex;align-items:center;gap:8px}',
    '.cc-dir-tag{font-size:10px;padding:1px 7px;border-radius:7px;font-weight:500}',
    '.cc-dir-tag.ok{color:#3fb950;border:1px solid rgba(63,185,80,.4);background:rgba(63,185,80,.12)}',
    '.cc-dir-tag.bad{color:#f85149;border:1px solid rgba(248,81,73,.4);background:rgba(248,81,73,.12)}',
    '.cc-setup-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}',
    '.cc-setup-msg{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa)}',
    '.cc-loras{margin-top:12px}',
    '.cc-loras-h{font-size:11px;letter-spacing:.3px;color:var(--dsw-alias-fg-muted,#9aa0aa);margin-bottom:6px;display:flex;justify-content:space-between;gap:8px;cursor:pointer;align-items:center;user-select:none}',
    '.cc-loras-h:hover{color:var(--dsw-alias-fg,#e6edf3)}',
    '.cc-lora-arrow{font-size:10px;width:12px}',
    '.cc-lora-row{display:flex;flex-wrap:wrap;gap:6px;max-height:96px;overflow:auto}',
    '.cc-lora{appearance:none;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.3));background:rgba(127,127,127,.08);color:inherit;border-radius:9px;padding:5px 10px;font-size:11px;cursor:pointer}',
    '.cc-lora.on{border-color:var(--dsw-alias-accent-fg,#4c9aff);background:rgba(76,154,255,.15);display:flex;align-items:center;gap:6px}',
    '.cc-lora-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;display:inline-block;vertical-align:middle}',
    '.cc-lora-w{width:52px;background:rgba(127,127,127,.1);border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.3));border-radius:6px;color:inherit;font-size:11px;padding:2px 4px}',
    '.cc-lora-x{appearance:none;background:none;border:none;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0 2px;opacity:.6}',
    '.cc-lora-x:hover{opacity:1}',
    '.cc-slot{border:1px dashed var(--dsw-alias-border-default,rgba(127,127,127,.34));border-radius:12px;padding:12px;min-height:112px;',
    'display:flex;flex-direction:column;gap:10px}',
    '.cc-slot-h{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.cc-slot-t{font-size:12px;font-weight:600}',
    '.cc-slot-limit{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);font-weight:400}',
    '.cc-slot-actions{display:inline-flex;gap:6px;flex-wrap:wrap}',
    '.cc-refs{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px}',
    '.cc-ref{position:relative;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.28));border-radius:10px;',
    'overflow:hidden;background:rgba(0,0,0,.22);display:flex;flex-direction:column}',
    '.cc-ref-media{width:100%;height:76px;display:flex;align-items:center;justify-content:center;background:#000}',
    '.cc-ref-media img,.cc-ref-media video{display:block;width:100%;height:100%;object-fit:cover}',
    '.cc-ref-ico{font-size:22px;opacity:.7}',
    '.cc-ref-idx{position:absolute;top:5px;left:5px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;',
    'background:rgba(0,0,0,.72);color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}',
    '.cc-ref-name{padding:5px 7px;font-size:10px;color:var(--dsw-alias-fg-muted,#c2c7d0);line-height:1.35;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}',
    '.cc-ref-x{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:9px;border:0;cursor:pointer;',
    'background:rgba(0,0,0,.72);color:#f85149;font-weight:700;font-size:12px;line-height:18px;text-align:center;padding:0}',
    '.cc-x{cursor:pointer;color:#f85149;font-weight:700;flex:0 0 auto}',
    '.cc-ph{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa)}',
    '.cc-loading{font-size:11px;color:var(--dsw-alias-accent-fg,#4c9aff);display:flex;align-items:center;gap:8px;animation:cc-fade 1.1s ease-in-out infinite}',
    '.cc-loading::before{content:"";flex:0 0 auto;width:11px;height:11px;border-radius:50%;border:2px solid rgba(76,154,255,.25);border-top-color:var(--dsw-alias-accent-fg,#4c9aff);animation:cc-spin .8s linear infinite}',
    '@keyframes cc-spin{to{transform:rotate(360deg)}}',
    '@keyframes cc-fade{0%,100%{opacity:.55}50%{opacity:1}}',
    '.cc-pre{margin:0;max-height:220px;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:11px;',
    'white-space:pre-wrap;word-break:break-all;line-height:1.55}',
    '.cc-kv{display:grid-template-columns:auto 1fr;gap:6px 14px;font-size:12px;display:grid}',
    '.cc-kv dt{color:var(--dsw-alias-fg-muted,#9aa0aa)}',
    '.cc-kv dd{margin:0;word-break:break-all}',
    '.cc-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-top:4px}',
    '.cc-thumb{border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.28));border-radius:11px;overflow:hidden;background:rgba(0,0,0,.2)}',
    '.cc-thumb img,.cc-thumb video{display:block;width:100%;height:auto;max-height:190px;object-fit:cover;background:#000}',
    '.cc-thumb-ico{display:flex;align-items:center;justify-content:center;height:120px;font-size:34px;background:rgba(127,127,127,.1)}',
    '.cc-thumb a{display:block;padding:6px 8px;font-size:11px;color:var(--dsw-alias-accent-fg,#4c9aff);',
    'text-decoration:none;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}',
    '.cc-thumb-name{display:block;padding:6px 8px;font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}',
    '.cc-thumb-open{cursor:zoom-in}',
    '.cc-thumbs-mini{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}',
    '.cc-thumb.mini{width:66px;border-radius:8px}',
    '.cc-thumb.mini img,.cc-thumb.mini video{max-height:66px}',
    '.cc-thumb.mini .cc-thumb-name{display:none}',
    '.cc-thumb-more{display:flex;align-items:center;justify-content:center;width:66px;height:66px;border-radius:8px;font-size:12px;color:var(--dsw-alias-fg-muted,#9aa0aa);background:rgba(127,127,127,.12)}',
    '.cc-prod-group{border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.22));border-radius:12px;padding:10px 12px;margin-bottom:12px;background:rgba(0,0,0,.12)}',
    '.cc-prod-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}',
    '.cc-prod-title{font-size:12px;font-weight:600;color:var(--dsw-alias-fg-default,#d6d9e0)}',
    '.cc-prod-meta{font-size:11px;color:var(--dsw-alias-fg-muted,#9aa0aa)}',
    '.cc-prod-summary{font-size:11px;color:var(--dsw-alias-fg-muted,#7c828c);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cc-nodes{display:flex;flex-direction:column;gap:9px}',
    '.cc-node-row{display:flex;gap:10px;align-items:baseline}',
    '.cc-node-k{flex:0 0 80px;color:var(--dsw-alias-fg-muted,#9aa0aa);font-size:11px}',
    '.cc-node-v{min-width:0;word-break:break-all;font-size:12px;overflow:hidden}',
    '.cc-node-cls{color:var(--dsw-alias-fg-muted,#7c828c);font-family:ui-monospace,Consolas,monospace;font-size:10px;margin-left:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;max-width:55%;vertical-align:bottom}',
    '.cc-node-more{margin-top:8px;font-size:11px;color:var(--dsw-alias-fg-muted,#7c828c)}',
    '.cc-picker{margin-top:6px;max-height:160px;overflow:auto;border:1px solid var(--dsw-alias-border-default,rgba(127,127,127,.24));border-radius:8px}',
    '.cc-pick{display:block;width:100%;text-align:left;padding:6px 10px;border:0;border-bottom:1px solid rgba(127,127,127,.14);',
    'background:transparent;color:inherit;font:inherit;font-size:11px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cc-pick:hover{background:rgba(76,154,255,.14)}',
    '.cc-err{padding:14px;color:#f85149;font-family:ui-monospace,Consolas,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all}',
    '.cc-summary{display:flex;flex-direction:column;gap:9px;font-size:12px}',
    '.cc-sum-row{display:flex;gap:8px;align-items:baseline}',
    '.cc-sum-k{flex:0 0 70px;color:var(--dsw-alias-fg-muted,#9aa0aa);font-size:11px}',
    '.cc-sum-v{min-width:0;word-break:break-all}',
    '.cc-h.clickable{cursor:pointer;user-select:none}',
    '.cc-arrow{display:inline-block;font-size:10px;width:12px;line-height:1;color:var(--dsw-alias-fg-muted,#9aa0aa);transition:transform .15s}',
    '.cc-arrow.open{transform:rotate(90deg)}',
    '.cc-hide{display:none}',
  ].join('')

  function injectCSS() {
    try {
      if (typeof document === 'undefined') return
      if (document.getElementById(CSS_ID)) return
      var s = document.createElement('style')
      s.id = CSS_ID
      s.textContent = CSS
      document.head.appendChild(s)
    } catch (e) {}
  }

  // 接口返回统一兜底：任何非对象都归一成 {ok:false, 说:String}，绝不让函数/裸值进渲染
  function api(path, opts) {
    return fetch(path, Object.assign({ cache: 'no-store', headers: { 'Content-Type': 'application/json' } }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, status: r.status } })
      })
      .catch(function (e) { return { ok: false, 说: String((e && e.message) || e) } })
      .then(function (j) {
        if (j == null || typeof j !== 'object') return { ok: false, 说: String(j) }
        return j
      })
  }

  function readB64(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader()
      r.onload = function () { res(String(r.result).replace(/^data:[^;]+;base64,/, '')) }
      r.onerror = rej
      r.readAsDataURL(file)
    })
  }

  // 任意值 → 安全字符串，对象转 JSON，绝不把函数 toString 漏出去
  function str(v) {
    if (v == null) return ''
    if (typeof v === 'function') return '[函数]'
    if (typeof v === 'object') {
      try { return JSON.stringify(v, null, 1) } catch (e) { return String(v) }
    }
    return String(v)
  }

  function aspectOf(v) {
    var m = /(\d+:\d+)/.exec(str(v))
    return m ? m[1] : ''
  }

  // 毫秒 → “x 秒 / x 分 y 秒”；取不到返回空串
  function fmtElapsed(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return ''
    var s = Math.round(ms / 1000)
    if (s < 60) return s + ' 秒'
    var m = Math.floor(s / 60)
    return m + ' 分 ' + (s % 60) + ' 秒'
  }

  // 把后端分析结果拼成「人话关键节点」清单：角色标签 + 内容 + 类名小字；不铺全量裸节点
  function buildNodeRows(a) {
    var rows = []
    if (!a) return rows
    if (a.类型) rows.push({ k: T.type, v: str(a.类型) })
    if (a.提示词) rows.push({
      k: T.promptNode,
      v: (a.提示词.优化器 ? T.optimizer : T.external) + (a.提示词.当前 ? '：' + str(a.提示词.当前).slice(0, 60) : ''),
      cls: a.提示词.类,
    })
    if (a.秒数) rows.push({
      k: T.duration,
      v: T.direct + ' · 当前 ' + str(a.秒数.当前),
      cls: a.秒数.来源 || a.秒数.类,
    })
    if (a.尺寸) rows.push({ k: T.size, v: str(a.尺寸.比例) + ' / ' + str(a.尺寸.像素) + 'MP', cls: a.尺寸.类 })
    if (a.宿主) rows.push({ k: '素材入口节点', v: str(a.宿主.类) })
    ;(a.产物 || []).forEach(function (p) { rows.push({ k: T.product, v: p.类型 === 'video' ? '视频' : '图片', cls: p.类 }) })
    ;(a.可改 || []).forEach(function (p) { rows.push({ k: '可调参数', v: str(p.字段) + (p.当前 != null ? '=' + str(p.当前) : ''), cls: p.类 }) })
    return rows
  }

  // 后端台账初始是中文「跑着」，ComfyUI 回的是英文 status_str；统一归一成英文状态
  function normStatus(s) {
    if (s == null) return ''
    var v = String(s)
    if (v === '跑着' || v === '运行中' || v === 'running') return 'running'
    if (v === '排队中' || v === 'queued') return 'queued'
    if (v === 'success' || v === '成功' || v === 'completed') return 'success'
    if (v === 'error' || v === 'failed' || v === '失败') return 'error'
    if (v === 'cancelled' || v === '已取消') return 'cancelled'
    return v
  }

  if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: PKG,
      factory: function (require) {
        var module = { exports: {} }
        var exports = module.exports
        var React = require('react')
        var h = React.createElement
        var useState = React.useState
        var useEffect = React.useEffect
        var useRef = React.useRef
        var useCallback = React.useCallback

        // ── 小组件 ──
        function Card(props) {
          return h('div', { className: 'cc-card' + (props.className ? ' ' + props.className : '') },
            props.title
              ? h('div', { className: 'cc-h' },
                  props.step ? h('span', { className: 'cc-step' }, props.step) : null,
                  h('span', null, props.title),
                  h('span', { className: 'cc-spacer' }),
                  props.extra || null)
              : null,
            h('div', { className: 'cc-b' }, props.children))
        }

        function CardCollapse(props) {
          var open = !!props.open
          return h('div', { className: 'cc-card' },
            h('div', {
              className: 'cc-h clickable',
              onClick: props.onToggle,
            },
              h('span', { className: 'cc-arrow' + (open ? ' open' : '') }, '▸'),
              props.step ? h('span', { className: 'cc-step' }, props.step) : null,
              h('span', null, props.title),
              h('span', { className: 'cc-spacer' }),
              props.extra || null),
            open ? h('div', { className: 'cc-b' }, props.children) : null)
        }

        function Btn(props) {
          return h('button', {
            type: 'button',
            className: 'cc-btn' + (props.pri ? ' pri' : '') + (props.sm ? ' sm' : ''),
            disabled: !!props.disabled,
            onClick: props.onClick,
            title: props.title || undefined,
          }, props.children)
        }

        function HintIcon() {
          return h('span', { className: 'cc-hint' }, 'i')
        }

        function Field(props) {
          return h('div', { className: 'cc-field' },
            h('label', { className: 'cc-lb' }, props.label),
            props.children)
        }

        function loraChip(props) {
          var n = props.name
          var parts = String(n).split('\\')
          var base = parts[parts.length - 1].split('/').pop()
          return h('button', { type: 'button', key: n, title: n,
            className: 'cc-lora' + (props.on ? ' on' : ''),
            onClick: props.onToggle },
            h('span', { className: 'cc-lora-n' }, base))
        }

        function RefGrid(props) {
          var items = props.items || []
          if (!items.length) return h('div', { className: 'cc-ph' }, T.empty)
          var kind = props.kind
          return h('div', { className: 'cc-refs' },
            items.map(function (n, i) {
              var name = str(n)
              var url = props.urlFor ? props.urlFor('input', name) : '#'
              var media
              if (kind === 'audios') media = h('span', { className: 'cc-ref-ico' }, '🎵')
              else if (kind === 'videos') media = h('video', { src: url + '#t=0.1', muted: true, preload: 'metadata' })
              else media = h('img', { src: url, alt: name, loading: 'lazy' })
              return h('div', { className: 'cc-ref', key: i, title: name },
                h('span', { className: 'cc-ref-idx' }, i + 1),
                h('div', { className: 'cc-ref-media' }, media),
                h('button', {
                  className: 'cc-ref-x', type: 'button', title: '移除',
                  onClick: function () { props.onRemove(i) },
                }, '×'),
                h('div', { className: 'cc-ref-name' }, name))
            }))
        }

        function Slot(props) {
          var limit = props.limit
          return h('div', { className: 'cc-slot' },
            h('div', { className: 'cc-slot-h' },
              h('span', { className: 'cc-slot-t' },
                props.label,
                limit != null && !isNaN(Number(limit))
                  ? h('span', { className: 'cc-slot-limit' }, ' · 上限 ' + limit + ' 张') : null),
              h('span', { className: 'cc-slot-actions' },
                h('input', {
                  type: 'file', multiple: props.multiple !== false, accept: props.accept,
                  style: { display: 'none' }, ref: props.inputRef,
                  onChange: function (e) { props.onFiles(e.target.files); e.target.value = '' },
                }),
                h(Btn, { sm: true, onClick: function () { if (props.inputRef.current) props.inputRef.current.click() } }, T.upload),
                h(Btn, { sm: true, onClick: props.onPick }, T.fromInput))),
            h(RefGrid, { items: props.items, kind: props.kind, urlFor: props.urlFor, onRemove: props.onRemove }),
            props.pickerOpen ? h('div', { className: 'cc-picker' },
              (props.pickerFiles || []).length
                ? props.pickerFiles.map(function (f) {
                    return h('button', {
                      type: 'button', className: 'cc-pick', key: f, title: f,
                      onClick: function () { props.onChoose(f) },
                    }, f)
                  })
                : h('div', { className: 'cc-ph', style: { padding: '8px 9px' } }, T.pickerEmpty)
            ) : null)
        }

        function SummaryRow(props) {
          return h('div', { className: 'cc-sum-row' },
            h('span', { className: 'cc-sum-k' }, props.k),
            h('span', { className: 'cc-sum-v' }, props.v || '—'))
        }

        // ── 主体 ──
        function Console() {
          var rootRef = useRef(null)

          var [sWorkflows, setWorkflows] = useState([])
          var [sSelected, setSelected] = useState('')
          var [sDelConfirm, setDelConfirm] = useState(false)
          var [sStatus, setStatus] = useState(null)
          var [sConfig, setConfig] = useState(null)
          var [sStructure, setStructure] = useState(null)
          var [sStructLoading, setStructLoading] = useState(false)

          var [sImages, setImages] = useState([])
          var [sVideos, setVideos] = useState([])
          var [sAudios, setAudios] = useState([])
          var [sPrompt, setPrompt] = useState('')
          var [sSeconds, setSeconds] = useState(5)
          var [sAspect, setAspect] = useState('16:9')
          var [sAspectOpts, setAspectOpts] = useState([])
          var [sMega, setMega] = useState(1.5)
          var [sStepMap, setStepMap] = useState({})
          var [sSeed, setSeed] = useState('')
          var [sLoras, setLoras] = useState([])
          var [sLoraAll, setLoraAll] = useState([])

          var [sAssets, setAssets] = useState({ input: [], output: [] })
          var [sPickFor, setPickFor] = useState(null)

          var [sBusy, setBusy] = useState(false)
          var [sPromptId, setPromptId] = useState('')
          var [sJob, setJob] = useState(null)
          var [sStopping, setStopping] = useState(false)
          var [sJobs, setJobs] = useState([])
          var [sAllJobs, setAllJobs] = useState([])
          var [sFocusId, setFocusId] = useState('')
          var [sLoraOpen, setLoraOpen] = useState(false)
          var [sPlan, setPlan] = useState([])
          var [sEcho, setEcho] = useState(null)
          var [sFatal, setFatal] = useState(null)
          var [sHistLimit, setHistLimit] = useState(24)
          var [sDoneOpen, setDoneOpen] = useState(false)
          var [sMainTab, setMainTab] = useState('jobs')
          var [sDetailId, setDetailId] = useState('')
          var [sPreview, setPreview] = useState(null)
          var [sDir, setDir] = useState(null)
          var [sShowSettings, setShowSettings] = useState(false)
          var [sCfgForm, setCfgForm] = useState({ baseUrl: '', inputDir: '', outputDir: '', notifyOnDone: true })
          var [sCfgSaving, setCfgSaving] = useState(false)
          var [sCfgMsg, setCfgMsg] = useState('')
          var [sClearing, setClearing] = useState(false)
          var [sSchemaLoading, setSchemaLoading] = useState(false)
          var [sDefaults, setDefaults] = useState({})
          var [sDefaultMsg, setDefaultMsg] = useState('')
          var [sDefaultBusy, setDefaultBusy] = useState(false)
          var [sHideId, setHideId] = useState('')
          var [sConfirmClear, setConfirmClear] = useState(false)
          // 首屏各区块加载态：只在首次拉取期间显示“正在加载”，轮询刷新不闪
          var [sWfLoading, setWfLoading] = useState(true)
          var [sJobsLoading, setJobsLoading] = useState(true)
          var [sAssetsLoading, setAssetsLoading] = useState(true)
          var [sLoraLoading, setLoraLoading] = useState(true)
          var wfLoaded = useRef(false)
          var jobsLoaded = useRef(false)
          var assetsLoaded = useRef(false)
          var loraLoaded = useRef(false)
          var clearTimer = useRef(null)

          var timer = useRef(null)
          var jobsTimer = useRef(null)
          var 活跃Ref = useRef(false)
          var mountedRef = useRef(true)
          // 连接失败缓冲：连续两次探活不通才翻红，单次超时/繁忙不把绿灯打红
          var 失败计数 = useRef(0)
          var imgInput = useRef(null), vidInput = useRef(null), audInput = useRef(null)
          var wfInput = useRef(null)
          var delTimer = useRef(null)

          // 动态轮询：有任务在跑/排队时 1 秒一刷（跑完立刻翻完成态），全空闲回到 5 秒
          var scheduleJobs = function () {
            if (!mountedRef.current) return
            if (jobsTimer.current) clearTimeout(jobsTimer.current)
            var ms = 活跃Ref.current ? 1000 : 5000
            jobsTimer.current = setTimeout(function () {
              if (!mountedRef.current) return
              loadJobs(); loadAssets(); loadLoras()
              // 全空闲 5 秒档顺带复查一次连接；有任务在跑的 1 秒档不打 /state，避免频繁探活
              if (!活跃Ref.current) loadState()
              scheduleJobs()
            }, ms)
          }
          useEffect(function () {
            mountedRef.current = true
            loadState()
            refresh()
            scheduleJobs()
            return function () {
              mountedRef.current = false
              if (timer.current) clearInterval(timer.current)
              if (jobsTimer.current) clearTimeout(jobsTimer.current)
              if (delTimer.current) clearTimeout(delTimer.current)
              if (clearTimer.current) clearTimeout(clearTimer.current)
            }
          }, [loadState, refresh])

          // 默认表晚于工作流列表到达：到达后对当前选中流补一次已存参数覆盖（不清素材/产物）
          useEffect(function () {
            if (mountedRef.current && sSelected && sDefaults && sDefaults[sSelected]) {
              applyStored(sSelected, sDefaults[sSelected])
            }
          }, [sDefaults, sSelected])

          var loadAssets = useCallback(function () {
            if (!assetsLoaded.current) setAssetsLoading(true)
            var 清 = function () { if (mountedRef.current) { assetsLoaded.current = true; setAssetsLoading(false) } }
            api('/comfy-console/assets?kind=input').then(function (j) {
              if (j && j.ok && mountedRef.current) setAssets(function (a) { return Object.assign({}, a, { input: j.files || [] }) })
              清()
            })
            api('/comfy-console/assets?kind=output').then(function (j) {
              if (j && j.ok && mountedRef.current) setAssets(function (a) {
                return Object.assign({}, a, { output: j.files || [], outputTotal: j.total || 0, outputTruncated: !!j.truncated })
              })
              清()
            })
          }, [])

          var loadLoras = useCallback(function () {
            if (!loraLoaded.current) setLoraLoading(true)
            api('/comfy-console/loras').then(function (j) {
              if (!mountedRef.current) return
              loraLoaded.current = true; setLoraLoading(false)
              if (j && j.ok) setLoraAll(Array.isArray(j.loras) ? j.loras : [])
            })
          }, [])

          var loadDefaults = useCallback(function () {
            api('/comfy-console/defaults').then(function (j) {
              if (mountedRef.current && j && j.ok) setDefaults(j.表 || {})
            })
          }, [])

          // 探活结果带缓冲落徽章：成功清零；连续两次不通才翻红，单次超时/繁忙保留上次状态
          var 应用探活 = function (comfy) {
            if (comfy && comfy.通) { 失败计数.current = 0; setStatus(comfy); return }
            失败计数.current += 1
            if (失败计数.current >= 2) setStatus(comfy || { 通: false })
          }

          // 只拉连接状态：进面板先亮“已连接/未连接”徽章，不等工作流和产物清单
          var loadState = useCallback(function () {
            api('/comfy-console/state').then(function (j) {
              if (!mountedRef.current) return
              if (j && j.ok) {
                setConfig(j.配置 || null)
                setDir(j.目录 || null)
                应用探活(j.ComfyUI || null)
              } else {
                // 接口本身没通：记一次失败但不翻红，保留上次徽章
                失败计数.current += 1
              }
            })
          }, [])

          var loadJobs = useCallback(function () {
            if (!jobsLoaded.current) setJobsLoading(true)
            var 清 = function () { if (mountedRef.current) { jobsLoaded.current = true; setJobsLoading(false) } }
            // 一次请求同时回普通组（任务清单）和全量组（历史产物墙分组），后端只汇总一遍
            api('/comfy-console/jobs').then(function (j) {
              清()
              if (!mountedRef.current) return
              if (j && j.ok) {
                var rows = Array.isArray(j.作业) ? j.作业 : []
                var all = Array.isArray(j.全量) ? j.全量 : rows
                setJobs(rows)
                setAllJobs(all)
                活跃Ref.current = rows.some(function (r) { var k = normStatus(r.状态); return k === 'running' || k === 'queued' })
              }
            })
          }, [])

          var refresh = useCallback(function () {
            var 首次进入 = !wfLoaded.current
            if (!wfLoaded.current) setWfLoading(true)
            api('/comfy-console/workflows').then(function (j) {
              if (mountedRef.current) { wfLoaded.current = true; setWfLoading(false) }
              if (!mountedRef.current) return
              if (j && j.ok) {
                var list = Array.isArray(j.workflows) ? j.workflows : []
                setWorkflows(list)
                // 连接状态只认 /state 探活，工作流路由的附带探活不覆盖徽章，避免重活后那次探活超时把绿灯打成红
                var 目标 = (sSelected && list.some(function (w) { return w && w.id === sSelected })) ? sSelected : ((list[0] && list[0].id) || '')
                setSelected(目标)
                // 仅首屏拿到列表后回填一次当前流；轮询刷新不重复清空素材与产物
                if (首次进入 && 目标) selectWorkflow(目标, list)
                setFatal(null)
              } else {
                setFatal(str((j && (j.说 || j.error)) || '工作流列表读取失败'))
              }
            })
            loadAssets()
            loadLoras()
            loadJobs()
            loadDefaults()
            // 连接状态串行复查一次，不在首屏和 loadState 并发打第二个 /state
            loadState()
          }, [loadAssets, loadLoras, loadJobs, loadState, loadDefaults])

          // 强制重拉节点档案（装了新插件/节点后兜底）；成功后重拉工作流分析
          var refreshSchema = function () {
            if (sSchemaLoading) return
            setSchemaLoading(true)
            api('/comfy-console/refresh-schema').then(function (j) {
              if (!mountedRef.current) return
              setSchemaLoading(false)
              if (j && j.ok) { refresh() } else { setFatal(str((j && (j.说 || j.error)) || '刷新节点清单失败')) }
            })
          }

          var openSettings = function () {
            var c = sConfig || {}
            setCfgForm({
              baseUrl: c.baseUrl || 'http://127.0.0.1:8188',
              inputDir: c.inputDir || '',
              outputDir: c.outputDir || '',
              notifyOnDone: c.notifyOnDone !== false,
            })
            setCfgMsg('')
            setShowSettings(true)
          }

          var saveSettings = function () {
            setCfgSaving(true); setCfgMsg('')
            api('/comfy-console/config', {
              method: 'POST',
              body: JSON.stringify({ baseUrl: sCfgForm.baseUrl, inputDir: sCfgForm.inputDir, outputDir: sCfgForm.outputDir, notifyOnDone: sCfgForm.notifyOnDone }),
            }).then(function (j) {
              if (!mountedRef.current) return
              setCfgSaving(false)
              if (j && j.ok) {
                setConfig(j.配置 || null); setDir(j.目录 || null); setStatus(j.ComfyUI || null)
                setCfgMsg(T.cfgSaved)
                loadAssets(); loadLoras(); loadJobs()
                setTimeout(function () { if (mountedRef.current) setShowSettings(false) }, 350)
              } else {
                setCfgMsg(str(j && (j.说 || j.error) || '保存失败'))
              }
            })
          }

          // 只把已存默认参数覆盖到当前参数 state，不清素材/产物/任务（默认表晚到时补发一次用）
          var applyStored = function (id, 已存, 选项) {
            if (!id || !已存) return
            var opts = 选项 || sAspectOpts || []
            if (已存.seconds != null) setSeconds(已存.seconds)
            if (已存.aspect && (!opts.length || opts.indexOf(已存.aspect) >= 0)) setAspect(已存.aspect)
            if (已存.megapixels != null) setMega(已存.megapixels)
            if (已存.steps) {
              setStepMap(function (cur) {
                var o = {}; for (var k in cur) o[k] = cur[k]
                for (var n in 已存.steps) o[n] = 已存.steps[n]
                return o
              })
            }
            if (已存.seed != null) setSeed(String(已存.seed))
            setLoras(Array.isArray(已存.loras) ? 已存.loras.map(function (l) {
              return { name: l.文件名, weight: l.权重 == null ? 1 : l.权重 }
            }) : [])
          }

          // 选中工作流：按它的分析结果回填默认参数，清掉上一条流的素材与产物
          var selectWorkflow = function (id, 列表) {
            if (!id) return
            setSelected(id)
            setStructure(null)
            setImages([]); setVideos([]); setAudios([])
            setJob(null); setEcho(null); setPlan([]); setPromptId('')
            var wf = 列表 || sWorkflows || []
            var w = wf.filter(function (x) { return x && x.id === id })[0]
            var a = w && w.分析
            var 已存 = (sDefaults && sDefaults[id]) || {}
            if (a && a.ok) {
              var 尺寸 = a.尺寸 || null
              var 选项 = (尺寸 && Array.isArray(尺寸.选项)) ? 尺寸.选项 : []
              setAspectOpts(选项)
              if (a.秒数 && a.秒数.当前 != null) setSeconds(a.秒数.当前)
              var 当前比例 = 尺寸 && 尺寸.比例
              if (当前比例 && 选项.indexOf(当前比例) >= 0) setAspect(当前比例)
              else { var ar = aspectOf(当前比例); if (ar) setAspect(ar); else if (选项.length) setAspect(选项[0]) }
              if (尺寸 && 尺寸.像素 != null) setMega(尺寸.像素)
              // 步数：按可改清单里带阶段的项回填默认值；种子：取第一个种子项
              var 可改 = Array.isArray(a.可改) ? a.可改 : []
              var 步默认 = {}
              可改.forEach(function (x) { if (x.阶段) 步默认[x.节点] = x.当前 != null ? String(x.当前) : '' })
              setStepMap(步默认)
              var 种子项 = 可改.filter(function (x) { return !x.阶段 })[0]
              setSeed(种子项 && 种子项.当前 != null ? String(种子项.当前) : '')
              // 已存默认参数覆盖流原值
              applyStored(id, 已存, 选项)
            } else {
              setSeconds(5); setAspect('16:9'); setMega(1.5); setAspectOpts([])
              setStepMap({}); setSeed('')
              applyStored(id, 已存, [])
            }
            setPrompt('')
          }

          // 导入工作流：选本地 json → 后端校验 API 格式 → 复制进统一目录并登记
          var importWorkflow = function (file) {
            if (!file) return
            var reader = new FileReader()
            reader.onload = function () {
              var 名 = file.name.replace(/\.json$/i, '')
              api('/comfy-console/workflows/import', { method: 'POST', body: JSON.stringify({ json: reader.result, name: 名 }) })
                .then(function (j) {
                  if (!mountedRef.current) return
                  if (j && j.ok) refresh()
                  else setFatal(str((j && (j.说 || j.error)) || '导入失败'))
                })
            }
            reader.readAsText(file, 'utf8')
          }

          // 删除工作流（两步确认，防误点）：先点删除进确认态，4 秒不操作自动复位；再点确认才真删
          var 复位删除 = function () {
            setDelConfirm(false)
            if (delTimer.current) { clearTimeout(delTimer.current); delTimer.current = null }
          }
          var requestDelete = function () {
            if (!sSelected) return
            setDelConfirm(true)
            if (delTimer.current) clearTimeout(delTimer.current)
            delTimer.current = setTimeout(function () { if (mountedRef.current) setDelConfirm(false) }, 4000)
          }
          var confirmDelete = function () {
            var id = sSelected
            var w = (sWorkflows || []).filter(function (x) { return x.id === id })[0]
            if (!w) { 复位删除(); return }
            复位删除()
            api('/comfy-console/workflows/delete', { method: 'POST', body: JSON.stringify({ id: id }) })
              .then(function (j) {
                if (!mountedRef.current) return
                if (j && j.ok) refresh()
                else setFatal(str((j && (j.说 || j.error)) || '删除失败'))
              })
          }

          var loadStructure = function () {
            if (!sSelected) return
            setMainTab('struct')
            setStructLoading(true)
            api('/comfy-console/analyze', { method: 'POST', body: JSON.stringify({ id: sSelected }) }).then(function (j) {
              if (!mountedRef.current) return
              setStructLoading(false)
              setStructure(j && j.ok ? j : { ok: false, 说: str((j && (j.说 || j.error)) || '加载失败') })
            })
          }

          var setterFor = function (kind) {
            return kind === 'images' ? setImages : kind === 'videos' ? setVideos : setAudios
          }

          var uploadFiles = function (kind, files) {
            if (!files || !files.length) return
            var setter = setterFor(kind)
            Promise.all(Array.prototype.map.call(files, function (f) {
              return readB64(f).then(function (data) {
                return api('/comfy-console/upload', { method: 'POST', body: JSON.stringify({ name: f.name, dataBase64: data }) })
              })
            })).then(function (rs) {
              if (!mountedRef.current) return
              var names = rs.filter(function (r) { return r && r.ok }).map(function (r) { return r.name })
              if (names.length) {
                setter(function (cur) { return cur.concat(names) })
                loadAssets()
              }
            })
          }

          var addExisting = function (kind, name) {
            var setter = setterFor(kind)
            setter(function (cur) { return cur.indexOf(name) >= 0 ? cur : cur.concat([name]) })
            setPickFor(null)
          }

          var RE_KIND = {
            images: /\.(png|jpe?g|webp|gif|bmp)$/i,
            videos: /\.(mp4|webm|mov|mkv)$/i,
            audios: /\.(mp3|wav|flac|ogg|m4a)$/i,
          }
          var filesFor = function (kind) {
            var re = RE_KIND[kind]
            return (sAssets.input || []).filter(function (f) { return !re || re.test(f) })
          }

          var pollJob = function (pid) {
            if (timer.current) { clearInterval(timer.current); timer.current = null }
            var tick = function () {
              api('/comfy-console/job?promptId=' + encodeURIComponent(pid)).then(function (j) {
                if (!mountedRef.current) return
                if (j && j.ok) setJob(j)
                loadJobs()
                var st = normStatus(j && j.状态)
                if (st === 'success' || st === 'error' || st === 'failed' || st === 'cancelled' || st === 'unknown') {
                  if (timer.current) { clearInterval(timer.current); timer.current = null }
                  loadAssets()
                }
              })
            }
            tick()
            timer.current = setInterval(tick, 2500)
          }

          // 停止：queued 按 pid 从队列摘掉；running 中断当前正在跑的这条
          var stopJob = function (pid, mode) {
            pid = pid || sPromptId
            if (!pid || sStopping) return
            var isInterrupt = mode === 'interrupt'
            setStopping(true)
            var path = isInterrupt ? '/comfy-console/interrupt' : '/comfy-console/cancel'
            var body = isInterrupt ? '{}' : JSON.stringify({ prompt_id: pid })
            api(path, { method: 'POST', body: body }).then(function (j) {
              if (!mountedRef.current) return
              setStopping(false)
              if (!j || !j.ok) {
                setJob(function (cur) { return Object.assign({}, cur, { 报错: str((j && j.说) || (isInterrupt ? '中断失败' : '取消失败')) }) })
                return
              }
              if (timer.current) { clearInterval(timer.current); timer.current = null }
              loadJobs()
              api('/comfy-console/job?promptId=' + encodeURIComponent(pid)).then(function (jj) {
                if (!mountedRef.current) return
                if (jj && jj.ok) setJob(jj)
                else setJob(function (cur) { return Object.assign({}, cur, { 状态: 'cancelled' }) })
                loadAssets()
              })
              ;[1000, 2500].forEach(function (ms) {
                setTimeout(function () { if (mountedRef.current) loadJobs() }, ms)
              })
            })
          }

          // 清理记录：单条移除 / 一键清空已结束（两步确认；只隐藏面板记录，不删 output 产物文件）
          var 复位清理确认 = function () {
            setConfirmClear(false); setHideId('')
            if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null }
          }
          var 安排清理复位 = function () {
            if (clearTimer.current) clearTimeout(clearTimer.current)
            clearTimer.current = setTimeout(function () { if (mountedRef.current) 复位清理确认() }, 4000)
          }
          var hideJob = function (pid) {
            if (!pid || sClearing) return
            if (sHideId !== pid) { setHideId(pid); 安排清理复位(); return } // 第一步：进确认态，再点一次才真删
            复位清理确认(); setClearing(true)
            api('/comfy-console/history/hide', { method: 'POST', body: JSON.stringify({ prompt_id: pid }) }).then(function (j) {
              if (!mountedRef.current) return
              setClearing(false)
              if (j && j.ok) loadJobs(); else setFatal(str((j && (j.说 || j.error)) || '移除失败'))
            })
          }
          var clearDone = function () {
            if (sClearing) return
            if (!sConfirmClear) { setConfirmClear(true); 安排清理复位(); return }
            复位清理确认(); setClearing(true)
            api('/comfy-console/history/clear', { method: 'POST', body: '{}' }).then(function (j) {
              if (!mountedRef.current) return
              setClearing(false)
              if (j && j.ok) { loadJobs(); loadAssets() } else setFatal(str((j && (j.说 || j.error)) || '清空失败'))
            })
          }

          var run = function () {
            if (!sSelected || sBusy) return
            setBusy(true)
            setJob(null); setEcho(null); setPlan([])
            var body = {
              工作流: sSelected,
              images: sImages, videos: sVideos, audios: sAudios,
              prompt: sPrompt,
              aspect: sAspect,
              megapixels: Number(sMega),
            }
            if (出视频) body.seconds = Number(sSeconds)
            var 步列表 = Object.keys(sStepMap).map(function (节点) { return { 节点: 节点, 值: sStepMap[节点] } })
              .filter(function (x) { return x.值 !== '' && x.值 != null })
            if (步列表.length) body.stepsList = 步列表
            if (sSeed !== '') body.seed = Number(sSeed)
            if (sLoras.length) body.loras = sLoras.map(function (l) { return { 文件名: l.name, 权重: l.weight == null ? 1 : Number(l.weight) } })
            api('/comfy-console/run', { method: 'POST', body: JSON.stringify(body) }).then(function (j) {
              if (!mountedRef.current) return
              setBusy(false)
              if (!j || !j.ok) {
                setJob({ ok: false, 状态: 'error', 报错: str((j && (j.说 || j.error)) || '运行失败'), 产物: [] })
                setPlan((j && j.计划) || [])
                return
              }
              setPromptId(j.prompt_id || '')
              setFocusId(j.prompt_id || '')
              setEcho(j.输入回显 || null)
              setPlan(j.计划 || [])
              if (j.prompt_id) pollJob(j.prompt_id)
            })
          }

          var sel = (sWorkflows || []).filter(function (w) { return w && w.id === sSelected })[0]
          var selA = sel && sel.分析
          var 步项 = (selA && selA.ok && Array.isArray(selA.可改)) ? selA.可改.filter(function (x) { return x.阶段 }) : []
          var 出视频 = !!(selA && selA.类型 === 'video')

          var saveDefault = function () {
            if (sDefaultBusy) return
            var 提示 = function (文) {
              setDefaultMsg(文)
              setTimeout(function () { if (mountedRef.current) setDefaultMsg('') }, 2600)
            }
            if (!sSelected) { 提示(T.needSelect); return }
            var 是视频 = !!(selA && selA.类型 === 'video')
            var 出 = {}
            if (是视频 && sSeconds !== '' && Number.isFinite(Number(sSeconds))) 出.seconds = Number(sSeconds)
            if (sAspect) {
              var 匹配画幅 = (sAspectOpts || []).filter(function (o) { return aspectOf(o) === aspectOf(sAspect) })
              出.aspect = 匹配画幅.length ? 匹配画幅[0] : sAspect
            }
            if (sMega !== '' && Number.isFinite(Number(sMega))) 出.megapixels = Number(sMega)
            var 步 = {}
            Object.keys(sStepMap).forEach(function (节点) {
              var v = sStepMap[节点]
              if (v !== '' && v != null && Number.isFinite(Number(v))) 步[节点] = Number(v)
            })
            if (Object.keys(步).length) 出.steps = 步
            if (sSeed !== '' && Number.isFinite(Number(sSeed))) 出.seed = Number(sSeed)
            if (sLoras.length) 出.loras = sLoras.map(function (l) { return { 文件名: l.name, 权重: l.weight == null ? 1 : Number(l.weight) } })
            setDefaultBusy(true); setDefaultMsg(T.savingDefault)
            api('/comfy-console/defaults/save', { method: 'POST', body: JSON.stringify({ 工作流: sSelected, 默认: 出 }) }).then(function (j) {
              if (!mountedRef.current) { setDefaultBusy(false); return }
              setDefaultBusy(false)
              if (j && j.ok) {
                setDefaults(j.表 || {})
                提示(T.savedDefault)
              } else {
                提示(T.saveFail + (j && j.说 ? j.说 : '未知错误'))
              }
            })
          }

          // LoRA 按一级文件夹分组；根目录散件归「未分类」
          var loraGroup = {}
          ;(sLoraAll || []).forEach(function (n) {
            var parts = String(n).split(/[\\/]/)
            var g = parts.length > 1 ? parts[0] : T.unclassified
            ;(loraGroup[g] = loraGroup[g] || []).push(n)
          })
          var loraGroups = Object.keys(loraGroup).sort(function (a, b) {
            if (a === T.unclassified) return 1
            if (b === T.unclassified) return -1
            return a.localeCompare(b, 'zh-CN')
          })
          var renderLora = function (n) {
            var item = sLoras.filter(function (x) { return x.name === n })[0]
            if (!item) return h(loraChip, { name: n, on: false, onToggle: function () {
              setLoras(function (cur) { return cur.concat({ name: n, weight: 1 }) })
            } })
            var base = String(n).split(/[\\/]/).pop()
            return h('div', { className: 'cc-lora on', key: n },
              h('span', { className: 'cc-lora-n' }, base),
              h('input', { className: 'cc-lora-w', type: 'number', min: 0, max: 2, step: 0.05,
                value: item.weight, title: '权重',
                onChange: function (e) {
                  setLoras(function (cur) { return cur.map(function (x) { return x.name === n ? { name: n, weight: e.target.value } : x }) })
                } }),
              h('button', { type: 'button', className: 'cc-lora-x', title: '移除',
                onClick: function () { setLoras(function (cur) { return cur.filter(function (x) { return x.name !== n }) }) } }, '×'))
          }
          var online = !!(sStatus && sStatus.通)

          // 目录状态标签（反映当前已保存配置）
          var dirTag = function (kind) {
            var d = sDir || {}
            var set = kind === 'input' ? d.inputSet : d.outputSet
            var ok = kind === 'input' ? d.input : d.output
            if (!set) return h('span', { className: 'cc-dir-tag bad' }, '未配置')
            if (!ok) return h('span', { className: 'cc-dir-tag bad' }, T.cfgDirBad)
            return h('span', { className: 'cc-dir-tag ok' }, '正常')
          }

          // 单条任务状态 → 颜色 / 文案
          var 状态色 = function (s) {
            var k = normStatus(s)
            return k === 'success' ? '#3fb950'
              : k === 'error' || k === 'failed' ? '#f85149'
                : k === 'running' ? '#d29922'
                  : k === 'queued' ? '#58a6ff'
                    : '#8b949e'
          }
          var 状态文 = function (s) {
            var k = normStatus(s)
            return k === 'success' ? '完成' : k === 'error' ? '失败' : k === 'failed' ? '失败'
              : k === 'running' ? '运行中' : k === 'queued' ? '排队中'
                : k === 'cancelled' ? '已取消' : (k || '未知')
          }
          var thumbOne = function (p, i, mini) {
            var fn = str(p.文件)
            var isImg = /\.(png|jpe?g|webp|gif|bmp)$/i.test(fn)
            var isVid = /\.(mp4|webm|mov|mkv)$/i.test(fn)
            var isAud = /\.(mp3|wav|flac|ogg|m4a)$/i.test(fn)
            var url = p.url
            var media = isImg ? h('img', { src: url, alt: fn, loading: 'lazy' })
              : isVid ? h('video', { src: url + '#t=0.1', muted: true, controls: true, preload: 'metadata' })
              : isAud ? h('div', { className: 'cc-thumb-ico' }, '🎵') : null
            var 可预览 = isImg || isVid
            var open = 可预览 ? function (e) { e.stopPropagation(); setPreview({ url: url, name: fn, kind: isImg ? 'img' : 'vid' }) } : null
            return h('div', { className: 'cc-thumb' + (mini ? ' mini' : '') + (可预览 ? ' cc-thumb-open' : ''), key: i,
              onClick: open, title: 可预览 ? '点击查看大图' : fn },
              media,
              h('div', { className: 'cc-thumb-name' }, fn))
          }
          var renderThumbs = function (产物) {
            if (!产物 || !产物.length) return null
            return h('div', { className: 'cc-thumbs' }, 产物.map(function (p, i) { return thumbOne(p, i, false) }))
          }
          var renderMiniThumbs = function (产物, 上限) {
            if (!产物 || !产物.length) return null
            var 限 = 上限 || 4
            var 可见 = 产物.slice(0, 限)
            var 多 = 产物.length - 可见.length
            return h('div', { className: 'cc-thumbs-mini' },
              可见.map(function (p, i) { return thumbOne(p, i, true) }),
              多 > 0 ? h('div', { className: 'cc-thumb-more', title: '还有 ' + 多 + ' 个结果' }, '+' + 多) : null)
          }
          var renderJobCard = function (job) {
            var k = normStatus(job.状态)
            var 色 = 状态色(job.状态)
            var 名 = job.工作流名 || job.工作流 || '未命名流'
            var 摘要 = job.摘要 || ''
            var 可停 = (k === 'running' || k === 'queued')
            var 聚焦 = job.prompt_id === sFocusId
            var 展开 = sDetailId === job.prompt_id
            var 回显 = job.输入 || null
            var 计划行 = job.计划
            var 计划文 = Array.isArray(计划行) ? 计划行.map(str).join('\n') : str(计划行)
            var 进度记 = job.进度 || null
            var 全局 = (进度记 && 进度记.全局 != null) ? 进度记.全局 : null
            var 节点文 = (进度记 && (进度记.节点 || 进度记.步数 != null))
              ? (进度记.节点 ? '节点 ' + 进度记.节点 : '') + (进度记.步数 != null ? ' · 第 ' + 进度记.步数 + (进度记.上限 ? '/' + 进度记.上限 : '') + ' 步' : '')
              : ''
            var 全局文 = 全局 != null ? '全局 ' + 全局 + '%' : ''
            var 进度文 = [全局文, 节点文].filter(Boolean).join(' · ')
            var pct = (进度记 && 进度记.上限 && 进度记.步数 != null)
              ? Math.max(0, Math.min(100, Math.round(进度记.步数 / 进度记.上限 * 100))) : null
            var 条宽 = 全局 != null ? 全局 : pct
            return h('div', { className: 'cc-job' + (聚焦 ? ' on' : '') + (展开 ? ' open' : ''), key: job.prompt_id,
                onClick: function () { setFocusId(job.prompt_id) } },
              h('div', { className: 'cc-job-h' },
                h('span', { className: 'cc-badge', style: { color: 色, borderColor: 色 } }, 状态文(job.状态)),
                h('span', { className: 'cc-job-name' }, str(名)),
                job.类型 ? h('span', { className: 'cc-job-type' }, job.类型 === 'video' ? '视频' : '图片') : null,
                h('span', { className: 'cc-spacer' }),
                h('span', { className: 'cc-job-id' }, '#' + str(job.编号 || job.prompt_id).slice(0, 8)),
                h('button', { type: 'button', className: 'cc-detail-btn',
                  onClick: function (e) { e.stopPropagation(); setDetailId(展开 ? '' : job.prompt_id) } },
                  展开 ? T.detailHide : T.detail),
                可停 ? h('button', { type: 'button', className: 'cc-btn sm', disabled: sStopping,
                  style: { color: '#f85149', borderColor: '#f85149' },
                  onClick: function (e) { e.stopPropagation(); stopJob(job.prompt_id, k === 'running' ? 'interrupt' : 'cancel') } },
                  sStopping ? '…' : (k === 'running' ? '中断当前' : '取消排队')) : null,
                !可停 ? h('button', { type: 'button', className: 'cc-btn sm', disabled: sClearing,
                  style: sHideId === job.prompt_id
                    ? { color: '#f85149', borderColor: '#f85149' }
                    : { color: '#9aa0aa', borderColor: 'rgba(127,127,127,.3)' },
                  title: T.clearHint,
                  onClick: function (e) { e.stopPropagation(); hideJob(job.prompt_id) } },
                  sHideId === job.prompt_id ? T.hideConfirm : T.hide) : null),
              (摘要 || job.排队位置 != null || job.耗时毫秒 != null)
                ? h('div', { className: 'cc-job-sub' },
                    摘要 ? h('span', { className: 'cc-job-prompt' }, 摘要) : null,
                    job.排队位置 != null ? h('span', { className: 'cc-job-queue' }, '排队第 ' + job.排队位置 + ' 位') : null,
                    job.耗时毫秒 != null ? h('span', { className: 'cc-job-queue' }, T.elapsed + ' ' + fmtElapsed(job.耗时毫秒)) : null)
                : null,
              可停
                ? h('div', null,
                    h('div', { className: 'cc-progress' },
                      h('div', { className: 'cc-progress-bar',
                        style: 条宽 != null ? { width: 条宽 + '%', background: 色, animation: 'none' } : { background: 色 } })),
                    进度文 ? h('div', { className: 'cc-prog-txt' }, 进度文) : null)
                : null,
              (job.产物 && job.产物.length) ? renderMiniThumbs(job.产物, 4) : null,
              展开
                ? h('div', { className: 'cc-job-detail' },
                    h('div', { className: 'cc-kv' },
                      h('dt', null, 'prompt_id'), h('dd', null, str(job.prompt_id)),
                      job.排队位置 != null ? h('dt', null, T.queue) : null,
                      job.排队位置 != null ? h('dd', null, '第 ' + job.排队位置 + ' 位') : null,
                      job.起来 ? h('dt', null, '提交于') : null,
                      job.起来 ? h('dd', null, new Date(job.起来).toLocaleString()) : null,
                      job.耗时毫秒 != null ? h('dt', null, T.elapsed) : null,
                      job.耗时毫秒 != null ? h('dd', null, fmtElapsed(job.耗时毫秒)) : null),
                    回显
                      ? h('div', null,
                          h('div', { className: 'cc-lb' }, T.echo),
                          h('div', { className: 'cc-kv' },
                            h('dt', null, '工作流'), h('dd', null, str(回显.工作流)),
                            h('dt', null, '图片'), h('dd', null, (回显.images || []).join(' , ') || '—'),
                            h('dt', null, '视频'), h('dd', null, (回显.videos || []).join(' , ') || '—'),
                            h('dt', null, '音频'), h('dd', null, (回显.audios || []).join(' , ') || '—'),
                            h('dt', null, T.size),
                            h('dd', null, [回显.seconds, 回显.aspect, 回显.megapixels].filter(function (x) { return x != null && x !== '' }).join(' / ') || '—'),
                            回显.seed != null ? h('dt', null, T.seed) : null,
                            回显.seed != null ? h('dd', null, str(回显.seed)) : null))
                      : null,
                    计划文 ? h('div', null,
                        h('div', { className: 'cc-lb' }, T.plan),
                        h('pre', { className: 'cc-pre' }, 计划文)) : null,
                    进度文 ? h('div', { className: 'cc-prog-txt' }, 进度文) : null,
                    renderThumbs(job.产物),
                    job.报错 ? h('pre', { className: 'cc-pre', style: { color: '#f85149' } }, str(job.报错)) : null)
                : null)
          }

          var 进行中任务 = sJobs.filter(function (j) { var k = normStatus(j.状态); return k === 'running' || k === 'queued' })
          var 已结束任务 = sJobs.filter(function (j) { var k = normStatus(j.状态); return !(k === 'running' || k === 'queued') })

          var limitOf = function (kind) {
            var slot = selA && selA.素材 && selA.素材[kind]
            return slot ? slot.上限 : null
          }

          var assetUrl = function (kind, name) {
            return '/comfy-console/asset?kind=' + kind + '&file=' + encodeURIComponent(name)
          }

          // 产物墙：后端只回最近 N 个（按修改时间倒序）；前端再按 sHistLimit 分页铺孤儿文件
          var outFiles = sAssets.output || []
          var outTotal = sAssets.outputTotal || 0
          var outTruncated = !!sAssets.outputTruncated
          var outVisible = outFiles.slice(0, sHistLimit)
          var outMore = outFiles.length - outVisible.length
          // 产物按任务归属分组；目录里对不上任务的孤儿文件兜底平铺
          // 归属分组用全量任务（sAllJobs，含被隐藏的已结束任务），保证清任务记录不影响产物墙归类
          var 归属文件 = {}
          sAllJobs.forEach(function (j) { (j.产物 || []).forEach(function (p) { 归属文件[p.文件] = true }) })
          var 分组任务 = sAllJobs.filter(function (j) { return (j.产物 || []).length })
          var 孤儿文件 = outFiles.filter(function (f) { return !归属文件[f] })
          var 孤儿可见 = 孤儿文件.slice(0, sHistLimit)
          var 孤儿更多 = 孤儿文件.length - 孤儿可见.length

          // 选中流摘要
          var summary = null
          if (selA && selA.ok) {
            var pt = selA.提示词
              ? (selA.提示词.优化器 ? T.optimizer : T.external) + (selA.提示词.类 ? ' · ' + selA.提示词.类 : '')
              : T.noPrompt
            var du = selA.秒数
              ? T.direct + '（当前 ' + str(selA.秒数.当前) + '）'
              : T.noDuration
            var sz = selA.尺寸 ? (str(selA.尺寸.比例) + ' / ' + str(selA.尺寸.像素) + 'MP') : '—'
            summary = h('div', { className: 'cc-summary' },
              h(SummaryRow, { k: T.type, v: str(selA.类型) }),
              h(SummaryRow, { k: T.promptNode, v: pt }),
              h(SummaryRow, { k: T.duration, v: du }),
              h(SummaryRow, { k: T.size, v: sz }),
              h(SummaryRow, { k: T.product, v: (selA.产物 || []).join(', ') }),
              (selA.警告 && selA.警告.length)
                ? h(SummaryRow, { k: T.warn, v: h('span', { className: 'cc-wf-warn' }, selA.警告.join('；')) })
                : null)
          }

          return h('div', { className: 'cc-root', ref: rootRef },
            // 顶栏
            h('div', { className: 'cc-top' },
              h('div', null,
                h('div', { className: 'cc-title' }, T.title),
                h('div', { className: 'cc-sub' }, T.subtitle),
                h('div', { className: 'cc-host' },
                  str(sConfig && sConfig.baseUrl),
                  sDir && (!sDir.inputSet || !sDir.outputSet) ? ' · 目录待配置' : null)),
              h('span', { className: 'cc-spacer' }),
              h('span', { className: 'cc-badge' },
                h('i', { className: 'cc-dot', style: { background: online ? '#3fb950' : '#f85149' } }),
                online ? T.online : T.offline),
              h(Btn, { onClick: openSettings, title: T.hintSettings }, [T.settings, HintIcon()]),
              h(Btn, { onClick: refresh, title: T.hintRefresh }, [T.refresh, HintIcon()]),
              h(Btn, { onClick: refreshSchema, disabled: sSchemaLoading, title: T.hintSchema }, sSchemaLoading ? T.schemaReloading : [T.refreshSchema, HintIcon()]),
              h(Btn, { pri: true, disabled: sBusy || !sSelected, onClick: run, title: T.hintRun }, sBusy ? T.running : T.run)),

            sPreview
              ? h('div', { className: 'cc-preview-mask', onClick: function () { setPreview(null) } },
                  h('button', { type: 'button', className: 'cc-preview-close', onClick: function (e) { e.stopPropagation(); setPreview(null) } }, T.previewClose),
                  h('div', { className: 'cc-preview-box', onClick: function (e) { e.stopPropagation() } },
                    sPreview.kind === 'vid'
                      ? h('video', { src: sPreview.url, controls: true, autoPlay: true })
                      : h('img', { src: sPreview.url, alt: sPreview.name }),
                    h('div', { className: 'cc-preview-cap' }, sPreview.name)))
              : null,

            sShowSettings
              ? h('div', { className: 'cc-preview-mask', onClick: function () { setShowSettings(false) } },
                  h('div', { className: 'cc-setup-box', onClick: function (e) { e.stopPropagation() } },
                    h('div', { className: 'cc-setup-title' }, T.cfgTitle),
                    h('div', { className: 'cc-setup-hint' }, T.cfgHint),
                    h('div', { className: 'cc-setup-rows' },
                      h('div', { className: 'cc-setup-row' },
                        h('label', { className: 'cc-lb' }, T.cfgBase),
                        h('input', { className: 'cc-in', value: sCfgForm.baseUrl, placeholder: T.cfgBasePh,
                          onChange: function (e) { setCfgForm(Object.assign({}, sCfgForm, { baseUrl: e.target.value })) } })),
                      h('div', { className: 'cc-setup-row' },
                        h('label', { className: 'cc-lb' }, T.cfgInput, dirTag('input')),
                        h('input', { className: 'cc-in', value: sCfgForm.inputDir, placeholder: T.cfgDirPh,
                          onChange: function (e) { setCfgForm(Object.assign({}, sCfgForm, { inputDir: e.target.value })) } })),
                      h('div', { className: 'cc-setup-row' },
                        h('label', { className: 'cc-lb' }, T.cfgOutput, dirTag('output')),
                        h('input', { className: 'cc-in', value: sCfgForm.outputDir, placeholder: T.cfgDirPh,
                          onChange: function (e) { setCfgForm(Object.assign({}, sCfgForm, { outputDir: e.target.value })) } })),
                      h('div', { className: 'cc-setup-row' },
                        h('label', { className: 'cc-lb' },
                          h('input', {
                            type: 'checkbox',
                            checked: !!sCfgForm.notifyOnDone,
                            onChange: function (e) { setCfgForm(Object.assign({}, sCfgForm, { notifyOnDone: e.target.checked })) }
                          }),
                          ' ' + T.cfgNotify),
                        h('div', { className: 'cc-setup-hint' }, T.cfgNotifyHint))),
                    h('div', { className: 'cc-setup-actions' },
                      h('span', { className: 'cc-setup-msg' }, sCfgMsg),
                      h(Btn, { onClick: function () { setShowSettings(false) } }, T.cfgCancel),
                      h(Btn, { pri: true, disabled: sCfgSaving, onClick: saveSettings }, sCfgSaving ? '…' : T.cfgSave))))
              : null,

            h('div', { className: 'cc-body' },
              // 左栏：工作流 + 摘要
              h('div', { className: 'cc-side' },
                h(Card, { title: T.workflows, extra: h('span', { className: 'cc-wf-actions' },
                  h(Btn, { sm: true, onClick: function () { wfInput.current && wfInput.current.click() } }, T.import),
                  sDelConfirm
                    ? h('span', { className: 'cc-del-confirm' },
                        h(Btn, { sm: true, pri: true, onClick: confirmDelete }, T.delConfirm),
                        h(Btn, { sm: true, onClick: 复位删除 }, T.cancel))
                    : h(Btn, { sm: true, disabled: !sSelected, onClick: requestDelete }, T.delete))
                },
                  h('input', { ref: wfInput, type: 'file', accept: '.json,application/json', style: { display: 'none' },
                    onChange: function (e) { var f = e.target.files && e.target.files[0]; importWorkflow(f); e.target.value = '' } }),
                  (sWorkflows || []).length
                    ? (sWorkflows || []).map(function (w) {
                        var warn = w && w.error
                        return h('div', {
                          key: w.id,
                          className: 'cc-wf' + (w.id === sSelected ? ' on' : ''),
                          onClick: function () { selectWorkflow(w.id) },
                        },
                          h('span', { className: 'cc-wf-main' },
                            h('span', { className: 'cc-wf-n' }, str(w.name || w.id) + (warn ? ' ⚠' : '')),
                            h('span', { className: 'cc-wf-m' },
                              (w.节点数 != null ? w.节点数 + ' ' + T.nodes : str(w.id))
                              + (warn ? ' · ' + str(w.error).slice(0, 18) : ''))))
                      })
                    : sWfLoading
                      ? h('div', { className: 'cc-loading' }, T.loadingWf)
                      : h('div', { className: 'cc-ph' }, T.noWorkflow)),
                sFatal ? h('div', { className: 'cc-err' }, str(sFatal)) : null,
                sel ? h(Card, { title: T.summary }, summary || h('div', { className: 'cc-ph' }, '分析中…')) : null,
              ),

              // 主区：步骤流
              h('div', { className: 'cc-main' },
                // ① 素材
                h(Card, { title: T.slots, step: '1' },
                  h('div', { className: 'cc-grid3' },
                    h(Slot, {
                      kind: 'images', urlFor: assetUrl,
                      label: T.images, limit: limitOf('images'), accept: 'image/*', inputRef: imgInput,
                      items: sImages, pickerOpen: sPickFor === 'images', pickerFiles: filesFor('images'),
                      onPick: function () { setPickFor(sPickFor === 'images' ? null : 'images') },
                      onChoose: function (f) { addExisting('images', f) },
                      onFiles: function (fs) { uploadFiles('images', fs) },
                      onRemove: function (i) { setImages(function (cur) { return cur.filter(function (_, k) { return k !== i }) }) },
                    }),
                    h(Slot, {
                      kind: 'videos', urlFor: assetUrl,
                      label: T.videos, limit: limitOf('videos'), accept: 'video/*', inputRef: vidInput,
                      items: sVideos, pickerOpen: sPickFor === 'videos', pickerFiles: filesFor('videos'),
                      onPick: function () { setPickFor(sPickFor === 'videos' ? null : 'videos') },
                      onChoose: function (f) { addExisting('videos', f) },
                      onFiles: function (fs) { uploadFiles('videos', fs) },
                      onRemove: function (i) { setVideos(function (cur) { return cur.filter(function (_, k) { return k !== i }) }) },
                    }),
                    h(Slot, {
                      kind: 'audios', urlFor: assetUrl,
                      label: T.audios, limit: limitOf('audios'), accept: 'audio/*', inputRef: audInput,
                      items: sAudios, pickerOpen: sPickFor === 'audios', pickerFiles: filesFor('audios'),
                      onPick: function () { setPickFor(sPickFor === 'audios' ? null : 'audios') },
                      onChoose: function (f) { addExisting('audios', f) },
                      onFiles: function (fs) { uploadFiles('audios', fs) },
                      onRemove: function (i) { setAudios(function (cur) { return cur.filter(function (_, k) { return k !== i }) }) },
                    }))),

                // ② 提示词 + 参数
                h(Card, { title: T.prompt, step: '2',
                  extra: h(Btn, { sm: true, disabled: sDefaultBusy, title: T.hintSaveDefault, onClick: saveDefault }, sDefaultMsg || T.saveDefault) },
                  h('textarea', {
                    className: 'cc-ta', value: sPrompt, placeholder: T.promptPh,
                    onChange: function (e) { setPrompt(e.target.value) },
                  }),
                  h('div', { className: 'cc-grid5', style: { marginTop: '10px' } },
                    出视频
                      ? h(Field, { label: T.seconds },
                          h('input', { className: 'cc-in', type: 'number',
                            min: 4, max: 15,
                            placeholder: '秒',
                            value: sSeconds, onChange: function (e) { setSeconds(e.target.value) } }))
                      : null,
                    h(Field, { label: T.aspect },
                      h('select', { className: 'cc-sel', value: sAspect, onChange: function (e) { setAspect(e.target.value) } },
                        (sAspectOpts.length ? sAspectOpts : ASPECTS).map(function (a) { return h('option', { key: a, value: a }, a) }))),
                    h(Field, { label: T.megapixels },
                      h('input', { className: 'cc-in', type: 'number', step: '0.1', min: 0.2, max: 4, value: sMega,
                        onChange: function (e) { setMega(e.target.value) } })),
                    h(Field, { label: T.steps },
                      步项.length
                        ? h('div', { className: 'cc-steps' }, 步项.map(function (x) {
                            return h('label', { className: 'cc-step-item', key: x.节点 },
                              h('span', { className: 'cc-step-tag' }, str(x.阶段)),
                              h('input', { className: 'cc-in', type: 'number', min: 1,
                                value: sStepMap[x.节点] != null ? sStepMap[x.节点] : '', placeholder: '默认',
                                onChange: function (e) {
                                  setStepMap(function (cur) {
                                    var o = {}; for (var k in cur) o[k] = cur[k]; o[x.节点] = e.target.value; return o
                                  })
                                } }))
                          }))
                        : h('input', { className: 'cc-in', type: 'number', min: 1, placeholder: '默认' })),
                    h(Field, { label: T.seed },
                      h('input', { className: 'cc-in', type: 'number', value: sSeed, placeholder: '随机',
                        onChange: function (e) { setSeed(e.target.value) } }))),
                  h('div', { className: 'cc-loras' },
                    h('div', { className: 'cc-loras-h', onClick: function () { setLoraOpen(!sLoraOpen) } },
                      h('span', { className: 'cc-lora-arrow' }, sLoraOpen ? '▾' : '▸'),
                      h('span', null, T.lora),
                      h('span', { className: 'cc-spacer' }),
                      h('span', null, sLoraAll.length
                        ? (sLoras.length ? '已选 ' + sLoras.length + ' · 共 ' + sLoraAll.length : '共 ' + sLoraAll.length + ' 个')
                        : '')),
                    sLoraOpen
                      ? (sLoraAll.length
                          ? loraGroups.map(function (g) {
                              return h('div', { className: 'cc-lora-group', key: g },
                                h('div', { className: 'cc-lora-g' }, g),
                                h('div', { className: 'cc-lora-row' }, loraGroup[g].map(renderLora)))
                            })
                          : sLoraLoading
                              ? h('div', { className: 'cc-loading' }, T.loadingLora)
                              : h('div', { className: 'cc-ph' }, T.loraEmpty))
                      : null),
                  h('div', { className: 'cc-sub', style: { marginTop: 10 } }, T.noteSaveDefault)),

                // ③ 主区分页：任务清单 / 历史产物 / 节点结构
                h('div', { className: 'cc-tabs' },
                  h('button', { type: 'button', className: 'cc-tab' + (sMainTab === 'jobs' ? ' on' : ''),
                    onClick: function () { setMainTab('jobs') } },
                    T.tabJobs, h('span', { className: 'cc-tab-n' }, 进行中任务.length)),
                  h('button', { type: 'button', className: 'cc-tab' + (sMainTab === 'history' ? ' on' : ''),
                    onClick: function () { setMainTab('history') } },
                    T.tabHistory, h('span', { className: 'cc-tab-n' }, outTruncated ? outTotal : outFiles.length)),
                  h('button', { type: 'button', className: 'cc-tab' + (sMainTab === 'struct' ? ' on' : ''),
                    onClick: function () { setMainTab('struct') } },
                    T.tabStruct)),

                sMainTab === 'jobs'
                  ? h('div', { className: 'cc-panel' },
                      (进行中任务.length || 已结束任务.length)
                        ? h('div', { className: 'cc-jobs' },
                            进行中任务.map(renderJobCard),
                            已结束任务.length
                              ? h(CardCollapse, {
                                  title: '已结束任务', open: sDoneOpen,
                                  onToggle: function () { setDoneOpen(!sDoneOpen) },
                                  extra: h('span', { className: 'cc-toolbar', style: { gap: 8 } },
                                    h('span', { className: 'cc-ph' }, '共 ' + 已结束任务.length + ' 个'),
                                    已结束任务.length ? h('button', { type: 'button', className: 'cc-btn sm', disabled: sClearing,
                                      style: sConfirmClear ? { color: '#f85149', borderColor: '#f85149' } : { color: '#9aa0aa', borderColor: 'rgba(127,127,127,.3)' },
                                      title: T.clearHint,
                                      onClick: function (e) { e.stopPropagation(); clearDone() } },
                                      sConfirmClear ? T.clearDoneConfirm : T.clearDone) : null),
                                },
                                  h('div', { className: 'cc-jobs' }, 已结束任务.map(renderJobCard)))
                              : null)
                        : sJobsLoading
                          ? h('div', { className: 'cc-loading' }, T.loadingJobs)
                          : h('div', { className: 'cc-ph' }, T.idle))

                  : sMainTab === 'history'
                  ? h('div', { className: 'cc-panel' },
                      (分组任务.length || 孤儿文件.length)
                        ? h('div', null,
                      分组任务.map(function (j, gi) {
                              var g名 = j.工作流名 || j.工作流 || '未命名流'
                              var g类型 = j.类型 === 'video' ? '视频' : (j.类型 === 'image' ? '图片' : '')
                              return h('div', { className: 'cc-prod-group', key: gi },
                                h('div', { className: 'cc-prod-head' },
                                  h('span', { className: 'cc-prod-title' }, str(g名)),
                                  h('span', { className: 'cc-prod-meta' }, '#' + str(j.编号 || j.prompt_id).slice(0, 8)),
                                  g类型 ? h('span', { className: 'cc-prod-meta' }, g类型) : null,
                                  j.起来 ? h('span', { className: 'cc-prod-meta' }, new Date(j.起来).toLocaleString()) : null,
                                  j.耗时毫秒 != null ? h('span', { className: 'cc-prod-meta' }, T.elapsed + ' ' + fmtElapsed(j.耗时毫秒)) : null),
                                j.摘要 ? h('div', { className: 'cc-prod-summary' }, str(j.摘要)) : null,
                                renderThumbs(j.产物))
                            }),
                            孤儿文件.length
                              ? h('div', null,
                                  分组任务.length ? h('div', { className: 'cc-lb' }, '未归属文件') : null,
                                  h('div', { className: 'cc-thumbs' },
                                    孤儿可见.map(function (f, i) {
                                      return thumbOne({ 文件: f, url: assetUrl('output', f) }, i, false)
                                    })),
                                  孤儿更多 > 0
                                    ? h('div', { style: { marginTop: 10, textAlign: 'center' } },
                                        h(Btn, { sm: true, onClick: function () { setHistLimit(function (c) { return c + 24 }) } },
                                          '加载更多（还剩 ' + 孤儿更多 + '）'))
                                    : null)
                              : null,
                            outTruncated
                              ? h('div', { className: 'cc-ph', style: { marginTop: 10, textAlign: 'center' } },
                                  '仅显示最近 ' + outFiles.length + ' 个结果（目录共 ' + outTotal + ' 个，更早的未加载）')
                              : null)
                        : sAssetsLoading
                          ? h('div', { className: 'cc-loading' }, T.loadingAssets)
                          : h('div', { className: 'cc-ph' }, T.pickerEmpty))

                  : h('div', { className: 'cc-panel' },
                      h('div', { className: 'cc-toolbar' },
                        h(Btn, { sm: true, disabled: sStructLoading || !sSelected, onClick: loadStructure, title: T.hintStruct },
                          sStructLoading ? '…' : T.loadStructure)),
                      sStructure
                        ? (sStructure.ok
                          ? (function () {
                              var a = sStructure.分析
                              var rows = buildNodeRows(a)
                              var warns = (a && a.警告) || []
                              var miss = (a && a.缺失节点) || []
                              var total = sStructure.节点数 || (sStructure.节点 || []).length || 0
                              var fallback = (sStructure.节点 || []).length
                                ? h('pre', { className: 'cc-pre' },
                                    (sStructure.节点 || []).map(function (n) {
                                      return str(n.id) + '  ' + str(n.类) + (n.标题 ? '  《' + str(n.标题) + '》' : '')
                                    }).join('\n'))
                                : h('div', { className: 'cc-ph' }, '分析结果为空')
                              return h('div', null,
                                h('div', { className: 'cc-sub', style: { marginBottom: 10 } },
                                  str(sStructure.name || sStructure.id) + ' · ' + total + ' ' + T.nodes),
                                rows.length
                                  ? h('div', { className: 'cc-nodes' },
                                      rows.map(function (r, i) {
                                        return h('div', { className: 'cc-node-row', key: i },
                                          h('span', { className: 'cc-node-k' }, r.k),
                                          h('span', { className: 'cc-node-v' }, r.v || '—',
                                            r.cls ? h('span', { className: 'cc-node-cls' }, str(r.cls)) : null))
                                      }))
                                  : fallback,
                                warns.length
                                  ? h('div', { className: 'cc-wf-warn', style: { marginTop: 8 } }, warns.join('；'))
                                  : null,
                                miss.length
                                  ? [h('div', { className: 'cc-wf-warn', style: { marginTop: 6 } },
                                      '缺失节点（本机未加载，对应插件可能未安装）：' + miss.map(function (x) { return str(x.类) }).join('、')),
                                    h('div', { className: 'cc-ph', style: { marginTop: 4 } }, T.missHint)]
                                  : null,
                                h('div', { className: 'cc-node-more' }, '共 ' + total + ' 个节点，其余为中间处理节点'))
                            })()
                          : h('div', { className: 'cc-err' }, '结构读取失败：\n' + str(sStructure.说 || sStructure.error || '未知')))
                        : h('div', { className: 'cc-ph' }, '点右上「' + T.loadStructure + '」看这个工作流的节点表')))))
        }

        // 渲染兜底：任何异常都显示在页面上，不再一片空白
        function SafeConsole() {
          try {
            return h(Console)
          } catch (e) {
            var msg = str((e && e.stack) || e)
            try { console.error('[comfy-console] Console 渲染异常', e) } catch (x) {}
            return h('div', { className: 'cc-err' }, 'ComfyUI 控制台渲染出错：\n\n' + msg)
          }
        }

        function PanelIcon(props) {
          var size = (props && props.size) || 20
          return h('svg', {
            width: size, height: size, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
            strokeLinecap: 'round', strokeLinejoin: 'round',
            'aria-hidden': true, style: { display: 'block' },
          },
            h('rect', { x: 2.5, y: 3.5, width: 19, height: 17, rx: 2.5 }),
            h('path', { d: 'M2.5 8.5h19' }),
            h('circle', { cx: 6.5, cy: 6, r: 0.55, fill: 'currentColor', stroke: 'none' }),
            h('circle', { cx: 9, cy: 6, r: 0.55, fill: 'currentColor', stroke: 'none' }),
            h('path', { d: 'M7 13h4M7 16.5h8' })
          )
        }

        exports.apply = function (ctx) {
          injectCSS()
          var slots = ctx.get ? ctx.get('slots') : ctx.slots
          if (!slots) return
          try {
            if (ctx.locale && ctx.locale.register) {
              ctx.effect(function () { return ctx.locale.register(NS, { zh: T, en: T }) }, 'comfy-console: locale')
            }
          } catch (e) {}
          slots.inject('sidebar.panellist', function () {
            var disposers = []
            try {
              disposers.push(slots.register({
                name: 'sidebar.panellist', id: KIND, order: 30,
                label: function () { return T.title },
              }, PanelIcon))
            } catch (e) { try { console.error('[comfy-console] 侧栏图标注册失败', e) } catch (x) {} }
            try {
              disposers.push(slots.register({ name: 'main', key: KIND }, SafeConsole))
            } catch (e) { try { console.error('[comfy-console] 主面板注册失败', e) } catch (x) {} }
            return function () {
              for (var i = 0; i < disposers.length; i++) {
                try { disposers[i] && disposers[i]() } catch (e) {}
              }
            }
          })
        }
        exports.inject = ['slots', 'locale']
        return module.exports
      },
    })
  }
})()
