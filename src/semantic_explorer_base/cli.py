"""`quorum` — one command per thing a domain does.

The single point that hides the two-halves complexity: a domain repo should not need to know
that the platform is part Python and part TypeScript, nor which of its own scripts to run in
what order.

    quorum init      write quorum.yaml, a Cube model and the directory skeleton
    quorum check     validate the manifest AND the Cube model against the contract
    quorum migrate   bring the database up to the spine
    quorum ingest    load whatever is in the data folders
    quorum ask       one question, end to end, from the terminal
    quorum dev       bring the stack up for this domain

## `check` is the one that earns its place

`Domain.validate()` already rejects a bare member name or percentiles with no denominator, but
it validates the manifest against ITSELF. It cannot know whether `deal_points.numeric_n` exists
in the Cube model. Every defect found during the platform extraction lived in exactly that gap:
a median reported against the wrong denominator, a gate reading an incomplete list of counts, a
client called with the wrong signature. `check` reads live `/meta` and names the missing member,
instead of the app declining every question and looking like a model problem.

## What `init` is for

The onboarding path is: make a directory, drop files in `data/`, run `quorum init`, run
`quorum ingest`. `init` reads the files that are already there, infers the columns, and writes a
manifest and a Cube model that match them. It writes a starting point a human then edits — not a
finished app — and it says so in the file it writes, because a generated config that pretends to
be authoritative is worse than none.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
from typing import Any

from semantic_explorer_base.domain import InvalidDomain, load

EXIT_OK = 0
EXIT_INVALID = 1
EXIT_USAGE = 64
#: A check that failed on the model rather than on usage. Separate code so CI can tell them
#: apart — "you called it wrong" and "your domain is broken" want different responses.
EXIT_CHECK_FAILED = 65

DSN_VAR = "QUORUM_DB"


def _dsn() -> str:
    """The database, from QUORUM_DB.

    One name, no legacy fallback. A domain that has been setting its own variable for months
    keeps honouring it in its own settings — that back-compat is real and is the domain's to
    carry. This command is new, nobody has ever run it, so inheriting somebody else's variable
    name would be adopting a debt that does not exist.
    """
    return os.getenv(DSN_VAR) or "postgresql://quorum:quorum@localhost:5432/quorum"


def _connect() -> Any:
    try:
        import psycopg
    except ImportError:  # pragma: no cover - depends on the domain's own install
        raise SystemExit(
            "psycopg is not installed. The database commands need it: pip install psycopg[binary]"
        ) from None
    return psycopg.connect(_dsn())


def _domain(root: pathlib.Path) -> Any:
    try:
        return load(root)
    except InvalidDomain as exc:
        print(f"quorum.yaml: {exc}", file=sys.stderr)
        raise SystemExit(EXIT_INVALID) from exc


# ── check ────────────────────────────────────────────────────────────────────────────────


def check(root: pathlib.Path, cube_url: str) -> int:
    """Validate the manifest against itself, then against the live Cube model.

    Two passes, because they fail differently. The first is offline and catches a manifest that
    contradicts itself. The second needs a running Cube and catches the manifest that is
    internally consistent and names members nothing defines — which is the failure that presents
    as "the model got worse".
    """
    domain = _domain(root)
    print(f"manifest   {root / 'quorum.yaml'}")
    print(f"corpus     {domain.corpus}")
    print(f"subject    {domain.subject_axis}")

    from semantic_explorer_base.cube.client import CubeUnavailable
    from semantic_explorer_base.cube.client import meta as cube_meta

    try:
        meta = cube_meta(cube_url)
    except CubeUnavailable as exc:
        print(f"\ncube       UNREACHABLE at {cube_url}", file=sys.stderr)
        print(f"           {exc}", file=sys.stderr)
        print(
            "\nThe offline half of this check passed. Start Cube and re-run to check the members.",
            file=sys.stderr,
        )
        return EXIT_CHECK_FAILED

    members: set[str] = set()
    cubes: set[str] = set()
    closed: set[str] = set()
    for cube in meta.get("cubes", []):
        cubes.add(str(cube["name"]))
        for kind in ("measures", "dimensions"):
            for member in cube.get(kind, []):
                members.add(str(member["name"]))
                if kind == "dimensions" and (member.get("meta") or {}).get("closed_vocabulary"):
                    closed.add(str(member["name"]))

    problems: list[str] = []

    named = {
        "subject_axis": domain.subject_axis,
        "answer_dimension": domain.answer_dimension,
        "count_measure": domain.count_measure,
        "record_count": domain.record_count,
    }
    for field, member in named.items():
        if member and member not in members:
            problems.append(
                f"{field}: {member!r} is not in the Cube model. Nothing defines it, so every "
                f"question that needs it returns an empty selection — which reads as the model "
                f"getting worse rather than as a configuration error."
            )
    for group in ("numeric_measures", "count_measures", "excluded_measures"):
        for member in getattr(domain, group, ()) or ():
            if member not in members:
                problems.append(f"{group}: {member!r} is not in the Cube model")
    if domain.numeric_count and domain.numeric_count not in members:
        problems.append(f"numeric_count: {domain.numeric_count!r} is not in the Cube model")
    for name in domain.selectable:
        if name not in cubes:
            problems.append(f"selectable: {name!r} is not a cube or view in the model")

    # The one check that is about behaviour rather than existence. Without
    # `meta.closed_vocabulary` on the subject axis, filter-value resolution has no vocabulary to
    # resolve against, so a near-miss returns zero rows and reads as "we have no records like
    # that" instead of "you named something we do not carry".
    if domain.subject_axis in members and domain.subject_axis not in closed:
        problems.append(
            f"subject_axis: {domain.subject_axis!r} exists but is not declared "
            f"`meta.closed_vocabulary: true`. Filter values are resolved against a "
            f"dimension's own values; without the declaration there is nothing to resolve "
            f"against, and a near-miss returns zero rows rather than an error."
        )

    print(f"cube       {len(cubes)} cubes, {len(members)} members at {cube_url}")
    if problems:
        print(f"\n{len(problems)} problem(s):\n", file=sys.stderr)
        for problem in problems:
            print(f"  ✗ {problem}\n", file=sys.stderr)
        return EXIT_CHECK_FAILED

    print("\nok — every member the manifest names exists in the model")
    return EXIT_OK


# ── migrate ──────────────────────────────────────────────────────────────────────────────


def migrate_cmd(root: pathlib.Path) -> int:
    from semantic_explorer_base.db import migrate

    with _connect() as conn:
        applied = migrate(conn, root)
    for name in applied:
        print(f"applied  {name}")
    print(f"database {_dsn().rsplit('@', 1)[-1]}")
    return EXIT_OK


# ── ingest ───────────────────────────────────────────────────────────────────────────────


def ingest_cmd(root: pathlib.Path) -> int:
    """Load whatever the manifest's `ingest:` block points at.

    Claims the corpus first, before reading a byte. A guard that reports a collision after the
    write has documented the accident rather than prevented it.
    """
    from semantic_explorer_base.db.corpus import ForeignCorpus, claim_corpus
    from semantic_explorer_base.ingest import load_facts, load_records

    domain = _domain(root)
    plan = getattr(domain, "ingest", None) or {}
    if not plan:
        print(
            "quorum.yaml has no `ingest:` block, so there is nothing to load generically.\n"
            "A domain with its own parser runs that instead; a domain with CSV/TSV/JSON/JSONL\n"
            "adds one, with `format` and `map` both decided explicitly — see SPEC-02:\n\n"
            "  ingest:\n"
            "    records:\n"
            "      path: data/records.csv\n"
            "      format: csv\n"
            "      map: {id: record_id, source_title: title}\n"
            "    facts:\n"
            "      path: data/facts.csv\n"
            "      format: csv\n"
            "      map: {record_id: record_id, subject: topic, position: answer}\n",
            file=sys.stderr,
        )
        return EXIT_USAGE

    with _connect() as conn:
        try:
            claim_corpus(conn, domain.corpus, DSN_VAR)
        except ForeignCorpus as exc:
            print(str(exc), file=sys.stderr)
            return EXIT_CHECK_FAILED

        total = 0
        for kind, loader in (("records", load_records), ("facts", load_facts)):
            spec = plan.get(kind)
            if not spec:
                continue
            if "format" not in spec:
                print(
                    f"quorum.yaml's ingest.{kind} has no `format:` — this platform no longer "
                    f"sniffs one. Declare csv, tsv, json or jsonl explicitly (SPEC-02).",
                    file=sys.stderr,
                )
                return EXIT_INVALID
            for path in _paths(root, spec["path"]):
                if kind == "records":
                    report = loader(conn, path, spec["map"], domain.corpus, spec["format"])  # type: ignore[call-arg]
                else:
                    report = loader(conn, path, spec["map"], spec["format"])  # type: ignore[call-arg]
                total += report.rows_written
                print(f"{kind:8} {report.rows_written:>7,} rows  {path.name}")
                if report.unmapped:
                    # Not an error — they land in `attributes` — but a typo'd mapping looks
                    # exactly like this, so it is said out loud rather than logged.
                    print(f"         -> attributes: {', '.join(report.unmapped[:8])}")
                if report.skipped:
                    print(f"         !! {len(report.skipped)} rows skipped (no id)")
    print(f"\n{total:,} rows into {_dsn().rsplit('@', 1)[-1]}")
    return EXIT_OK


def _paths(root: pathlib.Path, pattern: str) -> list[pathlib.Path]:
    """Files matching one manifest entry. A glob so a folder of shards is one line."""
    found = sorted(root.glob(pattern)) if any(c in pattern for c in "*?[") else [root / pattern]
    missing = [p for p in found if not p.exists()]
    if missing or not found:
        raise SystemExit(f"no files matched {pattern!r} under {root}")
    return found


# ── ask ──────────────────────────────────────────────────────────────────────────────────


def ask_cmd(root: pathlib.Path, question: str, cube_url: str) -> int:
    """One question, end to end. Interpretation, the gate, and the rows.

    This is the command that reproduces by hand what took two curls and a Python one-liner
    during the extraction — which is how the last two defects were found, both of them invisible
    to a green test suite.
    """
    from semantic_explorer_base.agent.interpret import interpret
    from semantic_explorer_base.cube.client import query as cube_query
    from semantic_explorer_base.gates.min_n import apply as apply_gate

    domain = _domain(root)
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        print("OPENAI_API_KEY is not set; interpretation needs it.", file=sys.stderr)
        return EXIT_USAGE

    result = interpret(question, domain, key, cube_url=cube_url)
    if result.cannot_answer:
        print(f"declined — this corpus cannot answer that.\n  {question}")
        return EXIT_OK
    if not result.selection:
        print(f"declined — no shape fits that question.\n  {question}")
        return EXIT_OK

    print(f"shape    {result.shape}")
    print(f"subject  {result.subject}")
    print(f"selection {json.dumps(result.selection)}")

    rows = cube_query({**result.selection, "limit": 200}, cube_url)
    gate = apply_gate(
        rows,
        count_measures=domain.gated_counts,
        min_n=int(os.getenv("MIN_N", "5")),
        grouped=bool(result.selection.get("dimensions")),
    )
    print()
    if gate.refused:
        print(f"REFUSED  {gate.message}")
        return EXIT_OK
    for row in gate.rows:
        print("  " + "  ".join(f"{k.split('.')[-1]}={v}" for k, v in row.items()))
    if gate.suppressed:
        print(f"\n  {gate.message}")
    print(f"\nn={gate.n}")
    return EXIT_OK


# ── dev ──────────────────────────────────────────────────────────────────────────────────


def dev_cmd(root: pathlib.Path) -> int:
    """Bring the stack up, then migrate.

    A thin wrapper over the domain's own compose file on purpose. It exists so that a README can
    say one thing rather than three, and it runs migrate afterwards because "the stack is up but
    the schema is a version behind" is the state that produces the most confusing errors.
    """
    compose = root / "docker-compose.yml"
    if not compose.exists():
        print(f"no docker-compose.yml at {root}", file=sys.stderr)
        return EXIT_USAGE
    result = subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=root, check=False)
    if result.returncode != 0:
        return result.returncode
    return migrate_cmd(root)


# ── init ─────────────────────────────────────────────────────────────────────────────────


def init_cmd(root: pathlib.Path, name: str | None) -> int:
    """Write the starting skeleton: directories, a template manifest, a template Cube model.

    Nothing here is inferred from data — this file used to read `data/` and guess column roles
    from their names, and the guesser missed its own worked example silently. Every field in
    what this writes is a bracketed placeholder pointing at the spec that explains the decision
    behind it (`docs/specs/` in the platform repo). Filling them in is SPEC-01 through SPEC-03,
    not this command.
    """
    from semantic_explorer_base.scaffold import scaffold

    written = scaffold(root, name or root.resolve().name)
    for path in written:
        print(f"wrote  {path.relative_to(root)}")
    print(
        "\nNext — work through docs/specs/ in the platform repo, in order:\n"
        "  1. SPEC-01 (corpus intake)   — fill in every <bracketed> value in quorum.yaml\n"
        "  2. SPEC-02 (schema & ingest) — quorum migrate, then quorum ingest\n"
        "  3. SPEC-03 (cube metadata)   — fill in cube/model/quorum.yml\n"
        "  4. quorum check              — verifies 1-3 actually agree with each other"
    )
    return EXIT_OK


# ── entry point ──────────────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="quorum",
        description="A governed-answer layer: the model selects, the warehouse computes, "
        "thin slices are refused.",
    )
    parser.add_argument("-C", "--root", default=".", help="the domain repo root (default: cwd)")
    parser.add_argument(
        "--cube-url",
        default=os.getenv("CUBE_API_URL", "http://localhost:4000/cubejs-api/v1"),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="write a starting quorum.yaml and Cube model from data/")
    sub.add_parser("check", help="validate the manifest against the Cube model")
    sub.add_parser("migrate", help="bring the database up to the spine")
    sub.add_parser("ingest", help="load the files the manifest points at")
    sub.add_parser("dev", help="bring the stack up, then migrate")
    ask = sub.add_parser("ask", help="one question, end to end")
    ask.add_argument("question")

    for name in ("init",):
        sub.choices[name].add_argument("--name", default=None, help="application name")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = pathlib.Path(args.root).resolve()

    if args.command == "check":
        return check(root, args.cube_url)
    if args.command == "migrate":
        return migrate_cmd(root)
    if args.command == "ingest":
        return ingest_cmd(root)
    if args.command == "ask":
        return ask_cmd(root, args.question, args.cube_url)
    if args.command == "dev":
        return dev_cmd(root)
    if args.command == "init":
        return init_cmd(root, args.name)
    return EXIT_USAGE  # pragma: no cover - argparse rejects unknown commands first


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
