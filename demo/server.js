/**
 * ProofPort SDK Demo Server
 *
 * Endpoints:
 * - GET /              : Serve SDK demo HTML
 * - GET /shieldswap    : Serve ShieldSwap DEX demo
 * - POST /callback     : Receive proof results from ProofPortApp (webhook)
 * - GET /status/:id    : Poll for request status
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3333;
const RESULTS_FILE = path.join(__dirname, 'results.json');

// Initialize results file
function initResultsFile() {
  if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({}, null, 2));
  }
}

// Read results from file
function readResults() {
  try {
    const data = fs.readFileSync(RESULTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Write results to file
function writeResults(results) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// Save a proof result
function saveResult(requestId, data) {
  const results = readResults();
  results[requestId] = {
    ...data,
    receivedAt: Date.now()
  };
  writeResults(results);
  console.log(`[Server] Saved result for request: ${requestId}`);
}

// Get a proof result
function getResult(requestId) {
  const results = readResults();
  return results[requestId] || null;
}

// Parse request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Create server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Set CORS headers for all responses
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET / - Serve demo HTML
  if (req.method === 'GET' && url.pathname === '/') {
    const htmlPath = path.join(__dirname, 'index.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Error loading index.html');
    }
    return;
  }

  // GET /shieldswap - Serve ShieldSwap DEX demo
  if (req.method === 'GET' && url.pathname === '/shieldswap') {
    const htmlPath = path.join(__dirname, 'shieldswap.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Error loading shieldswap.html');
    }
    return;
  }

  // POST /callback - Receive proof results from ProofPortApp
  if (req.method === 'POST' && url.pathname === '/callback') {
    try {
      const data = await parseBody(req);
      console.log('[Server] Received callback:', JSON.stringify(data, null, 2));

      if (!data.requestId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
      }

      saveResult(data.requestId, data);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, requestId: data.requestId }));
    } catch (e) {
      console.error('[Server] Callback error:', e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /status/:requestId - Poll for request status
  if (req.method === 'GET' && url.pathname.startsWith('/status/')) {
    const requestId = url.pathname.replace('/status/', '');

    if (!requestId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing requestId' }));
      return;
    }

    const result = getResult(requestId);

    if (result) {
      console.log(`[Server] Found result for ${requestId}: status=${result.status}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ found: true, data: result }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ found: false }));
    }
    return;
  }

  // 404 for other paths
  res.writeHead(404);
  res.end('Not Found');
});

// Initialize and start server
initResultsFile();
server.listen(PORT, () => {
  console.log(`\n🚀 ProofPort SDK Demo Server`);
  console.log(`   http://localhost:${PORT}\n`);
  console.log(`Endpoints:`);
  console.log(`   GET  /              - SDK demo page`);
  console.log(`   GET  /shieldswap    - ShieldSwap DEX demo`);
  console.log(`   POST /callback      - Receive proof from app`);
  console.log(`   GET  /status/:id    - Poll for result\n`);
});
