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

import dataclasses
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

    #: Every count measure the gate must read, widest grain FIRST. Defaults to
    #: `(record_count, count_measure)`, which is right for a domain with only those two. A
    #: corpus with a third — an explicit distinct-record count alongside the row count — lists
    #: all of them, because the gate takes the minimum and a count it cannot see is a count it
    #: cannot gate on. Both namespaces on the reference corpus call theirs `n`, and a single
    #: hardcoded key silently disabled the gate on whichever one it was not: a slice of one came
    #: back carrying counterparty names with `refused: false`.
    count_measures: tuple[str, ...] = ()

    #: Percentile measures over the subject's numeric answers. Meaningless unless the selection
    #: is pinned to one subject value, because the underlying column holds several units at
    #: once — on the reference corpus, months and business days and percent. Unscoped, its
    #: median evaluates to `4`, which is not a wrong quantity so much as not a quantity.
    numeric_measures: tuple[str, ...] = ()

    #: The denominator for those percentiles, and a DIFFERENT number from `count_measure`.
    #: Most subjects are categorical, so only a minority of answers carry a parseable number —
    #: 809 of 12,937 on the reference corpus. Reporting a median beside the subject's full count
    #: overstates the sample it came from by 16x. Defaults to `count_measure` for a domain with
    #: no numeric measures, where the distinction cannot arise.
    numeric_count: str = ""

    #: The cubes and views the agent may select from. Everything else in `/meta` is invisible
    #: to it — a physical cube the model layer exposes only to be joined through is not a thing
    #: anyone should be able to ask about, and offering it means offering members whose meaning
    #: is undefined outside a join.
    selectable: tuple[str, ...] = ()

    #: Record-level dimensions a question may be scoped BY, as opposed to asked about. The
    #: subject axis says which term a question is about; these say which slice of the corpus.
    #:
    #: Without them the four shapes can express "the consideration split" but not "the
    #: consideration split for healthcare deals", and the word `healthcare` was silently
    #: dropped — the corpus-wide answer returned as though it were the scoped one. Values are
    #: free text and resolved through `agent.resolve`, never trusted verbatim, because a
    #: dimension holds `Health Care Industry` where a person says `healthcare`.
    scope_dimensions: tuple[str, ...] = ()

    #: Measures present in the model that the agent must never pick. There is usually one: a
    #: mean kept beside a median so a reader can see they diverge, which the agent selecting it
    #: would turn into exactly the wrong number. Naming it here beats trimming it from the model,
    #: because the dashboard still wants it.
    excluded_measures: tuple[str, ...] = ()

    #: Above this a recorded span is document-scale rather than clause-scale and is rendered as
    #: a bounded excerpt. A fact about the corpus's documents, which is why it is here and not
    #: in the deployment's settings: the reference corpus's spans have a median of 4,658
    #: characters and a 90th percentile of 238,949, and rendering the raw slice as "the clause"
    #: showed a table of contents. 0 disables the excerpting.
    max_clause_chars: int = 0

    #: How much of a document-scale span is shown when it exceeds `max_clause_chars`.
    excerpt_chars: int = 1200

    #: Where the Cube model lives, relative to the domain repo root.
    cube_model: str = "cube/model"

    #: What `quorum ingest` loads, for a domain whose data is CSV/TSV/JSON/JSONL and which
    #: therefore needs no parser of its own:
    #:
    #:     ingest:
    #:       records: {path: data/records.csv, format: csv, map: {id: matter_id}}
    #:       facts:   {path: data/facts.jsonl, format: jsonl, map: {record_id: matter_id,
    #:                                                            subject: point, position: answer}}
    #:
    #: Both `format` and `map` are explicit, decided by whoever is onboarding the domain (see
    #: SPEC-02), never inferred. This platform used to sniff format from a file's content and
    #: guess column roles from their names; both were deleted, because both are judgment calls
    #: a wrong pattern gets away with silently — a guessed format produces one row that looks
    #: like data, and a guessed column produces a table full of nulls, neither raising anything.
    #: Columns NOT named in `map` are not dropped; they land in `records.attributes` as JSONB,
    #: which is the one part of this that genuinely needs no decision.
    #:
    #: Empty for a domain that ships its own parser. The reference corpus does, because MAUD is
    #: nested JSON no generic reader could sensibly guess at.
    ingest: dict[str, Any] = field(default_factory=dict)

    #: Free-form, for the UI. The platform does not read these.
    strings: dict[str, Any] = field(default_factory=dict)

    #: Dimensions that name an individual record's parties, and therefore must never be a
    #: GROUPING key in the aggregate layer.
    #:
    #: `min_n` gates on counts, so a selection with no count has nothing to gate on. That is
    #: correct for a median-only selection and a total bypass here: grouped by a party name,
    #: every row is one record, n=1 by construction, and the gate reads no count to refuse on.
    #: An adversarial review reached 152 rows of named target, named acquirer and negotiated
    #: answer with `refused: false` by asking for LESS rather than more.
    #:
    #: Filtering *to* one party stays legal — that path hits `min_n` and refuses at n=1, which
    #: is the behaviour the reference domain demonstrates on purpose. The leak is grouping BY.
    identifying_dimensions: tuple[str, ...] = ()

    @property
    def gated_counts(self) -> tuple[str, ...]:
        """Every count the min_n gate reads. Never empty."""
        return self.count_measures or (self.record_count, self.count_measure)

    @property
    def percentile_denominator(self) -> str:
        """What a median is out of. Never the subject's own count when the two differ."""
        return self.numeric_count or self.count_measure

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
        for name in (
            "name",
            "corpus",
            "subject_axis",
            "answer_dimension",
            "count_measure",
        ):
            if not getattr(self, name):
                raise InvalidDomain(f"quorum.yaml is missing a value for {name!r}")
        for name in (
            "subject_axis",
            "answer_dimension",
            "count_measure",
            "record_count",
        ):
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
        if self.numeric_measures and not self.numeric_count:
            raise InvalidDomain(
                "numeric_measures without numeric_count: a percentile needs its own denominator. "
                "Only answers carrying a parseable number are in a median's sample — 809 of "
                "12,937 on the reference corpus — so reporting it against count_measure "
                "overstates the sample by 16x"
            )
        for name in self.scope_dimensions:
            if "." not in name:
                raise InvalidDomain(
                    f"scope_dimensions entry {name!r} must be a fully qualified Cube member"
                )
        if self.subject_axis in self.scope_dimensions:
            raise InvalidDomain(
                "subject_axis must not be a scope dimension — it is what a question is ABOUT, "
                "and offering it as a slice lets one question pin it twice to different values"
            )
        for name in self.count_measures:
            if "." not in name:
                raise InvalidDomain(
                    f"count_measures entry {name!r} must be a fully qualified Cube member"
                )
        if self.count_measures and self.count_measure not in self.count_measures:
            raise InvalidDomain(
                "count_measures must include count_measure — the gate takes the minimum across "
                "them, and a count it cannot see is a count it cannot gate on"
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
    for key in (
        "numeric_measures",
        "selectable",
        "excluded_measures",
        "count_measures",
        "scope_dimensions",
    ):
        if isinstance(raw.get(key), list):
            raw[key] = tuple(raw[key])
    try:
        domain = Domain(**raw)
    except TypeError as exc:
        # A half-filled manifest reached the dataclass constructor and raised a TypeError,
        # which surfaces as a traceback naming `Domain.__init__` — a message about this file's
        # internals in answer to a question about the reader's config. Every other failure here
        # names the field and says what it does; this one has to as well.
        required = [
            f.name
            for f in Domain.__dataclass_fields__.values()
            if f.default is dataclasses.MISSING and f.default_factory is dataclasses.MISSING  # type: ignore[misc]
        ]
        missing = [name for name in required if name not in raw]
        raise InvalidDomain(
            f"{MANIFEST} is missing required field(s): {missing or sorted(required)}. "
            f"Every domain must declare at least {required} — run `quorum init` to write a "
            f"starting point ({exc})."
        ) from exc
    domain.validate()
    return domain
