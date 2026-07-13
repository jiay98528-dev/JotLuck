import {
  PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES,
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  type PublicEngineGenerateResponse,
} from './public-engine-types';
import {
  PUBLIC_V2S_MODEL_MAX_BYTES,
  parsePublicV2sModel,
  type PublicV2sRuntimeModel,
} from './public-v2s-binary';
import type {
  PublicV2sWorkerInitRequest,
  PublicV2sWorkerRequest,
  PublicV2sWorkerResponse,
} from './public-v2s-protocol';
import { createPublicV2sByteCache } from './public-v2s-cache';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PublicV2sWorkerRequest>) => void) | null;
  postMessage(message: PublicV2sWorkerResponse): void;
};

const cancelledRequests = new Set<number>();
const activeFetches = new Map<number, AbortController>();
let model: PublicV2sRuntimeModel | null = null;
let configuredMaxOutputCodePoints = 0;

workerScope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelledRequests.add(message.requestId);
    activeFetches.get(message.requestId)?.abort('cancelled');
    setTimeout(() => cancelledRequests.delete(message.requestId), 30_000);
    return;
  }
  if (message.type === 'init') {
    void initialize(message);
    return;
  }
  generate(message.requestId, message.request);
};

async function initialize(request: PublicV2sWorkerInitRequest): Promise<void> {
  const controller = new AbortController();
  activeFetches.set(request.requestId, controller);
  try {
    if (
      request.protocolVersion !== PUBLIC_ENGINE_PROTOCOL_VERSION ||
      !/^[a-f0-9]{64}$/u.test(request.expectedSha256) ||
      !Number.isInteger(request.expectedModelBytes) ||
      request.expectedModelBytes < 1 ||
      request.expectedModelBytes > PUBLIC_V2S_MODEL_MAX_BYTES ||
      request.maxModelBytes !== PUBLIC_V2S_MODEL_MAX_BYTES ||
      !Number.isInteger(request.maxOutputCodePoints) ||
      request.maxOutputCodePoints < 1
    ) {
      throw new Error('Invalid Public V2S initialization contract.');
    }
    const loaded = await loadModelBytes(request.modelUrl, request.maxModelBytes, controller.signal);
    const binary = loaded.bytes;
    if (
      binary.byteLength !== request.expectedModelBytes ||
      binary.byteLength > request.maxModelBytes
    ) {
      throw new Error('Public V2S model byte length mismatch.');
    }
    const actualSha256 = await sha256Hex(binary);
    if (actualSha256 !== request.expectedSha256) {
      throw new Error('Public V2S model SHA-256 mismatch.');
    }
    const parsed = await parsePublicV2sModel(binary, request.expectedContainerHeaderSha256);
    if (parsed.metadata.maxOutputCodePoints > request.maxOutputCodePoints) {
      throw new Error('Public V2S model output limit exceeds the host contract.');
    }
    if (cancelledRequests.has(request.requestId)) return;
    if (loaded.network) {
      await createPublicV2sByteCache()?.write(
        request.modelUrl,
        new Uint8Array(binary),
        'application/octet-stream',
      );
    }
    model = parsed;
    configuredMaxOutputCodePoints = request.maxOutputCodePoints;
    workerScope.postMessage({
      type: 'ready',
      requestId: request.requestId,
      protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
      modelSha256: actualSha256,
      containerHeaderSha256: parsed.metadata.containerHeaderSha256,
      metadata: parsed.metadata,
    });
  } catch (error) {
    if (!cancelledRequests.has(request.requestId)) {
      workerScope.postMessage({
        type: 'error',
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    activeFetches.delete(request.requestId);
    cancelledRequests.delete(request.requestId);
  }
}

async function loadModelBytes(
  modelUrl: string,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<{ bytes: ArrayBuffer; network: boolean }> {
  try {
    const response = await fetch(modelUrl, {
      cache: 'force-cache',
      credentials: 'same-origin',
      signal,
    });
    if (response.ok) {
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
        throw new Error('Public V2S model exceeds the declared size limit.');
      }
      return { bytes: await response.arrayBuffer(), network: true };
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }
  const cached = await createPublicV2sByteCache()?.read(modelUrl);
  if (!cached) throw new Error('Public V2S model is unavailable offline.');
  const copy = new Uint8Array(cached.byteLength);
  copy.set(cached);
  return { bytes: copy.buffer, network: false };
}

function generate(
  requestId: number,
  request: import('./public-engine-types').PublicEngineGenerateRequest,
): void {
  try {
    if (!model) throw new Error('Public V2S model is not ready.');
    if (cancelledRequests.delete(requestId)) return;
    if (
      request.contextTailUtf8Bytes !== new TextEncoder().encode(request.contextTail).byteLength ||
      request.contextTailUtf8Bytes > PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES ||
      request.maxCandidates < 0 ||
      request.maxCandidates > 32 ||
      Date.now() > request.deadlineAt ||
      configuredMaxOutputCodePoints < model.metadata.maxOutputCodePoints
    ) {
      throw new Error('Invalid Public V2S generate request.');
    }
    const candidates = model.generate(request);
    if (cancelledRequests.delete(requestId) || Date.now() > request.deadlineAt) return;
    const response: PublicEngineGenerateResponse = {
      protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
      engineEpoch: request.engineEpoch,
      workspaceScope: request.workspaceScope,
      documentVersion: request.documentVersion,
      cursorPos: request.cursorPos,
      candidates,
    };
    workerScope.postMessage({ type: 'generated', requestId, response });
  } catch (error) {
    if (!cancelledRequests.delete(requestId)) {
      workerScope.postMessage({
        type: 'error',
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function sha256Hex(binary: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', binary);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
