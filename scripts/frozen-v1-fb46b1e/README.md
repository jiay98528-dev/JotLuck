# Frozen V1 evaluation snapshot

This directory is an evaluation-only snapshot of the autocomplete engine at
commit `fb46b1e`. The source files are copied from that commit. The only source
change is the guarded observer in `completion/resolver.ts`, applied after the
original stable sort; it cannot alter Top-1 selection.

`model.compact.txt.gz` is the deterministic gzip representation of the exact
legacy public model. The independent runner receives one frozen holdout over
stdin and writes JSON to stdout. Production code must never import this tree.

Run `pnpm exec tsx --tsconfig scripts/frozen-v1-fb46b1e/tsconfig.json
scripts/frozen-v1-fb46b1e/runner.ts` only through the adapter, which verifies
the checked-in manifest before starting the child process.
