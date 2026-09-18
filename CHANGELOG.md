# Lançamento rápido — 18/09/2026

Permite colar contas e revisar categorias, total, data e banco antes da confirmação. Valores em centavos; linhas de total conferidas e excluídas das despesas.

A função `minas_save_expenses` em `finance_batch.sql` grava despesas, diferenças nos saldos e históricos em uma transação. Reenvios usam o mesmo identificador, meses fechados são bloqueados e edições com dados desatualizados são rejeitadas. SECURITY INVOKER preserva as permissões/RLS existentes.

O formulário de despesas do mês passa a guardar edições localmente até Salvar e preserva os IDs das linhas. Folha de pagamento, estoque, vendas e demais fluxos específicos permanecem fora desta alteração.

Validação: parser de valores/data/total; PostgreSQL local com lançamento, repetição, falha intermediária e rollback, mês fechado, data divergente, edição concorrente e estorno. Interface conferida no Chrome com dados de demonstração, sem inserir contas reais.

Implantação: aplicar finance_batch.sql no Supabase antes de publicar index.html e quick-core.js. Não requer alterações nas tabelas ou políticas existentes.
