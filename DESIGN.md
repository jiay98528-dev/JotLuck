---
name: JotLuck
description: 'The Winged Press: a truthful paper-first design system for JotLuck and its public website'
colors:
  binding-teal: 'oklch(0.4898 0.0412 193.7)'
  proof-paper: 'oklch(0.9723 0.0175 81.3)'
  carbon-ink: 'oklch(0.3346 0.0037 308.3)'
  registration-orange: 'oklch(0.6307 0.1806 41.1)'
  bookmark-yellow: 'oklch(0.8050 0.1570 79.7)'
  index-olive: 'oklch(0.6387 0.0915 108)'
typography:
  display-latin:
    fontFamily: 'Bodoni Moda, Georgia, serif'
    fontSize: 'clamp(6rem, 12.5vw, 13rem)'
    fontWeight: 400
    lineHeight: 0.82
    letterSpacing: '-0.05em'
  display-zh-hans:
    fontFamily: 'ZCOOL XiaoWei, Songti SC, serif'
    fontSize: 'clamp(5.75rem, 12vw, 12rem)'
    fontWeight: 400
    lineHeight: 0.88
    letterSpacing: '-0.02em'
  display-zh-hant:
    fontFamily: 'Iansui, PMingLiU, serif'
    fontSize: 'clamp(5.75rem, 12vw, 12rem)'
    fontWeight: 400
    lineHeight: 0.88
    letterSpacing: '-0.02em'
  display-ja:
    fontFamily: 'Kaisei Decol, Yu Mincho, serif'
    fontSize: 'clamp(5.75rem, 12vw, 12rem)'
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: '-0.02em'
  display-ko:
    fontFamily: 'Gowun Batang, Batang, serif'
    fontSize: 'clamp(5.75rem, 12vw, 12rem)'
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: '-0.02em'
  hero-emphasis:
    fontFamily: 'var(--font-body), system-ui, sans-serif'
    fontSize: 'clamp(4.75rem, 10vw, 10.5rem)'
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: '-0.055em'
  body:
    fontFamily: 'var(--font-body), system-ui, sans-serif'
    fontSize: 'clamp(1rem, 0.95rem + 0.2vw, 1.125rem)'
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: 'normal'
  title:
    fontFamily: 'var(--font-body), system-ui, sans-serif'
    fontSize: 'clamp(1.5rem, 2.5vw, 2.5rem)'
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: '-0.02em'
  label:
    fontFamily: 'var(--font-label), system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: '0.06em'
  mono:
    fontFamily: 'var(--font-mono), ui-monospace, monospace'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: '0.03em'
rounded:
  stage: '0'
  legacy-control: '6px'
  compact: '8px 12px 7px 10px'
  control: '12px 16px 14px 10px'
  sheet: '18px 24px 16px 22px'
  proof: '8px 14px 10px 12px'
  full: '9999px'
spacing:
  space-0: '0'
  space-2: '2px'
  space-4: '4px'
  space-8: '8px'
  space-12: '12px'
  space-16: '16px'
  space-24: '24px'
  space-32: '32px'
  space-48: '48px'
  space-64: '64px'
  space-80: '80px'
  space-96: '96px'
  space-120: '120px'
