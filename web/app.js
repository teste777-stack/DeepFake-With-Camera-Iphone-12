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
let targetFace = null;
let targetLandmarks = [];
let targetMeshPoints = [];
let targetMeshTopology = [];
let targetBounds = null;
let targetDetectBusy = false;
let targetImage = null;
let targetCanvas = document.createElement('canvas');
let targetCtx = targetCanvas.getContext('2d', { alpha: false });
let compositorMode = 'TARGET READY';
let lastCompositorFrame = 0;
const remoteFps = document.getElementById('remoteFps');
const remoteFrames = document.getElementById('remoteFrames');
const engineStatus = document.getElementById('engineStatus');
const enginePipe = document.getElementById('enginePipe');
const processMs = document.getElementById('processMs');
const faceCountEl = document.getElementById('faceCount');
const faceDetectMsEl = document.getElementById('faceDetectMs');
const meshPipe = document.getElementById('meshPipe');
const targetInput = document.createElement('input');
targetInput.type = 'file';
targetInput.accept = 'image/*';
targetInput.style.display = 'none';
document.body.appendChild(targetInput);

const targetButton = document.createElement('button');
targetButton.textContent = 'LOAD TARGET';
targetButton.className = 'secondary';
targetButton.style.marginTop = '8px';
const controls = document.querySelector('.controls');
if (controls) controls.appendChild(targetButton);

targetButton.onclick = () => targetInput.click();
targetInput.onchange = async () => {
  const file = targetInput.files?.[0];
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    targetCanvas.width = remote.width;
    targetCanvas.height = remote.height;
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    const scale = Math.max(targetCanvas.width / bitmap.width, targetCanvas.height / bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    targetCtx.drawImage(bitmap, (targetCanvas.width - w) * 0.5, (targetCanvas.height - h) * 0.5, w, h);
    bitmap.close();
    targetImage = targetCtx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
    targetLandmarks = [];
    targetMeshPoints = [];
    targetMeshTopology = [];
    targetBounds = null;
    targetButton.textContent = 'TARGET / ANALYZING';
    meshPipe.textContent = 'ANALYZING TARGET';
    await detectTargetFace();
    if (targetLandmarks.length >= 10) {
      targetButton.textContent = 'TARGET FACE READY';
      meshPipe.textContent = 'TARGET FACE READY';
    } else {
      targetButton.textContent = 'TARGET FACE NOT FOUND';
      meshPipe.textContent = 'LOAD CLEAR FACE';
    }
  } catch {
    targetImage = null;
    targetLandmarks = [];
    targetMeshPoints = [];
    targetMeshTopology = [];
    targetBounds = null;
    targetButton.textContent = 'TARGET ERROR';
  }
};



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
  if (targetImage && !targetLandmarks.length) await detectTargetFace();
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

let meshTopology = null;
let meshTopologyKey = '';

function circumcircle(a, b, c) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-7) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r2 = (ux - ax) ** 2 + (uy - ay) ** 2;
  return [ux, uy, r2];
}

function buildDelaunay(points) {
  if (points.length < 3) return [];
  const pts = points.map((p, i) => [p[0], p[1], i]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  }
  const d = Math.max(maxX - minX, maxY - minY) * 20 + 1;
  const mx = (minX + maxX) * 0.5, my = (minY + maxY) * 0.5;
  const n = pts.length;
  pts.push([mx - d, my - d, n], [mx, my + d, n + 1], [mx + d, my - d, n + 2]);
  let tris = [[n, n + 1, n + 2]];

  for (let pi = 0; pi < n; pi++) {
    const p = pts[pi];
    const bad = [];
    for (let ti = 0; ti < tris.length; ti++) {
      const t = tris[ti], cc = circumcircle(pts[t[0]], pts[t[1]], pts[t[2]]);
      if (cc && (p[0] - cc[0]) ** 2 + (p[1] - cc[1]) ** 2 <= cc[2] + 0.01) bad.push(ti);
    }
    const edges = [];
    const edgeKey = (a,b) => a < b ? a + ':' + b : b + ':' + a;
    for (let bi = bad.length - 1; bi >= 0; bi--) {
      const t = tris.splice(bad[bi], 1)[0];
      [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]].forEach(edge => {
        const key = edgeKey(edge[0], edge[1]);
        const idx = edges.findIndex(x => x.key === key);
        if (idx >= 0) edges.splice(idx, 1); else edges.push({ key, edge });
      });
    }
    for (const item of edges) tris.push([item.edge[0], item.edge[1], pi]);
  }
  return tris
    .filter(t => t.every(i => i < n))
    .map(t => [t[0], t[1], t[2]]);
}

