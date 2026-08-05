import type { SiteContent } from './types';

/**
 * English master — translation source for ja/ko/fr drafts.
 * Any factual change (dates, platforms, capability bounds) must sync across all five locales.
 */
export const en: SiteContent = {
  meta: {
    title: 'JotLuck — Set words down, at ease',
    description:
      'A lightweight, local-first, offline-capable Markdown note tool. Every note is a plain-text file; every folder is a notebook.',
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
    action: 'Track the release',
    dateLine: 'Public Windows x64 build expected August 15, 2026',
    dateQuip: 'A conservative estimate; it may well land earlier.',
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
    title: 'The date is set.',
    lead: 'The first Windows x64 build arrives on August 15, 2026. macOS and Linux follow. Plain text never picks platforms, and your notes stay local files on every system.',
    statusLabel: 'First platform',
    statusValue: 'Windows x64',
    statusDate: '2026-08-15',
    statusQuip: 'A conservative estimate; it may well land earlier.',
    platformTitle: 'Platforms',
    platforms: [
      { name: 'Windows x64', state: 'First public build, 2026-08-15' },
      { name: 'macOS', state: 'Follows' },
      { name: 'Linux', state: 'Follows' },
    ],
    honestyTitle: 'On August 15, it ships.',
    honestyBody:
      'On release day, this page and GitHub Releases go live together with the finished installer — every copy you download is the verifiable, complete build.',
    countdownLabel: 'First public release in',
    countdownUnit: 'days',
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
    lead: 'A theme is more than a new coat of paint: it reshapes the workspace itself.',
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
      'Theme API v2 opens the whole workspace through slots, host APIs and .mltheme packs: deep customization, for people with singular ideas and an irrepressible urge to express.',
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
        'MarkLuck keeps plain-text freedom while offering live preview, backlinks and tag tidying.',
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
    action: 'carrie@leankom.com',
  },
  footer: {
    studio: 'LeankomStudio',
    tagline: 'Local-first · Open source · No cloud lock-in',
    copyright: '© 2026 Linghu Technology (Shenzhen) Co., Ltd.',
    links: { support: 'Support', privacy: 'Privacy', github: 'GitHub' },
  },
};
