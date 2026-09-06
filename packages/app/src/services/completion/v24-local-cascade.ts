import type { CompletionCandidate, CompletionContext, CompletionProvider } from './types';
import { V24LocalCascade, type V24CascadeStage, stageFromProvider } from './v24-phrase-cascade';

export const V24_LOCAL_CASCADE_STAGE_IDS = Object.freeze([
  'markdown-code-syntax',
  'session-retained-phrase',
  'accepted-phrase',
  'document-phrase',
  'personal-notebook',
  'route-model',
  'unique-fallback',
] as const);

export interface V24LocalCascadeDependencies {
  markdownProviders: readonly CompletionProvider[];
  codeSyntaxProviders: readonly CompletionProvider[];
  sessionProviders: readonly CompletionProvider[];
  acceptedProviders: readonly CompletionProvider[];
  documentProviders: readonly CompletionProvider[];
  personalNotebookProviders: readonly CompletionProvider[];
  routeModelProviders: readonly CompletionProvider[];
  fallbackProviders: readonly CompletionProvider[];
}

export function createV24LocalCascade(dependencies: V24LocalCascadeDependencies): V24LocalCascade {
  const stages: V24CascadeStage[] = [
    groupedStage('markdown-code-syntax', [
      ...dependencies.markdownProviders,
      ...dependencies.codeSyntaxProviders,
    ]),
    groupedStage('session-retained-phrase', dependencies.sessionProviders),
    groupedStage('accepted-phrase', dependencies.acceptedProviders),
    groupedStage('document-phrase', dependencies.documentProviders),
    groupedStage('personal-notebook', dependencies.personalNotebookProviders),
    groupedStage('route-model', dependencies.routeModelProviders),
    groupedStage('unique-fallback', dependencies.fallbackProviders),
  ];
  return new V24LocalCascade(stages);
}

function groupedStage(id: string, providers: readonly CompletionProvider[]): V24CascadeStage {
  const providerStages = providers.map(stageFromProvider);
  return {
    id,
    provide: (context: CompletionContext) =>
      providerStages.flatMap((stage) => stage.provide(context)),
    shortCircuit: shortCircuitForStage(id),
  };
}

function shortCircuitForStage(
  id: (typeof V24_LOCAL_CASCADE_STAGE_IDS)[number] | string,
): NonNullable<V24CascadeStage['shortCircuit']> {
  return (candidate) => {
    if (id === 'markdown-code-syntax') return candidate.source === 'structured';
    if (id === 'session-retained-phrase') return isShortCircuitPhrase(candidate);
    if (id === 'accepted-phrase') {
      return (candidate.support ?? 0) >= 2 && isShortCircuitPhrase(candidate);
    }
    if (id === 'document-phrase') {
      return (candidate.documentParagraphSupport ?? 0) >= 2 && isShortCircuitPhrase(candidate);
    }
    return false;
  };
}

function isShortCircuitPhrase(candidate: CompletionCandidate): boolean {
  const text = candidate.edit?.insertText ?? candidate.text;
  if (/[\u3400-\u9fff]/u.test(text)) return Array.from(text.trim()).length >= 6;
  return (text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/gu) ?? []).length >= 3;
}
