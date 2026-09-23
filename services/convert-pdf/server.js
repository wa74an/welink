// Minimal internal HTTP service: docx bytes in, PDF bytes out, via real
// headless LibreOffice. This is a Vercel "service" (Dockerfile.vercel),
// never reachable directly by the browser — only by the admin-api Node
// function, server-to-server, over the rewrite configured in vercel.json.
//
// No npm dependencies (matches this repo's convention of using Node
// built-ins wherever plain built-ins suffice) — everything here is stdlib.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 80;
const INTERNAL_SECRET = process.env.CONVERT_INTERNAL_SECRET;
const CONVERT_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 25 * 1024 * 1024; // a docx with a logo image is small; 25MB is generous headroom

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function runSoffice(inputPath, outDir) {
  return new Promise((resolve, reject) => {
    // Isolate LibreOffice's user profile per invocation — without this,
    // concurrent conversions on the same instance can collide on a shared
    // profile lock and hang or fail unpredictably.
    const profileDir = path.join(os.tmpdir(), `lo-profile-${crypto.randomUUID()}`);
    const args = [
      `-env:UserInstallation=file://${profileDir}`,
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', outDir,
      inputPath
    ];
    const child = spawn('soffice', args);

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('LibreOffice conversion timed out'));
    }, CONVERT_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rm(profileDir, { recursive: true, force: true }, () => {});
      if (code === 0) resolve();
      else reject(new Error(`soffice exited with code ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // Path is intentionally not checked beyond method: this service does
  // exactly one job, and the exact path Vercel's rewrite forwards through
  // isn't guaranteed, so any POST (other than /health) is treated as a
  // conversion request.
  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  if (!INTERNAL_SECRET || req.headers['x-convert-secret'] !== INTERNAL_SECRET) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
    return;
  }

  const jobId = crypto.randomUUID();
  const workDir = path.join(os.tmpdir(), `convert-${jobId}`);
  const inputPath = path.join(workDir, 'input.docx');

  try {
    const body = await readBody(req);
    if (body.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Empty body');
      return;
    }

    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(inputPath, body);

    await runSoffice(inputPath, workDir);

    const outputPath = path.join(workDir, 'input.pdf');
    if (!fs.existsSync(outputPath)) {
      throw new Error('Conversion finished but no PDF was produced');
    }
    const pdfBuffer = fs.readFileSync(outputPath);

    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdfBuffer.length });
    res.end(pdfBuffer);
  } catch (err) {
    // Never log request contents (the docx carries Civil ID numbers, names,
    // rent, etc.) — only the error message/stack, which never includes the
    // document body.
    console.error('convert-pdf error:', err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Conversion failed');
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
});

server.listen(PORT, () => {
  console.log(`convert-pdf service listening on port ${PORT}`);
});
