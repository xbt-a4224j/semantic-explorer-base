"""structlog, configured once, JSON lines.

Here rather than imported from an application because the platform logs — the gate logs a
refusal, resolution logs what it resolved — and a library that reaches into its caller's settings
to find a logger is the kind of coupling this extraction exists to remove.
"""

from __future__ import annotations

from typing import Any

import structlog


def get_logger() -> Any:
    return structlog.get_logger("semantic_explorer_base")
