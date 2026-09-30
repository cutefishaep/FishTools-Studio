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
    const isThumb = url.searchParams.get('thumb') === '1' || url.searchParams.get('thumbnail') === '1';

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

    if (!record || (!record.fileUrl && !record.dataBase64)) {
      return new Response(JSON.stringify({ success: false, error: 'Project Not Found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    // Direct thumbnail serving for OpenGraph / social preview
    if (isThumb) {
      if (record.thumbnail && typeof record.thumbnail === 'string') {
        const match = record.thumbnail.match(/^data:(image\/[a-zA-Z0-9\+\-]+);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const b64 = match[2];
          let bytes;
          if (typeof Buffer !== 'undefined') {
            bytes = Buffer.from(b64, 'base64');
          } else {
            const binaryString = atob(b64);
            bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
          }
          return new Response(bytes.buffer || bytes, {
            status: 200,
            headers: {
              'Content-Type': mime,
              'Cache-Control': 'public, max-age=86400, immutable',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      }
      return Response.redirect(`${url.origin}/assets/icon-192.png`, 302);
    }

    // Direct KV base64 file mode (download or metadata)
    if (record.dataBase64) {
      if (isDownload) {
        let bytes;
        if (typeof Buffer !== 'undefined') {
          bytes = Buffer.from(record.dataBase64, 'base64');
        } else {
          const binaryString = atob(record.dataBase64);
          const len = binaryString.length;
          bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
        }
        const safeFilename = String(record.name || 'Project').slice(0, 60).replace(/[^a-zA-Z0-9_\-]/g, '_') + '.ofts';
        return new Response(bytes.buffer || bytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${safeFilename}"`,
            'Content-Length': String(bytes.byteLength),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400, immutable'
          }
        });
      }

      // Return clean metadata without bulky base64 payload
      const { dataBase64, ...cleanMeta } = record;
      return new Response(JSON.stringify({
        success: true,
        project: cleanMeta
      }), {
        status: 200,
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
        headers: {
          'Range': 'bytes=0-1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(5000)
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
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(20000)
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
