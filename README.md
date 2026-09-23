# DeepFake With Camera iPhone 12

Base local-first em Node.js + Electron para usar a câmera do iPhone como fonte de vídeo.

## MVP atual

- servidor HTTPS local;
- interface mobile em `web/`;
- acesso por LAN;
- captura via `navigator.mediaDevices.getUserMedia()`;
- preview em tempo real;
- resolução/FPS reportados;
- estrutura preparada para enviar os frames para a engine Electron/Node.

## x.local

O endereço pretendido é:

`https://x.local:7777`

Como `.local` usa resolução mDNS e o certificado precisa ser confiável pelo telefone, o primeiro teste também pode ser feito pelo IP LAN mostrado pelo servidor.

### Inicialização

```bash
npm install
npm run cert:generate
npm run start:server
```

Depois abra no iPhone o endereço HTTPS mostrado no terminal e permita acesso à câmera.

> Navegadores exigem contexto seguro para câmera. Em uma rede local, HTTPS é necessário para este fluxo.

## Próxima camada

A página será transformada em uma fonte WebRTC/WebSocket para a engine Node/Electron. O objetivo é:

iPhone → x.local → Node/Electron → processamento GPU → Virtual Camera / NDI / Browser.

A transformação facial deve ser usada somente com rostos próprios ou com autorização explícita.
