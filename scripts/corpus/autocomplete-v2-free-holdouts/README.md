# V2 Free Decoder Holdouts

This directory is reserved for public, irreversible metadata for reviewed holdouts. Raw checkpoint
content remains in the local ignored holdout vault and is never committed.

- Freeze a new 200-checkpoint cold validation/final pair and a separate
  200-checkpoint workspace validation/final pair.
- Every suite contains 150 `complete` and 50 `silence` checkpoints, balanced
  across Chinese and English.
- Validation may be rerun. Each final is consumed once through
  `consumeV2FreeFinalOnce`; an attempted read permanently creates the candidate
  consumption ledger even if evaluation later fails.
- Existing V2/V2R/V2S observed holdouts are regression-only and cannot be
  copied here or counted as a new final.
- Descriptor schema v1 remains readable only for legacy diagnostics. The publisher accepts only
  schema v2 and never upgrades a v1 `humanReviewed` claim.
- Schema v2 records either a human review (including a reviewer identity hash) or an independent
  model review. Independent-model review is development-only and must set
  `formalReleaseEvidence: false`.
- No V2.2 descriptor or fingerprint inventory is currently published. The previous unreviewed
  metadata was withdrawn; new metadata waits for the validation/final review before freezing.
- Publishing metadata never reads or copies `content.json`. Final descriptors stay sealed until a
  separate final-pair claim authorizes evaluation.
