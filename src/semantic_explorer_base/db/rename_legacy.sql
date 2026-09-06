-- Carry a pre-platform database onto the spine, in place, without losing a row.
--
-- Runs BEFORE spine.sql. Every step is conditional on the old name still existing, so this is
-- idempotent and a fresh database skips all of it.
--
-- `ALTER TABLE ... RENAME` is metadata-only in Postgres: no rewrite, no downtime, and indexes,
-- constraints and foreign keys follow the table. What does NOT follow is anything that names
-- the old identifier in text — trigger names, and the `sql_table` lines in the Cube model.
-- spine.sql recreates the triggers by name afterwards, and the model is the domain's business.
--
-- The reference database this was written against holds 152 records and 12,937 facts, so it is
-- worth saying plainly: this is the one file here that can lose data if it is wrong. It renames
-- rather than copies for exactly that reason — there is no window in which two copies disagree.

DO $$
BEGIN
    IF to_regclass('public.industries') IS NOT NULL
       AND to_regclass('public.categories') IS NULL THEN
        ALTER TABLE industries RENAME TO categories;
    END IF;

    IF to_regclass('public.matters') IS NOT NULL AND to_regclass('public.records') IS NULL THEN
        ALTER TABLE matters RENAME TO records;
    END IF;

    IF to_regclass('public.deal_points') IS NOT NULL AND to_regclass('public.facts') IS NULL THEN
        ALTER TABLE deal_points RENAME TO facts;
    END IF;
END $$;

-- Columns. Same reasoning, one level down: `matter_id` and `deal_point_name` are the two names
-- that would otherwise ship the reference corpus's vocabulary into every domain's schema.
DO $$
BEGIN
    IF to_regclass('public.records') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'records' AND column_name = 'source_contract_title'
        ) THEN
            ALTER TABLE records RENAME COLUMN source_contract_title TO source_title;
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'records' AND column_name = 'industry_code'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'records' AND column_name = 'category_code'
        ) THEN
            ALTER TABLE records RENAME COLUMN industry_code TO category_code;
        END IF;
    END IF;

    IF to_regclass('public.facts') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'facts' AND column_name = 'matter_id'
        ) THEN
            ALTER TABLE facts RENAME COLUMN matter_id TO record_id;
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'facts' AND column_name = 'deal_point_name'
        ) THEN
            ALTER TABLE facts RENAME COLUMN deal_point_name TO subject;
        END IF;
    END IF;
END $$;

-- Old index and constraint names survive a table rename and are then misleading. Dropping the
-- indexes is safe — spine.sql recreates every one under its new name — but a CONSTRAINT is not
-- recreated there, so those are renamed rather than dropped.
DROP INDEX IF EXISTS idx_industries_label_lower;
DROP INDEX IF EXISTS idx_matters_facets;
DROP INDEX IF EXISTS idx_matters_corpus;
DROP INDEX IF EXISTS idx_dp_name;
DROP INDEX IF EXISTS idx_dp_matter;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_points_span_kind_ck') THEN
        ALTER TABLE facts RENAME CONSTRAINT deal_points_span_kind_ck TO facts_span_kind_ck;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matters_industry_code_fkey') THEN
        ALTER TABLE records
            RENAME CONSTRAINT matters_industry_code_fkey TO records_category_code_fkey;
    END IF;
END $$;
