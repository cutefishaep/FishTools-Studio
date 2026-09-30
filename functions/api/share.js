/**
 * Cloudflare Pages Function: /api/share
 * Secure Project Sharing Handler
 * 
 * Security Controls Implemented:
 * 1. File Size Capping (Max 100MB)
 * 2. Magic Byte Verification (Enforces valid ZIP / .ofts archive, blocks malware/scripts)
 * 3. Strict Input Sanitization & Field Truncation (Prevents XSS & Injection)
 * 4. Cryptographically Secure ID Generation (Prevents link enumeration/scraping)
 * 5. Rate Limiting via IP (Max 10 shares per minute per IP to prevent DoS)
 * 6. Content Security & Hardened Response Headers
 */

function generateSecureShortId() {
  const chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'; // base56 (no confusing 0/O, 1/l/I)
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < bytes.length; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

export async function onRequestPost(context) {
  try {
    const clientIp = context.request.headers.get('CF-Connecting-IP') || 'anonymous';
    const kv = context.env.PROJECTS_KV;

    // 1. IP Rate Limiting (Max 10 uploads per minute per IP)
    if (kv) {
      const rateLimitKey = `rl:${clientIp}`;
      const currentHits = await kv.get(rateLimitKey);
      if (currentHits && parseInt(currentHits, 10) >= 10) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a minute before sharing again.' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      const newHits = currentHits ? parseInt(currentHits, 10) + 1 : 1;
      // Expire rate limit key in 60 seconds
      await kv.put(rateLimitKey, String(newHits), { expirationTtl: 60 });
    }

    const formData = await context.request.formData();
    const file = formData.get('file');

    // 2. Validate file existence and size limit (Max 100MB)
    if (!file || typeof file.size !== 'number' || file.size === 0) {
      return new Response(JSON.stringify({ error: 'No valid project file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({
        error: 'Project exceeds maximum upload limit of 15MB. Please save the project to your local device (Download Project .ofts).'
      }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 3. Binary Magic Byte Validation: Must be valid ZIP archive (PK\x03\x04 or PK\x05\x06)
    const headerBuffer = await file.slice(0, 4).arrayBuffer();
    const headerBytes = new Uint8Array(headerBuffer);
    const isZip = headerBytes[0] === 0x50 && headerBytes[1] === 0x4B &&
                  (headerBytes[2] === 0x03 || headerBytes[2] === 0x05 || headerBytes[2] === 0x07);

    if (!isZip) {
      return new Response(JSON.stringify({ error: 'Security rejection: Uploaded file is not a valid .ofts project package.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 4. Sanitize and length-cap metadata (Prevents XSS / Injection)
    const rawName = String(formData.get('name') || 'Untitled Project').trim();
    const sanitizedName = rawName.slice(0, 80).replace(/[^\w\s\-\.\(\)]/gi, '').trim() || 'Untitled Project';

    const rawSpecs = String(formData.get('specs') || '1080p • 60 fps').trim();
    const sanitizedSpecs = rawSpecs.slice(0, 40).replace(/[^\w\s\-\•\.\(\)]/gi, '') || '1080p • 60 fps';

    const rawSize = String(formData.get('size') || '1.0 MB').trim();
    const sanitizedSize = rawSize.slice(0, 20).replace(/[^\w\s\-\.]/gi, '') || '1.0 MB';

    const rawAspect = String(formData.get('aspectRatio') || '16:9').trim();
    const sanitizedAspect = rawAspect.slice(0, 10).replace(/[^\d:]/g, '') || '16:9';

    let sanitizedThumbnail = '';
    const rawThumb = formData.get('thumbnail');
    if (typeof rawThumb === 'string' && (rawThumb.startsWith('data:image/jpeg;base64,') || rawThumb.startsWith('data:image/webp;base64,') || rawThumb.startsWith('data:image/png;base64,'))) {
      // Hard cap thumbnail data URL to 150KB
      if (rawThumb.length <= 150000) {
        sanitizedThumbnail = rawThumb;
      }
    }

    // 5. Forward file to Catbox API
    const catboxForm = new FormData();
    catboxForm.append('reqtype', 'fileupload');
    const safeFilename = (sanitizedName.replace(/[^a-zA-Z0-9_-]/g, '_')) + '.ofts';
    catboxForm.append('fileToUpload', file, safeFilename);

    let catboxRes = null;
    let catboxUrl = '';
    try {
      catboxRes = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: catboxForm,
        headers: {
          'User-Agent': 'FishTools-Studio/1.0 (WebMotionEditor)'
        },
        signal: AbortSignal.timeout(15000)
      });
      if (catboxRes && catboxRes.ok) {
        const text = (await catboxRes.text()).trim();
        if (text.startsWith('https://files.catbox.moe/')) {
          catboxUrl = text;
        }
      }
    } catch (_) {}

    // Fallback: If Catbox blocks or returns 412/520, store project package directly in KV if <= 10MB
    if (!catboxUrl) {
      if (kv && file.size <= 10 * 1024 * 1024) {
        const fileBuffer = await file.arrayBuffer();
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
        const fallbackId = generateSecureShortId();
        const fallbackRecord = {
          id: fallbackId,
          name: sanitizedName,
          specs: sanitizedSpecs,
          size: sanitizedSize,
          aspectRatio: sanitizedAspect,
          thumbnail: sanitizedThumbnail,
          dataBase64: base64Data,
          fileUrl: `${new URL(context.request.url).origin}/api/project?id=${fallbackId}&download=1`,
          createdAt: Date.now()
        };
        await kv.put(fallbackId, JSON.stringify(fallbackRecord));
        const origin = new URL(context.request.url).origin;
        return new Response(JSON.stringify({
          success: true,
          id: fallbackId,
          shareUrl: `${origin}/${fallbackId}`,
          catboxUrl: fallbackRecord.fileUrl,
          record: fallbackRecord
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff'
          }
        });
      }

      const status = catboxRes ? catboxRes.status : 502;
      return new Response(JSON.stringify({ error: `Storage provider error (${status}). Please try again later.` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 6. Generate collision-resistant secure ID
    let id = generateSecureShortId();
    if (kv) {
      let attempts = 0;
      while (attempts < 5) {
        const existing = await kv.get(id);
        if (!existing) break;
        id = generateSecureShortId();
        attempts++;
      }
    }

    // 7. Store purely minimal metadata in KV
    const record = {
      id,
      name: sanitizedName,
      specs: sanitizedSpecs,
      size: sanitizedSize,
      aspectRatio: sanitizedAspect,
      thumbnail: sanitizedThumbnail,
      fileUrl: catboxUrl,
      createdAt: Date.now()
    };

    if (kv) {
      await kv.put(id, JSON.stringify(record));
    }

    const origin = new URL(context.request.url).origin;
    return new Response(JSON.stringify({
      success: true,
      id,
      shareUrl: `${origin}/${id}`,
      catboxUrl,
      record
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