components:
  button-primary:
    backgroundColor: '{colors.binding-teal}'
    textColor: '{colors.proof-paper}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '0 20px'
    height: '44px'
  button-secondary:
    backgroundColor: '{colors.proof-paper}'
    textColor: '{colors.carbon-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '0 20px'
    height: '44px'
  site-navigation:
    backgroundColor: '{colors.proof-paper}'
    textColor: '{colors.carbon-ink}'
    typography: '{typography.label}'
    padding: '12px 16px'
    width: '100%'
  language-selector:
    backgroundColor: '{colors.proof-paper}'
    textColor: '{colors.carbon-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '0 12px'
    height: '44px'
  technical-rail:
    backgroundColor: '{colors.proof-paper}'
    textColor: '{colors.carbon-ink}'
    typography: '{typography.mono}'
    rounded: '{rounded.compact}'
    padding: '8px 12px'
  paper-sheet:
    backgroundColor: '{colors.proof-paper}'
    textColor: '{colors.carbon-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.sheet}'
    padding: '32px'
  release-status:
    backgroundColor: '{colors.bookmark-yellow}'
    textColor: '{colors.carbon-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '12px 16px'
  annotation-number:
    backgroundColor: '{colors.proof-paper}'
    textColor: '{colors.carbon-ink}'
    typography: '{typography.mono}'
    rounded: '{rounded.full}'
    size: '32px'
  editor-proof:
    backgroundColor: '{colors.proof-paper}'
    textColor: '{colors.carbon-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.proof}'
    padding: '24px'
  hero-press-stage:
    backgroundColor: '{colors.proof-paper}'
    textColor: '{colors.carbon-ink}'
    rounded: '{rounded.stage}'
    padding: 'clamp(24px, 4vw, 72px)'
    width: '100%'
---

# Design System: JotLuck

## Overview

**Creative North Star: "羽翼印刷所 / The Winged Press"**

JotLuck 的公共官网像一张刚从小型印刷机上揭下的校样：写作者坐在有日光的安静书桌前，深青色装订台承住一叠暖纸，纸上的每个标记都对应真实产品能力。它不是复古装饰，也不是杂志版式套装。装订、套准、批注和纸页层级共同说明一件事：纯文本可以轻盈，也可以精确。

根级设计契约同时保护两个表面。公共官网属于 brand register，允许巨型活字、整块颜色和滚动叙事；JotLuck 应用属于 product register，必须无感、真诚、精确。官网可以吸引注意，嵌入的编辑器证明必须退后并服务写作。任何官网规则都不得覆盖 Theme API、应用主题 scope 或现有工作区行为。

画面拒绝 SaaS 模板感、企业软件感、终端极客感和无功能依据的装饰。主要构图使用非对称装订平面、真实 DOM 编辑器、编号批注和清晰的技术说明层，不依赖卡片阵列、伪截图或素材图填充。首页 Hero 是一张接近满视口的印刷舞台，不得被统一圆角外壳、正交 50/50 分栏或设计规范标签收编。

**Key Characteristics:**

- 深青装订平面与暖纸正文形成明确的物理层级。
- 巨型双字体本地化主张与倾斜叠纸编辑器在首屏同时达到视觉峰值。
- 主句通过展示体与本地 IBM Plex Sans 粗体建立重点，强调段以校样纸色活字压在紧凑橘红印面上；编辑器复用同一字体角色。
- 结构承担装饰功能，套准标记、纸边和编号都具有叙事或交互用途。
- 产品证据可操作、可验证，并通过真实清洗后的 Markdown 管线渲染。
- 桌面端采用编排式滚动，移动端和减弱动效模式采用等价的线性纸页序列。
- 所有商业状态、平台状态和语言能力保持可核验。

**The Surface Register Rule.** 官网负责建立记忆，应用负责让工具消失。品牌表现不得侵入写作、保存、搜索或阅读流程。

**The Working Proof Rule.** 任何产品画面都必须是真实语义 DOM 和真实交互结果，禁止用伪造截图代替能力证明。

**The Hero Impact Rule.** 首页第一屏必须同时出现巨型本地化主张、唯一主动作和占据主要面积的真实编辑器证明。任一对象退化为次级卡片时，Hero 视为失败。

**The Emphasis Is Typographic and Printed Rule.** Hero 的重点首先来自同一语义 `h1` 内的字体、字重、字面密度和断行差异；强调段允许以校样纸色的真实文本压在橘红印面上。2026-08-03 最终裁决锁定为用户提供的拖尾印面版本：主墨块承托强调段，单次右向干刷拖尾负责连接标题与编辑器装订脊，但不得覆盖编辑器正文。每种语言独立确认强调片段。

