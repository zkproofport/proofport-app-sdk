const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3300;

// SSE clients for real-time callback push
const sseClients = new Set();

// Store recent callback results (5-min TTL) for mobile page reload recovery
const recentResults = new Map();
const RESULT_TTL = 5 * 60 * 1000;

function broadcastSSE(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers for API endpoints
  if (pathname.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  if (req.method === 'GET' && (pathname === '/' || pathname === '/landing')) {
    const filePath = path.join(__dirname, 'landing.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading demo page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.method === 'GET' && pathname.startsWith('/dist/')) {
    const filePath = path.join(__dirname, '..', pathname);
    const ext = path.extname(filePath);
    const contentTypes = {
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.json': 'application/json',
      '.ts': 'application/typescript',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  } else if (req.method === 'GET' && pathname === '/api/events') {
    // SSE endpoint for real-time callback push
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  } else if (req.method === 'POST' && pathname === '/api/callback') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      console.log('\n=== Proof Response Received ===');
      console.log('Timestamp:', new Date().toISOString());
      console.log('URL:', req.url);

      let parsedBody = null;
      try {
        parsedBody = JSON.parse(body);
        console.log('Body:', JSON.stringify(parsedBody, null, 2));
      } catch {
        console.log('Body:', body);
      }
      console.log('==============================\n');

      // Store result for mobile page reload recovery
      if (parsedBody && parsedBody.requestId) {
        recentResults.set(parsedBody.requestId, parsedBody);
        setTimeout(() => recentResults.delete(parsedBody.requestId), RESULT_TTL);
      }

      // Push to all SSE clients
      broadcastSSE({
        type: 'proof-callback',
        timestamp: new Date().toISOString(),
        data: parsedBody || body,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  } else if (req.method === 'GET' && pathname.startsWith('/api/results/')) {
    // Retrieve stored result by requestId (for mobile page reload recovery)
    const requestId = pathname.replace('/api/results/', '');
    const result = recentResults.get(requestId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ found: !!result, data: result || null }));
  } else if (req.method === 'GET' && pathname === '/api/callback') {
    console.log('\n=== Proof Response Received (GET) ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Query:', parsedUrl.query);
    console.log('======================================\n');

    // Push to all SSE clients
    broadcastSSE({
      type: 'proof-callback',
      timestamp: new Date().toISOString(),
      data: parsedUrl.query,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, received: parsedUrl.query }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log('ZKProofPort SDK Demo Server');
  console.log('========================');
  console.log(`Demo:     http://localhost:${PORT}`);
  console.log(`Callback: http://localhost:${PORT}/api/callback`);
  console.log(`Events:   http://localhost:${PORT}/api/events`);
  console.log('\nPress Ctrl+C to stop\n');
});
