export type RemoteImageDecision = 'blocked' | 'allowed' | 'failed';

export interface RemoteImageLabels {
  blocked: string;
  source: string;
  loadAll: string;
  loading: string;
  failed: string;
  retry: string;
  insecure: string;
  unnamed: string;
}

export interface RemoteImagePolicy {
  /** Decide whether a valid HTTPS image may be requested in the active host scope. */
  decide: (source: string) => RemoteImageDecision;
  labels: RemoteImageLabels;
  /** Opaque window-local scope identifier; must not contain a notebook path. */
  scopeId: string;
}

/** Options for the Markdown rendering pipeline */
export interface RendererOptions {
  /** Enable GitHub Flavored Markdown */
  gfm?: boolean;
  /** Enable Wiki-link [[...]] parsing */
  wikiLinks?: boolean;
  /** Return true when a Wiki-link target already exists in the notebook. */
  wikiLinkExists?: (note: string) => boolean;
  /** Enable inline #tag parsing */
  tags?: boolean;
  /** Enable code syntax highlighting */
  highlight?: boolean;
  /** Resolve a Markdown image source to a host-readable URL before sanitization. */
  resolveImageSrc?: (source: string) => string | null;
  /** Privacy-preserving policy for remote images. Missing policy remains fail-closed. */
  remoteImages?: RemoteImagePolicy;
}

/** Result of rendering Markdown to HTML */
export interface RenderResult {
  html: string;
  meta: {
    headings: Array<{ level: number; text: string }>;
    wikiLinks: string[];
    tags: string[];
  };
}
