//! Personal-prior shallow fusion for the V2.5 one-unit writing engine.
//!
//! The host sends a bounded set of context-conditioned phrases the user
//! actually retained. Each phrase is tokenized exactly the way the tokenizer
//! would continue the current serialized context (`context + phrase`, suffix
//! past the context LCP), so prior token sequences align with generated
//! tokens by construction. During beam expansion the next-token continuations
//! of live matches are injected into the ranked choice set (so a user phrase
//! the model itself ranks far below top-k can still surface), and every
//! matched token adds a bounded `fusion_weight * phrase_weight` bonus to the
//! *selection* score only. `log_probability`/`normalized_score` stay pure
//! model values, so reported confidence and host visibility gates remain
//! calibrated. An empty prior disables the automaton and leaves selection
//! scores bit-identical to the baseline search.

use crate::completion_decoder::DecoderPersonalPrior;
use crate::completion_decoder_runtime::DecoderRuntime;

pub(super) const MAX_PERSONAL_PHRASES: usize = 8;
pub(super) const MAX_PERSONAL_PHRASE_CODE_POINTS: usize = 24;

pub(super) struct PriorAutomaton {
    phrases: Vec<PriorPhrase>,
    fusion_weight: f32,
}

#[derive(Clone)]
struct PriorPhrase {
    token_ids: Vec<usize>,
    weight: f32,
}

/// Live matcher state carried by every beam/choice. Empty `active` with
/// `starts_allowed` means every phrase may still match its first token; once
/// one generated token has been consumed the state freezes to the matched
/// subset (one-unit generation completes a single lexical unit, so a phrase
/// never restarts mid-unit).
#[derive(Clone, Debug, PartialEq)]
pub(super) struct BeamPriorState {
    bonus: f32,
    active: Vec<(usize, usize)>,
    starts_allowed: bool,
}

impl Default for BeamPriorState {
    fn default() -> Self {
        Self::start()
    }
}

impl BeamPriorState {
    pub(super) fn start() -> Self {
        Self {
            bonus: 0.0,
            active: Vec::new(),
            starts_allowed: true,
        }
    }

    pub(super) fn bonus(&self) -> f32 {
        self.bonus
    }
}

impl PriorAutomaton {
    pub(super) fn disabled() -> Self {
        Self {
            phrases: Vec::new(),
            fusion_weight: 0.0,
        }
    }

    pub(super) fn is_enabled(&self) -> bool {
        !self.phrases.is_empty()
    }

    /// Token ids whose selection would continue a live phrase; at a fresh
    /// state these are the phrases' first tokens. Used to widen the ranked
    /// beam-expansion set beyond the model's own top-k.
    pub(super) fn injectable_token_ids(&self, state: &BeamPriorState) -> Vec<usize> {
        let mut ids = Vec::with_capacity(self.phrases.len());
        let push = |token_id: usize, ids: &mut Vec<usize>| {
            if !ids.contains(&token_id) {
                ids.push(token_id);
            }
        };
        if state.starts_allowed {
            for phrase in &self.phrases {
                if let Some(&token_id) = phrase.token_ids.first() {
                    push(token_id, &mut ids);
                }
            }
            return ids;
        }
        for &(index, matched) in &state.active {
            if let Some(phrase) = self.phrases.get(index) {
                if let Some(&token_id) = phrase.token_ids.get(matched) {
                    push(token_id, &mut ids);
                }
            }
        }
        ids
    }

    /// Advance the matcher with the chosen token and return the next state.
    /// A phrase that stops matching keeps its accumulated bonus but never
    /// becomes active again.
    ///
    /// Bonus schedule: the FIRST matched token pays double (one-unit
    /// generation decides the whole lexical unit on its first token), every
    /// later matched token pays single, and completing a phrase pays one more
    /// single bonus as emphasis. A one-token phrase therefore totals
    /// `3·λ·w`, a two-token phrase `4·λ·w`.
    pub(super) fn advance(&self, state: &BeamPriorState, token_id: usize) -> BeamPriorState {
        if self.phrases.is_empty() {
            return state.clone();
        }
        let mut next = BeamPriorState {
            bonus: state.bonus,
            active: Vec::new(),
            starts_allowed: false,
        };
        let consume = |index: usize, matched: usize, next: &mut BeamPriorState| {
            let phrase = &self.phrases[index];
            let step_weight = if matched == 1 { 2.0 } else { 1.0 };
            next.bonus += self.fusion_weight * phrase.weight * step_weight;
            if matched == phrase.token_ids.len() {
                // Full phrase matched: pay the completion emphasis.
                next.bonus += self.fusion_weight * phrase.weight;
            } else {
                next.active.push((index, matched));
            }
        };
        if state.starts_allowed {
            for (index, phrase) in self.phrases.iter().enumerate() {
                if phrase.token_ids.first() == Some(&token_id) {
                    consume(index, 1, &mut next);
                }
            }
        }
        for &(index, matched) in &state.active {
            if let Some(phrase) = self.phrases.get(index) {
                if matched < phrase.token_ids.len() && phrase.token_ids[matched] == token_id {
                    consume(index, matched + 1, &mut next);
                }
            }
        }
        next
    }
}

