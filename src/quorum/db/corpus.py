"""Which corpus this database holds, and a refusal to write into somebody else's.

This exists because it happened. A fork of a domain repo, pointed at a different corpus,
published Postgres on the same 5432 and used the same database name. Its ingest wrote 979
records and 19,580 fact rows of healthcare-claims data into a merger-agreement corpus. Nothing
errored. Nothing was overwritten. The two corpora simply interleaved, and the app began
reporting 1,131 records with a category rail reading "Injury — sprain or strain  n=254".

The rows were the cheap part; a `DELETE` fixed those. The expensive part was that every
published figure silently became a number about both corpora, and the only reason anyone
noticed was a count of 112 where the README said 92.

**Idempotency is what made it quiet.** An ingest keyed on its own record ids has no reason to
look at rows it did not write, so it never notices it is a guest in another project's database.
The property that makes re-running safe is exactly the property that makes this invisible.

So the check cannot be "do these rows look like mine". It has to be an explicit claim: the first
ingest stamps its name, and every later ingest reads that stamp before touching anything.
"""

from __future__ import annotations

from typing import Any

CLAIM_TABLE = """
CREATE TABLE IF NOT EXISTS corpus_claim (
    name            text        PRIMARY KEY,
    first_ingest_at timestamptz NOT NULL DEFAULT clock_timestamp()
)
"""


class ForeignCorpus(RuntimeError):
    """The database already belongs to a different corpus. Raised before any write."""


def claim_corpus(conn: Any, corpus: str, dsn_var: str = "QUORUM_DB") -> str:
    """Assert this database is ours, claiming it if nobody has.

    `corpus` comes from the manifest — `Domain.corpus` — rather than a module constant. That
    was the last thing making this file domain-specific, and it was the wrong thing to be
    constant: the whole point is that two projects sharing a DSN disagree about it.

    Returns the claimed name. Raises `ForeignCorpus` BEFORE any write when the stamp belongs to
    someone else, which is the only ordering that matters — a guard that reports the collision
    afterwards has documented the accident rather than prevented it.

    Idempotent: ingest is re-run constantly, and the guard must never be the thing that breaks
    the second run.
    """
    if not corpus:
        raise ValueError(
            "claim_corpus needs a corpus name. It comes from quorum.yaml's `corpus:` field, "
            "which is required — an unnamed corpus cannot be told apart from another one."
        )
    conn.execute(CLAIM_TABLE)
    row = conn.execute("SELECT name FROM corpus_claim LIMIT 1").fetchone()

    if row is None:
        conn.execute("INSERT INTO corpus_claim (name) VALUES (%s)", (corpus,))
        conn.commit()
        return corpus

    existing = str(row[0])
    if existing != corpus:
        # Both names and the variable to change. An error that says only "wrong corpus" leaves
        # the reader to work out which two collided and where the setting lives.
        raise ForeignCorpus(
            f"This database already holds the {existing!r} corpus, and this ingest writes "
            f"{corpus!r}. Two corpora in one database do not collide loudly — they interleave, "
            f"and every count, facet and published figure silently becomes a number about "
            f"both. Point this project at its own database, e.g. "
            f"{dsn_var}=postgresql://explorer:explorer@localhost:5432/"
            f"{corpus.split('-')[0]}_quorum, or publish Postgres on a different port. "
            f"Nothing has been written."
        )
    return existing
