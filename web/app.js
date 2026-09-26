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
const compositorCtx = compositor.getContext('2d', { alpha: true });
const swapLayer = document.createElement('canvas');
swapLayer.width = remote.width;
swapLayer.height = remote.height;
const swapCtx = swapLayer.getContext('2d', { alpha: true });
let latestFaces = [];
let smoothedLandmarks = [];
let targetLandmarks = [];
let targetMeshPoints = [];
let targetMeshTopology = [];
let targetBounds = null;
let targetDetectBusy = false;
let targetImage = null;
let targetCanvas = document.createElement('canvas');
let targetCtx = targetCanvas.getContext('2d', { alpha: true });
const swapMask = document.createElement('canvas');
swapMask.width = remote.width;
swapMask.height = remote.height;
const swapMaskCtx = swapMask.getContext('2d', { alpha: true });
let compositorMode = 'TARGET READY';
let syntheticIdentity = null;
let identityReady = false;
let faceTrackingReady = false;
let lastValidFaceAt = 0;
const faceTrackingGraceMs = 180;
let lastCompositorFrame = 0;
let syntheticMeshKey = '';
let syntheticCanonicalLandmarks = [];
const remoteFps = document.getElementById('remoteFps');
const remoteFrames = document.getElementById('remoteFrames');
const engineStatus = document.getElementById('engineStatus');
const enginePipe = document.getElementById('enginePipe');
const processMs = document.getElementById('processMs');
const faceCountEl = document.getElementById('faceCount');
const faceDetectMsEl = document.getElementById('faceDetectMs');
const meshPipe = document.getElementById('meshPipe');
const seedInput = document.getElementById('seedInput');
const generateFaceButton = document.getElementById('generateFace');
const randomFaceButton = document.getElementById('randomFace');
const identityStatus = document.getElementById('identityStatus');
const testImageInput = document.getElementById('testImageInput');
const testImageButton = document.getElementById('testImageButton');
const clearTestImageButton = document.getElementById('clearTestImage');
const testImageStatus = document.getElementById('testImageStatus');
let testImageActive = false;

function seededRandom(seed) {
  let x = (Number(seed) >>> 0) || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) / 4294967296);
  };
}

