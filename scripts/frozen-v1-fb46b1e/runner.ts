import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

interface RunnerCheckpoint {
  id: string;
  cursorOffset: number;
  expectedSuffix: string;
  expectedBehavior: 'complete' | 'silence';
}

interface RunnerCase {
  id: string;
  language: 'zh' | 'en';
  text: string;
  checkpoints: RunnerCheckpoint[];
  supportDocuments?: Array<{ id: string; path: string; text: string }>;
}

interface RunnerInput {
  schemaVersion: 1;
  holdout: {
    schemaVersion: number;
    datasetId: string;
    cases: RunnerCase[];
  };
}

interface ObservedCandidate {
  text: string;
  confidence: number;
  from: number;
  providerId: string;
  sourceLayer?: string;
  syntaxType: string;
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as RunnerInput;
  if (input.schemaVersion !== 1 || !Array.isArray(input.holdout?.cases)) {
    throw new Error('Frozen V1 runner input is invalid.');
  }

  const root = dirname(fileURLToPath(import.meta.url));
  const compressed = readFileSync(join(root, 'model.compact.txt.gz'));
  const serialized = gunzipSync(compressed).toString('utf8');
  const modelSha256 = sha256(serialized);
  if (modelSha256 !== '1ab73f76357dc1e383990103aead0908213c042443cd541b906f3814d53882f5') {
    throw new Error(`Frozen V1 model SHA mismatch: ${modelSha256}.`);
  }

  Object.assign(globalThis, {
    localStorage: new MemoryStorage(),
    fetch: async () => ({ ok: true, text: async () => serialized }),
  });

  const { MarkdownPredictor } = await import('./src/services/MarkdownPredictor');
  const { deserialize } = await import('./src/utils/ngram-engine');
  const predictor = new MarkdownPredictor(4);
  predictor.configure({ backgroundTraining: false });
  // Inject the verified frozen model directly. This avoids Vite-only
  // import.meta.env URL selection while preserving the exact predictor,
  // provider and resolver behavior under evaluation.
  (predictor as unknown as { l3: ReturnType<typeof deserialize> }).l3 = deserialize(serialized);

  let observed: ObservedCandidate[] = [];
  (
    globalThis as typeof globalThis & {
      __JOTLUCK_FROZEN_V1_OBSERVER__?: (items: ObservedCandidate[]) => void;
    }
  ).__JOTLUCK_FROZEN_V1_OBSERVER__ = (items) => {
    observed = items.map((item) => ({ ...item }));
  };

  const checkpoints = [];
  for (const document of input.holdout.cases) {
    for (const checkpoint of document.checkpoints) {
      const prefix = document.text.slice(0, checkpoint.cursorOffset);

      predictor.clearLearningData();
      predictor.setAblationMode('l3-only');
      observed = [];
      const l3StartedAt = performance.now();
      const l3 = predictor.getGhostText(prefix.length, prefix);
      const l3LatencyMs = performance.now() - l3StartedAt;
      const l3Ranked = observed.filter((candidate) => candidate.sourceLayer === 'l3').slice(0, 8);

      predictor.clearLearningData();
      for (const support of document.supportDocuments ?? []) {
        predictor.ingestDocument(support.path, support.text, false);
      }
      predictor.setAblationMode('full-stack');
      observed = [];
      const fullStartedAt = performance.now();
      const full = predictor.getGhostText(prefix.length, prefix);
      const fullLatencyMs = performance.now() - fullStartedAt;
      const rankedCandidates = observed.slice(0, 8);

      checkpoints.push({
        checkpointId: checkpoint.id,
        behavior: checkpoint.expectedBehavior,
        expectedSuffix: checkpoint.expectedSuffix,
        language: document.language,
        l3LatencyMs,
        fullLatencyMs,
        l3Suggestion: l3?.text ?? '',
        l3ContextHit: l3Ranked.length > 0,
        l3Ranked,
        fullSuggestion: full?.text ?? '',
        fullProvider: full?.providerId ?? '',
        fullLayer: full?.sourceLayer ?? '',
        rankedCandidates,
      });
    }
  }

  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      runnerId: 'v1-frozen-fb46b1e-independent-runner-v2',
      modelSha256,
      modelBytes: Buffer.byteLength(serialized, 'utf8'),
      holdoutId: input.holdout.datasetId,
      checkpoints,
    }),
  );
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      value += chunk;
    });
    process.stdin.on('end', () => resolve(value));
    process.stdin.on('error', reject);
  });
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
