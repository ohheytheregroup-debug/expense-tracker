export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  let body;
  try { body = JSON.parse(raw); } catch(e) { return res.status(400).json({ success: false, detail: 'Invalid JSON. Body length: ' + raw.length + ' First 100: ' + raw.slice(0,100) }); }
  const { image } = body;
  if (!image) return res.status(400).json({ success: false, detail: 'No image. Keys: ' + Object.keys(body).join(',') + ' Body length: ' + raw.length });
  let base64 = image;
  if (base64.includes(',')) base64 = base64.split(',')[1];
  base64 = base64.replace(/\s/g, '');
  if (!base64 || base64.length < 100) return res.status(400).json({ success: false, detail: 'Base64 too short: ' + base64.length });
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
