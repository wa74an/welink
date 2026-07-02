-- ============================================================
-- We Link — Student Onboarding System: Supabase Setup (HARDENED)
-- Run this entire script in your Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query → Paste → Run)
--
-- SECURITY MODEL
--   • The ANON key is PUBLIC (it ships in every page's JavaScript).
--     It must therefore have ZERO access to personal data.
--   • Students read/write ONLY their own rows, using their own
--     logged-in session (auth.uid() = their id).
--   • The admin dashboard performs ALL privileged reads/writes through
--     the Netlify function `admin-api`, which uses the SERVICE ROLE key
--     (server-side only). The service role BYPASSES RLS, so no
--     "anon can do everything" policy is ever needed.
-- ============================================================


-- 1. STUDENT PROFILES ----------------------------------------
CREATE TABLE IF NOT EXISTS public.student_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT,
  parent_phone  TEXT,
  onboarding_step      INTEGER DEFAULT 0,         -- 0=not started, 1=info done, 2=docs done, 3=complete
  onboarding_completed BOOLEAN DEFAULT FALSE,
  terms_accepted_at    TIMESTAMPTZ,
  terms_version_id     UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;

-- Remove the old wide-open policy (public PII leak)
DROP POLICY IF EXISTS "anon_read_all" ON public.student_profiles;

-- Students may read / create / update ONLY their own profile
DROP POLICY IF EXISTS "student_read_own"   ON public.student_profiles;
DROP POLICY IF EXISTS "student_insert_own" ON public.student_profiles;
DROP POLICY IF EXISTS "student_update_own" ON public.student_profiles;

CREATE POLICY "student_read_own" ON public.student_profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "student_insert_own" ON public.student_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "student_update_own" ON public.student_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- (Admin reads all profiles via admin-api / service role — no anon policy.)


-- 2. STUDENT DOCUMENTS ---------------------------------------
CREATE TABLE IF NOT EXISTS public.student_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('passport','student_civil_id','parent_civil_id','scholarship_letter')),
  file_path   TEXT NOT NULL,   -- storage path: {student_id}/{doc_type}/{filename}
  file_name   TEXT NOT NULL,
  file_size   INTEGER,
  mime_type   TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY;

-- Remove the old wide-open policy (public document-metadata leak)
DROP POLICY IF EXISTS "anon_read_all_docs" ON public.student_documents;

DROP POLICY IF EXISTS "student_manage_own_docs" ON public.student_documents;
CREATE POLICY "student_manage_own_docs" ON public.student_documents
  FOR ALL TO authenticated
  USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);
-- (Admin reads all document metadata via admin-api / service role.)


-- 3. TERMS & CONDITIONS --------------------------------------
CREATE TABLE IF NOT EXISTS public.terms_conditions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT 'Terms & Conditions',
  content     TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT FALSE,
  created_by  TEXT DEFAULT 'admin',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.terms_conditions ENABLE ROW LEVEL SECURITY;

-- Remove the old policy that let ANYONE write/delete legal terms
DROP POLICY IF EXISTS "anon_manage_terms" ON public.terms_conditions;

-- Anyone may READ terms (needed to display them during onboarding)
DROP POLICY IF EXISTS "anyone_read_terms" ON public.terms_conditions;
CREATE POLICY "anyone_read_terms" ON public.terms_conditions
  FOR SELECT USING (true);
-- (Admin creates/edits/activates terms via admin-api / service role — no anon write.)


-- 4. AUDIT LOGS ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID,
  event_type  TEXT NOT NULL,
  details     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Remove old policies that exposed all logs (incl. IPs) and allowed anon inserts
DROP POLICY IF EXISTS "anon_read_audit"   ON public.audit_logs;
DROP POLICY IF EXISTS "anon_insert_audit" ON public.audit_logs;

-- Logged-in students may insert their own events only
DROP POLICY IF EXISTS "auth_insert_audit" ON public.audit_logs;
CREATE POLICY "auth_insert_audit" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id OR student_id IS NULL);
-- (Admin reads/writes audit logs via admin-api / service role.)


-- 5. PROPERTIES / CLIENTS / APPLICATIONS ---------------------
-- These tables back the admin dashboard (and the public property list).
-- They were previously readable AND writable with the public anon key.
-- Lock them down: the public site may READ properties only; everything
-- else goes through admin-api (service role).
--
-- Each block is guarded and catches its own errors, so a missing table or
-- policy quirk here can NEVER roll back the student-data lockdown above.

-- 5a. PROPERTIES — public may read; only the server may write.
DO $$
BEGIN
  IF to_regclass('public.properties') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "public_read_properties" ON public.properties';
    EXECUTE 'CREATE POLICY "public_read_properties" ON public.properties FOR SELECT USING (true)';
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'properties lockdown skipped: %', SQLERRM;
END $$;

-- 5b. CLIENTS — private (names, emails, phones, budgets). No anon access at all.
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY';
    -- Remove any leftover permissive policies created via the Table Editor.
    EXECUTE (SELECT COALESCE(string_agg(format('DROP POLICY %I ON public.clients;', policyname), ' '), '')
             FROM pg_policies WHERE schemaname='public' AND tablename='clients');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'clients lockdown skipped: %', SQLERRM;
