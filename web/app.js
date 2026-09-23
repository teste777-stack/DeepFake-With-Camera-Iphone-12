const video=document.getElementById('preview');
const status=document.getElementById('status');
const source=document.getElementById('source');
const resolution=document.getElementById('resolution');
const placeholder=document.getElementById('placeholder');
const start=document.getElementById('start');
const stop=document.getElementById('stop');
const flip=document.getElementById('flip');

let stream=null;
let facing='environment';

async function startCamera(){
  if(!window.isSecureContext){
    status.textContent='HTTPS necessário';
    alert('A câmera do navegador exige um contexto seguro. Abra x.local por HTTPS.');
    return;
  }
  try{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},
      audio:false
    });
    video.srcObject=stream;
    const track=stream.getVideoTracks()[0];
    const settings=track.getSettings();
    source.textContent=track.label || 'câmera do iPhone';
    resolution.textContent=(settings.width||'?')+' × '+(settings.height||'?')+' @ '+(settings.frameRate||'?')+' FPS';
    status.textContent='câmera ativa';
    placeholder.style.display='none';
    start.disabled=true;
    stop.disabled=false;
    flip.disabled=false;
  }catch(err){
    status.textContent='erro ao abrir câmera';
    console.error(err);
    alert('Não foi possível abrir a câmera: '+err.name+' — '+err.message);
  }
}
function stopCamera(){
  if(stream) stream.getTracks().forEach(t=>t.stop());
  stream=null; video.srcObject=null;
  placeholder.style.display='grid';
  status.textContent='câmera parada';
  start.disabled=false; stop.disabled=true; flip.disabled=true;
}
start.onclick=startCamera;
stop.onclick=stopCamera;
flip.onclick=()=>{facing=facing==='environment'?'user':'environment';startCamera();};