**The Controlled Imperfection Rule.** 内容内部继续服从 4px 栅格；纸页外轮廓使用命名的不对称圆角、确定性偏移和轻微旋转建立有机感，禁止运行时随机抖动。

**The Linear Fallback Rule.** 任何滚动编排都必须在移动端、键盘路径和减弱动效模式下变成完整、顺序不变的静态叙事。

## Colors

颜色策略名为“装订四色”。Hero 以暖纸覆盖完整舞台，深青通过编辑器装订脊、承托背板、主动作和被纸页遮挡的结构面形成 Committed 色彩；橙以一块紧凑 Hero 印面、克制墨点、主动作的窄底边和功能性定位串联标题与产品证明，黄与橄榄承担书签和状态角色。

### Primary

- **装订深青 Binding Teal** (`oklch(0.4898 0.0412 193.7)`): 编辑器装订脊、承托背板、主要结构和通用主按钮。它必须形成完整且负重的结构面，但不得再次变成与暖纸各占一半的平直色块。

### Secondary

- **套准橙 Registration Orange** (`oklch(0.6307 0.1806 41.1)`): 视觉呈橘红墨色。Hero 允许一块主印面承托校样纸色强调字，并保留最终批准样机中的单次右向干刷拖尾、克制墨点和主动作下方的窄套印底边；它也用于焦点环、编号套准环和当前项定位。它不承担标题文字、CTA 主填充或段落正文，拖尾不得遮挡编辑器文字。
- **书签黄 Bookmark Yellow** (`oklch(0.8050 0.1570 79.7)`): 发布状态、短暂提示和书签标记。与墨色组合，不与浅色文字组合。

### Tertiary

- **索引橄榄 Index Olive** (`oklch(0.6387 0.0915 108)`): 次级状态、索引标记和辅助关系。不得与书签黄争夺同一层级。

### Neutral

- **校样纸 Proof Paper** (`oklch(0.9723 0.0175 81.3)`): 全站阅读底色、纸页、按钮反白文字和编辑器证明面。禁止替换为纯白。
- **炭墨 Carbon Ink** (`oklch(0.3346 0.0037 308.3)`): 正文、导航、边界和深色结构。需要弱化时只降低不透明度，禁止引入一套无品牌灰阶。

**The Binding Plane Rule.** 深青必须一次承担一个完整结构面。若它只剩若干圆角标签，或膨胀成替代巨型主句与编辑器证明的半屏矩形，品牌骨架都已经丢失。

**The Registration Not Decoration Rule.** 橙、黄、橄榄优先标记状态或关系。Hero 允许一个 `aria-hidden` 的橘红印面承托强调段、少量卫星墨点、一条连接至深青装订脊的右向干刷拖尾，以及主动作下方不超过 12px 的窄套印底边；不得生成第二块大型墨迹或遮挡编辑器内容。除此之外，无法说明功能的彩色标记必须删除。

**The Contrast Owns the Copy Rule.** 正文只使用炭墨与校样纸的高对比组合。低注意力不等于低可读性，所有文本和控件边界必须满足 WCAG 2.1 AA。

## Typography

**Display Font:** Bodoni Moda、ZCOOL XiaoWei、Iansui、Kaisei Decol、Gowun Batang，按当前语言只加载一套展示字体。

**Body Font:** IBM Plex Sans 对应语言版本，使用本地 system-ui 作为降级。

**Label/Mono Font:** Geist Mono，仅用于 ASCII 文件格式、代码、编号和测量信息。

**Character:** 字体方向名为“活字诗刊”。展示字像印刷标题，正文像安静的工作说明，技术行像校样边缘的测量记录。Hero 主句内部采用双字体组合：当前语言展示字体以炭墨承载语气段，对应语言的 IBM Plex Sans 700 以校样纸色承载橘红印面上的强调段；两段都是可选择、可翻译的真实文本。IBM Plex Sans 是本项目已确认的多语言正文选择，不作为泛化技术感装饰；Geist Mono 也不得替代正文。

