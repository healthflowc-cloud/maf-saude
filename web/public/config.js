// ============================================================================
// MAF-Saúde — Configuração do frontend (Firebase Hosting)
// TROQUE os valores abaixo pelos do SEU projeto antes do deploy.
// Nenhum destes valores é segredo de servidor: SUPABASE_ANON_KEY é uma chave
// pública por design (RLS do Supabase é quem protege os dados — ver
// sql/001_init_mvp.sql e sql/002_relatorios.sql). NUNCA coloque aqui a
// SUPABASE_SERVICE_ROLE_KEY — essa fica só nas variáveis de ambiente do n8n.
// ============================================================================
window.MAF_CONFIG = {
  // URL do seu projeto Supabase, ex.: "https://xxxxxxxx.supabase.co"
  SUPABASE_URL: "https://swdiulaxutckfccgeyyo.supabase.co",

  // Chave "anon" (pública) do Supabase — Project Settings > API > anon public
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3ZGl1bGF4dXRja2ZjY2dleXlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMjA2ODgsImV4cCI6MjEwMzc5NjY4OH0.-7N-zKIcm2Y_2QpWVV8Rd5lyVEVe-J16Poq-fHbRtNk",

  // URL base pública do seu n8n (onde os webhooks estão publicados), ex.:
  // "https://n8n.seudominio.com.br" — SEM barra final.
  N8N_BASE_URL: "https://n8n.tangramhub.com.br",

  // URL base pública ONDE ESTE PRÓPRIO FRONTEND está hospedado (Firebase
  // Hosting) — usada pelo dashboard.html para montar o link do formulário
  // de cada setor. Ex.: "https://hf-maf.web.app" — SEM barra final.
  FORM_BASE_URL: "https://hf-maf.web.app",

  // --- Fase 3 (autoatendimento + IA + export) ---
  // SW-04 (Gemini) já está ativo no n8n -- URL preenchida.
  GEMINI_INSIGHTS_WEBHOOK_URL: "https://n8n.tangramhub.com.br/webhook/maf-gerar-insights",

  // SW-05 (export PDF/e-mail) já está ativo e testado ponta a ponta em
  // produção (02/09/2026, ver documentacao/md/SW05_SUPABASE_FUNCTION_SETUP.md)
  // -- os botões "Exportar PDF"/"Enviar e-mail" do dashboard chamam esta URL
  // de verdade. Se precisar desativar temporariamente (ex.: SW-05 fora do ar),
  // troque de volta para null -- o dashboard volta a mostrar os botões
  // desabilitados com um aviso, em vez de chamar um webhook fora do ar.
  EXPORT_RELATORIO_WEBHOOK_URL: "https://n8n.tangramhub.com.br/webhook/maf-exportar-relatorio",
};
