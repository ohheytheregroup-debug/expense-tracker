import { createSign } from 'crypto';

export const config = { api: { bodyParser: false } };

// ── Google Sheets JWT auth ────────────────────────────────────────────────────
async function getGoogleToken() {
  const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
  const SA_KEY = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SA_EMAIL, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(SA_KEY, 'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const jwt = `${header}.${payload}.${sig}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const d = await r.json();
  return d.access_token;
}

// Ensure monthly tab exists, create if not
async function ensureSheet(token, spreadsheetId, sheetTitle) {
  // Get existing sheets
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const d = await r.json();
  const exists = d.sheets?.some(s => s.properties.title === sheetTitle);
  if (!exists) {
    // Add new sheet tab
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetTitle } } }] })
    });
    // Add header row
    const headers = ['Date','Company','TIN','Address','Amount','Discount','VAT Type','Vatable Sales','VAT Amount','Category','Payment','Owner','Uploader','Notes','Saved At'];
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}!A1:O1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [headers] })
    });
  }
}

async function appendToSheet(token, spreadsheetId, sheetTitle, row) {
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}!A1:O1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  });
}

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

  if (body.action) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;

    if (body.action === 'save') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
        body: JSON.stringify(body.entry)
      });

      // Mirror to Google Sheets
      try {
        const e = body.entry;
        const date = e.date || '';
        const month = date ? new Date(date).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const token = await getGoogleToken();
        await ensureSheet(token, SHEET_ID, month);
        const row = [
          e.date || '', e.company || '', e.tin || '', e.address || '',
          e.amount || 0, e.discount || 0, e.vat_type || '', e.vatable_sales || 0, e.vat_amount || 0,
          e.category || '', e.payment || '', e.owner || '', e.uploader || '', e.notes || '', e.saved_at || ''
        ];
        await appendToSheet(token, SHEET_ID, month, row);
      } catch(sheetErr) { console.error('Sheet sync error:', sheetErr.message); }

      return res.status(200).json({ success: r.ok, status: r.status });
    }

    if (body.action === 'sync-sheet') {
      try {
        const e = body.entry;
        const date = e.date || '';
        const month = date ? new Date(date).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const token = await getGoogleToken();
        await ensureSheet(token, SHEET_ID, month);
        const row = [
          e.date||'', e.company||'', e.tin||'', e.address||'',
          e.amount||0, e.discount||0, e.vat_type||'', e.vatable_sales||0, e.vat_amount||0,
          e.category||'', e.payment||'', e.owner||'', e.uploader||'', e.notes||'', e.saved_at||''
        ];
        await appendToSheet(token, SHEET_ID, month, row);
        return res.status(200).json({ success: true });
      } catch(err) { return res.status(200).json({ success: false, detail: err.message }); }
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

    if (body.action === 'upload-receipt') {
      const { imageData, mimeType, entryId, month } = body;
      const ext = mimeType === 'image/png' ? 'png' : 'jpg';
      const filename = `${month}/${entryId}_${Date.now()}.${ext}`;
      const imgBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const uploadResp = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/receipts/${filename}`, {
        method: 'POST',
        headers: { 'Content-Type': mimeType || 'image/jpeg', 'apikey': process.env.SUPABASE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_KEY}` },
        body: imgBuffer
      });
      if (!uploadResp.ok) {
        const err = await uploadResp.text();
        return res.status(200).json({ success: false, detail: err });
      }
      const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/receipts/${filename}`;
      return res.status(200).json({ success: true, url: publicUrl, filename });
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
  while (base64.length % 4 !== 0) base64 += '=';
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64.substring(0, 100))) {
    return res.status(200).json({ success: false, detail: 'Invalid image format. Please use JPG or PNG.' });
  }
  const imgBuffer = Buffer.from(base64, 'base64');
  if (imgBuffer.length > 4 * 1024 * 1024) {
    return res.status(200).json({ success: false, detail: 'Image too large. Please use an image under 4MB.' });
  }
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