### Locale Families

- **English and Français:** Bodoni Moda + IBM Plex Sans。
- **简体中文:** ZCOOL XiaoWei + IBM Plex Sans SC。
- **繁體中文:** Iansui + IBM Plex Sans TC。
- **日本語:** Kaisei Decol + IBM Plex Sans JP。
- **한국어:** Gowun Batang + IBM Plex Sans KR。
- 字体全部自托管为按语言裁剪的 WOFF2，锁定来源版本并保留 OFL。单一语言构建不得请求其他语言字体或第三方字体 CDN。
- 每个语言构建分别绑定 `--font-display`、`--font-body`、`--font-label` 与 `--font-mono`，组件不得硬编码 `IBM Plex Sans SC` 或同时声明六套语言字体。全站使用 `font-synthesis: none`，禁止浏览器伪造缺失字重。
- 网站字体清单必须记录官方来源、精确 release 或 commit、原文件与 WOFF2 的 SHA-256、`unicode-range`、子集工具版本与命令、OFL 路径及允许使用该文件的 locale。任一字段、真实字重或许可证缺失时构建失败。
- 首页预载当前语言首屏实际使用的 Display 400、Hero Emphasis / Body 700，以及真实编辑器需要的 Body 400；所有 `@font-face` 使用 `font-display: swap`，fallback face 必须提供 `size-adjust`、`ascent-override`、`descent-override` 与 `line-gap-override`。字体交换不得改变已批准的 Hero 行数，最终 CLS 不得超过 0.1。

### Hierarchy

- **Display Latin** (400, `clamp(6rem, 12.5vw, 13rem)`, 0.82): 英法 Hero 的单一主张，不用于功能说明。
- **Display CJK** (400, `clamp(5.75rem, 12vw, 12rem)`, 0.88 到 0.9): 中日韩 Hero，按语言校正换行，不强行复用英文断句。
- **Hero Emphasis** (700, `clamp(4.75rem, 10vw, 10.5rem)`, 0.92): 使用当前语言 IBM Plex Sans 的真实粗体，只承担每种语言经确认的强调片段。橘红印面准备完成时使用校样纸色；资产失败、打印或强制颜色模式下回退为炭墨，不得留下纸色文字悬在浅色背景上。
- **Headline** (400, `clamp(2.25rem, 5vw, 5rem)`, 1): 页面开场与长段落转折。
- **Title** (600, `clamp(1.5rem, 2.5vw, 2.5rem)`, 1.15): 功能段和状态标题。
- **Body** (400, `clamp(1rem, 0.95rem + 0.2vw, 1.125rem)`, 1.75): 正文，拉丁语言限制在 65 到 75ch，CJK 限制在约 36em。
- **Label** (600, `0.75rem`, 1.4, `0.06em`): 导航、按钮与状态。CJK 不使用全大写语气。
- **Mono** (500, `0.75rem`, 1.5, `0.03em`): 扩展名、格式、代码和编号，永远位于独立技术说明层。

**The Two Registers of Type Rule.** 诗性主句与技术证据必须分行、分组、分字体角色。禁止在同一句中突然插入原始技术名词。

**The Locale Owns the Line Rule.** 每种语言独立确定行长、断句和字面密度。禁止为了视觉对齐而损害自然表达。

**The Mono Is Evidence Rule.** 等宽字体只说明文件、代码、格式或测量，不用来伪装“开发者气质”。

## Elevation

深度采用纸张式混合系统：色面先建立层级，阴影只说明纸页叠放、聚焦或浮起。静止的导航和正文默认平整；交互纸页可在一个层级内轻微抬起。纹理、颗粒与套准偏移始终低对比，不改变字符边缘。

