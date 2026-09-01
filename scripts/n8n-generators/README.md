# Geradores dos subworkflows n8n — fonte da verdade

Os arquivos `.json` em `subworkflows/` são **gerados**, não editados à mão.
Qualquer mudança de lógica (fórmula do IAO, texto do relatório, validação de
payload) deve ser feita AQUI, nos módulos `.js`, nunca direto no JSON.

## Por que essa separação existe

Colar JavaScript direto dentro de um node "Code" do n8n, sem testes, é o tipo
de mudança que só se descobre quebrada em produção. Aqui, a lógica de negócio
vive em módulos Node.js normais (`calculo_iao_logic.js`, `report_logic.js`,
mais as funções de validação embutidas em `sw01.js`), cobertos por testes
unitários que rodam em segundos, sem precisar de n8n, Supabase nem navegador
para validar a matemática e as regras de negócio.

## Arquivos

| Arquivo | O que é |
|---|---|
| `lib.js` | Helpers para montar o JSON do workflow (nodes, conexões, validação estrutural) |
| `sw00.js` a `sw03.js` | Geram os 4 arquivos em `../../subworkflows/*.json` |
| `calculo_iao_logic.js` | Fórmula do IAO — usada dentro do node "Calcular IAO" de SW-02 |
| `report_logic.js` | Tradução dos números em narrativa — usada dentro do node "Montar Relatorio" de SW-03 |
| `test_sw01_logic.js`, `test_sw02_logic.js`, `test_sw03_logic.js` | Testes unitários (71 casos no total) |
| `test_web_pages.js` | Teste funcional headless (Playwright) do formulário e da página de relatório |

## Como regenerar um subworkflow depois de editar a lógica

```bash
cd scripts/n8n-generators
node sw02.js          # regrava subworkflows/SW-02-Calculo-IAO.json
node test_sw02_logic.js   # confirma que a lógica ainda passa nos 39 testes
```

Sempre rode o teste correspondente ANTES de reimportar o JSON atualizado no
n8n. Se editar `calculo_iao_logic.js`, copie manualmente a função atualizada
para dentro do `jsCode` embutido em `sw02.js` (são cópias literais, não um
import automático — o node "Code" do n8n não suporta `require` de arquivo
externo) — os comentários no topo de cada `jsCode` lembram disso.

## Como testar o formulário/relatório sem publicar no Firebase

```bash
cd ../../web/public
python3 -m http.server 8791 &
cd ../../scripts/n8n-generators
node test_web_pages.js
```

`file://` não funciona para esse teste (a Web Crypto API do navegador exige
contexto seguro — HTTP/HTTPS — para gerar o `respondente_hash`); use sempre um
servidor local ou o próprio Firebase Hosting.
