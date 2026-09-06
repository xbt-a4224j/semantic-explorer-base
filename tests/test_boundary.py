"""No domain vocabulary in the platform. The extraction is only real if it is enforced.

A boundary nobody checks decays: the first time someone needs "just one" deal-point reference to
ship a fix, they take it, and six months later the platform is a fork again. This is greppable,
fails the build, and takes a second to run.

Same shape as the test in the reference implementation that greps the frontend to make sure no
deal-size band is hardcoded outside the Cube model. Both exist because documentation of a rule is
worth nothing next to a gate that fails.
"""

from __future__ import annotations

import ast
import pathlib
import re

import pytest

SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "quorum"

#: Words from the two domains this platform was extracted from. A third domain adds its own.
#: Deliberately includes the medical set as well as the legal one — the point is not "no legal
#: words", it is that the platform knows about NO corpus in particular.
DOMAIN_WORDS = (
    # legal
    "deal_point", "dealpoint", "maud", "edgar", "sic_", "folio", "fiduciary", "no-shop",
    "merger", "acquirer", "covenant",
    # medical
    "snomed", "synthea", "patient", "icd", "comorbid", "claimant",
)

#: `matter`, `claim`, `industry` and `contract` are excluded on purpose. They are ordinary
#: English that appears in prose — "no matter", "the claim this makes", "industry-standard" —
#: and banning them produces a test everyone learns to silence. The words above are unambiguous:
#: none of them has an innocent reading inside a platform module.


def code_only(source: str) -> str:
    """The module with docstrings and comments stripped.

    The test judges BEHAVIOUR, not prose. A platform module may say "measured on the merger
    corpus this was extracted from" — that is provenance, and provenance is the most valuable
    part of these comments. What it may not do is have an identifier, a string literal or an
    import that only makes sense for one corpus, because that is what actually binds the code to
    a domain.

    Drawing the line at prose would also make the test the kind nobody trusts: the first time it
    fires on a comment, someone reads it as noise and learns to silence it.
    """
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                if isinstance(body[0].value.value, str):
                    body.pop(0)
    return ast.unparse(tree)


def _sources() -> list[pathlib.Path]:
    return sorted(p for p in SRC.rglob("*.py") if p.name != "__init__.py")


def test_there_are_sources_to_check() -> None:
    """A boundary test over an empty tree passes and means nothing."""
    assert len(_sources()) >= 3


@pytest.mark.parametrize("path", _sources(), ids=lambda p: p.name)
def test_no_domain_vocabulary(path: pathlib.Path) -> None:
    text = code_only(path.read_text()).lower()
    hits = sorted({w for w in DOMAIN_WORDS if w in text})
    assert not hits, (
        f"{path.relative_to(SRC)} names {hits}. Either it is genuinely domain code and belongs "
        f"in the domain repo, or the name leaked and should come from the Domain manifest — "
        f"which is what happened to shape.py, where 19 references turned out to be member names "
        f"rather than logic."
    )


@pytest.mark.parametrize("path", _sources(), ids=lambda p: p.name)
def test_no_imports_from_a_domain_package(path: pathlib.Path) -> None:
    """The platform must not reach into an application. If it needs something from one, that
    something is a field on `Domain`."""
    bad = re.findall(r"^\s*(?:from|import)\s+(explorer|clause|claims)\b", path.read_text(), re.M)
    assert not bad, f"{path.relative_to(SRC)} imports from a domain package: {set(bad)}"
