// Vercel Function — Admin API Proxy (migrated from netlify/functions/admin-api.js)
// Keeps SUPABASE_SERVICE_KEY out of client-side JavaScript.
// All requests must include x-admin-secret matching the ADMIN_SECRET env var.

const crypto = require('crypto');
const { mergeContract, MissingFieldError } = require('./lib/generateContract');
const { convertToPdf } = require('./lib/convertToPdf');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hegstrjpfompikkwxmpl.supabase.co';

// Buckets the sign-url action may generate signed download URLs for.
// guarantor-civil-ids is deliberately excluded — raw Civil ID images are
// write-once (admin-upload) / read-once (ocr-civil-id) / auto-purged, never
// exposed via a generic signed-URL download action.
const SIGN_URL_BUCKETS = ['student-documents', 'guarantor-contracts'];

// Tables the dashboard may read/write through this proxy (service role).
// Keeps the anon key out of all privileged writes.
const DB_TABLES = ['properties', 'clients', 'applications'];

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

async function route(req) {
  // ── Auth check ──────────────────────────────────────────────
  const secret = req.headers['x-admin-secret'];
  if (!adminSecret() || secret !== adminSecret()) {
    return response(401, { error: 'Unauthorized' });
  }

  const action = (req.query || {}).action;
  const method = req.method;

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
      const id = (req.query || {}).student_id;
      if (!id || !/^[0-9a-f-]{36}$/.test(id)) return response(400, { error: 'Invalid student_id' });
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/student_documents?student_id=eq.${id}&select=*&order=uploaded_at.asc`,
        { headers: sbHeaders() }
      );
      return response(res.status, await res.text());
    }

    // ── GENERATE SIGNED URL FOR DOCUMENT/CONTRACT DOWNLOAD ────
    if (action === 'sign-url' && method === 'POST') {
      const body = req.body || {};
      const bucket = body.bucket || 'student-documents';
      if (!SIGN_URL_BUCKETS.includes(bucket)) return response(400, { error: 'Invalid bucket' });
      if (!body.path || typeof body.path !== 'string') return response(400, { error: 'Missing path' });
      // Sanitise: path must match uuid/doctype/timestamp.ext pattern
      if (!/^[0-9a-f-]{36}\/[a-z_]+\/\d+\.[a-z]+$/.test(body.path)) {
        return response(400, { error: 'Invalid path' });
      }
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${body.path}`,
        { method: 'POST', headers: sbHeaders(), body: JSON.stringify({ expiresIn: 3600 }) }
      );
      return response(res.status, await res.text());
    }

    // ── WRITE AUDIT LOG ───────────────────────────────────────
    if (action === 'audit-log' && method === 'POST') {
      const body = req.body || {};
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
      const body = req.body || {};
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

    // ── LIST GUARANTOR CONTRACTS ───────────────────────────────
    if (action === 'list-contracts' && method === 'GET') {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/guarantor_contracts?select=*&order=created_at.desc`,
        { headers: sbHeaders() }
      );
      return response(res.status, await res.text());
    }

    // ── GENERATE A GUARANTOR CONTRACT (merge -> PDF -> store -> record) ──
    // Every field here has already been through the admin's explicit
    // review-and-confirm step in the UI — this action does NOT accept an
    // OCR result directly, only the values the admin confirmed.
    if (action === 'generate-contract' && method === 'POST') {
      const body = req.body || {};
      const generatedBy = typeof body.generated_by === 'string' ? body.generated_by.trim() : '';
      if (!generatedBy) return response(400, { error: 'generated_by is required' });

      // Contract date/weekday are the drafting date (today), computed here
      // rather than admin-entered — one less field to get wrong, and it's
      // never ambiguous. Arabic weekday names, Sunday-first (getDay(): 0=Sun).
      const ARABIC_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const contractWeekday = ARABIC_WEEKDAYS[now.getDay()];
      const contractDate = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`; // DD/MM/YYYY, for the template
      const contractDateIso = now.toISOString().slice(0, 10); // YYYY-MM-DD, for the DATE column

      // The template renders dates as DD/MM/YYYY; <input type="date"> in the
      // dashboard sends ISO (YYYY-MM-DD). Convert only for the merge — the DB
      // row keeps the ISO value, which is what a DATE column expects.
      const toDisplayDate = (iso) => {
        const [y, m, d] = String(iso || '').split('-');
        return (y && m && d) ? `${d}/${m}/${y}` : iso;
      };

      const templateFields = {
        ...body,
        contract_weekday: contractWeekday,
        contract_date: contractDate,
        contract_start_date: toDisplayDate(body.contract_start_date),
        contract_end_date: toDisplayDate(body.contract_end_date)
      };

      let docxBuffer;
      try {
        docxBuffer = mergeContract(templateFields);
      } catch (e) {
        if (e instanceof MissingFieldError) return response(400, { error: e.message, fields: e.fields });
        throw e;
      }

      let pdfBuffer;
      try {
        pdfBuffer = await convertToPdf(docxBuffer);
      } catch (e) {
        console.error('generate-contract: PDF conversion failed:', e.message);
        return response(502, { error: 'PDF conversion failed' });
      }

      const pdfPath = `${crypto.randomUUID()}/contract/${Date.now()}.pdf`;
      const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/guarantor-contracts/${pdfPath}`, {
        method: 'POST',
        headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/pdf' },
        body: pdfBuffer
      });
      if (!uploadRes.ok) {
        console.error('generate-contract: PDF storage upload failed, status', uploadRes.status);
        return response(502, { error: 'Could not store generated PDF' });
      }

      const hasCivilIdImages = !!(body.tenant_civil_id_image_path || body.guarantor_civil_id_image_path);
      const row = {
        tenant_name: body.tenant_name,
        tenant_address: body.tenant_address,
        tenant_civil_id: body.tenant_civil_id,
        tenant_phone: body.tenant_phone,
        tenant_passport: body.tenant_passport || null,
        guarantor_name: body.guarantor_name,
        guarantor_address: body.guarantor_address,
        guarantor_civil_id: body.guarantor_civil_id,
        guarantor_phone: body.guarantor_phone,
        guarantor_passport: body.guarantor_passport || null,
        rent_amount_gbp: body.rent_amount_gbp,
        rent_due_day: body.rent_due_day,
        contract_start_date: body.contract_start_date,
        contract_end_date: body.contract_end_date,
        contract_weekday: contractWeekday,
        contract_date: contractDateIso,
        pdf_storage_path: pdfPath,
        generated_by: generatedBy,
        tenant_civil_id_image_path: body.tenant_civil_id_image_path || null,
        guarantor_civil_id_image_path: body.guarantor_civil_id_image_path || null,
        civil_id_uploaded_at: hasCivilIdImages ? new Date().toISOString() : null
      };

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/guarantor_contracts`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify(row)
      });
      if (!insertRes.ok) {
        console.error('generate-contract: DB insert failed, status', insertRes.status);
        return response(502, { error: 'Contract generated but could not be recorded' });
      }
      const inserted = await insertRes.json();
      return response(200, Array.isArray(inserted) ? inserted[0] : inserted);
    }

    // ── GENERIC TABLE READ/WRITE (properties, clients, applications) ──
    // These replace the old client-side anon-key access. Every call is
    // already gated by the x-admin-secret check above.
    const dbTable = (req.query || {}).table;

    if (action === 'db-list' && method === 'GET') {
      if (!DB_TABLES.includes(dbTable)) return response(400, { error: 'Invalid table' });
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${dbTable}?select=*&order=created_at.desc`,
        { headers: sbHeaders() }
      );
      return response(res.status, await res.text());
    }

    if (action === 'db-insert' && method === 'POST') {
      if (!DB_TABLES.includes(dbTable)) return response(400, { error: 'Invalid table' });
      const row = req.body || {};
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${dbTable}`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify(row)
      });
      return response(res.status, await res.text());
    }

    if (action === 'db-update' && method === 'POST') {
      if (!DB_TABLES.includes(dbTable)) return response(400, { error: 'Invalid table' });
      const id = (req.query || {}).id;
      if (!/^\d+$/.test(id || '')) return response(400, { error: 'Invalid id' });
      const row = req.body || {};
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${dbTable}?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify(row)
      });
      return response(res.status, await res.text());
    }

    if (action === 'db-delete' && method === 'POST') {
      if (!DB_TABLES.includes(dbTable)) return response(400, { error: 'Invalid table' });
      const id = (req.query || {}).id;
      if (!/^\d+$/.test(id || '')) return response(400, { error: 'Invalid id' });
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${dbTable}?id=eq.${id}`, {
        method: 'DELETE',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' }
      });
      return response(res.ok ? 204 : res.status, '');
    }

    return response(400, { error: 'Unknown action' });

  } catch (e) {
    console.error('admin-api error:', e);
    return response(500, { error: 'Internal server error' });
  }
}

module.exports = async (req, res) => {
  const result = await route(req);
  res.status(result.statusCode);
  for (const [key, value] of Object.entries(result.headers || {})) {
    res.setHeader(key, value);
  }
  res.send(result.body);
};
