use crate::completion_decoder_runtime::DecoderCache;
use std::collections::HashMap;

pub(super) const MAX_DOCUMENT_SESSIONS: usize = 4;
pub(super) const MAX_CACHE_BYTES: usize = 48 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct PrefillCacheIdentity {
    pub(super) candidate_id: String,
    pub(super) model_sha256: String,
    pub(super) tokenizer_sha256: String,
    pub(super) context_protocol: String,
    pub(super) route: String,
    pub(super) language: String,
    pub(super) workspace_scope: String,
    pub(super) editor_session_id: String,
    pub(super) document_session_id: String,
}

impl PrefillCacheIdentity {
    fn session_key(&self) -> (&str, &str, &str) {
        (
            &self.workspace_scope,
            &self.editor_session_id,
            &self.document_session_id,
        )
    }
}

#[derive(Debug)]
struct PrefillCacheEntry {
    identity: PrefillCacheIdentity,
    document_revision: u64,
    request_id: u64,
    tokens: Vec<usize>,
    cache: DecoderCache,
    logits: Vec<f32>,
    bytes: usize,
    last_used: u64,
}

#[derive(Debug)]
pub(super) enum PrefillCacheLookup {
    Miss,
    Invalidated {
        reason: &'static str,
    },
    Reusable {
        cache: DecoderCache,
        logits: Vec<f32>,
        reused_tokens: usize,
    },
}

#[derive(Debug, Default)]
pub(super) struct PrefillCacheStore {
    entries: HashMap<PrefillCacheIdentity, PrefillCacheEntry>,
    total_bytes: usize,
    clock: u64,
}

impl PrefillCacheStore {
    pub(super) fn lookup(
        &mut self,
        identity: &PrefillCacheIdentity,
        tokens: &[usize],
        document_revision: u64,
    ) -> PrefillCacheLookup {
        let Some(entry) = self.entries.get_mut(identity) else {
            return PrefillCacheLookup::Miss;
        };
        let lcp = longest_common_prefix(&entry.tokens, tokens);
        if document_revision < entry.document_revision {
            return PrefillCacheLookup::Invalidated {
                reason: "stale document revision",
            };
        }
        if lcp == 0 {
            return PrefillCacheLookup::Invalidated {
                reason: "cached context has no reusable prefix",
            };
        }
        let Some(cache) = entry.cache.truncate_to(lcp) else {
            return PrefillCacheLookup::Invalidated {
                reason: "cached prefix visibility is invalid",
            };
        };
        self.clock = self.clock.wrapping_add(1);
        entry.last_used = self.clock;
        PrefillCacheLookup::Reusable {
            cache,
            logits: if lcp == entry.tokens.len() {
                entry.logits.clone()
            } else {
                Vec::new()
            },
            reused_tokens: lcp,
        }
    }

    pub(super) fn commit(
        &mut self,
        identity: PrefillCacheIdentity,
        document_revision: u64,
        request_id: u64,
        tokens: Vec<usize>,
        cache: DecoderCache,
        logits: Vec<f32>,
    ) -> bool {
        if self.entries.get(&identity).is_some_and(|entry| {
            entry.document_revision > document_revision || entry.request_id > request_id
        }) {
            return false;
        }
        let bytes = cache
            .estimated_bytes()
            .saturating_add(tokens.len().saturating_mul(std::mem::size_of::<usize>()))
            .saturating_add(logits.len().saturating_mul(std::mem::size_of::<f32>()));
        if bytes > MAX_CACHE_BYTES {
            return false;
        }
        self.remove_entry(&identity);
        self.clock = self.clock.wrapping_add(1);
        self.total_bytes = self.total_bytes.saturating_add(bytes);
        self.entries.insert(
            identity.clone(),
            PrefillCacheEntry {
                identity,
                document_revision,
                request_id,
                tokens,
                cache,
                logits,
                bytes,
                last_used: self.clock,
            },
        );
        self.evict_over_budget();
        true
    }

