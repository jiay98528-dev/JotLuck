import type { LocaleId, SiteContent } from '../types';

const sharedPages: Record<LocaleId, SiteContent['pages']> = {
  en: {
    product: {
      eyebrow: 'Product',
      title: 'Plain text, without the plain experience.',
      lead: 'Open a local folder. Write Markdown. Follow wiki-links and backlinks without surrendering your files.',
    },
    download: {
      eyebrow: 'Release proof',
      title: 'No download is published yet.',
      lead: 'The first public Windows x64 build is being prepared. A verified GitHub Release will appear here when it is real.',
      note: 'August 15, 2026 is a review target, not a guaranteed release date.',
    },
    themes: {
      eyebrow: 'Themes & plugins',
      title: 'The foundation is being built.',
      lead: 'There are no themes, plugins, prices, or purchase links available today.',
      note: 'Future extensions will remain explicit about compatibility and trust.',
    },
    support: {
      eyebrow: 'Support',
      title: 'Talk to the people building JotLuck.',
      lead: 'For product support, write to official@leankom.com or open a GitHub Issue.',
    },
    services: {
      eyebrow: 'Services',
      title: 'Not accepting commissions yet.',
      lead: 'Technical support and custom work may open later. No paid service is currently offered.',
    },
    studio: {
      eyebrow: 'LeankomStudio',
      title: 'Tools and experiences, made with intent.',
      lead: 'LeankomStudio works across software and games. For commercial collaboration, write to carrie@leankom.com.',
    },
    privacy: {
      eyebrow: 'Privacy',
      title: 'A small site with a small data footprint.',
      lead: 'No third-party analytics, forms, or font CDN are used. A functional language cookie may be stored for one year.',
    },
  },
  'zh-hans': {
    product: {
      eyebrow: '产品',
      title: '纯文本，不必只有朴素体验。',
      lead: '打开本地文件夹，书写 Markdown，通过 Wiki-link 与反向链接整理思路，而文件始终属于你。',
    },
    download: {
      eyebrow: '发布凭据',
      title: '目前还没有可下载版本。',
      lead: '首个 Windows x64 公开版本正在准备。真实、可校验的 GitHub Release 出现后，下载入口才会开放。',
      note: '2026 年 8 月 15 日是人工复核目标，不是保证发布日期。',
    },
    themes: {
      eyebrow: '主题与插件',
      title: '基础正在铺设。',
      lead: '目前没有主题、插件、价格或购买入口。',
      note: '未来扩展会明确说明兼容性与信任边界。',
    },
    support: {
      eyebrow: '支持',
      title: '直接联系正在制作 JotLuck 的人。',
      lead: '产品支持请写信至 official@leankom.com，或在 GitHub Issues 提交问题。',
    },
    services: {
      eyebrow: '服务',
      title: '暂未接受定制委托。',
      lead: '技术支持与定制服务可能在未来开放；目前没有任何付费服务。',
    },
    studio: {
      eyebrow: 'LeankomStudio',
      title: '认真制作工具与体验。',
      lead: 'LeankomStudio 横跨软件与游戏。商业合作请联系 carrie@leankom.com。',
    },
    privacy: {
      eyebrow: '隐私',
      title: '小网站，也只留下很小的数据足迹。',
      lead: '本站不接入第三方分析、表单或字体 CDN；语言偏好功能 Cookie 可能保存一年。',
    },
  },
  'zh-hant': {
    product: {
      eyebrow: '產品',
      title: '純文字，不必只有樸素體驗。',
      lead: '打開本機資料夾，書寫 Markdown，透過 Wiki-link 與反向連結整理思路，而檔案始終屬於你。',
    },
    download: {
      eyebrow: '發佈憑據',
      title: '目前還沒有可下載版本。',
      lead: '首個 Windows x64 公開版本正在準備。真實、可驗證的 GitHub Release 出現後，下載入口才會開放。',
      note: '2026 年 8 月 15 日是人工複核目標，不是保證發佈日期。',
    },
    themes: {
      eyebrow: '主題與外掛',
      title: '基礎正在鋪設。',
      lead: '目前沒有主題、外掛、價格或購買入口。',
      note: '未來擴充會明確說明相容性與信任邊界。',
    },
    support: {
      eyebrow: '支援',
      title: '直接聯絡正在製作 JotLuck 的人。',
      lead: '產品支援請寄信至 official@leankom.com，或在 GitHub Issues 提交問題。',
    },
    services: {
      eyebrow: '服務',
      title: '暫未接受客製委託。',
      lead: '技術支援與客製服務可能在未來開放；目前沒有任何付費服務。',
    },
    studio: {
      eyebrow: 'LeankomStudio',
      title: '認真製作工具與體驗。',
      lead: 'LeankomStudio 橫跨軟體與遊戲。商業合作請聯絡 carrie@leankom.com。',
    },
    privacy: {
      eyebrow: '隱私',
      title: '小網站，也只留下很小的資料足跡。',
      lead: '本站不接入第三方分析、表單或字型 CDN；語言偏好功能 Cookie 可能保存一年。',
    },
  },
  ja: {
    product: {
      eyebrow: 'プロダクト',
      title: 'プレーンテキストに、豊かな書き心地を。',
      lead: 'ローカルフォルダーを開き、Markdown で書き、Wiki-link とバックリンクで考えをつなぎます。ファイルの所有権は常にあなたにあります。',
    },
    download: {
      eyebrow: 'リリース情報',
      title: '現在、ダウンロード版はありません。',
      lead: '最初の Windows x64 公開版を準備中です。検証可能な GitHub Release が公開された時点でリンクを開きます。',
      note: '2026年8月15日は確認目標であり、公開を保証する日ではありません。',
    },
    themes: {
      eyebrow: 'テーマとプラグイン',
      title: '基盤を整備しています。',
      lead: '現在、テーマ、プラグイン、価格、購入リンクはありません。',
      note: '将来の拡張では互換性と信頼境界を明示します。',
    },
    support: {
      eyebrow: 'サポート',
      title: 'JotLuck を作る人に直接相談できます。',
      lead: '製品サポートは official@leankom.com または GitHub Issues へ。',
    },
    services: {
      eyebrow: 'サービス',
      title: '現在、受託制作は受け付けていません。',
      lead: '技術支援やカスタム開発は将来提供する可能性がありますが、現時点で有料サービスはありません。',
    },
    studio: {
      eyebrow: 'LeankomStudio',
      title: '道具と体験を、意図をもって作る。',
      lead: 'LeankomStudio はソフトウェアとゲームを横断します。商業協業は carrie@leankom.com へ。',
    },
    privacy: {
      eyebrow: 'プライバシー',
      title: '小さなサイト、小さなデータ footprint。',
      lead: '第三者解析、フォーム、フォント CDN は使いません。言語設定 Cookie は1年間保存される場合があります。',
    },
  },
  ko: {
    product: {
      eyebrow: '제품',
      title: '플레인 텍스트에 풍부한 쓰기 경험을.',
      lead: '로컬 폴더를 열고 Markdown으로 쓰며 Wiki-link와 백링크로 생각을 연결합니다. 파일은 언제나 당신의 것입니다.',
    },
    download: {
      eyebrow: '릴리스 증명',
      title: '아직 다운로드할 버전이 없습니다.',
      lead: '첫 Windows x64 공개 버전을 준비 중입니다. 검증 가능한 GitHub Release가 실제로 공개된 뒤 링크를 엽니다.',
      note: '2026년 8월 15일은 검토 목표이며 보장된 출시일이 아닙니다.',
    },
    themes: {
      eyebrow: '테마와 플러그인',
      title: '기반을 만들고 있습니다.',
      lead: '현재 판매 중인 테마, 플러그인, 가격 또는 구매 링크는 없습니다.',
      note: '향후 확장은 호환성과 신뢰 경계를 명확히 밝힙니다.',
    },
    support: {
      eyebrow: '지원',
      title: 'JotLuck을 만드는 사람에게 직접 문의하세요.',
      lead: '제품 지원은 official@leankom.com 또는 GitHub Issues를 이용해 주세요.',
    },
    services: {
      eyebrow: '서비스',
      title: '아직 의뢰를 받지 않습니다.',
      lead: '기술 지원과 맞춤 작업은 추후 제공될 수 있으며 현재 유료 서비스는 없습니다.',
    },
    studio: {
      eyebrow: 'LeankomStudio',
      title: '도구와 경험을 의도 있게 만듭니다.',
      lead: 'LeankomStudio는 소프트웨어와 게임을 함께 다룹니다. 사업 협력은 carrie@leankom.com으로 문의하세요.',
    },
    privacy: {
      eyebrow: '개인정보',
      title: '작은 사이트, 작은 데이터 흔적.',
      lead: '제3자 분석, 폼, 폰트 CDN을 사용하지 않습니다. 언어 설정 쿠키는 1년간 저장될 수 있습니다.',
    },
  },
  fr: {
    product: {
      eyebrow: 'Produit',
      title: 'Le texte brut, sans expérience rudimentaire.',
      lead: 'Ouvrez un dossier local, écrivez en Markdown et reliez vos idées par wiki-liens et liens retour. Vos fichiers restent à vous.',
    },
    download: {
      eyebrow: 'Preuve de publication',
      title: 'Aucun téléchargement n’est encore publié.',
      lead: 'La première version publique Windows x64 est en préparation. Le lien apparaîtra avec une GitHub Release réelle et vérifiable.',
      note: 'Le 15 août 2026 est une date de révision, pas une promesse de publication.',
    },
    themes: {
      eyebrow: 'Thèmes et extensions',
      title: 'Les fondations sont en cours.',
      lead: 'Aucun thème, plugin, prix ou achat n’est proposé aujourd’hui.',
      note: 'Les futures extensions préciseront compatibilité et limites de confiance.',
    },
    support: {
      eyebrow: 'Assistance',
      title: 'Parlez directement aux personnes qui créent JotLuck.',
      lead: 'Écrivez à official@leankom.com ou ouvrez un ticket GitHub.',
    },
    services: {
      eyebrow: 'Services',
      title: 'Aucune commande sur mesure pour le moment.',
      lead: 'Un support technique et des réalisations personnalisées pourront ouvrir plus tard. Aucun service payant n’est proposé actuellement.',
    },
    studio: {
      eyebrow: 'LeankomStudio',
      title: 'Des outils et des expériences conçus avec intention.',
      lead: 'LeankomStudio travaille entre logiciel et jeu. Pour une collaboration commerciale : carrie@leankom.com.',
    },
    privacy: {
      eyebrow: 'Confidentialité',
      title: 'Un petit site, avec une petite empreinte de données.',
      lead: 'Aucune analyse tierce, aucun formulaire et aucun CDN de polices. Un cookie fonctionnel de langue peut être conservé un an.',
    },
  },
};

