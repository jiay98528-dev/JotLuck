# V2 Free Decoder Holdouts

This directory intentionally contains no observed checkpoint data.

- Freeze a new 200-checkpoint cold validation/final pair and a separate
  200-checkpoint workspace validation/final pair.
- Every suite contains 150 `complete` and 50 `silence` checkpoints, balanced
  across Chinese and English.
- Validation may be rerun. Each final is consumed once through
  `consumeV2FreeFinalOnce`; an attempted read permanently creates the candidate
  consumption ledger even if evaluation later fails.
- Existing V2/V2R/V2S observed holdouts are regression-only and cannot be
  copied here or counted as a new final.
- Raw holdout data is local evidence and remains ignored until a separate
  freeze operation records its exact SHA-256.
