"""One OpenAI client, built the same way everywhere.

Three call sites each constructed `OpenAI(api_key=...)` with the SDK's default of two retries.
That is fine for one question and not fine for a benchmark: 27 questions at ~4,600 prompt
tokens is over the 200k tokens-per-minute limit, and the run died partway through with a 429.

A rate limit mid-run is a measurement problem rather than a result — it truncates whichever
strategy happened to be running and makes it look worse than it is. The eval harness already
knew this and built its own resilient client, but the SHIPPED strategy calls the product's code
and so did not get it. The retries belong here, where every caller inherits them.
"""

from __future__ import annotations

from typing import Any

#: Enough to ride out a per-minute token limit, which clears in under a minute.
MAX_RETRIES = 8
TIMEOUT_SECONDS = 60.0


def client(api_key: str | None) -> Any:
    from openai import OpenAI

    return OpenAI(api_key=api_key, max_retries=MAX_RETRIES, timeout=TIMEOUT_SECONDS)
