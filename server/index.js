const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const mdns = require('multicast-dns')();

const app = express();
const PORT = Number(process.env.PORT || 7777);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..', 'web');
const CERT_DIR = path.join(__dirname, '..', 'certs');
const FACE_ENGINE_PORT = Number(process.env.FACE_ENGINE_PORT || 7780);
let faceEngineProcess = null;

app.use(express.static(ROOT));
app.get('/vendor/human.js', (_req, res) => {
  const human = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'human', 'dist', 'human.js');
  if (!fs.existsSync(human)) return res.status(404).type('text/plain').send('Human não instalado. Rode npm install.');
  res.sendFile(human);
});
app.get('/health', (_req, res) => res.json({ ok: true, service: 'x.local-camera', version: '0.2.0' }));
app.use('/api/face-source', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }));
app.use('/api/face-swap', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }));

async function faceEngineFetch(pathname, options = {}) {
  return fetch('http://127.0.0.1:' + FACE_ENGINE_PORT + pathname, options);
}

app.post('/api/face-source', async (req, res) => {
  try {
    if (!req.body?.length) return res.status(400).json({ ok: false, error: 'EMPTY SOURCE IMAGE' });
    const upstream = await faceEngineFetch('/source', {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] || 'image/jpeg' },
      body: req.body
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (err) {
    res.status(503).json({ ok: false, error: 'FACE ENGINE OFFLINE: ' + err.message });
  }
});

app.post('/api/face-swap', async (req, res) => {
  try {
    if (!req.body?.length) return res.status(400).type('text/plain').send('EMPTY FRAME');
    const upstream = await faceEngineFetch('/swap', {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] || 'image/jpeg' },
      body: req.body
    });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/plain');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  } catch (err) {
    res.status(503).type('text/plain').send('FACE ENGINE OFFLINE: ' + err.message);
  }
}



const state = {
  connected: 0,
  cameraClients: 0,
  frames: 0,
  fps: 0,
  lastFrameAt: 0,
  bytes: 0,
  processedFrames: 0,
  faceEngine: 'FRAME-DECODE',
  processingMs: 0,
  faceCount: 0,
  faceDetectionMs: 0,
  faceBackend: 'WEBGL'
};

let latestFrame = null;
let latestMime = 'image/jpeg';
let lastFpsTick = Date.now();

function lanIPv4() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return [...new Set(out)];
}

function primaryLanIp() {
  return lanIPv4()[0] || '127.0.0.1';
}

function json(ws, value) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}

function broadcast(value, except) {
  const raw = JSON.stringify(value);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(raw);
  }
}

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    ...state,
    hasFrame: !!latestFrame,
    lastFrameAgeMs: latestFrame ? Date.now() - state.lastFrameAt : null
  });
});

app.get('/api/engine', (_req, res) => res.json({
  engine: state.faceEngine,
  processedFrames: state.processedFrames,
  processingMs: state.processingMs,
  gpu: state.faceBackend,
  faceCount: state.faceCount,
  faceDetectionMs: state.faceDetectionMs
}));

app.get('/api/frame.jpg', (_req, res) => {
  if (!latestFrame) return res.status(404).end();
  res.setHeader('Content-Type', latestMime);
  res.setHeader('Cache-Control', 'no-store');
  res.end(latestFrame);
});

app.get(['/ca.crt', '/ca.cer'], (_req, res) => {
  const ca = path.join(CERT_DIR, 'x-local-ca.pem');
  if (!fs.existsSync(ca)) return res.status(404).send('CA ausente. Rode npm run cert:generate');
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="x-local-ca.cer"');
  res.sendFile(ca);
});

const key = path.join(CERT_DIR, 'x.local-key.pem');
const cert = path.join(CERT_DIR, 'x.local-cert.pem');
if (!fs.existsSync(key) || !fs.existsSync(cert)) {
  console.error('Certificados ausentes. Rode: npm run cert:generate');
  process.exit(1);
}


/*
 * Bootstrap HTTP server:
 * The HTTPS CA cannot be downloaded from https://x.local:7777/ca.crt
 * until the iPhone already trusts the CA. Serve the CA over plain HTTP
 * on a separate local bootstrap port so the iPhone can install it first.
 */
const BOOTSTRAP_PORT = Number(process.env.BOOTSTRAP_PORT || 7778);
const bootstrap = express();

