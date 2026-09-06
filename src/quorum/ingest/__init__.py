"""Getting a corpus into the spine, without writing an ingester for it.

The point of this package is the sentence "drop the files in a folder and run one command". A
domain that needs a real parser writes one — the reference domain does, because MAUD's format is
a nested JSON of expert annotations that no generic reader could sensibly guess at. But a domain
whose data is a CSV of records and a CSV of facts should not have to write any code at all, and
before this it did.
"""

from quorum.ingest.tabular import (
    READERS,
    IngestReport,
    UnknownFormat,
    load_facts,
    load_records,
    read_rows,
)

__all__ = [
    "READERS",
    "IngestReport",
    "UnknownFormat",
    "load_facts",
    "load_records",
    "read_rows",
]
