---
tipo: LinkedIn — versão técnica
publico: comunidade de automação, n8n, dados, TI em saúde, governança/compliance
---

# Post Técnico

🧩 41 páginas de fundamentação acadêmica. 4 subworkflows n8n. 71 testes unitários
passando. Isso não nasceu de um final de semana de "vibe coding" — nasceu de
tratar resistência tecnológica em hospitais como um problema de engenharia, não
de opinião.

**O problema:** hospitais, clínicas e operadoras compram sistemas caros (PEP,
ERP, prontuário eletrônico) e não têm nenhuma forma estruturada de medir se a
linha de frente clínica está de fato aderindo à tecnologia — ou só empurrando com
a barriga enquanto mantém WhatsApp e papel como "processo paralelo". O resultado
aparece tarde demais: burnout digital, rotatividade de médicos e enfermeiros, e
investimento em tecnologia que não converte em uso real.

**O que construímos — Modelo MAF-Saúde:**
→ Metodologia própria que une UTAUT + TAM + Lean Healthcare em 4 construtos
mensuráveis (Valor Clínico Percebido, Usabilidade Invisível, Fricção Digital,
Carga Cognitiva) e um índice único, o IAO (Índice de Aderência Orgânica).
→ Arquitetura em subworkflows n8n isolados por responsabilidade (ingestão,
cálculo, geração de relatório, tratamento de erro) — cada um testável e
substituível sem tocar nos outros.
→ Lógica de cálculo e de validação extraída em módulos JS puros e cobertos por
71 testes unitários (não é "parece funcionar" — é "roda e prova que funciona"
antes de qualquer chamada real a Supabase/n8n).
→ Schema Postgres/Supabase com Row Level Security testada de verdade (não só
lida no código: testamos com `SET ROLE anon` que a policy realmente bloqueia o
que deveria bloquear).
→ Pipeline assíncrono (fire-and-forget entre subworkflows) para o profissional
de saúde nunca esperar o cálculo do IAO nem o envio de e-mail — resposta em
segundos.

**Resultado esperado:** um diagnóstico de aderência tecnológica que sai em
minutos, não em meses de consultoria, com rastreabilidade de ponta a ponta —
da resposta do questionário até o relatório do gestor.

Curioso pra ver a arquitetura técnica completa (subworkflows, schema, testes)?
Comenta "ARQUITETURA" que te mando o material técnico.

#Automação #Governança #n8n #Compliance #NoCode #HealthTech #EngenhariaDeSoftware #UTAUT #LeanHealthcare
