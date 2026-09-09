"""Hybrid retrieval — BM25 over a record's searchable text, blended with vector similarity.

The package was created empty by the extraction and stayed that way, so the second domain had
nothing to reuse and would have had to clone 248 lines to get search. Filled from the reference
domain, where the coupling turned out to be one hardcoded SQL string: what a record's searchable
text IS belongs to the domain; how two score distributions are normalized and blended does not.
"""

from semantic_explorer_base.retrieval.embeddings import (
    EmbeddingCache,
    EmbeddingUnavailable,
    content_key,
    default_cache,
)
from semantic_explorer_base.retrieval.hybrid import (
    DEFAULT_ALPHA,
    HybridIndex,
    Scored,
    normalize,
    tokenize,
)
from semantic_explorer_base.retrieval.ranking import (
    matched_nothing,
    ranked_by,
    unmatched_label,
)

__all__ = [
    "DEFAULT_ALPHA",
    "EmbeddingCache",
    "EmbeddingUnavailable",
    "HybridIndex",
    "Scored",
    "content_key",
    "default_cache",
    "matched_nothing",
    "normalize",
    "ranked_by",
    "tokenize",
    "unmatched_label",
]
