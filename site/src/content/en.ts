import type { SiteContent } from './types';

/**
 * English master — translation source for ja/ko/fr drafts.
 * Any factual change (dates, platforms, capability bounds) must sync across all five locales.
 */
export const en: SiteContent = {
  meta: {
    title: 'JotLuck — Set words down · Local-first Markdown notes',
    description:
      'A lightweight, local-first, offline-capable Markdown note tool. Every note is a plain-text file; every folder is a notebook.',
    pageTitles: {
      download: 'Download · JotLuck — Local-first Markdown notes for Windows',
      themes: 'Themes · JotLuck — Local-first Markdown notes',
      studio: 'Studio · JotLuck — Local-first Markdown notes',
      privacy: 'Privacy · JotLuck — Local-first Markdown notes',
    },
    pageDescriptions: {
      download:
        'Download JotLuck for Windows x64: preview live now — unsigned, verify the SHA-256. A lightweight local-first Markdown note tool; every note a plain-text file.',
      themes:
        'JotLuck workspace themes — Paper, Halo Canvas and Lumen Field. Each theme reshapes the workspace itself, from paper and ink to window layout.',
      studio:
        'LeankomStudio helps ideas cross genres and find the shape that fits them best. JotLuck, a local-first Markdown note tool, is the first page we unfold outward.',
      privacy:
        'JotLuck privacy: notes stay plain-text files in your folder; fully offline — no account for writing, no telemetry, no cookies or analytics.',
    },
  },
  localeName: 'English',
  header: {
    nav: { home: 'Product', download: 'Download', themes: 'Themes', studio: 'Studio' },
    langSelectorLabel: 'Choose language',
  },
  hero: {
    eyebrow: 'Local-first Markdown notes',
    lines: ['Writing was', 'meant to feel', 'light.'],
    emphasis: 'Begin with a file.',
    subline:
      'Leave the software ecosystem at the edge of the page. Everything you write remains free to travel.',
    action: 'Download Preview',
    dateLine: 'Preview live now',
  },
  narrative: [
    {
      id: 'file',
      title: 'A file is where it begins.',
      body: 'No account, and no new container for your words. Open it and keep writing.',
      rail: ['Local files', '.md', '.mdx', '.txt'],
    },
    {
      id: 'link',
      title: 'Let notes connect.',
      body: 'Move from one sentence into another note, and see which ideas point back to where you are.',
      rail: ['Wiki links', 'Backlinks', 'Full-text search', 'Tags', 'Outline'],
    },
    {
      id: 'flow',
      title: "Don't let the tool interrupt the next line.",
      body: 'The page changes quietly with your words, offering just enough of a nudge, only when you need it.',
      rail: ['Live preview', 'Block editing', 'Completion (Chinese & English for now)'],
    },
    {
      id: 'export',
      title: 'When you set down the pen, the road goes on.',
      body: 'Your work is free to go anywhere.',
      rail: ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'HTML'],
    },
  ],
  multilingual: {
    eyebrow: 'Five languages',
    title: 'JotLuck now speaks five languages.',
    body: 'The interface is fully localized in 中文, 日本語, 한국어, English and Français: every menu, every status line, in place.',
    languages: ['中文', '日本語', '한국어', 'English', 'Français'],
    note: 'Text completion currently supports Chinese and English; more languages follow in later releases.',
  },
  download: {
    eyebrow: 'Download',
    title: 'Preview is live.',
    lead: 'The Windows x64 preview is ready to download now. macOS and Linux follow. Plain text never picks platforms, and your notes stay local files on every system.',
    statusLabel: 'First platform',
    statusValue: 'Windows x64',
    platformTitle: 'Platforms',
    platforms: [
      { name: 'Windows x64', state: 'Preview live' },
      { name: 'macOS', state: 'Follows' },
      { name: 'Linux', state: 'Follows' },
    ],
    honestyTitle: 'Preview first.',
    honestyBody:
      'The preview installer is already on GitHub Releases — downloadable, verifiable, reversible.',
    previewTitle: 'v0.12.3 Preview',
    downloadBtn: 'Download Preview (Windows x64)',
    githubBtn: 'GitHub',
    releaseBtn: 'Release notes & checksum',
    signNote:
      'This preview is unsigned: Windows SmartScreen may warn. Verify the SHA-256 against the Release page before installing.',
    signPolicyLink: 'Code signing policy',
    notesTitle: 'Worth knowing',
    notes: [
      'Notes live in the folder you choose — no account required',
      "Four extensions register as optional 'Open with' handlers; system defaults stay untouched",
      'MIT licensed; core editing and search run fully offline',
    ],
  },
  themes: {
    eyebrow: 'Themes',
    title: 'The space you create in deserves to be shaped, too.',
    lead: 'A theme reshapes the workspace itself, from paper and ink to window layout.',
    items: [
      {
        id: 'paper',
        name: 'Paper',
        blurb: 'The default. Warm washi tones, ink text, tools stepping back.',
      },
      {
        id: 'halo-canvas',
        name: 'Halo Canvas',
        blurb: 'A floating canvas layout; bookmarks and panels each in their place.',
      },
      {
        id: 'lumen-field',
        name: 'Lumen Field',
        blurb: 'A dark field for focus. Just you and the text.',
      },
    ],
    blueprintTitle: 'The theme system',
    blueprintBody:
      'The theme system opens the whole workspace to deep customization — layout, panels and the paper-and-ink feel can all be reshaped, for people with singular ideas and an irrepressible urge to express.',
    marketplaceNote: 'Themes ship built into the app, ready out of the box.',
  },
  themePreview: {
    ui: {
      outline: 'Outline',
      backlinks: 'Backlinks',
      tags: 'Tags',
      noTags: 'No tags',
      search: 'Search',
      searchShortcut: 'Search Ctrl+K',
      templates: 'Templates',
      live: 'Live',
      syntax: '? Syntax',
      unsaved: 'Unsaved',
      saved: 'Saved',
      replay: 'Replay the demo',
      exportAction: 'Export',
      share: 'Share',
      recent: 'Recent',
      clearFormat: 'Clear',
      scratch: 'Scratch',
      quote: 'Quote',
      body: 'Body',
      ready: 'Ready',
    },
    sampleNote: {
      title: 'Theme sample note',
      intro:
        'JotLuck keeps plain-text freedom while offering live preview, backlinks and tag tidying.',
      section: "Today's tidy-up",
      bullets: [
        'Open a local folder and notes join the recent list on their own',
        'Use [[Project index]] to connect related material',
        'Filter quickly with #research and #draft',
      ],
      quoteLine: 'The writing surface stays clear; tools appear when needed.',
      statusLeft: '152 chars · 20 words · Format the selection · Ctrl+click pins a block',
    },
    haloNote: {
      notebook: 'Sample notebook',
      files: ['Theme sample note', 'Project index', 'Design notes', 'Format examples', 'Idea list'],
      filePaths: [
        'theme-sample-note.md',
        'project-index.md',
        'design-notes.md',
        'format-examples.md',
        'idea-list.md',
      ],
      typedBullet: 'Pull today’s progress together with [[Project index]]',
      frontmatterTitle: 'theme-sample-note',
      frontmatterTags: ['research', 'draft'],
    },
  },
  studio: {
    eyebrow: 'Studio',
    title: 'Let an idea cross categories and find the form that suits it best.',
    lead: 'JotLuck is the first page we unfold outward.',
    quote: 'Some ideas become tools. Others grow into whole worlds.',
    body: 'If you have an idea you cannot put down, write to us.',
    action: 'carriechan@leankom.com',
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Your work was meant to be yours.',
    lead: 'JotLuck is local-first and offline: no account needed for writing, no telemetry, and no server holding user data that could ever leak.',
    sections: [
      {
        title: "We don't touch your notes",
        body: 'The JotLuck desktop app runs fully offline: no telemetry, no note content uploaded, no usage statistics. The way we handle your notes is by never touching them in the first place. When the theme store launches, it will need an email account solely to deliver the digital assets you buy. It holds only your email address and purchase records, and has nothing to do with your notes.',
      },
      {
        title: 'Your notes live only in your folder',
        body: 'Every note is a plain-text Markdown file in a local folder you choose. Backup, sync and deletion are entirely yours to decide — JotLuck holds no copies.',
      },
      {
        title: "We don't track your visit",
        body: 'This site is static: no cookies, no analytics or tracking scripts, and all fonts and assets are self-hosted. Visiting it means reading a few files — nothing more.',
      },
      {
        title: 'Downloads and GitHub',
        body: "Installers are published via GitHub. Your visits on GitHub are covered by GitHub's own privacy policy; JotLuck receives none of your information from that channel.",
      },
    ],
    contactTitle: 'Questions? Write to us',
    contactBody: 'Any privacy question or concern — email us directly and we will reply in person.',
  },
  footer: {
    studio: 'LeankomStudio',
    tagline: 'Local-first · Open source · No cloud lock-in',
    copyright: '© 2026 Linghu Technology (Shenzhen) Co., Ltd.',
    links: {
      support: 'Support',
      privacy: 'Privacy',
      signing: 'Code signing policy',
      github: 'GitHub',
    },
  },
};
