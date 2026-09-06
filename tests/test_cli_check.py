"""`quorum check` — the command that catches what Domain.validate() structurally cannot.

`validate()` checks the manifest against ITSELF: a bare member name, percentiles with no
denominator, a subject axis equal to the answer dimension. What it cannot know is whether
`facts.numeric_n` exists in the Cube model, because it has never seen the model.

Every defect the platform extraction turned up lived in exactly that gap. The symptom of that
gap is the reason this command exists: a manifest naming a member nothing defines produces an
app that declines every question, and "every question declines" reads as a model problem rather
than as a line in a config file.
"""

from __future__ import annotations

import pathlib

import pytest

from quorum.cli import EXIT_CHECK_FAILED, EXIT_OK, check

MANIFEST = """
name: Parking Citations
corpus: parking-citations
subject_axis: facts.subject
answer_dimension: facts.position
count_measure: facts.n
record_count: records.n
count_measures: [records.n, facts.n]
numeric_measures: [facts.median_numeric_value]
numeric_count: facts.numeric_n
selectable: [records, facts]
"""

MODEL = {
    "cubes": [
        {"name": "records", "measures": [{"name": "records.n"}], "dimensions": []},
        {
            "name": "facts",
            "measures": [
                {"name": "facts.n"},
                {"name": "facts.numeric_n"},
                {"name": "facts.median_numeric_value"},
            ],
            "dimensions": [
                {"name": "facts.subject", "meta": {"closed_vocabulary": True}},
                {"name": "facts.position", "meta": {"closed_vocabulary": True}},
            ],
        },
    ]
}


@pytest.fixture
def domain_root(tmp_path: pathlib.Path) -> pathlib.Path:
    (tmp_path / "quorum.yaml").write_text(MANIFEST)
    return tmp_path


def _with_meta(monkeypatch, meta) -> None:
    """Stub `/meta`. The command's logic is the cross-check, not the HTTP."""
    from quorum.cube import client

    monkeypatch.setattr(client, "meta", lambda url, timeout=20.0: meta)


def test_a_matching_manifest_and_model_pass(monkeypatch, domain_root, capsys) -> None:
    _with_meta(monkeypatch, MODEL)
    assert check(domain_root, "http://cube") == EXIT_OK
    assert "every member the manifest names exists" in capsys.readouterr().out


class TestItNamesTheMissingMember:
    """ "Something is wrong" sends someone to read every file. The member name sends them to
    one line."""

    def test_a_measure_the_model_does_not_define(self, monkeypatch, domain_root, capsys) -> None:
        thinned = {
            "cubes": [
                {**c, "measures": [m for m in c["measures"] if m["name"] != "facts.numeric_n"]}
                for c in MODEL["cubes"]
            ]
        }
        _with_meta(monkeypatch, thinned)
        assert check(domain_root, "http://cube") == EXIT_CHECK_FAILED
        assert "facts.numeric_n" in capsys.readouterr().err

    def test_a_selectable_cube_that_does_not_exist(self, monkeypatch, domain_root, capsys) -> None:
        _with_meta(monkeypatch, {"cubes": [MODEL["cubes"][1]]})
        assert check(domain_root, "http://cube") == EXIT_CHECK_FAILED
        assert "records" in capsys.readouterr().err


def test_a_subject_axis_that_is_not_a_closed_vocabulary_fails(
    monkeypatch, domain_root, capsys
) -> None:
    """The one check about behaviour rather than existence.

    Filter values are resolved against a dimension's own values. Without the declaration there
    is nothing to resolve against, so `'Healthcare'` where the data says `'Health Care'` returns
    zero rows — which reads as "we have no records like that" rather than as a naming error.
    That is named in CLAUDE.md as the nastiest failure mode in the design, and it is invisible
    to every other check here because the member does exist.
    """
    open_vocab = {
        "cubes": [
            MODEL["cubes"][0],
            {**MODEL["cubes"][1], "dimensions": [{"name": "facts.subject"}]},
        ]
    }
    _with_meta(monkeypatch, open_vocab)
    assert check(domain_root, "http://cube") == EXIT_CHECK_FAILED
    assert "closed_vocabulary" in capsys.readouterr().err


def test_an_unreachable_cube_is_reported_as_such_not_as_a_broken_manifest(
    monkeypatch, domain_root, capsys
) -> None:
    """A dead semantic layer and a wrong manifest must not produce the same message. One is
    `docker compose up`; the other is an afternoon."""
    from quorum.cube import client

    def boom(url, timeout=20.0):
        raise client.CubeUnavailable("connection refused")

    monkeypatch.setattr(client, "meta", boom)
    assert check(domain_root, "http://cube") == EXIT_CHECK_FAILED
    err = capsys.readouterr().err
    assert "UNREACHABLE" in err
    assert "offline half of this check passed" in err


def test_an_invalid_manifest_fails_before_cube_is_contacted(tmp_path, monkeypatch) -> None:
    """Ordering: a manifest that contradicts itself should not require a running stack to say
    so, and `quorum check` on a laptop with nothing up must still be useful."""
    (tmp_path / "quorum.yaml").write_text("name: x\ncorpus: x\nsubject_axis: bare_name\n")

    from quorum.cube import client

    monkeypatch.setattr(
        client, "meta", lambda *a, **k: pytest.fail("cube was contacted before validation")
    )
    with pytest.raises(SystemExit):
        check(tmp_path, "http://cube")
