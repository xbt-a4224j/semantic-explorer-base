"""A ranker that found nothing must not rank, and the label must name the half that ran.

Promoted from the reference application (semantic-explorer-base#12, items 1 and 2), where both
defects were found by typing gibberish into a search box.

The first defect: a nonsense query returned 25 records in record-id order, labelled "ranked by
relevance", with the first card focus-ringed as the best match. Every score was exactly 0.0 —
the keyword half matched no token — so a query that matched NOTHING rendered identically to one
that matched perfectly. That is a wrong answer that looks like a finding, which is the failure
this whole platform exists to prevent.

The second: the label read "hybrid over the templated narrative · alpha=0.0 (keyword only)". It
called a single-half ranking a hybrid and leaked a parameter the UI no longer exposed.

These run against `Scored` values directly rather than a live API. The application's versions of
these tests hit `localhost` and read a domain corpus; the platform has no corpus, and the logic
under test never needed one.
"""

from __future__ import annotations

import pytest

from semantic_explorer_base.retrieval import Scored
from semantic_explorer_base.retrieval.ranking import (
    matched_nothing,
    ranked_by,
    unmatched_label,
)

#: The noun a domain supplies for what was searched. The platform never invents one: it does not
#: know whether a record's searchable text is a contract, a templated sentence or an address.
OVER = "the record text"


def hits(*scores: float) -> list[Scored]:
    return [
        Scored(record_id=f"r{i}", score=s, vector_score=s, bm25_score=s)
        for i, s in enumerate(scores)
    ]


class TestARankerThatFoundNothingDoesNotRank:
    def test_an_all_zero_result_is_a_non_match(self) -> None:
        """The exact live shape: every score 0.0, records still in id order."""
        assert matched_nothing(hits(0.0, 0.0, 0.0))

    def test_one_real_hit_is_a_match_even_when_the_rest_are_zero(self) -> None:
        """Min-max normalisation promotes the best hit of a real match to 1.0, so the zeros
        below it are the normal shape of a good ranking, not evidence of a miss. This is why
        the guard needs no tuned threshold."""
        assert not matched_nothing(hits(1.0, 0.0, 0.0))

    def test_a_faint_but_real_match_still_ranks(self) -> None:
        assert not matched_nothing(hits(1e-9, 0.0))

    def test_an_empty_result_is_not_a_non_match(self) -> None:
        """"Nothing was searched" and "your words matched nothing" are different statements.
        An empty hit list means the filter left no candidates to rank, and reporting that as an
        unmatched query would blame the reader's words for an empty slice."""
        assert not matched_nothing([])

    def test_the_label_says_the_query_matched_nothing(self) -> None:
        """Returning zero rows quietly would still leave a reader unable to tell "your words
        matched nothing" from "this slice is empty" — the label IS the fix."""
        assert "nothing" in unmatched_label(OVER)
        assert OVER in unmatched_label(OVER)


class TestTheLabelNamesTheHalfThatRan:
    def test_keyword_only(self) -> None:
        assert ranked_by(0.0, OVER) == "keyword over the record text"

    def test_meaning_only(self) -> None:
        assert ranked_by(1.0, OVER) == "meaning over the record text"

    def test_a_real_blend_says_blend_and_may_carry_its_weight(self) -> None:
        label = ranked_by(0.5, OVER)
        assert label.startswith("blend")
        assert OVER in label

    @pytest.mark.parametrize("alpha", [0.0, 1.0])
    def test_neither_exclusive_position_calls_itself_hybrid_or_names_alpha(
        self, alpha: float
    ) -> None:
        """`alpha` is still the API's real parameter. It is the *label* that stopped
        describing a dial the UI no longer exposes."""
        label = ranked_by(alpha, OVER)
        assert "hybrid" not in label
        assert "alpha" not in label
