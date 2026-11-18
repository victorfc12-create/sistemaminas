(() => {
  const el = id => document.getElementById(id);
  const token = new URLSearchParams(location.hash.slice(1)).get('acesso');
  const client = supabase.createClient(SUPA_URL, SUPA_KEY, {
    auth: { storageKey: token ? 'minas-pj-link-session' : 'minas-garantias-session', persistSession: !token, detectSessionInUrl: false }
  });
  let funcId;
  let detalhe;
  let gestor = false;
  let pagamentoId = crypto.randomUUID();
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const campos = {
    razao_social: 'Razão social', cnpj: 'CNPJ', representante: 'Nome do representante',
    cpf: 'CPF do representante', endereco: 'Endereço completo', email: 'E-mail',
    telefone: 'Telefone', banco: 'Banco', agencia: 'Agência', conta: 'Conta', pix: 'Chave Pix'
  };
  const obrigatorios = ['razao_social', 'cnpj', 'representante', 'cpf', 'endereco', 'email', 'telefone'];
  const termoPadrao = `TERMO DE PRESTAÇÃO DE SERVIÇOS ENTRE PESSOAS JURÍDICAS

A Minas Automóveis Ltda., CNPJ 25.403.680/0001-15, representada por Victor Fagundes Carvalho, e a pessoa jurídica identificada no cadastro aceitam as condições abaixo, juntamente com os serviços, valores, prazos e forma de pagamento exibidos neste instrumento.

1. Serviços e execução
A contratada executará os serviços descritos nas condições acordadas, com autonomia técnica e organizacional compatível com a atividade. As partes combinarão os resultados, prazos e os meios de acesso necessários à prestação.

2. Remuneração e pagamento
A Minas pagará o valor acordado, com as comissões expressamente descritas, mediante o documento fiscal exigível. O pagamento será feito na data e pela forma indicadas nas condições, nos dados informados pela contratada. Quando o vencimento cair em dia sem expediente bancário, o pagamento ocorrerá no próximo dia útil. Alterações de valor e condições dependerão de novo acordo registrado.

3. Documentos e obrigações
A contratada manterá seus dados atualizados e será responsável pelas obrigações fiscais e empresariais que lhe couberem. As partes cumprirão as responsabilidades legais aplicáveis à atividade e à execução dos serviços.

4. Natureza da contratação
As partes manifestam a intenção de contratar serviços entre pessoas jurídicas. A execução deverá corresponder às condições efetivamente ajustadas, observada a legislação aplicável. Este instrumento preserva os direitos previstos em lei.

5. Sigilo e dados
A contratada utilizará dados de clientes e informações comerciais apenas na execução dos serviços, adotará cuidado para impedir acesso indevido e comunicará incidentes à Minas. Ao encerrar a prestação, devolverá os documentos, acessos e informações da contratante sob sua guarda.

6. Vigência e encerramento
A prestação terá início na data indicada nas condições e vigorará por prazo indeterminado, salvo prazo diferente expressamente informado. Qualquer parte poderá propor o encerramento por escrito, com aviso de 15 dias. Serão apurados os serviços prestados, os valores devidos e a devolução dos materiais e acessos.

7. Aceite e recibos
O representante da contratada declara que tem poderes para representá-la, leu este termo e concorda com as condições e a forma de pagamento exibidas. O sistema registrará nome, data, hora e versão do aceite. Após cada pagamento, a contratada poderá confirmar o recebimento do valor e da referência indicados. Essa confirmação se limita ao pagamento identificado.

Local do contrato: Belo Horizonte, MG.`;

  const servicosPorTipo = {
    vendedor: 'Atendimento comercial a interessados em veículos, apresentação dos veículos e das condições comerciais aprovadas pela Minas, acompanhamento das propostas e do relacionamento com os clientes e atualização dos registros de atendimento e vendas. Compromissos comerciais, descontos e contratação em nome da Minas dependem de autorização expressa da contratante.',
    administrativo: 'Organização e conferência de documentos, atualização de cadastros e registros administrativos, apoio ao controle de contas a pagar e a receber e acompanhamento de documentos e rotinas administrativas da Minas. Pagamentos, movimentações bancárias e contratação em nome da Minas dependem de autorização expressa da contratante.'
  };
  function tipoDoPrestador(prestador) {
    const cargo = (prestador.cargo || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const nome = (prestador.nome || '').trim().toUpperCase();
    if (cargo.includes('administrativ') || ['EMILIN', 'EMILIN MARQUES', 'EMILLI', 'EMILLI MARQUES', 'EMILIN ADMINISTRATIVO'].includes(nome)) return 'administrativo';
    if (cargo.includes('vendedor') || cargo.includes('vendedora')) return 'vendedor';
    return 'geral';
  }
  function aplicarModelo(tipo) {
    const form = el('condicoes');
    form.elements.termo_tipo.value = tipo;
    const titulos = {
      vendedor: 'TERMO DE PRESTAÇÃO DE SERVIÇOS DE VENDAS',
      administrativo: 'TERMO DE PRESTAÇÃO DE SERVIÇOS ADMINISTRATIVOS',
      geral: 'TERMO DE PRESTAÇÃO DE SERVIÇOS ENTRE PESSOAS JURÍDICAS'
    };
    form.elements.termo.value = termoPadrao.replace('TERMO DE PRESTAÇÃO DE SERVIÇOS ENTRE PESSOAS JURÍDICAS', titulos[tipo]);
    form.elements.servicos.value = servicosPorTipo[tipo] || '';
  }

  function node(tag, text) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const dataHora = value => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  async function rpc(acao, p = {}) {
    const result = await client.rpc('minas_pj', { p_acao: acao, p: { ...p, func_id: funcId }, p_token: token });
    if (result.error) throw Error(result.error.message);
    return result.data;
  }
  async function tarefa(work) {
    const buttons = [...document.querySelectorAll('button')];
    buttons.forEach(b => b.disabled = true);
    el('status').textContent = 'Processando…';
    try { await work(); el('status').textContent = 'Atualizado com sucesso.'; }
    catch (error) {
      el('status').textContent = /minas_pj|schema cache/i.test(error.message)
        ? 'O módulo PJ aguarda ativação no banco de dados. Nenhum registro foi enviado.' : error.message;
    } finally { buttons.forEach(b => b.disabled = false); }
  }
  function dadosForm(id) { return Object.fromEntries(new FormData(el(id))); }
  async function arquivo(file) {
    if (!file || !['application/pdf','image/jpeg','image/png'].includes(file.type) || !file.size || file.size > 5242880) {
      throw Error('Selecione PDF, JPG ou PNG de até 5 MB.');
    }
    const conteudo = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(Error('Falha ao ler arquivo.'));
      reader.readAsDataURL(file);
    });
    return (await rpc('arquivo', { nome: file.name, mime: file.type, conteudo })).id;
  }
  async function baixar(id) {
    const d = await rpc('baixar', { id });
    if (!d) throw Error('Documento indisponível.');
    const bytes = Uint8Array.from(atob(d.conteudo), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: d.mime }));
    const a = node('a'); a.href = url; a.download = d.nome; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function botao(text, work) {
    const b = node('button', text); b.type = 'button'; b.onclick = () => tarefa(work); return b;
  }
  function condicoesTexto(d) {
    const c = d.condicoes;
    return `Contratada: ${d.dados.razao_social || 'Cadastro pendente'}\nCNPJ: ${d.dados.cnpj || 'Pendente'}\nRepresentante: ${d.dados.representante || 'Pendente'}\nCPF: ${d.dados.cpf || 'Pendente'}\nEndereço: ${d.dados.endereco || 'Pendente'}\nContato: ${d.dados.email || ''} · ${d.dados.telefone || ''}\nBanco: ${d.dados.banco || ''} · Agência: ${d.dados.agencia || ''} · Conta: ${d.dados.conta || ''}\nPix: ${d.dados.pix || ''}\n\nServiços: ${c.servicos}\nValor mensal: ${moeda.format(c.valor)}\nVencimento: dia ${c.dia}\nForma: ${c.forma}\nInício: ${c.inicio}\nCondições adicionais: ${c.adicionais || 'Nenhuma'}\nVersão: ${d.versao}\n\n${d.termo}`;
  }
  async function consultar() {
    detalhe = await rpc('consultar');
    el('detalhes').hidden = false;
    el('termo').textContent = condicoesTexto(detalhe);
    el('assinatura').textContent = detalhe.assinatura
      ? `Aceite de ${detalhe.assinatura.nome} em ${dataHora(detalhe.assinatura.em)} · Versão ${detalhe.assinatura.versao}`
      : 'Aguardando assinatura do representante.';
    el('assinar').hidden = gestor || !!detalhe.assinatura;
    el('arquivos').replaceChildren(...detalhe.documentos.map(d => botao(d.nome, () => baixar(d.id))));
    el('historico').replaceChildren(...(detalhe.historico || []).map(a => node('p',
      `Versão ${a.versao} · ${a.nome} · ${dataHora(a.em)} · Registro ${a.sha256}`)));
    el('recebimentos').replaceChildren(...detalhe.pagamentos.map(p => {
      const box = node('section');
      box.append(node('h3', `${p.referencia} · ${moeda.format(p.valor)}`), node('p', `Pago em ${p.pago_em.split('-').reverse().join('/')} · ${p.forma}`));
      if (p.comprovante) box.append(botao('Baixar comprovante', () => baixar(p.comprovante)));
      if (p.confirmado_em) box.append(node('p', `Recebido por ${p.confirmado_por} em ${dataHora(p.confirmado_em)}`));
      else if (gestor) box.append(node('p', 'Aguardando confirmação do prestador.'));
      else {
        const form = node('form');
        const name = node('input'); name.placeholder = 'Seu nome completo'; name.required = true;
        const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.required = true;
        label.append(check, document.createTextNode(` Confirmo que recebi ${moeda.format(p.valor)} referente a ${p.referencia}.`));
        const submit = node('button', 'Dar recebido'); form.append(name, label, submit);
        form.onsubmit = e => { e.preventDefault(); tarefa(async () => { await rpc('receber', { id: p.id, nome: name.value, aceite: check.checked }); await consultar(); }); };
        box.append(form);
      }
      return box;
    }));
    if (!detalhe.pagamentos.length) el('recebimentos').textContent = 'Nenhum pagamento registrado para confirmação.';
    if (gestor) {
      for (const [key, value] of Object.entries(detalhe.condicoes)) if (el('condicoes').elements[key]) el('condicoes').elements[key].value = value;
      el('condicoes').elements.termo.value = detalhe.termo;
    } else {
      for (const key of Object.keys(campos)) {
        el('dados').elements[key].value = detalhe.dados[key] || '';
        el('dados').elements[key].disabled = !!detalhe.assinatura;
      }
    }
  }
  async function lista() {
    const rows = await rpc('listar');
    el('lista').replaceChildren(...rows.map(r => {
      const tr = node('tr');
      tr.append(...[r.nome, moeda.format(r.salario_base || 0), r.assinado ? 'Assinado' : r.cadastrado ? 'Pendente' : 'Configurar PJ', r.aguardando].map(v => node('td',v)));
      const td = node('td'); td.append(botao('Abrir', async () => {
        funcId = r.id; detalhe = null; el('selecionado').textContent = r.nome; el('url').value = '';
        el('condicoes').reset(); el('pagamento').reset(); pagamentoId = crypto.randomUUID();
        aplicarModelo(tipoDoPrestador(r));
        el('condicoes').elements.valor.value = r.salario_base || 0;
        el('condicoes').elements.dia.value = 5;
        el('detalhes').hidden = true;
        if (r.cadastrado) await consultar();
        el('condicoes').scrollIntoView({ behavior: 'smooth' });
      })); tr.append(td); return tr;
    }));
  }
  for (const [key, label] of Object.entries(campos)) {
    const div = node('div'); const lab = node('label', label + (obrigatorios.includes(key) ? ' *' : ''));
    lab.htmlFor = `d-${key}`;
    const input = node('input'); input.id = `d-${key}`; input.name = key; input.maxLength = 500; input.required = obrigatorios.includes(key);
    if (key === 'email') input.type = 'email';
    div.append(lab,input); el('campos').append(div);
  }
  el('aplicar-modelo').onclick = () => aplicarModelo(el('condicoes').elements.termo_tipo.value);
  el('atualizar').onclick = () => tarefa(lista);
  el('condicoes').onsubmit = e => { e.preventDefault(); tarefa(async () => {
    if (!funcId) throw Error('Selecione um prestador.');
    const c = dadosForm('condicoes'); const termo = c.termo; delete c.termo;
    await rpc('condicoes', { condicoes: c, termo }); await consultar(); await lista();
  }); };
  el('link').onclick = () => tarefa(async () => {
    const result = await rpc('link'); const url = new URL(location.href); url.hash = new URLSearchParams({ acesso: result.token });
    el('url').value = url.href; el('url').focus(); el('url').select();
  });
  el('revogar').onclick = () => tarefa(async () => { await rpc('revogar'); el('url').value = ''; });
  el('dados').onsubmit = e => { e.preventDefault(); tarefa(async () => { await rpc('cadastro', { dados: dadosForm('dados') }); await consultar(); }); };
  el('documento').onsubmit = e => { e.preventDefault(); tarefa(async () => { await arquivo(el('documento').elements.arquivo.files[0]); el('documento').reset(); await consultar(); }); };
  el('assinar').onsubmit = e => { e.preventDefault(); tarefa(async () => {
    await rpc('assinar', { nome: el('assinar').elements.nome.value, aceite: el('assinar').elements.aceite.checked, versao: detalhe.versao }); await consultar();
  }); };
  el('pagamento').onsubmit = e => { e.preventDefault(); tarefa(async () => {
    if (!funcId) throw Error('Selecione um prestador.');
    const comprovante = await arquivo(el('pagamento').elements.arquivo.files[0]);
    const p = dadosForm('pagamento'); delete p.arquivo;
    await rpc('pagar', { ...p, comprovante, id: pagamentoId }); pagamentoId = crypto.randomUUID();
    el('pagamento').reset(); await consultar(); await lista();
  }); };
  tarefa(async () => {
    if (token) { el('cadastro').hidden = false; await consultar(); return; }
    const { data: { session } } = await client.auth.getSession();
    gestor = session?.user?.app_metadata?.minas_garantias === 'gestor';
    if (!gestor) throw Error('Entre com seu acesso de gestor no Portal de Garantias e abra esta página novamente.');
    el('gestao').hidden = false; await lista();
  });
})();
