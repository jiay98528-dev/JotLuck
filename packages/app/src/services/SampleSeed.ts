import type { SupportedLocale } from '@/types';
import { getCurrentLocale, translateForLocale } from '@/i18n';

export interface SampleSeedFile {
  path: string;
  content: string;
}

export interface SampleNotebookSeed {
  directoryName: string;
  files: SampleSeedFile[];
}

export function createSampleNotebookSeed(
  locale: SupportedLocale = getCurrentLocale(),
): SampleNotebookSeed {
  const tr = (key: string, args?: Record<string, string | number>): string => {
    // i18n-dynamic-key: sample keys are the literal suffixes used in this seed factory.
    return translateForLocale(locale, `samples.${key}`, args);
  };
  const quick = tr('quickStartTitle');
  const formatting = tr('formattingTitle');
  const project = tr('projectTitle');
  const design = tr('designTitle');
  const subfolder = tr('subfolderName');
  const nested = tr('nestedTitle');

  return {
    directoryName: tr('notebookName'),
    files: [
      {
        path: `/${quick}.md`,
        content: `---
title: ${quick}
tags:
  - ${tr('gettingStartedTag')}
  - markdown
created: 2026-06-01
---

# ${tr('welcome')}

${tr('intro')}

## ${tr('start')}

${tr('startBody')}

- [[${formatting}]]
- [[${project}]]

## ${tr('filesAreData')}

${tr('filesBody')}
`,
      },
      {
        path: `/${formatting}.md`,
        content: `---
title: ${formatting}
tags:
  - markdown
  - ${tr('exampleTag')}
created: 2026-06-01
---

# ${formatting}

${tr('formattingBody')}

[[${quick}]]
`,
      },
      {
        path: `/${project}.md`,
        content: `---
title: ${project}
tags:
  - ${tr('planningTag')}
  - ${tr('projectTag')}
created: 2026-06-02
---

# ${project}

${tr('projectBody', { design })}
`,
      },
      {
        path: `/${design}.md`,
        content: `---
title: ${design}
tags:
  - ${tr('designTag')}
  - ${tr('writingTag')}
created: 2026-06-03
---

# ${design}

${tr('designBody')}

[[${quick}]] · [[${formatting}]]
`,
      },
      {
        path: `/${subfolder}/${nested}.md`,
        content: `# ${nested}

${tr('nestedBody')}

[[${quick}]]
`,
      },
    ],
  };
}
