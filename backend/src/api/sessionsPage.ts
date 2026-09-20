/**
 * The window over the agent's shoulder.
 *
 * `/go` shows one conversation as it happens. This shows all of them, kept as long as the process lives: every
 * question anybody asked, every step the planner took, what each shop answered and how long it took to answer.
 * On a demo table that means a phone in a stranger's hand and this on the laptop beside it. Away from the demo
 * it is the only way to find out why an answer was wrong — which shop was slow, which one returned nothing,
 * which assumption the agent made because the sentence never said.
 *
 * It polls rather than streams: it is a read-only window over state that already exists, several conversations
 * at once, and a stream per session would be a socket per session for no gain.
 */
export const SESSIONS_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Outset · what the agent did</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0d110c;--panel:#141a13;--line:#232c21;--ink:#dce4d7;--dim:#7d8a77;--green:#8fc46a;--blue:#7fbdff;
        --amber:#e3b341;--red:#f2836b}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{font-family:Figtree,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);display:flex;
       height:100dvh;overflow:hidden}
  .side{flex:0 0 290px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--panel)}
  .side h1{margin:0;padding:16px 18px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--green);
           border-bottom:1px solid var(--line);font-weight:600;display:flex;justify-content:space-between;align-items:center}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 1.6s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
  .list{flex:1;overflow-y:auto}
  .s{padding:12px 18px;border-bottom:1px solid var(--line);cursor:pointer;border-left:3px solid transparent}
  .s:hover{background:#192117}
  .s.on{background:#1b2419;border-left-color:var(--green)}
  .s b{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .s small{color:var(--dim);font-size:12px}
  .main{flex:1;overflow-y:auto;padding:22px 26px 60px}
  .empty{color:var(--dim);padding:40px 6px;font-size:15px;line-height:1.6;max-width:56ch}
  .empty code{background:var(--panel);padding:2px 7px;border-radius:5px;color:var(--green)}
  .turn{margin-bottom:26px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}
  .th{padding:13px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;
      align-items:baseline;gap:14px;flex-wrap:wrap}
  .th b{font-size:15.5px;font-weight:600}
  .copy{border:1px solid var(--line);background:transparent;color:var(--dim);border-radius:7px;
        padding:5px 10px;font:inherit;font-size:12px;cursor:pointer}
  .copy:hover{border-color:var(--green);color:var(--green)}
  .copy.done{color:var(--green);border-color:var(--green)}
  .bar2{padding:10px 18px;border-top:1px solid var(--line);display:flex;gap:8px}
  .th .meta{color:var(--dim);font-size:12.5px;font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
  .th .out{color:var(--blue);font-size:13px}
  .steps{padding:8px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
  .st{display:grid;grid-template-columns:62px 82px 1fr;gap:12px;padding:3px 16px;align-items:baseline}
  .st:hover{background:#192117}
  .ms{color:#59654f;text-align:right}
  .kd{font-weight:600}
  .kd.read,.kd.carry{color:var(--blue)}
  .kd.ask,.kd.answer{color:var(--green)}
  .kd.assume,.kd.widen,.kd.loosen{color:var(--amber)}
  .kd.question,.kd.ambiguous{color:var(--red)}
  .kd.skip{color:#59654f}
  .tx{color:var(--ink)}
  .dt{color:var(--dim)}
  .bar{height:3px;background:#1d2519;border-radius:2px;margin-top:6px;overflow:hidden}
  .bar i{display:block;height:100%;background:var(--green)}
  @media (max-width:760px){ .side{flex:0 0 130px} .main{padding:14px} .st{grid-template-columns:48px 70px 1fr;gap:8px} }
</style>
</head>
<body>
  <div class="side">
    <h1>Sessions <span class="dot" id="dot"></span></h1>
    <div class="list" id="list"></div>
    <div class="bar2"><button class="copy" id="copyAll" style="flex:1">Copy this conversation</button></div>
  </div>
  <div class="main" id="main">
    <div class="empty">Nothing yet. Open <code>/go</code> and ask for something &mdash; every step the agent takes lands here, with how long it took.</div>
  </div>
<script>
const list=document.getElementById('list'), main=document.getElementById('main');
let picked=null, last='';
const esc = s => String(s==null?'':s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const ago = t => { const s=Math.round((Date.now()-t)/1000);
  return s<60? s+'s ago' : s<3600? Math.round(s/60)+'m ago' : Math.round(s/3600)+'h ago'; };

let current = null;

/**
 * The whole conversation as plain text: what was asked, what was answered, and every step the agent took to
 * get there, with its timings. Written to be pasted somewhere else — into a bug report, or back at whoever is
 * fixing the agent — because "it gave me a weird answer" is not something anybody can act on and this is.
 */
function transcript(s){
  const out = ["Outset concierge session " + s.id, new Date(s.at).toLocaleString(), ""];
  for (const t of s.turns) {
    out.push("You: " + t.text);
    out.push("  -> " + (t.outcome || "(no outcome recorded)") + "   [" + t.ms + "ms]");
    for (const st of t.steps) out.push("     " + String(st.ms).padStart(5) + "ms  " + st.kind.padEnd(9) + " " + st.text + (st.detail ? "   (" + st.detail + ")" : ""));
    out.push("");
  }
  return out.join("\\n");
}

function draw(sessions){
  list.innerHTML='';
  for(const s of sessions){
    const d=document.createElement('div');
    d.className='s'+(s.id===picked?' on':'');
    const first=s.turns.length? s.turns[s.turns.length-1].text : '(nothing asked yet)';
    d.innerHTML='<b>'+esc(first)+'</b><small>'+s.turns.length+' turn'+(s.turns.length===1?'':'s')+
      ' &middot; '+ago(s.lastAt)+'</small>';
    d.onclick=()=>{ picked=s.id; draw(sessions); };
    list.appendChild(d);
  }
  if(!picked && sessions.length) picked=sessions[0].id;
  const s = sessions.find(x=>x.id===picked);
  if(!s){ return; }
  current = s;

  // Newest turn at the top: on a demo table the thing that just happened is the thing being watched.
  const turns=[...s.turns].reverse();
  main.innerHTML = turns.map(t=>{
    const span = Math.max(t.ms,1);
    return '<div class="turn"><div class="th"><b>'+esc(t.text)+'</b>'+
      '<span class="out">'+esc(t.outcome||'')+'</span>'+
      '<span class="meta">'+t.ms+'ms &middot; '+new Date(t.at).toLocaleTimeString()+'</span>'+
      '<button class="copy" data-turn="'+esc(t.id)+'">Copy turn</button></div>'+
      '<div class="steps">'+ t.steps.map(st=>
        '<div class="st"><span class="ms">'+st.ms+'ms</span>'+
        '<span class="kd '+esc(st.kind)+'">'+esc(st.kind)+'</span>'+
        '<span><span class="tx">'+esc(st.text)+'</span>'+
        (st.detail? ' <span class="dt">'+esc(st.detail)+'</span>':'')+
        '<span class="bar"><i style="width:'+Math.min(100,Math.round(st.ms/span*100))+'%"></i></span></span></div>'
      ).join('') +'</div></div>';
  }).join('') || '<div class="empty">This session has not asked anything yet.</div>';

  // Delegated, because the list is redrawn on every poll.
  main.onclick = (e) => {
    const b = e.target.closest('button.copy');
    if(!b || !current) return;
    const t = current.turns.find(x => x.id === b.dataset.turn);
    if(!t) return;
    copy(b, transcript({ ...current, turns: [t] }));
  };
}

function copy(btn, text){
  const done = () => { const was = btn.textContent; btn.textContent='Copied'; btn.classList.add('done');
    setTimeout(()=>{ btn.textContent=was; btn.classList.remove('done'); }, 1400); };
  // A page served over plain http on a phone has no clipboard API, and this is opened over the LAN.
  if(navigator.clipboard && window.isSecureContext){ navigator.clipboard.writeText(text).then(done, ()=>fallback(text,done)); }
  else fallback(text, done);
}
function fallback(text, done){
  const ta=document.createElement('textarea'); ta.value=text;
  ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); done(); }catch(e){ prompt('Copy this:', text); }
  ta.remove();
}

document.getElementById('copyAll').onclick = function(){
  if(!current) return;
  copy(this, transcript(current));
};

async function tick(){
  try{
    const r=await fetch('/concierge/sessions');
    const d=await r.json();
    // Only redraw when something changed, so a click does not fight the poll.
    const sig=JSON.stringify(d.sessions.map(s=>[s.id,s.turns.length,s.lastAt]));
    if(sig!==last || !main.querySelector('.turn')){ last=sig; if(d.sessions.length) draw(d.sessions); }
    document.getElementById('dot').style.background='var(--green)';
  }catch(e){ document.getElementById('dot').style.background='var(--red)'; }
}
tick(); setInterval(tick, 1200);
</script>
</body>
</html>`;
