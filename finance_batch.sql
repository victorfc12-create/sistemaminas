-- One transaction for expenses, bank balances and audit trail.
-- SECURITY INVOKER: uses the caller's existing table permissions and RLS.
create or replace function public.minas_save_expenses(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  mid text := p->>'mes_id'; rid text := p->>'request_id';
  item jsonb; oldrow jsonb; newrow jsonb; live jsonb; marker jsonb; b record;
  tbl text; bid text; rowid bigint; delta numeric; balance numeric;
  refdate date; month_name text; month_num int; year_num int;
  payload_hash text := md5(p::text); total numeric := 0; count_items int := 0;
  allowed text[] := array['anuncios','impostos','despesas_gerais','despesas_fixas','despesas_pessoais','operacionais','multas','veic_vendidos','gasolina'];
  months text[] := array['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  closed boolean;
begin
  if rid is null or rid !~ '^[0-9a-f-]{36}$' or mid is null then raise exception 'Identificação do lançamento inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended('minas-batch:'||rid,0));
  select obs::jsonb into marker from historico_geral where tipo='lote_despesas' and descricao=rid limit 1;
  if found then
    if marker->>'hash' <> payload_hash then raise exception 'Este lote já foi usado com outros valores'; end if;
    return marker->'result';
  end if;
  select fechado,nome into closed,month_name from meses where id=mid for update;
  if not found then raise exception 'Mês não encontrado ou sem acesso'; end if;
  if closed then raise exception 'Mês fechado. Selecione um mês aberto'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items')>200 then raise exception 'Lista inválida (máximo 200 lançamentos)'; end if;
  if p->>'mode' not in ('append','edit') or p->>'mode' is null then raise exception 'Operação inválida'; end if;
  refdate := (p->>'data_ref')::date;
  if refdate is null then raise exception 'Informe a data'; end if;
  month_num := array_position(months,split_part(upper(trim(month_name)),' ',1));
  year_num := substring(month_name from '(20[0-9]{2})')::int;
  if p->>'mode'='append' and (month_num is null or year_num is null or extract(month from refdate)<>month_num or extract(year from refdate)<>year_num) then
    raise exception 'A data deve pertencer ao mês selecionado';
  end if;
  -- Stable lock order even when an edit changes several banks.
  for b in select id from bancos where id in (
    select x->'before'->>'banco_id' from jsonb_array_elements(p->'items') x
    union select x->'after'->>'banco_id' from jsonb_array_elements(p->'items') x
  ) order by id for update loop null; end loop;
  for item in select value from jsonb_array_elements(p->'items') loop
    tbl:=item->>'table'; oldrow:=nullif(item->'before','null'::jsonb); newrow:=nullif(item->'after','null'::jsonb);
    if tbl is null or not(tbl=any(allowed)) then raise exception 'Categoria inválida'; end if;
    if oldrow is null and newrow is null then raise exception 'Lançamento vazio'; end if;
    if p->>'mode'='append' and oldrow is not null then raise exception 'Lote novo não pode alterar registros existentes'; end if;
    if oldrow is not null then
      execute format('select jsonb_build_object(''id'',id::text,''nome'',coalesce(nome,''''),''valor'',coalesce(valor,0),''banco_id'',banco_id,''tipo_pag'',tipo_pag) from public.%I where id=$1 and mes_id=$2 for update',tbl)
        into live using (oldrow->>'id')::bigint,mid;
      if live is distinct from oldrow then raise exception 'Um lançamento foi alterado em outra tela. Recarregue antes de salvar'; end if;
    end if;
    if newrow is not null then
      if nullif(trim(newrow->>'nome'),'') is null or length(newrow->>'nome')>500 or newrow->>'nome' ~ '[<>]' then raise exception 'Descrição inválida'; end if;
      if (newrow->>'valor') is null or (newrow->>'valor')::numeric::text in ('NaN','Infinity','-Infinity') or abs((newrow->>'valor')::numeric)>999999999.99 or round((newrow->>'valor')::numeric,2)<>(newrow->>'valor')::numeric then raise exception 'Valor inválido'; end if;
      if p->>'mode'='append' and ((newrow->>'valor')::numeric<=0 or nullif(newrow->>'banco_id','') is null) then raise exception 'Informe banco e valor positivo'; end if;
      if newrow->>'tipo_pag' is not null and newrow->>'tipo_pag' not in ('PIX','TED','Cartão','Financiamento','Outros') then raise exception 'Forma de pagamento inválida'; end if;
    end if;
    for bid in select distinct v from (values (oldrow->>'banco_id'),(newrow->>'banco_id')) ids(v) where v is not null loop
      delta:=case when oldrow->>'banco_id'=bid then coalesce((oldrow->>'valor')::numeric,0) else 0 end
             -case when newrow->>'banco_id'=bid then coalesce((newrow->>'valor')::numeric,0) else 0 end;
      select saldo into balance from bancos where id=bid;
      if not found then raise exception 'Banco não encontrado ou sem acesso'; end if;
      if delta<>0 then
        update bancos set saldo=coalesce(saldo,0)+delta where id=bid returning saldo into balance;
        if not found then raise exception 'Sem permissão para atualizar banco'; end if;
        insert into banco_historico(banco_id,tipo,descricao,valor,saldo_resultante,mes_id)
          values(bid,case when delta<0 then 'saida' else 'entrada' end, to_char(refdate,'DD/MM/YYYY')||' · '||coalesce(newrow->>'nome',oldrow->>'nome'),abs(delta),balance,mid);
      end if;
    end loop;
    if oldrow is null then
      execute format('insert into public.%I(mes_id,nome,valor,banco_id,tipo_pag,ordem) values($1,$2,$3,$4,$5,(select coalesce(max(ordem),-1)+1 from public.%I where mes_id=$1)) returning id',tbl,tbl)
        into rowid using mid,trim(newrow->>'nome'),(newrow->>'valor')::numeric,newrow->>'banco_id',newrow->>'tipo_pag';
    elsif newrow is null then
      execute format('delete from public.%I where id=$1 and mes_id=$2 returning id',tbl) into rowid using (oldrow->>'id')::bigint,mid;
    else
      execute format('update public.%I set nome=$1,valor=$2,banco_id=$3,tipo_pag=$4 where id=$5 and mes_id=$6 returning id',tbl)
        into rowid using trim(newrow->>'nome'),(newrow->>'valor')::numeric,newrow->>'banco_id',newrow->>'tipo_pag',(oldrow->>'id')::bigint,mid;
    end if;
    if rowid is null then raise exception 'Sem permissão para gravar despesa'; end if;
    insert into historico_geral(tipo,descricao,valor,obs,banco_id,mes_id,data_ref)
      values(case when oldrow is null then 'despesa' else 'outro' end,
      case when newrow is null then 'Estorno: ' when oldrow is not null then 'Edição: ' else '' end||coalesce(newrow->>'nome',oldrow->>'nome'),
      coalesce((newrow->>'valor')::numeric,0),jsonb_build_object('lote',rid,'categoria',tbl,'registro',rowid,'antes',oldrow,'depois',newrow)::text,
      coalesce(newrow->>'banco_id',oldrow->>'banco_id'),mid,refdate);
    count_items:=count_items+1; total:=total+coalesce((newrow->>'valor')::numeric,0)-coalesce((oldrow->>'valor')::numeric,0);
  end loop;
  if p->'header' is not null and p->'header'<>'null'::jsonb then
    select jsonb_build_object('nome',nome,'faturamento',coalesce(faturamento,0),'liquidoapurado',coalesce(liquidoapurado,0)) into live from meses where id=mid;
    if live is distinct from p->'header'->'before' then raise exception 'Dados do mês alterados. Recarregue'; end if;
    if nullif(trim(p->'header'->'after'->>'nome'),'') is null then raise exception 'Nome do mês obrigatório'; end if;
    update meses set nome=p->'header'->'after'->>'nome',faturamento=(p->'header'->'after'->>'faturamento')::numeric,liquidoapurado=(p->'header'->'after'->>'liquidoapurado')::numeric where id=mid;
    if not found then raise exception 'Sem permissão para atualizar mês'; end if;
  end if;
  marker:=jsonb_build_object('count',count_items,'total',total,'request_id',rid);
  insert into historico_geral(tipo,descricao,obs,mes_id,data_ref) values('lote_despesas',rid,jsonb_build_object('hash',payload_hash,'result',marker)::text,mid,refdate);
  return marker;
end $$;
