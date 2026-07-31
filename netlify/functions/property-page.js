// Netlify Function — server-rendered link previews for shared listings
//
// Shared links look like /property/30-hadrian-s-tower. WhatsApp, iMessage,
// Facebook and X fetch that URL with a scraper that does NOT run JavaScript,
// so a plain client-side page would only ever show the generic homepage card.
// This function serves index.html with the Open Graph / Twitter tags rewritten
// to the actual listing (photo, name, city, price), so the preview shows the
// property. The HTML is otherwise untouched, so the page behaves exactly as
// before for real visitors.

const SUPABASE_URL = 'https://hegstrjpfompikkwxmpl.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlZ3N0cmpwZm9tcGlra3d4bXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTk4ODksImV4cCI6MjA5MDc5NTg4OX0.1vZXK6lrlI3yprlCPopgZoo1EOtjJg3YVdwHrKeT83w';

const SITE = 'https://welink-uk.com';
const FALLBACK_IMAGE = `${SITE}/og-image.png`;

// Escape for use inside an HTML attribute.
const attr = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

exports.handler = async (event) => {
  const host = event.headers.host || 'welink-uk.com';
  const origin = `https://${host}`;

  // Always fall back to the untouched page if anything goes wrong.
  let html;
  try {
    const res = await fetch(`${origin}/index.html`);
    html = await res.text();
  } catch (e) {
    console.error('could not load index.html:', e);
    return { statusCode: 302, headers: { Location: '/' }, body: '' };
  }

  const path = event.path || '';
  const id = (path.match(/\/property\/(\d+)/) || [])[1];

  if (id) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/properties?id=eq.${encodeURIComponent(id)}&select=*`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
      );
      const rows = await res.json();
      const p = Array.isArray(rows) ? rows[0] : null;

      if (p) {
        const bedsLabel = p.beds === 0 ? 'Studio' : `${p.beds} Bed${p.beds > 1 ? 's' : ''}`;
        const price = p.rent ? `£${Number(p.rent).toLocaleString('en-GB')}/month` : '';
        const title = `${p.name} — ${price} · We Link`;
        const location = [p.city, p.postcode].filter(Boolean).join(' · ');
        const desc = [
          location,
          [bedsLabel, p.baths ? `${p.baths} Bath` : null].filter(Boolean).join(' · '),
          (p.notes || '').replace(/\s+/g, ' ').trim().slice(0, 140)
        ].filter(Boolean).join(' — ');

        // First image of the (possibly comma-separated) list
        const image = (p.image_url || '')
          .split(',').map(s => s.trim()).filter(Boolean)[0] || FALLBACK_IMAGE;

        const url = `${SITE}${path}`;

        const replacements = [
          [/<title>[\s\S]*?<\/title>/, `<title>${attr(title)}</title>`],
          [/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${attr(desc)}"/>`],
          [/<meta property="og:type" content="[^"]*"\s*\/?>/, `<meta property="og:type" content="article"/>`],
          [/<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${attr(url)}"/>`],
          [/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${attr(title)}"/>`],
          [/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${attr(desc)}"/>`],
          [/<meta property="og:image" content="[^"]*"\s*\/?>/,
            `<meta property="og:image" content="${attr(image)}"/><meta property="og:image:width" content="1200"/><meta property="og:image:height" content="800"/>`],
          [/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${attr(title)}"/>`],
          [/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${attr(desc)}"/>`],
          [/<meta name="twitter:image" content="[^"]*"\s*\/?>/, `<meta name="twitter:image" content="${attr(image)}"/>`]
        ];
        for (const [re, out] of replacements) html = html.replace(re, out);
      }
    } catch (e) {
      console.error('property lookup failed:', e);
      // fall through and serve the page with default tags
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Let scrapers and CDNs cache briefly; listings change rarely.
      'Cache-Control': 'public, max-age=0, s-maxage=300'
    },
    body: html
  };
};
