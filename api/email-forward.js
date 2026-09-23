// Vercel Function — Resend inbound email forwarder (migrated from netlify/functions/email-forward.js)
// Resend POSTs here when an email arrives at admin@welink-uk.com
// This function re-sends it to Mentorazemi@gmail.com
//
// Requests are authenticated via the Svix signature Resend attaches to every
// webhook (headers: svix-id / svix-timestamp / svix-signature). Without this,
// anyone could POST here and make our Resend account send arbitrary email.
//
// The signature is computed over the RAW request body, so Vercel's default
// JSON body-parsing (which would re-serialize the body and break the byte-
// for-byte match) is disabled below.

const crypto = require('crypto');

const RESEND_KEY = process.env.RESEND_KEY;
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET; // "whsec_..." from the Resend webhook
const FORWARD_TO = 'Mentorazemi@gmail.com';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Verify the Svix signature over the RAW request body.
function verifyWebhook(headers, rawBody) {
  if (!WEBHOOK_SECRET) return false;
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !timestamp || !sigHeader) return false;

  // Replay protection: reject timestamps more than 5 minutes off.
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const secretBytes = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  const expectedBuf = Buffer.from(expected);

  // Header is a space-separated list of "v1,<signature>" pairs.
  return sigHeader.split(' ').some((part) => {
    const sig = part.split(',')[1] || '';
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const rawBody = await readRawBody(req);

  if (!verifyWebhook(req.headers || {}, rawBody)) {
    res.status(401).send('Invalid signature');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  // Resend inbound webhook payload fields
  const from    = payload.from    || 'Unknown Sender';
  const subject = payload.subject || '(no subject)';
  const html    = payload.html    || payload.text?.replace(/\n/g, '<br>') || '(empty email)';
  const text    = payload.text    || '';
  const to      = Array.isArray(payload.to) ? payload.to.join(', ') : (payload.to || 'admin@welink-uk.com');

  // Extract reply-to address (use original sender so replies go back to them)
  const replyTo = payload.from || null;

  const forwardHtml = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto">
      <div style="background:#0d1b2a;color:#f0ede8;padding:16px 24px;font-size:0.75rem;letter-spacing:0.1em">
        <strong>FORWARDED</strong> · Originally sent to ${to}
      </div>
      <div style="background:#f7f5f2;padding:16px 24px;font-size:0.8rem;color:#555;border-bottom:1px solid #e0ddd8;line-height:1.8">
        <div><strong>From:</strong> ${from}</div>
        <div><strong>To:</strong> ${to}</div>
        <div><strong>Subject:</strong> ${subject}</div>
      </div>
      <div style="padding:24px;background:#ffffff">
        ${html}
      </div>
    </div>`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'We Link Forwarding <noreply@welink-uk.com>',
        to: [FORWARD_TO],
        reply_to: replyTo,
        subject: `Fwd: ${subject}`,
        html: forwardHtml,
        text: `--- Forwarded from ${from} to ${to} ---\n\n${text}`
      })
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error('Resend forward error:', err);
      res.status(500).send('Forward failed');
      return;
    }

    console.log(`Forwarded email from ${from} → ${FORWARD_TO}`);
    res.status(200).send('OK');
  } catch (e) {
    console.error('Forward error:', e);
    res.status(500).send('Internal error');
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
