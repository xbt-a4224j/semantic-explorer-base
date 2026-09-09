"""A slice's distribution, and what that distribution looks like at rest.

Promoted from the reference application (#12, item 3). A rollup reported one subject's positions
across a 100-record slice as `N 65, Y 35` and stopped there. 35% reads as a finding. The corpus
rate for that position is 24.7%, and nothing on the row said so, so a reader could not tell
signal from the corpus's own shape — the slice was mildly above the base rate and looked like a
discovery.

The platform's standing rule is that every figure carries its denominator. `min_n` enforces that
a count is big enough to mean anything; this enforces the other half, that a proportion is
reported against something. For a distribution the denominator is not only its own n, it is what
the same distribution looks like corpus-wide.

## Why both numbers are read here, together

The two are computed in ONE connection and returned as a pair. That is the whole reason this is a
function rather than two. Read separately — the slice from a request handler and the baseline
from a cache, or from a second connection — a write landing between them can produce a slice
count larger than its own corpus count, which is not merely wrong but *incoherent*, and the
reader who spots it has no way to tell which of the two numbers to distrust. Consistency by
construction rather than by convention.

The cost is one extra grouped scan of `facts` per rollup. On the reference corpus that is 6,119
rows; measured, it was cheap enough not to warrant caching, and a cache is exactly what would
reintroduce the skew above.

## Why `answered_n` is per subject

Not every record answers every subject. On the reference corpus one subject is answered on 822 of
1,000 records, so comparing a slice against 1,000 measures it against a rate the corpus never
had. The denominator for a subject's distribution is the records that answered THAT subject.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: Both statements group at the same grain and count the same thing. They differ in exactly one
#: predicate, and keeping them side by side is deliberate: the identity "select every record and
#: the slice equals the corpus" only holds while that is true, and it is the first thing an edit
#: to one of them breaks.
_SELECT = "SELECT subject, position, count(DISTINCT record_id) FROM facts"
_GROUP = "GROUP BY subject, position"

#: `count(DISTINCT record_id)`, not `count(*)`. `facts` is UNIQUE(record_id, subject) today, so
#: the two agree — but the distinction is what the number MEANS: a distribution over records, not
#: over rows. A domain that ever relaxes that constraint would otherwise start reporting a
#: position count larger than its own record count with no code change.
SLICE_SQL = f"{_SELECT} WHERE record_id = ANY(%s) {_GROUP}"
CORPUS_SQL = f"{_SELECT} {_GROUP}"


@dataclass(frozen=True)
class Distribution:
    """How many records gave each position, per subject. Never negative, never guessed."""

    by_subject: dict[str, dict[str, int]] = field(default_factory=dict)

    @classmethod
    def from_rows(cls, rows: Any) -> Distribution:
        """Build from `(subject, position, n)` triples, for a caller that already has them."""
        out: dict[str, dict[str, int]] = {}
        for subject, position, n in rows:
            out.setdefault(str(subject), {})[str(position)] = int(n)
        return cls(out)

    @property
    def subjects(self) -> tuple[str, ...]:
        return tuple(self.by_subject)

    def positions(self, subject: str) -> dict[str, int]:
        return self.by_subject.get(subject, {})

    def n(self, subject: str, position: str) -> int:
        """0, not None, for a position nobody gave.

        A distribution's zeros are real observations — "nobody in this slice answered that way"
        is a fact about the slice — where None would read as "not measured" and force every
        caller to decide which it meant.
        """
        return self.positions(subject).get(position, 0)

    def answered_n(self, subject: str) -> int:
        """The records that answered this subject at all. The denominator for its proportions."""
        return sum(self.positions(subject).values())


def slice_and_corpus(conn: Any, record_ids: list[str]) -> tuple[Distribution, Distribution]:
    """`(slice, corpus)` for an ad-hoc selection, both read on `conn`, slice first.

    `record_ids` is an arbitrary client selection — up to hundreds of specific ids — which is why
    this reads Postgres directly rather than going through the semantic layer: a warehouse filter
    model has no natural "IN this arbitrary list" shape at that scale.

    An empty selection produces an empty slice, NOT the corpus. `= ANY('{}')` matches no row,
    which is the behaviour we want and the reason the predicate is `ANY(%s)` rather than an
    interpolated `IN (...)` — the latter degenerates to `IN ()`, a syntax error at best and a
    silently unfiltered scan in any code that special-cases it away.
    """
    ids = list(record_ids)
    sliced = Distribution.from_rows(conn.execute(SLICE_SQL, (ids,)).fetchall())
    corpus = Distribution.from_rows(conn.execute(CORPUS_SQL).fetchall())
    return sliced, corpus
