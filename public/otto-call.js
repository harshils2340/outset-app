/* The sample-call player: word-timed transcript, a slim speaking meter, scrubber, and the log of what Otto does
   during the call. Markup between the CALL CARD markers in otto.html; styles in otto-call.css. No Web Audio: the
   recording plays straight from the <audio> element, so it is never silenced by a suspended AudioContext or by
   an iPhone's mute switch, and everything on screen is timed from audio.currentTime. */
(function () {
      /* Every word of the recording with its start and end, from a Whisper pass over the MP3 itself, grouped into
         the eleven turns. The caption is what was actually said, each line starts at its first word, and each word
         fills left to right across the time it is being spoken. */
      var W = [[0.00,0.22,"Thanks",0],[0.22,0.38,"for",0],[0.38,0.62,"calling",0],[0.62,1.04,"Bayside",0],[1.04,1.30,"Marina.",0],[1.70,1.84,"This",0],[1.84,1.96,"is",0],[1.96,2.20,"Otto.",0],[2.56,2.72,"What",0],[2.72,2.84,"can",0],[2.84,2.92,"I",0],[2.90,3.04,"do",0],[3.04,3.26,"for",0],[3.26,3.42,"you?",0],[4.02,4.16,"Hey,",1],[4.26,4.40,"I've",1],[4.40,4.48,"got",1],[4.48,4.56,"a",1],[4.56,4.70,"couple",1],[4.70,4.94,"jet",1],[4.94,5.14,"skis",1],[5.14,5.36,"booked",1],[5.36,5.56,"for",1],[5.56,5.78,"four",1],[5.78,6.04,"o'clock",1],[6.04,6.30,"today.",1],[6.58,6.82,"Something",1],[6.82,7.02,"came",1],[7.02,7.26,"up.",1],[7.42,7.50,"Can",1],[7.50,7.60,"I",1],[7.60,7.82,"cancel?",1],[8.60,8.90,"No",2],[8.90,9.24,"problem.",2],[9.38,9.46,"Let",2],[9.40,9.48,"me",2],[9.48,9.72,"pull",2],[9.72,9.82,"it",2],[9.82,10.00,"up.",2],[10.72,10.96,"Okay,",2],[11.08,11.22,"I've",2],[11.22,11.38,"got",2],[11.38,11.66,"two",2],[11.66,11.88,"jet",2],[11.88,12.14,"skis",2],[12.14,12.34,"at",2],[12.34,12.60,"4",2],[12.60,13.00,"PM",2],[13.02,13.24,"under",2],[13.24,13.52,"Marcus.",2],[13.74,13.86,"That",2],[13.86,14.04,"sound",2],[14.04,14.24,"correct?",2],[14.58,14.80,"Yep,",3],[14.88,15.18,"that's",3],[15.18,15.34,"me.",3],[15.74,15.90,"Just",4],[15.90,16.04,"so",4],[16.04,16.12,"you",4],[16.12,16.22,"know,",4],[16.40,16.50,"since",4],[16.50,16.76,"it's",4],[16.76,16.96,"less",4],[16.96,17.16,"than",4],[17.16,17.60,"24",4],[17.60,17.84,"hours",4],[17.84,18.28,"out,",4],[18.76,18.90,"the",4],[18.90,19.14,"marina",4],[19.14,19.74,"can't",4],[19.74,19.92,"refund",4],[19.92,20.12,"a",4],[20.12,20.64,"cancellation.",4],[21.26,21.58,"But",4],[21.58,21.76,"I",4],[21.76,22.06,"can",4],[22.06,22.30,"move",4],[22.30,22.40,"it",4],[22.40,22.54,"to",4],[22.54,22.74,"another",4],[22.74,23.08,"day",4],[23.08,23.24,"at",4],[23.24,23.38,"no",4],[23.38,23.76,"charge",4],[23.76,24.26,"if",4],[24.26,24.52,"that",4],[24.52,24.72,"works",4],[24.72,24.98,"better.",4],[25.38,25.62,"Um,",5],[25.80,26.04,"yeah,",5],[26.10,26.30,"that",5],[26.30,26.40,"would",5],[26.40,26.72,"actually",5],[26.72,26.88,"be",5],[26.88,27.18,"perfect.",5],[27.18,27.76,"Let",6],[27.76,27.90,"me",6],[27.90,28.14,"check.",6],[28.26,28.50,"Tomorrow",6],[28.50,28.86,"I've",6],[28.86,29.04,"got",6],[29.04,29.30,"two",6],[29.30,29.64,"skis",6],[29.64,29.94,"open",6],[29.94,30.14,"at",6],[30.14,30.38,"9",6],[30.38,30.86,"AM",6],[30.94,31.08,"or",6],[31.08,31.38,"11",6],[31.38,31.84,"AM.",6],[32.16,32.30,"Which",6],[32.30,32.50,"one",6],[32.50,32.82,"works?",6],[33.56,33.86,"Nine's",7],[33.86,34.08,"perfect.",7],[34.48,34.82,"Done.",8],[35.12,35.20,"You're",8],[35.20,35.34,"moved",8],[35.34,35.50,"to",8],[35.50,35.66,"9",8],[35.66,35.94,"AM",8],[36.14,36.22,"tomorrow.",8],[36.82,36.90,"I'll",8],[36.90,37.06,"text",8],[37.06,37.24,"the",8],[37.24,37.32,"new",8],[37.32,37.68,"confirmation",8],[37.68,37.98,"to",8],[37.98,38.10,"this",8],[38.10,38.36,"number.",8],[38.78,38.98,"Anything",8],[38.98,39.26,"else?",8],[39.64,39.84,"Nope,",9],[39.96,40.12,"that's",9],[40.12,40.22,"it.",9],[40.48,40.62,"Thanks.",9],[41.28,41.52,"You",10],[41.52,41.72,"got",10],[41.72,41.86,"it.",10],[42.02,42.10,"See",10],[42.10,42.18,"you",10],[42.18,42.34,"tomorrow.",10]];
      var SPK = ["otto","caller","otto","caller","otto","caller","otto","caller","otto","caller","otto"];
      var turns = SPK.map(function (who, ti) { return { who: who, words: W.filter(function (x) { return x[3] === ti; }) }; });
      turns.forEach(function (t) { t.text = t.words.map(function (x) { return x[2]; }).join(" "); });

      function $(id) { return document.getElementById(id); }
      var audio = $("audio"), call = $("call"), callcol = $("callcol");
      if (!audio || !call || !callcol) return;
      var play = $("play"), restart = $("restart"), hear = $("hear"), scrub = $("scrub"), tip = $("tip"), cur = $("cur"),
          durEl = $("dur"), st = $("st"), now = $("now"), prev = $("prev"), did = $("did");
      var LABEL = { otto: "Otto", caller: "Marcus" };
      function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
      function reduced() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }

      /* Cue points measured from the recording itself: each turn starts at its first word (a hair early), so the
         caption flips exactly when the voice changes. CUE_DUR stands in until the file reports its length. */
      var CUE_DUR = 42.6, LEAD = 0.06;
      function total() { return audio.duration && isFinite(audio.duration) ? audio.duration : CUE_DUR; }
      var starts = turns.map(function (t) { return Math.max(0, t.words[0][0] - 0.08); });

      /* What Otto does behind the call: one small chip under the transcript, empty until the first action. Each of
         the five is pinned to the words that make it happen: it shows as working from the moment Otto starts on it
         ("Let me pull it up", "Let me check") and turns done on the word where Otto states the result. A new action
         rises in during playback and is simply set on a seek, a scrub or a restart. The booking-system actions carry
         that system's mark; the text and the email carry plain channel marks. */
      var MARK = {
        fh: '<img src="/integrations/fareharbor.png" alt="">',
        sms: '<svg viewBox="0 0 24 24"><path d="M4 5.5h16v10H9l-5 4z"/></svg>',
        mail: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M4 7l8 6 8-6"/></svg>'
      };
      var ACTS = [
        { at: 9.4, done: 11.1, mark: "fh", sys: "FareHarbor", wait: "Looking up the booking", label: "Booking found", detail: "2 jet skis, today 4:00 PM, Marcus" },
        { at: 27.2, done: 28.3, mark: "fh", sys: "FareHarbor", wait: "Checking tomorrow", label: "Availability checked", detail: "9 AM and 11 AM open" },
        { at: 34.08, done: 34.48, mark: "fh", sys: "FareHarbor", wait: "Moving the booking", label: "Booking moved", detail: "tomorrow 9:00 AM, no charge" },
        { at: 36.8, done: 38.1, mark: "sms", sys: "Text message", wait: "Texting the caller", label: "Confirmation texted", detail: "to the caller's number" },
        { at: 40.0, done: 42.3, mark: "mail", sys: "Email", wait: "Writing the call summary", label: "Summary emailed", detail: "to the Bayside Marina team" }
      ];
      var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
      function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
      /* A finished step stays up for HOLD seconds, then clears; the last one (the summary) stays as the call's outcome. */
      var shownAct = "", HOLD = 2.5;
      function showActs(ct, live) {
        var k = -1;
        for (var i = 0; i < ACTS.length; i++) if (ct + 0.02 >= ACTS[i].at) k = i;
        var a = ACTS[k], ok = !!a && ct + 0.02 >= a.done;
        var gone = ok && k < ACTS.length - 1 && ct >= a.done + HOLD;
        var key = k + (gone ? "gone" : ok ? "ok" : "wait");
        if (key === shownAct) return;
        var same = shownAct.split(/(ok|wait|gone)/)[0] === String(k);
        shownAct = key;
        if (gone || k < 0) {
          var old = did.firstChild;
          if (old && live && !reduced()) { old.classList.remove("oc-in"); old.classList.add("oc-out"); old.addEventListener("animationend", function () { if (old.parentNode === did && shownAct === key) did.textContent = ""; }); }
          else did.textContent = "";
          return;
        }
        did.textContent = "";
        var chip = el("span", "oc-did-chip " + (ok ? "ok" : "wait") + (live && !same && !reduced() ? " oc-in" : "")),
            mk = el("span", "oc-did-mark " + a.mark), st = el("span", "oc-did-st");
        mk.innerHTML = MARK[a.mark]; mk.setAttribute("title", a.sys); mk.setAttribute("aria-hidden", "true");
        st.setAttribute("aria-hidden", "true"); if (ok) st.innerHTML = CHECK;
        chip.appendChild(mk); chip.appendChild(el("b", null, ok ? a.label : a.wait));
        if (ok) chip.appendChild(el("span", "oc-did-detail", a.detail));
        chip.appendChild(st);
        did.appendChild(chip);
      }
      showActs(0, false);

      /* The caption: the turn on screen, its speaker and meter, and the line before it. */
      var active = -1, spans = [], bars = [], scrubbing = false, lastSec = -1;
      function spkHTML(t) { return '<div class="oc-spk ' + t.who + '"><b>' + LABEL[t.who] + '</b><span class="oc-meter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div>'; }
      function setActive(i) {
        if (i === active) return; active = i;
        var t = turns[i];
        now.classList.remove("idle"); now.innerHTML = spkHTML(t);
        bars = [].slice.call(now.querySelectorAll(".oc-meter i"));
        spans = t.words.map(function (x) { var w = el("span", "oc-wd", x[2] + " "); now.appendChild(w); return { el: w, s: x[0], e: x[1], p: -1 }; });
        prev.textContent = "";
        if (i > 0) { var p = turns[i - 1]; prev.appendChild(el("b", p.who, LABEL[p.who])); prev.appendChild(document.createTextNode(p.text)); }
        if (audio.paused) restMeter();
      }
      /* Before the first play the opening line sits there unspoken, so the card reads as a transcript waiting at
         0:00 rather than an empty box. active stays -1, so the first sync rebuilds it as the live line. */
      function preview() {
        var t = turns[0]; now.innerHTML = spkHTML(t);
        t.words.forEach(function (x) { now.appendChild(el("span", "oc-wd", x[2] + " ")); });
      }
      preview();
      /* Each word fills across its own spoken duration, a touch ahead of the voice so it never trails. */
      function lightWords(ct) {
        for (var k = 0; k < spans.length; k++) {
          var w = spans[k], pct = Math.round(Math.max(0, Math.min(1, (ct + LEAD - w.s) / Math.max(0.01, w.e - w.s))) * 1000) / 10;
          if (pct !== w.p) { w.p = pct; w.el.style.setProperty("--p", pct + "%"); }
        }
      }

      /* The meter moves only while a word of the current turn is being spoken (the same word timings as the
         caption), each bar on its own rhythm, and rests flat in the pauses between words and while paused. */
      var lv = [0, 0, 0, 0, 0], FQ = [11.3, 8.7, 13.9, 9.6, 12.4], PH = [0.3, 2.1, 4.2, 1.2, 3.3];
      function voiceAt(ct) {
        var t = turns[active]; if (!t) return 0;
        for (var k = 0; k < t.words.length; k++) {
          var s = t.words[k][0], e = t.words[k][1];
          if (ct >= s - 0.03 && ct <= e + 0.05) return 0.55 + 0.45 * Math.sin(Math.PI * Math.max(0, Math.min(1, (ct - s) / Math.max(0.08, e - s))));
        }
        return 0;
      }
      function drawMeter(ct, dt) {
        if (!bars.length) return;
        var v = reduced() ? 0 : voiceAt(ct), tt = performance.now() / 1000;
        for (var i = 0; i < bars.length; i++) {
          var want = v * (0.35 + 0.65 * Math.abs(Math.sin(tt * FQ[i] + PH[i]))), k = want > lv[i] ? 0.45 : 0.18;
          lv[i] += (want - lv[i]) * Math.min(1, k * dt / 16.7);
          bars[i].style.transform = "scaleY(" + (0.17 + 0.83 * lv[i]).toFixed(3) + ")";
        }
      }
      function restMeter() { for (var i = 0; i < bars.length; i++) { lv[i] = 0; bars[i].style.transform = ""; } }

      /* The caption is checked against the audio clock every frame while playing, not on timeupdate (which fires
         only about four times a second and can leave a boundary up to a quarter-second late). timeupdate stays for
         seeks and background tabs. A step only counts as live (so a new action rises in) when the clock has
         moved forward a little since the last sync while playing; any jump, from anywhere, reveals without motion. */
      var lastCt = -9;
      function syncNow() {
        var ct = audio.currentTime, d = total(), idx = 0;
        var live = !audio.paused && ct >= lastCt && ct - lastCt < 0.6; lastCt = ct;
        for (var i = 0; i < starts.length; i++) if (starts[i] <= ct) idx = i;
        setActive(idx); lightWords(ct);
        if (!scrubbing) showActs(ct, live);
        scrub.style.setProperty("--at", (Math.max(0, Math.min(1, ct / d)) * 100).toFixed(2) + "%");
        var sec = Math.floor(ct);
        if (sec !== lastSec) {
          lastSec = sec; cur.textContent = fmt(ct);
          scrub.setAttribute("aria-valuenow", Math.min(sec, Math.floor(d))); scrub.setAttribute("aria-valuetext", fmt(ct) + " of " + fmt(d));
        }
      }
      var raf = 0, lastT = 0;
      function frame(ts) {
        raf = 0;
        if (audio.paused || audio.ended) { restMeter(); return; }
        var dt = lastT ? Math.min(50, ts - lastT) : 16.7; lastT = ts;
        syncNow(); drawMeter(audio.currentTime + LEAD, dt);
        raf = requestAnimationFrame(frame);
      }
      function loop() { if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); } }

      /* playback */
      function start() { var p = audio.play(); if (p && p.catch) p.catch(function () {}); }
      play.addEventListener("click", function () { if (audio.paused) start(); else audio.pause(); });
      restart.addEventListener("click", function () { audio.currentTime = 0; settle(); start(); });
      if (hear) hear.addEventListener("click", function () { call.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }); audio.currentTime = 0; settle(); start(); });

      /* Scrubbing: press anywhere on the rail and drag, the position follows the pointer live; a tooltip shows the
         time. While the pointer is down only the transcript moves. The log waits, then takes the final position in
         one step when it lifts, so dragging across the call never flashes it on and off. A real seek decodes from
         the new position, so firing one on every pointermove (a trackpad can send dozens a second) would make the
         audio stutter; the tooltip tracks every event, the actual seek is capped to once per animation frame. */
      var pendingSeek = -1, seekQueued = false;
      function posOf(e) { var r = scrub.getBoundingClientRect(); return r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0; }
      /* The tooltip follows the pointer but stops half its own width short of each end, so it never clips. */
      function moveTip(f) {
        tip.textContent = fmt(f * total());
        var rw = tip.parentNode.clientWidth, half = tip.offsetWidth / 2;
        tip.style.left = (rw > half * 2 ? Math.max(half, Math.min(rw - half, f * rw)) : f * rw) + "px";
      }
      function seekTo(f) { audio.currentTime = f * total(); syncNow(); }
      function settle() { scrubbing = false; pendingSeek = -1; lastCt = -9; syncNow(); }
      function seekLoop() { seekQueued = false; if (pendingSeek < 0) return; var f = pendingSeek; pendingSeek = -1; seekTo(f); }
      function queueSeek(f) { pendingSeek = f; if (seekQueued) return; seekQueued = true; requestAnimationFrame(seekLoop); }
      scrub.addEventListener("pointerdown", function (e) {
        if (e.button > 0) return;
        scrubbing = true; try { scrub.setPointerCapture(e.pointerId); } catch (x) {}
        scrub.classList.add("drag"); var f = posOf(e); moveTip(f); seekTo(f);
      });
      scrub.addEventListener("pointermove", function (e) { var f = posOf(e); moveTip(f); if (scrubbing) queueSeek(f); });
      function endDrag(e) {
        if (!scrubbing) return;
        scrub.classList.remove("drag"); try { scrub.releasePointerCapture(e.pointerId); } catch (x) {}
        if (pendingSeek >= 0) seekTo(pendingSeek); settle();
      }
      scrub.addEventListener("pointerup", endDrag);
      scrub.addEventListener("pointercancel", endDrag);
      scrub.addEventListener("keydown", function (e) {
        var d = total(), t = audio.currentTime, n = null;
        switch (e.key) {
          case "ArrowRight": case "ArrowUp": n = t + 2; break;
          case "ArrowLeft": case "ArrowDown": n = t - 2; break;
          case "PageUp": n = t + 10; break;
          case "PageDown": n = t - 10; break;
          case "Home": n = 0; break;
          case "End": n = d; break;
        }
        if (n === null) return;
        e.preventDefault(); audio.currentTime = Math.max(0, Math.min(d, n)); settle();
      });

      function setDuration() { var d = total(); durEl.textContent = fmt(d); scrub.setAttribute("aria-valuemax", Math.floor(d)); lastSec = -1; }
      audio.addEventListener("loadedmetadata", setDuration); audio.addEventListener("durationchange", setDuration); setDuration();

      /* The caption is sized once for the longest turn at the current width (a hidden probe renders every turn the
         way the live line is rendered), so it never grows, shrinks or clips as the call moves. Re-measured when the
         width changes and once the web font has loaded; turn changes alter nothing and must not re-run it. */
      var capEl = now.parentNode, fitW = -1;
      function fitCaption(force) {
        var w = now.clientWidth; if (!w || (w === fitW && force !== true)) return; fitW = w;
        var probe = el("div", "oc-now"); probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:" + w + "px";
        capEl.appendChild(probe); var max = 0;
        turns.forEach(function (t) { probe.innerHTML = spkHTML(t) + t.text; max = Math.max(max, probe.offsetHeight); });
        probe.remove();
        var cs = getComputedStyle(capEl), ps = getComputedStyle(prev);
        capEl.style.height = Math.ceil(max + prev.offsetHeight + parseFloat(ps.marginBottom) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + "px";
      }
      fitCaption();
      if (document.fonts) {
        if (document.fonts.ready) document.fonts.ready.then(function () { fitCaption(true); });
        if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", function () { fitCaption(true); });
      }
      if (window.ResizeObserver) new ResizeObserver(function () { fitCaption(); }).observe(capEl);

      function setPlaying(on) {
        play.classList.toggle("playing", on); call.classList.toggle("playing", on);
        play.setAttribute("aria-label", on ? "Pause the call" : "Play the call");
      }
      /* If the file cannot load, the chip says so in a word (so the header keeps its height) and the line above the
         transcript says what to do; both controls are disabled rather than left to fail silently. */
      function failed() {
        st.textContent = "Unavailable"; call.classList.add("failed"); setPlaying(false); play.disabled = true; restart.disabled = true;
        prev.textContent = "The audio did not load. Try a refresh.";
      }
      audio.addEventListener("play", function () { setPlaying(true); st.textContent = "Playing"; loop(); });
      audio.addEventListener("pause", function () { setPlaying(false); if (!audio.ended) st.textContent = "Paused"; restMeter(); });
      audio.addEventListener("timeupdate", syncNow);
      audio.addEventListener("seeked", function () { syncNow(); if (audio.paused && !audio.ended && st.textContent === "Call ended") st.textContent = "Paused"; });
      audio.addEventListener("ended", function () { setPlaying(false); st.textContent = "Call ended"; restMeter(); showActs(CUE_DUR, false); });
      audio.addEventListener("error", failed);
      if (audio.error) failed();
})();
