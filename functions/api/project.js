/**
 * Cloudflare Pages Function: /api/project
 * Secure Project Metadata & Proxy Streamer
 * 
 * Security Controls Implemented:
 * 1. Strict ID Param Sanitization (Regex whitelisting)
 * 2. SSRF Protection: Whitelists ONLY https://files.catbox.moe/ domain
 * 3. Range-Probe Catbox Verification (Accurate 404 detection for missing/deleted files)
 * 4. Path Traversal & Header Injection Neutralization on download
 * 5. X-Content-Type-Options: nosniff
 */

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const rawId = url.searchParams.get('id');
    const isDownload = url.searchParams.get('download') === '1';

    if (!rawId || typeof rawId !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid project id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 1. Strict ID Sanitization: only alphanumeric and underscores/hyphens, max 32 chars
    const id = rawId.slice(0, 32).replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!id) {
      return new Response(JSON.stringify({ error: 'Invalid project id format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const kv = context.env.PROJECTS_KV;
    let record = null;
    if (kv) {
      const raw = await kv.get(id);
      if (raw) {
        try { record = JSON.parse(raw); } catch (_) {}
      }
    }

    if (!record || !record.fileUrl) {
      return new Response(JSON.stringify({ success: false, error: 'Project Not Found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    // 2. SSRF Protection: strictly verify storage hostname, port, and credentials
    try {
      const parsedUrl = new URL(record.fileUrl);
      if (
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.hostname !== 'files.catbox.moe' ||
        (parsedUrl.port !== '' && parsedUrl.port !== '443') ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        return new Response(JSON.stringify({ success: false, error: 'Security rejection: unauthorized storage source' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    } catch (_) {
      return new Response(JSON.stringify({ success: false, error: 'Corrupt storage location' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 3. Verify file is still live and available on Catbox (fast 2-byte range probe)
    try {
      const probe = await fetch(record.fileUrl, {
        headers: { 'Range': 'bytes=0-1' },
        signal: AbortSignal.timeout(4000)
      });
      if (probe.status === 404 || (!probe.ok && probe.status !== 416)) {
        return new Response(JSON.stringify({ success: false, error: 'Project Not Found', fileMissing: true }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff'
          }
        });
      }
    } catch (_) {}

    // 4. Proxy download mode: streams file from Catbox with CORS headers
    if (isDownload) {
      const fileRes = await fetch(record.fileUrl, {
        signal: AbortSignal.timeout(15000)
      });

      if (!fileRes.ok) {
        return new Response(JSON.stringify({ success: false, error: 'Project Not Found', fileMissing: true }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Sanitize filename to prevent header injection or directory traversal
      const safeFilename = String(record.name || 'Project').slice(0, 60).replace(/[^a-zA-Z0-9_\-]/g, '_') + '.ofts';

      return new Response(fileRes.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeFilename}"`,
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // 5. Default: return verified metadata
    return new Response(JSON.stringify({
      success: true,
      project: record
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
