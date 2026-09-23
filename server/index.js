const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const sharp = require('sharp');
const WebSocket = require('ws');
const mdns = require('multicast-dns')();

const app = express();
const PORT = Number(process.env.PORT || 7777);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..', 'web');
const CERT_DIR = path.join(__dirname, '..', 'certs');

app.use(express.static(ROOT));
app.get('/vendor/human.js', (_req, res) => {
  const human = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'human', 'dist', 'human.js');
  if (!fs.existsSync(human)) return res.status(404).type('text/plain').send('Human não instalado. Rode npm install.');
  res.sendFile(human);
});
app.get('/health', (_req, res) => res.json({ ok: true, service: 'x.local-camera', version: '0.2.0' }));

const state = {
  connected: 0,
  cameraClients: 0,
  frames: 0,
  fps: 0,
  lastFrameAt: 0,
  bytes: 0,
  processedFrames: 0,
  faceEngine: 'LANDMARK-STUB',
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
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'startRemoteCam') {
      ws.isCamera = true;
      state.cameraClients++;
      broadcast({ type: 'camera-status', active: true, clients: state.cameraClients }, ws);
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
      processFrame(latestFrame).catch(() => {});
      state.frames++;
      state.lastFrameAt = Date.now();
      state.bytes += latestFrame.length;

      if (Date.now() - lastFpsTick >= 1000) {
        state.fps = state.frames - (state._lastFrames || 0);
        state._lastFrames = state.frames;
        lastFpsTick = Date.now();
      }

      // Broadcast the most recent frame only. Clients drop stale frames.
      const payload = JSON.stringify({
        type: 'remoteFrame',
        mime: latestMime,
        data: msg.data
      });
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) client.send(payload);
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

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('=== x.local CAMERA NODE ===');
  console.log('LAN:');
  for (const ip of lanIPv4()) console.log('  https://' + ip + ':' + PORT);
  console.log('mDNS: https://x.local:' + PORT);
  console.log('WebSocket: wss://x.local:' + PORT + '/ws');
  console.log('CA: https://x.local:' + PORT + '/ca.crt');
  console.log('');
});

setInterval(() => {
  state.fps = state._lastFrames == null ? 0 : state.frames - state._lastFrames;
  state._lastFrames = state.frames;
}, 1000);


let processingBusy = false;
async function processFrame(frame) {
  if (processingBusy) return;
  processingBusy = true;
  const t0 = performance.now();
  try {
    // Primeiro estágio real: decodifica e normaliza o frame localmente.
    // O detector/landmarks GPU entra aqui sem alterar o transporte do iPhone.
    const meta = await sharp(frame).metadata();
    if (!state.faceCount) state.faceEngine = 'FRAME-DECODE';
    state.processedFrames++;
    state.processingMs = Number((performance.now() - t0).toFixed(2));
    state.frameWidth = meta.width || 0;
    state.frameHeight = meta.height || 0;
  } finally {
    processingBusy = false;
  }
}
