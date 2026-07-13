import { canonicalSha256, sha256 } from './common';
import {
  validateV2RCorpusSelection,
  type V2RCorpusCandidate,
  type V2RCorpusSelectionManifest,
} from './corpus-governance';
import { validateV2RHoldoutV3, type V2RHoldoutV3 } from './holdout-v3';

export interface V2RFinalOverlapAudit {
  schema: 'jotluck.autocomplete.v2r-final-overlap-audit.v1';
  schemaVersion: 1;
  auditorVersion: 'corpus-governance-v2r-v1';
  selectionSha256: string;
  inputTreeSha256: string;
  finalHoldoutTreeSha256: string;
  finalHoldoutInputTreeSha256: string;
  finalHoldoutDocumentsAudited: number;
  holdoutExactOverlaps: 0;
  holdoutNearOverlaps: 0;
  passed: true;
  reportSha256: string;
}

/**
 * Runs only after the candidate identity and both final holdout hashes have
 * been irreversibly claimed. This preserves final blindness during corpus
 * generation/training while still making train-final overlap a release gate.
 */
export function auditV2RFinalHoldoutOverlap(
  selection: V2RCorpusSelectionManifest,
  documents: readonly V2RCorpusCandidate[],
  finalHoldouts: readonly V2RHoldoutV3[],
): V2RFinalOverlapAudit {
  if (finalHoldouts.length !== 2) {
    throw new Error('V2R final overlap audit requires cold and workspace final holdouts.');
  }
  const expected = new Set(['cold-final-v3', 'workspace-final-v3']);
  const holdoutDocuments: Array<{ id: string; text: string }> = [];
  const identities: Array<{ classification: string; datasetSha256: string }> = [];
  for (const holdout of finalHoldouts) {
    const audit = validateV2RHoldoutV3(holdout);
    if (!expected.delete(holdout.classification)) {
      throw new Error(`Unexpected V2R final holdout: ${holdout.classification}.`);
    }
    identities.push({
      classification: holdout.classification,
      datasetSha256: audit.datasetSha256,
    });
    holdoutDocuments.push(
      ...holdout.targets.map((target) => ({
        id: `${holdout.classification}:target:${target.id}`,
        text: target.text,
      })),
      ...holdout.supportDocuments.map((support) => ({
        id: `${holdout.classification}:support:${support.id}`,
        text: support.text,
      })),
    );
  }
  if (expected.size !== 0) {
    throw new Error(`V2R final overlap audit is missing: ${[...expected].join(', ')}.`);
  }

  const governance = validateV2RCorpusSelection(selection, documents, holdoutDocuments, {
    requireComplete: true,
    enforceQuotas: true,
  });
  if (governance.holdoutExactOverlaps !== 0 || governance.holdoutNearOverlaps !== 0) {
    throw new Error('V2R final holdout overlaps the frozen training selection.');
  }
  const inputTreeSha256 = canonicalSha256(
    selection.documents
      .map((document) => ({ id: document.documentId, sha256: document.sha256 }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const finalHoldoutInputTreeSha256 = canonicalSha256(
    holdoutDocuments
      .map((document) => ({ id: document.id, sha256: sha256(document.text) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const withoutHash = {
    schema: 'jotluck.autocomplete.v2r-final-overlap-audit.v1' as const,
    schemaVersion: 1 as const,
    auditorVersion: 'corpus-governance-v2r-v1' as const,
    selectionSha256: selection.selectionSha256,
    inputTreeSha256,
    finalHoldoutTreeSha256: canonicalSha256(
      identities.sort((left, right) => left.classification.localeCompare(right.classification)),
    ),
    finalHoldoutInputTreeSha256,
    finalHoldoutDocumentsAudited: holdoutDocuments.length,
    holdoutExactOverlaps: 0 as const,
    holdoutNearOverlaps: 0 as const,
    passed: true as const,
  };
  return { ...withoutHash, reportSha256: canonicalSha256(withoutHash) };
}
