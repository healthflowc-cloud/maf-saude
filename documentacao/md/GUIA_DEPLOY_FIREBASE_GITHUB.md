---
title: MAF-Saúde v1 — Guia de Deploy (Firebase Hosting + GitHub)
status: MVP (Pacote 1 — Diagnóstico Express)
---

# Guia de Deploy — Firebase Hosting + GitHub

Passo a passo para publicar o frontend (`web/public/`) no Firebase Hosting do
projeto **hf-maf** e versionar o projeto inteiro num repositório GitHub novo.
Rode estes comandos no terminal da sua máquina (não no ambiente do Claude).

## 0. Pré-requisito: arquivos atualizados

Antes de começar, confirme que você já substituiu estes 2 arquivos na pasta
extraída do `MAF-Saude_v1_MVP.zip` pelos que te enviei nesta conversa (já
preenchidos com os valores reais do seu Supabase/n8n/Firebase):

- `web/public/config.js`
- `web/.firebaserc`

## 1. Instalar o Firebase CLI

```bash
npm install -g firebase-tools
firebase --version
```

## 2. Login no Firebase

```bash
firebase login
```

Isso abre o navegador para você autenticar com a conta Google dona do
projeto **hf-maf**.

## 3. Deploy do Hosting

Entre na pasta `web/` do projeto (a que tem `firebase.json` e `.firebaserc`):

```bash
cd caminho/para/MAF-Saude/web
firebase use hf-maf
firebase deploy --only hosting
```

Ao final, o terminal mostra a **Hosting URL** (formato
`https://hf-maf.web.app` ou `https://hf-maf.firebaseapp.com`). **Guarde essa
URL** — ela é o `FIREBASE_REPORT_BASE_URL` que falta configurar no nó
"Enviar Email de Notificacao" do SW-03 (ele está desabilitado até isso ser
resolvido — ver Seção 4 abaixo).

## 4. Depois do deploy: me avise a Hosting URL

Quando terminar o `firebase deploy`, me mande a Hosting URL aqui no chat.
Com ela eu:
- Reabilito e configuro o nó de e-mail do SW-03 com o link correto do
  relatório (`FIREBASE_REPORT_BASE_URL`).
- Atualizo o `allowedOrigins` do Webhook do SW-01 (hoje `"*"`, liberado para
  qualquer origem) para restringir exatamente a essa URL — fecha o risco #1
  já documentado em `API_MAPEAMENTO.md`.

## 5. Criar o repositório no GitHub

1. Acesse [github.com/new](https://github.com/new).
2. Nome sugerido: `maf-saude` (ou o que preferir).
3. **Não** marque as opções de criar README, .gitignore ou license
   automaticamente — vamos subir o conteúdo já existente.
4. Visibilidade: recomendo **Private** — embora nenhum segredo real esteja
   no repositório (a `service_role key` do Supabase nunca é gravada em
   nenhum arquivo do pacote; ela só existe no console do Supabase e na
   credencial "Supabase MAF" dentro do n8n), o repo contém a lógica de
   negócio e a estrutura de dados do produto.
5. Crie o repositório e copie a URL (formato
   `https://github.com/SEU_USUARIO/maf-saude.git`).

## 6. Primeiro commit e push

Na raiz do projeto (a pasta `MAF-Saude/`, que contém `subworkflows/`,
`web/`, `sql/`, `documentacao/` etc.):

```bash
cd caminho/para/MAF-Saude
git init
```

Crie um `.gitignore` mínimo antes do primeiro commit:

```bash
cat > .gitignore << 'EOF'
node_modules/
.firebase/
*.log
.DS_Store
EOF
```

Agora o commit e o push:

```bash
git add .
git commit -m "v1.0.0 - MVP Diagnostico Express (subworkflows n8n, schema Supabase, frontend, docs)"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/maf-saude.git
git push -u origin main
```

Troque `SEU_USUARIO/maf-saude` pela URL real que você copiou no passo 5.

## 7. Checklist rápido de verificação

- [ ] `firebase deploy --only hosting` terminou sem erro e mostrou uma
      Hosting URL.
- [ ] Abrir a Hosting URL + `/formulario.html` no navegador carrega o
      formulário sem erro no console (F12).
- [ ] `git push` terminou sem erro e o código aparece em
      `github.com/SEU_USUARIO/maf-saude`.
- [ ] Você me passou a Hosting URL para eu fechar a configuração do SW-03
      e travar o CORS do SW-01.

## Pontos de atenção (proativo)

1. **Chave anon do Supabase fica pública no `config.js` servido pelo
   Firebase Hosting** — isso é esperado e seguro (ver `API_MAPEAMENTO.md`),
   porque a proteção real é a Row Level Security no Postgres, não o sigilo
   da chave anon. Não é um vazamento.
2. **`.firebaserc` e `config.js` não devem ir para um repositório público**
   de terceiros nem ser colados em fóruns — não têm segredo de servidor,
   mas identificam seu projeto Supabase/Firebase publicamente.
3. Depois do primeiro deploy, qualquer novo `firebase deploy --only hosting`
   sobrescreve a versão publicada imediatamente (sem approval gate) — para
   um produto com clientes pagantes, vale considerar `firebase hosting:channel:deploy`
   para preview antes de ir para produção. Não é necessário para o MVP/piloto.
