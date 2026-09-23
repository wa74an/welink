-- Migration: Guarantor Contracts feature
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
--
-- Follows the exact lockdown pattern already used for `clients`/`applications`
-- in supabase-setup.sql: RLS enabled, every policy dropped, and NO policies
-- created at all. The anon key gets zero access; the admin-api service role
-- (SUPABASE_SERVICE_KEY, server-side only) bypasses RLS entirely — there is
-- no per-admin-user identity in this app, so there's nothing to scope a
-- policy to.

-- 1. TABLE ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guarantor_contracts (
  id                            BIGSERIAL PRIMARY KEY,
  tenant_name                   TEXT NOT NULL,
  tenant_address                TEXT NOT NULL,
  tenant_civil_id               TEXT NOT NULL,
  tenant_phone                  TEXT NOT NULL,
  tenant_passport                TEXT,                 -- nullable, optional
  guarantor_name                TEXT NOT NULL,
  guarantor_address             TEXT NOT NULL,
  guarantor_civil_id            TEXT NOT NULL,
  guarantor_phone               TEXT NOT NULL,
  guarantor_passport            TEXT,                  -- nullable, optional
  rent_amount_gbp               NUMERIC(10,2) NOT NULL,
  rent_due_day                  SMALLINT NOT NULL CHECK (rent_due_day BETWEEN 1 AND 31),
  contract_start_date           DATE NOT NULL,
  contract_end_date             DATE NOT NULL,
  contract_weekday              TEXT NOT NULL,
  contract_date                 DATE NOT NULL,
  pdf_storage_path              TEXT NOT NULL,
  generated_by                  TEXT NOT NULL,          -- free-text admin name; no per-admin identity exists in this app
  tenant_civil_id_image_path    TEXT,                   -- cleared by the 7-day purge job
  guarantor_civil_id_image_path TEXT,                   -- cleared by the 7-day purge job
  civil_id_uploaded_at          TIMESTAMPTZ,             -- drives the purge job
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.guarantor_contracts ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies first (idempotent re-run safety), then
-- deliberately create none — same reasoning as clients/applications.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='guarantor_contracts'
  LOOP EXECUTE format('DROP POLICY %I ON public.guarantor_contracts;', r.policyname); END LOOP;
END $$;
-- (No policies created → anon/authenticated fully denied; admin-api service role bypasses RLS.)


-- 2. STORAGE BUCKETS ---------------------------------------------
-- Create both as PRIVATE buckets (Storage → New bucket → Public = OFF):
--   guarantor-contracts   — long-lived generated PDFs
--   guarantor-civil-ids   — short-lived raw Civil ID images, purged after 7 days
--
-- Neither bucket gets a storage.objects policy: admin never uploads with a
-- user JWT (there's no admin Supabase Auth session in this app), so every
-- read/write to these buckets goes through the service-role-backed Vercel
-- functions (admin-upload, ocr-civil-id, generate-contract, sign-url,
-- cleanup-civil-ids) — same reasoning as why clients/applications need zero
-- anon/authenticated storage policies.
--
-- Buckets must be created via the Supabase Dashboard or Management API —
-- there's no SQL statement for bucket creation itself. After creating them,
-- confirm no stray policy exists for either bucket:
--   SELECT policyname, roles, cmd, qual FROM pg_policies
--   WHERE schemaname='storage' AND tablename='objects'
--     AND (qual LIKE '%guarantor-contracts%' OR qual LIKE '%guarantor-civil-ids%');


-- ============================================================
-- AFTER RUNNING THIS SQL — required configuration
--
-- A. Create the two Storage buckets above (private, no policies).
--
-- B. New Vercel environment variables (Project Settings → Environment
--    Variables), in addition to the ones already migrated from Netlify:
--    ANTHROPIC_API_KEY       = <Anthropic API key, for the Civil ID OCR step>
--    CONVERT_INTERNAL_SECRET = <a new long random string, generated during
--                               the PDF-conversion function's setup — never
--                               sent from the browser, server-to-server only>
--
-- C. A daily Vercel Cron (configured in vercel.json) hits
--    /api/cleanup-civil-ids to auto-delete raw Civil ID images 7 days after
--    a contract is generated, per the confirmed data-retention decision.
-- ============================================================
