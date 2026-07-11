import type {
  HybridRetrievalBudget,
  HybridRetrievalBatchRequest,
  HybridRetrievalCandidate,
  HybridRetrievalClearRequest,
  HybridRetrievalDiagnostics,
  HybridRetrievalLanguageHint,
  HybridRetrievalMutationResponse,
  HybridRetrievalQueryRequest,
  HybridRetrievalRemoveRequest,
  HybridRetrievalRenameRequest,
  HybridRetrievalReplaceRequest,
  HybridRetrievalRequest,
  HybridRetrievalResponse,
} from './hybrid-retrieval-types';

const MIN_CHINESE_CONTEXT = 2;
const MAX_CHINESE_CONTEXT = 8;
const MAX_ENGLISH_CONTEXT_WORDS = 3;
const MAX_CANDIDATE_CODE_POINTS = 24;
const MAX_ENGLISH_CANDIDATE_WORDS = 3;
const MIN_DOCUMENT_SUPPORT = 2;
const MAX_QUERY_CANDIDATES = 50;
const CONTEXT_SEPARATOR = '\u001f';
const MAX_MUTATION_BATCH_OPERATIONS = 8;
const MAX_MUTATION_BATCH_INPUT_BYTES = 2 * 1024 * 1024;

export const DEFAULT_HYBRID_RETRIEVAL_BUDGET: Readonly<HybridRetrievalBudget> = Object.freeze({
  maxDocuments: 2_000,
  maxDocumentInputBytes: 512 * 1024,
  maxTotalInputBytes: 16 * 1024 * 1024,
  maxDocumentEntries: 20_000,
  maxTotalDocumentEntries: 300_000,
});

const HAN_PATTERN = /\p{Script=Han}/u;
const LATIN_PATTERN = /[A-Za-z]/u;
const STRONG_SENTENCE_MARK_PATTERN = /[。！？!?；;]/u;
const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/gu;

interface SurfaceContribution {
  count: number;
}

interface BranchContribution {
  count: number;
  surfaces: Map<string, SurfaceContribution>;
}

type ContributionTable = Map<string, Map<string, BranchContribution>>;

interface DocumentContribution {
  fingerprint: DocumentFingerprint;
  entryCount: number;
  overflowed: boolean;
  chinese: ContributionTable;
  english: ContributionTable;
}

interface DocumentFingerprint {
  codeUnitLength: number;
  inputBytes: number;
  hashA: number;
  hashB: number;
}

interface ContributionScanBudget {
  maxEntries: number;
  entryCount: number;
  overflowed: boolean;
}

interface AggregateBranch {
  support: number;
  documentCounts: Map<string, number>;
  surfaceCounts: Map<string, number>;
}

type AggregateTable = Map<string, Map<string, AggregateBranch>>;

interface WorkspaceIndex {
  documents: Map<string, DocumentContribution>;
  chinese: AggregateTable;
  english: AggregateTable;
  inputBytes: number;
  documentEntries: number;
  budgetRejections: number;
}

interface EnglishToken {
  text: string;
  normalized: string;
}

/**
 * Pure in-memory notebook phrase index.
 *
 * A workspace owns independent document and aggregate tables. Each document
 * keeps its complete contribution, so replace/remove/rename can reverse its
 * counts without re-reading any other document.
 */
export class HybridRetrievalIndex {
  private readonly workspaces = new Map<string, WorkspaceIndex>();
  private readonly budget: Readonly<HybridRetrievalBudget>;

  constructor(budget: Partial<HybridRetrievalBudget> = {}) {
    this.budget = Object.freeze(normalizeBudget(budget));
  }

  execute(request: HybridRetrievalRequest): HybridRetrievalResponse {
    switch (request.operation) {
      case 'replace':
        return this.replace(request);
      case 'remove':
        return this.remove(request);
      case 'rename':
        return this.rename(request);
      case 'clear':
        return this.clear(request);
      case 'batch':
        return this.applyBatch(request);
      case 'query':
        return { operation: 'query', candidates: this.query(request) };
    }
  }

  /** Alias intended for message-based Worker/Tauri adapters. */
  handle(request: HybridRetrievalRequest): HybridRetrievalResponse {
    return this.execute(request);
  }

