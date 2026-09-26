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
mods = ["numpy", "onnx", "onnxruntime", "insightface", "cv2", "fastapi", "uvicorn",
        "nvidia.cuda_runtime", "nvidia.cublas", "nvidia.cudnn"]
for name in mods:
    try:
        m = importlib.import_module(name)
        print(name + "=" + str(getattr(m, "__version__", "ok")))
    except Exception as e:
        print(name + "=ERROR:" + str(e))
`);
console.log('\n  Pacotes\n  --------\n' + deps.text.trim());

const ortCode = `
import os
import site
import sys
import tempfile
from pathlib import Path

dlls = []
for base in site.getsitepackages():
    nvidia = Path(base) / "nvidia"
    for folder in [nvidia/"cudnn"/"bin", nvidia/"cublas"/"bin", nvidia/"cuda_runtime"/"bin"]:
        if folder.is_dir():
            dlls.append(folder)
            try:
                os.add_dll_directory(str(folder))
            except Exception:
                pass
            os.environ["PATH"] = str(folder) + os.pathsep + os.environ.get("PATH", "")

print("NVIDIA_DLL_DIRS=" + "|".join(str(p) for p in dlls))
for folder in dlls:
    names = sorted(p.name for p in folder.glob("*.dll"))
    print("DLLS_" + folder.name.upper() + "=" + ",".join(names[:40]))

try:
    import onnxruntime as ort
    providers = ort.get_available_providers()
    print("PROVIDERS=" + ",".join(providers))
except Exception as e:
    print("ORT_IMPORT_ERROR=" + repr(e))
    sys.exit(0)

cuda_available = "CUDAExecutionProvider" in providers
print("CUDA_PROVIDER_AVAILABLE=" + str(cuda_available))

if cuda_available:
    try:
        import onnx
        from onnx import helper, TensorProto
        model = helper.make_model(
            helper.make_graph(
                [helper.make_node("Identity", ["input"], ["output"])],
                "xlocal_cuda_probe",
                [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 4])],
                [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 4])]
            ),
            opset_imports=[helper.make_opsetid("", 13)]
        )
        model.ir_version = 10
        probe = Path(tempfile.gettempdir()) / "xlocal_cuda_probe.onnx"
        onnx.save(model, str(probe))

        try:
            session = ort.InferenceSession(
                str(probe),
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
            )
            print("CUDA_SESSION=OK")
            print("ACTIVE_PROVIDERS=" + ",".join(session.get_providers()))
        except Exception as e:
            print("CUDA_SESSION=ERROR:" + repr(e))
        finally:
            try:
                probe.unlink()
            except Exception:
                pass
    except Exception as e:
        print("CUDA_PROBE_BUILD_ERROR=" + repr(e))
else:
    print("CUDA_SESSION=SKIPPED")

try:
    print("ORT_VERSION=" + ort.__version__)
except Exception:
    pass
`;

const ort = runPython(ortCode);
console.log('\n  ONNX Runtime / CUDA\n  -------------------\n' + ort.text.trim());

console.log('\n  Modelos\n  --------');
console.log('  inswapper_128.onnx:', fs.existsSync(modelPath) ? 'PRESENTE' : 'AUSENTE');
console.log('  buffalo_l: baixado pelo InsightFace no primeiro FaceAnalysis se necessário.');
console.log('\n  Nota: erro de IR/opset do inswapper é separado do teste CUDA acima.');
