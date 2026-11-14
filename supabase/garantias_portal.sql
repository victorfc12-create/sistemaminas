begin;

create table public.garantia_chamados (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  nome text,
  contato text,
  veiculo text,
  compra date,
  ocorrido_em timestamptz,
  relato text,
  arquivos text[] not null default '{}',
  status text not null default 'rascunho'
    check (status in ('rascunho','recebida','em_analise','aprovada','recusada','concluida')),
  resposta text,
  parecer text,
  aberto_em timestamptz,
  criado_em timestamptz not null default now()
);

create table public.garantia_horarios (
  id uuid primary key default gen_random_uuid(),
  inicio timestamptz not null unique,
  chamado uuid unique references public.garantia_chamados(id)
);

alter table public.garantia_chamados enable row level security;
alter table public.garantia_horarios enable row level security;

create function public.garantia_equipe()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt()->'app_metadata'->>'minas_garantias' in ('gestor','vendedor'),false)
$$;
create function public.garantia_gestor()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt()->'app_metadata'->>'minas_garantias' = 'gestor',false)
$$;

revoke all on public.garantia_chamados,public.garantia_horarios from anon,authenticated;
grant select,insert on public.garantia_chamados to authenticated;
grant update(status,resposta) on public.garantia_chamados to authenticated;
grant select,insert on public.garantia_horarios to authenticated;

create policy chamados_equipe on public.garantia_chamados for select to authenticated
  using (public.garantia_equipe());
create policy chamado_novo on public.garantia_chamados for insert to authenticated
  with check (public.garantia_equipe() and status='rascunho' and nome is null and contato is null
    and veiculo is null and compra is null and ocorrido_em is null and relato is null
    and arquivos='{}' and aberto_em is null and parecer is null and resposta is null);
create policy decidir_chamado on public.garantia_chamados for update to authenticated
  using (public.garantia_gestor() and aberto_em is not null)
  with check (public.garantia_gestor() and status in ('em_analise','aprovada','recusada','concluida')
    and (status not in ('aprovada','recusada') or coalesce(length(trim(resposta)),0)>0));
create policy horarios_leitura on public.garantia_horarios for select to authenticated using (public.garantia_equipe());
create policy horarios_cadastro on public.garantia_horarios for insert to authenticated
  with check (public.garantia_gestor() and chamado is null and inicio>now());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('garantia-evidencias','garantia-evidencias',false,26214400,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']);

create function public.garantia_upload_permitido(pasta text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.garantia_chamados g
    where g.token::text=pasta and g.status='rascunho' and g.criado_em>now()-interval '7 days')
$$;
revoke execute on function public.garantia_upload_permitido(text) from public;
grant execute on function public.garantia_upload_permitido(text) to anon,authenticated;
create policy midia_cliente on storage.objects for insert to anon,authenticated
  with check (bucket_id='garantia-evidencias'
    and array_length(storage.foldername(name),1)=1
    and public.garantia_upload_permitido((storage.foldername(name))[1]));
create policy midia_equipe on storage.objects for select to authenticated
  using (bucket_id='garantia-evidencias' and public.garantia_equipe());

create function public.garantia_cliente(p_token uuid,p_acao text,p_dados jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  g public.garantia_chamados%rowtype;
  anexos text[];
  nome_cliente text := trim(p_dados->>'nome');
  telefone text := trim(p_dados->>'contato');
  carro text := trim(p_dados->>'veiculo');
  historia text := trim(p_dados->>'relato');
  horarios jsonb := '[]';
  agendado timestamptz;
begin
  select * into g from public.garantia_chamados where token=p_token for update;
  if not found or (g.status='rascunho' and g.criado_em<=now()-interval '7 days') then
    raise exception 'Link inválido ou expirado';
  end if;
  if p_acao='enviar' and g.status='rascunho' then
    if coalesce(length(nome_cliente),0) not between 2 and 120 or coalesce(length(telefone),0) not between 8 and 30
      or coalesce(length(carro),0) not between 2 and 120 or coalesce(length(historia),0) not between 5 and 8000
      or nullif(p_dados->>'ocorrido_em','') is null then
      raise exception 'Confira os dados da solicitação';
    end if;
    select coalesce(array_agg(a), '{}') into anexos
      from jsonb_array_elements_text(coalesce(p_dados->'arquivos','[]')) a;
    if cardinality(anexos)>4 or exists(select 1 from unnest(anexos) a
      where split_part(a,'/',1)<>p_token::text or not exists(select 1 from storage.objects
        where bucket_id='garantia-evidencias' and name=a)) then
      raise exception 'Anexos inválidos';
    end if;
    update public.garantia_chamados set nome=nome_cliente,contato=telefone,veiculo=carro,
      compra=nullif(p_dados->>'compra','')::date, ocorrido_em=(p_dados->>'ocorrido_em')::timestamptz,
      relato=historia,arquivos=anexos,status='recebida',aberto_em=now()
      where id=g.id returning * into g;
  elsif p_acao='agendar' then
    if g.status<>'aprovada' then raise exception 'O agendamento depende da aprovação'; end if;
    if not exists(select 1 from public.garantia_horarios where chamado=g.id) then
      update public.garantia_horarios set chamado=g.id
        where id=(p_dados->>'horario')::uuid and chamado is null and inicio>now();
      if not found then raise exception 'Horário indisponível. Atualize e escolha outro.'; end if;
    end if;
  elsif p_acao not in ('consultar','enviar') or p_acao is null then
    raise exception 'Solicitação inválida';
  end if;
  select inicio into agendado from public.garantia_horarios where chamado=g.id;
  if g.status='aprovada' and agendado is null then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'inicio',inicio) order by inicio),'[]') into horarios
    from public.garantia_horarios where chamado is null and inicio>now();
  end if;
  return jsonb_build_object('protocolo',g.id,'status',g.status,'resposta',g.resposta,'enviado',g.aberto_em,
     'horarios',horarios,'agendado',agendado);
end;
$$;
revoke execute on function public.garantia_cliente(uuid,text,jsonb) from public;
grant execute on function public.garantia_cliente(uuid,text,jsonb) to anon,authenticated;
commit;
