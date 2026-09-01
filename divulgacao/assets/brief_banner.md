---
tipo: Brief de imagem/banner para LinkedIn
uso: acompanhar os dois posts (post_tecnico.md / post_executivo.md)
---

# Brief — Banner/Card Visual MAF-Saúde

## Especificações técnicas
- **Dimensão:** 1200 x 627 px (proporção 1.91:1 — padrão de link/imagem de post do LinkedIn)
- **Formato de arquivo:** PNG ou JPG, texto legível mesmo em miniatura (feed mobile)
- **Peso:** manter abaixo de 2 MB

## Paleta de cores (Triagem de Manchester — já usada no dashboard do produto)
| Cor | Hex | Uso |
|---|---|---|
| Azul institucional | `#1A5F7A` | fundo/header, elemento de marca |
| Vermelho crítico | `#C0392B` | indicador "Risco Iminente" (Nível 1) |
| Laranja/Âmbar | `#D68910` | indicador "Adoção Dolorosa" (Nível 2) |
| Amarelo | `#B7950B` | indicador "Estabilidade Burocrática" (Nível 3) |
| Azul neutro | `#2874A6` | indicador "Fluidez Operacional" (Nível 4) |
| Verde | `#1E8449` | indicador "Selo Padrão Ouro" (Nível 5) |
| Fundo claro | `#F7F9F9` | área de respiro/texto |

## Elementos visuais obrigatórios
1. **Gráfico de radar estilizado** (4 eixos: VC, UI, FD, CC) em formato "balão" —
   é o elemento de identidade visual mais reconhecível do modelo (já ilustrado no
   docx oficial, Seção 7). Não usar radar genérico de estoque — replicar o
   conceito "balão saudável vs. âncora tóxica".
2. **Uma silhueta ou ícone de ambiente hospitalar** (não usar fotografia de
   paciente/profissional real identificável — usar ilustração vetorial genérica
   ou ícone, para não sugerir uso de imagem real de terceiros sem consentimento).
3. **Número/indicador do IAO** em destaque (ex.: um mostrador tipo velocímetro
   parcialmente preenchido, remetendo à 4ª visualização do dashboard oficial).
4. **Wordmark "MAF-Saúde"** + tagline curta: "Diagnóstico de Aderência
   Tecnológica em Saúde".
5. **Logo/nome da Weknow Healthtech** em posição discreta (rodapé do card).

## Prompt sugerido para geração de imagem (DALL·E / Midjourney / Firefly)

> "Corporate healthtech infographic banner, 1200x627px, clean flat vector
> illustration style. Left side: a stylized radar/spider chart with 4 axes
> forming a healthy rounded balloon shape in teal blue (#1A5F7A) and green
> (#1E8449). Right side: a minimalist speedometer/gauge icon showing a
> maturity score, with a color gradient from red (#C0392B) through amber
> and yellow to green (#1E8449), inspired by hospital triage color coding.
> Background: very light off-white (#F7F9F9) with subtle geometric grid
> lines. Bold sans-serif wordmark 'MAF-Saúde' in dark teal at the top,
> small tagline below in gray: 'Diagnóstico de Aderência Tecnológica em
> Saúde'. No human faces, no photorealistic hospital imagery — vector
> icon style only, professional B2B SaaS aesthetic, plenty of white
> space, small 'Weknow Healthtech' wordmark bottom right corner."

## Alternativa: brief para designer humano
Caso prefira produção manual (Figma/Canva): usar como referência de estrutura
o layout dos 4 gráficos já existentes no documento oficial (`Modelo_MAF-Saude_v5.docx`,
Seção 7 — Radar, Matriz GPS, Heatmap, Velocímetro) e simplificar para um único
card composto (radar + velocímetro), sem tentar caber os 4 gráficos no banner.
