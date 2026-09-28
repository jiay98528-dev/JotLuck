import {
  updateDocumentAsync,
  extractWikiLinkOccurrences,
  type DocumentAst,
} from '@jotluck/renderer/analysis';
import { preparePreviewFragments } from '@jotluck/renderer/progressive';

let revision = 0;
let job = 0;
let previous: DocumentAst | null = null;
const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          revision: number;
          source?: string;
          cancel?: boolean;
          preview?: boolean;
        }>,
      ) => void)
    | null;
  postMessage: (result: unknown) => void;
};

scope.onmessage = ({ data }) => {
  revision = data.revision;
  const currentJob = ++job;
  if (data.cancel || data.source === undefined) {
    previous = null;
    return;
  }
  void analyze(data.source, data.revision, !!data.preview, currentJob);
};

async function analyze(
  source: string,
  request: number,
  preview: boolean,
  currentJob: number,
): Promise<void> {
  try {
    const ast =
      previous?.source === source
        ? previous
        : await updateDocumentAsync(
            previous,
            source,
            () => request !== revision || currentJob !== job,
          );
    if (request !== revision || currentJob !== job) return;
    previous = ast;
    let wordCount = 0;
    const words = /\S+/g;
    while (words.exec(source)) wordCount++;
    scope.postMessage({
      revision: request,
      ast,
      wordCount,
      wikiLinks: extractWikiLinkOccurrences(ast),
    });
    if (preview) {
      await preparePreviewFragments(
        source,
        () => request !== revision || currentJob !== job,
        (fragments, complete) => {
          if (request === revision && currentJob === job)
            scope.postMessage({ revision: request, fragments, append: true, complete });
        },
      );
    }
  } catch (error) {
    if (request === revision && currentJob === job)
      scope.postMessage({ revision: request, error: String(error) });
  }
}