  getDiagnostics(workspaceScope: string): HybridRetrievalDiagnostics {
    const scope = normalizeScope(workspaceScope);
    const workspace = this.workspaces.get(scope);
    return {
      workspaceScope: scope,
      documentCount: workspace?.documents.size ?? 0,
      fingerprintCount: workspace?.documents.size ?? 0,
      inputBytes: workspace?.inputBytes ?? 0,
      retainedContentBytes: 0,
      documentEntries: workspace?.documentEntries ?? 0,
      budgetRejections: workspace?.budgetRejections ?? 0,
      budget: { ...this.budget },
    };
  }

  replace(request: HybridRetrievalReplaceRequest): HybridRetrievalMutationResponse {
    const scope = normalizeScope(request.workspaceScope);
    const path = normalizePath(request.path);
    if (!scope || !path || typeof request.content !== 'string') {
      return mutationResponse('replace', false, this.documentCount(scope));
    }

    const workspace = this.getOrCreateWorkspace(scope);
    const previous = workspace.documents.get(path);
    const fingerprint = fingerprintContent(request.content);
    if (previous && fingerprintsEqual(previous.fingerprint, fingerprint)) {
      return mutationResponse('replace', false, workspace.documents.size);
    }

    const nextDocumentCount = workspace.documents.size + (previous ? 0 : 1);
    const nextInputBytes =
      workspace.inputBytes - (previous?.fingerprint.inputBytes ?? 0) + fingerprint.inputBytes;
    if (
      nextDocumentCount > this.budget.maxDocuments ||
      fingerprint.inputBytes > this.budget.maxDocumentInputBytes ||
      nextInputBytes > this.budget.maxTotalInputBytes
    ) {
      workspace.budgetRejections++;
      return mutationResponse('replace', false, workspace.documents.size);
    }

    const contribution = buildDocumentContribution(
      request.content,
      fingerprint,
      this.budget.maxDocumentEntries,
    );
    const nextDocumentEntries =
      workspace.documentEntries - (previous?.entryCount ?? 0) + contribution.entryCount;
    if (contribution.overflowed || nextDocumentEntries > this.budget.maxTotalDocumentEntries) {
      workspace.budgetRejections++;
      return mutationResponse('replace', false, workspace.documents.size);
    }

    if (previous) this.removeDocumentContribution(workspace, path, previous);
    workspace.documents.set(path, contribution);
    this.mergeDocument(workspace, path, contribution, 1);
    workspace.inputBytes += contribution.fingerprint.inputBytes;
    workspace.documentEntries += contribution.entryCount;
    return mutationResponse('replace', true, workspace.documents.size);
  }

  remove(request: HybridRetrievalRemoveRequest): HybridRetrievalMutationResponse {
    const scope = normalizeScope(request.workspaceScope);
    const path = normalizePath(request.path);
    const workspace = this.workspaces.get(scope);
    const contribution = workspace?.documents.get(path);
    if (!workspace || !path || !contribution) {
      return mutationResponse('remove', false, workspace?.documents.size ?? 0);
    }

    this.removeDocumentContribution(workspace, path, contribution);
    workspace.documents.delete(path);
    this.deleteEmptyWorkspace(scope, workspace);
    return mutationResponse('remove', true, workspace.documents.size);
  }

  rename(request: HybridRetrievalRenameRequest): HybridRetrievalMutationResponse {
    const scope = normalizeScope(request.workspaceScope);
    const oldPath = normalizePath(request.oldPath);
    const newPath = normalizePath(request.newPath);
    const workspace = this.workspaces.get(scope);
    const contribution = workspace?.documents.get(oldPath);
    if (!workspace || !oldPath || !newPath || oldPath === newPath || !contribution) {
      return mutationResponse('rename', false, workspace?.documents.size ?? 0);
    }

    // A filesystem rename normally rejects an existing target. Replacing it
    // here is safer for event replay and still preserves exact aggregate counts.
    const overwritten = workspace.documents.get(newPath);
    if (overwritten) {
      this.removeDocumentContribution(workspace, newPath, overwritten);
      workspace.documents.delete(newPath);
    }

    this.mergeDocument(workspace, oldPath, contribution, -1);
    workspace.documents.delete(oldPath);
    workspace.documents.set(newPath, contribution);
    this.mergeDocument(workspace, newPath, contribution, 1);
    return mutationResponse('rename', true, workspace.documents.size);
  }

