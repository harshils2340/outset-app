/* The sample-call player: word-timed transcript, a slim speaking meter, scrubber, and the log of what Otto does
   during the call. Markup between the CALL CARD markers in otto.html; styles in otto-call.css. No Web Audio: the
   recording plays straight from the <audio> element, so it is never silenced by a suspended AudioContext or by
   an iPhone's mute switch, and everything on screen is timed from audio.currentTime. */
(function () {
      /* Every word of the recording with its start and end, from a Whisper pass over the MP3 itself, grouped into
         the eleven turns. The caption is what was actually said, each line starts at its first word, and each word
         fills left to right across the time it is being spoken. */
      var W = window.CALL_W;
      var SPK = window.CALL_SPK;
      var turns = SPK.map(function (who, ti) { return { who: who, words: W.filter(function (x) { return x[3] === ti; }) }; });
      turns.forEach(function (t) { t.text = t.words.map(function (x) { return x[2]; }).join(" "); });

      function $(id) { return document.getElementById(id); }
      var audio = $("audio"), call = $("call"), callcol = $("callcol");
      if (!audio || !call || !callcol) return;
      var play = $("play"), restart = $("restart"), hear = $("hear"), scrub = $("scrub"), tip = $("tip"), cur = $("cur"),
          durEl = $("dur"), st = $("st"), now = $("now"), prev = $("prev"), did = $("did");
      var LABEL = window.CALL_LABEL;
      function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
      function reduced() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }

      /* Cue points measured from the recording itself: each turn starts at its first word (a hair early), so the
         caption flips exactly when the voice changes. CUE_DUR stands in until the file reports its length. */
      var CUE_DUR = window.CALL_DUR || 62, LEAD = 0.06;
      function total() { return audio.duration && isFinite(audio.duration) ? audio.duration : CUE_DUR; }
      var starts = turns.map(function (t) { return Math.max(0, t.words[0][0] - 0.08); });

      /* What Otto does behind the call: one small chip under the transcript, empty until the first action. Each of
         the five is pinned to the words that make it happen: it shows as working from the moment Otto starts on it
         ("Let me pull it up", "Let me check") and turns done on the word where Otto states the result. A new action
         rises in during playback and is simply set on a seek, a scrub or a restart. The booking-system actions carry
         that system's mark; the text and the email carry plain channel marks. */
      var MARK = {
        chart: '<svg viewBox="0 0 24 24"><rect x="6" y="3.5" width="12" height="17" rx="1.5"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
        cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M8 3.5v3M16 3.5v3M4 10h16"/></svg>',
        book: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
        mail: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M4 7l8 6 8-6"/></svg>'
      };
      var ACTS = window.CALL_ACTS;
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

      /* A language tab on a shop page swaps the recording without binding the controls a second time. */
      window.OutsetCallLoad = function (src) {
        audio.pause();
        W = window.CALL_W;
        SPK = window.CALL_SPK;
        turns = SPK.map(function (who, ti) { return { who: who, words: W.filter(function (x) { return x[3] === ti; }) }; });
        turns.forEach(function (t) { t.text = t.words.map(function (x) { return x[2]; }).join(" "); });
        LABEL = window.CALL_LABEL;
        CUE_DUR = window.CALL_DUR || 62;
        ACTS = window.CALL_ACTS;
        starts = turns.map(function (t) { return Math.max(0, t.words[0][0] - 0.08); });
        active = -1;
        spans = [];
        shownAct = "";
        lastCt = -9;
        lastSec = -1;
        fitW = -1;
        call.classList.remove("failed", "playing");
        play.disabled = false;
        restart.disabled = false;
        setPlaying(false);
        st.textContent = "Ready";
        did.textContent = "";
        cur.textContent = "0:00";
        scrub.style.setProperty("--at", "0%");
        scrub.setAttribute("aria-valuenow", "0");
        audio.src = src;
        audio.load();
        preview();
        showActs(0, false);
        fitCaption(true);
      };
})();
