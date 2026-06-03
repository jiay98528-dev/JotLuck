/** Options for the Markdown rendering pipeline */
export interface RendererOptions {
  /** Enable GitHub Flavored Markdown */
  gfm?: boolean;
  /** Enable Wiki-link [[...]] parsing */
  wikiLinks?: boolean;
  /** Enable inline #tag parsing */
  tags?: boolean;
  /** Enable code syntax highlighting */
  highlight?: boolean;
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
