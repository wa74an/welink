// Vercel Function — Civil ID OCR via Claude vision, structured output, for
// either the tenant or the parent ("guarantor" internally/in storage paths
// and DB columns — the admin UI labels this party "Parent").
//
// This is ALWAYS best-effort, advisory extraction. Nothing it returns is
// ever treated as final: the admin reviews and can edit every field before
// a contract is generated (api/admin-api.js's generate-contract action).
// A low-confidence or failed extraction must leave the field blank for the
// admin to fill in manually — never a guessed value.
//
// Never logs the image/PDF bytes or the extracted Civil ID number — only
// success/failure and timing, per the data-protection requirements around
// government-ID data.

const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
// zodOutputFormat's internals (z.toJSONSchema) require schemas built via the
// zod/v4 namespace specifically — building this with the classic root `zod`
// import silently breaks it ("Cannot read properties of undefined (reading
// 'def')") since the two namespaces use different internal shapes even
// within the same zod 3.25+ package.
const { z } = require('zod/v4');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hegstrjpfompikkwxmpl.supabase.co';
const adminSecret = () => process.env.ADMIN_SECRET;
const serviceKey = () => process.env.SUPABASE_SERVICE_KEY;

const CivilIdExtraction = z.object({
  full_name: z.string().nullable().describe('Full name in Arabic script exactly as printed on the card — never the English/Latin transliteration.'),
  civil_id_number: z.string().nullable(),
  address: z.string().nullable().describe(
    'The Kuwait home address from the BACK of the card, composed in Arabic from its printed fields ' +
    '(building/المبنى, unit type/الوحدة, street/الشارع, block/القطعة, area name/العنوان) as one line, ' +
    'e.g. "29 منزل شارع جاسم عبدالله جاسم الفريح قطعة 2 المنصوريه". Null if the back of the card ' +
    'was not provided or the address fields are not legible — never guess or reuse the front-side address label.'
  ),
  sex: z.enum(['male', 'female']).nullable().describe(
    'Read from the machine-readable zone (MRZ) at the bottom of the BACK of the card — the three ' +
    'monospaced lines of letters/digits/angle-brackets. The second MRZ line has the format ' +
    'YYMMDDC S YYMMDDC KWT... where S is a single M or F character right after the birthdate and its ' +
    'check digit (e.g. in "0402073M2804028KWT..." the sex character is the M right before "280402"). ' +
    'M -> "male", F -> "female". Null if the back/MRZ was not provided or not legible — never infer ' +
    'sex from the name or photo.'
  ),
  confidence: z.enum(['high', 'low'])
});

const EXT_TO_MEDIA_TYPE = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf'
};

function response(res, statusCode, body) {
  res.status(statusCode).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', 'no-store').send(JSON.stringify(body));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return response(res, 405, { error: 'Method not allowed' });

  const secret = req.headers['x-admin-secret'];
  if (!adminSecret() || secret !== adminSecret()) return response(res, 401, { error: 'Unauthorized' });

  const body = req.body || {};
  const path = body.path;
  const backPath = body.backPath || null;
  const PATH_RE = /^[0-9a-f-]{36}\/(tenant|guarantor)\/\d+\.[a-z]+$/;
  // Same shape admin-upload writes: {uuid}/{tenant|guarantor}/{timestamp}.{ext}
  if (!path || !PATH_RE.test(path)) {
    return response(res, 400, { error: 'Invalid path' });
  }
  if (backPath && !PATH_RE.test(backPath)) {
    return response(res, 400, { error: 'Invalid backPath' });
  }
  const ext = path.split('.').pop();
  const mediaType = EXT_TO_MEDIA_TYPE[ext];
  if (!mediaType) return response(res, 400, { error: 'Unsupported file type' });

  let backMediaType = null;
  if (backPath) {
    const backExt = backPath.split('.').pop();
    backMediaType = EXT_TO_MEDIA_TYPE[backExt];
    if (!backMediaType) return response(res, 400, { error: 'Unsupported back file type' });
  }

  async function fetchAsContentBlock(objectPath, objectMediaType) {
    const objRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/guarantor-civil-ids/${objectPath}`,
      { headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` } }
    );
    if (!objRes.ok) throw new Error(`storage fetch failed, status ${objRes.status}`);
    const fileBuffer = Buffer.from(await objRes.arrayBuffer());
    const fileBase64 = fileBuffer.toString('base64');
    return objectMediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: objectMediaType, data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: objectMediaType, data: fileBase64 } };
  }

  const startedAt = Date.now();
  try {
    const contentBlocks = [await fetchAsContentBlock(path, mediaType)];
    if (backPath) contentBlocks.push(await fetchAsContentBlock(backPath, backMediaType));

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: zodOutputFormat(CivilIdExtraction)
      },
      messages: [
        {
          role: 'user',
          content: [
            ...contentBlocks,
            {
              type: 'text',
              text:
                'This is a photo or scan of a Kuwait Civil ID card — possibly multiple pages/images covering ' +
                'both the front and back. From the FRONT, extract the cardholder\'s full name EXACTLY as ' +
                'printed in Arabic script — never the English/Latin transliteration that may also appear — ' +
                'and their Civil ID number. From the BACK (if provided), extract the Kuwait home address per ' +
                'the address field\'s format instructions, and the sex from the MRZ line per the sex field\'s ' +
                'instructions. Do not translate or transliterate any field; return Arabic text exactly as printed. ' +
                'If you cannot read a field with confidence — including if the back of the card simply wasn\'t ' +
                'provided — return null for it rather than guessing. ' +
                'Set confidence to "low" if the image/scan is blurry, cropped, glare-obscured, or you are ' +
                'not fully certain of the name or Civil ID number; otherwise "high". Confidence reflects the ' +
                'front-side fields only — address has its own null-if-unavailable handling.'
            }
          ]
        }
      ]
    });

    const parsed = result.parsed_output;
    console.log('ocr-civil-id: extraction', parsed ? 'succeeded' : 'failed to parse', `in ${Date.now() - startedAt}ms`);

    if (!parsed) {
      // Structured parse failed — treat as a full miss, never fabricate.
      return response(res, 200, { full_name: null, civil_id_number: null, address: null, sex: null, confidence: 'low' });
    }
    return response(res, 200, parsed);
  } catch (err) {
    console.error('ocr-civil-id error:', err.message);
    return response(res, 200, { full_name: null, civil_id_number: null, address: null, sex: null, confidence: 'low' });
  }
};
