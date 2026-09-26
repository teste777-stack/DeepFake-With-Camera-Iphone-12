const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const venvPython = process.platform === 'win32'
  ? path.join(root, 'face-engine', '.venv', 'Scripts', 'python.exe')
  : path.join(root, 'face-engine', '.venv', 'bin', 'python');
const modelPath = path.join(root, 'models', 'inswapper_128.onnx');

function runPython(code) {
  const r = spawnSync(venvPython, ['-c', code], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
  return { ...r, text: (r.stdout || '') + (r.stderr || '') };
}

console.log('\n  x.local Neural Face Engine — doctor\n');

if (!fs.existsSync(venvPython)) {
  console.error('  [erro] .venv não encontrado:', venvPython);
  console.error('  Rode: npm run face-engine:setup');
  process.exit(1);
}

const info = runPython(`
import platform, sys
print("PYTHON_VERSION=" + platform.python_version())
print("PYTHON_PATH=" + sys.executable)
print("PLATFORM=" + platform.system())
print("ARCH=" + platform.machine())
`);
console.log('  Python\n  --------\n' + info.text.trim());

const deps = runPython(`
import importlib
mods = ["numpy", "onnx", "onnxruntime", "insightface", "cv2", "fastapi", "uvicorn"]
for name in mods:
    try:
        m = importlib.import_module(name)
        print(name + "=" + str(getattr(m, "__version__", "ok")))
    except Exception as e:
        print(name + "=ERROR:" + str(e))
`);
console.log('\n  Pacotes\n  --------\n' + deps.text.trim());

const modelForPython = modelPath.replace(/\\/g, '\\\\');
const ortCode = `
import os, site
from pathlib import Path
for base in site.getsitepackages():
    n = Path(base) / "nvidia"
    for folder in [n/"cudnn"/"bin", n/"cublas"/"bin", n/"cuda_runtime"/"bin"]:
        if folder.is_dir():
            try: os.add_dll_directory(str(folder))
            except Exception: pass
            os.environ["PATH"] = str(folder) + os.pathsep + os.environ.get("PATH", "")
import onnxruntime as ort
print("PROVIDERS=" + ",".join(ort.get_available_providers()))
model = MODEL_PATH_PLACEHOLDER
if not os.path.exists(model):
    print("MODEL=ABSENT")
else:
    print("MODEL=PRESENT")
    cpu_error = None
    try:
        ort.InferenceSession(model, providers=["CPUExecutionProvider"])
        print("CPU_SESSION=OK")
    except Exception as e:
        cpu_error = str(e)
        print("CPU_SESSION=ERROR:" + cpu_error)
    if cpu_error is None and "CUDAExecutionProvider" in ort.get_available_providers():
        try:
            s = ort.InferenceSession(model, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
            print("CUDA_SESSION=OK")
            print("ACTIVE_PROVIDERS=" + ",".join(s.get_providers()))
        except Exception as e:
            print("CUDA_SESSION=ERROR:" + str(e))
`.replace("MODEL_PATH_PLACEHOLDER", JSON.stringify(modelForPython));

const ort = runPython(ortCode);
console.log('\n  ONNX Runtime / CUDA\n  -------------------\n' + ort.text.trim());

console.log('\n  Modelos\n  --------');
console.log('  inswapper_128.onnx:', fs.existsSync(modelPath) ? 'PRESENTE' : 'AUSENTE');
console.log('  buffalo_l: baixado pelo InsightFace no primeiro FaceAnalysis se necessário.\n');
