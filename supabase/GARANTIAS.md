# Ativação do portal de garantias

1. Aplique `garantias_portal.sql` no projeto Supabase do Sistema Minas.
2. Crie ou selecione as contas da equipe no Supabase Auth. Atribua `app_metadata.minas_garantias` pelo Admin API, com valor `gestor` ou `vendedor`. O vendedor pode emitir links e consultar chamados. O gestor também pode decidir e cadastrar horários.
3. Configure `OPENAI_API_KEY` como segredo da Edge Function. Configure `GARANTIAS_JOB_SECRET` com um valor aleatório exclusivo e implante `garantias-analise` usando a configuração do repositório. A função autentica o gestor ou o agendador no servidor.
4. No Supabase Cron, agende um POST periódico a `/functions/v1/garantias-analise` com o segredo do agendador no cabeçalho Authorization Bearer, guardado no Vault. O processamento automático analisa até dois chamados pendentes por execução. Configure somente após validar o acesso à API e verificar o tratamento dos dados com o provedor.
5. Valide com uma conta de teste e um link de teste antes de distribuir. Confira a abertura, o parecer, a resposta, o agendamento e a restrição de acesso aos anexos. Cadastre os horários reais de recebimento pela tela da equipe.

O portal não migra chamados legados. Os vídeos ficam disponíveis à equipe para revisão. A análise automática usa o relato e imagens compatíveis de até 6 MiB por arquivo.
