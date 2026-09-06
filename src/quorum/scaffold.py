"""`quorum init` — read what is in `data/`, write a manifest that matches it.

The onboarding claim this file has to make true: make a directory, drop files in `data/`, run
two commands. Everything here exists to remove a step from that list.

## What it infers, and what it refuses to

It reads the headers and guesses which columns are the record id, the subject and the answer,
using name patterns. Those guesses are marked `# GUESS` in the file it writes.

It does NOT guess silently. A generated config that presents itself as authoritative is worse
than no config at all, because the next person reads it as a set of decisions rather than a set
of assumptions — and the assumption that matters here is which column identifies a record, which
is wrong-able in a way that produces a plausible, empty app rather than an error.

## Why it writes a Cube model too

A manifest naming members that nothing defines is the failure `quorum check` exists to catch,
and shipping `init` without a model would guarantee it on every new domain. The generated model
is minimal — the counts, the subject axis, the answer dimension, a median — which is exactly the
set the four question shapes need and nothing more.
"""

from __future__ import annotations

import pathlib
import re
from typing import Any

from quorum.ingest import UnknownFormat, read_rows, sniff

#: Column-name patterns, most specific first. Deliberately short: a longer list guesses more
#: often and is wrong more often, and every wrong guess here is one a human has to notice.
PATTERNS = {
    # `.*_id$` rather than `_id$`: these are used with re.search, but writing the anchors out is
    # the point. The first version used re.match with a bare `_id$`, which anchors at the START
    # of the string and therefore never matched `citation_id` — the exact column it was written
    # for. Silent: it produced a manifest with no records file and no error.
    "id": (r"^id$", r"^(record|matter|case|doc|document|entity|item)_?id$", r"^\w+_id$"),
    "subject": (
        r"^(deal_?point|subject|field|attribute|question|topic|code|kind|type)s?_?(name)?$",
    ),
    "position": (r"^(position|answer|value|response|result|finding|severity|status)s?$",),
    "source_title": (r"^(title|name|label|caption|description|summary)$",),
    "numeric_value": (r"^(numeric_?value|amount|days|months|years|percent|score|count|n)$",),
}

