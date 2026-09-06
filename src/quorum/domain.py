"""The domain contract — everything a corpus must declare to run on this platform.

This is the single point the whole extraction turns on. Before it, the pipeline hardcoded
`deal_points.deal_point_name`, `deal_points.position` and `deal_points.n` in four modules, which
is why a second domain could only be produced by cloning the first and renaming things.

The insight that made the split possible: the modules that looked most domain-coupled were not
coupled to the *domain*, they were coupled to a handful of **member names**. `shape.py` carried
19 references to legal vocabulary and contains no legal logic at all — it builds four Cube
selections, and every one of them names the same three members. Parameterise those and the file
becomes domain-free without changing a line of its behaviour.

## The subject axis

`subject_axis` is the load-bearing field. It names the dimension nearly every question is about:
a deal point in the legal corpus, a claim finding in the health one. Pinning it took the
reference implementation from answering **0 of 20** real questions to **16 of 20** — the single
largest measured improvement in the project — so a domain that gets this field wrong gets an app
that cannot answer anything, and it deserves to fail loudly at load rather than mysteriously at
query time.

## What is deliberately NOT here

No connection strings, no ports, no API keys. Those are environment, they differ per deployment
rather than per domain, and mixing the two is how `settings.py` became a grab bag in the first
place. A manifest is checked into the domain repo and is the same on every machine.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass, field
from typing import Any

import yaml

MANIFEST = "quorum.yaml"


class InvalidDomain(ValueError):
    """The manifest is missing or does not describe a usable domain."""


@dataclass(frozen=True)
class Domain:
    """One corpus, described well enough for the platform to serve it."""

    #: Human name of the application. Appears in the UI and in logs.
    name: str

    #: Stamped into `corpus_claim` on first ingest, and checked on every ingest after. Two
    #: corpora in one database do not collide loudly — they interleave, and every count
    #: silently becomes a number about both. This has already happened once: a fork's ingest
    #: wrote 979 matters of health-claims data into a merger-agreement corpus and the industry
    #: rail began reading "Injury — sprain or strain  n=254".
    corpus: str

    #: THE dimension nearly every question names. See the module docstring.
    subject_axis: str

    #: How the subject came out — the answer text, grouped to make a distribution.
    answer_dimension: str

    #: The count measure at the subject's own grain. Used as the sample size and read by the
    #: `min_n` gate.
    count_measure: str

    #: The count measure at the RECORD grain — agreements, claims. Distinct from
    #: `count_measure` and the distinction matters: on the reference corpus the same slice is
    #: 26 by one and 2,245 by the other, because a row means something different in each. A
    #: gate reading the inflated one let a slice of one clear a threshold of five.
    record_count: str

    #: Percentile measures over the subject's numeric answers. Meaningless unless the selection
    #: is pinned to one subject value, because the underlying column holds several units at
    #: once — on the reference corpus, months and business days and percent. Unscoped, its
    #: median evaluates to `4`, which is not a wrong quantity so much as not a quantity.
    numeric_measures: tuple[str, ...] = ()

    #: The cubes and views the agent may select from. Everything else in `/meta` is invisible
    #: to it — a physical cube the model layer exposes only to be joined through is not a thing
    #: anyone should be able to ask about, and offering it means offering members whose meaning
    #: is undefined outside a join.
    selectable: tuple[str, ...] = ()

    #: Measures present in the model that the agent must never pick. There is usually one: a
    #: mean kept beside a median so a reader can see they diverge, which the agent selecting it
    #: would turn into exactly the wrong number. Naming it here beats trimming it from the model,
    #: because the dashboard still wants it.
    excluded_measures: tuple[str, ...] = ()

    #: Where the Cube model lives, relative to the domain repo root.
    cube_model: str = "cube/model"

    #: Free-form, for the UI. The platform does not read these.
    strings: dict[str, Any] = field(default_factory=dict)

    @property
    def requires_subject(self) -> frozenset[str]:
        """Measures that are meaningless without the subject axis pinned to one value."""
        return frozenset(self.numeric_measures)

    def validate(self) -> None:
        """Fail loudly and specifically, at load, rather than at query time.

        A domain whose subject axis is wrong produces an app that answers nothing, and the
        symptom — every question declining — looks like a model problem rather than a
        configuration one. Cheap to check, expensive to debug.
        """
        for name in ("name", "corpus", "subject_axis", "answer_dimension", "count_measure"):
            if not getattr(self, name):
                raise InvalidDomain(f"quorum.yaml is missing a value for {name!r}")
        for name in ("subject_axis", "answer_dimension", "count_measure", "record_count"):
            value = getattr(self, name)
            if value and "." not in value:
                raise InvalidDomain(
                    f"{name} must be a fully qualified Cube member like 'cube.member', "
                    f"got {value!r} — a bare name silently matches nothing at query time"
                )
        if self.subject_axis == self.answer_dimension:
            raise InvalidDomain(
                "subject_axis and answer_dimension must differ: grouping a dimension by itself "
                "returns one row per value with a count of one, which reads as a distribution "
                "and is not one"
            )
        if self.count_measure == self.record_count:
            raise InvalidDomain(
                "count_measure and record_count must differ — they count different things, and "
                "conflating them is what let a slice of one clear a threshold of five"
            )


def load(root: pathlib.Path | str = ".") -> Domain:
    """Read `quorum.yaml` from a domain repo root."""
    path = pathlib.Path(root) / MANIFEST
    if not path.exists():
        raise InvalidDomain(
            f"no {MANIFEST} at {path.parent.resolve()}. Every domain declares itself in one "
            f"file; run `quorum init` to write a starting point."
        )
    raw = yaml.safe_load(path.read_text()) or {}
    known = {f.name for f in Domain.__dataclass_fields__.values()}
    unknown = set(raw) - known
    if unknown:
        # Silently ignoring a key means a typo'd `subject_axis:` leaves the app answering
        # nothing with no indication why.
        raise InvalidDomain(
            f"{MANIFEST} has keys this platform does not understand: {sorted(unknown)}. "
            f"Known keys: {sorted(known)}"
        )
    for key in ("numeric_measures", "selectable", "excluded_measures"):
        if isinstance(raw.get(key), list):
            raw[key] = tuple(raw[key])
    domain = Domain(**raw)
    domain.validate()
    return domain
