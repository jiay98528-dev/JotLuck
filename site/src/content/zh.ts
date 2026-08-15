import type { SiteContent } from './types';

/**
 * 中文母稿（正典）— 基于 site-concepts 冻结母稿修订。
 * 任何事实性修改（日期、平台、能力边界）必须五语同步。
 */
export const zh: SiteContent = {
  meta: {
    title: 'JotLuck — 落字为安 · 本地优先 Markdown 笔记',
    description:
      '一款轻量、本地优先、离线可用的 Markdown 笔记工具。每一条笔记都是纯文本文件，文件夹即笔记本。',
    pageTitles: {
      download: '下载 · JotLuck — 本地优先 Markdown 笔记（Windows）',
      themes: '主题 · JotLuck — 本地优先 Markdown 笔记',
      studio: '工作室 · JotLuck — 本地优先 Markdown 笔记',
      privacy: '隐私 · JotLuck — 本地优先 Markdown 笔记',
    },
    pageDescriptions: {
      download:
        '下载 JotLuck Windows x64 版：Preview 预览版已上架，未签名，安装前请核对 SHA-256。本地优先、离线可用的 Markdown 笔记工具，每条笔记都是纯文本文件。',
      themes:
        'JotLuck 工作区主题：Paper 纸、Halo Canvas、Lumen Field 三套主题——主题重新塑造工作区本身，从纸墨颜色到窗口布局。',
      studio:
        'LeankomStudio 是鸰湖科技的产品工作室。让想法越过类型，找到最适合它的形状——JotLuck 本地 Markdown 笔记是我们向外展开的第一页。',
      privacy:
        'JotLuck 隐私说明：笔记以纯文本文件保存在你自己的文件夹中，应用完全离线运行——写作无需账号、无遥测。本站为静态网站，不使用 Cookie 与分析追踪。',
    },
  },
  localeName: '中文',
  header: {
    nav: { home: '产品', download: '下载', themes: '主题', studio: '工作室' },
    langSelectorLabel: '选择语言',
  },
  hero: {
    eyebrow: '本地优先的 Markdown 笔记工具',
    lines: ['写作，', '本应轻盈。'],
    emphasis: '把生态留在纸页之外。',
    emphasisHighlight: '生态',
    subline: '从一个文件开始，沿着思绪写下去。写下的一切，依然可以随你远行。',
    action: '下载 Preview',
    dateLine: 'Preview 已上架',
  },
  narrative: [
    {
      id: 'file',
      title: '一份文件，就是开始。',
      body: '无需账户，也无需把文字搬进新的容器。打开它，写下去。',
      rail: ['本地文件', '.md', '.mdx', '.txt'],
    },
    {
      id: 'link',
      title: '让笔记彼此相连。',
      body: '从一句话走进另一篇笔记，也能看见，此刻正有哪些想法，指向你所在的位置。',
      rail: ['双向链接', '反向查看', '全文搜索', '标签系统', '大纲导航'],
    },
    {
      id: 'flow',
      title: '不要让工具打断下一句。',
      body: '纸页随着文字安静变化，只在需要时，递来一点恰好的提示。',
      rail: ['实时预览', '块编辑', '文字补全（当前支持中文与英文）'],
    },
    {
      id: 'export',
      title: '写完以后，路还很长。',
      body: '作品不必停在这里。',
      rail: ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'HTML'],
    },
  ],
  multilingual: {
    eyebrow: '五语适配',
    title: 'JotLuck 现在说五种语言。',
    body: '界面已完成中文、日本語、한국어、English、Français 五个语言版本的完整适配——从菜单到状态行，每一处文字都已就位。',
    languages: ['中文', '日本語', '한국어', 'English', 'Français'],
    note: '文字补全当前支持中文与英文，更多语言随后续版本补齐。',
  },
  download: {
    eyebrow: '下载',
    title: 'Preview 已上架。',
    lead: 'Windows x64 预览版现在即可下载。macOS 与 Linux 随后跟进——纯文本从不挑平台，你的笔记在任何系统上都是本地文件。',
    statusLabel: '首发平台',
    statusValue: 'Windows x64',
    platformTitle: '平台',
    platforms: [
      { name: 'Windows x64', state: 'Preview 已上架' },
      { name: 'macOS', state: '随后跟进' },
      { name: 'Linux', state: '随后跟进' },
    ],
    honestyTitle: '预览版先行。',
    honestyBody: '预览版安装包已上架 GitHub Releases——可下载、可校验、可回退。',
    previewTitle: 'v0.11.2 Preview',
    downloadBtn: '下载 Preview（Windows x64）',
    releaseBtn: 'Release 说明与校验',
    signNote:
      '预览版未签名。Windows SmartScreen 可能提示风险，安装前请核对 SHA-256 与 Release 页一致。',
    signPolicyLink: '代码签名政策',
    notesTitle: '值得知道',
    notes: [
      '笔记保存在你选择的文件夹中，无需注册账号',
      '四种扩展名注册为可选「打开方式」，不改写系统默认应用',
      'MIT 协议开源，核心编辑与搜索完全离线运行',
    ],
  },
  themes: {
    eyebrow: '主题',
    title: '创作空间，也值得被塑造。',
    lead: '主题重新塑造工作区本身，从纸墨颜色到窗口布局。',
    items: [
      { id: 'paper', name: 'Paper 纸', blurb: '默认主题。和纸暖调，墨色文字，工具退后。' },
      { id: 'halo-canvas', name: 'Halo Canvas', blurb: '浮动画布布局，书签、面板各就其位。' },
      { id: 'lumen-field', name: 'Lumen Field', blurb: '暗色专注场域，只剩你和文字。' },
    ],
    blueprintTitle: '主题系统',
    blueprintBody:
      '主题系统开放整个工作区的深度定制——布局、面板与纸墨质感皆可重新塑造，留给有独特创意、有强烈表达欲望的人。',
    marketplaceNote: '主题随应用内置发布，开箱即用。',
  },
  themePreview: {
    ui: {
      outline: '大纲',
      backlinks: '反链',
      tags: '标签',
      noTags: '无标签',
      search: '搜索',
      searchShortcut: '搜索 Ctrl+K',
      templates: '模板',
      live: '即时',
      syntax: '? 语法',
      unsaved: '未保存',
      saved: '已保存',
      replay: '重播演示',
      exportAction: '导出',
      share: '分享',
      recent: '最近',
      clearFormat: '清除格式',
      scratch: '临时草稿',
      quote: '引用',
      body: '正文',
      ready: 'Ready',
    },
    sampleNote: {
      title: '主题示例笔记',
      intro: 'JotLuck 保持纯文本文件的自由，同时提供实时预览、反链和标签整理。',
      section: '今日整理',
      bullets: [
        '打开本地文件夹后，笔记会自动进入最近列表',
        '使用 [[项目索引]] 连接相关内容',
        '通过 #research 和 #draft 快速筛选',
      ],
      quoteLine: '写作区保持清爽，工具在需要时出现。',
      statusLeft: '152 字 · 20 词 · 选中文字以格式化 · Ctrl+点击固定区块',
    },
    haloNote: {
      notebook: '示例笔记本',
      files: ['主题示例笔记', '项目索引', '设计笔记', '格式示例', '灵感清单'],
      filePaths: ['主题示例笔记.md', '项目索引.md', '设计笔记.md', '格式示例.md', '灵感清单.md'],
      typedBullet: '用 [[项目索引]] 串起今天的进度',
      frontmatterTitle: '主题示例笔记',
      frontmatterTags: ['research', 'draft'],
    },
  },
  studio: {
    eyebrow: '工作室',
    title: '让想法越过类型，找到最适合它的形状。',
    lead: 'JotLuck 是我们向外展开的第一页。',
    quote: '有些想法成为工具。另一些长成整个世界。',
    body: '如果你也有一个放不下的想法，写信给我们。',
    action: 'carriechan@leankom.com',
  },
  privacy: {
    eyebrow: '隐私',
    title: '你的作品，本该属于你。',
    lead: 'JotLuck 是本地优先的离线工具。写作无需账号，没有遥测，也没有一台装着用户数据、等着被泄露的服务器。',
    sections: [
      {
        title: '我们不碰你的笔记',
        body: 'JotLuck 桌面应用完全离线运行。没有遥测，不上传笔记内容，也不统计你的使用行为。我们处理你笔记数据的方式，是从一开始就接触不到它。未来主题商店上线时，会需要一个邮箱账户，仅用于交付你购买的数字资产。它只装你的邮箱地址和购买记录，与你的笔记没有任何关系。',
      },
      {
        title: '笔记只存于你的文件夹',
        body: '每一条笔记都是纯文本 Markdown 文件，保存在你自己选择的本地文件夹中。备份、同步与删除完全由你决定——JotLuck 不持有任何副本。',
      },
      {
        title: '我们不追踪你的访问',
        body: '本站是静态网站。不使用 Cookie，不加载分析或追踪脚本，字体与素材全部自托管。你的访问只是读走几个文件，仅此而已。',
      },
      {
        title: '下载与 GitHub',
        body: '安装包通过 GitHub 发布。你在 GitHub 站点内的访问适用 GitHub 的隐私政策；JotLuck 不会从这一渠道获得你的任何信息。',
      },
    ],
    contactTitle: '有问题，写信给我们',
    contactBody: '对隐私有任何疑问或顾虑，直接来信，我们会认真回复。',
  },
  footer: {
    studio: 'LeankomStudio',
    tagline: '本地优先 · 开源 · 不被云端锁定',
    copyright: '© 2026 鸰湖科技（深圳）有限公司',
    links: { support: '支持', privacy: '隐私', signing: '代码签名政策', github: 'GitHub' },
  },
};
