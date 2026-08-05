import { isDesktopRuntime } from '@/utils/runtime';
import {
  parsePublicFreeDecoderManifest,
  type PublicFreeDecoderManifest,
} from './public-free-decoder-contract';
import {
  PublicFreeDecoderEngine,
  type PublicFreeDecoderTauriAdapter,
} from './public-free-decoder-engine';

export const PUBLIC_FREE_DECODER_CACHE_NAME = 'jotluck-public-v2-free-decoder-v1';
export const PUBLIC_FREE_DECODER_EXPERIMENT_FLAG = 'VITE_AUTOCOMPLETE_PUBLIC_FREE_DECODER';
export const PUBLIC_FREE_DECODER_CANONICAL_MANIFEST_URL =
  '/autocomplete/autocomplete-public.manifest.json';
const MAX_MANIFEST_BYTES = 256 * 1024;

export interface CreatePublicFreeDecoderEvaluationEngineOptions {
  manifestUrl: string;
  manifestPath: string;
  fetcher?: typeof fetch;
  adapter?: PublicFreeDecoderTauriAdapter;
  profile?: string;
}

export interface CreateCanonicalPublicFreeDecoderEngineOptions {
  fetcher?: typeof fetch;
  adapter?: PublicFreeDecoderTauriAdapter;
  manifestPath?: string;
}

/**
 * Evaluation-only constructor. The production application never calls this
 * unless an explicit dev/E2E build flag and a candidate manifest path exist.
 */
export async function createPublicFreeDecoderEvaluationEngine(
  options: CreatePublicFreeDecoderEvaluationEngineOptions,
): Promise<PublicFreeDecoderEngine | null> {
  if (!options.manifestPath || !options.manifestUrl) return null;
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') return null;
  try {
    const response = await fetcher(options.manifestUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 2 || bytes.byteLength > MAX_MANIFEST_BYTES) return null;
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const manifest = parsePublicFreeDecoderManifest(value, bytes.byteLength);
    if (!manifest.evaluationOnly || manifest.releaseEligible) return null;
    return new PublicFreeDecoderEngine({
      manifest,
      manifestPath: options.manifestPath,
      manifestBytes: bytes.byteLength,
      profile: options.profile ?? 'evaluation',
      adapter: options.adapter,
    });
  } catch {
    return null;
  }
}

/** Release constructor. It remains unused until the dual finals and GUI gate publish a manifest. */
export async function createCanonicalPublicFreeDecoderEngine(
  options: CreateCanonicalPublicFreeDecoderEngineOptions = {},
): Promise<PublicFreeDecoderEngine | null> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') return null;
  try {
    const response = await fetcher(PUBLIC_FREE_DECODER_CANONICAL_MANIFEST_URL, {
      cache: 'no-cache',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 2 || bytes.byteLength > MAX_MANIFEST_BYTES) return null;
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const manifest = parsePublicFreeDecoderManifest(value, bytes.byteLength);
    if (manifest.evaluationOnly || !manifest.releaseEligible) return null;
    return new PublicFreeDecoderEngine({
      manifest,
      manifestPath: options.manifestPath ?? '@canonical',
      manifestBytes: bytes.byteLength,
      profile: 'release',
      adapter: options.adapter,
    });
  } catch {
    return null;
  }
}

export async function createFlaggedPublicFreeDecoderEngine(
  environment: Record<string, string | boolean | undefined> = import.meta.env,
): Promise<PublicFreeDecoderEngine | null> {
  if (!isPublicFreeDecoderEvaluationEnvironment(environment)) return null;
  const mode = String(environment.MODE ?? '');
  const manifestUrl = String(environment.VITE_AUTOCOMPLETE_PUBLIC_FREE_MANIFEST_URL ?? '');
  const manifestPath = String(environment.VITE_AUTOCOMPLETE_PUBLIC_FREE_MANIFEST_PATH ?? '');
  return createPublicFreeDecoderEvaluationEngine({ manifestUrl, manifestPath, profile: mode });
}

export function isPublicFreeDecoderEvaluationEnvironment(
  environment: Record<string, string | boolean | undefined>,
  desktopRuntime = isDesktopRuntime(),
): boolean {
  return (
    desktopRuntime &&
    environment.VITE_AUTOCOMPLETE_PUBLIC_FREE_DECODER === '1' &&
    isEvaluationMode(String(environment.MODE ?? ''))
  );
}

export function isPublicFreeDecoderManifest(
  value: unknown,
  manifestBytes: number,
): value is PublicFreeDecoderManifest {
  try {
    parsePublicFreeDecoderManifest(value, manifestBytes);
    return true;
  } catch {
    return false;
  }
}

function isEvaluationMode(mode: string): boolean {
  return (
    mode === 'development' ||
    mode === 'test' ||
    mode === 'e2e' ||
    mode === 'autocomplete-v2-free-evaluation'
  );
}
