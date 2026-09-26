# x.local Neural Face Engine

Backend local de face swap neural para o app Electron.

## Setup

Execute `npm run face-engine:install`.

Depois coloque um modelo ONNX de face swap licenciado para o seu uso em:

`models/inswapper_128.onnx`

O servidor Node inicia automaticamente `face-engine/engine.py` na porta 7780.

## Fluxo

Foto/iPhone -> HTTPS Node -> engine Python/ONNX GPU -> JPEG -> compositor.

O rosto de identidade é carregado separadamente em **CARREGAR ROSTO FONTE**.

## Licença dos modelos

O repositório não inclui pesos. A documentação atual do InsightFace informa que o código é MIT, mas os modelos pré-treinados disponibilizados pelo projeto são para pesquisa não comercial; a série inswapper requer licenciamento para uso comercial. Para um produto comercial, substitua o peso por um modelo com licença compatível antes da distribuição.

## Uso responsável

Use face swap somente com consentimento/autorização necessários. Não use para fraude, impersonação ou deepfakes não consensuais.
