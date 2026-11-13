import json
import tempfile
import unittest
from pathlib import Path

from scripts.model_enrich import load_done_pages, normalize_extracted_data, parse_json_object


class ModelEnrichTests(unittest.TestCase):
    def test_parse_json_object_from_markdown_fence(self):
        parsed = parse_json_object(' ```json\n{"garment_type":"قميص"}\n``` ')
        self.assertEqual(parsed["garment_type"], "قميص")

    def test_normalize_adds_missing_arrays(self):
        parsed = normalize_extracted_data({"garment_type": "قميص"})
        self.assertEqual(parsed["measurements"], [])
        self.assertEqual(parsed["size_tables"], [])

    def test_normalize_rejects_wrong_array_type(self):
        with self.assertRaises(ValueError):
            normalize_extracted_data({"measurements": "90 cm"})

    def test_resume_uses_latest_source_hash_for_page(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "book.jsonl"
            records = [
                {"page": 2, "source_text_sha256": "old", "review_status": "machine_extracted_unverified"},
                {"page": 2, "source_text_sha256": "new", "review_status": "machine_extracted_unverified"},
            ]
            output.write_text("".join(json.dumps(item) + "\n" for item in records), encoding="utf-8")
            self.assertEqual(load_done_pages(output), {2: "new"})


if __name__ == "__main__":
    unittest.main()
