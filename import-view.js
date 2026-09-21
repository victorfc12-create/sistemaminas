// Dados de origem ficam no banco do cliente, nunca neste arquivo público.
function renderImportedSource() {
  let box = document.getElementById('imported-source');
  if (!box) {
    box = document.createElement('details');
    box.id = 'imported-source';
    box.className = 'sec-box';
    document.getElementById('dash-content').appendChild(box);
  }
  const data = activeMonth?.importacao_planilha;
  box.replaceChildren();
  box.hidden = !data;
  if (!data) return;
  const title = document.createElement('summary');
  title.textContent = 'Planilha importada — dados completos e anotações';
  title.style.cssText = 'cursor:pointer;font-weight:700;padding:12px 0';
  box.appendChild(title);
  const note = document.createElement('p');
  note.textContent = 'Cópia da planilha na data da importação. Os lançamentos e saldos atuais estão nas demais telas. Valores ausentes não foram estimados. Os controles auxiliares foram preservados abaixo e não são somados novamente aos totais.';
  box.appendChild(note);
  const link = document.createElement('a');
  link.href = 'https://docs.google.com/spreadsheets/d/1WvEWXA2NoNxjHMSHRkz-PI-BESEF6qpah-Xhz_7HazM/edit#gid=352980937';
  link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Abrir planilha de origem';
  box.appendChild(link);
  const warnings = document.createElement('p');
  warnings.textContent = 'Atenção: a origem contém vendas sem data ou preço final, lucro do C3 não informado e divergência do KA QBZ-6B53 com o histórico anterior. Consulte as descrições originais antes de completar esses valores.';
  box.appendChild(warnings);
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap'; wrap.style.maxHeight = '560px';
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const label of ['Linha', ...'ABCDEFGHIJKLMNOPQR']) {
    const th = document.createElement('th'); th.textContent = label; hr.appendChild(th);
  }
  head.appendChild(hr); table.appendChild(head);
  const body = document.createElement('tbody');
  for (let row = 1; row <= 171; row++) {
    const cells = [...'ABCDEFGHIJKLMNOPQR'].map(col => data.source_cells?.[col + row]);
    if (!cells.some(Boolean)) continue;
    const tr = document.createElement('tr');
    const number = document.createElement('th'); number.textContent = row; tr.appendChild(number);
    cells.forEach(cell => {
      const td = document.createElement('td');
      td.textContent = cell?.formatted ?? cell?.value ?? '';
      td.style.cssText = 'min-width:110px;max-width:400px;white-space:pre-wrap;vertical-align:top';
      if (cell?.formula) td.title = 'Fórmula na origem: ' + cell.formula;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  table.appendChild(body); wrap.appendChild(table); box.appendChild(wrap);
}
