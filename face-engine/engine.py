import os
import time
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
import uvicorn

PORT = int(os.environ.get("FACE_ENGINE_PORT", "7780"))
ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "models" / "inswapper_128.onnx"

app = FastAPI(title="x.local Neural Face Engine")
source_image = None
source_face = None
face_app = None
swapper = None
engine_error = None

def load_engine():
    global face_app, swapper, engine_error
    if face_app is not None and swapper is not None:
        return True
    try:
        import insightface
        from insightface.app import FaceAnalysis

        if not MODEL_PATH.exists():
            raise RuntimeError(
                "Modelo ausente: models/inswapper_128.onnx. "
                "Coloque um modelo com licença apropriada nessa pasta."
            )

        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        face_app = FaceAnalysis(
            name="buffalo_l",
            providers=providers,
        )
        face_app.prepare(ctx_id=0, det_size=(640, 640))
        swapper = insightface.model_zoo.get_model(
            str(MODEL_PATH),
            providers=providers,
        )
        engine_error = None
        return True
    except Exception as exc:
        face_app = None
        swapper = None
        engine_error = str(exc)
        return False

def decode(data: bytes):
    arr = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("INVALID IMAGE")
    return image

@app.get("/health")
def health():
    ready = load_engine()
    return {
        "ok": ready,
        "engine": "INSIGHTFACE / INSWAPPER",
        "gpu": "CUDA" if ready else "UNAVAILABLE",
        "model": str(MODEL_PATH),
        "error": engine_error,
    }

@app.post("/source")
async def set_source(request: Request):
    global source_image, source_face
    data = await request.body()
    try:
        image = decode(data)
        if not load_engine():
            return JSONResponse({"ok": False, "error": engine_error}, status_code=503)
        faces = face_app.get(image)
        if not faces:
            return JSONResponse({"ok": False, "error": "NO FACE IN SOURCE IMAGE"}, status_code=422)
        source_image = image
        source_face = max(faces, key=lambda f: float(f.bbox[2] - f.bbox[0]) * float(f.bbox[3] - f.bbox[1]))
        return {"ok": True, "faces": len(faces)}
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)

@app.post("/swap")
async def swap(request: Request):
    data = await request.body()
    if source_face is None:
        return Response("SOURCE FACE NOT LOADED", status_code=409, media_type="text/plain")
    try:
        frame = decode(data)
        started = time.perf_counter()
        faces = face_app.get(frame)
        if not faces:
            ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
            return Response(encoded.tobytes(), media_type="image/jpeg")
        target = max(faces, key=lambda f: float(f.bbox[2] - f.bbox[0]) * float(f.bbox[3] - f.bbox[1]))
        result = swapper.get(frame, target, source_face, paste_back=True)
        ok, encoded = cv2.imencode(".jpg", result, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        if not ok:
            raise RuntimeError("JPEG ENCODE FAILED")
        return Response(
            encoded.tobytes(),
            media_type="image/jpeg",
            headers={
                "X-Face-Swap-Ms": str(round((time.perf_counter() - started) * 1000, 2))
            },
        )
    except Exception as exc:
        return Response("SWAP ERROR: " + str(exc), status_code=500, media_type="text/plain")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