function regionInfluence(nx, ny, cx, cy, rx, ry) {
  const dx = (nx - cx) / Math.max(0.001, rx);
  const dy = (ny - cy) / Math.max(0.001, ry);
  return Math.exp(-(dx * dx + dy * dy) * 2.2);
}

function estimateExpressions(points, bounds) {
  const region = (cx, cy, rx, ry) => points.filter(p => {
    const x = (p[0] - bounds.minX) / Math.max(1, bounds.w);
    const y = (p[1] - bounds.minY) / Math.max(1, bounds.h);
    return Math.abs(x - cx) < rx && Math.abs(y - cy) < ry;
  });

  const eyeL = region(0.33, 0.39, 0.16, 0.10);
  const eyeR = region(0.67, 0.39, 0.16, 0.10);
  const mouthPts = region(0.50, 0.73, 0.22, 0.13);

  const spreadY = arr => {
    if (arr.length < 4) return 0;
    let min = Infinity, max = -Infinity;
    for (const p of arr) {
      const y = (p[1] - bounds.minY) / Math.max(1, bounds.h);
      min = Math.min(min, y); max = Math.max(max, y);
    }
    return Math.max(0, Math.min(1, (max - min - 0.025) / 0.11));
  };

  const spreadX = arr => {
    if (arr.length < 4) return 0;
    let min = Infinity, max = -Infinity;
    for (const p of arr) {
      const x = (p[0] - bounds.minX) / Math.max(1, bounds.w);
      min = Math.min(min, x); max = Math.max(max, x);
    }
    return Math.max(0, Math.min(1, (max - min - 0.10) / 0.28));
  };

  return {
    mouthOpen: spreadY(mouthPts),
    eyeOpen: (spreadY(eyeL) + spreadY(eyeR)) * 0.5,
    smile: spreadX(mouthPts)
  };
}

function destinationPoint(p, bounds, points, expressions) {
  const nx = (p[0] - bounds.minX) / Math.max(1, bounds.w);
  const ny = (p[1] - bounds.minY) / Math.max(1, bounds.h);

  let dx = 0;
  let dy = 0;

  const leftEye = regionInfluence(nx, ny, 0.33, 0.39, 0.19, 0.10);
  const rightEye = regionInfluence(nx, ny, 0.67, 0.39, 0.19, 0.10);
  const eyeGain = 0.65 + expressions.eyeOpen * 0.55;
  dx += (nx < 0.5 ? -1 : 1) * (leftEye + rightEye) * bounds.w * 0.018 * eyeGain;

  const nose = regionInfluence(nx, ny, 0.50, 0.53, 0.15, 0.20);
  dy -= nose * bounds.h * 0.012;

  const mouth = regionInfluence(nx, ny, 0.50, 0.73, 0.25, 0.12);
  const mouthGain = 0.7 + expressions.mouthOpen * 0.8;
  dx += (nx - 0.5) * mouth * bounds.w * (0.055 + expressions.smile * 0.045) * mouthGain;
  dy += (0.5 - ny) * mouth * bounds.h * (0.014 + expressions.mouthOpen * 0.018);

  const jawY = Math.max(0, (ny - 0.70) / 0.30);
  const jawSide = Math.abs(nx - 0.5) * 2;
  const jaw = jawY * jawSide;
  dx -= Math.sign(nx - 0.5) * jaw * bounds.w * 0.018;

  const envelope = Math.max(0, 1 - (((nx - 0.5) / 0.58) ** 2 + ((ny - 0.52) / 0.62) ** 2));
  dx += (nx - 0.5) * bounds.w * 0.012 * envelope;
  dy += (ny - 0.52) * bounds.h * 0.008 * envelope;

  return [p[0] + dx, p[1] + dy];
}
function warpTriangleImage(image, src, dst) {
  const [x0,y0] = src[0], [x1,y1] = src[1], [x2,y2] = src[2];
  const [u0,v0] = dst[0], [u1,v1] = dst[1], [u2,v2] = dst[2];
  const den = x0*(y1-y2) + x1*(y2-y0) + x2*(y0-y1);
  if (Math.abs(den) < 0.001) return;
  const a = (u0*(y1-y2)+u1*(y2-y0)+u2*(y0-y1))/den;
  const c = (u0*(x2-x1)+u1*(x0-x2)+u2*(x1-x0))/den;
  const e = u0 - a*x0 - c*y0;
  const b = (v0*(y1-y2)+v1*(y2-y0)+v2*(y0-y1))/den;
  const d = (v0*(x2-x1)+v1*(x0-x2)+v2*(x1-x0))/den;
  const f = v0 - b*x0 - d*y0;

  compositorCtx.save();
  compositorCtx.beginPath();
  compositorCtx.moveTo(u0,v0); compositorCtx.lineTo(u1,v1); compositorCtx.lineTo(u2,v2);
  compositorCtx.closePath();
  compositorCtx.clip();
  compositorCtx.setTransform(a,b,c,d,e,f);
  compositorCtx.drawImage(image, 0, 0);
  compositorCtx.restore();
}

