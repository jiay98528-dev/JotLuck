import type { SiteContent } from './types';

/**
 * 한국어（ko）— 영문 원고의 전체 번역. 어조는 zh.ts（중국어 정전）을 참조.
 * 사실성 내용(날짜·플랫폼·기능 경계)은 다섯 언어에서 일치시킨다.
 */
export const ko: SiteContent = {
  meta: {
    title: 'JotLuck — 마음 편히 적어내려가다 · 로컬 우선 Markdown 노트',
    description:
      '가볍고, 로컬 우선이며, 오프라인에서도 쓸 수 있는 Markdown 노트 도구입니다. 모든 노트는 순수 텍스트 파일이고, 폴더가 곧 노트북입니다.',
    pageTitles: {
      download: '다운로드 · JotLuck — 로컬 우선 Markdown 노트（Windows）',
      themes: '테마 · JotLuck — 로컬 우선 Markdown 노트',
      studio: '스튜디오 · JotLuck — 로컬 우선 Markdown 노트',
    },
    pageDescriptions: {
      download:
        'Windows x64용 JotLuck을 다운로드하세요. 가볍고 로컬 우선이며 오프라인에서도 쓸 수 있는 Markdown 노트 도구입니다. 모든 노트는 순수 텍스트 파일이고, 폴더가 곧 노트북입니다. 첫 공개 버전은 2026년 8월 15일 출시 예정입니다.',
      themes:
        'JotLuck 작업 공간 테마——Paper, Halo Canvas, Lumen Field 세 가지. 테마는 단순한 페인트칠 이상으로, 작업 공간 자체를 다시 만듭니다.',
      studio:
        'LeankomStudio는 鸰湖科技의 제품 스튜디오입니다. 아이디어가 범주를 넘어, 가장 잘 어울리는 형태를 만나게 하세요——JotLuck은 우리가 바깥으로 펼쳐 낸 첫 번째 페이지입니다.',
    },
  },
  localeName: '한국어',
  header: {
    nav: { home: '제품', download: '다운로드', themes: '테마', studio: '스튜디오' },
    langSelectorLabel: '언어 선택',
  },
  hero: {
    eyebrow: '로컬 우선 Markdown 노트',
    lines: ['글쓰기는 본래', '가벼워야 했다.'],
    emphasis: '파일 하나에서 시작합니다.',
    subline:
      '소프트웨어 생태계는 페이지 바깥에 두세요. 당신이 쓴 모든 것은 어디든 자유롭게 떠날 수 있습니다.',
    action: '출시 상황 보기',
    dateLine: 'Windows x64 공개 버전은 2026년 8월 15일 출시 예정입니다.',
    dateQuip: '보수적인 추정입니다——어쩌면 더 일찍 나올지도 몰라요.',
  },
  narrative: [
    {
      id: 'file',
      title: '모든 것은 파일에서 시작됩니다.',
      body: '계정이 필요 없고, 글을 담을 새로운 그릇도 없습니다. 열고, 계속 쓰면 됩니다.',
      rail: ['로컬 파일', '.md', '.mdx', '.txt'],
    },
    {
      id: 'link',
      title: '노트를 서로 잇습니다.',
      body: '한 문장에서 다른 노트로 옮겨 가며, 어떤 생각이 지금 서 있는 곳을 다시 가리키는지 볼 수 있습니다.',
      rail: ['Wiki 링크', '백링크', '전체 텍스트 검색', '태그', '개요'],
    },
    {
      id: 'flow',
      title: '도구가 다음 줄을 방해하지 않게.',
      body: '페이지는 당신의 글에 맞춰 조용히 변화하고, 필요할 때만 아주 적당한 힌트를 건넵니다.',
      rail: ['실시간 미리보기', '블록 편집', '글자 완성(현재는 중국어와 영어 지원)'],
    },
    {
      id: 'export',
      title: '펜을 내려놓아도, 길은 계속됩니다.',
      body: '당신의 작업물은 어디든 자유롭게 갈 수 있습니다.',
      rail: ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'HTML'],
    },
  ],
  multilingual: {
    eyebrow: '다섯 가지 언어',
    title: 'JotLuck은 이제 다섯 가지 언어로 말합니다.',
    body: '인터페이스는 中文, 日本語, 한국어, English, Français 다섯 언어로 완전히 현지화되어 있습니다——메뉴 하나, 상태 표시줄 하나까지 모두 제자리에 있습니다.',
    languages: ['中文', '日本語', '한국어', 'English', 'Français'],
    note: '글자 완성은 현재 중국어와 영어를 지원하며, 더 많은 언어는 이후 릴리스에서 추가됩니다.',
  },
  download: {
    eyebrow: '다운로드',
    title: '출시일자가 정해졌습니다.',
    lead: '첫 번째 Windows x64 빌드는 2026년 8월 15일에 출시됩니다. macOS와 Linux도 뒤따릅니다——순수 텍스트는 플랫폼을 가리지 않으며, 당신의 노트는 어떤 시스템에서도 로컬 파일로 남습니다.',
    statusLabel: '첫 번째 플랫폼',
    statusValue: 'Windows x64',
    statusDate: '2026-08-15',
    statusQuip: '보수적인 추정입니다——어쩌면 더 일찍 나올지도 몰라요.',
    platformTitle: '플랫폼',
    platforms: [
      { name: 'Windows x64', state: '2026년 8월 15일 첫 공개 빌드' },
      { name: 'macOS', state: '이어서 출시' },
      { name: 'Linux', state: '이어서 출시' },
    ],
    honestyTitle: '8월 15일에 공개됩니다.',
    honestyBody:
      '공개 당일, 이 페이지와 GitHub Releases가 완성된 설치 파일과 함께 동시 공개됩니다. 다운로드하시는 모든 복사본은 검증된 완전한 빌드입니다.',
    countdownLabel: '첫 공개까지',
    countdownUnit: '일',
    notesTitle: '알아 두면 좋은 것',
    notes: [
      '노트는 당신이 고른 폴더에 저장됩니다——계정이 필요 없습니다',
      "네 가지 확장자가 선택적인 '연결 프로그램' 처리기로만 등록됩니다. 시스템 기본값은 건드리지 않습니다",
      'MIT 라이선스로 공개되며, 핵심 편집과 검색은 완전히 오프라인에서 동작합니다',
    ],
  },
  themes: {
    eyebrow: '테마',
    title: '작업하는 공간도, 다듬을 가치가 있습니다.',
    lead: '테마는 단순한 페인트칠 이상입니다——작업 공간 자체를 다시 만듭니다.',
    items: [
      {
        id: 'paper',
        name: 'Paper',
        blurb: '기본 테마. 따뜻한 와시 톤, 먹색 글자, 한 걸음 물러서는 도구들.',
      },
      {
        id: 'halo-canvas',
        name: 'Halo Canvas',
        blurb: '떠 있는 캔버스 레이아웃. 북마크와 패널이 각자의 자리에.',
      },
      {
        id: 'lumen-field',
        name: 'Lumen Field',
        blurb: '집중을 위한 어두운 들판. 당신과 텍스트만.',
      },
    ],
    blueprintTitle: '테마 시스템',
    blueprintBody:
      'Theme API v2는 슬롯, 호스트 API, .mltheme 팩을 통해 작업 공간 전체를 엽니다——남다른 아이디어와 표현하고 싶은 참을 수 없는 충동을 가진 사람을 위한 깊은 맞춤화입니다.',
    marketplaceNote: '테마는 앱에 함께 포함되어 있으며, 설치 직후 바로 사용할 수 있습니다.',
  },
  themePreview: {
    ui: {
      outline: '개요',
      backlinks: '백링크',
      tags: '태그',
      noTags: '태그 없음',
      search: '검색',
      searchShortcut: '검색 Ctrl+K',
      templates: '템플릿',
      live: '실시간',
      syntax: '? 문법',
      unsaved: '저장되지 않음',
      saved: '저장됨',
      replay: '데모 다시 보기',
      exportAction: '내보내기',
      share: '공유',
      recent: '최근',
      clearFormat: '서식 지우기',
      scratch: '임시 초안',
      quote: '인용',
      body: '본문',
      ready: 'Ready',
    },
    sampleNote: {
      title: '테마 샘플 노트',
      intro:
        'JotLuck은 순수 텍스트 파일의 자유를 지키면서 실시간 미리보기, 백링크와 태그 정리를 제공합니다.',
      section: '오늘의 정리',
      bullets: [
        '로컬 폴더를 열면 노트가 자동으로 최근 목록에 올라옵니다',
        '[[프로젝트 색인]]으로 관련 자료를 연결하세요',
        '#research와 #draft로 빠르게 필터링하세요',
      ],
      quoteLine: '글쓰기 면은 깔끔하게, 도구는 필요할 때 나타납니다.',
      statusLeft: '152자 · 20단어 · 텍스트를 선택해 서식 지정 · Ctrl+클릭으로 블록 고정',
    },
    haloNote: {
      notebook: '샘플 노트북',
      files: ['테마 샘플 노트', '프로젝트 색인', '디자인 노트', '서식 예제', '아이디어 목록'],
      filePaths: [
        '테마 샘플 노트.md',
        '프로젝트 색인.md',
        '디자인 노트.md',
        '서식 예제.md',
        '아이디어 목록.md',
      ],
      typedBullet: '오늘의 진행 상황을 [[프로젝트 색인]]으로 한데 모으세요',
      frontmatterTitle: '테마 샘플 노트',
      frontmatterTags: ['research', 'draft'],
    },
  },
  studio: {
    eyebrow: '스튜디오',
    title: '아이디어가 범주를 넘어, 가장 잘 어울리는 형태를 만나게 하세요.',
    lead: 'JotLuck은 우리가 바깥으로 펼쳐 낸 첫 번째 페이지입니다.',
    quote: '어떤 아이디어는 도구가 됩니다. 다른 것들은 온전한 세계로 자랍니다.',
    body: '내려놓을 수 없는 아이디어가 있다면, 편지를 보내 주세요.',
    action: 'carrie@leankom.com',
  },
  footer: {
    studio: 'LeankomStudio',
    tagline: '로컬 우선 · 오픈소스 · 클라우드 종속 없음',
    copyright: '© 2026 Linghu Technology (Shenzhen) Co., Ltd.',
    links: { support: '지원', privacy: '개인정보', github: 'GitHub' },
  },
};
