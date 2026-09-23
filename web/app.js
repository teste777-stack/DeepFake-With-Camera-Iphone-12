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
const remoteFps = document.getElementById('remoteFps');
const remoteFrames = document.getElementById('remoteFrames');
const engineStatus = document.getElementById('engineStatus');
const enginePipe = document.getElementById('enginePipe');

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
        remoteCtx.drawImage(bitmap, 0, 0, remote.width, remote.height);
        bitmap.close();
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

connect();
