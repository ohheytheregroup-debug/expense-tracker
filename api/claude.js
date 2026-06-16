export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { images } = req.body;
  if (!images || !images.length) return res.status(400).json({ error: 'No images provided' });
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  try {
    const requests = images.map(img => {
      let base64 = img.base64 || '';
      if (base64.includes(',')) base64 = base64.split(',')[1];
      base64 = base64.replace(/\s/g, '');
      return { image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }] };
    });
    const visionResp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });
    const visionData = await visionResp.json();
    if (visionData.error) return res.status(200).json({ success: false, reason: 'vision_error', detail: visionData.error.message });
    if (visionData.responses?.[0]?.error) return res.status(200).json({ success: false, reason: 'vision_error', detail: visionData.responses[0].error.message });
    const fullText = visionData.responses.map(r => r.fullTextAnnotation?.text || '').join('\n');
    if (!fullText.trim()) return res.status(200).json({ success: false, reason: 'no_text', fields: {} });
    const fields = parseReceiptText(fullText);
    const missingFields = [];
    if (!fields.company) missingFields.push('company');
    if (!fields.amount) missingFields.push('amount');
    if (!fields.date) missingFields.push('date');
    return res.status(200).json({ success: true, fields, rawText: fullText, missingFields });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
function parseReceiptText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let company = '';
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const line = lines[i];
    if (line.length > 3 && line.length < 80 && !/^\d/.test(line) && !/^(receipt|invoice|official|date|tin|vat|total|amount)/i.test(line)) {
      company = toTitleCase(line); break;
    }
  }
  const tinMatch = text.match(/\bTIN[:\s#]*([0-9]{3}-[0-9]{3}-[0-9]{3,4}(?:-[0-9]{3,5})?)/i) || text.match(/\b([0-9]{3}-[0-9]{3}-[0-9]{3,4}(?:-[0-9]{3,5})?)\b/);
  const tin = tinMatch ? tinMatch[1] : '';
  const orMatch = text.match(/(?:O\.?R\.?|Official Receipt|Invoice|Inv\.?|Receipt)\s*(?:No\.?|#|Number)?\s*[:\s]?\s*([A-Z0-9\-]{4,20})/i) || text.match(/(?:No\.?|#)\s*([A-Z0-9\-]{4,20})/i);
  const orNumber = orMatch ? orMatch[1].trim() : '';
  const dateMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  let date = '';
  if (dateMatch) {
    let [, a, b, c] = dateMatch;
    if (c.length === 2) c = '20' + c;
    date = `${c}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`;
  } else {
    const monthMatch = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(\d{4})/i) || text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(\d{1,2})[\s,]+(\d{4})/i);
    if (monthMatch) {
      const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
      date = /^\d/.test(monthMatch[1]) ? `${monthMatch[3]}-${months[monthMatch[2].toLowerCase().slice(0,3)]}-${monthMatch[1].padStart(2,'0')}` : `${monthMatch[3]}-${months[monthMatch[1].toLowerCase().slice(0,3)]}-${monthMatch[2].padStart(2,'0')}`;
    }
  }
  if (!date) date = new Date().toISOString().split('T')[0];
  let amount = '';
  const amountPatterns = [/(?:grand\s+total|total\s+amount\s+due|amount\s+due|total\s+due|total)[:\s]*(?:PHP|₱|P)?\s*([\d,]+\.?\d{0,2})/i, /(?:PHP|₱|P)\s*([\d,]+\.\d{2})/i, /TOTAL[:\s]*([\d,]+\.\d{2})/i];
  for (const pattern of amountPatterns) { const m = text.match(pattern); if (m) { amount = m[1].replace(/,/g, ''); break; } }
  if (!amount) { const nums = [...text.matchAll(/([\d,]+\.\d{2})/g)].map(m => parseFloat(m[1].replace(/,/g,''))); if (nums.length) amount = String(Math.max(...nums)); }
  let address = '';
  const addrKeywords = /\b(st\.|street|ave\.|avenue|road|rd\.|blvd|floor|bldg|building|brgy|barangay|city|manila|quezon|makati|cebu|davao|ph|philippines)\b/i;
  const addrLines = []; let pastCompany = false;
  for (const line of lines) {
    if (!pastCompany && line.toLowerCase().includes(company.toLowerCase().split(' ')[0])) { pastCompany = true; continue; }
    if (pastCompany && addrKeywords.test(line) && line.length < 100) { addrLines.push(line); if (addrLines.length >= 2) break; }
  }
  address = addrLines.join(', ');
  return { company, tin, orNumber, date, amount, address };
}
function toTitleCase(str) { return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
