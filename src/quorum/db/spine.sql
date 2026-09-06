-- The schema every domain shares. Generic on purpose, and the names are the whole point.
--
-- The first fork of this codebase kept `matters`, `deal_points` and `industries` and pointed a
-- health-claims corpus at them. A claims application whose primary table is `deal_points` is
-- the tell that a platform is a fork wearing a costume, and the names leak upward: every
-- `SELECT` in the ingest, every `sql_table` in the model, every direct-SQL test.
--
--     matters      -> records      one row per thing the corpus is about
--     deal_points  -> facts        one row per answer about a record. LONG, not wide.
--     industries   -> categories   the controlled vocabulary records are grouped by
--
-- ## Why `facts` is long
--
-- `facts(record_id, subject, position)` rather than a column per subject. With the long shape a
-- 93rd subject is just rows: no migration, no model edit, no UI change. Wide makes every new
-- subject a three-place change, and a corpus that grows its vocabulary is the normal case.
--
-- ## Two ways a domain adds its own columns
--
-- `records.attributes` is JSONB and holds whatever a domain's data carries. That is what lets a
-- new domain drop files in a folder and run one command: nothing here needs to change, and the
-- generated Cube model projects `attributes->>'signing_date'` into a typed dimension.
--
-- A domain that wants real columns — for an index, a foreign key, a numeric filter — ships a
-- `db/domain.sql` of `ALTER TABLE records ADD COLUMN IF NOT EXISTS`, applied after this file.
-- The reference domain does exactly that for its nine enrichment fields, because its facet
-- query filters on three of them together and a JSONB expression index is a worse answer than
-- a column when you already know the shape.
--
-- Neither is the "right" one. JSONB costs you typing and indexes; columns cost you a migration
-- per domain. The split is: the spine is what every corpus has, and everything else is the
-- domain's business.