  clear(request: HybridRetrievalClearRequest): HybridRetrievalMutationResponse {
    const scope = normalizeScope(request.workspaceScope);
    const workspace = this.workspaces.get(scope);
    if (!workspace) return mutationResponse('clear', false, 0);

    const changed = workspace.documents.size > 0;
    this.workspaces.delete(scope);
    return mutationResponse('clear', changed, 0);
  }

  /**
   * Applies a bounded mutation batch without yielding. Worker and local-test
   * callers therefore observe either the revision before this call or the
   * complete batch, never an intermediate document state.
   */
  applyBatch(request: HybridRetrievalBatchRequest): HybridRetrievalMutationResponse {
    const scope = normalizeScope(request.workspaceScope);
    if (
      !scope ||
      request.mutations.length < 1 ||
      request.mutations.length > MAX_MUTATION_BATCH_OPERATIONS ||
      batchInputBytes(request) > MAX_MUTATION_BATCH_INPUT_BYTES ||
      request.mutations.some((mutation) => normalizeScope(mutation.workspaceScope) !== scope)
    ) {
      return mutationResponse('batch', false, this.documentCount(scope));
    }

    let changed = false;
    let documentCount = this.documentCount(scope);
    for (const mutation of request.mutations) {
      const response = this.execute(mutation);
      if (response.operation === 'query' || response.operation === 'batch') continue;
      changed ||= response.changed;
      documentCount = response.documentCount;
    }
    return mutationResponse('batch', changed, documentCount);
  }

  query(request: HybridRetrievalQueryRequest): HybridRetrievalCandidate[] {
    const scope = normalizeScope(request.workspaceScope);
    const workspace = this.workspaces.get(scope);
    const limit = normalizeCandidateLimit(request.maxCandidates);
    if (!workspace || limit === 0 || typeof request.contextBeforeCursor !== 'string') return [];

    const language = resolveLanguageHint(request.languageHint, request.contextBeforeCursor);
    if (language === 'zh') {
      return this.queryChinese(workspace, request.contextBeforeCursor, limit);
    }
    if (language === 'en') {
      return this.queryEnglish(workspace, request.contextBeforeCursor, limit);
    }
    return [];
  }

  private queryChinese(
    workspace: WorkspaceIndex,
    contextBeforeCursor: string,
    limit: number,
  ): HybridRetrievalCandidate[] {
    const sentenceTail = tailAfterStrongSentenceMark(contextBeforeCursor).trimEnd();
    const points = Array.from(sentenceTail.normalize('NFKC'));
    for (
      let contextLength = Math.min(MAX_CHINESE_CONTEXT, points.length);
      contextLength >= MIN_CHINESE_CONTEXT;
      contextLength--
    ) {
      const context = normalizeChineseContext(points.slice(-contextLength).join(''));
      if (!isValidChineseContext(context)) continue;
      const candidates = candidatesForContext(workspace.chinese.get(context), 'zh', false, limit);
      if (candidates.length > 0) return candidates;
    }
    return [];
  }

  private queryEnglish(
    workspace: WorkspaceIndex,
    contextBeforeCursor: string,
    limit: number,
  ): HybridRetrievalCandidate[] {
    const sentenceTail = tailAfterStrongSentenceMark(contextBeforeCursor);
    const words = extractEnglishTokens(sentenceTail);
    const addLeadingSpace = /[A-Za-z]$/u.test(contextBeforeCursor);
    for (
      let contextLength = Math.min(MAX_ENGLISH_CONTEXT_WORDS, words.length);
      contextLength >= 1;
      contextLength--
    ) {
      const context = words
        .slice(-contextLength)
        .map(({ normalized }) => normalized)
        .join(CONTEXT_SEPARATOR);
      const candidates = candidatesForContext(
        workspace.english.get(context),
        'en',
        addLeadingSpace,
        limit,
      );
      if (candidates.length > 0) return candidates;
    }
    if (!/\s$/u.test(contextBeforeCursor)) {
      const prefix = words.at(-1)?.normalized ?? '';
      const precedingWords = words.slice(0, -1);
      if (prefix.length >= 1 && precedingWords.length > 0) {
        for (
          let contextLength = Math.min(MAX_ENGLISH_CONTEXT_WORDS, precedingWords.length);
          contextLength >= 1;
          contextLength--
        ) {
          const context = precedingWords
            .slice(-contextLength)
            .map(({ normalized }) => normalized)
            .join(CONTEXT_SEPARATOR);
          const candidates = candidatesForEnglishPrefix(
            workspace.english.get(context),
            prefix,
            limit,
          );
          if (candidates.length > 0) return candidates;
        }
      }
    }
    return [];
  }

