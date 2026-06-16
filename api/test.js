export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  
  // Test with a hardcoded tiny image - a simple white 10x10 JPEG in base64
  const tinyJpeg = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC AAKAAoDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABAMF/8QAIRAAAQQCAgMBAAAAAAAAAAAAAQACAxESITFBUWH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Amz3FxLiAADE4nJJJJVL4PjJ5LySSSSX/2Q==";

  try {
    const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image: { content: tinyJpeg.replace(/\s/g,'') }, features: [{ type: 'TEXT_DETECTION' }] }]
      })
    });
    const data = await resp.json();
    return res.status(200).json({ 
      keyExists: !!apiKey,
      keyPrefix: apiKey ? apiKey.slice(0,8) + '...' : 'MISSING',
      visionStatus: resp.status,
      visionResponse: JSON.stringify(data).slice(0, 500)
    });
  } catch(err) {
    return res.status(200).json({ keyExists: !!apiKey, error: err.message });
  }
}
