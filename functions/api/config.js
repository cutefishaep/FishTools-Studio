// Cloudflare Pages Function: /api/config
export async function onRequestGet(context) {
  const clientId = context.env.GOOGLE_CLIENT_ID || '';
  return new Response(JSON.stringify({ googleClientId: clientId }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