  private mergeDocument(
    workspace: WorkspaceIndex,
    path: string,
    contribution: DocumentContribution,
    direction: 1 | -1,
  ): void {
    mergeContributionTable(workspace.chinese, contribution.chinese, path, direction);
    mergeContributionTable(workspace.english, contribution.english, path, direction);
  }

  private removeDocumentContribution(
    workspace: WorkspaceIndex,
    path: string,
    contribution: DocumentContribution,
  ): void {
    this.mergeDocument(workspace, path, contribution, -1);
    workspace.inputBytes = Math.max(0, workspace.inputBytes - contribution.fingerprint.inputBytes);
    workspace.documentEntries = Math.max(0, workspace.documentEntries - contribution.entryCount);
  }

  private getOrCreateWorkspace(scope: string): WorkspaceIndex {
    let workspace = this.workspaces.get(scope);
    if (!workspace) {
      workspace = {
        documents: new Map(),
        chinese: new Map(),
        english: new Map(),
        inputBytes: 0,
        documentEntries: 0,
        budgetRejections: 0,
      };
      this.workspaces.set(scope, workspace);
    }
    return workspace;
  }

  private documentCount(scope: string): number {
    return this.workspaces.get(scope)?.documents.size ?? 0;
  }

  private deleteEmptyWorkspace(scope: string, workspace: WorkspaceIndex): void {
    if (workspace.documents.size === 0 && workspace.budgetRejections === 0) {
      this.workspaces.delete(scope);
    }
  }
}

function buildDocumentContribution(
  content: string,
  fingerprint: DocumentFingerprint,
  maxEntries: number,
): DocumentContribution {
  const chinese: ContributionTable = new Map();
  const english: ContributionTable = new Map();
  const scanBudget: ContributionScanBudget = {
    maxEntries,
    entryCount: 0,
    overflowed: false,
  };
  for (const line of extractProseLines(content)) {
    scanChineseLine(line, chinese, scanBudget);
    if (scanBudget.overflowed) break;
    scanEnglishLine(line, english, scanBudget);
    if (scanBudget.overflowed) break;
  }
  return {
    fingerprint,
    entryCount: scanBudget.entryCount,
    overflowed: scanBudget.overflowed,
    chinese,
    english,
  };
}

function scanChineseLine(
  line: string,
  table: ContributionTable,
  scanBudget: ContributionScanBudget,
): void {
  const points = Array.from(line);
  if (!HAN_PATTERN.test(line) || points.length < MIN_CHINESE_CONTEXT + 1) return;

  for (let boundary = MIN_CHINESE_CONTEXT; boundary < points.length; boundary++) {
    const candidate = takeChineseContinuation(points, boundary);
    if (!isCandidateAllowed(candidate, 'zh')) continue;

    for (
      let contextLength = MIN_CHINESE_CONTEXT;
      contextLength <= Math.min(MAX_CHINESE_CONTEXT, boundary);
      contextLength++
    ) {
      const context = normalizeChineseContext(
        points.slice(boundary - contextLength, boundary).join(''),
      );
      if (!isValidChineseContext(context)) continue;
      if (
        !recordContribution(
          table,
          context,
          candidate,
          normalizeCandidateKey(candidate, 'zh'),
          scanBudget,
        )
      ) {
        return;
      }
    }
  }
}

function scanEnglishLine(
  line: string,
  table: ContributionTable,
  scanBudget: ContributionScanBudget,
): void {
  for (const sentence of line.split(/[.!?;:。！？；]+/u)) {
    const words = extractEnglishTokens(sentence);
    for (let nextIndex = 1; nextIndex < words.length; nextIndex++) {
      const candidateWords = longestAllowedEnglishCandidate(words.slice(nextIndex));
      if (candidateWords.length === 0) continue;
      const surface = candidateWords.map(({ text }) => text).join(' ');
      const candidateKey = normalizeCandidateKey(surface, 'en');

      for (
        let contextLength = 1;
        contextLength <= Math.min(MAX_ENGLISH_CONTEXT_WORDS, nextIndex);
        contextLength++
      ) {
        const context = words
          .slice(nextIndex - contextLength, nextIndex)
          .map(({ normalized }) => normalized)
          .join(CONTEXT_SEPARATOR);
        if (!recordContribution(table, context, surface, candidateKey, scanBudget)) return;
      }
    }
  }
}