END $$;

-- 5c. APPLICATIONS — private. No anon access at all.
DO $$
BEGIN
  IF to_regclass('public.applications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY';
    EXECUTE (SELECT COALESCE(string_agg(format('DROP POLICY %I ON public.applications;', policyname), ' '), '')
             FROM pg_policies WHERE schemaname='public' AND tablename='applications');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'applications lockdown skipped: %', SQLERRM;
END $$;
-- (Both tables now have NO policies → anon fully denied; admin-api service role bypasses RLS.)


-- 6. SEED INITIAL TERMS & CONDITIONS (only if none exist) ----
INSERT INTO public.terms_conditions (version, title, content, is_active)
SELECT 'v1.0',
  'We Link Student Services — Terms & Conditions',
  '<h3>1. Introduction</h3>
<p>These Terms and Conditions govern your use of We Link''s student services platform and the submission of your personal documents. By completing this onboarding process, you agree to these terms in full.</p>

<h3>2. Data Collection & Purpose</h3>
<p>We collect the following personal information for the purpose of facilitating UK rental guarantor services and apartment matching:</p>
<ul>
  <li>Full legal name</li>
  <li>Passport copy</li>
  <li>Civil ID (student and parent)</li>
  <li>Parent contact information</li>
  <li>Scholarship documentation (where applicable)</li>
</ul>

<h3>3. Data Storage & Security</h3>
<p>All documents are stored using industry-standard encrypted cloud storage. Access is strictly limited to authorised We Link staff. We do not share your information with third parties without your explicit consent, except where required by UK law.</p>

<h3>4. Data Retention</h3>
<p>Your data will be retained for the duration of your tenancy arrangement plus 12 months thereafter, after which it will be securely deleted upon your written request.</p>

<h3>5. Your Rights (GDPR)</h3>
<p>Under the UK General Data Protection Regulation, you have the right to:</p>
<ul>
  <li>Access your personal data</li>
  <li>Correct inaccurate data</li>
  <li>Request deletion of your data</li>
  <li>Withdraw consent at any time</li>
</ul>

<h3>6. Document Accuracy</h3>
<p>By submitting this form, you confirm that all documents and information provided are genuine, accurate, and belong to you or your parent/guardian. Submission of fraudulent documents may result in immediate termination of services and potential legal action.</p>

<h3>7. Communications</h3>
<p>We Link may contact you via email or the phone numbers provided regarding your application, property matches, and service updates.</p>

<h3>8. Contact</h3>
<p>For any data protection enquiries, contact us at: <strong>admin@welink.co.uk</strong></p>',
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.terms_conditions);


-- 7. STORAGE — student-documents bucket (PRIVATE) ------------
-- Bucket must exist and be PRIVATE (Storage → New bucket → "student-documents", Public = OFF).
-- These policies live on storage.objects. Run as-is.

-- Wrapped in a guarded block so a storage permission quirk can't roll back the
-- rest of the script. Also auto-drops any anon policy that references the
-- private student-documents bucket (the old "anon read/delete all" holes).
DO $$
DECLARE r RECORD;
BEGIN
  -- Drop leftover anon policies that touch the student-documents bucket
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND (roles::text[] && ARRAY['anon','public'])
      AND (COALESCE(qual,'') LIKE '%student-documents%' OR COALESCE(with_check,'') LIKE '%student-documents%')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects;', r.policyname);
  END LOOP;

  DROP POLICY IF EXISTS "students_upload_own_folder" ON storage.objects;
  DROP POLICY IF EXISTS "students_read_own_folder"   ON storage.objects;

  -- Students may upload into a folder named after their own user id
  CREATE POLICY "students_upload_own_folder" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'student-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

  -- Students may read their own files only
  CREATE POLICY "students_read_own_folder" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'student-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'storage policy step skipped: %', SQLERRM;
END $$;

-- The admin dashboard downloads documents via admin-api → storage `sign`
-- endpoint (service role), so NO anon read/delete policy is created here.
-- If any global "anon true" policy (not bucket-scoped) still exists, list with:
--   SELECT policyname, roles, cmd, qual FROM pg_policies
--   WHERE schemaname='storage' AND tablename='objects';


-- ============================================================
-- AFTER RUNNING THIS SQL — required configuration
--
-- A. Netlify environment variables (Site → Settings → Environment):
--    SUPABASE_SERVICE_KEY = <your Supabase service_role key>   (server-only)
--    ADMIN_SECRET         = <a NEW long random string>         (admin login key)
--    RESEND_KEY           = <your Resend API key>
--    RESEND_WEBHOOK_SECRET= <the signing secret from the Resend inbound webhook>
--    → Rotate ADMIN_SECRET now: the old value ('wl-adm-...') is in git history.
--    → Re-deploy after changing env vars.
--
-- B. The public ANON key is safe to remain in the client ONLY because the
--    policies above deny it access to personal data. You do NOT need to
--    rotate the anon key — but you MAY, from Supabase → Settings → API.
--
-- C. Supabase → Authentication → URL Configuration:
--    Site URL: https://welink-uk.com
--    Redirect URLs: https://welink-uk.com/register.html
-- ============================================================
