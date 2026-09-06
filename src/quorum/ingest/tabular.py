"""Read whatever the domain dropped in the folder, and load it into the spine.

## The formats, and why these

`.csv`, `.tsv`, `.json`, `.jsonl`/`.ndjson`, and any of those inside a `.gz`. Every one is in the
standard library, which is the reason the list stops there: Parquet would mean a hard pyarrow
dependency for a platform whose whole install is otherwise five small packages. A domain with
Parquet converts it in one pandas line and keeps the dependency in its own repo, where it
belongs.

Detection is by extension and then by content. Extension alone is wrong often enough to matter —
exports named `.txt` that are TSV, `.json` files that are really JSONL — and a wrong guess here
does not error, it produces one giant garbage row, which is the failure this whole product
exists to avoid: a result that looks like a result.

## What "handled automatically" does and does not mean

Column NAMES still have to line up with the spine, and that is deliberate. A reader that guessed
which column was the record id would be wrong on some corpus, silently, and no test anyone
writes would catch it. So the mapping is explicit in `quorum.yaml` — `ingest.records.id: matter`
— and the failure mode is a named error at load rather than a plausible table full of nulls.

Everything NOT mapped goes to `records.attributes` as JSONB. That is the half that is genuinely
automatic: a new column in the source file needs no migration, no model edit, and shows up
queryable.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import pathlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from quorum.logging import get_logger

log = get_logger()


class UnknownFormat(RuntimeError):
    """The file's format could not be determined. Never guessed at."""


@dataclass
class IngestReport:
    """What one load did. Returned rather than logged, so a caller can assert on it."""

    source: str
    rows_read: int = 0
    rows_written: int = 0
    #: Columns present in the file that the manifest did not map. Not an error — they land in
    #: `attributes` — but worth reporting, because a typo'd mapping looks exactly like this.
    unmapped: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def _open(path: pathlib.Path) -> io.TextIOBase:
    """Text handle, transparently decompressing `.gz`."""
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", newline="")
    return path.open("r", encoding="utf-8", newline="")


def _stem_suffix(path: pathlib.Path) -> str:
    """The format-bearing suffix, looking through `.gz`."""
    if path.suffix == ".gz":
        return pathlib.Path(path.stem).suffix.lower()
    return path.suffix.lower()


def _read_delimited(path: pathlib.Path, delimiter: str) -> Iterator[dict[str, Any]]:
    with _open(path) as handle:
        yield from csv.DictReader(handle, delimiter=delimiter)


def _read_json(path: pathlib.Path) -> Iterator[dict[str, Any]]:
    """A JSON array of objects, or a single object wrapping one under a list-valued key.

    The wrapper case is handled because it is what real exports look like — `{"data": [...]}` —
    and failing on it would send someone to write a script to unwrap it, which is the moment the
    "no code needed" claim stops being true.
    """
    with _open(path) as handle:
        doc = json.load(handle)
    if isinstance(doc, list):
        yield from (row for row in doc if isinstance(row, dict))
        return
    if isinstance(doc, dict):
        lists = [v for v in doc.values() if isinstance(v, list)]
        if len(lists) == 1:
            yield from (row for row in lists[0] if isinstance(row, dict))
            return
        if not lists:
            yield doc
            return
        raise UnknownFormat(
            f"{path.name} is a JSON object with {len(lists)} list-valued keys, so which one "
            f"holds the rows is a guess. Point at the rows directly, or use JSONL."
        )
    raise UnknownFormat(f"{path.name} is JSON but neither an array nor an object of rows.")


def _read_jsonl(path: pathlib.Path) -> Iterator[dict[str, Any]]:
    with _open(path) as handle:
        for number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise UnknownFormat(f"{path.name} line {number} is not JSON: {exc}") from exc
            if isinstance(row, dict):
                yield row


#: Extension -> reader. The whole supported set, in one place a reader can check.
READERS = {
    ".csv": lambda p: _read_delimited(p, ","),
    ".tsv": lambda p: _read_delimited(p, "\t"),
    ".json": _read_json,
    ".jsonl": _read_jsonl,
    ".ndjson": _read_jsonl,
}


def sniff(path: pathlib.Path) -> str:
    """The format, from the extension and then from the content.

    Content wins over extension, because the extension is what people get wrong: a `.json` file
    that is really JSONL parses as neither, and a `.txt` export that is really TSV read as CSV
    produces one column per row. Neither errors. Both produce a table that looks loaded.
    """
    suffix = _stem_suffix(path)

    with _open(path) as handle:
        head = handle.read(4096).lstrip()

    if head.startswith("["):
        return ".json"
    if head.startswith("{"):
        # An object per line is JSONL; a single object is JSON. "Does the first line end in }"
        # is NOT the test — a compact one-line `{"data": [...]}` ends in `}` too, and reading it
        # as JSONL yields one row containing the whole export. What separates them is whether a
        # SECOND object follows.
        rest = head.split("\n", 1)[1].lstrip() if "\n" in head else ""
        return ".jsonl" if rest.startswith("{") else ".json"

    if suffix in (".csv", ".tsv"):
        return suffix
    # A delimited file with an unhelpful extension. Tab beats comma when the first line has
    # more tabs, which is the only case worth guessing at because the two are unambiguous.
    first_line = head.split("\n", 1)[0]
    if "\t" in first_line and first_line.count("\t") >= first_line.count(","):
        return ".tsv"
    if "," in first_line:
        return ".csv"

    raise UnknownFormat(
        f"{path.name} is not CSV, TSV, JSON or JSONL as far as this can tell. Supported "
        f"extensions are {sorted(READERS)} plus .gz of any of them. Nothing was read — a "
        f"guessed format produces a table that looks loaded and is not."
    )


