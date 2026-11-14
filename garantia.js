const portal = supabase.createClient(SUPA_URL, SUPA_KEY, {auth:{storageKey:'minas-garantias-session'}});
const el = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('chamado');
const staff = new URLSearchParams(location.search).get('equipe') === '1';
const bucket = portal.storage.from('garantia-evidencias');
const estados = {rascunho:'Aguardando envio',recebida:'Solicitação recebida',em_analise:'Em análise',aprovada:'Aprovada',recusada:'Recusada',concluida:'Concluída'};
const bh = value => value + ':00-03:00';
const dataHora = value => new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value));
let timer;
let gestor = false;
let ultimaLista;
const arquivosEnviados = new WeakMap();

function node(tag, label) {
  const element = document.createElement(tag);
  if(label !== undefined) element.textContent = label;
  return element;
}

async function executar(action, button) {
  if(button) button.disabled = true;
  el('feedback').textContent = '';
  try { await action(); }
  catch(error) { el('feedback').textContent = error.message || 'Tente novamente.'; }
  finally { if(button) button.disabled = false; }
}

async function cliente(acao, dados={}) {
  const {data,error} = await portal.rpc('garantia_cliente',{p_token:token,p_acao:acao,p_dados:dados});
  if(error) throw error;
  el('solicitacao').hidden = data.status !== 'rascunho';
  const acompanhamento = el('andamento');
  acompanhamento.hidden = data.status === 'rascunho';
  acompanhamento.replaceChildren(node('h2',estados[data.status]),node('p','Protocolo '+data.protocolo));
  if(data.enviado) acompanhamento.append(node('p','Recebido em '+dataHora(data.enviado)));
  if(data.resposta) acompanhamento.append(node('p',data.resposta));
  if(data.agendado) acompanhamento.append(node('p','Agendado para '+dataHora(data.agendado)));
  const agenda = el('agenda');
  agenda.hidden = !data.horarios.length;
  agenda.elements.horario.replaceChildren(...data.horarios.map(h=>new Option(dataHora(h.inicio),h.id)));
  if(data.status==='aprovada'&&!data.agendado&&!data.horarios.length) {
    acompanhamento.append(node('p','A loja ainda vai disponibilizar horários para receber o veículo.'));
  }
  if(!acompanhamento.hidden) {
    const atualizar=node('button','Atualizar andamento');
    atualizar.onclick=()=>executar(()=>cliente('consultar'),atualizar);
    acompanhamento.append(atualizar);
  }
}

el('solicitacao').onsubmit = event => {
  event.preventDefault();
  executar(async () => {
    const dados = Object.fromEntries(new FormData(event.target));
    const arquivos = Array.from(el('midias').files);
    const tipos = ['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'];
    if(arquivos.length>4 || arquivos.some(f=>!tipos.includes(f.type)||f.size>26214400)) {
      throw Error('Selecione até 4 fotos ou vídeos de até 25 MB cada.');
    }
    dados.ocorrido_em = bh(dados.ocorrido_em);
    dados.arquivos = [];
    for(const arquivo of arquivos) {
      let caminho = arquivosEnviados.get(arquivo);
      if(!caminho) {
        caminho = token+'/'+crypto.randomUUID();
        const {error} = await bucket.upload(caminho,arquivo,{contentType:arquivo.type});
        if(error) throw error;
        arquivosEnviados.set(arquivo,caminho);
      }
      dados.arquivos.push(caminho);
    }
    await cliente('enviar',dados);
    event.target.reset();
  },event.submitter);
};

el('agenda').onsubmit = event => {
  event.preventDefault();
  executar(()=>cliente('agendar',{horario:event.target.elements.horario.value}),event.submitter);
};

async function listar() {
  const {data,error} = await portal.from('garantia_chamados').select('id,token,nome,contato,veiculo,compra,ocorrido_em,relato,arquivos,status,resposta,parecer,aberto_em').order('criado_em',{ascending:false});
  if(error) throw error;
  const recebidos = new Set(data.filter(g=>g.aberto_em).map(g=>g.id));
  const novas = ultimaLista ? [...recebidos].filter(id=>!ultimaLista.has(id)).length : data.filter(g=>g.status==='recebida').length;
  if(novas) el('novidades').textContent=novas===1?'Nova solicitação de garantia.':novas+' novas solicitações de garantia.';
  ultimaLista=recebidos;
  const {data: reservas,error: erroAgenda}=await portal.from('garantia_horarios').select('inicio,chamado').not('chamado','is',null);
  if(erroAgenda) throw erroAgenda;
  const agendamentos=new Map(reservas.map(r=>[r.chamado,r.inicio]));
  const lista=el('chamados');
  if(lista.querySelector('details[open]')) return;
  const abertos=new Set([...lista.querySelectorAll('details[open]')].map(d=>d.id));
  lista.replaceChildren(...data.map(g=>cartao(g,abertos.has(g.id),agendamentos.get(g.id))));
}

