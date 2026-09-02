# SW-05 — Geração de PDF (histórico: opção descartada)

> ⚠️ **SUPERSEDIDO.** Este documento descrevia a opção "sidecar
> Browserless/Chromium no VPS do n8n" — descartada porque o usuário não
> tem acesso a esse VPS. A abordagem atual (Cloud Function no Firebase) está
> em `SW05_CLOUD_FUNCTION_SETUP.md`. Mantido aqui só como registro de
> decisão (por que a opção A foi cogitada e por que não seguiu adiante) —
> não use as instruções abaixo.

## Por que a opção original (sidecar no VPS) foi descartada

Era a opção mais barata em teoria (zero custo de nuvem adicional, container
extra no mesmo servidor que já hospeda o n8n), mas depende de shell/Docker
no VPS `n8n.tangramhub.com.br` — acesso que o usuário não tem. Sem isso,
não há como subir o container nem editar o docker-compose. Ver a decisão
tomada em `SW05_CLOUD_FUNCTION_SETUP.md`.

## Conteúdo original (referência, não executar)

```yaml
services:
  browserless:
    image: ghcr.io/browserless/chromium:latest
    restart: unless-stopped
    environment:
      - TOKEN=<gerado aleatoriamente>
      - CONCURRENT=2
      - QUEUED=5
      - TIMEOUT=30000
      - DEFAULT_BLOCK_ADS=true
    shm_size: "1gb"
    mem_limit: 768m
```

Credencial n8n correspondente ("Browserless MAF", `httpQueryAuth`) já foi
**deletada** do n8n — não existe mais.
