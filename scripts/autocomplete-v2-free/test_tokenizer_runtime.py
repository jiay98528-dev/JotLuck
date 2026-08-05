from __future__ import annotations

import unittest

from tokenizer_runtime import RUNTIME_SCHEMA, UnigramRuntimeTokenizer, normalize_text


def runtime_fixture() -> dict[str, object]:
    pieces: list[dict[str, object]] = [
        {"id": 0, "piece": "<pad>", "score": 0.0, "type": "control"},
        {"id": 1, "piece": "<unk>", "score": -100.0, "type": "unknown"},
        {"id": 2, "piece": "<s>", "score": 0.0, "type": "control"},
        {"id": 3, "piece": "</s>", "score": 0.0, "type": "control"},
        {"id": 4, "piece": "▁hello", "score": -0.1, "type": "normal"},
        {"id": 5, "piece": "▁", "score": -0.2, "type": "normal"},
        {"id": 6, "piece": "hello", "score": -0.3, "type": "normal"},
    ]
    for value in range(256):
        pieces.append(
            {
                "id": len(pieces),
                "piece": f"<0x{value:02X}>",
                "score": -10.0,
                "type": "byte",
            }
        )
    return {
        "schema": RUNTIME_SCHEMA,
        "vocabularySize": len(pieces),
        "pieces": pieces,
        "specialIds": {"pad": 0, "unk": 1, "bos": 2, "eos": 3},
        "normalization": "nfkc",
        "dummyPrefix": True,
        "collapseWhitespace": True,
    }


class UnigramRuntimeTokenizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tokenizer = UnigramRuntimeTokenizer(runtime_fixture())

    def test_prefers_the_best_unigram_path(self) -> None:
        self.assertEqual(self.tokenizer.encode("hello"), [4])
        self.assertEqual(self.tokenizer.encode("hello hello"), [4, 4])

    def test_nfkc_and_whitespace_contract_are_deterministic(self) -> None:
        self.assertEqual(normalize_text("  ｈｅｌｌｏ\t\r\n hello  "), "hello hello")
        self.assertEqual(self.tokenizer.encode("  ｈｅｌｌｏ\t hello "), [4, 4])

    def test_uses_utf8_byte_fallback_and_special_ids(self) -> None:
        expected_bytes = [7 + value for value in "猫".encode("utf-8")]
        self.assertEqual(
            self.tokenizer.encode("猫", add_bos=True, add_eos=True),
            [2, 5, *expected_bytes, 3],
        )

    def test_rejects_an_incomplete_byte_fallback_table(self) -> None:
        payload = runtime_fixture()
        pieces = payload["pieces"]
        assert isinstance(pieces, list)
        pieces.pop()
        payload["vocabularySize"] = len(pieces)
        with self.assertRaisesRegex(ValueError, "incomplete"):
            UnigramRuntimeTokenizer(payload)


if __name__ == "__main__":
    unittest.main()
