"""The frontend half of the platform, checked from Python.

There is no vitest here on purpose. Standing up a second test toolchain to run three assertions
costs a node_modules, a config and a CI step; reading the files is enough for what actually
needs guarding, and the domain repos keep their own JS suites for behaviour.

What needs guarding is the same two properties as the Python side: no colour outside the token
file, and no corpus vocabulary in a shared component.
"""

from __future__ import annotations

import pathlib
import re

import pytest

UI = pathlib.Path(__file__).resolve().parents[1] / "frontend" / "src"
SOURCES = sorted(p for p in UI.rglob("*.ts*") if not p.name.endswith(".test.tsx"))

#: Same list as the Python boundary test, for the same reason.
DOMAIN_WORDS = (
    "deal point",
    "deal_point",
    "matter",
    "merger",
    "fiduciary",
    "clause-explorer",
    "claim finding",
    "synthea",
    "patient",
)


def strip_comments(source: str) -> str:
    """Block and line comments removed.

    The distinction the Python boundary test makes, for the same reason: a component may
    DOCUMENT that it was extracted from a merger-agreement app — that provenance is the most
    useful comment in the file — but may not name one in the code it runs.
    """
    return re.sub(r"//.*$", "", re.sub(r"/\*[\s\S]*?\*/", "", source), flags=re.MULTILINE)


def test_there_are_components_to_check() -> None:
    """Guards against the whole file passing vacuously, which is how a grep-style test dies."""
    assert len(SOURCES) >= 5, [p.name for p in SOURCES]


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_no_hardcoded_colour(path: pathlib.Path) -> None:
    """Colour lives in tokens.css. A hex in a component is a colour nobody can retheme, and
    more importantly one that no longer means what the token meant."""
    found = re.findall(r"#[0-9a-fA-F]{3,8}\b", strip_comments(path.read_text()))
    assert not found, f"{path.name} hardcodes {found}"


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_no_domain_vocabulary(path: pathlib.Path) -> None:
    """A shared component naming one corpus is a fork waiting to happen. The tell in the first
    fork was a tab labelled "Deal Terms" in a health-claims application."""
    code = strip_comments(path.read_text()).lower()
    named = [word for word in DOMAIN_WORDS if word in code]
    assert not named, f"{path.name} names {named}"


class TestTheTokensAreTheOnePalette:
    """`git diff -- frontend/src/styles/` between the reference app and its first fork was
    EMPTY. Colour themes are not domain-specific, which killed the per-domain theme idea before
    it was built — so there is one palette here and domains do not get to fork it."""

    tokens = (UI / "styles" / "tokens.css").read_text()

    def test_the_palette_exists_and_is_substantial(self) -> None:
        assert len(re.findall(r"#[0-9a-fA-F]{3,8}\b", self.tokens)) > 20

    def test_the_mechanism_colours_travel_with_the_components(self) -> None:
        """These encode WHICH MECHANISM produced a figure — the semantic layer, literal term
        matching, or embeddings. That is platform semantics rather than decoration: a domain
        re-picking them would be re-deciding what a reader is being told."""
        for token in ("--mech-governed", "--mech-exact", "--mech-meaning"):
            assert token in self.tokens