bootstrap.get('/', (_req, res) => {
  const caUrl = 'http://' + reqHost(_req) + ':' + BOOTSTRAP_PORT + '/ca.crt';
  res.type('html').send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x.local Camera — Install Certificate</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:28px;line-height:1.5">
<h1>x.local Camera</h1>
<p>Install the local CA certificate on this iPhone before opening the secure camera page.</p>
<p><a href="${caUrl}" download="x-local-ca.cer">Download x-local-ca.cer</a></p>
<p>After downloading: Settings → Profile Downloaded → Install. Then Settings → General → About → Certificate Trust Settings → enable full trust for the x.local Camera Local CA.</p>
<p>Secure camera: <a href="https://x.local:7777">https://x.local:7777</a></p>
</body></html>`);
});

bootstrap.get(['/ca.crt', '/ca.cer'], (_req, res) => {
  const ca = path.join(CERT_DIR, 'x-local-ca.pem');
  if (!fs.existsSync(ca)) return res.status(404).type('text/plain').send('CA ausente. Rode npm run cert:generate');
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="x-local-ca.cer"');
  res.sendFile(ca);
});

const bootstrapServer = require('http').createServer(bootstrap);

function reqHost(req) {
  return req.headers.host ? req.headers.host.split(':')[0] : primaryLanIp();
}

const server = https.createServer({
  key: fs.readFileSync(key),
  cert: fs.readFileSync(cert)
}, app);

const wss = new WebSocket.WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  state.connected++;
  json(ws, {
    type: 'hello',
    server: 'x.local-camera',
    transport: 'wss',
    source: 'iPhone',
    hasFrame: !!latestFrame
  });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (!ws.isCamera) return;
      const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (!frame.length) return;

      latestMime = 'image/jpeg';
      latestFrame = frame;
      state.frames++;
      state.lastFrameAt = Date.now();
      state.bytes += frame.length;

      if (Date.now() - lastFpsTick >= 1000) {
        state.fps = state.frames - (state._lastFrames || 0);
        state._lastFrames = state.frames;
        lastFpsTick = Date.now();
      }

      for (const client of wss.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(frame, { binary: true });
        }
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'startRemoteCam') {
      // A reconnect or duplicate start signal must not count the same socket twice.
      if (!ws.isCamera) {
        ws.isCamera = true;
        state.cameraClients++;
      }
      broadcast({ type: 'camera-status', active: state.cameraClients > 0, clients: state.cameraClients }, ws);
      return;
    }

    if (msg.type === 'stopRemoteCam') {
      if (ws.isCamera) {
        ws.isCamera = false;
        state.cameraClients = Math.max(0, state.cameraClients - 1);
      }
      broadcast({ type: 'camera-status', active: state.cameraClients > 0, clients: state.cameraClients }, ws);
      return;
    }

    if (msg.type === 'faceResult' && msg.data && typeof msg.data === 'object') {
      state.faceCount = Number(msg.data.faceCount || 0);
      state.faceDetectionMs = Number(msg.data.detectionMs || 0);
      state.faceBackend = String(msg.data.backend || 'WEBGL');
      state.faceEngine = state.faceCount > 0 ? 'FACE-LANDMARKS' : 'FACE-SCAN';
      return;
    }

    if (msg.type === 'webcamFrame' && typeof msg.data === 'string') {
      const match = msg.data.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) return;
      latestMime = match[1];
      latestFrame = Buffer.from(match[2], 'base64');
      state.frames++;
      state.lastFrameAt = Date.now();
      state.bytes += latestFrame.length;

      if (Date.now() - lastFpsTick >= 1000) {
        state.fps = state.frames - (state._lastFrames || 0);
        state._lastFrames = state.frames;
        lastFpsTick = Date.now();
      }

      for (const client of wss.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(latestFrame, { binary: true });
        }
      }
    }
  });

  ws.on('close', () => {
    state.connected = Math.max(0, state.connected - 1);
    if (ws.isCamera) state.cameraClients = Math.max(0, state.cameraClients - 1);
    broadcast({ type: 'camera-status', active: state.cameraClients > 0, clients: state.cameraClients });
  });
});

mdns.on('query', (query) => {
  const wants = query.questions?.some(q =>
    q.name.toLowerCase() === 'x.local' && (q.type === 'A' || q.type === 'ANY')
  );
  if (!wants) return;
  const ip = primaryLanIp();
  mdns.respond({
    answers: [{ name: 'x.local', type: 'A', ttl: 30, data: ip }]
  });
});

function startFaceEngine() {
  const script = path.join(__dirname, '..', 'face-engine', 'engine.py');
  if (!fs.existsSync(script)) {
    console.warn('[FACE ENGINE] engine.py não encontrado');
    return;
  }
  const python = process.env.PYTHON_EXECUTABLE || 'python';
  faceEngineProcess = spawn(python, [script], {
    cwd: path.join(__dirname, '..'),
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, FACE_ENGINE_PORT: String(FACE_ENGINE_PORT) }
  });
  faceEngineProcess.on('error', err => console.warn('[FACE ENGINE] start failed:', err.message));
  faceEngineProcess.on('exit', code => console.warn('[FACE ENGINE] exited:', code));
}

startFaceEngine();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('=== x.local CAMERA NODE ===');
  console.log('LAN:');
  for (const ip of lanIPv4()) console.log('  https://' + ip + ':' + PORT);
  console.log('mDNS: https://x.local:' + PORT);
  console.log('WebSocket: wss://x.local:' + PORT + '/ws');
  console.log('CA (bootstrap HTTP): http://x.local:' + BOOTSTRAP_PORT + '/ca.crt');
  console.log('Bootstrap page: http://x.local:' + BOOTSTRAP_PORT);
  console.log('Bootstrap LAN:');
  for (const ip of lanIPv4()) console.log('  http://' + ip + ':' + BOOTSTRAP_PORT);
  console.log('');
});

bootstrapServer.listen(BOOTSTRAP_PORT, HOST, () => {
  console.log('CA bootstrap HTTP ativo em http://0.0.0.0:' + BOOTSTRAP_PORT);
});

setInterval(() => {
  state.fps = state._lastFrames == null ? 0 : state.frames - state._lastFrames;
  state._lastFrames = state.frames;
}, 1000);


process.on('exit', () => {
  if (faceEngineProcess && !faceEngineProcess.killed) faceEngineProcess.kill();
});

// Live JPEGs stay compressed on the server. Face detection/compositing runs in the browser with Human.js.
