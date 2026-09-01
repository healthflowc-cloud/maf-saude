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
};
