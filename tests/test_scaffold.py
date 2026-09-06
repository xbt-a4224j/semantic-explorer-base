"""`quorum init` on a corpus that shares nothing with either real domain.

Deliberately a third subject — parking citations — because the two real apps cannot prove
anything about onboarding: they share a root commit, and anything that works for them may be
working by inheritance.

What is asserted is the ONBOARDING CLAIM: make a directory, drop two files in `data/`, and the
generated manifest plus model are enough for the pipeline to run. Not that the guesses are
right — they are guesses, and the file says so.
"""

from __future__ import annotations

import json
import pathlib

import yaml

from quorum.domain import load
from quorum.scaffold import classify, scaffold


def _corpus(root: pathlib.Path) -> pathlib.Path:
    data = root / "data"
    data.mkdir(parents=True)
    (data / "citations.csv").write_text(
        "citation_id,title,officer,issued_on\n"
        "C-1,Meter expired,4471,2026-01-04\n"
        "C-2,Blocked hydrant,2210,2026-01-05\n"
    )
    (data / "findings.jsonl").write_text(
        "\n".join(
            json.dumps(row)
            for row in [
                {"citation_id": "C-1", "code": "Contested", "answer": "Upheld", "days": 31},
                {"citation_id": "C-2", "code": "Contested", "answer": "Dismissed", "days": 12},
            ]
        )
    )
    return root


class TestItReadsWhatIsThere:
    def test_it_tells_records_from_facts_structurally(self, tmp_path: pathlib.Path) -> None:
        """By shape, not by filename. Naming conventions differ per corpus; the long shape of a
        facts table does not, which is the whole reason the schema is long."""
        plan = classify(_corpus(tmp_path))
        assert plan["records"]["path"] == "data/citations.csv"
        assert plan["facts"]["path"] == "data/findings.jsonl"

    def test_it_maps_the_columns_it_recognises(self, tmp_path: pathlib.Path) -> None:
        plan = classify(_corpus(tmp_path))
        assert plan["records"]["map"]["id"] == "citation_id"
        assert plan["facts"]["map"] == {
            "record_id": "citation_id",
            "subject": "code",
            "position": "answer",
            "numeric_value": "days",
        }


class TestTheGeneratedManifestIsUsable:
    def test_it_loads_and_validates(self, tmp_path: pathlib.Path) -> None:
        """The point of generating a model alongside it: a manifest naming members nothing
        defines is the failure `quorum check` exists to catch, and shipping init without one
        would guarantee it on every new domain."""
        scaffold(_corpus(tmp_path), "Parking Citations")
        domain = load(tmp_path)
        domain.validate()
        assert domain.subject_axis == "facts.subject"
        assert domain.count_measure != domain.record_count

    def test_the_ingest_block_points_at_the_real_files(self, tmp_path: pathlib.Path) -> None:
        scaffold(_corpus(tmp_path), "Parking Citations")
        domain = load(tmp_path)
        assert (tmp_path / domain.ingest["records"]["path"]).exists()
        assert (tmp_path / domain.ingest["facts"]["path"]).exists()

    def test_every_inference_is_marked_as_one(self, tmp_path: pathlib.Path) -> None:
        """A generated config that presents itself as authoritative is worse than none: the
        next person reads guesses as decisions. `subject_axis` is the one that matters — wrong,
        the app answers nothing, and the symptom looks like a model problem."""
        scaffold(_corpus(tmp_path), "Parking Citations")
        text = (tmp_path / "quorum.yaml").read_text()
        assert "GUESS" in text
        assert "assumptions, not" in text

    def test_unmapped_columns_are_named_rather_than_silently_dropped(
        self, tmp_path: pathlib.Path
    ) -> None:
        scaffold(_corpus(tmp_path), "Parking Citations")
        text = (tmp_path / "quorum.yaml").read_text()
        assert "officer" in text and "issued_on" in text
        assert "attributes" in text


class TestTheGeneratedModelMatchesTheManifest:
    def test_every_member_the_manifest_names_is_defined(self, tmp_path: pathlib.Path) -> None:
        """The same cross-check `quorum check` runs against live Cube, run offline against the
        YAML — so a broken generator fails here rather than at someone's first question."""
        scaffold(_corpus(tmp_path), "Parking Citations")
        domain = load(tmp_path)
        model = yaml.safe_load((tmp_path / "cube/model/quorum.yml").read_text())

        defined = {
            f"{cube['name']}.{member['name']}"
            for cube in model["cubes"]
            for kind in ("measures", "dimensions")
            for member in cube.get(kind, [])
        }
        for name in (
            domain.subject_axis,
            domain.answer_dimension,
            domain.count_measure,
            domain.record_count,
            *domain.count_measures,
        ):
            assert name in defined, f"{name} is in quorum.yaml and not in the model"

    def test_the_subject_axis_is_declared_a_closed_vocabulary(self, tmp_path: pathlib.Path) -> None:
        """Without it, filter values have nothing to resolve against and a near-miss returns
        zero rows — which reads as "we have no records like that"."""
        scaffold(_corpus(tmp_path), "Parking Citations")
        model = yaml.safe_load((tmp_path / "cube/model/quorum.yml").read_text())
        facts = next(c for c in model["cubes"] if c["name"] == "facts")
        subject = next(d for d in facts["dimensions"] if d["name"] == "subject")
        assert subject["meta"]["closed_vocabulary"] is True

    def test_a_median_ships_with_its_own_denominator(self, tmp_path: pathlib.Path) -> None:
        """The defect the extraction found, generated correctly from the start: a percentile's
        sample is the answers carrying a number, never the subject's row count."""
        scaffold(_corpus(tmp_path), "Parking Citations")
        model = yaml.safe_load((tmp_path / "cube/model/quorum.yml").read_text())
        facts = next(c for c in model["cubes"] if c["name"] == "facts")
        measures = {m["name"] for m in facts["measures"]}
        assert {"median_numeric_value", "numeric_n"} <= measures


def test_a_corpus_with_no_numbers_gets_no_median(tmp_path: pathlib.Path) -> None:
    """A median measure with nothing to take a median of is a member the agent can select and
    get an empty answer from. Not generating it is better than generating it unused."""
    data = tmp_path / "data"
    data.mkdir(parents=True)
    (data / "r.csv").write_text("id,title\nR-1,One\n")
    (data / "f.csv").write_text("id,code,answer\nR-1,Topic,Yes\n")
    scaffold(tmp_path, "No Numbers")
    model = yaml.safe_load((tmp_path / "cube/model/quorum.yml").read_text())
    facts = next(c for c in model["cubes"] if c["name"] == "facts")
    assert "median_numeric_value" not in {m["name"] for m in facts["measures"]}


def test_scaffold_never_overwrites(tmp_path: pathlib.Path) -> None:
    """Re-running init after editing the manifest must not throw the edits away."""
    scaffold(_corpus(tmp_path), "Parking Citations")
    (tmp_path / "quorum.yaml").write_text("name: Edited By Hand\ncorpus: x\n")
    assert scaffold(tmp_path, "Parking Citations") == []
    assert "Edited By Hand" in (tmp_path / "quorum.yaml").read_text()