async function detectTargetFace() {
  if (!humanReady || targetDetectBusy || !targetCanvas.width) return;
  targetDetectBusy = true;
  try {
    const result = await human.detect(targetCanvas);
    const faces = Array.isArray(result?.face) ? result.face : [];
    targetLandmarks = faces[0] ? extractLandmarks(faces[0]) : [];
    targetBounds = faceBounds(targetLandmarks);
    if (targetLandmarks.length >= 10 && targetBounds) {
      const step = targetLandmarks.length > 220 ? 4 : (targetLandmarks.length > 100 ? 2 : 1);
      targetMeshPoints = [];
      for (let n = 0; n < targetLandmarks.length; n += step) targetMeshPoints.push(targetLandmarks[n]);
      targetMeshTopology = buildDelaunay(targetMeshPoints);
    }
  } catch (err) {
    targetLandmarks = [];
    targetMeshPoints = [];
    targetMeshTopology = [];
    targetBounds = null;
  } finally {
    targetDetectBusy = false;
  }
}

function warpFace(points) {
  const b = faceBounds(points);
  if (!b || b.w < 30 || b.h < 30) return false;

  // The real swap path uses corresponding facial landmarks:
  // target-image triangles are warped into the live face pose.
  // This keeps eyes, mouth and jaw aligned to the tracked expression.
  compositorCtx.clearRect(0, 0, compositor.width, compositor.height);
  compositorCtx.drawImage(sourceFrame, 0, 0);

  if (targetImage && targetLandmarks.length >= 10 && targetMeshPoints.length >= 12 && targetMeshTopology.length) {
    const liveBounds = b;
    const liveStep = targetLandmarks.length > 220 ? 4 : (targetLandmarks.length > 100 ? 2 : 1);
    const liveMeshPoints = [];
    for (let n = 0; n < points.length; n += liveStep) liveMeshPoints.push(points[n]);
    if (liveMeshPoints.length !== targetMeshPoints.length) return false;

    compositorCtx.save();
    compositorCtx.globalAlpha = 0.98;
    compositorCtx.beginPath();
    const cx = (liveBounds.minX + liveBounds.maxX) * 0.5;
    const cy = (liveBounds.minY + liveBounds.maxY) * 0.5;
    compositorCtx.ellipse(cx, cy, liveBounds.w * 0.57, liveBounds.h * 0.62, 0, 0, Math.PI * 2);
    compositorCtx.clip();

    for (const tri of targetMeshTopology) {
      const src = tri.map(i => targetMeshPoints[i]);
      const dst = tri.map(i => liveMeshPoints[i]);
      warpTriangleImage(targetCanvas, src, dst);
    }
    compositorCtx.restore();

    // Softly reintroduce the live edge to reduce the hard cut around cheeks/jaw.
    compositorCtx.save();
    compositorCtx.globalCompositeOperation = 'destination-in';
    const gradient = compositorCtx.createRadialGradient(cx, cy, Math.min(liveBounds.w, liveBounds.h) * 0.30,
      cx, cy, Math.max(liveBounds.w, liveBounds.h) * 0.66);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.78, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    compositorCtx.fillStyle = gradient;
    compositorCtx.fillRect(liveBounds.minX - liveBounds.w * 0.15, liveBounds.minY - liveBounds.h * 0.15,
      liveBounds.w * 1.30, liveBounds.h * 1.30);
    compositorCtx.restore();
  } else {
    for (const tri of meshTopology) {
      const src = tri.map(i => meshPoints[i]);
      const dst = src.map(p => destinationPoint(p, b, points, expressions));
      warpTriangleImage(sourceFrame, src, dst);
    }
  }

  compositorCtx.save();
  compositorCtx.globalAlpha = 0.08;
  compositorCtx.strokeStyle = '#ffffff';
  compositorCtx.lineWidth = 1;
  for (const tri of meshTopology) {
    const p0 = destinationPoint(meshPoints[tri[0]], b, points, expressions);
    const p1 = destinationPoint(meshPoints[tri[1]], b, points, expressions);
    const p2 = destinationPoint(meshPoints[tri[2]], b, points, expressions);
    compositorCtx.beginPath();
    compositorCtx.moveTo(p0[0],p0[1]); compositorCtx.lineTo(p1[0],p1[1]); compositorCtx.lineTo(p2[0],p2[1]);
    compositorCtx.closePath();
    compositorCtx.stroke();
  }
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
    meshPipe.textContent = targetImage && targetLandmarks.length ? 'FACE SWAP / LANDMARK WARP' : compositorMode + ' / WARP READY';
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
