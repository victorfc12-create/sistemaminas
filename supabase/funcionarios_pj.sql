begin;
create table if not exists public.minas_pj_cadastros (
 func_id text primary key references public.funcionarios_cad(id),
 dados jsonb not null default '{}', condicoes jsonb not null default '{}',
 termo text not null default '', versao integer not null default 1,
 token_hash text, expira_em timestamptz,
 assinatura jsonb, atualizado_em timestamptz not null default now()
);
create table if not exists public.minas_pj_aceites (
 func_id text not null references public.minas_pj_cadastros, versao integer not null, assinatura jsonb not null,
 primary key(func_id,versao)
);
create table if not exists public.minas_pj_documentos (
 id uuid primary key default gen_random_uuid(), func_id text not null references public.minas_pj_cadastros,
 nome text not null, mime text not null, conteudo text not null,
 criado_em timestamptz not null default now()
);
create table if not exists public.minas_pj_pagamentos (
 id uuid primary key default gen_random_uuid(), func_id text not null references public.minas_pj_cadastros,
 referencia text not null, valor numeric(14,2) not null check(valor>0),
 forma text not null, pago_em date not null, comprovante uuid references public.minas_pj_documentos,
 confirmado_em timestamptz, confirmado_por text,
 criado_em timestamptz not null default now()
);
alter table public.minas_pj_cadastros enable row level security;
alter table public.minas_pj_aceites enable row level security;
alter table public.minas_pj_documentos enable row level security;
alter table public.minas_pj_pagamentos enable row level security;
revoke all on public.minas_pj_cadastros,public.minas_pj_aceites,public.minas_pj_documentos,public.minas_pj_pagamentos from anon,authenticated;
-- All operations pass through this function. The legacy browser login never grants HR access.
create or replace function public.minas_pj(p_acao text,p jsonb default '{}',p_token text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
 gestor boolean:=coalesce(auth.jwt()->'app_metadata'->>'minas_garantias'='gestor',false);
 fid text; c public.minas_pj_cadastros; token text; doc uuid; pg public.minas_pj_pagamentos;
 nome text; campos text[]; k text;
begin
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Formulário inválido'; end if;
 if octet_length(p::text)>7500000 then raise exception 'Arquivo ou formulário excede o limite'; end if;
 if gestor then
  fid:=p->>'func_id';
 else
  if p_token is null or length(p_token)<>64 then raise exception 'Link inválido ou expirado'; end if;
  select a.func_id into fid from public.minas_pj_cadastros a
   join public.funcionarios_cad f on f.id=a.func_id
   where a.token_hash=encode(digest(p_token,'sha256'),'hex') and a.expira_em>now() and f.ativo is not false;
  if fid is null then raise exception 'Link inválido ou expirado'; end if;
 end if;
 if p_acao='listar' and gestor then
  return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'nome',f.nome,'cargo',f.cargo,'salario_base',f.salario_base,
   'cadastrado',a.func_id is not null,'assinado',a.assinatura is not null,
   'aguardando',(select count(*) from public.minas_pj_pagamentos x where x.func_id=f.id and x.confirmado_em is null)) order by f.nome)
   from public.funcionarios_cad f left join public.minas_pj_cadastros a on a.func_id=f.id where f.ativo is not false),'[]');
 end if;
 if fid is null then raise exception 'Selecione o prestador'; end if;
 if p_acao='condicoes' and gestor then
  if jsonb_typeof(p->'condicoes') is distinct from 'object' then raise exception 'Condições inválidas'; end if;
  if coalesce(length(trim(p->>'termo')),0)<100 or coalesce(length(trim(p->'condicoes'->>'servicos')),0)<5
   or coalesce(p->'condicoes'->>'inicio','')='' or (p->'condicoes'->>'inicio')::date is null
   or coalesce((p->'condicoes'->>'valor')::numeric,-1)<0
   or coalesce((p->'condicoes'->>'dia')::integer,0) not between 1 and 31
   or coalesce(p->'condicoes'->>'forma','') not in ('PIX','TED','Transferência') then
   raise exception 'Preencha termo, serviços, valor, dia e forma de pagamento'; end if;
  insert into public.minas_pj_cadastros(func_id,condicoes,termo) values(fid,p->'condicoes',trim(p->>'termo'))
   on conflict(func_id) do update set condicoes=excluded.condicoes,termo=excluded.termo,
    versao=minas_pj_cadastros.versao+1,assinatura=null,atualizado_em=now();
  return jsonb_build_object('salvo',true);
 end if;
 select * into c from public.minas_pj_cadastros where func_id=fid for update;
 if not found then raise exception 'A gestão precisa cadastrar as condições PJ primeiro'; end if;
 if p_acao='link' and gestor then
  token:=encode(gen_random_bytes(32),'hex');
  update public.minas_pj_cadastros set token_hash=encode(digest(token,'sha256'),'hex'),expira_em=now()+interval '30 days' where func_id=fid;
  return jsonb_build_object('token',token);
 elsif p_acao='revogar' and gestor then
  update public.minas_pj_cadastros set token_hash=null,expira_em=null where func_id=fid;
  return jsonb_build_object('salvo',true);
 elsif p_acao='consultar' then
  return jsonb_build_object('nome',(select f.nome from public.funcionarios_cad f where f.id=fid),
   'dados',c.dados,'condicoes',c.condicoes,'termo',c.termo,'versao',c.versao,'assinatura',c.assinatura,
   'historico',coalesce((select jsonb_agg(a.assinatura order by a.versao desc) from public.minas_pj_aceites a where a.func_id=fid),'[]'),
   'documentos',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'nome',d.nome,'criado_em',d.criado_em)) from public.minas_pj_documentos d where d.func_id=fid),'[]'),
   'pagamentos',coalesce((select jsonb_agg(to_jsonb(x) order by x.pago_em desc,x.criado_em desc) from public.minas_pj_pagamentos x where x.func_id=fid),'[]'));
 elsif p_acao='cadastro' and not gestor then
  if c.assinatura is not null then raise exception 'Cadastro assinado. Solicite nova versão à gestão'; end if;
  if jsonb_typeof(p->'dados') is distinct from 'object' then raise exception 'Dados inválidos'; end if;
  campos:=array['razao_social','cnpj','representante','cpf','endereco','email','telefone','banco','agencia','conta','pix'];
  for k in select jsonb_object_keys(p->'dados') loop
   if not k=any(campos) or length(p->'dados'->>k)>500 then raise exception 'Campo inválido'; end if;
  end loop;
  if length(regexp_replace(p->'dados'->>'cnpj','\D','','g'))<>14
   or length(regexp_replace(p->'dados'->>'cpf','\D','','g'))<>11
   or coalesce(length(trim(p->'dados'->>'razao_social')),0)<3
   or coalesce(length(trim(p->'dados'->>'representante')),0)<3
   or coalesce(length(trim(p->'dados'->>'endereco')),0)<5
   or coalesce(length(trim(p->'dados'->>'email')),0)<5
   or coalesce(length(trim(p->'dados'->>'telefone')),0)<8 then raise exception 'Complete os dados obrigatórios'; end if;
  update public.minas_pj_cadastros set dados=p->'dados',atualizado_em=now() where func_id=fid;
  return jsonb_build_object('salvo',true);
 elsif p_acao='arquivo' then
  if coalesce(p->>'mime','') not in ('application/pdf','image/jpeg','image/png') or coalesce(length(p->>'nome'),0) not between 1 and 200
   or coalesce(octet_length(decode(p->>'conteudo','base64')),0) not between 1 and 5242880 then raise exception 'Envie PDF, JPG ou PNG de até 5 MB'; end if;
  insert into public.minas_pj_documentos(func_id,nome,mime,conteudo) values(fid,p->>'nome',p->>'mime',p->>'conteudo') returning id into doc;
  return jsonb_build_object('id',doc);
 elsif p_acao='baixar' then
  return (select jsonb_build_object('nome',d.nome,'mime',d.mime,'conteudo',d.conteudo) from public.minas_pj_documentos d where d.func_id=fid and d.id=(p->>'id')::uuid);
 elsif p_acao='assinar' and not gestor then
  if c.assinatura is not null then return c.assinatura; end if;
  if (p->>'versao')::integer is distinct from c.versao then raise exception 'O termo foi atualizado. Recarregue e leia novamente'; end if;
  nome:=trim(p->>'nome');
  if p->>'aceite' is distinct from 'true' or lower(nome) is distinct from lower(c.dados->>'representante') or coalesce(length(nome),0)<3
   or coalesce(length(c.dados->>'cnpj'),0)<14
   or not exists(select 1 from public.minas_pj_documentos d where d.func_id=fid)
   then raise exception 'Complete o cadastro, anexe um documento e informe o nome do representante'; end if;
  update public.minas_pj_cadastros set assinatura=jsonb_build_object('nome',nome,'em',now(),'versao',c.versao,
   'termo',c.termo,'condicoes',c.condicoes,'dados',c.dados,'sha256',encode(digest(c.termo||c.condicoes::text||c.dados::text,'sha256'),'hex')) where func_id=fid;
  insert into public.minas_pj_aceites(func_id,versao,assinatura) select func_id,versao,assinatura from public.minas_pj_cadastros where func_id=fid;
  return jsonb_build_object('salvo',true);
 elsif p_acao='pagar' and gestor then
  if coalesce((p->>'valor')::numeric,0)<=0 or coalesce(length(trim(p->>'referencia')),0)<3 or coalesce(p->>'forma','') not in ('PIX','TED','Transferência')
   or (p->>'pago_em')::date is null
   or (p->>'pago_em')::date>current_date then raise exception 'Confira os dados do pagamento realizado'; end if;
  doc:=(p->>'comprovante')::uuid;
  if not exists(select 1 from public.minas_pj_documentos d where d.id=doc and d.func_id=fid) then raise exception 'Anexe o comprovante do pagamento'; end if;
  insert into public.minas_pj_pagamentos(id,func_id,referencia,valor,forma,pago_em,comprovante)
   values((p->>'id')::uuid,fid,p->>'referencia',(p->>'valor')::numeric,p->>'forma',(p->>'pago_em')::date,doc)
   on conflict(id) do nothing;
  return jsonb_build_object('salvo',true);
 elsif p_acao='receber' and not gestor then
  select * into pg from public.minas_pj_pagamentos where id=(p->>'id')::uuid and func_id=fid for update;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if pg.confirmado_em is not null then return jsonb_build_object('salvo',true); end if;
  if p->>'aceite' is distinct from 'true' or lower(trim(p->>'nome')) is distinct from lower(c.dados->>'representante') or coalesce(length(trim(p->>'nome')),0)<3 then raise exception 'Informe seu nome e confirme o recebimento'; end if;
  update public.minas_pj_pagamentos set confirmado_em=now(),confirmado_por=trim(p->>'nome') where id=pg.id;
  return jsonb_build_object('salvo',true);
 end if;
 raise exception 'Operação não permitida';
end $$;
revoke all on function public.minas_pj(text,jsonb,text) from public;
grant execute on function public.minas_pj(text,jsonb,text) to anon,authenticated;
commit;
