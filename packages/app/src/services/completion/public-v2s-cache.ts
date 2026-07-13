export const PUBLIC_V2S_CACHE_NAME = 'jotluck-public-v2s-v1';

export interface PublicV2sByteCache {
  read(url: string): Promise<Uint8Array | null>;
  write(url: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export function createPublicV2sByteCache(): PublicV2sByteCache | null {
  if (!('caches' in globalThis) || !globalThis.caches) return null;
  return {
    async read(url) {
      try {
        const cache = await globalThis.caches.open(PUBLIC_V2S_CACHE_NAME);
        const response = await cache.match(url);
        if (!response?.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        return null;
      }
    },
    async write(url, bytes, contentType) {
      try {
        const cache = await globalThis.caches.open(PUBLIC_V2S_CACHE_NAME);
        await cache.put(
          url,
          new Response(bytes.slice(), {
            status: 200,
            headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) },
          }),
        );
      } catch {
        // Cache persistence is best effort. Network/Tauri resources remain the
        // source for this session, while the engine still fails closed offline.
      }
    },
  };
}
