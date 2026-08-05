import type { SiteContent } from './types';

/**
 * Français (fr) — traduction complète du texte source anglais. Le zh.ts (canon chinois) sert de référence de ton.
 * Les faits (dates, plateformes, limites de fonctionnalités) restent identiques dans les cinq langues.
 */
export const fr: SiteContent = {
  meta: {
    title: 'JotLuck — Posez les mots, en confiance',
    description:
      "Un outil de notes Markdown léger, local d'abord, utilisable hors ligne. Chaque note est un fichier texte brut ; chaque dossier est un carnet.",
  },
  localeName: 'Français',
  header: {
    nav: { home: 'Produit', download: 'Téléchargement', themes: 'Thèmes', studio: 'Studio' },
    langSelectorLabel: 'Choisir la langue',
  },
  hero: {
    eyebrow: "Notes Markdown, local d'abord",
    lines: ['Écrire devait être léger.'],
    emphasis: 'Commencez par un fichier.',
    subline:
      "Laissez l'écosystème logiciel au bord de la page. Tout ce que vous écrivez reste libre de voyager.",
    action: 'Suivre la sortie',
    dateLine: 'Version publique Windows x64 attendue le 15 août 2026',
    dateQuip: 'Une estimation prudente — elle pourrait bien arriver plus tôt.',
  },
  narrative: [
    {
      id: 'file',
      title: "Tout part d'un fichier.",
      body: "Pas de compte, pas de nouveau réceptacle pour vos mots. Ouvrez-le, et continuez d'écrire.",
      rail: ['Fichiers locaux', '.md', '.mdx', '.txt'],
    },
    {
      id: 'link',
      title: 'Laissez les notes se relier.',
      body: "Passez d'une phrase à une autre note, et voyez quelles idées pointent vers l'endroit où vous êtes.",
      rail: ['Liens Wiki', 'Rétroliens', 'Recherche plein texte', 'Étiquettes', 'Plan'],
    },
    {
      id: 'flow',
      title: "Ne laissez pas l'outil interrompre la ligne suivante.",
      body: "La page change doucement avec vos mots, offrant juste ce qu'il faut de poussée, seulement quand vous en avez besoin.",
      rail: [
        'Aperçu en direct',
        'Édition par blocs',
        "Complétion (chinois et anglais pour l'instant)",
      ],
    },
    {
      id: 'export',
      title: 'Quand vous posez le stylo, la route continue.',
      body: "Votre travail est libre d'aller partout.",
      rail: ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'HTML'],
    },
  ],
  multilingual: {
    eyebrow: 'Cinq langues',
    title: 'JotLuck parle désormais cinq langues.',
    body: "L'interface est entièrement localisée en 中文, 日本語, 한국어, English et Français — chaque menu, chaque ligne d'état, à sa place.",
    languages: ['中文', '日本語', '한국어', 'English', 'Français'],
    note: "La complétion de texte prend actuellement en charge le chinois et l'anglais ; d'autres langues suivront dans les prochaines versions.",
  },
  download: {
    eyebrow: 'Téléchargement',
    title: 'La date est fixée.',
    lead: 'La première version Windows x64 arrive le 15 août 2026. macOS et Linux suivront — le texte brut ne choisit jamais sa plateforme, et vos notes restent des fichiers locaux sur tous les systèmes.',
    statusLabel: 'Première plateforme',
    statusValue: 'Windows x64',
    statusDate: '2026-08-15',
    statusQuip: 'Une estimation prudente — elle pourrait bien arriver plus tôt.',
    platformTitle: 'Plateformes',
    platforms: [
      { name: 'Windows x64', state: 'Première version publique, 15 août 2026' },
      { name: 'macOS', state: 'Suivra' },
      { name: 'Linux', state: 'Suivra' },
    ],
    honestyTitle: "Le 15 août, c'est en ligne.",
    honestyBody:
      "Le jour de la sortie, cette page et GitHub Releases sont mis en ligne en même temps que l'installateur final — chaque copie que vous téléchargez est la version complète et vérifiable.",
    countdownLabel: 'Première sortie publique dans',
    countdownUnit: 'jours',
    notesTitle: 'À savoir',
    notes: [
      'Les notes vivent dans le dossier que vous choisissez — aucun compte requis',
      "Quatre extensions s'enregistrent comme gestionnaires « Ouvrir avec » facultatifs ; les paramètres par défaut du système restent intacts",
      "Sous licence MIT ; l'édition et la recherche essentielles fonctionnent entièrement hors ligne",
    ],
  },
  themes: {
    eyebrow: 'Thèmes',
    title: "L'espace où vous créez mérite lui aussi d'être façonné.",
    lead: "Un thème n'est pas qu'une nouvelle couche de peinture — il remodèle l'espace de travail lui-même.",
    items: [
      {
        id: 'paper',
        name: 'Paper',
        blurb:
          "Le thème par défaut. Tons de washi chauds, texte à l'encre, outils qui se retirent.",
      },
      {
        id: 'halo-canvas',
        name: 'Halo Canvas',
        blurb: 'Un canevas flottant ; signets et panneaux, chacun à sa place.',
      },
      {
        id: 'lumen-field',
        name: 'Lumen Field',
        blurb: 'Un champ sombre pour la concentration. Juste vous et le texte.',
      },
    ],
    blueprintTitle: 'Le système de thèmes',
    blueprintBody:
      "Theme API v2 ouvre tout l'espace de travail via des slots, des API hôtes et des packs .mltheme — une personnalisation profonde, pour les personnes aux idées singulières et à l'envie irrépressible de s'exprimer.",
    marketplaceNote: "Les thèmes sont livrés dans l'application, prêts à l'emploi dès l'ouverture.",
  },
  themePreview: {
    ui: {
      outline: 'Plan',
      backlinks: 'Rétroliens',
      tags: 'Étiquettes',
      noTags: 'Aucune étiquette',
      search: 'Rechercher',
      searchShortcut: 'Rechercher Ctrl+K',
      templates: 'Modèles',
      live: 'Instantanée',
      syntax: '? Syntaxe',
      unsaved: 'Non enregistré',
      saved: 'Enregistré',
      replay: 'Rejouer la démo',
      exportAction: 'Exporter',
      share: 'Partager',
      recent: 'Récent',
      clearFormat: 'Effacer la mise en forme',
      scratch: 'Brouillon temporaire',
      quote: 'Citation',
      body: 'Corps',
      ready: 'Ready',
    },
    sampleNote: {
      title: 'Exemple de note du thème',
      intro:
        "MarkLuck conserve la liberté du texte brut tout en offrant l'aperçu en direct, les rétroliens et le classement par étiquettes.",
      section: 'Rangement du jour',
      bullets: [
        "Ouvrez un dossier local et les notes rejoignent la liste récente d'elles-mêmes",
        'Utilisez [[Index du projet]] pour relier les documents associés',
        'Filtrez rapidement avec #research et #draft',
      ],
      quoteLine:
        "La surface d'écriture reste dégagée ; les outils apparaissent quand on en a besoin.",
      statusLeft:
        '152 caractères · 20 mots · Sélectionnez du texte pour le formater · Ctrl+clic pour épingler un bloc',
    },
    haloNote: {
      notebook: 'Carnet exemple',
      files: [
        'Exemple de note du thème',
        'Index du projet',
        'Notes de conception',
        'Exemples de mise en forme',
        "Liste d'idées",
      ],
      filePaths: [
        'exemple-note-theme.md',
        'index-projet.md',
        'notes-conception.md',
        'exemples-mise-en-forme.md',
        'liste-idees.md',
      ],
      typedBullet: 'Rassemblez la progression du jour avec [[Index du projet]]',
      frontmatterTitle: 'exemple-note-theme',
      frontmatterTags: ['research', 'draft'],
    },
  },
  studio: {
    eyebrow: 'Studio',
    title:
      'Laissez une idée franchir les catégories et trouver la forme qui lui convient le mieux.',
    lead: "JotLuck est la première page que nous déployons vers l'extérieur.",
    quote: "Certaines idées deviennent des outils. D'autres grandissent en mondes entiers.",
    body: 'Si vous avez une idée que vous ne pouvez pas lâcher, écrivez-nous.',
    action: 'carrie@leankom.com',
  },
  footer: {
    studio: 'LeankomStudio',
    tagline: "Local d'abord · Open source · Sans enfermement cloud",
    copyright: '© 2026 Linghu Technology (Shenzhen) Co., Ltd.',
    links: { support: 'Assistance', privacy: 'Confidentialité', github: 'GitHub' },
  },
};
