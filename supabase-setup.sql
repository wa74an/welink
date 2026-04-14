-- ============================================================
-- We Link — Student Onboarding System: Supabase Setup
-- Run this entire script in your Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query → Paste → Run)
-- ============================================================

-- 1. STUDENT PROFILES
-- Extends auth.users with onboarding data
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

-- Students can read/update their own profile
CREATE POLICY "student_read_own" ON public.student_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "student_insert_own" ON public.student_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "student_update_own" ON public.student_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Anon key can read all profiles (for admin dashboard)
CREATE POLICY "anon_read_all" ON public.student_profiles
  FOR SELECT USING (true);


-- 2. STUDENT DOCUMENTS
-- Metadata for uploaded files (actual files stored in Storage)
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

CREATE POLICY "student_manage_own_docs" ON public.student_documents
  FOR ALL USING (auth.uid() = student_id);

-- Anon key can read all documents metadata (for admin dashboard)
CREATE POLICY "anon_read_all_docs" ON public.student_documents
  FOR SELECT USING (true);


-- 3. TERMS & CONDITIONS
-- Admin-managed T&C versions
CREATE TABLE IF NOT EXISTS public.terms_conditions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     TEXT NOT NULL,                    -- e.g. "v1.0", "v1.1"
  title       TEXT NOT NULL DEFAULT 'Terms & Conditions',
  content     TEXT NOT NULL,                    -- HTML or plain text
  is_active   BOOLEAN DEFAULT FALSE,
  created_by  TEXT DEFAULT 'admin',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.terms_conditions ENABLE ROW LEVEL SECURITY;

-- Everyone can read active terms (needed for onboarding)
CREATE POLICY "anyone_read_terms" ON public.terms_conditions
  FOR SELECT USING (true);

-- Anon key can manage terms (for admin dashboard)
CREATE POLICY "anon_manage_terms" ON public.terms_conditions
  FOR ALL USING (true);


-- 4. AUDIT LOGS
-- Tracks important events for GDPR compliance
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID,
  event_type  TEXT NOT NULL,   -- 'signup','doc_upload','onboarding_complete','terms_accepted','doc_accessed'
  details     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert their own logs
CREATE POLICY "auth_insert_audit" ON public.audit_logs
  FOR INSERT WITH CHECK (auth.uid() = student_id OR student_id IS NULL);

-- Anon key can read all logs (for admin dashboard)
CREATE POLICY "anon_read_audit" ON public.audit_logs
  FOR SELECT USING (true);

-- Anon key can insert audit logs (for admin actions)
CREATE POLICY "anon_insert_audit" ON public.audit_logs
  FOR INSERT WITH CHECK (true);


-- 5. SEED INITIAL TERMS & CONDITIONS
INSERT INTO public.terms_conditions (version, title, content, is_active)
VALUES (
  'v1.0',
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
);


-- 6. STORAGE BUCKET SETUP
-- Run this in Supabase Dashboard → Storage → New Bucket
-- Name: student-documents
-- Public: FALSE (private bucket)
-- Then add the following policies:

-- NOTE: Storage policies are set via the Supabase Dashboard UI or via the storage schema.
-- Bucket: student-documents (PRIVATE)
--
-- Policy 1 — Students upload to their own folder:
--   Operation: INSERT
--   Target roles: authenticated
--   Policy: (storage.foldername(name))[1] = auth.uid()::text
--
-- Policy 2 — Students read their own files:
--   Operation: SELECT
--   Target roles: authenticated
--   Policy: (storage.foldername(name))[1] = auth.uid()::text
--
-- Policy 3 — Anon key (admin) can read all files:
--   Operation: SELECT
--   Target roles: anon
--   Policy: true
--
-- Policy 4 — Anon key (admin) can delete files:
--   Operation: DELETE
--   Target roles: anon
--   Policy: true

-- ============================================================
-- IMPORTANT: After running this SQL, also do the following:
--
-- 1. Go to Supabase Dashboard → Authentication → URL Configuration
--    Set "Site URL" to your deployed domain (e.g. https://welink.netlify.app)
--    Add to "Redirect URLs": https://yourdomain.com/register.html
--
-- 2. Go to Storage → Create new bucket named "student-documents"
--    Set it to PRIVATE (not public)
--    Then apply the storage policies described above.
--
-- 3. Go to Authentication → Email Templates
--    Customize the confirmation email to match We Link branding.
-- ============================================================
