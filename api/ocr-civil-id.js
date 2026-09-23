// Vercel Function — tenant Civil ID OCR via Claude vision, structured output.
//
// Tenant-only: the guarantor Civil ID upload/OCR step was removed — the
// guarantor's identity is confirmed manually, not photographed.
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
const { z } = require('zod');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hegstrjpfompikkwxmpl.supabase.co';
const adminSecret = () => process.env.ADMIN_SECRET;
const serviceKey = () => process.env.SUPABASE_SERVICE_KEY;

const CivilIdExtraction = z.object({
  full_name: z.string().nullable(),
  civil_id_number: z.string().nullable(),
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
  // Same shape admin-upload writes: {uuid}/tenant/{timestamp}.{ext}
  if (!path || !/^[0-9a-f-]{36}\/tenant\/\d+\.[a-z]+$/.test(path)) {
    return response(res, 400, { error: 'Invalid path' });
  }
  const ext = path.split('.').pop();
  const mediaType = EXT_TO_MEDIA_TYPE[ext];
  if (!mediaType) return response(res, 400, { error: 'Unsupported file type' });
  const isPdf = mediaType === 'application/pdf';

  const startedAt = Date.now();
  try {
    const objRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/guarantor-civil-ids/${path}`,
      { headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` } }
    );
    if (!objRes.ok) {
      console.error('ocr-civil-id: could not fetch uploaded file, status', objRes.status);
      return response(res, 502, { error: 'Could not read uploaded file' });
    }
    const fileBuffer = Buffer.from(await objRes.arrayBuffer());
    const fileBase64 = fileBuffer.toString('base64');
    const fileContentBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileBase64 } };

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
            fileContentBlock,
            {
              type: 'text',
              text:
                'This is a photo or scan of a Kuwait Civil ID card. Extract the cardholder\'s full name ' +
                '(as printed, in its original script) and their Civil ID number. ' +
                'If you cannot read a field with confidence, return null for it rather than guessing. ' +
                'Set confidence to "low" if the image/scan is blurry, cropped, glare-obscured, or you are ' +
                'not fully certain of either value; otherwise "high".'
            }
          ]
        }
      ]
    });

    const parsed = result.parsed_output;
    console.log('ocr-civil-id: extraction', parsed ? 'succeeded' : 'failed to parse', `in ${Date.now() - startedAt}ms`);

    if (!parsed) {
      // Structured parse failed — treat as a full miss, never fabricate.
      return response(res, 200, { full_name: null, civil_id_number: null, confidence: 'low' });
    }
    return response(res, 200, parsed);
  } catch (err) {
    console.error('ocr-civil-id error:', err.message);
    return response(res, 200, { full_name: null, civil_id_number: null, confidence: 'low' });
  }
};