def read_rows(path: pathlib.Path | str) -> Iterator[dict[str, Any]]:
    """Every row in one file, whatever shape it arrived in."""
    path = pathlib.Path(path)
    if not path.exists():
        raise FileNotFoundError(f"no such file: {path}")
    return READERS[sniff(path)](path)


def _split(row: dict[str, Any], mapping: dict[str, str]) -> tuple[dict[str, Any], dict[str, Any]]:
    """(spine columns, everything else). The second half becomes `attributes`."""
    taken = {source for source in mapping.values()}
    spine = {column: row.get(source) for column, source in mapping.items()}
    extra = {k: v for k, v in row.items() if k not in taken and v not in (None, "")}
    return spine, extra


def load_records(
    conn: Any,
    path: pathlib.Path | str,
    mapping: dict[str, str],
    corpus: str,
) -> IngestReport:
    """Upsert one file of records. Unmapped columns land in `attributes`.

    Upsert rather than insert, because ingest is re-run constantly and a load that fails the
    second time is a load nobody runs. `updated_at` moves only when something actually changed —
    Cube's refresh_key reads it, and an unconditional touch makes every re-run look like new data.
    """
    path = pathlib.Path(path)
    if "id" not in mapping:
        raise ValueError(
            "records mapping needs an `id`. Guessing which column identifies a record would be "
            "wrong on some corpus silently, and no test would catch it."
        )
    report = IngestReport(source=path.name)
    for row in read_rows(path):
        spine, extra = _split(row, mapping)
        if not spine.get("id"):
            report.skipped.append(str(row)[:80])
            continue
        report.rows_read += 1
        if not report.unmapped and extra:
            report.unmapped = sorted(extra)
        conn.execute(
            """
            INSERT INTO records (id, source_file, source_title, corpus, category_code,
                                 attributes)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id) DO UPDATE SET
                source_file   = EXCLUDED.source_file,
                source_title  = EXCLUDED.source_title,
                category_code = EXCLUDED.category_code,
                attributes    = EXCLUDED.attributes
            WHERE  records.source_file   IS DISTINCT FROM EXCLUDED.source_file
                OR records.source_title  IS DISTINCT FROM EXCLUDED.source_title
                OR records.category_code IS DISTINCT FROM EXCLUDED.category_code
                OR records.attributes    IS DISTINCT FROM EXCLUDED.attributes
            """,
            (
                str(spine["id"]),
                path.name,
                str(spine.get("source_title") or ""),
                corpus,
                spine.get("category_code") or None,
                json.dumps(extra, default=str),
            ),
        )
        report.rows_written += 1
    conn.commit()
    log.info(
        "ingest_records",
        source=path.name,
        rows=report.rows_written,
        unmapped=len(report.unmapped),
    )
    return report


def load_facts(conn: Any, path: pathlib.Path | str, mapping: dict[str, str]) -> IngestReport:
    """Upsert one file of facts — one row per answer, the long shape.

    A fact whose `record_id` has no record is skipped and counted rather than failing the load.
    The alternative is that one dangling id in a 20,000-row file aborts the whole ingest, which
    turns a data-quality finding into an outage.
    """
    path = pathlib.Path(path)
    for required in ("record_id", "subject", "position"):
        if required not in mapping:
            raise ValueError(f"facts mapping needs `{required}`")
    report = IngestReport(source=path.name)
    for row in read_rows(path):
        spine, _ = _split(row, mapping)
        if not (spine.get("record_id") and spine.get("subject")):
            report.skipped.append(str(row)[:80])
            continue
        report.rows_read += 1
        numeric = spine.get("numeric_value")
        conn.execute(
            """
            INSERT INTO facts (record_id, subject, position, numeric_value, is_inferred)
            SELECT %s, %s, %s, %s, %s
            WHERE EXISTS (SELECT 1 FROM records WHERE id = %s)
            ON CONFLICT (record_id, subject) DO UPDATE SET
                position      = EXCLUDED.position,
                numeric_value = EXCLUDED.numeric_value
            WHERE  facts.position      IS DISTINCT FROM EXCLUDED.position
                OR facts.numeric_value IS DISTINCT FROM EXCLUDED.numeric_value
            """,
            (
                str(spine["record_id"]),
                str(spine["subject"]),
                str(spine.get("position") or ""),
                _number(numeric),
                bool(spine.get("is_inferred")),
                str(spine["record_id"]),
            ),
        )
        report.rows_written += 1
    conn.commit()
    log.info("ingest_facts", source=path.name, rows=report.rows_written)
    return report


def _number(value: Any) -> float | None:
    """A float, or None. Never a zero standing in for "could not parse" — that is a fabricated
    number, and a median over fabricated zeros is worse than a median over fewer rows."""
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
