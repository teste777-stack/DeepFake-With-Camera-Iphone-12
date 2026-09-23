const video = document.getElementById('preview');
const status = document.getElementById('status');
const source = document.getElementById('source');
const resolution = document.getElementById('resolution');
const placeholder = document.getElementById('placeholder');
const start = document.getElementById('start');
const stop = document.getElementById('stop');
const flip = document.getElementById('flip');
const remote = document.getElementById('remotePreview');
const remoteCtx = remote.getContext('2d', { alpha: false });
const sourceFrame = document.createElement('canvas');
sourceFrame.width = remote.width;
sourceFrame.height = remote.height;
const sourceFrameCtx = sourceFrame.getContext('2d', { alpha: false });
const compositor = document.createElement('canvas');
compositor.width = remote.width;
compositor.height = remote.height;
const compositorCtx = compositor.getContext('2d', { alpha: false });
let latestFaces = [];
let smoothedLandmarks = [];
let compositorMode = 'TRACK';
let lastCompositorFrame = 0;
const remoteFps = document.getElementById('remoteFps');
const remoteFrames = document.getElementById('remoteFrames');
const engineStatus = document.getElementById('engineStatus');
const enginePipe = document.getElementById('enginePipe');
const processMs = document.getElementById('processMs');
const faceCountEl = document.getElementById('faceCount');
const faceDetectMsEl = document.getElementById('faceDetectMs');
const meshPipe = document.getElementById('meshPipe');

let human = null;
let humanReady = false;
let faceDetectBusy = false;
let lastFaceDetect = 0;

const humanConfig = {
  backend: 'webgl',
  debug: false,
  modelBasePath: 'https://vladmandic.github.io/human-models/models/',
  cacheModels: true,
  face: {
    enabled: true,
    detector: { enabled: true, rotation: true, return: true, maxDetected: 1, minConfidence: 0.5 },
    mesh: { enabled: true },
    iris: { enabled: false },
    emotion: { enabled: false },
    description: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false }
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false }
};

async function initFaceEngine() {
  if (!window.Human?.Human) throw new Error('Human.js não carregou');
  human = new Human.Human(humanConfig);
  engineStatus.textContent = 'LOADING FACE';
  enginePipe.textContent = 'LOADING';
  await human.load();
  await human.warmup();
  humanReady = true;
  engineStatus.textContent = 'FACE ENGINE WEBGL';
  enginePipe.textContent = 'FACE DETECTOR';
}

function extractLandmarks(face) {
  const mesh = face?.mesh;
  if (!Array.isArray(mesh) || mesh.length < 10) return [];
  return mesh.map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.x), Number(p.y)])
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function smoothLandmarks(points) {
  if (!points.length) {
    smoothedLandmarks = [];
    return [];
  }
  const alpha = 0.34;
  if (smoothedLandmarks.length !== points.length) {
    smoothedLandmarks = points.map(p => p.slice());
    return smoothedLandmarks;
  }
  for (let n = 0; n < points.length; n++) {
    smoothedLandmarks[n][0] += (points[n][0] - smoothedLandmarks[n][0]) * alpha;
    smoothedLandmarks[n][1] += (points[n][1] - smoothedLandmarks[n][1]) * alpha;
  }
  return smoothedLandmarks;
}

