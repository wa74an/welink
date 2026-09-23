// Vercel Function — admin-side tenant Civil ID upload (image or PDF scan).
//
// No precedent in this codebase: students upload directly to Supabase
// Storage using their own Supabase Auth session (onboarding.html), but
// there is no admin Supabase Auth session to do the same. This function
// writes to the private `guarantor-civil-ids` bucket using the service-role
// key, gated by the same x-admin-secret check as the rest of the admin
// surface — same pattern as admin-api.js's sbHeaders().
//
// Tenant-only: the guarantor Civil ID upload/OCR step was removed — the
// guarantor's identity is confirmed manually, not photographed.
//
// Files here are temporary: cleanup-civil-ids.js deletes them 7 days after
// the contract that used them is generated.

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hegstrjpfompikkwxmpl.supabase.co';
const adminSecret = () => process.env.ADMIN_SECRET;
const serviceKey = () => process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function response(res, statusCode, body) {
  res.status(statusCode).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', 'no-store').send(JSON.stringify(body));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return response(res, 405, { error: 'Method not allowed' });

  const secret = req.headers['x-admin-secret'];
  if (!adminSecret() || secret !== adminSecret()) return response(res, 401, { error: 'Unauthorized' });

  const body = req.body || {};
  const { image, kind, mimeType } = body;

  if (kind !== 'tenant') return response(res, 400, { error: 'Invalid kind' });
  if (!ALLOWED_EXT[mimeType]) return response(res, 400, { error: 'Invalid mimeType' });
  if (typeof image !== 'string' || !image) return response(res, 400, { error: 'Missing image' });

  let buffer;
  try {
    buffer = Buffer.from(image, 'base64');
  } catch {
    return response(res, 400, { error: 'Invalid base64 image' });
  }
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    return response(res, 400, { error: 'Image too large or empty' });
  }

  const ext = ALLOWED_EXT[mimeType];
  const path = `${crypto.randomUUID()}/${kind}/${Date.now()}.${ext}`;

  try {
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/guarantor-civil-ids/${path}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey(),
        Authorization: `Bearer ${serviceKey()}`,
        'Content-Type': mimeType
      },
      body: buffer
    });
    if (!uploadRes.ok) {
      console.error('admin-upload: storage write failed, status', uploadRes.status);
      return response(res, 502, { error: 'Upload failed' });
    }
    // Never log the path's Civil ID content-adjacent context beyond this
    // structural path (no filenames chosen by the admin, no image data).
    return response(res, 200, { path, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error('admin-upload error:', err.message);
    return response(res, 502, { error: 'Upload failed' });
  }
};
