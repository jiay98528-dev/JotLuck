import type { SiteContent } from './types';

/**
 * 日本語（ja）— 英文母稿の全量翻訳。语气以 zh.ts（中文正典）为参照。
 * 事实性内容（日期・平台・能力边界）与五语保持一致。
 */
export const ja: SiteContent = {
  meta: {
    title: 'JotLuck — 書き留める、安心して · ローカルファーストの Markdown ノート',
    description:
      '軽量で、ローカルファースト、オフラインでも使える Markdown ノートツール。すべてのノートはプレーンテキストファイルであり、フォルダはそのままノートブックです。',
    pageTitles: {
      download: 'ダウンロード · JotLuck — ローカルファーストの Markdown ノート（Windows）',
      themes: 'テーマ · JotLuck — ローカルファーストの Markdown ノート',
      studio: 'スタジオ · JotLuck — ローカルファーストの Markdown ノート',
    },
    pageDescriptions: {
      download:
        'JotLuck Windows x64 版をダウンロード。軽量でローカルファースト、オフラインでも使える Markdown ノートツールです。ノートはプレーンテキストファイル、フォルダーがそのままノートブック。最初の公開版は 2026 年 8 月 15 日です。',
      themes:
        'JotLuck のワークスペーステーマ——Paper・Halo Canvas・Lumen Field の 3 種類。テーマは単なる塗り替えではなく、ワークスペースそのものを再形成します。',
      studio:
        'LeankomStudio は鸰湖科技のプロダクトスタジオです。アイデアがカテゴリを越え、いちばん合う形に出会うように——JotLuck は私たちが外に向かって開いた最初のページです。',
    },
  },
  localeName: '日本語',
  header: {
    nav: { home: '製品', download: 'ダウンロード', themes: 'テーマ', studio: 'スタジオ' },
    langSelectorLabel: '言語を選ぶ',
  },
  hero: {
    eyebrow: 'ローカルファーストの Markdown ノート',
    lines: ['書くことは、', 'もともと', '軽やかなもの。'],
    emphasis: 'まずは、ひとつのファイルから。',
    subline: 'ソフトウェアの生態系は、紙面の外に置いておく。書いたものはすべて、自由に旅立てる。',
    action: '公開状況を見る',
    dateLine: 'Windows x64 公開版は 2026 年 8 月 15 日公開予定',
    dateQuip: '控えめな見積もりです——もしかすると、もっと早く届くかもしれません。',
  },
  narrative: [
    {
      id: 'file',
      title: 'すべては、ファイルから始まる。',
      body: 'アカウントも、ことばのための新しい入れ物もいりません。開いて、書き続けるだけ。',
      rail: ['ローカルファイル', '.md', '.mdx', '.txt'],
    },
    {
      id: 'link',
      title: 'ノートを、つなげよう。',
      body: '一文から別のノートへ渡り歩き、どの考えが、いま自分がいる場所へ指し示しているかが見える。',
      rail: ['Wikiリンク', 'バックリンク', '全文検索', 'タグ', 'アウトライン'],
    },
    {
      id: 'flow',
      title: '道具が次の一行を遮らないように。',
      body: '紙面はあなたのことばに合わせて静かに変化し、必要なときだけ、ほどよい後押しを添える。',
      rail: ['ライブプレビュー', 'ブロック編集', '文字補完（現在は中国語と英語に対応）'],
    },
    {
      id: 'export',
      title: '筆を置いたあとも、道は続く。',
      body: '作品は、どこへでも自由に旅立てる。',
      rail: ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'HTML'],
    },
  ],
  multilingual: {
    eyebrow: '五つの言語',
    title: 'JotLuck は五つの言語を話します。',
    body: 'インターフェースは 中文・日本語・한국어・English・Français の五言語に完全対応——メニューもステータス行も、すべてが所定の場所に揃っています。',
    languages: ['中文', '日本語', '한국어', 'English', 'Français'],
    note: '文字補完は現在、中国語と英語に対応しています。その他の言語は、今後のリリースで順次対応予定です。',
  },
  download: {
    eyebrow: 'ダウンロード',
    title: '公開日は決まりました。',
    lead: '最初の Windows x64 版は 2026 年 8 月 15 日に公開します。macOS と Linux も続きます——プレーンテキストはプラットフォームを選びません。どのシステムでも、ノートはローカルファイルのままです。',
    statusLabel: '最初のプラットフォーム',
    statusValue: 'Windows x64',
    statusDate: '2026-08-15',
    statusQuip: '控えめな見積もりです——もしかすると、もっと早く届くかもしれません。',
    platformTitle: 'プラットフォーム',
    platforms: [
      { name: 'Windows x64', state: '2026 年 8 月 15 日 最初の公開版' },
      { name: 'macOS', state: '続いて公開予定' },
      { name: 'Linux', state: '続いて公開予定' },
    ],
    honestyTitle: '8月15日、公開します。',
    honestyBody:
      'リリース当日、このページと GitHub Releases が完成版インストーラーと同時に公開されます。ダウンロードするどのコピーも、検証済みの完全なビルドです。',
    countdownLabel: '初回公開まで',
    countdownUnit: '日',
    notesTitle: '知っておきたいこと',
    notes: [
      'ノートは自分で選んだフォルダに保存されます——アカウントは不要です',
      '4 種類の拡張子が任意の「アプリで開く」ハンドラとして登録されるだけ。システムの既定は変更されません',
      'MIT ライセンスで公開。編集と検索の核となる機能は、完全にオフラインで動作します',
    ],
  },
  themes: {
    eyebrow: 'テーマ',
    title: '創作の空間もまた、形を整える価値がある。',
    lead: 'テーマは単なる塗り替えではありません——ワークスペースそのものを再形成します。',
    items: [
      {
        id: 'paper',
        name: 'Paper',
        blurb: '既定のテーマ。温かな和紙の色調、墨色の文字、一歩引く道具たち。',
      },
      {
        id: 'halo-canvas',
        name: 'Halo Canvas',
        blurb: '浮かぶキャンバスレイアウト。ブックマークもパネルも、それぞれの場所に。',
      },
      {
        id: 'lumen-field',
        name: 'Lumen Field',
        blurb: '集中のための暗い野原。あなたとテキストだけ。',
      },
    ],
    blueprintTitle: 'テーマシステム',
    blueprintBody:
      'Theme API v2 は、slot・ホスト API・.mltheme パックを通じてワークスペース全体を開放します——独自のアイデアと、表現したいという抑えきれない衝動を持つ人のための、深いカスタマイズです。',
    marketplaceNote: 'テーマはアプリに同梱され、開いたその瞬間から使えます。',
  },
  themePreview: {
    ui: {
      outline: 'アウトライン',
      backlinks: 'バックリンク',
      tags: 'タグ',
      noTags: 'タグなし',
      search: '検索',
      searchShortcut: '検索 Ctrl+K',
      templates: 'テンプレート',
      live: 'ライブ',
      syntax: '? 構文',
      unsaved: '未保存',
      saved: '保存済み',
      replay: 'デモを再生',
      exportAction: 'エクスポート',
      share: '共有',
      recent: '最近',
      clearFormat: '書式をクリア',
      scratch: '一時下書き',
      quote: '引用',
      body: '本文',
      ready: 'Ready',
    },
    sampleNote: {
      title: 'テーマのサンプルノート',
      intro:
        'JotLuck はプレーンテキストファイルの自由を保ちつつ、ライブプレビュー、バックリンク、タグによる整理を提供します。',
      section: '今日の整理',
      bullets: [
        'ローカルフォルダーを開くと、ノートは自動的に最近のリストに入ります',
        '[[プロジェクト索引]] で関連資料をつなぐ',
        '#research と #draft ですばやく絞り込めます',
      ],
      quoteLine: '執筆面はすっきりと保ち、道具は必要なときに現れる。',
      statusLeft: '152 文字 · 20 語 · 文字を選択して書式設定 · Ctrl+クリックでブロックを固定',
    },
    haloNote: {
      notebook: 'サンプルノートブック',
      files: [
        'テーマのサンプルノート',
        'プロジェクト索引',
        'デザインノート',
        '書式の例',
        'アイデアリスト',
      ],
      filePaths: [
        'テーマのサンプルノート.md',
        'プロジェクト索引.md',
        'デザインノート.md',
        '書式の例.md',
        'アイデアリスト.md',
      ],
      typedBullet: '今日の進捗を [[プロジェクト索引]] にまとめる',
      frontmatterTitle: 'テーマのサンプルノート',
      frontmatterTags: ['research', 'draft'],
    },
  },
  studio: {
    eyebrow: 'スタジオ',
    title: 'アイデアがカテゴリを越え、いちばん合う形に出会うように。',
    lead: 'JotLuck は、私たちが外に向かって開いた最初のページです。',
    quote: 'あるアイデアは道具になる。別のものは、ひとつの世界へと育つ。',
    body: '手放せないアイデアがあるなら、私たちに手紙を書いてください。',
    action: 'carrie@leankom.com',
  },
  footer: {
    studio: 'LeankomStudio',
    tagline: 'ローカルファースト · オープンソース · クラウド非依存',
    copyright: '© 2026 Linghu Technology (Shenzhen) Co., Ltd.',
    links: { support: 'サポート', privacy: 'プライバシー', github: 'GitHub' },
  },
};
