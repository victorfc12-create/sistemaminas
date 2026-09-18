/* Pure parsing/validation shared by the UI and tests. */
(function(root){
  const categories={despesas_fixas:'Água, luz, telefonia e alarme',despesas_gerais:'Despesas gerais da loja',operacionais:'Despesas operacionais da loja',despesas_pessoais:'Despesas pessoais',anuncios:'Anúncios e tráfego',impostos:'Impostos',gasolina:'Gasolina',multas:'Multas',veic_vendidos:'Despesas de veículos vendidos'};
  const months=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  function normalized(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();}
  function monthPeriod(name){const s=normalized(name||'');const m=months.findIndex(m=>new RegExp('^'+m+'\\b').test(s.trim()));const y=s.match(/\b(20\d{2})\b/);return m<0||!y?null:`${y[1]}-${String(m+1).padStart(2,'0')}`;}
  function cents(raw){const s=raw.replace(/^R\$\s*/i,'').trim();if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{2})?$/.test(s))throw Error('Use valores como 251,66 ou 1.216,27.');const n=Math.round(Number(s.replace(/\./g,'').replace(',','.'))*100);if(!Number.isSafeInteger(n)||n<=0||n>99999999999)throw Error('Informe um valor positivo válido.');return n;}
  function suggest(name){const n=normalized(name);if(/CEMIG.*VICTOR|DESPESA PESSOAL/.test(n))return 'despesas_pessoais';if(/VIVO|VERIS+URE|COPASA|CEMIG|BLINK/.test(n))return 'despesas_fixas';if(/GASOLINA|COMBUSTIVEL/.test(n))return 'gasolina';if(/ICMS|ISSQN|INSS|FGTS|COFINS|IPTU/.test(n))return 'impostos';if(/WEBMOTORS|OLX|SEMINOVOS|TRAFEGO/.test(n))return 'anuncios';return '';}
  function parse(text){
    const rows=[], errors=[], totals=[]; let date=null;
    const money='(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{2})?';
    const leading=new RegExp('^(?:R\\$\\s*)?('+money+')\\s+(.+)$','i');
    const trailing=new RegExp('^(.+?)\\s+(?:R\\$\\s*)?('+money+')$','i');
    const total=new RegExp('^(?:TOTAL\\s*:?\\s*)?(?:R\\$\\s*)?('+money+')$','i');
    text.replace(/&#x20;|&nbsp;/gi,' ').split(/\r?\n/).forEach((raw,i)=>{
      const s=raw.trim();if(!s)return;
      if(/^CONTAS A PAGAR(?:\s+DIA)?\s+/i.test(s)){const d=s.match(/\b(\d{2})\/(\d{2})(?:\/(\d{4}))?\b/);if(d){date={day:d[1],month:d[2],year:d[3]};return;}}
      try {let m=s.match(total);if(m){totals.push(cents(m[1]));return;}m=s.match(leading);let name,amount;if(m){amount=m[1];name=m[2];}else{m=s.match(trailing);if(!m)throw Error('Descrição e valor não reconhecidos.');name=m[1];amount=m[2];}
        if(/[<>]/.test(name)||name.length>500)throw Error('Descrição inválida.');
        rows.push({nome:name.trim(),cents:cents(amount),table:suggest(name)});
      }catch(e){errors.push(`Linha ${i+1}: ${e.message}`);}
    });
    const sum=rows.reduce((s,r)=>s+r.cents,0);if(totals.length>1)errors.push('Há mais de uma linha de total.');if(totals.length&&totals[0]!==sum)errors.push('O total informado não corresponde à soma das contas.');if(!rows.length)errors.push('Inclua pelo menos uma conta com descrição e valor.');
    return {rows,errors,total:sum,date};
  }
  function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===s;}
  const api={categories,monthPeriod,cents,suggest,parse,validDate};if(typeof module!=='undefined')module.exports=api;else root.MinasQuick=api;
})(typeof globalThis!=='undefined'?globalThis:this);
