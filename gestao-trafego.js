(() => {
  const el = id => document.getElementById('trafego-' + id);
  const key = 'minas-gestao-trafego-v1';
  const form = el('form');
  const fields = ['dia', 'veiculo', 'plataforma', 'campanha', 'gasto', 'leads', 'visitas', 'vendas'];
  const metrics = ['gasto', 'leads', 'visitas', 'vendas'];
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl = cents => currency.format(cents / 100);
  const cost = (cents, quantity) => quantity ? brl(cents / quantity) : '—';
  const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  let editing;

  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function load() {
    const rows = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(rows)) throw Error('Lançamentos indisponíveis.');
    return rows;
  }

  function reset() {
    editing = undefined;
    form.reset();
    form.elements.dia.value = today();
    el('titulo').textContent = 'Registrar resultado diário';
    el('cancelar').hidden = true;
  }

  function total(rows) {
    return Object.fromEntries(metrics.map(metric => [metric, rows.reduce((sum, row) => sum + row[metric], 0)]));
  }

  function cells(values) {
    const row = node('tr');
    row.append(...values.map(value => node('td', value)));
    return row;
  }

  function emptyTable(label, columns) {
    const row = cells([label]);
    row.firstChild.colSpan = columns;
    return row;
  }

  function action(label, handler) {
    const button = node('button', label);
    button.className = 'btn sec btn-sm';
    button.type = 'button';
    button.onclick = handler;
    return button;
  }

  function save(rows) {
    localStorage.setItem(key, JSON.stringify(rows));
    render();
  }

  function recordRow(item) {
    const row = cells([item.dia.split('-').reverse().join('/'), item.veiculo, item.plataforma,
      item.campanha, brl(item.gasto), item.leads, item.visitas, item.vendas]);
    const actions = node('td');
    actions.append(action('Editar', () => {
      editing = item.id;
      fields.forEach(field => { form.elements[field].value = field === 'gasto' ? item.gasto / 100 : item[field]; });
      el('titulo').textContent = 'Editar resultado diário';
      el('cancelar').hidden = false;
      form.elements.veiculo.focus();
    }), action('Excluir', () => {
      if (!confirm('Excluir este lançamento de tráfego?')) return;
      try {
        save(load().filter(entry => entry.id !== item.id));
        if (editing === item.id) reset();
        el('mensagem').textContent = 'Lançamento excluído.';
      } catch { el('mensagem').textContent = 'Não foi possível excluir o lançamento.'; }
    }));
    row.append(actions);
    return row;
  }

  function show(rows) {
    const sum = total(rows);
    const indicators = [
      ['Investido', brl(sum.gasto)], ['Leads', sum.leads], ['Visitas', sum.visitas], ['Vendas', sum.vendas],
      ['Custo por lead', cost(sum.gasto, sum.leads)], ['Custo por visita', cost(sum.gasto, sum.visitas)],
      ['Custo por venda', cost(sum.gasto, sum.vendas)],
    ];
    el('kpis').replaceChildren(...indicators.map(([label, value]) => {
      const card = node('div');
      card.className = 'kpi';
      const count = node('div', value);
      count.className = 'val';
      card.append(node('label', label), count);
      return card;
    }));

    const grouped = new Map();
    for (const entry of rows) {
      const id = normalize(entry.veiculo);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(entry);
    }
    const vehicles = [...grouped.values()].map(entries => ({ name: entries[0].veiculo, ...total(entries) }))
      .sort((a, b) => b.gasto - a.gasto);
    const alerts = vehicles.filter(item => item.gasto && !item.visitas);
    el('alertas').textContent = alerts.length
      ? alerts.length + ' veículo(s) com investimento e nenhuma visita atribuída neste período.'
      : '';
    el('veiculos').replaceChildren(...(vehicles.length ? vehicles.map(v => cells([
      v.name, brl(v.gasto), v.leads, v.visitas, v.vendas,
      cost(v.gasto, v.leads), cost(v.gasto, v.visitas), cost(v.gasto, v.vendas),
    ])) : [emptyTable('Nenhum lançamento no período.', 8)]));
    el('lancamentos').replaceChildren(...(rows.length ? rows.map(recordRow) : [emptyTable('Nenhum lançamento no período.', 9)]));
  }

  function render() {
    try {
      const start = el('inicio').value, end = el('fim').value;
      const query = normalize(el('filtro').value);
      const rows = load().filter(row => (!start || row.dia >= start) && (!end || row.dia <= end)
        && normalize([row.veiculo, row.campanha, row.plataforma].join(' ')).includes(query));
      show(rows.sort((a, b) => b.dia.localeCompare(a.dia)));
      if (start && end && start > end) el('alertas').textContent = 'Confira a data inicial e a data final.';
    } catch {
      show([]);
      el('alertas').textContent = 'Não foi possível carregar os lançamentos salvos.';
    }
  }

  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    values.veiculo = values.veiculo.trim();
    values.campanha = values.campanha.trim();
    if (!values.veiculo || !values.campanha || !values.dia ||
        metrics.some(metric => values[metric] === '' || !Number.isFinite(Number(values[metric])) || Number(values[metric]) < 0)) {
      el('mensagem').textContent = 'Confira os dados do lançamento.';
      return;
    }
    for (const metric of metrics) values[metric] = Number(values[metric]);
    values.gasto = Math.round(values.gasto * 100);
    try {
      const rows = load();
      const duplicate = rows.find(row => row.id !== editing && row.dia === values.dia &&
        ['veiculo', 'plataforma', 'campanha'].every(field => normalize(row[field]) === normalize(values[field])));
      if (duplicate) { el('mensagem').textContent = 'Já existe um lançamento para esse dia, veículo e campanha. Edite o registro existente.'; return; }
      if (editing && !rows.some(row => row.id === editing)) throw Error('Registro indisponível.');
      if (el('inicio').value > values.dia) el('inicio').value = values.dia;
      if (el('fim').value < values.dia) el('fim').value = values.dia;
      save(editing ? rows.map(row => row.id === editing ? { ...row, ...values } : row)
        : [...rows, { ...values, id: crypto.randomUUID() }]);
      reset();
      el('mensagem').textContent = 'Lançamento salvo.';
    } catch { el('mensagem').textContent = 'Não foi possível salvar o lançamento.'; }
  };

  el('inicio').value = today().slice(0, 8) + '01';
  el('fim').value = today();
  el('inicio').onchange = el('fim').onchange = el('filtro').oninput = render;
  el('cancelar').onclick = reset;
  window.addEventListener('storage', event => { if (event.key === key) render(); });
  reset();
  render();
})();