/// Build the automaton for a request. Phrases whose combined tokenization
/// does not strictly extend the context tokenization (piece merge across the
/// cursor boundary, or an empty continuation) are dropped — a dropped phrase
/// can never match, which is the safe fallback.
pub(super) fn build_prior_automaton(
    runtime: &DecoderRuntime,
    prior: Option<&DecoderPersonalPrior>,
    serialized_context: &str,
    context_tokens: &[usize],
    reserved_tokens: usize,
    maximum_prompt_tokens: usize,
) -> PriorAutomaton {
    let Some(prior) = prior else {
        return PriorAutomaton::disabled();
    };
    if prior.phrases.is_empty() || !prior.fusion_weight.is_finite() || prior.fusion_weight <= 0.0 {
        return PriorAutomaton::disabled();
    }
    let fusion_weight = prior.fusion_weight.min(1.0);
    let mut phrases: Vec<PriorPhrase> = Vec::new();
    for phrase in prior.phrases.iter().take(MAX_PERSONAL_PHRASES) {
        if phrase.text.is_empty() || !phrase.weight.is_finite() || phrase.weight <= 0.0 {
            continue;
        }
        let Some(token_ids) = continuation_token_ids(
            runtime,
            serialized_context,
            context_tokens,
            &phrase.text,
            reserved_tokens,
            maximum_prompt_tokens,
        ) else {
            continue;
        };
        if phrases
            .iter()
            .any(|existing| existing.token_ids == token_ids)
        {
            continue;
        }
        phrases.push(PriorPhrase {
            token_ids,
            weight: phrase.weight.min(1.0),
        });
    }
    if phrases.is_empty() {
        return PriorAutomaton::disabled();
    }
    PriorAutomaton {
        phrases,
        fusion_weight,
    }
}

fn continuation_token_ids(
    runtime: &DecoderRuntime,
    serialized_context: &str,
    context_tokens: &[usize],
    phrase: &str,
    reserved_tokens: usize,
    maximum_prompt_tokens: usize,
) -> Option<Vec<usize>> {
    let combined_text = format!("{serialized_context}{phrase}");
    let combined = runtime.encode_generation_context_with_limit(
        &combined_text,
        reserved_tokens,
        maximum_prompt_tokens,
    );
    if combined.len() <= context_tokens.len() {
        return None;
    }
    if combined[..context_tokens.len()] != context_tokens[..] {
        return None;
    }
    Some(combined[context_tokens.len()..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phrase(token_ids: &[usize], weight: f32) -> PriorPhrase {
        PriorPhrase {
            token_ids: token_ids.to_vec(),
            weight,
        }
    }

    fn automaton(phrases: &[PriorPhrase], fusion_weight: f32) -> PriorAutomaton {
        PriorAutomaton {
            phrases: phrases.to_vec(),
            fusion_weight,
        }
    }

    #[test]
    fn disabled_automaton_is_inert() {
        let automaton = PriorAutomaton::disabled();
        assert!(!automaton.is_enabled());
        let state = BeamPriorState::start();
        assert!(automaton.injectable_token_ids(&state).is_empty());
        let advanced = automaton.advance(&state, 42);
        assert_eq!(advanced.bonus(), 0.0);
        assert_eq!(advanced, state);
    }

    #[test]
    fn fresh_state_injects_first_tokens_without_duplicates() {
        let automaton = automaton(
            &[
                phrase(&[7, 8], 1.0),
                phrase(&[7, 9], 0.5),
                phrase(&[11], 0.4),
            ],
            0.5,
        );
        assert_eq!(
            automaton.injectable_token_ids(&BeamPriorState::start()),
            vec![7, 11]
        );
    }

    #[test]
    fn match_accumulates_bonus_and_completion_emphasis() {
        let automaton = automaton(&[phrase(&[3, 4], 1.0)], 0.2);
        let started = automaton.advance(&BeamPriorState::start(), 3);
        assert_eq!(started.bonus(), 0.4); // first token pays double
        assert_eq!(started.active, vec![(0, 1)]);
        assert_eq!(automaton.injectable_token_ids(&started), vec![4]);
        let completed = automaton.advance(&started, 4);
        assert_eq!(completed.bonus(), 0.8); // first 0.4 + per-token 0.2 + completion 0.2
        assert!(completed.active.is_empty());
        assert!(automaton.injectable_token_ids(&completed).is_empty());
    }

    #[test]
    fn mismatch_freezes_phrase_but_keeps_bonus() {
        let automaton = automaton(&[phrase(&[3, 4], 1.0)], 0.2);
        let started = automaton.advance(&BeamPriorState::start(), 3);
        let mismatched = automaton.advance(&started, 99);
        assert_eq!(mismatched.bonus(), 0.4);
        assert!(mismatched.active.is_empty());
        assert!(automaton.injectable_token_ids(&mismatched).is_empty());
        let further = automaton.advance(&mismatched, 4);
        assert_eq!(further.bonus(), 0.4);
    }

    #[test]
    fn shared_prefix_phrases_track_independently() {
        let automaton = automaton(&[phrase(&[5, 6], 1.0), phrase(&[5, 7], 0.5)], 1.0);
        let started = automaton.advance(&BeamPriorState::start(), 5);
        assert_eq!(started.active, vec![(0, 1), (1, 1)]);
        let mut ids = automaton.injectable_token_ids(&started);
        ids.sort_unstable();
        assert_eq!(ids, vec![6, 7]);
        // Choosing 7 completes phrase 1 (0.5 per-token + 0.5 completion) and
        // mismatches phrase 0, whose doubled 2.0 start bonus is kept.
        let finished = automaton.advance(&started, 7);
        assert!(finished.active.is_empty());
        assert_eq!(finished.bonus(), 2.0 + 1.0 + 0.5 + 0.5);
    }

    #[test]
    fn default_state_is_fresh_start() {
        let automaton = automaton(&[phrase(&[1], 1.0)], 1.0);
        assert_eq!(
            PriorAutomaton::disabled().advance(&BeamPriorState::default(), 1),
            BeamPriorState::default()
        );
        assert_eq!(
            automaton.injectable_token_ids(&BeamPriorState::default()),
            vec![1]
        );
    }
}
