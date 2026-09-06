"""The schema spine every domain shares, and the guard that keeps corpora apart.

`migrate()` is the only entry point. It applies, in order:

1. `rename_legacy.sql` — carries a pre-platform database onto the spine in place. No-ops on a
   fresh one.
2. `spine.sql` — the tables every corpus has.
3. the domain's own `db/domain.sql`, if it ships one — typed columns on top of `records`.

The order is the contract: a domain's ALTER TABLE cannot run before the table exists, and the
rename cannot run after a fresh spine has already created the new names beside the old ones,
which would leave two half-populated schemas and no error.
"""

from __future__ import annotations

import pathlib
from typing import Any

HERE = pathlib.Path(__file__).parent
RENAME_LEGACY = HERE / "rename_legacy.sql"
SPINE = HERE / "spine.sql"

#: What a domain repo may ship to add its own columns, relative to its root.
DOMAIN_SQL = "db/domain.sql"


def migrate(conn: Any, domain_root: pathlib.Path | str | None = None) -> list[str]:
    """Bring a database up to the spine. Returns the files applied, in order.

    Idempotent: every statement in these files is `IF NOT EXISTS` or guarded on the old name
    still being there, because migrate runs on every `quorum dev` and a migration that only
    works once is a migration nobody runs.
    """
    applied: list[str] = []
    for path in (RENAME_LEGACY, SPINE):
        conn.execute(path.read_text())
        applied.append(path.name)

    if domain_root is not None:
        domain_sql = pathlib.Path(domain_root) / DOMAIN_SQL
        if domain_sql.exists():
            conn.execute(domain_sql.read_text())
            applied.append(str(domain_sql))

    conn.commit()
    return applied
