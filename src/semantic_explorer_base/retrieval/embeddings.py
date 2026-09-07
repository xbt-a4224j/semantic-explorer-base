"""Content-addressed embedding cache — the reason retrieval works with no API key.

Extracted from the reference domain unchanged apart from its cache path and its logger import:
it carried zero references to that corpus, which is the same finding `shape.py` produced. What
looked like a legal-search component was a component that had been written next to one.

The app must boot and serve retrieval, facets, the rollup and every table view with
`OPENAI_API_KEY` unset (CLAUDE.md). Embeddings are the one part of retrieval that would
otherwise need a paid API on every request, so they are cached by **content hash** and the
cache file is committed. A clone with no key gets identical results to one with a key, because
they read the same vectors.

Three cases, each with a defined behaviour — the middle one is where most implementations go
wrong by silently calling out:

* **hit** — vector returned, no API call, no key required.
* **miss with a key** — embedded once and kept in memory. It does **not** rewrite the
  committed file: warming is an explicit command (`python -m explorer.retrieval.warm_cache`),
  so a run with a key can never quietly change a file under version control.
* **miss without a key** — `EmbeddingUnavailable`, carrying the cached-item count and the
  command that fixes it. Never a silent API call, never a bare 500.

Keys are `sha256`, not Python's `hash()`, which is salted per process — a cache keyed on it
would miss everything after a restart and look like a cold-start performance problem.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

from semantic_explorer_base.logging import get_logger

#: Where a domain keeps its committed vectors. Relative to the domain repo's root rather than to
#: this file: the platform is installed as a wheel, so `parents[N]` from here points inside
#: site-packages. A domain passes its own path or accepts this default from its own cwd.
DEFAULT_CACHE_FILE = Path("data/embeddings/vectors.npz")

# text-embedding-3-small, shortened to 256 dimensions via the API's `dimensions` parameter and
# stored float16. Full 1536-dim float32 vectors for this corpus would be a ~86 MB file in a
# public repo; measured, this is 9.5 MB. What the shortening costs in retrieval quality is not
# measured — the ablation that would have measured it was removed in #53.
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMENSIONS = 256
EMBED_DTYPE = np.float16
BATCH_SIZE = 128


class EmbeddingUnavailable(RuntimeError):
    """A vector was needed, was not cached, and there is no key to compute it with."""


def content_key(text: str) -> str:
    """Stable across processes and machines, unlike `hash()`."""
    normalized = " ".join(text.split())
    return "sha256_" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class EmbeddingCache:
    def __init__(self, path: Path | None = None, api_key: str | None = None) -> None:
        self.path = path or DEFAULT_CACHE_FILE
        self.api_key = api_key
        self.api_calls = 0
        self._vectors: dict[str, np.ndarray] = _load(self.path)
        self._memory: dict[str, np.ndarray] = {}

    @property
    def entry_count(self) -> int:
        return len(self._vectors) + len(self._memory)

    def embed(self, text: str) -> np.ndarray:
        return self.embed_many([text])[0]

    def embed_many(self, texts: list[str]) -> list[np.ndarray]:
        keys = [content_key(t) for t in texts]
        missing = [
            (key, text)
            for key, text in zip(keys, texts, strict=True)
            if key not in self._vectors and key not in self._memory
        ]

        if missing and not self.api_key:
            raise EmbeddingUnavailable(
                f"{len(missing)} text(s) are not in the embedding cache "
                f"({len(self._vectors)} cached at {self.path.name}) and OPENAI_API_KEY is not "
                "set. Run `python -m explorer.retrieval.warm_cache` with a key to add them, or "
                "query with text that is already cached."
            )

        if missing:
            fresh = self._embed_uncached([text for _, text in missing])
            for (key, _), vector in zip(missing, fresh, strict=True):
                self._memory[key] = vector

        # every key is now in one map or the other, so this cannot KeyError
        return [self._vectors[key] if key in self._vectors else self._memory[key] for key in keys]

    def _embed_uncached(self, texts: list[str]) -> list[np.ndarray]:
        """The only place that calls out. Stubbed in tests, so no test needs a key."""
        from openai import OpenAI

        client = OpenAI(api_key=self.api_key)
        vectors: list[np.ndarray] = []
        for start in range(0, len(texts), BATCH_SIZE):
            batch = texts[start : start + BATCH_SIZE]
            response = client.embeddings.create(
                model=EMBED_MODEL, input=batch, dimensions=EMBED_DIMENSIONS
            )
            self.api_calls += 1
            vectors.extend(np.asarray(item.embedding, dtype=EMBED_DTYPE) for item in response.data)
            get_logger().info(
                "embeddings_created",
                model=EMBED_MODEL,
                dimensions=EMBED_DIMENSIONS,
                texts=len(batch),
                tokens=response.usage.total_tokens,
            )
        return vectors

    def save(self, vectors: dict[str, np.ndarray] | None = None) -> int:
        """Write the cache to disk. Called only by warm_cache, never by a query path."""
        merged = {**self._vectors, **self._memory, **(vectors or {})}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(self.path, **merged)
        self._vectors, self._memory = merged, {}
        return len(merged)


def _load(path: Path) -> dict[str, np.ndarray]:
    if not path.exists():
        return {}
    with np.load(path) as archive:
        return {key: archive[key] for key in archive.files}


_default: EmbeddingCache | None = None


def default_cache(api_key: str | None = None, path: Path | None = None) -> EmbeddingCache:
    """Process-wide cache. Loading the npz per request would dominate query latency.

    The key is passed in rather than read from a settings module: the platform holds no
    environment, by the same rule that keeps connection strings out of `Domain`.
    """
    global _default
    if _default is None:
        _default = EmbeddingCache(path=path, api_key=api_key)
    return _default
