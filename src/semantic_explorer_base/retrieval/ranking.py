"""What a ranking is allowed to claim about itself.

Two controls, both promoted from the reference application (#12), both found by typing gibberish
into a search box and looking at what came back.

## A ranker that found nothing must not rank

Typing `Ccdsfdafsdfsdwo` returned 25 records in record-id order, labelled "ranked by relevance",
with the first card focus-ringed as the best match. Every score was exactly `0.0` — BM25 matched
no token in any record's searchable text — so a query that matched NOTHING rendered identically
to one that matched perfectly. "Your words matched nothing" and "here are the closest records"
are different statements and only one of them was true.

`gates/min_n.py` already refuses a slice too thin to characterise. This is the same discipline on
the retrieval path, which had no equivalent: the gate covered the aggregate side of the product
and the ranker was never asked whether it had anything to rank.

**There is no threshold to tune, and that is why this is safe to have.** `normalize()` in
`hybrid.py` min-max scales each half per query, so a real match always promotes its best hit to
1.0 — a flat distribution maps to zeros rather than promoting an arbitrary best hit. An all-zero
score vector is therefore only reachable when nothing matched at all. The property this leans on
is already the platform's and already tested; this module only reads it.

## The label names the half that ran, not a blend weight

The old label read `"hybrid over the templated narrative · alpha=0.0 (keyword only)"`. Two things
wrong with it at once: it calls a single-half ranking a hybrid, and it leaks a parameter into
prose. `alpha` stays the API's real parameter — a caller can still blend at 0.37 and should be
told so. It is the *label* that stopped describing a dial once the UI offered two exclusive
positions rather than a slider.

## Why `over` is a parameter

The platform does not know what a record's searchable text IS — `HybridIndex` takes the SQL as an
argument for exactly this reason. One corpus concatenates a title and two party names; another
templates a sentence out of categorical columns. So the noun in the label comes from the caller,
and the platform supplies only the grammar around it.
"""

from __future__ import annotations

from collections.abc import Sequence

from semantic_explorer_base.retrieval.hybrid import Scored


def matched_nothing(hits: Sequence[Scored]) -> bool:
    """Whether this result is a ranking of nothing.

    `hits` empty is deliberately NOT a non-match. An empty hit list means there was nothing to
    rank — the filter left no candidates, or the index is empty — and reporting that as an
    unmatched query blames the reader's words for an empty slice. The two empty states have
    different causes and different remedies, and collapsing them teaches a reader to distrust
    every empty result they ever see (the same argument `min_n` makes for keeping refusal
    distinct from "there is nothing here").
    """
    return bool(hits) and max(h.score for h in hits) <= 0.0


def ranked_by(alpha: float, over: str) -> str:
    """The label for a ranking that ran. `over` names what was searched, e.g. "the record text".

    The two exclusive positions get a bare noun; a genuine blend keeps its weight, because there
    the weight is the only thing distinguishing one blend from another and a reader comparing two
    rankings needs it.
    """
    if alpha >= 1.0:
        half = "meaning"
    elif alpha <= 0.0:
        half = "keyword"
    else:
        half = f"blend ({alpha:g} meaning)"
    return f"{half} over {over}"


def unmatched_label(over: str) -> str:
    """The label for a ranking that did not run, for the same field the ranking would have used.

    Returning zero rows quietly would fix the ordering and leave the signage broken: the reader
    still cannot tell "your words matched nothing" from "this slice is empty". The label is the
    actual defect, so the label is the actual fix, and it belongs beside the guard rather than in
    each caller's response builder where the two can drift apart.
    """
    return f"nothing — the query matched nothing in {over}"
