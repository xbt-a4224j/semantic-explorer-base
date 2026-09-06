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

SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "semantic_explorer_base"

#: Words from the two domains this platform was extracted from. A third domain adds its own.
#: Deliberately includes the medical set as well as the legal one — the point is not "no legal
#: words", it is that the platform knows about NO corpus in particular.
DOMAIN_WORDS = (
    # legal
    "deal_point",
    "dealpoint",
    "maud",
    "edgar",
    "sic_",
    "folio",
    "fiduciary",
    "no-shop",
    "merger",
    "acquirer",
    "covenant",
    # The professional's own name. Missing from this list until a leak got through: the
    # free-form selection prompt read "You translate a legal analyst's question", a string
    # literal inside a platform module that no import check could see. The gap was not the
    # mechanism, it was the vocabulary — so the words for WHO is asking belong here too.
    "legal",
    "lawyer",
    "attorney",
    "law firm",
    # The reference application's own name. It has a legacy DSN variable the platform must not
    # inherit — adopting another project's env-var name is adopting a debt that is not yours.
    "clause_explorer",
    "clause-explorer",
    # medical
    "snomed",
    "synthea",
    "patient",
    "icd",
    "comorbid",
    "claimant",
    "physician",
    "diagnosis",
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
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
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
    bad = re.findall(
        r"^\s*(?:from|import)\s+(explorer|clause|claims)\b", path.read_text(), re.MULTILINE
    )
    assert not bad, f"{path.relative_to(SRC)} imports from a domain package: {set(bad)}"


def test_the_schema_files_are_packaged() -> None:
    """A wheel without the .sql files installs a migrate() that raises FileNotFoundError at
    container start — and passes every test run from a source checkout, where the files are
    simply there. Packaging omissions are invisible exactly where testing usually happens."""
    import tomllib

    pyproject = tomllib.loads((SRC.parents[1] / "pyproject.toml").read_text())
    package_data = pyproject["tool"]["setuptools"]["package-data"]["semantic_explorer_base"]
    assert "db/*.sql" in package_data

    for name in ("spine.sql", "rename_legacy.sql"):
        assert (SRC / "db" / name).exists(), f"{name} is referenced by migrate() and missing"


def test_the_spine_adds_its_columns_to_an_existing_table() -> None:
    """`CREATE TABLE IF NOT EXISTS` is a no-op on a table the rename just produced, so every
    spine column has to be added explicitly too. Without this the spine applies to fresh
    databases only — and the one database that matters is never fresh."""
    spine = (SRC / "db" / "spine.sql").read_text()
    for column in ("attributes", "source_title", "category_code", "corpus"):
        assert f"ADD COLUMN IF NOT EXISTS {column}" in spine.replace("  ", " ").replace(
            "   ", " "
        ) or f"ADD COLUMN IF NOT EXISTS {column}" in " ".join(spine.split()), (
            f"records.{column} would be missing on a migrated database"
        )