### Material Vocabulary

- **Paper Fiber Mask v1:** `assets/brand/textures/paper-fiber-mask-seamless-v1.webp`，1254×1254，74,078 bytes，SHA-256 `A40953A1FE5A3D72E347466CA9227E266A6EA4868073A421FF4F368316D0026D`。它由内置 ImageGen 生成并经 3×3 平铺复核，是可复用的中性纸纤维蒙版，不是带颜色的背景照片。正式官网必须把 `--site-paper-texture` 绑定到该本地资产；缺失绑定时材质检查失败。
- **Hero Ink Ground Approved v1:** 采用用户于 2026-08-03 最终指定的橘红主印面版本，保留自然撕裂边缘、卫星墨点和单次右向干刷拖尾；位图不包含任何文字。进入实现时转为本地透明 WebP `assets/brand/textures/hero-ink-ground-approved-v1.webp`，补录尺寸、bytes 与 SHA-256，并绑定 `--site-hero-ink-ground`；资产未就绪时强调字必须回退为炭墨。
- 材质通过位于内容之后的伪元素或背景层合成，推荐 `background-blend-mode: multiply`。由于登记资产本身是近白、低对比蒙版，正文纸面使用 0.24 到 0.32 的图层不透明度，大面积 Hero 暖纸最多 0.64，深青装订面最多 0.18；这些数值控制蒙版合成强度，不代表最终颜色对比度。
- 平铺参考尺寸为 627px；每层纸使用不同且固定的 `background-position`，避免叠纸出现完全相同的纤维位置。禁止运行时随机定位。
- 纹理不得进入文字前景、改变字形边缘或降低对比度。禁止折痕、暗角、阴影、污渍、咖啡印、强颗粒和可见接缝；正式资产预算不超过 96KB。

### Shadow Vocabulary

- **Wing Sheet** (`0 0 0 1px oklch(0.15 0.003 85 / 0.03), 0 1px 2px oklch(0.15 0.003 85 / 0.04), 0 2px 4px oklch(0.15 0.003 85 / 0.02)`): 单张纸与静止控件，仅说明纸面离开背景一层。
- **Wing Stack** (`0 0 0 1px oklch(0.15 0.003 85 / 0.04), 0 2px 4px oklch(0.15 0.003 85 / 0.06), 0 4px 12px oklch(0.15 0.003 85 / 0.04)`): 叠纸、悬停按钮和编辑器内层。
- **Wing Float** (`0 0 0 1px oklch(0.15 0.003 85 / 0.05), 0 4px 8px oklch(0.15 0.003 85 / 0.08), 0 8px 24px oklch(0.15 0.003 85 / 0.06), 0 16px 32px oklch(0.15 0.003 85 / 0.02)`): 语言菜单、移动导航和当前交互纸页。普通内容卡不得使用。

### Motion and Paper Physics

- **Press:** 80ms，使用 `cubic-bezier(0.16, 1, 0.3, 1)`。
- **Micro feedback:** 120 到 150ms，限定为颜色、透明度和 `transform`。
- **Release:** 200ms，快速回到静止纸面。
- **Spatial transition:** 250 到 350ms，使用非回弹的指数型 ease-out。
- **Narrative settle:** 最长 400ms，只用于 Hero 入场和滚动分幕切换。
- 禁止动画布局属性、bounce、elastic、持续呼吸、持续视差或依靠动画才能理解的信息。

**The Depth Has a Job Rule.** 每一道阴影必须回答“哪张纸在谁上面”。回答不出时，移除阴影。

**The Still Page Rule.** 页面完成入场后必须稳定。品牌表现来自构图与活字，不来自持续运动。

**The Focus Before Flourish Rule.** 键盘焦点、减弱动效和 200% 缩放优先于任何编排效果。粘性内容不得遮挡当前焦点。

## Components

