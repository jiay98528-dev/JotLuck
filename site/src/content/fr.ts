import type { SiteContent } from './types';

/**
 * Français (fr) — traduction complète du texte source anglais. Le zh.ts (canon chinois) sert de référence de ton.
 * Les faits (dates, plateformes, limites de fonctionnalités) restent identiques dans les cinq langues.
 */
export const fr: SiteContent = {
  meta: {
    title: "JotLuck — Écrire en paix · Notes Markdown, local d'abord",
    description:
      "Un outil de notes Markdown léger, local d'abord, utilisable hors ligne. Chaque note est un fichier texte brut ; chaque dossier est un carnet.",
    pageTitles: {
      download: 'Téléchargement · JotLuck — Notes Markdown locales (Windows)',
      themes: "Thèmes · JotLuck — Notes Markdown, local d'abord",
      studio: "Studio · JotLuck — Notes Markdown, local d'abord",
      privacy: "Confidentialité · JotLuck — Notes Markdown, local d'abord",
    },
    pageDescriptions: {
      download:
        'Télécharger JotLuck Windows x64 : Preview est disponible ; version signée le 15 août 2026. Un outil de notes Markdown — chaque note est un fichier texte brut.',
      themes:
        "Les thèmes de JotLuck — Paper, Halo Canvas et Lumen Field. Chaque thème remodèle l'espace de travail, du papier et de l'encre à la disposition des fenêtres.",
      studio:
        "LeankomStudio aide les idées à traverser les genres et à trouver la forme qui leur convient. JotLuck, l'outil de notes Markdown local, est notre première page.",
      privacy:
        'JotLuck — vie privée : notes en fichiers texte dans votre dossier ; app 100 % hors ligne — pas de compte pour écrire, pas de télémétrie, ni cookies ni analyse.',
    },
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
    action: 'Télécharger maintenant',
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
    title: 'La Preview est en ligne.',
    lead: 'La Preview Windows x64 est prête à télécharger dès maintenant ; la version signée arrive le 15 août 2026. macOS et Linux suivront — le texte brut ne choisit jamais sa plateforme, et vos notes restent des fichiers locaux sur tous les systèmes.',
    statusLabel: 'Première plateforme',
    statusValue: 'Windows x64',
    statusDate: '2026-08-15',
    statusQuip:
      "Une estimation prudente — elle pourrait bien arriver plus tôt. La Preview l'a prouvé.",
    platformTitle: 'Plateformes',
    platforms: [
      { name: 'Windows x64', state: 'Preview en ligne · version signée 2026-08-15' },
      { name: 'macOS', state: 'Suivra' },
      { name: 'Linux', state: 'Suivra' },
    ],
    honestyTitle: "La Preview d'abord. La version signée le 15 août.",
    honestyBody:
      "L'installateur Preview est déjà sur GitHub Releases — téléchargeable, vérifiable, réversible. La version signée arrivera sur cette page et sur Releases le 15 août, chaque copie toujours complète et vérifiable.",
    countdownLabel: 'Version signée dans',
    countdownUnit: 'jours',
    previewTitle: 'v0.11.0 Preview',
    downloadBtn: 'Télécharger la Preview (Windows x64)',
    releaseBtn: 'Notes de version et checksum',
    signNote:
      "Cette Preview n'est pas signée : Windows SmartScreen peut afficher un avertissement. Vérifiez que le SHA-256 correspond à la page Release avant d'installer.",
    signPolicyLink: 'Politique de signature de code',
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
    lead: "Un thème remodèle l'espace de travail lui-même, de la couleur du papier et de l'encre à la disposition des fenêtres.",
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
      "Le système de thèmes ouvre tout l'espace de travail à une personnalisation profonde — disposition, panneaux et texture du papier et de l'encre peuvent tous être remodelés, pour les personnes aux idées singulières et à l'envie irrépressible de s'exprimer.",
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
        "JotLuck conserve la liberté du texte brut tout en offrant l'aperçu en direct, les rétroliens et le classement par étiquettes.",
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
    action: 'carriechan@leankom.com',
  },
  privacy: {
    eyebrow: 'Confidentialité',
    title: 'Votre travail était censé vous appartenir.',
    lead: "JotLuck est un outil local d'abord, hors ligne : pas de compte pour écrire, pas de télémétrie, et aucun serveur qui détienne vos données et puisse les laisser fuir.",
    sections: [
      {
        title: 'Nous ne touchons pas à vos notes',
        body: "L'application de bureau JotLuck fonctionne entièrement hors ligne : pas de télémétrie, aucun contenu de note envoyé, aucune statistique d'usage. Notre façon de traiter vos notes est de ne jamais y toucher. Quand la boutique de thèmes ouvrira, un compte e-mail sera nécessaire, uniquement pour livrer les contenus numériques que vous achetez. Il ne conserve que votre adresse e-mail et vos achats, et n'a rien à voir avec vos notes.",
      },
      {
        title: 'Vos notes vivent uniquement dans votre dossier',
        body: 'Chaque note est un fichier Markdown en texte brut, dans un dossier local que vous choisissez. Sauvegarde, synchronisation et suppression vous appartiennent entièrement — JotLuck ne conserve aucune copie.',
      },
      {
        title: 'Nous ne suivons pas votre visite',
        body: "Ce site est statique : pas de cookies, pas de scripts d'analyse ni de suivi, et toutes les polices et ressources sont hébergées localement. Le visiter, c'est lire quelques fichiers — rien de plus.",
      },
      {
        title: 'Téléchargements et GitHub',
        body: 'Les installateurs sont publiés via GitHub. Vos visites sur GitHub relèvent de la politique de confidentialité de GitHub ; JotLuck ne reçoit aucune de vos informations par ce canal.',
      },
    ],
    contactTitle: 'Une question ? Écrivez-nous',
    contactBody:
      'Toute question ou préoccupation concernant la vie privée — écrivez-nous directement et nous répondrons sérieusement.',
  },
  footer: {
    studio: 'LeankomStudio',
    tagline: "Local d'abord · Open source · Sans enfermement cloud",
    copyright: '© 2026 Linghu Technology (Shenzhen) Co., Ltd.',
    links: { support: 'Assistance', privacy: 'Confidentialité', github: 'GitHub' },
  },
};
