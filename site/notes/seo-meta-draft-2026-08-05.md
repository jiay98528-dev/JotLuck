# SEO Meta 标题草案 — ja / ko / fr（2026-08-05）

> 参照已定稿的 zh/en 风格：`品牌句 · 类别句`（title）；`栏目词 · JotLuck — 类别句（Windows）`（download 子页）；`栏目词 · JotLuck — 类别句`（themes/studio 子页）。
> 约束：≤60 字符（含空格）；栏目词沿用各语 header.nav 既有用词；类别句与各语 description / hero.eyebrow 措辞对齐。
> 字符数为人工逐字统计（含空格与标点），供主线程复核。

## ja

类别句：「ローカルファーストの Markdown ノート」（与 hero.eyebrow / description 一致）。

```ts
meta: {
  title: 'JotLuck — 書き留める、安心して · ローカルファーストの Markdown ノート', // 47 chars
  description: '（保持现有值）',
  pageTitles: {
    download: 'ダウンロード · JotLuck — ローカルファーストの Markdown ノート（Windows）', // 54
    themes: 'テーマ · JotLuck — ローカルファーストの Markdown ノート', // 40
    studio: 'スタジオ · JotLuck — ローカルファーストの Markdown ノート', // 42
  },
},
```

## ko

类别句：「로컬 우선 Markdown 노트」（与 hero.eyebrow / description 一致）。全谚文，无汉字。

```ts
meta: {
  title: 'JotLuck — 마음 편히 적어내려가다 · 로컬 우선 Markdown 노트', // 42 chars
  description: '（保持现有值）',
  pageTitles: {
    download: '다운로드 · JotLuck — 로컬 우선 Markdown 노트（Windows）', // 44
    themes: '테마 · JotLuck — 로컬 우선 Markdown 노트', // 32
    studio: '스튜디오 · JotLuck — 로컬 우선 Markdown 노트', // 34
  },
},
```

## fr

类别句：「Notes Markdown, local d'abord」（与 hero.eyebrow / description 一致）。

品牌句决策：现有 meta.title 品牌句「Posez les mots, en confiance」（28 字符）完整版 title 达 71 字符，超 60 上限；为保留完整类别句（品牌核心词「local d'abord」）与全站措辞一致性，title 品牌句改用「Écrire en paix」（安心地写，与 zh「落字为安」/ ja「安心して」语义呼应，57 字符）。

```ts
meta: {
  title: 'JotLuck — Écrire en paix · Notes Markdown, local d'abord', // 57 chars
  description: '（保持现有值）',
  pageTitles: {
    download: 'Téléchargement · JotLuck — Notes Markdown locales (Windows)', // 59（主推）
    themes: 'Thèmes · JotLuck — Notes Markdown, local d'abord', // 50
    studio: 'Studio · JotLuck — Notes Markdown, local d'abord', // 50
  },
},
```

download 子页取舍说明（需主线程定夺）：

- 主推（上述）：保留 Windows 关键词（下载页搜索意图核心），类别句缩为「Notes Markdown locales」（本地 Markdown 笔记，22 字符）——"本地优先"的完整措辞保留在 title 与其余子页。
- 备选 A（全站类别句一致，无 Windows 标注）：`'Téléchargement · JotLuck — Notes Markdown, local d'abord'`（57 字符）。
- 若采用完整品牌句（不推荐，超限）：title 为 `'JotLuck — Posez les mots, en confiance · Notes Markdown, local d'abord'`（71 字符，超 60 上限，仅作参考）。

## pageDescriptions

> 搜索引擎摘要：陈述利益点 + 事实，不复用页面视觉 lead。70–160 字符（含空格）。
> 公司主体：ja 用「鸰湖科技」；ko 用谚文音译「링후 테크놀로지」（若需汉字版可换「鸰湖科技」）；fr 用英文法定名简写「Linghu Technology」（footer.copyright 有全称）。

### ja

```ts
meta: {
  pageDescriptions: {
    download:
      'JotLuck Windows x64 版をダウンロード。軽量でローカルファースト、オフラインでも使える Markdown ノートツールです。ノートはプレーンテキストファイル、フォルダーがそのままノートブック。最初の公開版は 2026 年 8 月 15 日です。', // 135 chars
    themes:
      'JotLuck のワークスペーステーマ——Paper・Halo Canvas・Lumen Field の 3 種類。テーマは単なる塗り替えではなく、ワークスペースそのものを再形成します。', // 96
    studio:
      'LeankomStudio は鸰湖科技のプロダクトスタジオです。アイデアがカテゴリを越え、いちばん合う形に出会うように——JotLuck は私たちが外に向かって開いた最初のページです。', // 93
  },
},
```

### ko

全谚文，无汉字。

```ts
meta: {
  pageDescriptions: {
    download:
      'Windows x64용 JotLuck을 다운로드하세요. 가볍고 로컬 우선이며 오프라인에서도 쓸 수 있는 Markdown 노트 도구입니다. 모든 노트는 순수 텍스트 파일이고, 폴더가 곧 노트북입니다. 첫 공개 버전은 2026년 8월 15일 출시 예정입니다.', // 138 chars
    themes:
      'JotLuck 작업 공간 테마——Paper, Halo Canvas, Lumen Field 세 가지. 테마는 단순한 페인트칠 이상으로, 작업 공간 자체를 다시 만듭니다.', // 94
    studio:
      'LeankomStudio는 링후 테크놀로지의 제품 스튜디오입니다. 아이디어가 범주를 넘어, 가장 잘 어울리는 형태를 만나게 하세요——JotLuck은 우리가 바깥으로 펼쳐 낸 첫 번째 페이지입니다.', // 108
  },
},
```

### fr

```ts
meta: {
  pageDescriptions: {
    download:
      "Téléchargez JotLuck pour Windows x64. Un outil de notes Markdown léger, local d'abord, utilisable hors ligne. Première version publique : 15 août 2026.", // 149 chars
    themes:
      "Les thèmes de JotLuck — Paper, Halo Canvas et Lumen Field. Un thème n'est pas qu'une couche de peinture : il remodèle l'espace de travail lui-même.", // 145
    studio:
      "LeankomStudio, studio de Linghu Technology. Les idées trouvent leur forme — JotLuck, l'outil de notes Markdown local, est notre première page.", // 140
  },
},
```

备注：fr 因语法词较长，download 摘要省略了「纯文本/文件夹」信息点（该点在 hero/proof 已覆盖），保留动作 + 平台 + 定位 + 日期四个核心信息点，149 字符为三语中最接近上限的一条。
