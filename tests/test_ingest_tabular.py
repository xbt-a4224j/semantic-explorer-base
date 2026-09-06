"""Reading whatever the domain dropped in the folder.

The claim under test is "drop the files in and run one command", so these are about the formats
a real export actually arrives in, not about a tidy fixture.

The important negative case: a format this cannot determine must RAISE. A wrong guess does not
error — it produces one giant garbage column, or a single row containing the whole file, and a
table that looks loaded is the exact failure this product exists to avoid.
"""

from __future__ import annotations

import gzip
import json
import pathlib

import pytest

from quorum.ingest import UnknownFormat, read_rows, sniff

ROWS = [
    {"code": "A-1", "answer": "Yes", "days": "30"},
    {"code": "A-2", "answer": "No", "days": ""},
]


@pytest.fixture
def data(tmp_path: pathlib.Path) -> pathlib.Path:
    (tmp_path / "rows.csv").write_text("code,answer,days\nA-1,Yes,30\nA-2,No,\n")
    (tmp_path / "rows.tsv").write_text("code\tanswer\tdays\nA-1\tYes\t30\nA-2\tNo\t\n")
    (tmp_path / "rows.json").write_text(json.dumps(ROWS))
    (tmp_path / "rows.jsonl").write_text("\n".join(json.dumps(r) for r in ROWS))
    (tmp_path / "wrapped.json").write_text(json.dumps({"meta": "x", "data": ROWS}))
    with gzip.open(tmp_path / "rows.csv.gz", "wt") as fh:
        fh.write("code,answer,days\nA-1,Yes,30\nA-2,No,\n")
    return tmp_path


@pytest.mark.parametrize(
    "filename", ["rows.csv", "rows.tsv", "rows.json", "rows.jsonl", "rows.csv.gz", "wrapped.json"]
)
def test_every_supported_format_yields_the_same_rows(data: pathlib.Path, filename: str) -> None:
    rows = list(read_rows(data / filename))
    assert len(rows) == 2
    assert [r["code"] for r in rows] == ["A-1", "A-2"]
    assert [r["answer"] for r in rows] == ["Yes", "No"]


class TestTheFormatIsDeterminedByContentNotJustTheExtension:
    """Extension alone is wrong often enough to matter, and the wrong guess is silent."""

    def test_jsonl_named_json(self, tmp_path: pathlib.Path) -> None:
        """A common export shape. Read as JSON it raises; read as JSONL it works."""
        path = tmp_path / "actually-jsonl.json"
        path.write_text("\n".join(json.dumps(r) for r in ROWS))
        assert sniff(path) == ".jsonl"
        assert len(list(read_rows(path))) == 2

    def test_tsv_named_txt(self, tmp_path: pathlib.Path) -> None:
        """Read as CSV this yields one column per row — a table that looks loaded."""
        path = tmp_path / "export.txt"
        path.write_text("code\tanswer\nA-1\tYes\n")
        assert sniff(path) == ".tsv"
        assert list(read_rows(path)) == [{"code": "A-1", "answer": "Yes"}]

    def test_an_undeterminable_file_raises_rather_than_guessing(
        self, tmp_path: pathlib.Path
    ) -> None:
        path = tmp_path / "notes.txt"
        path.write_text("just some prose with no delimiters at all\n")
        with pytest.raises(UnknownFormat, match="Nothing was read"):
            sniff(path)

    def test_an_ambiguous_json_wrapper_raises(self, tmp_path: pathlib.Path) -> None:
        """Two list-valued keys means which one holds the rows is a coin flip."""
        path = tmp_path / "two.json"
        path.write_text(json.dumps({"rows": ROWS, "errors": [1, 2]}))
        with pytest.raises(UnknownFormat, match="which one"):
            list(read_rows(path))


def test_a_missing_file_says_so(tmp_path: pathlib.Path) -> None:
    with pytest.raises(FileNotFoundError):
        list(read_rows(tmp_path / "nope.csv"))
