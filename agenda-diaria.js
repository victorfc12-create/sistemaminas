(() => {
  const get = id => document.getElementById(id);
  const day = get('agenda-dia');
  const form = get('agenda-form');
  const notice = get('agenda-mensagem');
  const list = get('agenda-lista');
  const key = 'minas-agenda-diaria-v1';
  const priorities = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  const ranks = Object.keys(priorities);
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  let editing = null;

  function element(tag, label) {
    const node = document.createElement(tag);
    if (label) node.textContent = label;
    return node;
  }

  function load() {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(value)) throw Error('Agenda inválida.');
    return value;
  }

  function resetEditor() {
    editing = null;
    form.reset();
    form.elements.dia.value = day.value;
    get('agenda-form-titulo').textContent = 'Adicionar à agenda';
    get('agenda-cancelar').hidden = true;
  }

  function button(label, action) {
    const control = element('button', label);
    control.type = 'button';
    control.className = 'btn sec btn-sm';
    control.onclick = action;
    return control;
  }

  function showItem(item) {
    const card = element('article');
    card.className = 'kpi';
    const details = element('div', [priorities[item.prioridade], item.hora].filter(Boolean).join(' · '));
    details.style.color = item.prioridade === 'alta' ? 'var(--amber)' : 'var(--text2)';
    const title = element('h3', item.titulo);
    title.style.overflowWrap = 'anywhere';
    card.append(details, title);
    if (item.notas) {
      const notes = element('p', item.notas);
      notes.style.whiteSpace = 'pre-wrap';
      notes.style.overflowWrap = 'anywhere';
      card.append(notes);
    }
    const controls = element('div');
    controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
    controls.append(
      button(item.feito ? 'Reabrir' : 'Concluir', () => save(rows => rows.map(r => r.id === item.id ? { ...r, feito: !r.feito } : r))),
      button('Editar', () => {
        editing = item.id;
        for (const field of ['titulo', 'prioridade', 'dia', 'hora', 'notas']) form.elements[field].value = item[field];
        get('agenda-form-titulo').textContent = 'Editar registro';
        get('agenda-cancelar').hidden = false;
        form.elements.titulo.focus();
      }),
      button('Excluir', () => {
        if (!confirm('Excluir este registro da agenda?')) return;
        if (save(rows => rows.filter(r => r.id !== item.id)) && editing === item.id) resetEditor();
      })
    );
    card.append(controls);
    return card;
  }

  function render() {
    try {
      const rows = load().filter(item => item.dia === day.value);
      const order = (a, b) => ranks.indexOf(a.prioridade) - ranks.indexOf(b.prioridade)
        || (a.hora || '99:99').localeCompare(b.hora || '99:99');
      const pending = rows.filter(r => !r.feito).sort(order);
      const done = rows.filter(r => r.feito).sort(order);
      get('agenda-resumo').textContent = pending.length + ' pendente(s) · ' + done.length + ' concluído(s)';
      list.replaceChildren();
      if (!rows.length) list.append(element('p', 'Nenhum registro para este dia.'));
      if (pending.length) list.append(...pending.map(showItem));
      if (done.length) list.append(element('h2', 'Concluídos'), ...done.map(showItem));
    } catch {
      get('agenda-resumo').textContent = 'Não foi possível carregar a agenda neste navegador.';
      list.replaceChildren();
    }
  }

  function save(update) {
    try {
      const rows = update(load());
      localStorage.setItem(key, JSON.stringify(rows));
      notice.textContent = 'Agenda atualizada.';
      render();
      return true;
    } catch {
      notice.textContent = 'Não foi possível salvar a agenda neste navegador.';
      return false;
    }
  }

  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    values.titulo = values.titulo.trim();
    values.notas = values.notas.trim();
    if (!values.titulo || !Object.hasOwn(priorities, values.prioridade)) {
      notice.textContent = 'Preencha a tarefa e a prioridade.';
      return;
    }
    if (!save(rows => {
      if (!editing) return [...rows, { ...values, id: crypto.randomUUID(), feito: false }];
      if (!rows.some(row => row.id === editing)) throw Error('Registro indisponível.');
      return rows.map(row => row.id === editing ? { ...row, ...values } : row);
    })) return;
    day.value = values.dia;
    resetEditor();
    render();
  };

  get('agenda-cancelar').onclick = resetEditor;
  get('agenda-hoje').onclick = () => { day.value = today(); resetEditor(); render(); };
  day.onchange = () => { if (!day.value) day.value = today(); resetEditor(); render(); };
  window.addEventListener('storage', event => { if (event.key === key) render(); });
  day.value = today();
  resetEditor();
  render();
})();
