# x.local Neural Face Engine

Backend local de face swap neural para o app Electron.

## Setup no Windows

O engine usa um ambiente Python isolado em `face-engine/.venv` e foi estruturado para Python 3.11.x.

Primeiro:

```powershell
npm run face-engine:setup
```

Depois instale as dependências, incluindo o runtime CUDA/cuDNN distribuído pelos pacotes NVIDIA:

```powershell
npm run face-engine:install
```

Diagnóstico:

```powershell
npm run face-engine:doctor
```

O Electron prefere automaticamente:

`face-engine/.venv/Scripts/python.exe`

e só usa outro Python se `PYTHON_EXECUTABLE` for definido.

## GPU

O stack usa ONNX Runtime GPU com CUDA 12 e cuDNN 9. Os pacotes NVIDIA são instalados dentro do ambiente Python; o engine adiciona as DLLs desse ambiente ao PATH antes de carregar ONNX Runtime.

O doctor diferencia:
- provider CUDA disponível;
- sessão CUDA realmente inicializada;
- modelo ONNX ausente;
- modelo ONNX incompatível com a versão do ONNX Runtime.

A RTX 3070 precisa ter driver NVIDIA funcional. O toolkit CUDA global não é obrigatório quando os runtimes necessários estão instalados no `.venv`.

## Modelos

Coloque um modelo ONNX de face swap licenciado para o seu uso em:

`models/inswapper_128.onnx`

O repositório não inclui pesos.

O modelo de detecção `buffalo_l` é carregado pelo InsightFace no primeiro `FaceAnalysis` quando ainda não estiver no cache local.

## Fluxo

Foto/iPhone -> HTTPS Node -> engine Python/ONNX GPU -> JPEG -> compositor.

O rosto de identidade é carregado separadamente em **CARREGAR ROSTO FONTE**.

## Licença dos modelos

O repositório não inclui pesos. A licença dos pesos deve ser verificada separadamente da licença do código. Para distribuição comercial, use somente pesos com licença compatível com a distribuição e o uso pretendidos.

## Uso responsável

Use face swap somente com consentimento/autorização necessários. Não use para fraude, impersonação ou deepfakes não consensuais.
