begin;

alter table public.estoque_despesas add column if not exists request_id uuid;
create unique index if not exists estoque_despesas_request_id_idx
  on public.estoque_despesas(request_id);

create or replace function public.minas_stock_expense(p jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  vehicle estoque%rowtype;
  expense estoque_despesas%rowtype;
  bank_id bancos.id%type := nullif(p->>'banco_id','');
  new_balance bancos.saldo%type;
  request_key uuid := (p->>'request_id')::uuid;
  description text := trim(p->>'descricao');
  amount numeric := (p->>'valor')::numeric;
  payment text := nullif(p->>'tipo_pag','');
  removing boolean := p->>'despesa_id' is not null;
begin
  select * into vehicle from estoque where id = p->>'estoque_id' for update;
  if not found then raise exception 'Veículo não encontrado ou sem acesso'; end if;

  if removing then
    delete from estoque_despesas where estoque_id = vehicle.id
      and id = (p->>'despesa_id')::bigint returning * into expense;
    if not found then raise exception 'Despesa não encontrada ou sem acesso'; end if;
  else
    if request_key is null or description is null or length(description) not between 1 and 500
      or description ~ '[<>]' or amount is null or amount not between 0.01 and 999999999.99
      or round(amount,2) <> amount then
      raise exception 'Informe descrição e valor válido';
    end if;
    if payment is not null and payment not in ('PIX','TED','Cartão','Financiamento','Outros') then
      raise exception 'Forma de pagamento inválida';
    end if;
    insert into estoque_despesas(estoque_id,descricao,valor,banco_id,tipo_pag,request_id)
      values(vehicle.id,description,amount,bank_id,payment,request_key)
      on conflict (request_id) do nothing returning * into expense;
    if not found then
      if exists (select 1 from estoque_despesas d where d.request_id=request_key
        and d.estoque_id=vehicle.id and d.descricao=description and d.valor=amount
        and d.banco_id is not distinct from bank_id and d.tipo_pag is not distinct from payment) then
        return;
      end if;
      raise exception 'Este lançamento já foi usado com outros dados';
    end if;
  end if;

  if expense.banco_id is not null and expense.valor > 0 then
    update bancos set saldo = coalesce(saldo,0) + case when removing then expense.valor else -expense.valor end
      where id=expense.banco_id returning saldo into new_balance;
    if not found then raise exception 'Conta pagadora não encontrada ou sem acesso'; end if;
    insert into banco_historico(banco_id,tipo,descricao,valor,saldo_resultante)
      values(expense.banco_id,case when removing then 'entrada' else 'saida' end,
        case when removing then 'Estorno despesa veículo: ' else 'Despesa veículo: ' end
        || vehicle.descricao || ' — ' || expense.descricao,
        expense.valor,new_balance);
  end if;

  update estoque set custo_total=coalesce(vehicle.valor_compra,0)
    + coalesce((select sum(d.valor) from estoque_despesas d where d.estoque_id=vehicle.id),0)
    where id=vehicle.id;
  if not found then raise exception 'Sem permissão para atualizar o custo do veículo'; end if;
end $$;

revoke execute on function public.minas_stock_expense(jsonb) from public, anon;
grant execute on function public.minas_stock_expense(jsonb) to authenticated;

commit;