function longestAllowedEnglishCandidate(words: EnglishToken[]): EnglishToken[] {
  for (let length = Math.min(MAX_ENGLISH_CANDIDATE_WORDS, words.length); length >= 1; length--) {
    const candidate = words.slice(0, length);
    const surface = candidate.map(({ text }) => text).join(' ');
    // Reserve one code point for the leading space needed when the cursor is
    // immediately after a complete English word.
    if (isCandidateAllowed(surface, 'en') && isCandidateAllowed(` ${surface}`, 'en')) {
      return candidate;
    }
  }
  return [];
}

function takeChineseContinuation(points: string[], boundary: number): string {
  const tail = points.slice(boundary, boundary + MAX_CANDIDATE_CODE_POINTS);
  let length = tail.length;
  const terminator = tail.findIndex((point) => STRONG_SENTENCE_MARK_PATTERN.test(point));
  if (terminator >= 0) length = terminator + 1;
  return tail.slice(0, length).join('').trim();
}

function recordContribution(
  table: ContributionTable,
  context: string,
  surface: string,
  candidateKey: string,
  scanBudget: ContributionScanBudget,
): boolean {
  if (!context || !candidateKey) return true;
  let branches = table.get(context);
  let branch = branches?.get(candidateKey);
  const allocatesEntry = !branch || !branch.surfaces.has(surface);
  if (allocatesEntry && scanBudget.entryCount >= scanBudget.maxEntries) {
    scanBudget.overflowed = true;
    return false;
  }
  if (!branch) {
    if (!branches) {
      branches = new Map();
      table.set(context, branches);
    }
    branch = { count: 0, surfaces: new Map() };
    branches.set(candidateKey, branch);
  }
  if (allocatesEntry) scanBudget.entryCount++;
  branch.count++;
  const existingSurface = branch.surfaces.get(surface);
  branch.surfaces.set(surface, { count: (existingSurface?.count ?? 0) + 1 });
  return true;
}

function mergeContributionTable(
  aggregate: AggregateTable,
  contribution: ContributionTable,
  path: string,
  direction: 1 | -1,
): void {
  for (const [context, contributedBranches] of contribution) {
    let aggregateBranches = aggregate.get(context);
    if (!aggregateBranches && direction === 1) {
      aggregateBranches = new Map();
      aggregate.set(context, aggregateBranches);
    }
    if (!aggregateBranches) continue;

    for (const [candidateKey, contributedBranch] of contributedBranches) {
      let aggregateBranch = aggregateBranches.get(candidateKey);
      if (!aggregateBranch && direction === 1) {
        aggregateBranch = {
          support: 0,
          documentCounts: new Map(),
          surfaceCounts: new Map(),
        };
        aggregateBranches.set(candidateKey, aggregateBranch);
      }
      if (!aggregateBranch) continue;

      aggregateBranch.support += direction * contributedBranch.count;
      if (direction === 1) {
        aggregateBranch.documentCounts.set(path, contributedBranch.count);
      } else {
        aggregateBranch.documentCounts.delete(path);
      }

      for (const [surface, surfaceContribution] of contributedBranch.surfaces) {
        const nextCount =
          (aggregateBranch.surfaceCounts.get(surface) ?? 0) + direction * surfaceContribution.count;
        if (nextCount > 0) aggregateBranch.surfaceCounts.set(surface, nextCount);
        else aggregateBranch.surfaceCounts.delete(surface);
      }

      if (aggregateBranch.support <= 0 || aggregateBranch.documentCounts.size === 0) {
        aggregateBranches.delete(candidateKey);
      }
    }

    if (aggregateBranches.size === 0) aggregate.delete(context);
  }
}