async function generateSyntheticFace(seed) {
  const rand = seededRandom(seed);
  const c = targetCanvas, ctx = targetCtx;
  c.width = remote.width;
  c.height = remote.height;
  ctx.clearRect(0, 0, c.width, c.height);

  const skin = ['#e6ad88','#c98763','#efbd98','#a96548','#d99b73'][Math.floor(rand() * 5)];
  const skinShadow = ['#7d4638','#6b392f','#8b5140','#60352d'][Math.floor(rand() * 4)];
  const hair = ['#15110f','#2b211d','#3a2720','#11151b','#4a3024'][Math.floor(rand() * 5)];
  const eye = ['#24160f','#3b2a1c','#536b61','#2f4058'][Math.floor(rand() * 4)];
  const faceW = 154 + rand() * 62;
  const faceH = 210 + rand() * 52;
  const cx = c.width * 0.5 + (rand() - 0.5) * 12;
  const cy = c.height * 0.51;
  const eyeY = cy - faceH * 0.105;
  const eyeGap = faceW * (0.185 + rand() * 0.035);
  const mouthW = faceW * (0.27 + rand() * 0.10);
  const jaw = 0.94 + rand() * 0.12;
  const identityGeometry = { cx, cy, faceW, faceH };

  // Fully generated identity: no PNG, photo or external reference.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(jaw, 1);
  ctx.translate(-cx, -cy);

  // Ears and neck provide a larger, more coherent silhouette.
  ctx.fillStyle = skinShadow;
  ctx.beginPath();
  ctx.ellipse(cx - faceW * 0.49, cy + faceH * 0.02, faceW * 0.10, faceH * 0.17, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + faceW * 0.49, cy + faceH * 0.02, faceW * 0.10, faceH * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = skin;
  ctx.fillRect(cx - faceW * 0.19, cy + faceH * 0.38, faceW * 0.38, faceH * 0.34);

  ctx.beginPath();
  ctx.ellipse(cx, cy, faceW * 0.5, faceH * 0.5, 0, 0, Math.PI * 2);
  const sg = ctx.createRadialGradient(cx - faceW * 0.18, cy - faceH * 0.22, 8, cx, cy, faceW * 0.67);
  sg.addColorStop(0, '#f4c9a7');
  sg.addColorStop(0.34, skin);
  sg.addColorStop(0.82, skin);
  sg.addColorStop(1, skinShadow);
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.clip();

  // Hair cap and side mass.
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(cx, cy - faceH * 0.43, faceW * 0.59, faceH * 0.34, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - faceW * 0.57, cy - faceH * 0.43, faceW * 0.15, faceH * 0.30);
  ctx.fillRect(cx + faceW * 0.42, cy - faceH * 0.43, faceW * 0.15, faceH * 0.30);

  // Brows, eyelids and irises.
  const browTilt = (rand() - 0.5) * 0.10;
  ctx.strokeStyle = '#3b241d';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const ex = cx + side * eyeGap;
    ctx.beginPath();
    ctx.moveTo(ex - faceW * 0.105, eyeY - faceH * (0.078 + browTilt * side));
    ctx.lineTo(ex + faceW * 0.105, eyeY - faceH * (0.078 - browTilt * side));
    ctx.stroke();

    ctx.fillStyle = '#f7f0e8';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, faceW * 0.105, faceH * 0.043, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.arc(ex, eyeY, Math.max(5, faceW * 0.038), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.arc(ex, eyeY, Math.max(2, faceW * 0.018), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath();
    ctx.arc(ex - faceW * 0.012, eyeY - faceH * 0.012, Math.max(1.5, faceW * 0.009), 0, Math.PI * 2);
    ctx.fill();
  }

  // Nose bridge, tip and subtle cheek planes.
  ctx.strokeStyle = 'rgba(95,49,38,.72)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + faceH * 0.04);
  ctx.quadraticCurveTo(cx - faceW * 0.035, cy + faceH * 0.02, cx - faceW * 0.012, cy + faceH * 0.12);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,205,170,.28)';
  ctx.beginPath();
  ctx.ellipse(cx - faceW * 0.20, cy + faceH * 0.04, faceW * 0.17, faceH * 0.12, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + faceW * 0.20, cy + faceH * 0.04, faceW * 0.17, faceH * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lips with a dark separation line.
  ctx.fillStyle = '#a6534d';
  ctx.beginPath();
  ctx.ellipse(cx, cy + faceH * 0.235, mouthW * 0.50, faceH * 0.043, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#351719';
  ctx.beginPath();
  ctx.ellipse(cx, cy + faceH * 0.235, mouthW * 0.42, faceH * 0.014, 0, 0, Math.PI * 2);
  ctx.fill();

  // Small deterministic skin highlights/freckles add identity variation.
  ctx.fillStyle = 'rgba(90,48,38,.22)';
  for (let i = 0; i < 22; i++) {
    const fx = cx + (rand() - 0.5) * faceW * 0.62;
    const fy = cy + (rand() - 0.5) * faceH * 0.52;
    ctx.beginPath();
    ctx.arc(fx, fy, 0.7 + rand() * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  targetImage = targetCtx.getImageData(0, 0, c.width, c.height);
  targetLandmarks = [];
  targetMeshPoints = [];
  targetMeshTopology = [];
  targetBounds = null;
  syntheticCanonicalLandmarks = [];
  syntheticIdentity = { seed: Number(seed) >>> 0, geometry: identityGeometry };
  syntheticMeshKey = '';
  identityReady = true;
  identityStatus.textContent = 'GENERATED IDENTITY READY / SEED ' + syntheticIdentity.seed;
  meshPipe.textContent = 'GENERATED FACE / TRACKING READY';

  if (humanReady) {
    await detectTargetFace();
    if (targetMeshPoints.length >= 12 && targetMeshTopology.length) {
      meshPipe.textContent = 'GENERATED IDENTITY MESH READY';
      identityStatus.textContent = 'GENERATED IDENTITY READY / MESH';
    } else {
      meshPipe.textContent = 'GENERATED IDENTITY / LIVE MESH';
    }
  }
  engineStatus.textContent = 'GENERATED IDENTITY READY';
  enginePipe.textContent = 'GENERATED IDENTITY';
}
async function loadTestImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(remote.width / bitmap.width, remote.height / bitmap.height);
    const drawW = Math.max(1, Math.round(bitmap.width * scale));
    const drawH = Math.max(1, Math.round(bitmap.height * scale));
    sourceFrameCtx.fillStyle = '#000';
    sourceFrameCtx.fillRect(0, 0, sourceFrame.width, sourceFrame.height);
    sourceFrameCtx.drawImage(bitmap, (sourceFrame.width - drawW) * 0.5, (sourceFrame.height - drawH) * 0.5, drawW, drawH);
    bitmap.close();

    testImageActive = true;
    testImageButton.disabled = true;
    clearTestImageButton.disabled = false;
    start.disabled = true;
    flip.disabled = true;
    testImageStatus.textContent = 'ANALYZING IMAGE...';
    source.textContent = file.name;
    resolution.textContent = sourceFrame.width + ' × ' + sourceFrame.height + ' / TEST IMAGE';
    placeholder.style.display = 'none';
    resetCompositorState(false);

    if (!humanReady) {
      testImageStatus.textContent = 'WAITING FACE ENGINE...';
      await initFaceEngine();
    }
    await detectFaceFrame();
    const points = latestFaces[0] ? extractLandmarks(latestFaces[0]) : [];
    if (points.length >= 10) {
      testImageStatus.textContent = 'FACE DETECTED / ' + points.length + ' POINTS';
      engineStatus.textContent = identityReady ? 'TEST IMAGE / FACE SWAP' : 'TEST IMAGE / FACE DETECTED';
      enginePipe.textContent = identityReady ? 'TEST TRACK + COMPOSITE' : 'TEST FACE DETECTOR';
      meshPipe.textContent = identityReady ? 'TEST IMAGE / READY FOR SWAP' : 'TEST IMAGE / FACE DETECTED';
    } else {
      testImageStatus.textContent = 'NO USABLE FACE DETECTED';
      meshPipe.textContent = 'TEST IMAGE / NO TRACK';
    }
  } catch (err) {
    console.error(err);
    testImageStatus.textContent = 'IMAGE ERROR';
    engineStatus.textContent = 'TEST IMAGE ERROR';
  }
}

testImageButton?.addEventListener('click', () => testImageInput?.click());
testImageInput?.addEventListener('change', () => {
  const file = testImageInput.files?.[0];
  loadTestImage(file);
});

clearTestImageButton?.addEventListener('click', () => {
  testImageActive = false;
  testImageInput.value = '';
  testImageButton.disabled = false;
  clearTestImageButton.disabled = true;
  testImageStatus.textContent = 'NO TEST IMAGE';
  source.textContent = '—';
  resolution.textContent = '—';
  placeholder.style.display = 'block';
  resetCompositorState(true);
  engineStatus.textContent = 'FACE ENGINE WEBGL';
  enginePipe.textContent = 'FACE DETECTOR';
  meshPipe.textContent = 'NEXT';
});

generateFaceButton?.addEventListener('click', () => generateSyntheticFace(seedInput.value));
randomFaceButton?.addEventListener('click', () => {
  const seed = Math.floor(Math.random()*2147483647);
  seedInput.value = String(seed);
  generateSyntheticFace(seed);
});


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
    detector: { enabled: true, rotation: true, return: true, maxDetected: 1, minConfidence: 0.18, minSize: 24, scale: 1.35 },
    mesh: { enabled: true, keepInvalid: true },
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
  if (!syntheticIdentity) {
    await generateSyntheticFace(seedInput?.value || 184729);
  }
  engineStatus.textContent = 'FACE ENGINE WEBGL';
  if (targetImage && !targetLandmarks.length) {
    await detectTargetFace();
    if (syntheticIdentity && targetMeshPoints.length) {
      meshPipe.textContent = 'SYNTHETIC TARGET MESH READY';
      identityStatus.textContent = 'SYNTHETIC IDENTITY READY / TARGET MESH';
    }
  }
  enginePipe.textContent = 'FACE DETECTOR';
}

function extractLandmarks(face) {
  const frameW = Math.max(1, sourceFrame.width || remote.width);
  const frameH = Math.max(1, sourceFrame.height || remote.height);
  const mesh = Array.isArray(face?.mesh) ? face.mesh : [];
  let points = mesh.map(p => Array.isArray(p)
    ? [Number(p[0]), Number(p[1])]
    : [Number(p?.x), Number(p?.y)])
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));

  // Human may expose mesh coordinates normalized to 0..1. The compositor works
  // in source-canvas pixels, so convert normalized coordinates before tracking.
  if (points.length >= 10) {
    const maxX = Math.max(...points.map(p => p[0]));
    const maxY = Math.max(...points.map(p => p[1]));
    const minX = Math.min(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1]));
    if (maxX <= 1.5 && maxY <= 1.5 && minX >= -0.5 && minY >= -0.5) {
      points = points.map(([x, y]) => [x * frameW, y * frameH]);
    }
    const bounds = faceBounds(points);
    if (bounds && bounds.w >= 30 && bounds.h >= 30) return points;
  }

  // Human can keep a detector result even when FaceMesh rejects the sample.
  // Use the detected face box as a stable fallback so the synthetic identity
  // can still be positioned while the detailed mesh recovers.
  const box = Array.isArray(face?.box) ? face.box : null;
  if (!box || box.length < 4) return [];
  let [x, y, w, h] = box.map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return [];

  // Detector boxes can also be normalized. Convert them into source pixels.
  if (Math.abs(x) <= 1.5 && Math.abs(y) <= 1.5 && w <= 1.5 && h <= 1.5) {
    x *= frameW;
    y *= frameH;
    w *= frameW;
    h *= frameH;
  }
  if (w < 24 || h < 24) return [];

  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const rx = w * 0.5;
  const ry = h * 0.5;
  const pointsFallback = [];
  const count = 32;
  for (let n = 0; n < count; n++) {
    const a = (n / count) * Math.PI * 2;
    pointsFallback.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pointsFallback;
}

