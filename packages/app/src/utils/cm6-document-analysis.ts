import { Facet, StateEffect, type EditorState, type Text } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { DocumentAnalysis } from '@/services/document-analysis';
import { parseDocument, type DocumentAst } from '@jotluck/renderer/analysis';

export const documentAnalysisFacet = Facet.define<DocumentAnalysis, DocumentAnalysis | null>({
  combine: (values) => values[0] ?? null,
});
export const documentAnalysisReady = StateEffect.define<void>();
const exactCache = new WeakMap<Text, DocumentAst>();

export function getDocumentAst(state: EditorState): DocumentAst {
  const cached = peekDocumentAst(state);
  if (cached) return cached;
  const source = state.doc.toString();
  const ast = state.facet(documentAnalysisFacet)?.exact(source) ?? parseDocument(source);
  exactCache.set(state.doc, ast);
  return ast;
}

export function peekDocumentAst(state: EditorState): DocumentAst | null {
  const cached = exactCache.get(state.doc);
  if (cached) return cached;
  const result = state.facet(documentAnalysisFacet)?.result;
  if (result && result.ast.source === state.doc.toString()) {
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
      analysis.update(view.state.doc.toString());
      return {
        update(update) {
          if (update.docChanged) analysis.update(update.state.doc.toString());
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
