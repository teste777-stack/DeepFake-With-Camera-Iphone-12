# DeepFake With Camera iPhone 12

Base local-first para capturar a câmera do iPhone no PC usando x.local + HTTPS + WSS, com uma ponte de frames pronta para entrar no motor de processamento.

## O que já foi aproveitado da arquitetura VHS CRT

- captura getUserMedia do iPhone;
- envio de JPEG em ~20 FPS;
- backpressure adaptativo para Wi-Fi, descartando frames quando a fila cresce;
- transporte WSS quando a página está em HTTPS;
- decodificação no PC com createImageBitmap() e descarte de frames atrasados;
- preview remoto do frame que chegou ao PC;
- arquitetura compatível com o pipeline NDI/Browser/Virtual Camera do VHS;
- mDNS para anunciar x.local na rede local;
- CA local + certificado com SAN x.local, em vez de depender do certificado de code signing do desktop.

O projeto do VHS já documenta o fluxo de câmera móvel em HTTPS e WebSocket; aqui ele foi separado em um bridge dedicado para podermos colocar o face engine no meio sem mexer no editor principal.

## Estrutura

- server/index.js — HTTPS, WSS, buffer do último frame, mDNS e API de status.
- web/ — interface que funciona no iPhone e no PC.
- electron/main.js — host desktop Electron.
- scripts/generate-cert.js — cria uma CA local e o certificado de x.local.
- certs/ — certificados locais, não versionados.

## Primeiro uso

```bash
npm install
npm run cert:generate
npm run start
```

O Electron abre o painel local.

Para testar pelo iPhone, deixe o PC e o iPhone na mesma rede Wi-Fi e abra:

`https://x.local:7777`

Se x.local não resolver, use o IP LAN exibido pelo servidor:

`https://SEU_IP:7777`

### Confiar na CA no iPhone

Abra:

`https://x.local:7777/ca.crt`

Instale o perfil/certificado da CA e habilite a confiança do certificado nas configurações do iPhone. Depois volte ao endereço x.local.

> A primeira camada usa uma CA própria para o projeto. Isso é diferente do certificado de assinatura de EXE usado pelo VHS CRT.

## Pipeline atual

```text
iPhone
  ↓
getUserMedia
  ↓
JPEG ~20 FPS
  ↓
WSS /ws
  ↓
Node.js Frame Buffer
  ↓
PC Preview
  ↓
[ PRÓXIMO: Face Tracking / Face Engine GPU ]
  ↓
Virtual Camera / NDI / Browser
```

## Endpoints

- `/health` — health check.
- `/api/status` — estado do bridge.
- `/api/frame.jpg` — último frame recebido.
- `/ca.crt` — CA local para instalar no telefone.
- `/ws` — transporte WebSocket seguro.

## Próxima camada

```text
WSS frame
  ↓
decode
  ↓
face detection / landmarks
  ↓
face engine ONNX/CUDA
  ↓
compositor WebGL
  ↓
output frame
  ├─ preview browser
  ├─ NDI
  └─ virtual camera
```

O objetivo é manter o processamento local no PC e deixar o iPhone apenas como câmera de entrada.