    pub(super) fn clear(&mut self) {
        self.entries.clear();
        self.total_bytes = 0;
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub(super) fn total_bytes(&self) -> usize {
        self.total_bytes
    }

    fn remove_entry(&mut self, identity: &PrefillCacheIdentity) {
        if let Some(entry) = self.entries.remove(identity) {
            self.total_bytes = self.total_bytes.saturating_sub(entry.bytes);
        }
    }

    fn evict_over_budget(&mut self) {
        while self.session_count() > MAX_DOCUMENT_SESSIONS {
            let oldest_session = self
                .entries
                .values()
                .min_by_key(|entry| entry.last_used)
                .map(|entry| entry.identity.session_key());
            let Some(oldest_session) = oldest_session else {
                break;
            };
            let identities: Vec<_> = self
                .entries
                .values()
                .filter(|entry| entry.identity.session_key() == oldest_session)
                .map(|entry| entry.identity.clone())
                .collect();
            for identity in identities {
                self.remove_entry(&identity);
            }
        }
        while self.total_bytes > MAX_CACHE_BYTES {
            let oldest = self
                .entries
                .values()
                .min_by_key(|entry| entry.last_used)
                .map(|entry| entry.identity.clone());
            let Some(oldest) = oldest else {
                break;
            };
            self.remove_entry(&oldest);
        }
    }

    fn session_count(&self) -> usize {
        let mut sessions = Vec::new();
        for entry in self.entries.values() {
            if !sessions.contains(&entry.identity.session_key()) {
                sessions.push(entry.identity.session_key());
            }
        }
        sessions.len()
    }
}

pub(super) fn longest_common_prefix(left: &[usize], right: &[usize]) -> usize {
    left.iter()
        .zip(right)
        .take_while(|(left, right)| left == right)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(document_session_id: &str) -> PrefillCacheIdentity {
        PrefillCacheIdentity {
            candidate_id: "candidate".to_string(),
            model_sha256: "a".repeat(64),
            tokenizer_sha256: "b".repeat(64),
            context_protocol: "protocol-v2".to_string(),
            route: "writing".to_string(),
            language: "en".to_string(),
            workspace_scope: "workspace".to_string(),
            editor_session_id: "editor".to_string(),
            document_session_id: document_session_id.to_string(),
        }
    }

    #[test]
    fn exact_lcp_is_utf8_independent_token_comparison() {
        assert_eq!(longest_common_prefix(&[1, 2, 3], &[1, 2, 4]), 2);
        assert_eq!(longest_common_prefix(&[1, 2], &[1, 2, 3]), 2);
        assert_eq!(longest_common_prefix(&[], &[1]), 0);
    }

    #[test]
    fn reuses_an_arbitrary_exact_lcp_and_evicts_old_document_sessions() {
        let mut store = PrefillCacheStore::default();
        let cache = DecoderCache::with_visible_tokens_for_test(2);
        assert!(store.commit(
            identity("document-0"),
            1,
            1,
            vec![1, 2],
            cache.clone(),
            Vec::new(),
        ));
        assert!(matches!(
            store.lookup(&identity("document-0"), &[1, 2, 3], 2),
            PrefillCacheLookup::Reusable {
                reused_tokens: 2,
                ..
            }
        ));
        assert!(matches!(
            store.lookup(&identity("document-0"), &[1, 9], 2),
            PrefillCacheLookup::Reusable {
                reused_tokens: 1,
                ..
            }
        ));
        for index in 1_usize..=4_usize {
            assert!(store.commit(
                identity(&format!("document-{index}")),
                1,
                (index + 1) as u64,
                vec![index],
                cache.clone(),
                Vec::new(),
            ));
        }
        assert_eq!(store.len(), MAX_DOCUMENT_SESSIONS);
        assert!(store.total_bytes() > 0);
        store.clear();
        assert_eq!(store.len(), 0);
    }
}