export const localeMeta: Record<
  LocaleId,
  Pick<SiteContent, 'htmlLang' | 'domain' | 'localeLabel'>
> = {
  en: { htmlLang: 'en', domain: 'www.jotluck.com', localeLabel: 'English' },
  ja: { htmlLang: 'ja', domain: 'ja.jotluck.com', localeLabel: '日本語' },
  'zh-hans': { htmlLang: 'zh-Hans', domain: 'zh-hans.jotluck.com', localeLabel: '简体中文' },
  'zh-hant': { htmlLang: 'zh-Hant', domain: 'zh-hant.jotluck.com', localeLabel: '繁體中文' },
  ko: { htmlLang: 'ko', domain: 'ko.jotluck.com', localeLabel: '한국어' },
  fr: { htmlLang: 'fr', domain: 'fr.jotluck.com', localeLabel: 'Français' },
};

const languageShell: Record<
  LocaleId,
  Omit<SiteContent, 'pages' | 'htmlLang' | 'domain' | 'localeLabel' | 'locale'>
> = {
  en: {
    nav: { product: 'Product', download: 'Download', themes: 'Themes', support: 'Support' },
    common: {
      releaseProgress: 'View release progress',
      sourceCode: 'View source',
      prelaunch: 'In preparation',
      notAvailable: 'Not available yet',
      footerTruth: 'Local-first · Open source · No cloud lock-in',
      language: 'Language',
    },
    hero: {
      voice: 'Writing,',
      emphasis: 'made light.',
      releaseNote: 'First Windows x64 release under review · LeankomStudio',
    },
  },
  'zh-hans': {
    nav: { product: '产品', download: '下载', themes: '主题', support: '支持' },
    common: {
      releaseProgress: '查看发布进度',
      sourceCode: '查看源代码',
      prelaunch: '正在准备',
      notAvailable: '暂未开放',
      footerTruth: '本地优先 · 开源 · 不被云端锁定',
      language: '语言',
    },
    hero: {
      voice: '写作，本应',
      emphasis: '轻盈。',
      releaseNote: 'Windows x64 首个公开版本正在复核 · LeankomStudio',
    },
  },
  'zh-hant': {
    nav: { product: '產品', download: '下載', themes: '主題', support: '支援' },
    common: {
      releaseProgress: '查看發佈進度',
      sourceCode: '查看原始碼',
      prelaunch: '正在準備',
      notAvailable: '尚未開放',
      footerTruth: '本機優先 · 開源 · 不被雲端綁定',
      language: '語言',
    },
    hero: {
      voice: '寫作，本應',
      emphasis: '輕盈。',
      releaseNote: 'Windows x64 首個公開版本正在複核 · LeankomStudio',
    },
  },
  ja: {
    nav: { product: '製品', download: 'ダウンロード', themes: 'テーマ', support: 'サポート' },
    common: {
      releaseProgress: '公開状況を見る',
      sourceCode: 'ソースを見る',
      prelaunch: '準備中',
      notAvailable: '未公開',
      footerTruth: 'ローカル優先 · オープンソース · クラウド拘束なし',
      language: '言語',
    },
    hero: {
      voice: '書くことは、',
      emphasis: '軽やかに。',
      releaseNote: '最初の Windows x64 公開版を確認中 · LeankomStudio',
    },
  },
  ko: {
    nav: { product: '제품', download: '다운로드', themes: '테마', support: '지원' },
    common: {
      releaseProgress: '출시 진행 보기',
      sourceCode: '소스 보기',
      prelaunch: '준비 중',
      notAvailable: '아직 제공되지 않음',
      footerTruth: '로컬 우선 · 오픈 소스 · 클라우드 종속 없음',
      language: '언어',
    },
    hero: {
      voice: '글쓰기는,',
      emphasis: '가볍게.',
      releaseNote: '첫 Windows x64 공개 버전 검토 중 · LeankomStudio',
    },
  },
  fr: {
    nav: { product: 'Produit', download: 'Télécharger', themes: 'Thèmes', support: 'Assistance' },
    common: {
      releaseProgress: 'Voir la publication',
      sourceCode: 'Voir le code source',
      prelaunch: 'En préparation',
      notAvailable: 'Pas encore disponible',
      footerTruth: 'Local d’abord · Open source · Sans verrouillage cloud',
      language: 'Langue',
    },
    hero: {
      voice: 'Écrire,',
      emphasis: 'en légèreté.',
      releaseNote: 'Première version Windows x64 en révision · LeankomStudio',
    },
  },
};

export const siteContent = Object.fromEntries(
  (Object.keys(localeMeta) as LocaleId[]).map((locale) => [
    locale,
    { locale, ...localeMeta[locale], ...languageShell[locale], pages: sharedPages[locale] },
  ]),
) as Record<LocaleId, SiteContent>;
