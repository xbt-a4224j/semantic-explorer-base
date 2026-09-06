"""Reading a file in the format the manifest DECLARES — never sniffed.

This platform used to guess format from a file's content. It was deleted: a wrong guess does not
error, it produces a plausible-looking table that is actually one giant garbage row, which is
the exact failure this whole product exists to avoid. So `format` is now a required, explicit
argument, and what these tests pin is that (1) every declared format reads correctly and (2) an
undeclared or wrong format fails LOUDLY rather than producing something that looks like data.
"""

from __future__ import annotations

import gzip
import json
import pathlib

import pytest

from semantic_explorer_base.ingest import UnknownFormat, read_rows

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
    # A real-world trap: an export named by its origin, not its shape. Reading it as anything
    # but the DECLARED format ("jsonl") would misfire, and there is no content check any more
    # to catch that — which is the point being tested.
    (tmp_path / "export.txt").write_text("\n".join(json.dumps(r) for r in ROWS))
    return tmp_path


@pytest.mark.parametrize(
    ("filename", "format"),
    [
        ("rows.csv", "csv"),
        ("rows.tsv", "tsv"),
        ("rows.json", "json"),
        ("rows.jsonl", "jsonl"),
        ("rows.csv.gz", "csv"),
        ("wrapped.json", "json"),
        ("export.txt", "jsonl"),
    ],
)
def test_every_declared_format_reads_correctly(
    data: pathlib.Path, filename: str, format: str
) -> None:
    """The extension is irrelevant. `export.txt` holding JSONL reads correctly because the
    manifest said `format: jsonl` — that declaration is the only thing consulted."""
    rows = list(read_rows(data / filename, format))
    assert len(rows) == 2
    assert [r["code"] for r in rows] == ["A-1", "A-2"]
    assert [r["answer"] for r in rows] == ["Yes", "No"]


def test_ndjson_is_accepted_as_an_alias_for_jsonl(data: pathlib.Path) -> None:
    assert len(list(read_rows(data / "rows.jsonl", "ndjson"))) == 2


class TestAWrongOrMissingFormatFailsLoudly:
    """The property sniffing existed to protect, kept without the guessing: a bad declaration
    must not silently produce something that looks like data."""

    def test_an_unrecognised_format_name_raises_and_names_the_valid_ones(
        self, data: pathlib.Path
    ) -> None:
        with pytest.raises(UnknownFormat) as raised:
            list(read_rows(data / "rows.csv", "xlsx"))
        message = str(raised.value)
        for valid in ("csv", "tsv", "json", "jsonl"):
            assert valid in message

    def test_declaring_json_for_a_file_that_is_really_jsonl_does_not_silently_lose_rows(
        self, tmp_path: pathlib.Path
    ) -> None:
        """The failure this once guarded against, now happening on purpose so it is visible:
        reading two JSON objects as one JSON document is invalid JSON, and json.load raises —
        it does not quietly return one row."""
        path = tmp_path / "actually_jsonl.json"
        path.write_text("\n".join(json.dumps(r) for r in ROWS))
        with pytest.raises(json.JSONDecodeError):
            list(read_rows(path, "json"))

    def test_an_ambiguous_json_wrapper_still_raises(self, tmp_path: pathlib.Path) -> None:
        """Two list-valued keys means which one holds the rows is a guess this platform still
        refuses to make, even with format declared correctly."""
        path = tmp_path / "two.json"
        path.write_text(json.dumps({"rows": ROWS, "errors": [1, 2]}))
        with pytest.raises(UnknownFormat, match="which one"):
            list(read_rows(path, "json"))


def test_a_missing_file_says_so(tmp_path: pathlib.Path) -> None:
    with pytest.raises(FileNotFoundError):
        list(read_rows(tmp_path / "nope.csv", "csv"))
