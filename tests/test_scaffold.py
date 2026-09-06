"""`quorum init` — the skeleton, not the decisions.

This used to read `data/`, guess column roles from names, and write a manifest that looked
finished. Deleted: the guesser's own `_id$` pattern anchored at the wrong end of the string under
`re.match` and silently missed the exact column (`citation_id`) it was written to prove worked.
A confident wrong guess is worse than an honest blank — a blank gets read.

What is tested now is narrower and more honest: the template is written, nothing is inferred, no
placeholder is left looking like a real decision, and re-running never discards edits.
"""

from __future__ import annotations

import pathlib

import yaml

from quorum.scaffold import scaffold


def test_it_writes_both_files(tmp_path: pathlib.Path) -> None:
    written = scaffold(tmp_path, "Parking Citations")
    assert {p.name for p in written} == {"quorum.yaml", "quorum.yml"}
    assert (tmp_path / "quorum.yaml").exists()
    assert (tmp_path / "cube" / "model" / "quorum.yml").exists()


def test_it_creates_the_directory_skeleton(tmp_path: pathlib.Path) -> None:
    scaffold(tmp_path, "Parking Citations")
    assert (tmp_path / "data").is_dir()
    assert (tmp_path / "cube" / "model").is_dir()


class TestNothingIsInferred:
    """The property that matters most: every field a human has to decide is visibly
    undecided, never a plausible-looking value that could pass for a real one."""

    def test_no_field_the_reader_must_choose_looks_like_a_real_value(
        self, tmp_path: pathlib.Path
    ) -> None:
        scaffold(tmp_path, "Parking Citations")
        text = (tmp_path / "quorum.yaml").read_text()
        for field in ("subject_axis", "answer_dimension", "count_measure", "record_count"):
            line = next(line_ for line_ in text.splitlines() if line_.startswith(f"{field}:"))
            assert "<" in line, f"{field} looks decided when it should look like a placeholder"

    def test_the_manifest_does_not_load_as_a_valid_domain_until_edited(
        self, tmp_path: pathlib.Path
    ) -> None:
        """The template must fail `quorum check`, loudly, rather than silently pass as a
        configured domain nobody actually configured."""
        from quorum.domain import InvalidDomain, load

        scaffold(tmp_path, "Parking Citations")
        try:
            load(tmp_path).validate()
        except InvalidDomain:
            return
        raise AssertionError("a template with every field a placeholder must not validate")

    def test_it_points_at_the_specs_that_explain_each_decision(
        self, tmp_path: pathlib.Path
    ) -> None:
        scaffold(tmp_path, "Parking Citations")
        manifest = (tmp_path / "quorum.yaml").read_text()
        model = (tmp_path / "cube" / "model" / "quorum.yml").read_text()
        assert "SPEC-01" in manifest
        assert "SPEC-03" in model


def test_the_name_is_used_and_the_corpus_slug_is_derived_from_it(tmp_path: pathlib.Path) -> None:
    scaffold(tmp_path, "Parking Citations")
    text = (tmp_path / "quorum.yaml").read_text()
    assert "name: Parking Citations" in text
    assert "corpus: parking-citations" in text


def test_the_generated_yaml_still_parses(tmp_path: pathlib.Path) -> None:
    """Every value is a placeholder, but the FILE must be valid YAML — a syntax error in a
    template is a worse first experience than a template that is merely incomplete."""
    scaffold(tmp_path, "Parking Citations")
    manifest = yaml.safe_load((tmp_path / "quorum.yaml").read_text())
    assert manifest["name"] == "Parking Citations"
    model = yaml.safe_load((tmp_path / "cube" / "model" / "quorum.yml").read_text())
    assert {c["name"] for c in model["cubes"]} == {"records", "facts"}


def test_scaffold_never_overwrites(tmp_path: pathlib.Path) -> None:
    """Re-running init after editing the manifest must not throw the edits away."""
    scaffold(tmp_path, "Parking Citations")
    (tmp_path / "quorum.yaml").write_text("name: Edited By Hand\ncorpus: x\n")
    assert scaffold(tmp_path, "Parking Citations") == []
    assert "Edited By Hand" in (tmp_path / "quorum.yaml").read_text()
