export type CompletionFeedbackState =
  | 'shown'
  | 'accepted'
  | 'retained'
  | 'modified'
  | 'reverted'
  | 'explicitRejected'
  | 'abandoned';

export interface CompletionFeedbackRecord<TBinding> {
  token: string;
  state: CompletionFeedbackState;
  binding: TBinding;
  shownAt: number;
  acceptedAt: number | null;
  settledAt: number | null;
}

type AcceptedSettlement = 'retained' | 'modified' | 'reverted';
type ShownSettlement = 'explicitRejected' | 'abandoned';

/**
 * Bounded in-memory state machine. Persistence belongs to the learning layer
 * and is only permitted after a `retained` settlement.
 */
export class CompletionFeedbackLifecycle<TBinding> {
  private readonly records = new Map<string, CompletionFeedbackRecord<TBinding>>();

  constructor(
    private readonly maxRecords = 64,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!Number.isInteger(maxRecords) || maxRecords < 1) {
      throw new Error('Completion feedback record limit must be a positive integer');
    }
  }

  shown(token: string, binding: TBinding): CompletionFeedbackRecord<TBinding> {
    if (!token || this.records.has(token)) throw new Error('Duplicate completion feedback token');
    const record: CompletionFeedbackRecord<TBinding> = {
      token,
      state: 'shown',
      binding,
      shownAt: this.now(),
      acceptedAt: null,
      settledAt: null,
    };
    this.records.set(token, record);
    this.prune();
    return record;
  }

  accept(token: string): CompletionFeedbackRecord<TBinding> | null {
    const record = this.records.get(token);
    if (!record || record.state !== 'shown') return null;
    const next = { ...record, state: 'accepted' as const, acceptedAt: this.now() };
    this.records.set(token, next);
    return next;
  }

  settleAccepted(
    token: string,
    state: AcceptedSettlement,
  ): CompletionFeedbackRecord<TBinding> | null {
    const record = this.records.get(token);
    if (!record || record.state !== 'accepted') return null;
    this.records.delete(token);
    return { ...record, state, settledAt: this.now() };
  }

  settleShown(token: string, state: ShownSettlement): CompletionFeedbackRecord<TBinding> | null {
    const record = this.records.get(token);
    if (!record || record.state !== 'shown') return null;
    this.records.delete(token);
    return { ...record, state, settledAt: this.now() };
  }

  get(token: string): CompletionFeedbackRecord<TBinding> | null {
    return this.records.get(token) ?? null;
  }

  clear(): void {
    this.records.clear();
  }

  get size(): number {
    return this.records.size;
  }

  private prune(): void {
    while (this.records.size > this.maxRecords) {
      const first = this.records.keys().next().value as string | undefined;
      if (!first) return;
      this.records.delete(first);
    }
  }
}