function cartao(g, aberto, agendado) {
  const card=node('article');
  const details=node('details'); details.id=g.id; details.open=aberto;
  details.append(node('summary',(g.veiculo||'Link aguardando envio')+' · '+estados[g.status]));
  details.append(node('p','Protocolo '+g.id));
  if(agendado) details.append(node('p','Recebimento agendado para '+dataHora(agendado)));
  if(g.status==='rascunho') {
    const link=node('a','Abrir link do cliente');link.href=linkCliente(g.token);details.append(link);
  } else {
    details.append(node('p',g.nome+' · '+g.contato),node('p','Ocorrência em '+dataHora(g.ocorrido_em)+'\nRecebido em '+dataHora(g.aberto_em)),node('p',g.relato));
    g.arquivos.forEach((arquivo,i)=>{
      const b=node('button','Abrir anexo '+(i+1));
      b.onclick=()=>executar(async()=>{
        const {data,error}=await bucket.createSignedUrl(arquivo,120);
        if(error) throw error;
        const link=node('a','Visualizar anexo '+(i+1));
        link.href=data.signedUrl;link.target='_blank';link.rel='noopener noreferrer';b.replaceWith(link);
      },b);
      details.append(b);
    });
    if(gestor) {
      details.append(node('h3','Triagem interna'),node('p',g.parecer||'Parecer pendente.'));
      const ia=node('button','Analisar com IA');
      ia.onclick=()=>executar(async()=>{
        const {error}=await portal.functions.invoke('garantias-analise',{body:{id:g.id}});
        if(error) throw error;
        details.open=false;
        await listar();
      },ia);
      details.append(ia);
      const form=node('form');
      const status=node('select');status.setAttribute('aria-label','Situação');
      ['em_analise','aprovada','recusada','concluida'].forEach(s=>status.add(new Option(estados[s],s)));
      status.value=g.status==='recebida'?'em_analise':g.status;
      const resposta=node('textarea');resposta.setAttribute('aria-label','Resposta ao cliente');resposta.placeholder='Resposta visível ao cliente';resposta.value=g.resposta||'';resposta.maxLength=4000;
      form.append(status,resposta,node('button','Salvar decisão'));
      form.onsubmit=e=>{
        e.preventDefault();
        executar(async()=>{
          const {error}=await portal.from('garantia_chamados').update({status:status.value,resposta:resposta.value.trim()}).eq('id',g.id).select('id').single();
          if(error) throw error;
          details.open=false;
          await listar();
        },e.submitter);
      };
      details.append(form);
    }
  }
  card.append(details);
  return card;
}

function linkCliente(value) {
  return location.origin+location.pathname+'#chamado='+value;
}

async function sessao() {
  clearInterval(timer);
  const {data:{user}}=await portal.auth.getUser();
  gestor=user?.app_metadata?.minas_garantias==='gestor';
  const autorizado=gestor||user?.app_metadata?.minas_garantias==='vendedor';
  el('login').hidden=Boolean(autorizado);
  el('gestao').hidden=!autorizado;
  el('abrir-horario').hidden=!gestor;
  if(!autorizado) {
    if(user) throw Error('Esta conta não tem acesso às garantias da loja.');
    return;
  }
  await listar();
  timer=setInterval(()=>listar().catch(()=>{}),15000);
}

el('gerar').onclick = () => executar(async()=>{
  const {data,error}=await portal.from('garantia_chamados').insert({status:'rascunho'}).select('token').single();
  if(error) throw error;
  const link=linkCliente(data.token);
  const output=node('a',link);output.href=link;
  el('novo-link').replaceChildren(output);
  try { await navigator.clipboard.writeText(link); el('feedback').textContent='Link copiado para enviar ao cliente.'; } catch {}
  await listar();
},el('gerar'));
el('atualizar').onclick = () => executar(listar,el('atualizar'));
el('sair').onclick = () => executar(async()=>{await portal.auth.signOut();await sessao();},el('sair'));
el('login').onsubmit = e => {
  e.preventDefault();
  executar(async()=>{
    const {error}=await portal.auth.signInWithPassword(Object.fromEntries(new FormData(e.target)));
    if(error) throw error;
    e.target.reset();
    await sessao();
  },e.submitter);
};
el('abrir-horario').onsubmit = e => {
  e.preventDefault();
  executar(async()=>{
    const {error}=await portal.from('garantia_horarios').insert({inicio:bh(e.target.elements.inicio.value)});
    if(error) throw error;
    el('feedback').textContent='Horário disponível para clientes aprovados.';
    e.target.reset();
  },e.submitter);
};

if(staff && !token) {
  el('equipe').hidden=false;
  executar(sessao);
} else if(token && /^[a-f0-9-]{36}$/i.test(token)) {
  el('cliente').hidden=false;
  executar(()=>cliente('consultar'));
} else {
  el('feedback').textContent='Abra o link individual enviado pela Minas Automóveis.';
}
