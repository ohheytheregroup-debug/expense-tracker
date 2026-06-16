export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return res.status(200).json({ success: false, detail: 'API key not configured' });

  try {
    let base64 = image;
    if (base64.includes(',')) base64 = base64.split(',')[1];
    base64 = base64.replace(/\s/g, '');

    const visionResp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }] }]
      })
    });

    const raw = await visionResp.text();
    let visionData;
    try { visionData = JSON.parse(raw); } catch(e) { return res.status(200).json({ success: false, detail: raw.slice(0, 500) }); }

    if (!visionResp.ok || visionData.error) return res.status(200).json({ success: false, detail: JSON.stringify(visionData.error || visionData).slice(0, 500) });
    if (visionData.responses?.[0]?.error) return res.status(200).json({ success: false, detail: JSON.stringify(visionData.responses[0].error).slice(0, 500) });

    const text = visionData.responses[0]?.fullTextAnnotation?.text || '';
    return res.status(200).json({ success: true, text });

  } catch (err) {
    return res.status(500).json({ success: false, detail: err.message });
  }
}