function faceBounds(points) {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function warpFace(points) {
  const b = faceBounds(points);
  if (!b || b.w < 30 || b.h < 30) return false;

  // Mesh-free GPU-friendly warp: build a soft facial region from landmarks,
  // then apply a subtle center pull. This is the compositor foundation;
  // identity assets can be connected later without changing the tracker.
  const cx = (b.minX + b.maxX) * 0.5;
  const cy = (b.minY + b.maxY) * 0.5;
  const radiusX = b.w * 0.54;
  const radiusY = b.h * 0.58;

  compositorCtx.save();
  compositorCtx.globalCompositeOperation = 'source-over';
  compositorCtx.globalAlpha = 0.96;
  compositorCtx.drawImage(sourceFrame, 0, 0);
  compositorCtx.restore();

  // Soft facial mask. The actual source pixels remain intact outside the face.
  compositorCtx.save();
  const gradient = compositorCtx.createRadialGradient(cx, cy, Math.min(radiusX, radiusY) * 0.15, cx, cy, Math.max(radiusX, radiusY));
  gradient.addColorStop(0, 'rgba(255,255,255,0.055)');
  gradient.addColorStop(0.68, 'rgba(255,255,255,0.025)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  compositorCtx.fillStyle = gradient;
  compositorCtx.beginPath();
  compositorCtx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
  compositorCtx.fill();
  compositorCtx.restore();

  // Tracking contour gives us a stable deformation envelope without painting
  // diagnostic landmarks into the final frame.
  compositorCtx.save();
  compositorCtx.globalAlpha = 0.12;
  compositorCtx.strokeStyle = '#ffffff';
  compositorCtx.lineWidth = 2;
  compositorCtx.beginPath();
  compositorCtx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
  compositorCtx.stroke();
  compositorCtx.restore();
  return true;
}

function drawCompositor() {
  if (!compositorCtx) return;
  const now = performance.now();
  if (now - lastCompositorFrame < 33) {
    requestAnimationFrame(drawCompositor);
    return;
  }
  lastCompositorFrame = now;

  compositorCtx.clearRect(0, 0, compositor.width, compositor.height);
  compositorCtx.drawImage(sourceFrame, 0, 0);

  const face = latestFaces[0];
  const points = face ? smoothLandmarks(extractLandmarks(face)) : [];
  if (points.length >= 10 && warpFace(points)) {
    meshPipe.textContent = compositorMode + ' / WARP READY';
    remoteCtx.drawImage(compositor, 0, 0);
  } else {
    smoothedLandmarks = [];
    remoteCtx.drawImage(sourceFrame, 0, 0);
    meshPipe.textContent = 'SEARCHING';
  }
}
async function detectFaceFrame() {
  if (!humanReady || faceDetectBusy || !remote.width) return;
  const now = performance.now();
  if (now - lastFaceDetect < 66) return;
  lastFaceDetect = now;
  faceDetectBusy = true;
  const t0 = performance.now();
  try {
    const result = await human.detect(sourceFrame);
    const faces = Array.isArray(result?.face) ? result.face : [];
    const count = faces.length;
    latestFaces = faces;
    const ms = Number((performance.now() - t0).toFixed(2));
    faceCountEl.textContent = String(count);
    faceDetectMsEl.textContent = ms + ' ms';
    meshPipe.textContent = count ? 'LANDMARKS LIVE' : 'SEARCHING';
    engineStatus.textContent = count ? 'FACE-LANDMARKS' : 'FACE-SCAN';
    enginePipe.textContent = count ? 'LANDMARKS' : 'FACE DETECTOR';
    ws?.send(JSON.stringify({ type: 'faceResult', data: {
      faceCount: count,
      detectionMs: ms,
      backend: 'WEBGL'
    }}));
  } catch (err) {
    latestFaces = [];
    engineStatus.textContent = 'FACE ENGINE ERROR';
    meshPipe.textContent = 'ERROR';
  } finally {
    faceDetectBusy = false;
  }
}

let stream = null;
let facing = 'environment';
let ws = null;
let frameTimer = null;
let frameCount = 0;
let lastFps = performance.now();
let remoteBusy = false;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { alpha: false });

function setStatus(text, on = false) {
  status.textContent = text;
  status.classList.toggle('on', on);
}

function wsUrl() {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

function connect() {
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    setStatus('WSS ONLINE', true);
    engineStatus.textContent = 'FRAME BUFFER';
    enginePipe.textContent = 'BUFFER';
  };

  ws.onclose = () => {
    setStatus('WSS OFFLINE');
    setTimeout(connect, 1200);
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'remoteFrame') {
      if (remoteBusy) return;
      remoteBusy = true;
      try {
        const blob = await fetch(msg.data).then(r => r.blob());
        const bitmap = await createImageBitmap(blob);
        sourceFrameCtx.drawImage(bitmap, 0, 0, sourceFrame.width, sourceFrame.height);
        remoteCtx.drawImage(sourceFrame, 0, 0, remote.width, remote.height);
        bitmap.close();
        detectFaceFrame();
      } catch {}
      remoteBusy = false;
    }

    if (msg.type === 'hello' && msg.hasFrame) {
      engineStatus.textContent = 'FRAME BUFFER';
    }

    if (msg.type === 'camera-status') {
      engineStatus.textContent = msg.active ? 'CAMERA LIVE' : 'STANDBY';
    }
  };
}

