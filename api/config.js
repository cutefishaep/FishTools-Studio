// Vercel Serverless Function: /api/config
// Returns public app configuration (Google OAuth Client ID)
// Client ID is public-safe — it's embedded in the browser OAuth flow by design

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';

  res.status(200).json({ googleClientId: clientId });
}