function candidatesForContext(
  branches: Map<string, AggregateBranch> | undefined,
  language: 'zh' | 'en',
  addLeadingSpace: boolean,
  limit: number,
): HybridRetrievalCandidate[] {
  if (!branches) return [];
  const totalSupport = [...branches.values()].reduce((sum, branch) => sum + branch.support, 0);
  if (totalSupport <= 0) return [];

  const deduplicated = new Map<string, HybridRetrievalCandidate>();
  for (const branch of branches.values()) {
    const documentSupport = branch.documentCounts.size;
    if (documentSupport < MIN_DOCUMENT_SUPPORT) continue;
    const surface = selectSurface(branch.surfaceCounts);
    const text = language === 'en' && addLeadingSpace ? ` ${surface}` : surface;
    if (!isCandidateAllowed(text, language)) continue;

    const branchShare = branch.support / totalSupport;
    const evidence = 1 - Math.exp(-documentSupport / 2);
    const candidate: HybridRetrievalCandidate = {
      text,
      confidence: roundConfidence(Math.min(0.99, branchShare * evidence)),
      support: branch.support,
      documentSupport,
      providerId: language === 'zh' ? 'hybrid-retrieval-zh' : 'hybrid-retrieval-en',
      sourceLayer: 'notebook',
    };
    const key = normalizeCandidateKey(text, language);
    const previous = deduplicated.get(key);
    if (!previous || compareCandidates(candidate, previous) < 0) deduplicated.set(key, candidate);
  }

  return [...deduplicated.values()].sort(compareCandidates).slice(0, limit);
}

function candidatesForEnglishPrefix(
  branches: Map<string, AggregateBranch> | undefined,
  prefix: string,
  limit: number,
): HybridRetrievalCandidate[] {
  if (!branches) return [];
  const totalSupport = [...branches.values()].reduce((sum, branch) => sum + branch.support, 0);
  if (totalSupport <= 0) return [];
  const normalizedPrefix = normalizeEnglishWord(prefix);
  const candidates: HybridRetrievalCandidate[] = [];

  for (const branch of branches.values()) {
    const documentSupport = branch.documentCounts.size;
    if (documentSupport < MIN_DOCUMENT_SUPPORT) continue;
    const surface = selectSurface(branch.surfaceCounts);
    const words = extractEnglishTokens(surface);
    const first = words[0];
    if (!first?.normalized.startsWith(normalizedPrefix)) continue;
    const suffix = first.text.slice(Array.from(prefix).length);
    const remaining = words.slice(1).map(({ text }) => text);
    const text = `${suffix}${remaining.length > 0 ? ` ${remaining.join(' ')}` : ''}`;
    if (!isCandidateAllowed(text, 'en')) continue;
    const branchShare = branch.support / totalSupport;
    const evidence = 1 - Math.exp(-documentSupport / 2);
    candidates.push({
      text,
      confidence: roundConfidence(Math.min(0.99, branchShare * evidence)),
      support: branch.support,
      documentSupport,
      providerId: 'hybrid-retrieval-en',
      sourceLayer: 'notebook',
    });
  }

  return candidates.sort(compareCandidates).slice(0, limit);
}

function selectSurface(surfaceCounts: Map<string, number>): string {
  return (
    [...surfaceCounts].sort(([leftSurface, leftCount], [rightSurface, rightCount]) => {
      if (leftCount !== rightCount) return rightCount - leftCount;
      return compareText(leftSurface, rightSurface);
    })[0]?.[0] ?? ''
  );
}

function compareCandidates(
  left: HybridRetrievalCandidate,
  right: HybridRetrievalCandidate,
): number {
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  if (left.documentSupport !== right.documentSupport) {
    return right.documentSupport - left.documentSupport;
  }
  if (left.support !== right.support) return right.support - left.support;
  const lengthDifference = codePointLength(left.text) - codePointLength(right.text);
  if (lengthDifference !== 0) return lengthDifference;
  return compareText(left.text, right.text);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function extractProseLines(content: string): string[] {
  const lines = content.split(/\r?\n/u);
  const excluded = new Array<boolean>(lines.length).fill(false);
  markFrontmatter(lines, excluded);
  markFencedCode(lines, excluded);
  const structurallyBlocked = [...excluded];

  for (let index = 0; index < lines.length; index++) {
    if (structurallyBlocked[index]) continue;
    const line = lines[index] ?? '';
    if (isAtxHeading(line) || isThematicBreak(line) || isTableLikeLine(line)) {
      excluded[index] = true;
    }
  }

  for (let index = 1; index < lines.length; index++) {
    if (structurallyBlocked[index]) continue;
    const line = lines[index] ?? '';
    if (isSetextUnderline(line)) {
      excluded[index] = true;
      if (!structurallyBlocked[index - 1] && (lines[index - 1] ?? '').trim()) {
        excluded[index - 1] = true;
      }
    }
    if (isTableDelimiter(line)) {
      excluded[index] = true;
      if (!structurallyBlocked[index - 1] && (lines[index - 1] ?? '').includes('|')) {
        excluded[index - 1] = true;
      }
      for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex++) {
        if (structurallyBlocked[bodyIndex] || !hasTableCells(lines[bodyIndex] ?? '')) break;
        excluded[bodyIndex] = true;
      }
    }
  }

  const prose: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (excluded[index]) continue;
    const cleaned = cleanProseLine(lines[index] ?? '');
    if (cleaned) prose.push(cleaned);
  }
  return prose;
}

