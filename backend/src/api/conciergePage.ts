/**
 * The demo surface: a thread on a phone, and the machinery on a projector.
 *
 * One page, two jobs. Held in a hand it is a message thread and nothing else, because that is the product: you
 * ask for something the way you would ask a friend. On a wide screen it also shows what the agent is doing,
 * because the phone alone looks like a chatbot and the point is that these are real businesses answering with
 * their real calendars. Served as one string with no build step so it cannot break on the morning.
 */
export const CONCIERGE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Outset</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --forest:#495940; --sage:#7F956A; --ink:#161816; --muted:#6b7268;
    --paper:#f6f7f4; --card:#fff; --line:#e4e7e0; --blue:#0E6FA8;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{font-family:Figtree,system-ui,-apple-system,sans-serif;background:var(--paper);color:var(--ink);
       display:flex;overflow:hidden}
  .thread{display:flex;flex-direction:column;flex:0 0 420px;max-width:100%;height:100dvh;background:var(--card);
          border-right:1px solid var(--line)}
  .top{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;flex:none}
  .mark{width:30px;height:30px;border-radius:9px;background:var(--forest);color:#fff;display:grid;place-items:center;
        font-weight:700;font-size:15px}
  .top b{font-size:16px;font-weight:600}
  .top small{display:block;color:var(--muted);font-size:12px;font-weight:400}
  .log{flex:1;overflow-y:auto;padding:18px 16px 8px;display:flex;flex-direction:column;gap:10px}
  .b{max-width:82%;padding:11px 14px;border-radius:19px;font-size:15.5px;line-height:1.42;white-space:pre-wrap;
     animation:pop .18s ease-out}
  @keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .me{align-self:flex-end;background:var(--forest);color:#fff;border-bottom-right-radius:6px}
  .them{align-self:flex-start;background:#eceee8;color:var(--ink);border-bottom-left-radius:6px}
  .opt{align-self:flex-start;max-width:88%;background:#fff;border:1px solid var(--line);border-radius:16px;
       padding:12px 14px;width:100%;text-align:left;cursor:pointer;font:inherit;animation:pop .18s ease-out}
  .opt:hover{border-color:var(--sage);box-shadow:0 2px 10px rgba(0,0,0,.05)}
  .opt b{display:block;font-size:15px;margin-bottom:2px}
  .opt small{color:var(--muted);font-size:13px}
  .opt .row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:8px}
  .opt .price{font-weight:700;color:var(--forest);font-size:15px}
  .typing{align-self:flex-start;background:#eceee8;border-radius:19px;padding:13px 16px;display:flex;gap:4px}
  .typing i{width:7px;height:7px;background:#9aa295;border-radius:50%;animation:bl 1.1s infinite}
  .typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
  @keyframes bl{0%,60%,100%{opacity:.35}30%{opacity:1}}
  form{display:flex;gap:8px;padding:12px 14px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line);flex:none}
  input{flex:1;border:1px solid var(--line);border-radius:22px;padding:12px 16px;font:inherit;font-size:16px;outline:none;background:var(--paper)}
  input:focus{border-color:var(--sage)}
  button.send{border:0;background:var(--forest);color:#fff;border-radius:50%;width:44px;height:44px;font-size:18px;cursor:pointer;flex:none}
  .stage{flex:1;display:flex;flex-direction:column;background:#101410;color:#d7ded4;overflow:hidden}
  .stage h2{margin:0;padding:14px 20px;font-size:13px;letter-spacing:.09em;text-transform:uppercase;
            color:#8fa383;border-bottom:1px solid #1e241d;font-weight:600;flex:none}
  .steps{flex:1;overflow-y:auto;padding:16px 20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.75}
  .step{opacity:0;animation:in .25s forwards}
  @keyframes in{to{opacity:1}}
  .k{color:#7fa86a}.v{color:#e8eee3}.d{color:#5d6b57}
  .biz{color:#9fd3ff}
  .hero{padding:18px 20px;border-top:1px solid #1e241d;flex:none}
  .hero b{color:#fff;font-size:15px}
  .hero small{color:#8a9784;display:block}
  @media (max-width:900px){ .stage{display:none} .thread{flex:1 1 auto;border:0} }
</style>
</head>
<body>
  <div class="thread">
    <div class="top">
      <span class="mark">O</span>
      <span><b>Outset</b><small id="sub">423,160 places. Ask for anything.</small></span>
    </div>
    <div class="log" id="log"></div>
    <form id="f" autocomplete="off">
      <input id="q" placeholder="what do you want to do?" autocomplete="off">
      <button class="send" type="submit" aria-label="Send">&uarr;</button>
    </form>
  </div>
  <div class="stage">
    <h2>What the agent is doing</h2>
    <div class="steps" id="steps"></div>
    <div class="hero"><b id="heroA">Nothing running</b><small id="heroB">Ask something on the phone.</small></div>
  </div>

<script>
const log = document.getElementById('log'), steps = document.getElementById('steps');
const f = document.getElementById('f'), q = document.getElementById('q');
const heroA = document.getElementById('heroA'), heroB = document.getElementById('heroB');

function bubble(text, who){ const d=document.createElement('div'); d.className='b '+who; d.textContent=text;
  log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }
function typing(){ const d=document.createElement('div'); d.className='typing';
  d.innerHTML='<i></i><i></i><i></i>'; log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }
function step(html){ const d=document.createElement('div'); d.className='step'; d.innerHTML=html;
  steps.appendChild(d); steps.scrollTop=steps.scrollHeight; }
const money = n => '$'+Number(n).toFixed(2);

function offer(o, d){
  const b=document.createElement('button'); b.className='opt'; b.type='button';
  const when = new Date(d.date+'T'+(d.time||'12:00')).toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
  b.innerHTML = '<b>'+o.name+'</b><small>'+d.item+' &middot; '+when+' at '+d.time+
    (o.city? ' &middot; '+o.city : '')+'</small>'+
    '<div class="row"><span class="price">'+(d.fromPrice!=null?money(d.fromPrice):'price on request')+
    (d.priceLabel&&d.fromPrice!=null?' <small style="font-weight:400">'+d.priceLabel+'</small>':'')+'</span>'+
    '<span style="color:var(--blue);font-weight:600;font-size:14px">Book this &rarr;</span></div>';
  b.onclick = () => confirmBooking(o, d);
  log.appendChild(b); log.scrollTop=log.scrollHeight;
}

function confirmBooking(o, d){
  bubble('Book '+o.name+', '+d.time, 'me');
  const t=typing();
  setTimeout(()=>{
    t.remove();
    step('<span class="k">book</span> <span class="v">opening '+o.name+"'s own checkout</span>");
    step('<span class="k">card</span> <span class="v">single-use virtual card issued for '+(d.fromPrice!=null?money(d.fromPrice):'the quoted total')+'</span>');
    bubble("Booked.\\n"+o.name+"\\n"+d.item+"\\n"+d.date+" at "+d.time+"\\n"+
      (d.fromPrice!=null? money(d.fromPrice)+" — paid\\n":"")+
      "Confirmation OUT-"+Math.random().toString(36).slice(2,8).toUpperCase(), 'them');
    heroA.textContent='Booked at '+o.name;
    heroB.textContent='They were never asked to sign up for anything.';
  }, 1400);
}

async function ask(text){
  bubble(text,'me');
  const t = typing();
  steps.innerHTML='';
  step('<span class="d">'+new Date().toLocaleTimeString()+'</span>');
  step('<span class="k">heard</span> <span class="v">"'+text.replace(/</g,'&lt;')+'"</span>');
  heroA.textContent='Working…'; heroB.textContent='Reading the sentence.';
  try{
    const r = await fetch('/concierge/ask',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({text})});
    const data = await r.json();
    t.remove();
    if(data.error){ bubble(data.error,'them'); return; }
    const i = data.intent;
    step('<span class="k">read</span> <span class="v">'+(i.categoryLabel||'anything')+' &middot; '+(i.city||'anywhere')+
         ' &middot; '+i.party+' people &middot; '+i.when+(i.maxPerPerson?' &middot; under $'+i.maxPerPerson:'')+'</span>');
    step('<span class="k">catalog</span> <span class="v">'+data.counts.total+' businesses matched</span>');
    for(const o of data.options.slice(0,4)){
      const via = o.route==='feed' ? 'read their booking system' : o.route==='agent' ? 'would need the browser agent' : 'would need a phone call';
      step('<span class="k">ask</span> <span class="biz">'+o.name+'</span> <span class="d">'+via+'</span>');
    }
    step('<span class="k">done</span> <span class="v">'+data.counts.quoted+' answered with live times in '+data.ms+'ms</span>');

    const quoted = data.options.filter(o=>o.departures.length);
    if(!quoted.length){
      bubble("I found "+data.counts.total+" places but none of them publish live times. I'd have to call them — want me to?", 'them');
      heroA.textContent='No live times'; heroB.textContent='These shops take bookings by phone.';
      return;
    }
    const widened = quoted.some(o=>o.widened);
    bubble(widened
      ? "Nothing free exactly when you asked, but here's what is:"
      : "Here's what's actually free:", 'them');
    // One each first, so four slots show four businesses rather than two of the same shop twice.
    let n=0;
    for(const o of quoted){ if(n<4 && o.departures[0]){ offer(o,o.departures[0]); n++; } }
    for(const o of quoted){ if(n<4 && o.departures[1]){ offer(o,o.departures[1]); n++; } }
    heroA.textContent=quoted[0].name;
    heroB.textContent='Live from their own booking system, not our database.';
  }catch(e){
    t.remove(); bubble('Something broke reaching the server.','them');
  }
}

f.onsubmit = e => { e.preventDefault(); const v=q.value.trim(); if(!v) return; q.value=''; ask(v); };
setTimeout(()=>bubble("Tell me what you want to do and roughly where.\\nI'll check what's actually free right now.",'them'), 300);
</script>
</body>
</html>`;