-- The controlled vocabulary. `code` is opaque and stable; `label` is display text and may be
-- retitled. Everything that filters joins on `code` — a label-keyed filter returns zero rows
-- the day someone retitles "Health Care Industry" to "Healthcare", which reads as "we have no
-- comparable records" rather than as the bug it is.
CREATE TABLE IF NOT EXISTS categories (
    code        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- lowercased lookup for the exact tier of filter-value resolution
CREATE INDEX IF NOT EXISTS idx_categories_label_lower ON categories (lower(label));

CREATE TABLE IF NOT EXISTS records (
    id            TEXT PRIMARY KEY,
    -- Provenance. Every row must trace to a byte range in a downloaded file; a row whose text
    -- cannot be traced back to its source is a bug, not a curiosity.
    source_file   TEXT NOT NULL,
    source_title  TEXT NOT NULL DEFAULT '',
    -- Which corpus wrote this row. Redundant with corpus_claim by design: the claim stops two
    -- corpora sharing a database, and this makes the damage visible if one ever does.
    corpus        TEXT NOT NULL DEFAULT '',
    category_code TEXT REFERENCES categories (code) ON DELETE SET NULL,
    -- Everything this domain's data carries that the spine does not name.
    attributes    JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_records_corpus ON records (corpus);
CREATE INDEX IF NOT EXISTS idx_records_category ON records (category_code);
-- GIN so a domain that keeps its fields in `attributes` can still filter on them without
-- knowing in advance which keys it will want.
CREATE INDEX IF NOT EXISTS idx_records_attributes ON records USING gin (attributes);

CREATE TABLE IF NOT EXISTS facts (
    id                BIGSERIAL PRIMARY KEY,
    record_id         TEXT NOT NULL REFERENCES records (id) ON DELETE CASCADE,
    -- The subject axis: the dimension nearly every question names. NOT a column per subject.
    subject           TEXT NOT NULL,
    -- The answer. Free text, because a corpus's answer vocabulary is data and not schema.
    position          TEXT NOT NULL,
    -- The number inside the answer text, where there is one. Most subjects are categorical, so
    -- this is NULL far more often than not — which is why a percentile over it needs its own
    -- denominator and never the subject's row count.
    numeric_value     NUMERIC(18, 4),
    source_span_start INTEGER,
    source_span_end   INTEGER,
    -- What the span IS, not merely that it exists. 'anchored' = the characters at the span are
    -- the annotator's quoted answer text, found exactly once inside the recorded range.
    -- 'recorded' = the source's own envelope, i.e. where the answer was found, which for a
    -- holistic subject can be most of the document. NULL = no span. A reader who cannot tell
    -- these apart will read an envelope as a quotation.
    span_kind         TEXT,
    -- FALSE for gold labels, TRUE for extractor output. The distinction has to survive into the
    -- UI or inferred values get quoted as ground truth.
    is_inferred       BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (record_id, subject)
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facts_span_kind_ck') THEN
        -- NOT VALID so the constraint governs every write from here on without failing on rows
        -- loaded before it existed. A span_kind without a span, or a span without a kind, is a
        -- row nobody can interpret.
        ALTER TABLE facts ADD CONSTRAINT facts_span_kind_ck
            CHECK (
                (span_kind IS NULL AND source_span_start IS NULL)
                OR (span_kind IN ('anchored', 'recorded') AND source_span_start IS NOT NULL)
            ) NOT VALID;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts (subject);
CREATE INDEX IF NOT EXISTS idx_facts_record ON facts (record_id);

-- Human labels from the review queue; they feed re-calibration.
CREATE TABLE IF NOT EXISTS labels (
    id               BIGSERIAL PRIMARY KEY,
    target_kind      TEXT NOT NULL,
    target_id        TEXT NOT NULL,
    field            TEXT NOT NULL,
    value            TEXT NOT NULL,
    prior_prediction TEXT,
    labeller         TEXT NOT NULL DEFAULT 'local',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_labels_target ON labels (target_kind, target_id);

-- One row per confirmed selection on the Ask tab: what the model returned, what the person ran,
-- and which parts they changed. `agreed` rows are recorded too — an eval that stores only
-- corrections learns only what the model got wrong, and "it was right and nobody touched it" is
-- the other half of an accuracy figure.
--
-- Written ONLY by a human confirming or editing. The agent never writes here: a model recording
-- its own eval data would be storing an opinion it already held rather than evidence against it.
--
-- JSONB rather than a normalised selection schema. The shape is Cube's query object, already
-- versioned by the model files, and shredding it into rows would create a second definition of
-- what a selection is — the one that goes stale when the model changes.
CREATE TABLE IF NOT EXISTS selection_corrections (
    id                  BIGSERIAL PRIMARY KEY,
    question            TEXT NOT NULL,
    model_selection     JSONB NOT NULL,
    confirmed_selection JSONB NOT NULL,
    changed_fields      TEXT[] NOT NULL DEFAULT '{}',
    agreed              BOOLEAN NOT NULL,
    labeller            TEXT NOT NULL DEFAULT 'local',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_selection_corrections_agreed
    ON selection_corrections (agreed, created_at DESC);

-- One row per ingest run, so status is readable without parsing logs.
CREATE TABLE IF NOT EXISTS ingest_runs (
    id            BIGSERIAL PRIMARY KEY,
    source        TEXT NOT NULL,
    rows_read     INTEGER NOT NULL DEFAULT 0,
    rows_upserted INTEGER NOT NULL DEFAULT 0,
    duration_ms   NUMERIC(12, 1),
    sha256        TEXT,
    status        TEXT NOT NULL DEFAULT 'ok',
    detail        TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingest_source ON ingest_runs (source, started_at DESC);

-- The corpus stamp. See quorum/db/corpus.py for what it prevents.
CREATE TABLE IF NOT EXISTS corpus_claim (
    name            TEXT PRIMARY KEY,
    first_ingest_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- updated_at must advance on write or Cube's refresh_key never invalidates.
--
-- clock_timestamp(), not now(): now() returns TRANSACTION start time and is constant for the
-- whole transaction, so an insert followed by an update in one transaction would leave
-- updated_at unchanged. Ingest does exactly that, which would leave Cube serving stale
-- aggregates with no way to notice.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'categories', 'records', 'facts', 'labels', 'ingest_runs', 'selection_corrections'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$s', t);
        EXECUTE format(
            'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$s '
            'FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
    END LOOP;
END $$;
