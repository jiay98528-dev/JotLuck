import { Facet, StateEffect, type EditorState, type Text } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { DocumentAnalysis } from '@/services/document-analysis';
import { parseDocument, type DocumentAst } from '@jotluck/renderer/analysis';

export const documentAnalysisFacet = Facet.define<DocumentAnalysis, DocumentAnalysis | null>({
  combine: (values) => values[0] ?? null,
});
export const documentAnalysisReady = StateEffect.define<void>();
const exactCache = new WeakMap<Text, DocumentAst>();
// 全文 toString 按 doc 身份缓存：Text 不可变，同身份必同内容；击键链上
// analysis.update / peekDocumentAst / MarkdownEditor 同步 / NotebookHome 统计
// 对同一 doc 版本只物化一次全文串（大文档下每次物化均为 O(N) 全拷贝）。
const docStringCache = new WeakMap<Text, string>();

/** 共享取串：同一 doc 版本（Text 身份）重复调用只做一次全文 toString。 */
export function docToString(doc: Text): string {
  let text = docStringCache.get(doc);
  if (text === undefined) {
    text = doc.toString();
    docStringCache.set(doc, text);
  }
  return text;
}

export function getDocumentAst(state: EditorState): DocumentAst {
  const cached = peekDocumentAst(state);
  if (cached) return cached;
  const source = docToString(state.doc);
  const ast = state.facet(documentAnalysisFacet)?.exact(source) ?? parseDocument(source);
  exactCache.set(state.doc, ast);
  return ast;
}

export function peekDocumentAst(state: EditorState): DocumentAst | null {
  const cached = exactCache.get(state.doc);
  if (cached) return cached;
  const result = state.facet(documentAnalysisFacet)?.result;
  if (result && result.ast.source === docToString(state.doc)) {
    exactCache.set(state.doc, result.ast);
    return result.ast;
  }
  return null;
}

export function documentAnalysisExtension(analysis: DocumentAnalysis) {
  return [
    documentAnalysisFacet.of(analysis),
    ViewPlugin.define((view) => {
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const unsubscribe = analysis.subscribe(() => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (!disposed) view.dispatch({ effects: documentAnalysisReady.of() });
        }, 0);
      });
      analysis.update(docToString(view.state.doc));
      return {
        update(update) {
          if (update.docChanged) analysis.update(docToString(update.state.doc));
        },
        destroy() {
          disposed = true;
          unsubscribe();
          if (timer !== null) clearTimeout(timer);
        },
      };
    }),
  ];
}
