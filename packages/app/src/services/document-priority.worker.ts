import { preparePreviewFragments } from '@jotluck/renderer/progressive';

let job = 0;
self.onmessage = ({
  data,
}: MessageEvent<{
  job: number;
  revision: number;
  source?: string;
  from: number;
  definitions: string;
  headings: string[];
}>) => {
  job = data.job;
  if (data.source === undefined) return;
  void (async () => {
    try {
      const source = data.source!;
      const fragments = await preparePreviewFragments(
        source + '\n\n' + data.definitions,
        () => job !== data.job,
      );
      if (job !== data.job) return;
      let heading = 0;
      const result = fragments
        .filter((part) => part.from < source.length)
        .map((part) => {
          const ids = part.headings.map((id) => data.headings[heading++] ?? id);
          let index = 0;
          return {
            ...part,
            from: part.from + data.from,
            to: Math.min(part.to, source.length) + data.from,
            headings: ids,
            html: part.html.replace(
              /(<h[1-6] id=")[^"]*(")/g,
              (_match, start: string, end: string) => start + ids[index++] + end,
            ),
          };
        });
      self.postMessage({ job: data.job, revision: data.revision, fragments: result });
    } catch {
      /* Keep the last valid view. The normal renderer and its retry remain available. */
    }
  })();
};
