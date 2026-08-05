import type {
  CompletionCandidate,
  CompletionContext,
  CompletionMode,
  CompletionProvider,
  CompletionProviderDescriptor,
} from './types';

export interface CompletionProviderRunDiagnostics {
  providerId: string;
  elapsedMs: number;
  returned: number;
  exceededSoftBudget: boolean;
}

export interface CompletionProviderCollection {
  candidates: CompletionCandidate[];
  diagnostics: CompletionProviderRunDiagnostics[];
  providerCount: number;
}

interface RegisteredProvider {
  provider: CompletionProvider;
  descriptor: CompletionProviderDescriptor;
}

/** Internal-only, immutable-after-use registry for trusted completion providers. */
export class CompletionProviderRegistry {
  private readonly entries = new Map<string, RegisteredProvider>();
  private sealed = false;

  register(provider: CompletionProvider, descriptor: CompletionProviderDescriptor): this {
    if (this.sealed) throw new Error('CompletionProviderRegistry is sealed');
    validateDescriptor(provider, descriptor);
    if (this.entries.has(descriptor.id)) {
      throw new Error(`Duplicate completion provider: ${descriptor.id}`);
    }
    if (
      descriptor.genericFallback &&
      [...this.entries.values()].some((entry) => entry.descriptor.genericFallback)
    ) {
      throw new Error('Only one generic completion fallback may be registered');
    }
    this.entries.set(descriptor.id, { provider, descriptor: freezeDescriptor(descriptor) });
    return this;
  }

  seal(): this {
    this.sealed = true;
    return this;
  }

  getDescriptor(providerId: string): CompletionProviderDescriptor | null {
    return this.entries.get(providerId)?.descriptor ?? null;
  }

  providersFor(
    mode?: CompletionMode,
    include: (providerId: string) => boolean = () => true,
  ): CompletionProvider[] {
    this.sealed = true;
    return [...this.entries.values()]
      .filter(
        (entry) => (!mode || entry.descriptor.modes.includes(mode)) && include(entry.descriptor.id),
      )
      .sort(compareRegisteredProviders)
      .map((entry) => entry.provider);
  }

  collect(
    context: CompletionContext,
    mode?: CompletionMode,
    include: (providerId: string) => boolean = () => true,
    now: () => number = () => performance.now(),
  ): CompletionProviderCollection {
    this.sealed = true;
    const candidates: CompletionCandidate[] = [];
    const diagnostics: CompletionProviderRunDiagnostics[] = [];
    const entries = [...this.entries.values()]
      .filter(
        (entry) => (!mode || entry.descriptor.modes.includes(mode)) && include(entry.descriptor.id),
      )
      .sort(compareRegisteredProviders);
    for (const entry of entries) {
      if (!entry.descriptor.contextCapabilities.includes(context.blockType)) continue;
      if (!entry.provider.canProvide(context)) continue;
      const startedAt = now();
      const provided = entry.provider.provideMany?.(context) ?? [entry.provider.provide(context)];
      const elapsedMs = Math.max(0, now() - startedAt);
      const accepted = provided
        .filter((candidate): candidate is CompletionCandidate => candidate !== null)
        .slice(0, entry.descriptor.maxCandidates);
      candidates.push(...accepted);
      diagnostics.push({
        providerId: entry.descriptor.id,
        elapsedMs,
        returned: accepted.length,
        exceededSoftBudget: elapsedMs > entry.descriptor.softBudgetMs,
      });
    }
    return { candidates, diagnostics, providerCount: entries.length };
  }
}

export function createProviderDescriptor(
  provider: CompletionProvider,
  overrides: Partial<Omit<CompletionProviderDescriptor, 'id'>> = {},
): CompletionProviderDescriptor {
  const structured = isStructuredProvider(provider.id);
  return {
    id: provider.id,
    modes: structured ? ['structured'] : ['predictive'],
    contextCapabilities: structured
      ? ['paragraph', 'heading', 'list', 'quote', 'table']
      : ['paragraph', 'list', 'quote'],
    priorityTier: structured ? 'structured' : inferPriorityTier(provider.priority),
    maxCandidates: 8,
    softBudgetMs: 20,
    feedbackCapability: structured ? 'none' : 'retained',
    dataAccess: inferDataAccess(provider.id),
    genericFallback: provider.id === 'short-english',
    ...overrides,
  };
}

function validateDescriptor(
  provider: CompletionProvider,
  descriptor: CompletionProviderDescriptor,
): void {
  if (!descriptor.id || descriptor.id !== provider.id) {
    throw new Error('Completion provider descriptor ID must match the provider ID');
  }
  if (descriptor.modes.length === 0 || descriptor.contextCapabilities.length === 0) {
    throw new Error(`Completion provider ${descriptor.id} has no declared context capability`);
  }
  if (!Number.isInteger(descriptor.maxCandidates) || descriptor.maxCandidates < 1) {
    throw new Error(`Completion provider ${descriptor.id} has an invalid candidate limit`);
  }
  if (!Number.isFinite(descriptor.softBudgetMs) || descriptor.softBudgetMs <= 0) {
    throw new Error(`Completion provider ${descriptor.id} has an invalid soft budget`);
  }
  if (descriptor.dataAccess.length === 0) {
    throw new Error(`Completion provider ${descriptor.id} has no declared data access`);
  }
}

function freezeDescriptor(descriptor: CompletionProviderDescriptor): CompletionProviderDescriptor {
  return Object.freeze({
    ...descriptor,
    modes: Object.freeze([...descriptor.modes]),
    contextCapabilities: Object.freeze([...descriptor.contextCapabilities]),
    dataAccess: Object.freeze([...descriptor.dataAccess]),
  });
}

function compareRegisteredProviders(a: RegisteredProvider, b: RegisteredProvider): number {
  return (
    priorityTierOrder(b.descriptor.priorityTier) - priorityTierOrder(a.descriptor.priorityTier) ||
    b.provider.priority - a.provider.priority ||
    a.provider.id.localeCompare(b.provider.id)
  );
}

function priorityTierOrder(tier: CompletionProviderDescriptor['priorityTier']): number {
  switch (tier) {
    case 'structured':
      return 5;
    case 'document-session':
      return 4;
    case 'personal-workspace':
      return 3;
    case 'public':
      return 2;
    case 'fallback':
      return 1;
  }
}

function isStructuredProvider(providerId: string): boolean {
  return new Set([
    'format-closure',
    'markdown-structure',
    'wiki-link',
    'tag',
    'file-path',
    'sequence-pattern',
  ]).has(providerId);
}

function inferPriorityTier(priority: number): CompletionProviderDescriptor['priorityTier'] {
  if (priority >= 72) return 'document-session';
  if (priority >= 50) return 'personal-workspace';
  if (priority >= 35) return 'public';
  return 'fallback';
}

function inferDataAccess(providerId: string): CompletionProviderDescriptor['dataAccess'] {
  if (providerId === 'wiki-link' || providerId === 'tag' || providerId === 'file-path') {
    return ['context', 'index'];
  }
  if (providerId === 'ngram') return ['context', 'document', 'personal', 'notebook', 'public'];
  if (providerId === 'recent-phrase' || providerId === 'session-history') {
    return ['context', 'session'];
  }
  if (providerId === 'lexicon') return ['context', 'document', 'session', 'personal', 'index'];
  return ['context'];
}
