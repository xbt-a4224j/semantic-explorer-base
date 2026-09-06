"""The claim guard, on a fake connection. No database needed to pin the ordering.

The property that matters is not "it detects a collision" — it is that it detects one BEFORE
writing. A guard that reports the accident afterwards has documented it.
"""

from __future__ import annotations

from typing import Any

import pytest

from semantic_explorer_base.db.corpus import ForeignCorpus, claim_corpus

LEGAL = "maud-public-target-merger-agreements"
HEALTH = "synthea-synthetic-claims"


class FakeConn:
    """Records every statement in order, so the test can assert on the ordering."""

    def __init__(self, claimed: str | None = None) -> None:
        self.claimed = claimed
        self.statements: list[str] = []
        self.committed = False

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> FakeConn:
        self.statements.append(" ".join(sql.split())[:60])
        if params:
            self.claimed = str(params[0])
        return self

    def fetchone(self) -> tuple[str] | None:
        return (self.claimed,) if self.claimed else None

    def commit(self) -> None:
        self.committed = True


def test_an_unclaimed_database_is_claimed() -> None:
    conn = FakeConn()
    assert claim_corpus(conn, LEGAL) == LEGAL
    assert conn.committed


def test_reclaiming_the_same_corpus_is_a_no_op() -> None:
    """Ingest is re-run constantly. The guard must never break the second run."""
    conn = FakeConn(claimed=LEGAL)
    assert claim_corpus(conn, LEGAL) == LEGAL


class TestAForeignCorpusIsRefusedBeforeAnyWrite:
    def test_it_raises(self) -> None:
        with pytest.raises(ForeignCorpus):
            claim_corpus(FakeConn(claimed=LEGAL), HEALTH)

    def test_nothing_was_written(self) -> None:
        """The ordering IS the feature. Only the table creation and the read may have run."""
        conn = FakeConn(claimed=LEGAL)
        with pytest.raises(ForeignCorpus):
            claim_corpus(conn, HEALTH)
        assert not conn.committed
        assert not any(
            s.upper().startswith(("INSERT", "UPDATE", "DELETE")) for s in conn.statements
        ), conn.statements

    def test_the_message_names_both_corpora_and_the_variable_to_change(self) -> None:
        """An error saying only "wrong corpus" leaves the reader to work out which two collided
        and where the setting lives. This one was written after someone spent an afternoon on
        exactly that."""
        with pytest.raises(ForeignCorpus) as raised:
            claim_corpus(FakeConn(claimed=LEGAL), HEALTH, dsn_var="QUORUM_DB")
        message = str(raised.value)
        assert LEGAL in message
        assert HEALTH in message
        assert "QUORUM_DB" in message
        assert "Nothing has been written" in message


def test_an_empty_corpus_name_is_rejected() -> None:
    """An unnamed corpus cannot be told apart from another one, which is the entire job."""
    with pytest.raises(ValueError, match="quorum.yaml"):
        claim_corpus(FakeConn(), "")
