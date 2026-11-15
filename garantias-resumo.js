(() => {
  const page = document.getElementById('page-garantias');
  const message = document.getElementById('garantias-portal-status');
  const grid = document.getElementById('garantias-portal-kpis');
  const client = supabase.createClient(SUPA_URL, SUPA_KEY, {
    auth: { storageKey: 'minas-garantias-session', detectSessionInUrl: false },
  });

  const statuses = {
    recebida: 'Aguardando primeiro retorno',
    em_analise: 'Em análise',
    aprovada: 'Aprovadas',
    recusada: 'Recusadas',
    concluida: 'Finalizadas',
    rascunho: 'Links aguardando envio',
  };

  let updating = false;

  async function refresh() {
    if (updating || document.hidden || !page.classList.contains('active')) return;
    updating = true;
    try {
      const { data: { session } } = await client.auth.getSession();
      const role = session?.user?.app_metadata?.minas_garantias;
      if (!['gestor', 'vendedor'].includes(role)) {
        grid.hidden = true;
        grid.classList.remove('kpi-grid');
        grid.replaceChildren();
        message.textContent = 'Entre no Portal de Garantias para exibir os indicadores.';
        return;
      }

      const counts = Object.fromEntries(await Promise.all(Object.keys(statuses).map(async status => {
        const result = await client.from('garantia_chamados')
          .select('id', { count: 'exact', head: true }).eq('status', status);
        if (result.error || result.count === null) throw Error('Contagem indisponível.');
        return [status, result.count];
      })));

      const active = counts.recebida + counts.em_analise + counts.aprovada;
      const indicators = [
        ['Ativas', active],
        ...Object.entries(statuses).map(([status, label]) => [label, counts[status]]),
      ];
      grid.replaceChildren(...indicators.map(([label, value]) => {
        const card = document.createElement('div');
        card.className = 'kpi';
        const heading = document.createElement('label');
        heading.textContent = label;
        const count = document.createElement('div');
        count.className = 'val';
        count.textContent = value;
        card.append(heading, count);
        return card;
      }));
      grid.classList.add('kpi-grid');
      grid.hidden = false;
      message.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR') + ' · atualização a cada 10 segundos';
    } catch {
      message.textContent = grid.hidden
        ? 'Indicadores temporariamente indisponíveis. Tentando novamente.'
        : 'Sem atualização. Os números exibidos são da última consulta bem-sucedida.';
    } finally {
      updating = false;
    }
  }

  new MutationObserver(refresh).observe(page, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  setInterval(refresh, 10000);
  refresh();
})();