组件原则是“结构像纸，控件像印记”。形状克制、命中明确、状态可观察。应用现有 6px 控件圆角作为兼容层保留；官网不再使用统一 4px、8px、12px 对称圆角，而采用命名的不对称轮廓。所有触控目标至少 44px，外层网页保持无圆角全幅舞台。

### Hero Press Stage

- 桌面 Hero 不得放入统一圆角外壳，最小高度为 `min(100svh, 980px)`，推荐不低于 720px。暖纸覆盖完整舞台，深青只作为编辑器装订脊、承托背板和被纸页遮挡的负重结构。
- 在 1440×900 及以上视口，本地化主句包围盒必须占首屏 12% 到 20%，高度占 45% 到 65%；真实编辑器证明必须占首屏至少 40%。标题、唯一主动作和编辑器必须同时进入首个 `100svh`。每种语言使用经确认的显式断行，浏览器不得把同一短句再次拆散。
- Hero 主句始终是一个语义 `h1`，内部拆为炭墨展示体语气段和 IBM Plex Sans 700 强调段；强调段在橘红印面就绪时使用校样纸色。展示体同时用于编辑器文档标题，IBM Plex Sans 同时承担 Hero 强调段与编辑器正文/UI，使标题与产品画面通过字体角色相连。
- 默认态保留一块橘红主印面、少量同色卫星墨点和一条右向干刷拖尾。主印面承托强调段，拖尾连接至深青装订脊；不得产生第二块大型墨迹、深朱红叠层或任何编辑器内容覆盖。具体尺寸和位置按语言断行微调，但每种语言都必须通过首屏截图复核。
- SSR 初始状态不写入 `data-ink-ready`，强调段保持炭墨且主印面隐藏；只有本地墨面位图完成解码后才设置 `data-ink-ready="true"` 并同步切换校样纸色文字。图片失败、强制颜色和打印降级都不得留下低对比的纸色字。
- 标题区域约占视口宽度 30% 到 38%，编辑器叠纸约占 55% 到 65%，允许跨越栅格并形成交叠张力。禁止正交 50/50 分栏、覆盖超过视口 80% 的总外壳，以及 `BRAND SURFACE`、`WORKING PROOF` 等面向设计者的标签。1120px 及以下必须切换为单列 Hero，避免三栏编辑器被裁切。
- 编辑器证明固定为四层纸：三张 `aria-hidden` 后纸与一张真实 DOM 前纸。确定性角度为 `-4.2deg / 2.6deg / -1.6deg / 0.8deg`，露边偏移为 `14px / 28px / 42px`，任何单层不得超过 6deg。每层通过位于内容之后的独立纹理层使用 `multiply` 与受控透明度，禁止把全不透明纹理直接盖在纸色或文字上。
- Hero 主动作复用通用 Primary：深青底、校样纸文字与 `12px 18px 10px 15px` 不对称轮廓；下方允许一条不超过 12px、不会进入文字承载区的橘红不规则套印底边。不得使用橘红主填充、橘红文字或降低标签对比度。预发布时文案仍为“查看发布进度”，禁止伪装成可下载按钮。
- 移动端取消叠压与大角度旋转，只保留一张主编辑器纸页和一层轻量后纸，但仍按“大主句、真实产品证明、主动作”的源码顺序形成同等信息强度。主编辑器前纸必须回到正常文档流并由内容撑开高度，禁止使用固定高度裁切长译文或 200% 缩放内容。

### Buttons

- **Shape:** 官网主次按钮使用 `12px 16px 14px 10px` 不对称轮廓和至少 44px 高度。紧凑产品控件可保留现有 6px。
- **Primary:** 深青底、校样纸文字、左右 20px 内边距。Hover 上移 1px并进入 Stack 阴影，Active 回到平面并缩放到 0.97。
- **Secondary:** 校样纸底、炭墨文字、完整 1px 炭墨透明边界。禁止只使用一侧彩色边框。
- **Focus:** 2px 套准橙焦点环，偏移 2px。焦点与悬停必须是独立状态。

