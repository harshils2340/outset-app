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
  /*
   * One surface. The trace panel that used to sit beside this was a second thing to look at on a screen whose
   * whole point is that you talk to it, and there is now one way in (the switch on the site), so a page
   * showing its own console was a second entry point as well. What the agent did still lives at /sessions,
   * where somebody debugging can go and find it.
   */
  .thread{display:flex;flex-direction:column;width:min(480px,100%);margin:0 auto;height:100dvh;
          background:var(--card);border-left:1px solid var(--line);border-right:1px solid var(--line)}
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
  .chips{display:flex;flex-wrap:wrap;gap:7px;align-self:flex-start;max-width:88%;margin:-2px 0 2px}
  .chip{border:1px solid var(--sage);background:#fff;color:var(--forest);border-radius:16px;padding:7px 13px;
        font:inherit;font-size:14px;font-weight:600;cursor:pointer}
  .chip:hover{background:var(--forest);color:#fff}
  .note{align-self:flex-start;color:var(--muted);font-size:12.5px;padding:0 4px;max-width:88%}
  .typing{align-self:flex-start;background:#eceee8;border-radius:19px;padding:13px 16px;display:flex;gap:4px}
  .typing i{width:7px;height:7px;background:#9aa295;border-radius:50%;animation:bl 1.1s infinite}
  .typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
  @keyframes bl{0%,60%,100%{opacity:.35}30%{opacity:1}}
  form{display:flex;gap:8px;padding:12px 14px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line);flex:none}
  input{flex:1;border:1px solid var(--line);border-radius:22px;padding:12px 16px;font:inherit;font-size:16px;outline:none;background:var(--paper)}
  input:focus{border-color:var(--sage)}
  button.send{border:0;background:var(--forest);color:#fff;border-radius:50%;width:44px;height:44px;font-size:18px;cursor:pointer;flex:none}
            color:#8fa383;border-bottom:1px solid #1e241d;font-weight:600;flex:none}
  .steps{flex:1;overflow-y:auto;padding:16px 20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.75}
  .step{opacity:0;animation:in .25s forwards}
  @keyframes in{to{opacity:1}}
  .k{color:#7fa86a}.v{color:#e8eee3}.d{color:#5d6b57}
  .biz{color:#9fd3ff}
  .hero{padding:18px 20px;border-top:1px solid #1e241d;flex:none}
  .hero b{color:#fff;font-size:15px}
  .hero small{color:#8a9784;display:block}
  @media (max-width:900px){ .thread{width:100%;border:0} }
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

<script>
const log = document.getElementById('log');
/*
 * The trace panel is gone from this page: one surface, one way in. These stay as no-ops so the streaming
 * reader below still has somewhere to hand each step, and so /sessions, which is where the trace lives
 * now, keeps receiving exactly the same events.
 */
const steps = { innerHTML: '', scrollTop: 0, scrollHeight: 0, appendChild(){} };
const heroA = { set textContent(_v){} }, heroB = { set textContent(_v){} };
const f = document.getElementById('f'), q = document.getElementById('q');

function bubble(text, who){ const d=document.createElement('div'); d.className='b '+who; d.textContent=text;
  log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }
function typing(){ const d=document.createElement('div'); d.className='typing';
  d.innerHTML='<i></i><i></i><i></i>'; log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }
function step(html){ const d=document.createElement('div'); d.className='step'; d.innerHTML=html;
  steps.appendChild(d); steps.scrollTop=steps.scrollHeight; return d; }
function note(text){ const d=document.createElement('div'); d.className='note'; d.textContent=text;
  log.appendChild(d); log.scrollTop=log.scrollHeight; }
/** The agent's question, with its answers ready to tap. Tapping sends the sentence it carries. */
function chips(choices){
  if(!choices || !choices.length) return;
  const w=document.createElement('div'); w.className='chips';
  for(const c of choices){
    const b=document.createElement('button'); b.className='chip'; b.type='button'; b.textContent=c.label;
    b.onclick=()=>{ w.remove(); ask(c.text); };
    w.appendChild(b);
  }
  log.appendChild(w); log.scrollTop=log.scrollHeight;
}
const money = n => '$'+Number(n).toFixed(2);
/**
 * Every name on this page came off somebody else's website: the business name as our crawl read it, the town,
 * the trip name and the ticket label as the shop's booking system answers them. Concatenating those into
 * innerHTML lets a business called "<img onerror=...>" close our markup and run its own script in a guest's
 * browser, which is the hole the static pages were carrying until this week. Text goes through here.
 */
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/**
 * The conversation this browser is having. The agent keeps what it has been told against this id, so answering
 * "waterloo" to "where are you?" continues the question instead of starting a new one.
 */
let SESSION = null;

/** Colour by what kind of step it is, so a wall of lines still reads at a glance from across a room. */
const STEP_COLOUR = { read:'#9fd3ff', carry:'#9fd3ff', catalog:'#7fa86a', ask:'#7fa86a', answer:'#7fa86a',
  assume:'#e3b341', widen:'#e3b341', loosen:'#e3b341', question:'#f2836b', ambiguous:'#f2836b',
  skip:'#5d6b57', compare:'#fff' };
function renderStep(st){
  const c = STEP_COLOUR[st.kind] || '#e8eee3';
  step('<span class="d" style="display:inline-block;width:46px;text-align:right">'+st.ms+'ms</span> '+
       '<span style="color:'+c+';font-weight:600">'+esc(st.kind)+'</span> '+
       '<span class="v">'+esc(st.text)+'</span>'+
       (st.detail? ' <span class="d">'+esc(st.detail)+'</span>' : ''));
}

/** "30 min earlier", so a slot that is not the one they asked for says so on its own face. */
function offsetLabel(min){
  if(min==null) return '';
  if(min===0) return 'exactly when you asked';
  const a=Math.abs(min), when = min<0 ? 'earlier' : 'later';
  if(a<60) return a+' min '+when;
  const h=Math.floor(a/60), m=a%60;
  return h+(m? 'h '+m+'m' : ' hour'+(h===1?'':'s'))+' '+when;
}

function offer(o, d, idx){
  const b=document.createElement('button'); b.className='opt'; b.type='button';
  const when = new Date(d.date+'T'+(d.time||'12:00')).toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
  /**
   * How far this slot is from the one they asked for, and where the time came from. Both matter: an offer
   * that has quietly slid four hours is how somebody misses their dinner, and "from their own calendar" is
   * the claim this whole product rests on, so it is printed rather than implied.
   */
  const off = o.offsets && o.offsets[idx] != null ? offsetLabel(o.offsets[idx]) : '';
  b.innerHTML = '<b>'+esc(o.name)+'</b><small>'+esc(d.item)+' &middot; '+esc(when)+' at '+esc(d.time)+
    (o.city? ' &middot; '+esc(o.city) : '')+'</small>'+
    (off? '<small style="display:block;color:'+(o.offsets[idx]===0?'var(--forest)':'#a4650b')+';font-weight:600">'+off+'</small>' : '')+
    (o.via? '<small style="display:block;color:var(--muted);font-size:12px">read live from '+esc(o.via)+'</small>' : '')+
    '<div class="row"><span class="price">'+(d.fromPrice!=null?money(d.fromPrice)+(d.taxIncluded?'':' <small style="font-weight:400;color:var(--muted)">+ tax</small>'):'price on request')+
    (d.priceLabel&&d.fromPrice!=null?' <small style="font-weight:400">'+esc(d.priceLabel)+'</small>':'')+'</span>'+
    '<span style="color:var(--blue);font-weight:600;font-size:14px">Book this &rarr;</span></div>';
  b.onclick = () => confirmBooking(o, d);
  log.appendChild(b); log.scrollTop=log.scrollHeight;
}

function offerService(o){
  /**
   * The cheapest thing a person can actually buy a seat on. A whole-room price is real but it is not a ticket,
   * so a per-head line is preferred when the shop publishes one, and when only the room price exists it is
   * labelled as the room. Printing "$250.00 each" under an escape room, as this did, is a number no guest
   * would pay and the sort of thing that makes the rest of the screen untrustworthy.
   */
  const priced = o.services.filter(x=>x.price!=null);
  const s = priced.find(x=>x.per!=='group') || priced[0];
  const b=document.createElement('button'); b.className='opt'; b.type='button';
  b.innerHTML = '<b>'+esc(o.name)+'</b><small>'+esc(s.name)+(o.city? ' &middot; '+esc(o.city):'')+
    (o.rating? ' &middot; '+esc(o.rating)+'&#9733;':'')+'</small>'+
    '<div class="row"><span class="price">$'+Number(s.price).toFixed(2)+
    '<small style="font-weight:400;color:var(--muted)"> '+(s.per==='group'?'for the room':'each')+'</small></span>'+
    '<span style="color:var(--muted);font-weight:600;font-size:13px">'+
    (o.route==='phone'?'we would call them':'open their booking page')+'</span></div>';
  b.onclick = () => {
    bubble('Get me a time at '+o.name, 'me');
    const t=typing();
    setTimeout(()=>{ t.remove();
      step('<span class="k">route</span> <span class="v">'+(o.route==='phone'?'no booking system: the phone agent calls '+esc(o.phone):'opening their booking page')+'</span>');
      bubble(o.route==='phone'
        ? "I couldn't find a booking page for them, so I'd ring "+(o.phone||'them')+" and confirm. That's the other half of the system."
        : "Opening "+o.name+"'s own booking page to pick a time. Their system, not ours.", 'them');
    }, 1100);
  };
  log.appendChild(b); log.scrollTop=log.scrollHeight;
}

/**
 * Hand the guest to the shop's real checkout, and be plain that we cannot pay for them yet.
 *
 * This used to print "Booked.", a total marked "paid", and a confirmation number made from
 * Math.random(). Nothing had happened: no seat was held, no card was charged, and the number
 * belonged to no booking anywhere. On a screen in front of an audience that is a fabricated record
 * presented as a real one, and if anybody had written it down they would have turned up at a shop
 * that had never heard of them.
 *
 * What is real is the link. Every live departure carries bookUrl, the operator's own checkout for
 * that exact slot, so the honest version of this button finishes the journey on their system with
 * the date, the time and the price we quoted already filled in. That is also the better
 * demonstration: the whole claim is that we read their calendar, and this is where you see that we
 * did.
 */
function confirmBooking(o, d){
  bubble('Book '+o.name+', '+d.time, 'me');
  const t=typing();
  setTimeout(()=>{
    t.remove();
    step('<span class="k">book</span> <span class="v">handing over to '+esc(o.name)+"'s own checkout</span>");
    step('<span class="k">note</span> <span class="d">we cannot take the payment ourselves yet</span>');
    const when = new Date(d.date+'T'+(d.time||'12:00')).toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});
    bubble("Here is the slot, on their own booking page:\\n"+
      o.name+"\\n"+d.item+"\\n"+when+" at "+d.time+
      (d.fromPrice!=null? "\\n"+money(d.fromPrice)+(d.taxIncluded?"":" + tax")+" a head":"")+
      "\\n\\nI can't take your money yet, so you finish it there. Nothing is held until you do.", 'them');
    if(d.bookUrl){
      const a=document.createElement('a');
      a.className='opt'; a.href=d.bookUrl; a.target='_blank'; a.rel='noopener noreferrer';
      a.innerHTML='<b>Open '+esc(o.name)+"'s checkout &rarr;</b><small>"+esc(d.bookUrl.replace(/^https?:\\/\\//,'').slice(0,54))+'</small>';
      log.appendChild(a); log.scrollTop=log.scrollHeight;
    }
    heroA.textContent='Handed to '+o.name;
    heroB.textContent='Their checkout, their money. We never asked them to sign up for anything.';
  }, 900);
}

/**
 * Ask, and watch it work.
 *
 * The steps arrive over the wire as they happen rather than being drawn from the finished answer, so what the
 * panel shows is the agent's real order and real timings: three shops read at once, one slow, one empty. The
 * request is a POST, so this is a stream read by hand rather than an EventSource, which can only GET.
 */
async function ask(text){
  bubble(text,'me');
  const t = typing();
  steps.innerHTML='';
  step('<span class="d">'+new Date().toLocaleTimeString()+'</span>');
  step('<span class="k">heard</span> <span class="v">"'+esc(text)+'"</span>');
  heroA.textContent='Working\u2026'; heroB.textContent='Reading the sentence.';
  try{
    const r = await fetch('/concierge/stream',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({text, session:SESSION})});
    if(!r.ok || !r.body){ const j=await r.json().catch(()=>({})); t.remove();
      bubble(j.error||'Something broke reaching the server.','them'); return; }

    const reader=r.body.getReader(), dec=new TextDecoder();
    let buf='', data=null, failed=null;
    for(;;){
      const {value,done}=await reader.read();
      if(done) break;
      buf+=dec.decode(value,{stream:true});
      // SSE frames are separated by a blank line; a partial frame stays in the buffer for the next chunk.
      let i;
      while((i=buf.indexOf('\\n\\n'))>=0){
        const frame=buf.slice(0,i); buf=buf.slice(i+2);
        let ev='message', payload='';
        for(const line of frame.split('\\n')){
          if(line.startsWith('event:')) ev=line.slice(6).trim();
          else if(line.startsWith('data:')) payload+=line.slice(5).trim();
        }
        if(!payload) continue;
        let obj; try{ obj=JSON.parse(payload); }catch(e){ continue; }
        if(ev==='step'){ renderStep(obj); if(obj.kind==='ask') heroB.textContent='Asking '+obj.text+'.'; }
        else if(ev==='answer') data=obj;
        else if(ev==='failed') failed=obj;
      }
    }
    t.remove();
    if(failed || !data){ bubble((failed&&failed.error)||'Something broke reaching the server.','them'); return; }
    SESSION = data.session;
    render(data);
  }catch(e){
    t.remove(); bubble('Something broke reaching the server.','them');
  }
}

function render(data){
    if(data.error){ bubble(data.error,'them'); return; }
    step('<span class="k">done</span> <span class="v">'+data.counts.quoted+' with live times, '+(data.counts.priced||0)+' priced from their own site &middot; '+data.ms+'ms</span>');

    /**
     * A question back, when the sentence did not carry enough to answer well. It arrives with its answers, so
     * the guest taps rather than guessing what phrasing will be understood, and what they tap is merged into
     * what they already said instead of starting the conversation again.
     */
    if(data.followUp){
      bubble(data.followUp.question,'them');
      chips(data.followUp.choices);
      heroA.textContent='It asked rather than guessed';
      heroB.textContent=data.followUp.why==='place'
        ? 'Guessing the wrong town would have looked exactly like an answer.'
        : 'One question is cheaper than a confident wrong list.';
      return;
    }
    // What it guessed because nobody said it. Said out loud, because a silent guess is indistinguishable from a fact.
    if(data.assumptions && data.assumptions.length) note('Assuming '+data.assumptions.join(' and ')+'. Say otherwise and I\u2019ll redo it.');
    if(data.loosened){ bubble(data.loosened,'them'); }
    /**
     * What it costs across everything found. This is the line that answers "why not just use Google": those
     * prices live on a dozen different websites and nobody compares them, because nobody can.
     */
    if(data.compare && data.compare.count >= 2){
      bubble('Across '+data.compare.count+' places nearby: '+money(data.compare.cheapest)+' to '+money(data.compare.dearest)+' a head.','them');
      heroA.textContent=money(data.compare.cheapest)+' to '+money(data.compare.dearest);
      heroB.textContent='Compared across '+data.compare.count+' businesses, each on its own website.';
    }
    const quoted = data.options.filter(o=>o.departures.length);
    const priced = data.options.filter(o=>!o.departures.length && o.services.some(s=>s.price!=null));
    if(!quoted.length){
      if(priced.length){
        /**
         * Not "they do not publish times". Most of these sell online right now on a page we cannot read yet,
         * and describing our gap as their absence is a false statement about a real business.
         */
        bubble("I can't read these shops' booking systems yet, so I won't pretend to quote you a time. Here's what they charge:", 'them');
        let m=0;
        for(const o of priced){ if(m++>=4) break; offerService(o); }
        heroA.textContent=priced.length+' priced from their own sites';
        heroB.textContent='Read off their pages by the crawl; the time needs a call or their booking page.';
      } else {
        bubble("I found "+data.counts.total+" places but nothing published: no times, no prices. Those are the ones we'd have to phone.", 'them');
        heroA.textContent='Nothing published'; heroB.textContent='These shops take bookings by phone only.';
      }
      return;
    }
    const widened = quoted.some(o=>o.widened);
    const exact = quoted.some(o=>o.offsets && o.offsets[0]===0);
    const asked = data.intent && data.intent.atMinute!=null;
    bubble(widened
      ? "Nothing free exactly when you asked, but here's what is:"
      : asked && !exact
        ? "Nothing at exactly that time. These are the closest, nearest first:"
        : asked && exact
          ? "That time is free:"
          : "Here's what's actually free:", 'them');
    // One each first, so four slots show four businesses rather than two of the same shop twice.
    /*
      One shop, one card. Offering a slot at a time put "Escapology Waterloo" on screen twice in a row with
      two of its rooms, which reads as the same place over and over rather than as a choice of times, and
      crowds out the other businesses entirely. Different shops first, then a second time from each.
    */
    let n=0;
    for(const o of quoted){ if(n<4 && o.departures[0]){ offer(o,o.departures[0],0); n++; } }
    for(const o of quoted){ if(n<5 && o.departures[1]){ offer(o,o.departures[1],1); n++; } }
    heroA.textContent=quoted[0].name;
    heroB.textContent='Live from their own booking system, not our database.';
}

f.onsubmit = e => { e.preventDefault(); const v=q.value.trim(); if(!v) return; q.value=''; ask(v); };
setTimeout(()=>bubble("Tell me what you want to do and roughly where.\\nI'll check what's actually free right now.",'them'), 300);
</script>
</body>
</html>`;
