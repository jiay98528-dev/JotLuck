# Debugging note autocomplete patterns

When debugging the issue, record the input state first.
When debugging the issue, reproduce the smallest failing case.
When debugging the issue, compare the expected result with the actual result.
When debugging the issue, check whether the cached value is stale.
When debugging the issue, inspect the event order before changing code.
When debugging the issue, preserve the observed failure message.
When debugging the issue, write down the root cause before editing.
When debugging the issue, keep the patch small and easy to verify.
When debugging the issue, add a regression test for the exact path.
When debugging the issue, check the boundary between provider and resolver.
When debugging the issue, confirm that the ghost text is still same line.
When debugging the issue, verify that Escape suppresses the same suggestion.
When debugging the issue, verify that Tab accepts only visible ghost text.
When debugging the issue, check the language hint before trusting the model.
When debugging the issue, keep the fallback separate from the model hit.
When debugging the issue, read the training report before tuning weights.
When debugging the issue, check whether the source fragment is too noisy.
When debugging the issue, avoid a broad rewrite until the cause is visible.

Root cause is a stale cursor snapshot.
Root cause is a missing language gate.
Root cause is a fallback with low value text.
Root cause is a provider returning a cross line candidate.
Root cause is a fuzzy path match entering ghost text.
Root cause is a model context learned from web boilerplate.
Root cause is a training fragment crossing a paragraph boundary.
Root cause is a test that only checks visibility.
Root cause is a resolver score that trusts a single character.
Root cause is a corpus file with too many generic phrases.
Root cause is a local model loaded after the first prediction.
Root cause is a rejected candidate still visible at the same cursor.
Root cause is a short phrase that starts with the wrong language.
Root cause is a sequence pattern that crosses a blank line.

The fix is to tighten the quality gate.
The fix is to add a focused regression test.
The fix is to keep structured completion ahead of text completion.
The fix is to train from clean fragments only.
The fix is to discard mixed language fragments.
The fix is to prefer short note phrases over generic web text.
The fix is to change the fallback to a useful next word.
The fix is to keep the candidate on the current line.
The fix is to reject boilerplate contexts before scoring.
The fix is to increase curated corpus coverage.
The fix is to keep the model under the byte limit.
The fix is to report partial training failures clearly.
The fix is to verify the same case in the browser.
The fix is to rerun the focused autocomplete quality test.

Debug note: input state is captured before prediction.
Debug note: cursor position matches the editor selection.
Debug note: context builder detects the current syntax type.
Debug note: resolver rejects the mixed language candidate.
Debug note: provider metrics record visible suggestions.
Debug note: local training updates only accepted prose.
Debug note: structured completions are not written to ngram memory.
Debug note: model fallback is loaded after the default compact file fails.
Debug note: clean corpus is scanned fragment by fragment.
Debug note: negative probes stay quiet after the resolver update.
Debug note: sequence patterns stop after a blank line.
Debug note: English contexts do not receive Chinese candidates.
Debug note: Chinese contexts do not receive Latin candidates.
Debug note: manual typing should not feel interrupted.

Check the reproduction steps before changing the provider.
Check the editor state before reading the ghost layer.
Check the selection state before accepting Tab.
Check the document text before learning a phrase.
Check the report size before committing a compact model.
Check the category balance before adding more web corpus.
Check the top contexts before trusting the score.
Check the rejected examples before relaxing the threshold.
Check the visible result before marking the test complete.
Check the exact probe before changing fallback text.
Check the language hint before applying the ngram result.
Check the provider id before recording training metrics.
Check the local storage schema before loading old entries.

If the candidate is too long, reject it.
If the candidate crosses a line, reject it.
If the candidate starts with the wrong language, reject it.
If the candidate is only a function word, reject it.
If the candidate looks like a web call to action, reject it.
If the candidate repeats the current word, reject it.
If the candidate appears after Escape at the same cursor, suppress it.
If the candidate comes from a structured provider, do not learn it.
If the candidate is useful after Tab, record the saved characters.
If the candidate is rejected often, lower its confidence.
If the candidate is from recent prose, keep it short.
If the candidate is from baseline, keep it quiet.

Expected result is a useful short suggestion.
Expected result is no suggestion after a sentence period.
Expected result is no suggestion inside a code fence.
Expected result is no suggestion inside frontmatter.
Expected result is a sequence suggestion on a fresh list line.
Expected result is a path suggestion only for a prefix match.
Expected result is a tag suggestion only inside tag context.
Expected result is a wiki suggestion only inside wiki context.
Expected result is a stable score in the quality report.
Expected result is a compact model below the hard limit.
Expected result is a model hit for common note anchors.
Expected result is a fallback only when the model is quiet.
