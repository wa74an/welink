// Vercel Function — daily cron job. Auto-deletes raw Civil ID images 7 days
// after the contract that used them was generated (confirmed retention
// decision), keeping only the generated PDF and the fields that appear on
// it. Triggered by Vercel Cron (see vercel.json "crons"), never the browser
// — authenticated via CRON_SECRET, the convention Vercel uses to sign its
// own cron requests (Authorization: Bearer <CRON_SECRET>), not ADMIN_SECRET.
//
// Never logs storage paths or any extracted field value — only counts.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hegstrjpfompikkwxmpl.supabase.co';
const serviceKey = () => process.env.SUPABASE_SERVICE_KEY;

const RETENTION_DAYS = 7;

const sbHeaders = () => ({
  apikey: serviceKey(),
  Authorization: `Bearer ${serviceKey()}`,
  'Content-Type': 'application/json'
});

async function deleteStorageObject(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/guarantor-civil-ids/${path}`, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  return res.ok;
}

module.exports = async (req, res) => {
  const auth = req.headers['authorization'];
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).send('Unauthorized');
    return;
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/guarantor_contracts?select=id,tenant_civil_id_image_path&civil_id_uploaded_at=lt.${cutoff}&tenant_civil_id_image_path=not.is.null`,
      { headers: sbHeaders() }
    );
    if (!listRes.ok) {
      console.error('cleanup-civil-ids: list query failed, status', listRes.status);
      res.status(502).send('Query failed');
      return;
    }
    const rows = await listRes.json();

    let purged = 0;
    let failed = 0;

    for (const row of rows) {
      const ok = await deleteStorageObject(row.tenant_civil_id_image_path);

      if (ok) {
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/guarantor_contracts?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            tenant_civil_id_image_path: null,
            civil_id_uploaded_at: null
          })
        });
        if (patchRes.ok) purged++;
        else failed++;
      } else {
        failed++;
      }
    }

    console.log(`cleanup-civil-ids: purged ${purged}, failed ${failed}, out of ${rows.length} candidate row(s)`);
    res.status(200).setHeader('Content-Type', 'application/json').send(JSON.stringify({ purged, failed, candidates: rows.length }));
  } catch (err) {
    console.error('cleanup-civil-ids error:', err.message);
    res.status(500).send('Internal error');
  }
};
