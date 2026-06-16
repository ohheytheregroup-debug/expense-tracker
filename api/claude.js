export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  let body;
  try { body = JSON.parse(raw); } catch(e) { return res.status(400).json({ success: false, detail: 'Invalid JSON' }); }

  // Handle Supabase operations
  if (body.action) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;

    if (body.action === 'save') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
        body: JSON.stringify(body.entry)
      });
      return res.status(200).json({ success: r.ok, status: r.status });
    }

    if (body.action === 'load') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/expenses?order=id.desc&limit=1000`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const data = await r.json();
      return res.status(200).json({ success: r.ok, entries: data });
    }

    if (body.action === 'update') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/expenses?id=eq.${body.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
        body: JSON.stringify(body.fields)
      });
      return res.status(200).json({ success: r.ok });
    }

    if (body.action === 'delete') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/expenses?id=eq.${body.id}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      return res.status(200).json({ success: r.ok });
    }
  }

  // Handle Vision API
  const { image } = body;
  if (!image) return res.status(400).json({ success: false, detail: 'No image provided' });
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  let base64 = image;
  if (base64.includes(',')) base64 = base64.split(',')[1];
  base64 = base64.replace(/[\s\r\n]/g, '');
  try {
    const visionResp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }] }] })
    });
    const data = await visionResp.json();
    if (data.error) return res.status(200).json({ success: false, detail: data.error.message });
    if (data.responses?.[0]?.error) return res.status(200).json({ success: false, detail: data.responses[0].error.message });
    const text = data.responses?.[0]?.fullTextAnnotation?.text || '';
    return res.status(200).json({ success: true, text });
  } catch(err) {
    return res.status(200).json({ success: false, detail: err.message });
  }
}
