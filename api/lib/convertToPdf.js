// Calls the convert-pdf service (services/convert-pdf, real headless
// LibreOffice running in its own container) to turn a merged .docx Buffer
// into a PDF Buffer. Server-to-server only — never exposed to the browser.

const CONVERT_TIMEOUT_MS = 65_000; // slightly above the service's own 60s internal timeout

function baseUrl() {
  // VERCEL_URL is provided automatically by the platform (the deployment's
  // own hostname, no scheme) — same project, so the convert-pdf service is
  // reachable at this origin via the /internal/convert-pdf rewrite.
  if (process.env.CONVERT_PDF_URL) return process.env.CONVERT_PDF_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/internal/convert-pdf`;
  throw new Error('No convert-pdf endpoint configured (VERCEL_URL/CONVERT_PDF_URL missing)');
}

/**
 * @param {Buffer} docxBuffer
 * @returns {Promise<Buffer>} the converted PDF
 */
async function convertToPdf(docxBuffer) {
  const secret = process.env.CONVERT_INTERNAL_SECRET;
  if (!secret) throw new Error('CONVERT_INTERNAL_SECRET is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONVERT_TIMEOUT_MS);

  try {
    const res = await fetch(baseUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'x-convert-secret': secret
      },
      body: docxBuffer,
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`convert-pdf service returned ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('PDF conversion timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { convertToPdf };