async function pollEngine() {
  try {
    const r = await fetch('/api/engine', { cache: 'no-store' });
    const e = await r.json();
    engineStatus.textContent = e.engine || 'STANDBY';
    enginePipe.textContent = e.engine || 'BUFFER';
    processMs.textContent = e.processingMs != null ? e.processingMs + ' ms' : '—';
  } catch {}
}
setInterval(pollEngine, 500);
pollEngine();

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus('HTTPS NECESSÁRIO');
    alert('Abra esta página por HTTPS. No iPhone, use https://x.local:7777.');
    return;
  }

  try {
    if (stream) stopCamera(false);
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 20, max: 24 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    await new Promise(resolve => {
      if (video.readyState >= 1) resolve();
      else video.addEventListener('loadedmetadata', resolve, { once: true });
    });

    const vw = Math.max(2, video.videoWidth || 640);
    const vh = Math.max(2, video.videoHeight || 360);
    const scale = Math.min(1, 960 / Math.max(vw, vh));
    canvas.width = Math.max(2, Math.round(vw * scale));
    canvas.height = Math.max(2, Math.round(vh * scale));

    source.textContent = stream.getVideoTracks()[0]?.label || 'iPhone Camera';
    resolution.textContent = canvas.width + ' × ' + canvas.height + ' @ ~20 FPS';
    placeholder.style.display = 'none';
    start.disabled = true;
    stop.disabled = false;
    flip.disabled = false;
    setStatus('CAMERA + WSS', true);
    ws?.send(JSON.stringify({ type: 'startRemoteCam' }));

    clearInterval(frameTimer);
    frameTimer = setInterval(() => {
      if (!stream || !ws || ws.readyState !== WebSocket.OPEN) return;
      const qSize = ws.bufferedAmount || 0;
      if (qSize > 2500000) return;
      const quality = qSize > 1000000 ? 0.58 : (qSize > 350000 ? 0.68 : 0.8);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ws.send(JSON.stringify({
        type: 'webcamFrame',
        data: canvas.toDataURL('image/jpeg', quality)
      }));
      frameCount++;
      const now = performance.now();
      if (now - lastFps > 1000) {
        remoteFrames.textContent = String(frameCount);
        remoteFps.textContent = Math.round(frameCount * 1000 / (now - lastFps)) + ' FPS';
        frameCount = 0;
        lastFps = now;
      }
    }, 50);
  } catch (err) {
    setStatus('ERRO CAMERA');
    alert('Não foi possível abrir a câmera: ' + err.name + ' — ' + err.message);
  }
}

function stopCamera(notify = true) {
  clearInterval(frameTimer);
  frameTimer = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  placeholder.style.display = 'block';
  start.disabled = false;
  stop.disabled = true;
  flip.disabled = true;
  setStatus('WSS ONLINE', true);
  if (notify) ws?.send(JSON.stringify({ type: 'stopRemoteCam' }));
}

start.onclick = startCamera;
stop.onclick = () => stopCamera(true);
flip.onclick = () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  if (stream) startCamera();
};

requestAnimationFrame(drawCompositor);
connect();
initFaceEngine().catch(err => {
  console.error(err);
  engineStatus.textContent = 'FACE ENGINE OFFLINE';
  enginePipe.textContent = 'UNAVAILABLE';
});