### Navigation

- 桌面导航为低矮的纸边索引，当前项使用文字、下划规则和 `aria-current` 三重状态，不使用胶囊阵列。
- 主导航只显示 Product、Download、Themes、Support。Studio、Services、Privacy 位于正文或页脚。
- 720px 以下切换为可见的移动导航按钮和线性菜单；关闭、Escape、焦点回收形成完整闭环。

### Language Selector

- 使用原生按钮语义和列表语义，44px 命中区域，显示当前语言的本地名称。
- 切换时保持当前路径，不强制跳转；建议提示与手动选择在视觉上明确区分。

### Technical Rail

- 文件格式、功能清单和输出类型位于独立低注意力行，使用 Geist Mono 或当前语言正文的小字号版本。
- CJK 页面优先本地化技术标签；`.md`、`PDF` 等不可翻译标记保持原样。
- 技术行可换行，禁止隐藏滚动条后让内容不可达。

### Paper Sheets and Status

- 叙事纸页使用 `18px 24px 16px 22px`，编辑器前纸使用 `8px 14px 10px 12px`；配合 32px 桌面内边距、16px 移动内边距和 Sheet 或 Stack 阴影。
- 发布状态使用书签黄与炭墨，包含明确的状态词和日期，不使用颜色单独传达。
- 不创建同尺寸卡片阵列。功能证明采用连续纸页、装订分区或编号叙事。

### Numbered Annotations

- 32px 圆形编号使用校样纸底与炭墨文字，外加橙色套准环，并配合文本标题和规则线。编号只是定位，不代替标题。
- 桌面端与粘性编辑器同步；移动端按 1 到 4 的源码顺序排列。

### Editor Proof

- 编辑器演示是真实 DOM，使用真实安全 Markdown 渲染管线。它提供源码、预览、Wiki-link 与 backlink 的可操作证明，但不保存、不访问文件系统。
- 首页的编辑器证明必须是 Hero 主视觉，包含可识别的书签轨、正文区、反向链接轨、状态行和深青装订结构，不得缩成 Hero 下方的单张 Markdown 卡片。
- 四幕顺序固定为本地文件、笔记关联、实时写作、自由导出。每次状态变化至少有一个可见结果和一个可读状态说明。
- 减弱动效时取消 sticky scrub 和倾斜过渡，保留全部按钮、文本、链接和结果。

**The Honest Control Rule.** 每个看起来可点击的元素都必须能操作并产生可观察结果；纯装饰不得伪装成控件。

**The No Modal First Rule.** 官网没有表单、购买或账户任务。语言、发布信息和支持路径使用页面内渐进结构，不用模态框抢占阅读。

**The Source Order Rule.** 非对称视觉不得改变语义顺序。屏幕阅读器与键盘必须按标题、说明、证明、动作的顺序前进。

## Do's and Don'ts

### Do

