import type {
  CompletionCandidate,
  CompletionCandidateKind,
  CompletionContributor,
  CompletionPriorityTier,
} from './types';

/** Fill the V2.2 authoritative edit/metadata contract for legacy providers. */
export function normalizeCandidateContract(
  candidate: CompletionCandidate,
  normalizedText = candidate.text,
): CompletionCandidate {
  const from = candidate.edit?.from ?? candidate.from;
  const to = candidate.edit?.to ?? from;
  const insertText = candidate.edit?.insertText ?? normalizedText;
  const rawScore = finiteScore(candidate.rawScore, candidate.confidence);
  const calibratedScore = finiteScore(candidate.calibratedScore, candidate.confidence);
  const contributor: CompletionContributor = {
    providerId: candidate.providerId,
    sourceLayer: candidate.sourceLayer,
    rawScore,
    calibratedScore,
  };
  return {
    ...candidate,
    text: normalizedText,
    from,
    confidence: calibratedScore,
    edit: { from, to, insertText },
    displayText: candidate.displayText ?? normalizedText,
    mode: candidate.mode ?? (candidate.source === 'structured' ? 'structured' : 'predictive'),
    kind: candidate.kind ?? inferCandidateKind(candidate),
    contributors: normalizeContributors(candidate.contributors ?? [contributor]),
    priorityTier: candidate.priorityTier ?? inferPriorityTier(candidate),
    rawScore,
    calibratedScore,
    feedbackPolicy:
      candidate.feedbackPolicy ??
      (candidate.source === 'structured' || !candidate.learnable ? 'none' : 'retained'),
  };
}

export function mergeCandidateContributors(
  winner: CompletionCandidate,
  candidates: readonly CompletionCandidate[],
): CompletionCandidate {
  return {
    ...winner,
    contributors: normalizeContributors(
      candidates.flatMap((candidate) =>
        candidate.contributors?.length
          ? candidate.contributors
          : [
              {
                providerId: candidate.providerId,
                sourceLayer: candidate.sourceLayer,
                rawScore: finiteScore(candidate.rawScore, candidate.confidence),
                calibratedScore: finiteScore(candidate.calibratedScore, candidate.confidence),
              },
            ],
      ),
    ),
  };
}

export function completionEditKey(candidate: CompletionCandidate): string {
  const normalized = normalizeCandidateContract(candidate);
  const edit = normalized.edit!;
  return [
    edit.from,
    edit.to,
    edit.insertText.normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('en-US'),
  ].join('\u001f');
}

function normalizeContributors(
  contributors: readonly CompletionContributor[],
): readonly CompletionContributor[] {
  const unique = new Map<string, CompletionContributor>();
  for (const item of contributors) {
    if (!item.providerId) continue;
    const normalized = {
      providerId: item.providerId,
      sourceLayer: item.sourceLayer,
      rawScore: finiteScore(item.rawScore, 0),
      calibratedScore: finiteScore(item.calibratedScore, 0),
    };
    const key = `${normalized.providerId}\u001f${normalized.sourceLayer ?? ''}`;
    const previous = unique.get(key);
    if (!previous || normalized.calibratedScore > previous.calibratedScore) {
      unique.set(key, normalized);
    }
  }
  return Object.freeze([...unique.values()].map((item) => Object.freeze(item)));
}

function inferCandidateKind(candidate: CompletionCandidate): CompletionCandidateKind {
  if (candidate.syntaxType === 'wiki-link') return 'wiki-link';
  if (candidate.syntaxType === 'tag') return 'tag';
  if (candidate.syntaxType === 'file-path') return 'file-path';
  if (candidate.syntaxType === 'markdown-format') return 'format';
  if (candidate.syntaxType === 'markdown-structure') return 'list';
  if (candidate.syntaxType === 'sequence-pattern') return 'sequence';
  if (candidate.syntaxType === 'word-en') return 'word';
  if (candidate.providerId.includes('phrase')) return 'phrase';
  return 'text';
}

function inferPriorityTier(candidate: CompletionCandidate): CompletionPriorityTier {
  if (candidate.source === 'structured') return 'structured';
  if (
    candidate.sourceLayer === 'l1' ||
    candidate.sourceLayer === 'short-l1' ||
    candidate.sourceLayer === 'session'
  ) {
    return 'document-session';
  }
  if (
    candidate.sourceLayer === 'l2' ||
    candidate.sourceLayer === 'short-l2' ||
    candidate.sourceLayer === 'notebook' ||
    candidate.sourceLayer === 'short-notebook'
  ) {
    return 'personal-workspace';
  }
  if (candidate.sourceLayer === 'l3' || candidate.sourceLayer === 'short-l3') return 'public';
  if (candidate.sourceLayer === 'provider') {
    // Legacy local providers used numeric priority as their semantic layer.
    // Preserve that behavior without misclassifying generic heuristics as public.
    if (candidate.priority >= 80) return 'document-session';
    if (candidate.priority >= 72) return 'personal-workspace';
  }
  return 'fallback';
}

function finiteScore(value: number | undefined, fallback: number): number {
  const score = Number.isFinite(value) ? value! : fallback;
  return Math.max(0, Math.min(1, score));
}
