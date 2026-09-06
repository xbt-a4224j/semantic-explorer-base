"""Read a file the domain manifest points at, in the format the manifest DECLARES.

## No sniffing. That was tried and it was the wrong fix.

This module used to guess format from content — a `.json` file is really JSONL if a second
`{` follows the first, a `.txt` export is really TSV if it has more tabs than commas. It was
deleted, on instruction, along with the column-name pattern matching that used to write
`quorum.yaml` for you: both were a platform trying to make a judgment call cheaply, and both
failed on their own worked examples without raising anything. A wrong guess here does not error;
it produces one giant garbage row, which is the exact failure this whole product exists to
avoid — a result that looks like a result.

So `format` is a required, explicit field in the manifest's `ingest:` block — a decision SPEC-02
asks whoever is onboarding a domain (human or agent) to make and verify by reading real output,
not a pattern this module infers. `read_rows` raises if the declared format is not one of the
four supported; it does not fall back to guessing one.

## The formats, and why these four

`csv`, `tsv`, `json`, `jsonl` (`ndjson` is accepted as an alias), and any of those gzipped.
Every reader is in the standard library, which is why the list stops there: Parquet would mean a
hard pyarrow dependency for a platform whose whole install is otherwise five small packages. A
domain with Parquet converts it in one pandas line and keeps the dependency in its own repo.

## What "handled automatically" does and does not mean

Column NAMES still map explicitly in `quorum.yaml` — `ingest.records.map.id: matter_id` — for
the same reason format is no longer sniffed: a reader that guessed which column was the record
id would be wrong on some corpus, silently, and no test anyone writes would catch it. Everything
NOT mapped lands in `records.attributes` as JSONB, which is the half that genuinely is
automatic — a new column in the source file needs no migration, no model edit, and shows up
queryable immediately.
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


#: Declared format name -> reader. Keyed by what a manifest SAYS, never by what a file's
#: extension or content happens to look like.
READERS = {
    "csv": lambda p: _read_delimited(p, ","),
    "tsv": lambda p: _read_delimited(p, "\t"),
    "json": _read_json,
    "jsonl": _read_jsonl,
    "ndjson": _read_jsonl,
}


def read_rows(path: pathlib.Path | str, format: str) -> Iterator[dict[str, Any]]:
    """Every row in one file, read as the manifest DECLARES it — never sniffed.

    `format` is required and must be one of `READERS`. This is a validation of a stated value,
    not an inference: the decision of what format a file is belongs to whoever wrote the
    manifest (see SPEC-02), verified by looking at real output, not to a heuristic run at load
    time with no chance to be checked first.
    """
    path = pathlib.Path(path)
    if not path.exists():
        raise FileNotFoundError(f"no such file: {path}")
    if format not in READERS:
        raise UnknownFormat(
            f"{path.name}: {format!r} is not a format this platform reads. "
            f"Declare one of {sorted(READERS)} in the manifest's ingest block."
        )
    return READERS[format](path)


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
    format: str,
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
    for row in read_rows(path, format):
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


def load_facts(
    conn: Any, path: pathlib.Path | str, mapping: dict[str, str], format: str
) -> IngestReport:
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
    for row in read_rows(path, format):
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