function landmarkJumpTooLarge(points) {
  if (!smoothedLandmarks.length || smoothedLandmarks.length !== points.length) return false;

  let sum = 0;
  let count = 0;
  for (let n = 0; n < points.length; n++) {
    const dx = points[n][0] - smoothedLandmarks[n][0];
    const dy = points[n][1] - smoothedLandmarks[n][1];
    sum += Math.hypot(dx, dy);
    count++;
  }

  if (!count) return false;
  const bounds = faceBounds(points);
  const reference = Math.max(30, bounds?.w || 30, bounds?.h || 30);
  const meanJump = sum / count;

  // A whole-face movement can legitimately be large, so use a relative
  // threshold. Sudden multi-face-width mesh jumps are treated as a bad sample.
  return meanJump > reference * 0.34;
}

function smoothLandmarks(points) {
  if (!points.length) return smoothedLandmarks;

  if (landmarkJumpTooLarge(points)) {
    lastValidFaceAt = performance.now();
    return smoothedLandmarks;
  }

  if (smoothedLandmarks.length !== points.length) {
    smoothedLandmarks = points.map(p => p.slice());
    return smoothedLandmarks;
  }

  // Adaptive temporal smoothing: slow movements stay stable, while faster
  // movements get a higher response so the synthetic face does not visibly
  // lag behind the real subject.
  let sumJump = 0;
  for (let n = 0; n < points.length; n++) {
    sumJump += Math.hypot(
      points[n][0] - smoothedLandmarks[n][0],
      points[n][1] - smoothedLandmarks[n][1]
    );
  }
  const meanJump = sumJump / points.length;
  const bounds = faceBounds(points);
  const reference = Math.max(30, bounds?.w || 30, bounds?.h || 30);
  const movement = Math.min(1, meanJump / (reference * 0.18));
  const alpha = 0.28 + movement * 0.34;

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
function warpTriangleImage(ctx, image, src, dst) {
  const [x0,y0] = src[0], [x1,y1] = src[1], [x2,y2] = src[2];
  const [u0,v0] = dst[0], [u1,v1] = dst[1], [u2,v2] = dst[2];
  const den = x0*(y1-y2) + x1*(y2-y0) + x2*(y0-y1);
  if (Math.abs(den) < 0.001) return;

  const a = (u0*(y1-y2)+u1*(y2-y0)+u2*(y0-y1))/den;
  const c = (u0*(x2-x1)+u1*(x0-x2)+u2*(x1-x0))/den;
  const b = (v0*(y1-y2)+v1*(y2-y0)+v2*(y0-y1))/den;
  const d = (v0*(x2-x1)+v1*(x0-x2)+v2*(x1-x0))/den;

  // Draw only the source triangle's small bounding box instead of the entire
  // 640x360 target canvas for every triangle. This keeps the affine math the
  // same while dramatically reducing texture sampling and canvas work.
  const pad = 1;
  const sx = Math.max(0, Math.floor(Math.min(x0, x1, x2) - pad));
  const sy = Math.max(0, Math.floor(Math.min(y0, y1, y2) - pad));
  const ex = Math.min(image.width, Math.ceil(Math.max(x0, x1, x2) + pad));
  const ey = Math.min(image.height, Math.ceil(Math.max(y0, y1, y2) + pad));
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw < 1 || sh < 1) return;

  // After cropping the source, translate the affine transform so local
  // crop coordinates still map to the original destination coordinates.
  const e = u0 - a*x0 - c*y0 + a*sx + c*sy;
  const f = v0 - b*x0 - d*y0 + b*sx + d*sy;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(u0,v0); ctx.lineTo(u1,v1); ctx.lineTo(u2,v2);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a,b,c,d,e,f);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();
}

