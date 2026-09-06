"""Filter-value resolution — the half of a selection that cannot be enum-locked at decode time.

Measure and dimension NAMES are locked by the structured-output schema: the model either emits a
member that exists or the call is malformed. Filter VALUES cannot be locked the same way, because
they are free text describing something in the corpus. The model emits "Healthcare" where the
data holds "Health Care Industry", Cube returns zero rows, and zero rows read as *we have no
records* rather than *you named something we do not carry*.

That asymmetry is the whole reason this module exists, and it is worth stating in an interview:
one half of a selection is guaranteed by construction and the other is best-effort, so the
best-effort half needs a resolution step that fails LOUDLY.

## Two tiers, and what the losing alternative measured

    exact     case- and whitespace-insensitive. Free, deterministic, spends no call.
    pick      a constrained chooser over exactly the corpus's own values.

`pick` is a model call with the candidates as an enum, and it beat the obvious alternative.
Measured on 16 legal terms of art against 92 subject values:

    model        14/16, ZERO false positives, correct null on all four terms the corpus lacked
    embeddings   12/16 at a hand-tuned 0.55 cosine floor, and one outright wrong match

The three the embeddings missed — "no-shop", "matching rights", "bringdown standard" — are terms
whose vocabulary is literal, where a 256-dimension shortened vector could not clear the floor.
The two the model missed it DECLINED rather than got wrong, which is the better failure: a false
refusal costs a retry, a false resolution looks like a right answer.

The embedding tier is gone rather than kept as a fallback. Keeping it would mean a third,
undocumented behaviour that fires only when a key is missing, and silently scoring worse.

## What is deliberately NOT resolved

A dimension whose values grow with the corpus — a party name, a date — has no vocabulary to lock,
and its values travel verbatim. Refusing those would make the resolver a censor rather than a
translator.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from quorum.logging import get_logger

log = get_logger()


@dataclass(frozen=True)
class Resolution:
    raw: str
    resolved: str
    method: str  # "exact" | "model"


class UnresolvedValue(RuntimeError):
    """The corpus carries no value by this name. Carries candidates so a caller can offer them."""

    def __init__(self, raw: str, candidates: list[str]) -> None:
        self.raw = raw
        self.candidates = candidates
        shown = ", ".join(repr(c) for c in candidates[:5])
        super().__init__(
            f"{raw!r} is not a value this field carries. Filtering on it would return zero "
            f"rows, which reads as an empty corpus rather than an unknown value. "
            f"Near misses: {shown}."
        )


def resolve_against(raw: str, candidates: list[str], *, pick: Any) -> Resolution:
    """Resolve `raw` to one of `candidates`, or raise `UnresolvedValue`.

    `pick` returning None means the corpus genuinely has no value for this — which is a real
    answer, not a failure. Some terms of art simply have no entry in a given taxonomy, and
    inventing a nearest match for them is the silent wrong answer this module exists to prevent.

    A `pick` result outside `candidates` is treated as a refusal. The enum should make that
    unreachable; if it ever arrives it must not become a filter that matches nothing.
    """
    needle = raw.strip().lower()
    exact = next((c for c in candidates if c.strip().lower() == needle), None)
    if exact is not None:
        log.info("value_resolved", raw=raw, resolved=exact, method="exact")
        return Resolution(raw=raw, resolved=exact, method="exact")

    if not candidates:
        raise UnresolvedValue(raw, [])

    chosen = pick(raw, candidates)
    if chosen is None or chosen not in candidates:
        log.info("value_unresolved", raw=raw, offered=len(candidates), chosen=chosen)
        raise UnresolvedValue(raw, candidates[:8])

    log.info("value_resolved", raw=raw, resolved=chosen, method="model")
    return Resolution(raw=raw, resolved=chosen, method="model")
