"""A slice distribution is uninterpretable without the corpus rate beside it.

Promoted from the reference application (semantic-explorer-base#12, item 3), where a rollup
reported one subject's positions for a 100-record slice as `N 65, Y 35` and stopped there. 35%
reads as a finding — until you know the corpus rate is 24.7%, at which point it becomes one, and
until you know it you cannot tell signal from the corpus's own shape.

The platform's discipline is that every figure carries its denominator. For a distribution the
denominator is not only its own n; it is what the same distribution looks like at rest.

The application's version of this test hit a live API and asserted the real corpus numbers. The
platform has no corpus, so this runs against a fake connection holding a small `facts` table —
the pattern `test_corpus_claim.py` already uses. The fake really filters, which is what makes
the identity test below an assertion rather than a tautology.
"""

from __future__ import annotations

from typing import Any

from semantic_explorer_base.db.baseline import Distribution, slice_and_corpus

#: (record_id, subject, position). Two subjects with different coverage on purpose: `severity`
#: is answered on every record, `channel` on only four of six. That gap is the whole reason
#: `answered_n` is per-subject rather than a corpus record count.
FACTS = [
    ("r1", "severity", "high"),
    ("r2", "severity", "high"),
    ("r3", "severity", "low"),
    ("r4", "severity", "low"),
    ("r5", "severity", "low"),
    ("r6", "severity", "low"),
    ("r1", "channel", "phone"),
    ("r2", "channel", "phone"),
    ("r3", "channel", "web"),
    ("r4", "channel", "web"),
]
EVERY_RECORD = ["r1", "r2", "r3", "r4", "r5", "r6"]


class FakeConn:
    """A `facts` table small enough to read, with real filtering.

    It answers the module's two statements by shape rather than by string match, so a rewrite of
    the SQL that preserves the grain does not break the test, but one that drops the
    `record_id = ANY(...)` predicate does.
    """

    def __init__(self) -> None:
        self.statements: list[str] = []
        self._rows: list[tuple[str, str, int]] = []

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> FakeConn:
        flat = " ".join(sql.split())
        self.statements.append(flat)
        scoped = FACTS
        if params:
            wanted = set(params[0])
            scoped = [f for f in FACTS if f[0] in wanted]
        grouped: dict[tuple[str, str], set[str]] = {}
        for record_id, subject, position in scoped:
            grouped.setdefault((subject, position), set()).add(record_id)
        self._rows = [(s, p, len(ids)) for (s, p), ids in sorted(grouped.items())]
        return self

    def fetchall(self) -> list[tuple[str, str, int]]:
        return self._rows


def test_a_position_carries_its_corpus_wide_count() -> None:
    _, corpus = slice_and_corpus(FakeConn(), ["r1", "r2"])
    assert corpus.n("severity", "high") == 2
    assert corpus.n("severity", "low") == 4


def test_the_slice_is_the_slice_and_not_the_corpus() -> None:
    """The guard against the obvious way to get this wrong: computing one number twice."""
    sliced, corpus = slice_and_corpus(FakeConn(), ["r1", "r2"])
    assert sliced.n("severity", "high") == 2
    assert sliced.n("severity", "low") == 0
    assert corpus.n("severity", "low") == 4


def test_the_denominator_is_the_answered_total_not_the_record_count() -> None:
    """`channel` is answered on 4 of the 6 records. Comparing a slice against 6 would measure
    against a rate the corpus never had — the reference corpus's version of this was a subject
    answered on 822 of 1,000 records."""
    _, corpus = slice_and_corpus(FakeConn(), ["r1"])
    assert corpus.answered_n("channel") == 4
    assert corpus.answered_n("severity") == 6


def test_a_subject_nobody_answered_has_no_denominator_rather_than_a_wrong_one() -> None:
    _, corpus = slice_and_corpus(FakeConn(), ["r1"])
    assert corpus.answered_n("a subject this corpus does not carry") == 0
    assert corpus.n("a subject this corpus does not carry", "anything") == 0


def test_both_numbers_come_from_one_connection() -> None:
    """The consistency argument is structural, not conventional: the slice and the baseline are
    read in the same connection, so no write can land between them and make a slice count
    exceed its own corpus count."""
    conn = FakeConn()
    slice_and_corpus(conn, ["r1"])
    assert len(conn.statements) == 2


def test_selecting_every_record_reproduces_the_baseline_exactly() -> None:
    """The identity that proves the two numbers are computed the same way. If the slice and the
    corpus queries ever diverge — a different grain, a different DISTINCT, a stray filter — this
    is where it shows, and it shows without needing to know any real corpus's figures."""
    sliced, corpus = slice_and_corpus(FakeConn(), EVERY_RECORD)
    assert sliced.by_subject == corpus.by_subject
    for subject in corpus.subjects:
        for position, n in corpus.positions(subject).items():
            assert sliced.n(subject, position) == n, (subject, position)


def test_an_empty_selection_reads_as_zero_everywhere_and_not_as_the_corpus() -> None:
    """The failure this shape prevents: an empty `IN ()` list quietly matching everything."""
    sliced, corpus = slice_and_corpus(FakeConn(), [])
    assert sliced.by_subject == {}
    assert sliced.answered_n("severity") == 0
    assert corpus.answered_n("severity") == 6


def test_a_distribution_can_be_built_directly_for_callers_that_already_have_rows() -> None:
    d = Distribution.from_rows([("severity", "high", 2), ("severity", "low", 1)])
    assert d.answered_n("severity") == 3