- **Do** 把官网当作品牌表面，把嵌入编辑器当作产品表面。官网可以表达，编辑器必须安静、真实、任务优先。
- **Do** 让结构承担视觉工作。使用装订平面、纸边、套准标记、导航轨、编号批注和真实编辑器层级构图。
- **Do** 保持样机级 Hero 冲击力。让巨型双字体本地化主句、深青主动作和倾斜真实编辑器在第一屏同时成立。
- **Do** 坚持已确认的装订四色。暖纸承担 Hero 舞台，深青承担编辑器装订、主要结构和动作，炭墨承担语气段与阅读，橙承担紧凑强调印面、克制墨点、主动作窄底边和功能性定位，黄与橄榄承担书签和状态。
- **Do** 将诗性主句和技术证据放在独立的语义与字体层。任一层都必须可以单独阅读。
- **Do** 使用真实语义 DOM 和真实清洗后的 Markdown 管线展示能力，每个控件都必须对应可观察结果。
- **Do** 让内容内部遵守 4px 布局节奏，纸页外轮廓则使用确定性角度、露边和不对称圆角。2px 只用于紧凑控件对齐。
- **Do** 只用纸张层级解释叠放、焦点和交互。使用已登记的连续纸纤维蒙版，纹理、颗粒、套准偏移不得干扰文字。
- **Do** 将正文控制在拉丁语言 65 到 75ch、CJK 约 36em，并保持明确的字号与字重级差。
- **Do** 将动效限制在 80 到 400ms，优先使用透明度和 transform，并为每段动效提供等价静态状态。
- **Do** 在非对称构图中保持语义源码顺序，确保标题、地标、链接、模式切换和反向链接可被辅助技术理解。
- **Do** 满足 WCAG 2.1 AA，正文至少 4.5:1，大文字和 UI 边界至少 3:1，焦点清晰，Tab 顺序合理，触控目标至少 44px。
- **Do** 使用文字或形状配合颜色表达状态，并在 200% 缩放时保持内容和操作可达。
- **Do** 在移动端把粘性滚动改为线性纸页序列，保留相同叙事和动作。
- **Do** 让发布状态、平台状态、商业状态、语言能力和产品演示保持可验证。
- **Do** 保持轻量，每个语言构建只加载有固定版本、哈希、OFL 和覆盖语料的当前语言字体，非关键演示延迟加载。

### Don't

- **Don't** 使用渐变、渐变文字、纯黑、纯白、装饰性光晕、默认玻璃拟态或新的暗色表面。
- **Don't** 复刻 SaaS 模板感。巨型标题与 CTA 必须属于非对称装订构图并紧邻真实产品证据，不能变成居中标题、摘要和胶囊按钮。
- **Don't** 使用相同卡片网格、嵌套卡片、大圆角图标加标题、Hero 指标、正交 50/50 Hero、超过 1px 的彩色侧边条或包住一切的容器。
- **Don't** 统一放大所有圆角来冒充有机感。外层舞台保持全幅，纸页和印章使用经过命名的不对称轮廓。
- **Don't** 模仿企业软件感、终端极客感或密集多层导航。复杂度不能直接变成视觉重量。
- **Don't** 滑向通用编辑杂志公式。印刷身份来自装订、校样、套准和工作文档结构，不来自装饰性斜体、首字下沉、分栏细线或小号等宽标签。
- **Don't** 在同一行混合诗性文案与原始技术名词。中文页面的技术标签必须本地化并降低视觉权重。
- **Don't** 使用全大写正文、破折号式插入语、重复标题或仅复述标题的开场句。
- **Don't** 使用虚假应用截图、虚构商城库存、占位社区链接、装饰性素材人物或与真实功能无关的插画。
- **Don't** 只为冲击力添加阴影、纹理、动画或噪声。禁止未登记纹理、可见平铺接缝、持续环境运动、回弹缓动、视差依赖和布局属性动画。
- **Don't** 把已批准的橘红印面及其单次右向干刷拖尾误删，也不要把它扩张为第二个视觉主体。禁止跨入编辑器正文的刷痕、第二条拖尾、深朱红叠层、第二块大型墨迹、橘红标题文字或 CTA 橘红主填充；允许的橘红包括强调印面、批准拖尾、克制墨点、主动作窄底边和功能性定位。
- **Don't** 只依赖颜色、悬停、动画或空间位置传达含义。
- **Don't** 隐藏焦点、让键盘顺序违背视觉顺序、把关键动作藏在仅悬停可见区域或强迫用户观看动效。
- **Don't** 把低注意力元信息做成低对比或难读文字。克制不能削弱可访问性。
- **Don't** 硬编码主题身份、添加未作用域的主题覆盖，或让官网样式改变应用 Theme API 合同。
- **Don't** 用商城、支持推广、模态框或主动 CTA 打断写作、保存、阅读和搜索流程。
