// Netlify Function — enquiry / application email sender
//
// The public site used to call api.resend.com directly from index.html with
// the Resend API key embedded in the page source, which exposed the key to
// anyone who viewed source. The browser now POSTs the form fields here and
// this function composes and sends both emails server-side, so the key never
// leaves the server.
//
// Env: RESEND_KEY

const RESEND_KEY = process.env.RESEND_KEY;
const SUPABASE_URL = 'https://hegstrjpfompikkwxmpl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Where enquiry notifications go.
const TEAM_RECIPIENTS = ['mentor@welink-uk.com', 'admin@welink-uk.com', 'Mentorazemi@gmail.com'];
const ALLOWED_ORIGINS = ['https://welink-uk.com', 'https://www.welink-uk.com'];

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// Escape user-supplied values before interpolating them into the HTML emails.
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

// Trim to a sane length so a bot can't post megabytes of text into an email.
const clean = (s, max = 500) => String(s == null ? '' : s).trim().slice(0, max);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!RESEND_KEY) return json(500, { error: 'Email service not configured' });

  // Only accept submissions from our own site.
  const origin = event.headers.origin || event.headers.Origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(403, { error: 'Forbidden' });

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const send = (payload) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

  // ── Contact form (contact.html) ──
  // Also creates the client record here: `clients` is RLS-locked, so the
  // browser's public key can no longer insert it.
  if (data.type === 'contact') {
    const fname = clean(data.fname, 100);
    const lname = clean(data.lname, 100);
    const email = clean(data.email, 254);
    const type  = clean(data.enquiryType, 80);
    const message = clean(data.message, 4000);
    if (!isEmail(email)) return json(400, { error: 'A valid email is required' });
    if (!fname && !lname) return json(400, { error: 'A name is required' });

    const joined = new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    if (SERVICE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ fname, lname, email, status: 'Pending', joined })
        });
      } catch (e) { console.error('client insert failed:', e); }
    }

    try {
      const res = await send({
        from: 'We Link Notifications <noreply@welink-uk.com>',
        to: TEAM_RECIPIENTS,
        reply_to: email,
        subject: `New Contact Form Message — ${fname} ${lname}`.trim(),
        html: `<div style="font-family:Georgia,serif;font-size:0.9rem;line-height:1.7">
                 <p><b>From:</b> ${esc(fname)} ${esc(lname)}</p>
                 <p><b>Email:</b> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
                 <p><b>Type:</b> ${esc(type) || '—'}</p>
                 <p><b>Message:</b></p>
                 <p>${esc(message).replace(/\n/g, '<br>')}</p>
               </div>`
      });
      if (!res.ok) { console.error('Resend contact failed:', res.status); return json(502, { error: 'Could not send email' }); }
      return json(200, { ok: true });
    } catch (e) {
      console.error('send-enquiry contact error:', e);
      return json(502, { error: 'Could not send email' });
    }
  }

  const fname       = clean(data.fname, 100);
  const lname       = clean(data.lname, 100);
  const email       = clean(data.email, 254);
  const phone       = clean(data.phone, 40);
  const uni         = clean(data.uni, 150);
  const budget      = clean(data.budget, 60);
  const nationality = clean(data.nationality, 80);
  const notes       = clean(data.notes, 2000);
  const isLandlord  = data.isLandlord === true;

  if (!isEmail(email)) return json(400, { error: 'A valid email is required' });
  if (!fname && !lname) return json(400, { error: 'A name is required' });

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const kind  = isLandlord ? 'Landlord Enquiry' : 'Student Application';
  const name  = `${fname} ${lname}`.trim();

  // Persist the lead. `clients` / `applications` are RLS-locked, so these
  // inserts must happen here with the service role rather than in the browser.
  if (SERVICE_KEY) {
    const shortDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const sbHeaders = {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };
    const clientRow = {
      fname: fname || 'Unknown',
      lname,
      nationality,
      email,
      phone,
      uni,
      budget,
      movein: clean(data.movein, 60) || null,
      proptype: clean(data.proptype, 60) || null,
      status: 'Pending',
      joined: shortDate.slice(3)
    };
    const appRow = {
      client: name || email || 'New Applicant',
      property: isLandlord ? 'Landlord Enquiry' : (uni ? `Student - ${uni}` : 'Student Enquiry'),
      type: isLandlord ? 'Landlord' : 'Student',
      date: shortDate,
      status: 'Pending'
    };
    try {
      const [c, a] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/clients`, { method: 'POST', headers: sbHeaders, body: JSON.stringify(clientRow) }),
        fetch(`${SUPABASE_URL}/rest/v1/applications`, { method: 'POST', headers: sbHeaders, body: JSON.stringify(appRow) })
      ]);
      if (!c.ok) console.error('client insert failed:', c.status, await c.text());
      if (!a.ok) console.error('application insert failed:', a.status, await a.text());
    } catch (e) { console.error('lead insert error:', e); }
  }

  const applicantHtml = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;background:#0d1b2a;color:#f0ede8;padding:40px 36px">
      <div style="font-size:1.3rem;letter-spacing:0.12em;margin-bottom:24px">We Link</div>
      <h2 style="font-size:1.05rem;font-weight:400;letter-spacing:0.06em;margin-bottom:18px">Thank you, ${esc(fname) || 'there'}.</h2>
      <p style="font-size:0.9rem;line-height:1.8;color:rgba(240,237,232,0.8)">
        We've received your ${esc(kind.toLowerCase())} and our team will review it shortly.
        We aim to respond within 48 hours.
      </p>
      <div style="margin:28px 0;padding:20px 24px;border:1px solid rgba(255,255,255,0.12)">
        <p style="font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;color:rgba(240,237,232,0.5);margin-bottom:10px">Next Step</p>
        <p style="font-size:0.88rem;line-height:1.7;color:rgba(240,237,232,0.75)">Create your student portal account to upload your documents, track your application, and access property listings.</p>
        <a href="https://welink-uk.com/register" style="display:inline-block;margin-top:14px;background:#f0ede8;color:#0d1b2a;padding:11px 24px;font-size:0.78rem;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none">Create Account →</a>
      </div>
      <p style="margin-top:32px;font-size:0.78rem;color:rgba(240,237,232,0.4)">We Link · welink-uk.com</p>
    </div>`;

  const row = (label, value) =>
    `<tr><td style="padding:8px 0;color:rgba(240,237,232,0.5);width:38%">${label}</td><td style="padding:8px 0">${value}</td></tr>`;

  const adminHtml = `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;background:#0d1b2a;color:#f0ede8;padding:40px 36px">
      <div style="font-size:1.3rem;letter-spacing:0.12em;margin-bottom:24px">We Link</div>
      <h2 style="font-size:1rem;font-weight:400;letter-spacing:0.06em;margin-bottom:20px;color:rgba(240,237,232,0.6);text-transform:uppercase">New ${esc(kind)}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        ${row('Name', esc(name))}
        ${row('Email', `<a href="mailto:${esc(email)}" style="color:#4cbb8a">${esc(email)}</a>`)}
        ${row('Phone', esc(phone) || '—')}
        ${!isLandlord ? row('University', esc(uni) || '—') : ''}
        ${!isLandlord ? row('Budget', esc(budget) || '—') : ''}
        ${row('Nationality', esc(nationality) || '—')}
        ${row('Submitted', esc(today))}
      </table>
      ${notes ? `<div style="margin-top:20px;padding:16px;border:1px solid rgba(255,255,255,0.1);font-size:0.82rem;color:rgba(240,237,232,0.7);line-height:1.7"><strong style="color:#f0ede8">Notes:</strong><br>${esc(notes)}</div>` : ''}
      <a href="https://welink-uk.com/admin" style="display:inline-block;margin-top:28px;background:#f0ede8;color:#0d1b2a;padding:11px 24px;font-size:0.75rem;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none">View in Dashboard →</a>
      <p style="margin-top:32px;font-size:0.78rem;color:rgba(240,237,232,0.3)">We Link internal notification · welink-uk.com</p>
    </div>`;

  try {
    const [applicantRes, teamRes] = await Promise.all([
      send({
        from: 'We Link <noreply@welink-uk.com>',
        to: [email],
        subject: isLandlord ? 'We Link — Landlord Enquiry Received' : 'We Link — Application Received',
        html: applicantHtml
      }),
      send({
        from: 'We Link Notifications <noreply@welink-uk.com>',
        to: TEAM_RECIPIENTS,
        reply_to: email,
        subject: `New ${kind} — ${name}`,
        html: adminHtml
      })
    ]);

    if (!applicantRes.ok && !teamRes.ok) {
      console.error('Resend failed:', applicantRes.status, teamRes.status);
      return json(502, { error: 'Could not send email' });
    }
    return json(200, { ok: true });
  } catch (e) {
    console.error('send-enquiry error:', e);
    return json(502, { error: 'Could not send email' });
  }
};
