// Netlify Serverless Function — Admin API Proxy
// Keeps SUPABASE_SERVICE_KEY out of client-side JavaScript.
// All requests must include x-admin-secret matching the ADMIN_SECRET env var.

const SUPABASE_URL = 'https://hegstrjpfompikkwxmpl.supabase.co';

const serviceKey = () => process.env.SUPABASE_SERVICE_KEY;
const adminSecret = () => process.env.ADMIN_SECRET;

const sbHeaders = () => ({
  'apikey': serviceKey(),
  'Authorization': `Bearer ${serviceKey()}`,
  'Content-Type': 'application/json'
});

function response(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  // ── Auth check ──────────────────────────────────────────────
  const secret = event.headers['x-admin-secret'];
  if (!adminSecret() || secret !== adminSecret()) {
    return response(401, { error: 'Unauthorized' });
  }

  const action = (event.queryStringParameters || {}).action;
  const method = event.httpMethod;

  try {

    // ── LIST ALL STUDENTS (profiles + emails from auth) ───────
    if (action === 'list-students' && method === 'GET') {
      const [profilesRes, authRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/student_profiles?select=*&order=created_at.desc`, { headers: sbHeaders() }),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: sbHeaders() })
      ]);
      const profiles = await profilesRes.json();
      const authData = authRes.ok ? await authRes.json() : { users: [] };
      return response(200, { profiles, users: authData.users || [] });
    }

    // ── LIST DOC TYPES PER STUDENT (for badges in table) ─────
    if (action === 'list-docs' && method === 'GET') {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/student_documents?select=student_id,doc_type`, { headers: sbHeaders() });
      return response(res.status, await res.text());
    }

    // ── GET DOCUMENTS FOR ONE STUDENT ─────────────────────────
    if (action === 'student-docs' && method === 'GET') {
      const id = (event.queryStringParameters || {}).student_id;
      if (!id || !/^[0-9a-f-]{36}$/.test(id)) return response(400, { error: 'Invalid student_id' });
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/student_documents?student_id=eq.${id}&select=*&order=uploaded_at.asc`,
        { headers: sbHeaders() }
      );
      return response(res.status, await res.text());
    }

    // ── GENERATE SIGNED URL FOR DOCUMENT DOWNLOAD ─────────────
    if (action === 'sign-url' && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (!body.path || typeof body.path !== 'string') return response(400, { error: 'Missing path' });
      // Sanitise: path must match uuid/doctype/timestamp.ext pattern
      if (!/^[0-9a-f-]{36}\/[a-z_]+\/\d+\.[a-z]+$/.test(body.path)) {
        return response(400, { error: 'Invalid path' });
      }
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/student-documents/${body.path}`,
        { method: 'POST', headers: sbHeaders(), body: JSON.stringify({ expiresIn: 3600 }) }
      );
      return response(res.status, await res.text());
    }

    // ── WRITE AUDIT LOG ───────────────────────────────────────
    if (action === 'audit-log' && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      await fetch(`${SUPABASE_URL}/rest/v1/audit_logs`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(body)
      });
      return response(204, '');
    }

    // ── LIST TERMS & CONDITIONS ───────────────────────────────
    if (action === 'list-terms' && method === 'GET') {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/terms_conditions?select=*&order=created_at.desc`,
        { headers: sbHeaders() }
      );
      return response(res.status, await res.text());
    }

    // ── SAVE / ACTIVATE TERMS ─────────────────────────────────
    if (action === 'save-terms' && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();
      const ph = { ...sbHeaders(), 'Prefer': 'return=minimal' };

      // Activate-only shortcut
      if (body.setActive && body.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/terms_conditions?is_active=eq.true`,
          { method: 'PATCH', headers: ph, body: JSON.stringify({ is_active: false, updated_at: now }) });
        await fetch(`${SUPABASE_URL}/rest/v1/terms_conditions?id=eq.${body.id}`,
          { method: 'PATCH', headers: ph, body: JSON.stringify({ is_active: true, updated_at: now }) });
        return response(204, '');
      }

      // Deactivate others if setting active
      if (body.active) {
        await fetch(`${SUPABASE_URL}/rest/v1/terms_conditions?is_active=eq.true`,
          { method: 'PATCH', headers: ph, body: JSON.stringify({ is_active: false, updated_at: now }) });
      }

      if (body.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/terms_conditions?id=eq.${body.id}`, {
          method: 'PATCH', headers: ph,
          body: JSON.stringify({ version: body.version, title: body.title, content: body.content, is_active: !!body.active, updated_at: now })
        });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/terms_conditions`, {
          method: 'POST', headers: ph,
          body: JSON.stringify({ version: body.version, title: body.title, content: body.content, is_active: !!body.active, created_at: now, updated_at: now })
        });
      }
      return response(204, '');
    }

    return response(400, { error: 'Unknown action' });

  } catch (e) {
    console.error('admin-api error:', e);
    return response(500, { error: 'Internal server error' });
  }
};
