use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

const TOKENIZER_SCHEMA: &str = "jotluck.autocomplete.unigram-runtime.v1";
const EXPECTED_VOCABULARY_SIZE: usize = 8_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenizerAsset {
    schema: String,
    vocabulary_size: usize,
    normalization: String,
    dummy_prefix: bool,
    collapse_whitespace: bool,
    special_ids: SpecialIds,
    pieces: Vec<PieceAsset>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpecialIds {
    pad: usize,
    unknown: usize,
    bos: usize,
    eos: usize,
}

#[derive(Debug, Deserialize)]
struct PieceAsset {
    id: usize,
    piece: String,
    score: f64,
    #[serde(rename = "type")]
    piece_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PieceKind {
    Normal,
    Unknown,
    Control,
    Byte,
    Unused,
    UserDefined,
}

impl PieceKind {
    fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().replace(['_', '-'], "").as_str() {
            "normal" => Some(Self::Normal),
            "unknown" | "unk" => Some(Self::Unknown),
            "control" => Some(Self::Control),
            "byte" => Some(Self::Byte),
            "unused" => Some(Self::Unused),
            "userdefined" => Some(Self::UserDefined),
            _ => None,
        }
    }

    fn participates_in_unigram(self) -> bool {
        matches!(self, Self::Normal | Self::UserDefined)
    }
}

#[derive(Debug)]
struct Piece {
    text: String,
    score: f64,
    kind: PieceKind,
}

#[derive(Debug, Default)]
struct TrieNode {
    children: HashMap<u8, usize>,
    terminal: Vec<usize>,
}

#[derive(Debug)]
pub(crate) struct UnigramTokenizer {
    pieces: Vec<Piece>,
    trie: Vec<TrieNode>,
    byte_ids: [usize; 256],
    pad_id: usize,
    unknown_id: usize,
    bos_id: usize,
    eos_id: usize,
    dummy_prefix: bool,
    collapse_whitespace: bool,
}

#[derive(Clone)]
struct BackPointer {
    start: usize,
    token_ids: Vec<usize>,
}

type TieBreaker = (isize, usize, Vec<usize>);

impl UnigramTokenizer {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        let bytes =
            fs::read(path).map_err(|error| format!("unable to read decoder tokenizer: {error}"))?;
        let asset: TokenizerAsset = serde_json::from_slice(&bytes)
            .map_err(|error| format!("invalid decoder tokenizer JSON: {error}"))?;
        Self::from_asset(asset)
    }

    fn from_asset(asset: TokenizerAsset) -> Result<Self, String> {
        if asset.schema != TOKENIZER_SCHEMA
            || asset.vocabulary_size != EXPECTED_VOCABULARY_SIZE
            || asset.normalization != "nfkc"
            || asset.pieces.len() != EXPECTED_VOCABULARY_SIZE
        {
            return Err("decoder tokenizer contract is invalid".to_string());
        }
        let special = [
            asset.special_ids.pad,
            asset.special_ids.unknown,
            asset.special_ids.bos,
            asset.special_ids.eos,
        ];
        if special.iter().any(|id| *id >= asset.pieces.len())
            || special.into_iter().collect::<HashSet<_>>().len() != 4
        {
            return Err("decoder tokenizer special ids are invalid".to_string());
        }

        let mut ordered: Vec<Option<Piece>> = (0..asset.pieces.len()).map(|_| None).collect();
        for item in asset.pieces {
            let kind = PieceKind::parse(&item.piece_type)
                .ok_or_else(|| "decoder tokenizer piece type is invalid".to_string())?;
            if item.id >= ordered.len()
                || ordered[item.id].is_some()
                || item.piece.is_empty()
                || !item.score.is_finite()
            {
                return Err("decoder tokenizer piece identity is invalid".to_string());
            }
            ordered[item.id] = Some(Piece {
                text: item.piece,
                score: item.score,
                kind,
            });
        }
        let pieces = ordered
            .into_iter()
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| "decoder tokenizer ids are not contiguous".to_string())?;
        if pieces[asset.special_ids.pad].kind != PieceKind::Control
            || pieces[asset.special_ids.unknown].kind != PieceKind::Unknown
            || pieces[asset.special_ids.bos].kind != PieceKind::Control
            || pieces[asset.special_ids.eos].kind != PieceKind::Control
        {
            return Err("decoder tokenizer special piece types are invalid".to_string());
        }

        let mut byte_ids = [usize::MAX; 256];
        let mut trie = vec![TrieNode::default()];
        for (id, piece) in pieces.iter().enumerate() {
            if piece.kind == PieceKind::Byte {
                let value = parse_byte_piece(&piece.text)
                    .ok_or_else(|| "decoder tokenizer byte piece is invalid".to_string())?;
                if byte_ids[value as usize] != usize::MAX {
                    return Err("decoder tokenizer byte pieces are duplicated".to_string());
                }
                byte_ids[value as usize] = id;
            }
            if piece.kind.participates_in_unigram() {
                let mut node = 0;
                for byte in piece.text.as_bytes() {
                    let next = if let Some(existing) = trie[node].children.get(byte) {
                        *existing
                    } else {
                        let index = trie.len();
                        trie.push(TrieNode::default());
                        trie[node].children.insert(*byte, index);
                        index
                    };
                    node = next;
                }
                trie[node].terminal.push(id);
            }
        }
        if byte_ids.contains(&usize::MAX) {
            return Err("decoder tokenizer byte fallback is incomplete".to_string());
        }

        Ok(Self {
            pieces,
            trie,
            byte_ids,
            pad_id: asset.special_ids.pad,
            unknown_id: asset.special_ids.unknown,
            bos_id: asset.special_ids.bos,
            eos_id: asset.special_ids.eos,
            dummy_prefix: asset.dummy_prefix,
            collapse_whitespace: asset.collapse_whitespace,
        })
    }

    pub(crate) fn vocabulary_size(&self) -> usize {
        self.pieces.len()
    }

    pub(crate) fn encode(&self, value: &str, maximum_tokens: usize) -> Vec<usize> {
        if maximum_tokens == 0 {
            return Vec::new();
        }
        let normalized = self.normalize(value);
        let bytes = normalized.as_bytes();
        let mut scores = vec![f64::NEG_INFINITY; bytes.len() + 1];
        let mut previous: Vec<Option<BackPointer>> = vec![None; bytes.len() + 1];
        let mut tie_breakers: Vec<Option<TieBreaker>> = vec![None; bytes.len() + 1];
        scores[0] = 0.0;
        for start in 0..bytes.len() {
            if !scores[start].is_finite() || !normalized.is_char_boundary(start) {
                continue;
            }
            let mut node = 0;
            let mut matched = false;
            for end in start..bytes.len() {
                let Some(next) = self.trie[node].children.get(&bytes[end]).copied() else {
                    break;
                };
                node = next;
                for token_id in &self.trie[node].terminal {
                    matched = true;
                    Self::relax(
                        start,
                        end + 1,
                        vec![*token_id],
                        self.pieces[*token_id].score,
                        normalized[start..=end].chars().count(),
                        &mut scores,
                        &mut previous,
                        &mut tie_breakers,
                    );
                }
            }

            if !matched {
                let character = normalized[start..].chars().next().unwrap_or('\u{fffd}');
                let end = start + character.len_utf8();
                let fallback: Vec<usize> = normalized.as_bytes()[start..end]
                    .iter()
                    .map(|byte| self.byte_ids[*byte as usize])
                    .collect();
                let fallback_score = fallback.iter().map(|id| self.pieces[*id].score).sum();
                Self::relax(
                    start,
                    end,
                    fallback,
                    fallback_score,
                    1,
                    &mut scores,
                    &mut previous,
                    &mut tie_breakers,
                );
            }
        }

        let mut cursor = bytes.len();
        let mut segments = Vec::new();
        while cursor > 0 {
            let Some(back) = previous[cursor].take() else {
                return vec![self.bos_id, self.unknown_id];
            };
            cursor = back.start;
            segments.push(back.token_ids);
        }
        segments.reverse();
        let mut result = Vec::with_capacity(maximum_tokens);
        result.push(self.bos_id);
        for segment in segments {
            result.extend(segment);
        }
        if result.len() > maximum_tokens {
            result.drain(0..result.len() - maximum_tokens);
        }
        result
    }

    pub(crate) fn decode(&self, token_ids: &[usize]) -> String {
        let mut raw = Vec::new();
        for id in token_ids {
            let Some(piece) = self.pieces.get(*id) else {
                continue;
            };
            if *id == self.eos_id || *id == self.pad_id {
                break;
            }
            match piece.kind {
                PieceKind::Normal | PieceKind::UserDefined => {
                    raw.extend_from_slice(piece.text.as_bytes());
                }
                PieceKind::Byte => {
                    if let Some(value) = parse_byte_piece(&piece.text) {
                        raw.push(value);
                    }
                }
                PieceKind::Unknown => raw.extend_from_slice("�".as_bytes()),
                PieceKind::Control | PieceKind::Unused => {}
            }
        }
        String::from_utf8_lossy(&raw)
            .replace('▁', " ")
            .trim_start()
            .to_string()
    }

    pub(crate) fn is_terminal(&self, token_id: usize) -> bool {
        token_id == self.eos_id || token_id == self.pad_id
    }

    fn normalize(&self, value: &str) -> String {
        let nfkc: String = value
            .nfkc()
            .filter(|character| *character != '\0')
            .collect();
        let whitespace = if self.collapse_whitespace {
            nfkc.split_whitespace().collect::<Vec<_>>().join(" ")
        } else {
            nfkc
        };
        let marked = whitespace.replace(' ', "▁");
        if self.dummy_prefix && !marked.is_empty() && !marked.starts_with('▁') {
            format!("▁{marked}")
        } else {
            marked
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn relax(
        start: usize,
        end: usize,
        token_ids: Vec<usize>,
        added_score: f64,
        span_characters: usize,
        scores: &mut [f64],
        previous: &mut [Option<BackPointer>],
        tie_breakers: &mut [Option<TieBreaker>],
    ) {
        let candidate = scores[start] + added_score;
        let tie_breaker = (
            -(span_characters as isize),
            token_ids.len(),
            token_ids.clone(),
        );
        let should_replace = candidate > scores[end] + 1e-12
            || ((candidate - scores[end]).abs() <= 1e-12
                && tie_breakers[end]
                    .as_ref()
                    .is_none_or(|existing| tie_breaker < *existing));
        if should_replace {
            scores[end] = candidate;
            previous[end] = Some(BackPointer { start, token_ids });
            tie_breakers[end] = Some(tie_breaker);
        }
    }
}

fn parse_byte_piece(value: &str) -> Option<u8> {
    let hexadecimal = value.strip_prefix("<0x")?.strip_suffix('>')?;
    if hexadecimal.len() != 2 {
        return None;
    }
    u8::from_str_radix(hexadecimal, 16).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_asset() -> TokenizerAsset {
        let mut pieces = vec![
            PieceAsset {
                id: 0,
                piece: "<pad>".to_string(),
                score: 0.0,
                piece_type: "control".to_string(),
            },
            PieceAsset {
                id: 1,
                piece: "<unk>".to_string(),
                score: 0.0,
                piece_type: "unknown".to_string(),
            },
            PieceAsset {
                id: 2,
                piece: "<s>".to_string(),
                score: 0.0,
                piece_type: "control".to_string(),
            },
            PieceAsset {
                id: 3,
                piece: "</s>".to_string(),
                score: 0.0,
                piece_type: "control".to_string(),
            },
            PieceAsset {
                id: 4,
                piece: "▁hello".to_string(),
                score: -0.1,
                piece_type: "normal".to_string(),
            },
            PieceAsset {
                id: 5,
                piece: "▁".to_string(),
                score: -0.2,
                piece_type: "normal".to_string(),
            },
            PieceAsset {
                id: 6,
                piece: "hello".to_string(),
                score: -0.3,
                piece_type: "normal".to_string(),
            },
        ];
        for value in 0..=255_u8 {
            pieces.push(PieceAsset {
                id: pieces.len(),
                piece: format!("<0x{value:02X}>"),
                score: -10.0,
                piece_type: "byte".to_string(),
            });
        }
        while pieces.len() < EXPECTED_VOCABULARY_SIZE {
            pieces.push(PieceAsset {
                id: pieces.len(),
                piece: format!("unused-{}", pieces.len()),
                score: -100.0,
                piece_type: "unused".to_string(),
            });
        }
        TokenizerAsset {
            schema: TOKENIZER_SCHEMA.to_string(),
            vocabulary_size: EXPECTED_VOCABULARY_SIZE,
            normalization: "nfkc".to_string(),
            dummy_prefix: true,
            collapse_whitespace: true,
            special_ids: SpecialIds {
                pad: 0,
                unknown: 1,
                bos: 2,
                eos: 3,
            },
            pieces,
        }
    }

    #[test]
    fn unigram_prefers_a_complete_piece_and_round_trips_bytes() {
        let tokenizer = UnigramTokenizer::from_asset(tiny_asset()).unwrap();
        let hello = tokenizer.encode("hello", 256);
        assert_eq!(hello, vec![2, 4]);
        assert_eq!(tokenizer.decode(&hello[1..]), "hello");

        assert_eq!(tokenizer.encode("hello hello", 256), vec![2, 4, 4]);
        assert_eq!(
            tokenizer.encode("  ｈｅｌｌｏ\t\r\n hello  ", 256),
            vec![2, 4, 4]
        );
        assert_eq!(tokenizer.encode("\0", 256), vec![2]);

        let cat = tokenizer.encode("猫", 256);
        let expected_bytes = "猫".as_bytes().iter().map(|value| 7 + usize::from(*value));
        assert_eq!(
            cat,
            [2, 5].into_iter().chain(expected_bytes).collect::<Vec<_>>()
        );
        assert_eq!(tokenizer.decode(&cat[1..]), "猫");
    }
}
