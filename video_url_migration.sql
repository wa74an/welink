-- Migration: add optional video_url column to properties table
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query)

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS video_url TEXT DEFAULT NULL;

-- Optional: add a CHECK constraint so only YouTube / Vimeo URLs are stored.
-- The client-side validation handles this, but defence-in-depth is good.
-- Uncomment if you want DB-level enforcement:
--
-- ALTER TABLE properties
--   ADD CONSTRAINT chk_video_domain
--   CHECK (
--     video_url IS NULL OR
--     video_url ~ '^https?://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/'
--   );