function markFrontmatter(lines: string[], excluded: boolean[]): void {
  const first = (lines[0] ?? '').replace(/^\uFEFF/u, '');
  if (!/^---[ \t]*$/u.test(first)) return;
  excluded[0] = true;
  for (let index = 1; index < lines.length; index++) {
    excluded[index] = true;
    if (/^---[ \t]*$/u.test(lines[index] ?? '')) return;
  }
}

function markFencedCode(lines: string[], excluded: boolean[]): void {
  let fence: { marker: '`' | '~'; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    if (excluded[index]) continue;
    const line = lines[index] ?? '';
    if (fence) {
      excluded[index] = true;
      if (isFenceCloser(line, fence)) fence = null;
      continue;
    }
    const opener = parseFenceOpener(line);
    if (opener) {
      excluded[index] = true;
      fence = opener;
    }
  }
}

function parseFenceOpener(line: string): { marker: '`' | '~'; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  const run = match?.[1];
  if (!run) return null;
  const marker = run[0] as '`' | '~';
  if (marker === '`' && (match?.[2] ?? '').includes('`')) return null;
  return { marker, length: run.length };
}

function isFenceCloser(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
  const run = match?.[1];
  return !!run && run[0] === fence.marker && run.length >= fence.length;
}

function isAtxHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/u.test(line);
}

function isSetextUnderline(line: string): boolean {
  return /^ {0,3}(?:=+|-+)[ \t]*$/u.test(line);
}

function isThematicBreak(line: string): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u.test(line);
}

function isTableLikeLine(line: string): boolean {
  const trimmed = line.trim();
  return /^\|.*\|?$/u.test(trimmed) && trimmed.slice(1).includes('|');
}

function isTableDelimiter(line: string): boolean {
  return /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/u.test(line);
}

function hasTableCells(line: string): boolean {
  return /(^|[^\\])\|/u.test(line);
}

function cleanProseLine(line: string): string {
  let cleaned = line.replace(/^ {0,3}/u, '');
  cleaned = cleaned.replace(/^(?:>[ \t]?)+/u, '');
  cleaned = cleaned.replace(/^(?:[-+*]|\d{1,9}[.)、．])[ \t]+/u, '');
  cleaned = cleaned.replace(/^\[[ xX]\][ \t]+/u, '');
  return cleaned.trim();
}

function extractEnglishTokens(text: string): EnglishToken[] {
  const normalizedText = text.normalize('NFKC');
  return [...normalizedText.matchAll(ENGLISH_WORD_PATTERN)].map((match) => ({
    text: match[0],
    normalized: normalizeEnglishWord(match[0]),
  }));
}

function normalizeEnglishWord(word: string): string {
  return word.normalize('NFKC').replace(/’/gu, "'").toLocaleLowerCase('en-US');
}