async function detectTargetFace() {
  if (!humanReady || targetDetectBusy || !targetCanvas.width) return;
  targetDetectBusy = true;

  // Never keep mesh data from a previous target/detection attempt.
  // Otherwise a failed detection can leave a stale topology that is later
  // paired with a new synthetic target or manual image.
  targetLandmarks = [];
  targetMeshPoints = [];
  targetMeshTopology = [];
  targetBounds = null;

  try {
    const result = await human.detect(targetCanvas);
    const faces = Array.isArray(result?.face) ? result.face : [];
    targetLandmarks = faces[0] ? extractLandmarks(faces[0]) : [];
    targetBounds = faceBounds(targetLandmarks);

    if (targetLandmarks.length >= 10 && targetBounds) {
      const step = getMeshStep(targetLandmarks.length);
      for (let n = 0; n < targetLandmarks.length; n += step) {
        targetMeshPoints.push(targetLandmarks[n]);
      }
      targetMeshTopology = buildDelaunay(targetMeshPoints);
    }
  } catch (err) {
    // The cleared state above intentionally leaves the compositor free to
    // use its synthetic/live-mesh fallback when appropriate.
  } finally {
    targetDetectBusy = false;
  }
}

function resetCompositorState(clearSource = false) {
  latestFaces = [];
  smoothedLandmarks = [];
  faceTrackingReady = false;
  lastValidFaceAt = 0;

  compositorCtx.setTransform(1, 0, 0, 1, 0, 0);
  compositorCtx.clearRect(0, 0, compositor.width, compositor.height);
  swapCtx.setTransform(1, 0, 0, 1, 0, 0);
  swapCtx.clearRect(0, 0, swapLayer.width, swapLayer.height);
  swapMaskCtx.setTransform(1, 0, 0, 1, 0, 0);
  swapMaskCtx.clearRect(0, 0, swapMask.width, swapMask.height);

  if (clearSource) {
    sourceFrameCtx.setTransform(1, 0, 0, 1, 0, 0);
    sourceFrameCtx.clearRect(0, 0, sourceFrame.width, sourceFrame.height);
    remoteCtx.setTransform(1, 0, 0, 1, 0, 0);
    remoteCtx.clearRect(0, 0, remote.width, remote.height);
  }
}