DATA_SUFFIXES = (".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".gz")


def _match(columns: list[str], role: str) -> str | None:
    """The first column matching this role's patterns, most specific pattern first.

    Patterns are fully anchored and matched with `fullmatch`, so a pattern's intent and its
    behaviour cannot diverge. They did once: `_id$` under `re.match` anchors at the start and
    matched nothing, which produced a manifest missing its records file and no error at all.
    """
    for pattern in PATTERNS[role]:
        for column in columns:
            if re.fullmatch(pattern, column.strip().lower()):
                return column
    return None


def data_files(root: pathlib.Path) -> list[pathlib.Path]:
    """Every readable data file under `data/`, shallowest first.

    Shallowest first because `data/records.csv` is a better guess at the primary file than
    `data/raw/shard-07/part.csv`, and the ordering is the only signal available.
    """
    data = root / "data"
    if not data.exists():
        return []
    found = [
        p
        for p in data.rglob("*")
        if p.is_file() and p.suffix.lower() in DATA_SUFFIXES and not p.name.startswith(".")
    ]
    return sorted(found, key=lambda p: (len(p.relative_to(data).parts), p.name))


def columns_of(path: pathlib.Path) -> list[str]:
    """The first row's keys, or [] when the file cannot be read as rows."""
    try:
        sniff(path)
        for row in read_rows(path):
            return list(row)
    except (UnknownFormat, OSError, UnicodeDecodeError, ValueError):
        # A file this cannot read is simply not a candidate. Narrow rather than bare, so a bug
        # in the reader surfaces as a crash during `init` instead of as an empty manifest —
        # "found no data files" and "the reader is broken" must not look the same.
        return []
    return []


def classify(root: pathlib.Path) -> dict[str, dict[str, Any]]:
    """Which file is records and which is facts, with a column mapping for each.

    The rule is structural rather than name-based: a facts file has a subject column AND an
    answer column; a records file is the one with an id and the most other columns. Naming
    conventions differ per corpus, but the long shape does not — that is the whole reason the
    schema is long.
    """
    plan: dict[str, dict[str, Any]] = {}
    for path in data_files(root):
        columns = columns_of(path)
        if not columns:
            continue
        subject = _match(columns, "subject")
        position = _match(columns, "position")
        identifier = _match(columns, "id")

        if subject and position and identifier and "facts" not in plan:
            mapping = {"record_id": identifier, "subject": subject, "position": position}
            numeric = _match(columns, "numeric_value")
            if numeric:
                mapping["numeric_value"] = numeric
            plan["facts"] = {
                "path": str(path.relative_to(root)),
                "map": mapping,
                "columns": columns,
            }
        elif identifier and "records" not in plan:
            mapping = {"id": identifier}
            title = _match(columns, "source_title")
            if title:
                mapping["source_title"] = title
            plan["records"] = {
                "path": str(path.relative_to(root)),
                "map": mapping,
                "columns": columns,
            }
    return plan


def _yaml_map(mapping: dict[str, str]) -> str:
    return ", ".join(f"{k}: {v}" for k, v in mapping.items())


def manifest_text(name: str, plan: dict[str, dict[str, Any]]) -> str:
    """The starting quorum.yaml. Every inferred value is marked."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "corpus"
    records = plan.get("records", {})
    unmapped = [c for c in records.get("columns", []) if c not in records.get("map", {}).values()]

    lines = [
        "# Written by `quorum init` from the files in data/.",
        "#",
        "# Lines marked GUESS were inferred from column names. They are assumptions, not",
        "# decisions — read every one before trusting a number this app produces. The one that",
        "# matters most is `subject_axis`: get it wrong and the app answers nothing, and the",
        "# symptom (every question declining) looks like a model problem rather than this file.",
        "",
        f"name: {name}",
        f"corpus: {slug}",
        "",
        "# The dimension nearly every question is about. GUESS.",
        "subject_axis: facts.subject",
        "# How the subject came out — grouped to make a distribution. GUESS.",
        "answer_dimension: facts.position",
        "",
        "# Counts at two grains. They differ, and the difference matters: one row per answer is",
        "# not one row per record, and reading the inflated one lets a thin slice clear the gate.",
        "count_measure: facts.n",
        "record_count: records.n",
        "count_measures:",
        "  - records.n",
        "  - facts.n",
        "",
        "selectable:",
        "  - records",
        "  - facts",
        "",
        "strings:",
        "  record: record",
        "  records: records",
        "  subject: subject",
        "  subject_title: subject",
        "  subject_heading: SUBJECT",
        "  colloquial: records",
        f"  corpus_description: {name}",
        "  analyst: an analyst",
        "  terms_of_art: []",
        "  absent: []",
    ]

    if plan:
        lines += ["", "ingest:"]
        for kind in ("records", "facts"):
            spec = plan.get(kind)
            if spec:
                lines += [
                    f"  # GUESS — from the headers of {pathlib.Path(spec['path']).name}",
                    f"  {kind}:",
                    f"    path: {spec['path']}",
                    f"    map: {{{_yaml_map(spec['map'])}}}",
                ]
        if unmapped:
            shown = ", ".join(unmapped[:10])
            lines += [
                "",
                f"# Columns not mapped above land in records.attributes as JSONB: {shown}",
                "# Nothing is dropped. Query them in the Cube model as attributes->>'key'.",
            ]
    else:
        lines += [
            "",
            "# No readable CSV/TSV/JSON/JSONL found under data/, so no ingest block was",
            "# written. Drop the files in and re-run `quorum init`, or write a parser and",
            "# leave this out.",
        ]
    return "\n".join(lines) + "\n"


def cube_model_text(plan: dict[str, dict[str, Any]]) -> str:
    """A minimal model: exactly the members the four question shapes need.

    Minimal on purpose. Every member offered to the agent is one it can pick wrongly, and a
    generated model full of speculative measures makes the selection problem harder for no
    benefit to a domain that has not decided what it wants yet.
    """
    numeric = "numeric_value" in plan.get("facts", {}).get("map", {})
    lines = [
        "# Written by `quorum init`. The minimum the four question shapes need:",
        "# a count at each grain, the subject axis, the answer dimension, and a median.",
        "#",
        "# Add measures as you decide you want them. Every member here is one the agent may",
        "# select, so an unconsidered measure is a wrong answer waiting to be chosen.",
        "cubes:",
        "  - name: records",
        "    sql_table: public.records",
        "    measures:",
        "      - name: n",
        "        type: count",
        "        title: Records",
        "        description: One row per record. The denominator for anything about records.",
        "    dimensions:",
        "      - name: id",
        "        sql: id",
        "        type: string",
        "        primary_key: true",
        "      - name: category",
        "        sql: category_code",
        "        type: string",
        "        meta:",
        "          closed_vocabulary: true",
        "",
        "  - name: facts",
        "    sql_table: public.facts",
        "    joins:",
        "      - name: records",
        "        relationship: many_to_one",
        '        sql: "{CUBE}.record_id = {records}.id"',
        "    measures:",
        "      - name: n",
        "        type: count",
        "        title: Answers",
        "        description: >-",
        "          One row per ANSWER, not per record. A record with twelve answers counts",
        "          twelve times here, so this is never the denominator for a claim about",
        "          records — use records.n for that.",
        "      - name: count_distinct_records",
        "        type: count_distinct",
        "        sql: record_id",
        "        description: Records with an answer on the selected subject.",
    ]
    if numeric:
        lines += [
            "      - name: numeric_n",
            "        type: count",
            "        title: Answers carrying a number",
            "        filters:",
            '          - sql: "{CUBE}.numeric_value IS NOT NULL"',
            "        description: >-",
            "          THE DENOMINATOR FOR THE PERCENTILE BELOW. Most subjects are categorical,",
            "          so this is far smaller than facts.n — a median reported against facts.n",
            "          claims a sample it does not have.",
            "      - name: median_numeric_value",
            "        type: number",
            '        sql: "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {CUBE}.numeric_value)"',
            "        description: >-",
            "          Median, NOT mean: a mean reports the tail rather than the market. Filter",
            "          to one subject first or this mixes units into a meaningless number.",
        ]
    lines += [
        "    dimensions:",
        "      - name: subject",
        "        sql: subject",
        "        type: string",
        "        meta:",
        "          # Required. Filter values are resolved against this dimension's own values;",
        "          # without the declaration a near-miss returns zero rows, which reads as",
        "          # 'we have no records like that' rather than as a naming error.",
        "          closed_vocabulary: true",
        "      - name: position",
        "        sql: position",
        "        type: string",
        "        meta:",
        "          closed_vocabulary: true",
    ]
    return "\n".join(lines) + "\n"


def scaffold(root: pathlib.Path, name: str) -> list[pathlib.Path]:
    """Write the manifest and model. Never overwrites: re-running is safe."""
    root = pathlib.Path(root)
    plan = classify(root)
    written: list[pathlib.Path] = []

    (root / "data").mkdir(parents=True, exist_ok=True)
    (root / "cube" / "model").mkdir(parents=True, exist_ok=True)

    manifest = root / "quorum.yaml"
    if not manifest.exists():
        manifest.write_text(manifest_text(name, plan))
        written.append(manifest)

    model = root / "cube" / "model" / "quorum.yml"
    if not model.exists():
        model.write_text(cube_model_text(plan))
        written.append(model)

    return written