function normalizeChineseContext(context: string): string {
  return context.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizeCandidateKey(candidate: string, language: 'zh' | 'en'): string {
  const normalized = candidate.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return language === 'en' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function fingerprintContent(content: string): DocumentFingerprint {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < content.length; index++) {
    const codeUnit = content.charCodeAt(index);
    hashA = Math.imul(hashA ^ codeUnit, 0x01000193);
    hashB = Math.imul(hashB ^ codeUnit, 0x85ebca6b);
    hashB ^= hashB >>> 13;
  }
  return {
    codeUnitLength: content.length,
    inputBytes: utf8ByteLength(content),
    hashA: hashA >>> 0,
    hashB: hashB >>> 0,
  };
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const point of text) {
    const codePoint = point.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function fingerprintsEqual(left: DocumentFingerprint, right: DocumentFingerprint): boolean {
  return (
    left.codeUnitLength === right.codeUnitLength &&
    left.inputBytes === right.inputBytes &&
    left.hashA === right.hashA &&
    left.hashB === right.hashB
  );
}

function normalizeBudget(overrides: Partial<HybridRetrievalBudget>): HybridRetrievalBudget {
  return {
    maxDocuments: normalizeBudgetValue(
      overrides.maxDocuments,
      DEFAULT_HYBRID_RETRIEVAL_BUDGET.maxDocuments,
    ),
    maxDocumentInputBytes: normalizeBudgetValue(
      overrides.maxDocumentInputBytes,
      DEFAULT_HYBRID_RETRIEVAL_BUDGET.maxDocumentInputBytes,
    ),
    maxTotalInputBytes: normalizeBudgetValue(
      overrides.maxTotalInputBytes,
      DEFAULT_HYBRID_RETRIEVAL_BUDGET.maxTotalInputBytes,
    ),
    maxDocumentEntries: normalizeBudgetValue(
      overrides.maxDocumentEntries,
      DEFAULT_HYBRID_RETRIEVAL_BUDGET.maxDocumentEntries,
    ),
    maxTotalDocumentEntries: normalizeBudgetValue(
      overrides.maxTotalDocumentEntries,
      DEFAULT_HYBRID_RETRIEVAL_BUDGET.maxTotalDocumentEntries,
    ),
  };
}

function normalizeBudgetValue(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeScope(scope: string): string {
  return typeof scope === 'string' ? scope.trim() : '';
}

function normalizePath(path: string): string {
  if (typeof path !== 'string') return '';
  const normalized = path
    .trim()
    .replace(/\\/gu, '/')
    .replace(/\/{2,}/gu, '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function normalizeCandidateLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(MAX_QUERY_CANDIDATES, Math.floor(limit));
}

function resolveLanguageHint(
  languageHint: HybridRetrievalLanguageHint,
  contextBeforeCursor: string,
): HybridRetrievalLanguageHint {
  if (languageHint !== 'unknown') return languageHint;
  const tail = tailAfterStrongSentenceMark(contextBeforeCursor).slice(-96);
  const hasHan = HAN_PATTERN.test(tail);
  const hasLatin = LATIN_PATTERN.test(tail);
  if (hasHan && hasLatin) return 'mixed';
  if (hasHan) return 'zh';
  if (hasLatin) return 'en';
  return 'unknown';
}

function tailAfterStrongSentenceMark(text: string): string {
  let lastIndex = -1;
  for (let index = 0; index < text.length; index++) {
    if (STRONG_SENTENCE_MARK_PATTERN.test(text[index] ?? '')) lastIndex = index;
  }
  return text.slice(lastIndex + 1);
}

function isValidChineseContext(context: string): boolean {
  if (!context || STRONG_SENTENCE_MARK_PATTERN.test(context)) return false;
  let hanCount = 0;
  for (const point of Array.from(context)) {
    if (HAN_PATTERN.test(point)) hanCount++;
  }
  return hanCount >= MIN_CHINESE_CONTEXT;
}

function isCandidateAllowed(candidate: string, language: 'zh' | 'en'): boolean {
  if (!candidate || !candidate.trim()) return false;
  const points = Array.from(candidate);
  if (points.length < 1 || points.length > MAX_CANDIDATE_CODE_POINTS) return false;
  const hasHan = HAN_PATTERN.test(candidate);
  const hasLatin = LATIN_PATTERN.test(candidate);
  if (hasHan && hasLatin) return false;
  if (language === 'zh' && hasLatin) return false;
  if (language === 'en') {
    if (hasHan) return false;
    const words = extractEnglishTokens(candidate);
    if (words.length < 1 || words.length > MAX_ENGLISH_CANDIDATE_WORDS) return false;
  }
  return true;
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function roundConfidence(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function batchInputBytes(request: HybridRetrievalBatchRequest): number {
  const encoder = new TextEncoder();
  return request.mutations.reduce((total, mutation) => {
    switch (mutation.operation) {
      case 'replace':
        return (
          total +
          encoder.encode(mutation.path).byteLength +
          encoder.encode(mutation.content).byteLength
        );
      case 'remove':
        return total + encoder.encode(mutation.path).byteLength;
      case 'rename':
        return (
          total +
          encoder.encode(mutation.oldPath).byteLength +
          encoder.encode(mutation.newPath).byteLength
        );
      case 'clear':
        return total;
    }
  }, 0);
}

function mutationResponse(
  operation: HybridRetrievalMutationResponse['operation'],
  changed: boolean,
  documentCount: number,
): HybridRetrievalMutationResponse {
  return { operation, changed, documentCount };
}
