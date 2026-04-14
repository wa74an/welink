// Netlify Function — Resend inbound email forwarder
// Resend POSTs here when an email arrives at admin@welink-uk.com
// This function re-sends it to Mentorazemi@gmail.com

const RESEND_KEY = process.env.RESEND_KEY;
const FORWARD_TO = 'Mentorazemi@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
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
    const res = await fetch('https://api.resend.com/emails', {
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

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend forward error:', err);
      return { statusCode: 500, body: 'Forward failed' };
    }

    console.log(`Forwarded email from ${from} → ${FORWARD_TO}`);
    return { statusCode: 200, body: 'OK' };
  } catch (e) {
    console.error('Forward error:', e);
    return { statusCode: 500, body: 'Internal error' };
  }
};
