# Software development autocomplete patterns

When debugging the issue, record the input state first.
When debugging the issue, check the failing test first.
When debugging the issue, isolate the smallest case.
When debugging the issue, compare the expected result with the actual result.
When debugging the issue, verify the reproduction steps before changing code.
When debugging the issue, keep the fix small and observable.
When debugging the issue, write down the root cause before the patch.
When debugging the issue, add a regression test after the fix.
When debugging the issue, confirm that the error is not caused by stale cache.
When debugging the issue, check whether the state was captured too late.
When debugging the issue, inspect the boundary between UI state and persisted data.
When debugging the issue, prefer a minimal failing example over a broad rewrite.

The issue is caused by stale state.
The issue is caused by missing validation.
The issue is caused by an async race.
The issue is caused by a stale cache entry.
The issue is caused by a missing null check.
The issue is caused by a mismatched path.
The issue is caused by a repeated event handler.
The issue is caused by a delayed callback.
The issue is caused by a hidden dependency.
The issue is caused by a weak test boundary.

The fix is to snapshot the current path.
The fix is to reject the invalid candidate.
The fix is to keep the provider quiet.
The fix is to reset the stale state.
The fix is to add a regression test.
The fix is to validate the input before writing.
The fix is to keep the completion on the same line.
The fix is to suppress the same suggestion after Escape.
The fix is to separate the structured result from text learning.
The fix is to keep the implementation small and verifiable.

Project status is ready for review.
Project status is blocked by one failing test.
Project status is waiting for manual verification.
Project status is stable after the last patch.
Project status is improving after the corpus update.
Project status is on track for the next validation pass.
Project status is safe to continue after the regression test passes.
Project status is not ready until the quality score is visible.

The main risk is configuration drift before release.
The main risk is a silent fallback hiding the model result.
The main risk is a low value candidate appearing too often.
The main risk is a mixed language suggestion in an English context.
The main risk is a long suggestion interrupting the writer.
The main risk is a path completion using a fuzzy match.
The main risk is a test that checks visibility but not usefulness.
The main risk is a corpus sample that teaches web boilerplate.

The expected result is visible in the editor.
The expected result is recorded in the report.
The expected result is a short same line suggestion.
The expected result is a quiet fallback when confidence is low.
The expected result is a structured completion taking priority.
The expected result is no suggestion inside a code fence.
The expected result is no suggestion inside frontmatter.
The expected result is no mixed language candidate.

Test result is passing after the cache reset.
Test result is passing after the model is regenerated.
Test result is passing after the provider order is preserved.
Test result is passing after the stale ghost text is cleared.
Test result is passing after the negative probe stays quiet.
Test result is passing after the interaction path is isolated.
Test result is passing after the same line constraint is enforced.
Test result is passing after the fallback is separated from the model hit.

Before release, verify the default model path.
Before release, verify the fallback model path.
Before release, verify the model byte size.
Before release, verify the training report.
Before release, verify the language distribution.
Before release, verify the negative probes.
Before release, verify the structured completions.
Before release, verify the Escape behavior.
Before release, verify the Tab acceptance path.
Before release, verify that the editor starts before the baseline finishes loading.

During review, check the changed files first.
During review, check the behavioral surface.
During review, check the failing assertion.
During review, check the user visible result.
During review, check the data flow from input to output.
During review, check the boundary between model and resolver.
During review, check that the fallback does not hide a regression.
During review, check that the test covers the interaction, not only the DOM.

If the test fails, read the failure report first.
If the test fails, preserve the observed output.
If the test fails, reproduce the smallest case.
If the test fails, decide whether the test or the runtime is wrong.
If the test fails, fix the cause instead of lowering the score.
If the test fails, run the focused command again.
If the test fails, keep the generated artifacts out of the commit.

If the candidate is too long, reject it.
If the candidate is mixed language, reject it.
If the candidate is web boilerplate, reject it.
If the candidate is only a function word, reject it.
If the candidate starts with the wrong language, reject it.
If the candidate crosses a line boundary, reject it.
If the candidate appears after Escape at the same cursor, suppress it.
If the candidate comes from a structured provider, do not train it as prose.

Implementation note should include the reason.
Implementation note should include the tradeoff.
Implementation note should include the verification command.
Implementation note should include the remaining risk.
Implementation note should include the user visible behavior.
Implementation note should include the exact failure mode.
Implementation note should include the fallback path.
Implementation note should include the expected next step.

Regression coverage should include a positive probe.
Regression coverage should include a negative probe.
Regression coverage should include the acceptance path.
Regression coverage should include the rejection path.
Regression coverage should include a language boundary.
Regression coverage should include a structured context.
Regression coverage should include a corrupted cache case.
Regression coverage should include a performance threshold.

The provider should stay quiet when confidence is low.
The provider should return a short suggestion.
The provider should keep the suggestion on the same line.
The provider should prefer structured contexts.
The provider should avoid web boilerplate.
The provider should avoid mixed language output.
The provider should learn only accepted prose.
The provider should keep rejected suggestions quiet.

The resolver should rank structured candidates first.
The resolver should reject low value single words.
The resolver should reject English residue in Chinese text.
The resolver should reject Chinese text in an English context.
The resolver should trim noisy English continuations.
The resolver should keep the editor calm.
The resolver should favor recent local phrases.
The resolver should not override a precise path completion.

Quality score should reflect hit rate.
Quality score should reflect semantic usefulness.
Quality score should reflect false triggers.
Quality score should reflect visible latency.
Quality score should reflect mixed language failures.
Quality score should reflect structured completion stability.
Quality score should reflect Tab acceptance.
Quality score should reflect Escape rejection.
