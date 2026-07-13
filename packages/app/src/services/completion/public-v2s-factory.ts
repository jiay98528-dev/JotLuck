import { PUBLIC_V2S_ENGINE_ID, PUBLIC_V2S_MODEL_MAX_BYTES } from './public-v2s-binary';
import { createPublicV2sByteCache, type PublicV2sByteCache } from './public-v2s-cache';
import { PublicV2sEngine, type PublicV2sWorkerLike } from './public-v2s-engine';

export const PUBLIC_V2S_CANONICAL_MANIFEST_URL = '/autocomplete/autocomplete-public.manifest.json';
const PUBLIC_V2S_MANIFEST_SCHEMA = 'jotluck.autocomplete.public-model.v6';
const MAX_MANIFEST_BYTES = 256 * 1024;

interface CanonicalPublicV2sManifest {
  schema: typeof PUBLIC_V2S_MANIFEST_SCHEMA;
  schemaVersion: 6;
  engine: typeof PUBLIC_V2S_ENGINE_ID;
  releaseId: string;
  publishedAt: string;
  runtimeEligible: true;
  qualityGatePassed: true;
  releaseEligible: true;
  asset: {
    file: string;
    sha256: string;
    bytes: number;
    containerHeaderSha256: string;
  };
}

export interface CreateCanonicalPublicV2sEngineOptions {
  fetcher?: typeof fetch;
  workerFactory?: () => PublicV2sWorkerLike;
  byteCache?: PublicV2sByteCache | null;
}

/**
 * The only production constructor for the preinstalled public engine. It is
 * intentionally fail-closed and has no legacy-model fallback.
 */
export async function createCanonicalPublicV2sEngine(
  options: CreateCanonicalPublicV2sEngineOptions = {},
): Promise<PublicV2sEngine | null> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') return null;
  const byteCache =
    options.byteCache === undefined ? createPublicV2sByteCache() : options.byteCache;
  try {
    const loaded = await loadManifestBytes(fetcher, byteCache);
    if (!loaded) return null;
    const manifestBytes = loaded.bytes;
    if (manifestBytes.byteLength < 2 || manifestBytes.byteLength > MAX_MANIFEST_BYTES) return null;
    const manifest = parseCanonicalManifest(manifestBytes);
    if (loaded.network) {
      await byteCache?.write(PUBLIC_V2S_CANONICAL_MANIFEST_URL, manifestBytes, 'application/json');
    }
    return new PublicV2sEngine({
      modelUrl: `/autocomplete/${manifest.asset.file}`,
      expectedSha256: manifest.asset.sha256,
      expectedModelBytes: manifest.asset.bytes,
      expectedContainerHeaderSha256: manifest.asset.containerHeaderSha256,
      manifestBytes: manifestBytes.byteLength,
      profile: 'release',
      workerFactory: options.workerFactory,
    });
  } catch {
    return null;
  }
}

async function loadManifestBytes(
  fetcher: typeof fetch,
  byteCache: PublicV2sByteCache | null,
): Promise<{ bytes: Uint8Array; network: boolean } | null> {
  try {
    const response = await fetcher(PUBLIC_V2S_CANONICAL_MANIFEST_URL, {
      cache: 'no-cache',
      credentials: 'same-origin',
    });
    if (response.ok) {
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) return null;
      return { bytes: new Uint8Array(await response.arrayBuffer()), network: true };
    }
  } catch {
    // A verified cached manifest is the only permitted offline fallback.
  }
  const cached = await byteCache?.read(PUBLIC_V2S_CANONICAL_MANIFEST_URL);
  return cached ? { bytes: cached, network: false } : null;
}

function parseCanonicalManifest(bytes: Uint8Array): CanonicalPublicV2sManifest {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(decoded);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Public V2S manifest must be an object.');
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schema !== PUBLIC_V2S_MANIFEST_SCHEMA ||
    manifest.schemaVersion !== 6 ||
    manifest.engine !== PUBLIC_V2S_ENGINE_ID ||
    manifest.runtimeEligible !== true ||
    manifest.qualityGatePassed !== true ||
    manifest.releaseEligible !== true ||
    typeof manifest.releaseId !== 'string' ||
    !isSha256(manifest.releaseId) ||
    typeof manifest.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.publishedAt)) ||
    typeof manifest.asset !== 'object' ||
    manifest.asset === null ||
    Array.isArray(manifest.asset)
  ) {
    throw new Error('Public V2S manifest identity or eligibility is invalid.');
  }
  const asset = manifest.asset as Record<string, unknown>;
  if (
    typeof asset.sha256 !== 'string' ||
    !isSha256(asset.sha256) ||
    typeof asset.containerHeaderSha256 !== 'string' ||
    !isSha256(asset.containerHeaderSha256) ||
    asset.file !== `${PUBLIC_V2S_ENGINE_ID}.${asset.sha256}.bin` ||
    !Number.isSafeInteger(asset.bytes) ||
    (asset.bytes as number) < 1 ||
    (asset.bytes as number) > PUBLIC_V2S_MODEL_MAX_BYTES
  ) {
    throw new Error('Public V2S manifest asset binding is invalid.');
  }
  return manifest as unknown as CanonicalPublicV2sManifest;
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}