function convexHull(points) {
  if (points.length < 3) return points.slice();

  const sorted = points
    .map(p => [p[0], p[1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) -
    (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let n = sorted.length - 1; n >= 0; n--) {
    const p = sorted[n];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function updateSwapMask(points, faceW, faceH) {
  if (!swapMaskCtx || points.length < 3) return;
  swapMaskCtx.setTransform(1, 0, 0, 1, 0, 0);
  swapMaskCtx.clearRect(0, 0, swapMask.width, swapMask.height);

  // Follow the detected facial silhouette instead of a generic ellipse.
  // This keeps hair/background outside the replacement region and makes the
  // feather track jaw and cheek geometry more closely.
  const hull = convexHull(points);
  if (hull.length < 3) return;

  const feather = Math.max(2, Math.min(8, Math.round(Math.min(faceW, faceH) * 0.018)));

  swapMaskCtx.save();
  swapMaskCtx.beginPath();
  swapMaskCtx.moveTo(hull[0][0], hull[0][1]);
  for (let n = 1; n < hull.length; n++) {
    swapMaskCtx.lineTo(hull[n][0], hull[n][1]);
  }
  swapMaskCtx.closePath();
  swapMaskCtx.fillStyle = '#fff';
  swapMaskCtx.filter = `blur(${feather}px)`;
  swapMaskCtx.fill();
  swapMaskCtx.restore();

  // Restore an opaque inner silhouette after feathering so the face center
  // does not become translucent while only the perimeter is softened.
  swapMaskCtx.save();
  swapMaskCtx.beginPath();
  swapMaskCtx.moveTo(hull[0][0], hull[0][1]);
  for (let n = 1; n < hull.length; n++) {
    swapMaskCtx.lineTo(hull[n][0], hull[n][1]);
  }
  swapMaskCtx.closePath();
  swapMaskCtx.fillStyle = 'rgba(255,255,255,0.98)';
  swapMaskCtx.fill();
  swapMaskCtx.restore();
}

function getMeshStep(count) {
  // Keep enough facial detail while preventing hundreds of full-canvas
  // affine draw calls on every compositor frame.
  if (count > 360) return 6;
  if (count > 220) return 4;
  if (count > 120) return 3;
  return 2;
}

function buildSyntheticTarget(points) {
  if (!syntheticIdentity || !points.length) return false;
  const liveBounds = faceBounds(points);
  if (!liveBounds || liveBounds.w < 30 || liveBounds.h < 30) return false;

  const g = syntheticIdentity.geometry;
  const sx = Math.max(80, g.faceW);
  const sy = Math.max(110, g.faceH);

  // Build the synthetic identity geometry only once per generated seed.
  // The source mesh stays stable while the destination mesh follows the
  // live face. The first live sample is used only to capture facial shape,
  // not to lock its camera rotation into the synthetic identity.
  if (!syntheticCanonicalLandmarks.length || syntheticCanonicalLandmarks.length !== points.length) {
    const liveCx = (liveBounds.minX + liveBounds.maxX) * 0.5;
    const liveCy = (liveBounds.minY + liveBounds.maxY) * 0.5;
    const liveTilt = estimateFaceTilt(points);
    const cos = Math.cos(-liveTilt);
    const sin = Math.sin(-liveTilt);

    syntheticCanonicalLandmarks = points.map(([x, y]) => {
      // Normalize around the live face center, remove the initial roll, then
      // fit the result into the generated identity's stable coordinate frame.
      // This prevents a tilted first frame from permanently skewing the
      // synthetic source mesh and makes later scale/roll changes follow the
      // current tracked face instead.
      const dx = (x - liveCx) / Math.max(1, liveBounds.w);
      const dy = (y - liveCy) / Math.max(1, liveBounds.h);
      const nx = Math.max(-0.5, Math.min(0.5, dx * cos - dy * sin)) + 0.5;
      const ny = Math.max(-0.5, Math.min(0.5, dx * sin + dy * cos)) + 0.5;

      return [
        g.cx - sx * 0.5 + nx * sx,
        g.cy - sy * 0.5 + ny * sy
      ];
    });

    targetLandmarks = syntheticCanonicalLandmarks.map(p => p.slice());
    targetBounds = faceBounds(targetLandmarks);

    const step = getMeshStep(targetLandmarks.length);
    targetMeshPoints = [];
    for (let n = 0; n < targetLandmarks.length; n += step) {
      targetMeshPoints.push(targetLandmarks[n]);
    }

    const meshKey = syntheticIdentity.seed + ':' + targetMeshPoints.length;
    targetMeshTopology = buildDelaunay(targetMeshPoints);
    syntheticMeshKey = meshKey;
  }

  return targetMeshPoints.length >= 12 && targetMeshTopology.length > 0;
}

function estimateFaceTilt(points) {
  if (points.length < 8) return 0;

  let cx = 0, cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;

  let xx = 0, xy = 0, yy = 0;
  for (const [x, y] of points) {
    const dx = x - cx;
    const dy = y - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  // PCA returns the major axis. The face is normally taller than wide, so
  // convert that axis to the rotation expected by ellipse() for its vertical
  // radius. Clamp extreme estimates to avoid reacting to malformed meshes.
  const tilt = angle - Math.PI * 0.5;
  return Math.max(-0.55, Math.min(0.55, tilt));
}

function warpFace(points) {
  const b = faceBounds(points);
  if (!b || b.w < 30 || b.h < 30) return false;

  const hasSynthetic = !!syntheticIdentity;
  const hasManualTarget = !hasSynthetic &&
    !!targetImage &&
    targetMeshPoints.length >= 12 &&
    targetMeshTopology.length > 0;

  if (hasSynthetic && (!targetMeshPoints.length || !targetMeshTopology.length)) {
    buildSyntheticTarget(points);
  }

  if (!hasSynthetic && !hasManualTarget) return false;

  compositorCtx.clearRect(0, 0, compositor.width, compositor.height);
  compositorCtx.drawImage(sourceFrame, 0, 0);

  swapCtx.setTransform(1, 0, 0, 1, 0, 0);
  swapCtx.clearRect(0, 0, swapLayer.width, swapLayer.height);

  const cx = (b.minX + b.maxX) * 0.5;
  const cy = (b.minY + b.maxY) * 0.5;
  const faceTilt = estimateFaceTilt(points);

  // Always keep a real synthetic-face render path. The mesh warp is preferred,
  // but a failed/mismatched mesh must not result in "no generated face".
  // This fallback scales the generated identity into the tracked face and
  // follows its rotation, so the user still gets a visible identity.
  const liveStep = getMeshStep(points.length);
  const liveMeshPoints = [];
  for (let n = 0; n < points.length; n += liveStep) liveMeshPoints.push(points[n]);

  const meshReady =
    targetMeshPoints.length >= 12 &&
    targetMeshTopology.length > 0 &&
    liveMeshPoints.length === targetMeshPoints.length;

  swapCtx.save();
  swapCtx.translate(cx, cy);
  swapCtx.rotate(faceTilt);

  if (hasSynthetic && targetCanvas.width && targetCanvas.height) {
    // Synthetic identities are rendered directly from their generated pixels.
    // Do not require Human.js to detect the procedural face: Human.js only
    // needs to track the real face that will receive the generated identity.
    const targetW = syntheticIdentity?.geometry?.faceW || Math.max(120, b.w);
    const targetH = syntheticIdentity?.geometry?.faceH || Math.max(170, b.h);
    const drawW = b.w * 1.18;
    const drawH = b.h * 1.30;

    // A subtle inner shadow makes the generated silhouette read as a face
    // instead of a flat sticker while preserving the generated skin details.
    swapCtx.save();
    swapCtx.beginPath();
    swapCtx.ellipse(0, 0, drawW * 0.49, drawH * 0.49, 0, 0, Math.PI * 2);
    swapCtx.clip();

    swapCtx.drawImage(
      targetCanvas,
      syntheticIdentity?.geometry?.cx - targetW * 0.5,
      syntheticIdentity?.geometry?.cy - targetH * 0.5,
      targetW,
      targetH,
      -drawW * 0.5,
      -drawH * 0.5,
      drawW,
      drawH
    );

    const shade = swapCtx.createRadialGradient(
      -drawW * 0.16, -drawH * 0.20, drawW * 0.04,
      0, 0, drawW * 0.72
    );
    shade.addColorStop(0, 'rgba(255,255,255,0.08)');
    shade.addColorStop(0.62, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.16)');
    swapCtx.fillStyle = shade;
    swapCtx.fillRect(-drawW * 0.5, -drawH * 0.5, drawW, drawH);
    swapCtx.restore();
  } else if (meshReady) {
    // Manual reference images keep the landmark/Delaunay warp path.
    swapCtx.translate(-cx, -cy);
    swapCtx.beginPath();
    swapCtx.ellipse(cx, cy, b.w * 0.58, b.h * 0.64, 0, 0, Math.PI * 2);
    swapCtx.clip();

    for (const tri of targetMeshTopology) {
      const src = tri.map(i => targetMeshPoints[i]);
      const dst = tri.map(i => liveMeshPoints[i]);
      warpTriangleImage(swapCtx, targetCanvas, src, dst);
    }
  } else {
    swapCtx.restore();
    return false;
  }

  swapCtx.restore();

  // Synthetic identities use a stable oval mask; manual references keep the
  // tracked landmark hull. This prevents a procedural face from disappearing
  // when its own synthetic landmarks are not detectable.
  if (hasSynthetic) {
    swapMaskCtx.setTransform(1, 0, 0, 1, 0, 0);
    swapMaskCtx.clearRect(0, 0, swapMask.width, swapMask.height);
    swapMaskCtx.save();
    swapMaskCtx.translate(cx, cy);
    swapMaskCtx.rotate(faceTilt);
    const maskRx = b.w * 0.59;
    const maskRy = b.h * 0.67;
    const maskFeather = Math.max(2, Math.min(10, Math.round(Math.min(b.w, b.h) * 0.025)));
    swapMaskCtx.beginPath();
    swapMaskCtx.ellipse(0, 0, maskRx, maskRy, 0, 0, Math.PI * 2);
    swapMaskCtx.closePath();
    swapMaskCtx.fillStyle = '#fff';
    swapMaskCtx.filter = `blur(${maskFeather}px)`;
    swapMaskCtx.fill();
    swapMaskCtx.restore();
  } else {
    updateSwapMask(points, b.w, b.h);
  }

  swapCtx.globalCompositeOperation = 'destination-in';
  swapCtx.drawImage(swapMask, 0, 0);
  swapCtx.globalCompositeOperation = 'source-over';

  compositorCtx.save();
  compositorCtx.globalAlpha = 0.98;
  compositorCtx.drawImage(swapLayer, 0, 0);
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
  const trackedPoints = face ? extractLandmarks(face) : [];
  const nowTracking = performance.now();
  const points = trackedPoints.length >= 10
    ? smoothLandmarks(trackedPoints)
    : ((nowTracking - lastValidFaceAt) <= faceTrackingGraceMs ? smoothedLandmarks : []);
  if (points.length >= 10 && warpFace(points)) {
    if (syntheticIdentity) {
      meshPipe.textContent = 'FACE SWAP ACTIVE / SYNTHETIC IDENTITY';
      engineStatus.textContent = 'FACE SWAP ACTIVE';
      enginePipe.textContent = 'TRACK + COMPOSITE';
    } else {
      meshPipe.textContent = targetImage && targetLandmarks.length ? 'FACE SWAP / LANDMARK WARP' : compositorMode + ' / WARP READY';
    }
    remoteCtx.drawImage(compositor, 0, 0);
  } else {
    remoteCtx.drawImage(sourceFrame, 0, 0);
    if (performance.now() - lastValidFaceAt > faceTrackingGraceMs) smoothedLandmarks = [];
    meshPipe.textContent = identityReady ? 'WAITING FOR LIVE FACE' : 'SEARCHING';
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
    if (count > 0) {
      lastValidFaceAt = performance.now();
      faceTrackingReady = true;
    } else {
      faceTrackingReady = false;
    }
    const ms = Number((performance.now() - t0).toFixed(2));
    faceCountEl.textContent = String(count);
    faceDetectMsEl.textContent = ms + ' ms';
    faceTrackingReady = count > 0;
    if (count > 0) lastValidFaceAt = performance.now();
    meshPipe.textContent = count ? (identityReady ? 'LANDMARKS LIVE / IDENTITY READY' : 'LANDMARKS LIVE') : (identityReady ? 'WAITING FOR LIVE FACE' : 'SEARCHING');
    engineStatus.textContent = count ? (identityReady ? 'FACE DETECTED / READY' : 'FACE DETECTED') : (identityReady ? 'IDENTITY READY / WAITING FACE' : 'FACE-SCAN');
    enginePipe.textContent = count ? (identityReady ? 'TRACK + COMPOSITE' : 'LANDMARKS') : 'FACE DETECTOR';
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
let cameraStartPending = false;
let remoteBusy = false;
let pendingRemoteFrame = null;
let remotePumpScheduled = false;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { alpha: false });

function scheduleLocalDetection() {
  if (!humanReady || faceDetectBusy || !sourceFrame.width) return;
  detectFaceFrame();
}

async function pumpRemoteFrame() {
  remotePumpScheduled = false;
  if (remoteBusy || !pendingRemoteFrame) return;

  remoteBusy = true;
  const frameData = pendingRemoteFrame;
  pendingRemoteFrame = null;
  try {
    const blob = await fetch(frameData).then(r => r.blob());
    const bitmap = await createImageBitmap(blob);
    sourceFrameCtx.drawImage(bitmap, 0, 0, sourceFrame.width, sourceFrame.height);
    remoteCtx.drawImage(sourceFrame, 0, 0, remote.width, remote.height);
    bitmap.close();
    detectFaceFrame();
  } catch {
    // Ignore a malformed/stale frame and keep the live stream running.
  } finally {
    remoteBusy = false;
    if (pendingRemoteFrame) scheduleRemotePump();
  }
}

function scheduleRemotePump() {
  if (remotePumpScheduled) return;
  remotePumpScheduled = true;
  // Yield one turn so the compositor/UI gets time even when frames arrive
  // faster than JPEG decoding.
  setTimeout(pumpRemoteFrame, 0);
}

function setStatus(text, on = false) {
  status.textContent = text;
  status.classList.toggle('on', on);
}

function startFramePump() {
  clearInterval(frameTimer);
  frameTimer = setInterval(() => {
    if (!stream || !ws || ws.readyState !== WebSocket.OPEN) return;
    const qSize = ws.bufferedAmount || 0;
    if (qSize > 2500000) return;
    const quality = qSize > 1000000 ? 0.58 : (qSize > 350000 ? 0.68 : 0.8);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // The WebSocket server broadcasts remoteFrame to other clients, not back
    // to the camera sender. Feed the local camera frame directly into the
    // compositor as well, otherwise the same iPhone page can stay at
    // FRAMES 0 / FACES 0 forever even while WSS is healthy.
    sourceFrameCtx.drawImage(canvas, 0, 0, sourceFrame.width, sourceFrame.height);
    scheduleLocalDetection();

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
}

function wsUrl() {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

function connect() {
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    setStatus('WSS ONLINE', true);
    if (!humanReady) {
      engineStatus.textContent = 'FRAME BUFFER';
      enginePipe.textContent = 'BUFFER';
    }
    if (cameraStartPending && stream) {
      cameraStartPending = false;
      ws.send(JSON.stringify({ type: 'startRemoteCam' }));
      startFramePump();
      setStatus('CAMERA + WSS', true);
    }
  };

  ws.onclose = () => {
    setStatus('WSS OFFLINE');
    setTimeout(connect, 1200);
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'remoteFrame') {
      // Latest-frame-wins without a long async loop. A continuously arriving
      // stream must yield back to the browser between decodes so detection,
      // painting and UI events cannot be starved.
      pendingRemoteFrame = msg.data;
      scheduleRemotePump();
    }

    if (msg.type === 'hello' && msg.hasFrame && !humanReady) {
      engineStatus.textContent = 'FRAME BUFFER';
    }

    if (msg.type === 'camera-status') {
      if (!humanReady) engineStatus.textContent = msg.active ? 'CAMERA LIVE' : 'STANDBY';
    }
  };
}

async function pollEngine() {
  try {
    const r = await fetch('/api/engine', { cache: 'no-store' });
    const e = await r.json();
    if (!humanReady) {
      engineStatus.textContent = e.engine || 'STANDBY';
      enginePipe.textContent = e.engine || 'BUFFER';
    }
    processMs.textContent = e.processingMs != null ? e.processingMs + ' ms' : '—';
  } catch {}
}
setInterval(pollEngine, 500);
pollEngine();

async function startCamera() {
  if (testImageActive) {
    clearTestImageButton?.click();
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus('HTTPS NECESSÁRIO');
    alert('Abra esta página por HTTPS. No iPhone, use https://x.local:7777.');
    return;
  }

  try {
    if (stream) stopCamera(false);
    pendingRemoteFrame = null;
    resetCompositorState(false);
    await new Promise(resolve => requestAnimationFrame(resolve));
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
    if (!syntheticIdentity) await generateSyntheticFace(seedInput?.value || 184729);
    ws?.send(JSON.stringify({ type: 'startRemoteCam' }));

    cameraStartPending = true;
    if (ws?.readyState === WebSocket.OPEN) {
      cameraStartPending = false;
      ws.send(JSON.stringify({ type: 'startRemoteCam' }));
      startFramePump();
    }
  } catch (err) {
    setStatus('ERRO CAMERA');
    alert('Não foi possível abrir a câmera: ' + err.name + ' — ' + err.message);
  }
}

function stopCamera(notify = true) {
  clearInterval(frameTimer);
  frameTimer = null;
  cameraStartPending = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;

  // Do not keep compositing the last camera frame after the camera stops.
  pendingRemoteFrame = null;
  resetCompositorState(true);

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