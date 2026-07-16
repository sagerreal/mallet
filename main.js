/* Mallet landing — motion, embeds, front-desk demo, rotator, ROI calc, consent. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('DOMContentLoaded', function () {
    smoothScroll();
    heroStagger();
    scrollReveal();
    wireCalendly();
    loadTallyIfPresent();
    frontDesk();
    vignettes();
    roiCalc();
    consent();
  });

  /* Lenis inertia scrolling (vendored lenis.min.js) — the "expensive site" feel.
     Skipped under reduced motion; native anchors still work via lenis anchors:true. */
  function smoothScroll() {
    if (reduce || typeof window.Lenis !== 'function') return;
    var lenis = new window.Lenis({ lerp: 0.14, wheelMultiplier: 1.1, anchors: true });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);

    // Hero depth: the back card drifts slightly slower than the page.
    var back = document.querySelector('.stage-back');
    if (back && typeof lenis.on === 'function') {
      lenis.on('scroll', function (e) {
        var y = Math.min(e.scroll || 0, 700);
        back.style.transform = 'rotate(2.6deg) translateY(' + (y * 0.08).toFixed(1) + 'px)';
      });
    }
  }

  /* Hero entrance: reveal each [data-step] element in order. */
  function heroStagger() {
    var els = Array.prototype.slice.call(document.querySelectorAll('.hero-el'));
    if (reduce) { els.forEach(function (el) { el.classList.add('in'); }); return; }
    els.forEach(function (el) {
      var step = parseInt(el.getAttribute('data-step'), 10) || 1;
      setTimeout(function () { el.classList.add('in'); }, 120 + step * 130);
    });
  }

  /* Reveal sections/cards as they scroll into view. */
  function scrollReveal() {
    var items = document.querySelectorAll('[data-reveal]');
    if (reduce || !('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(items, function (el) { el.classList.add('reveal-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('reveal-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    Array.prototype.forEach.call(items, function (el) { io.observe(el); });
  }

  /* ============== THE FOUR-ACT DEMO ============== */
  /* One act per headline beat: call → quote → job → invoice. Each act is a
     timed mini-scene; acts auto-advance and loop. ▸ skips ahead, clicking a
     headline beat jumps. Reduced motion: acts render finished, no timers. */

  function slice(x) { return Array.prototype.slice.call(x); }

  var CALL_LINES = [
    { who: 'ai',     text: 'Thanks for calling Rossi Plumbing — what’s going on?', ck: 0 },
    { who: 'caller', text: 'My water heater’s leaking all over the garage…' },
    { who: 'ai',     text: 'That’s an emergency — Marco can be there 2:00–4:00 today. You’re booked.', ck: 1, ckEnd: 2 }
  ];
  var QC_TEXT = '40-gal water heater swap — leaking, garage install';
  var TITLES = ['MALLET FRONT DESK', 'MALLET · NEW QUOTE', 'MALLET · JOB BOARD', 'MALLET · INVOICES'];
  var NEXT_LABELS = ['Next: writes the quote', 'Next: runs the job', 'Next: chases the invoice', 'Replay from the call'];
  var WORD_MS = 210, TYPE_MS = 38, HOLD = 2600;

  var actTimers = [], actIvals = [];
  function at(ms, fn) { actTimers.push(setTimeout(fn, ms)); }
  function clearAct() {
    actTimers.forEach(clearTimeout); actTimers = [];
    actIvals.forEach(clearInterval); actIvals = [];
  }
  function fmtClock(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  /* act 0 — the call: word-by-word captions, checkpoint pills, live timer */
  function runCall(act, animate) {
    var line = act.querySelector('.cc-line');
    var timer = act.querySelector('.cc-timer');
    var checks = slice(act.querySelectorAll('.ck'));
    var aiTile = act.querySelector('.tile.ai-side');
    var callerTile = act.querySelector('.tile.caller-side');
    checks.forEach(function (c) { c.classList.remove('done'); });

    function setLine(l, lit) {
      var html = '<span class="cc-who">' + (l.who === 'ai' ? 'MALLET' : 'CALLER') + '</span>';
      l.text.split(' ').forEach(function (w) {
        html += '<span class="w' + (lit ? ' lit' : '') + '">' + w + '</span> ';
      });
      line.innerHTML = html;
      aiTile.classList.toggle('speaking', !lit && l.who === 'ai');
      callerTile.classList.toggle('speaking', !lit && l.who === 'caller');
    }

    if (!animate) {
      setLine(CALL_LINES[CALL_LINES.length - 1], true);
      checks.forEach(function (c) { c.classList.add('done'); });
      timer.textContent = '0:38';
      return 0;
    }

    timer.textContent = '0:00';
    var secs = 0;
    actIvals.push(setInterval(function () { secs += 1; timer.textContent = fmtClock(secs); }, 1000));

    var t = 500;
    CALL_LINES.forEach(function (l) {
      var words = l.text.split(' ');
      at(t, function () { setLine(l, false); });
      words.forEach(function (_, i) {
        at(t + 200 + i * WORD_MS, function () {
          var w = line.querySelectorAll('.w')[i];
          if (w) w.classList.add('lit');
        });
      });
      var end = t + 200 + words.length * WORD_MS;
      if (typeof l.ck === 'number') at(t + 500, function () { checks[l.ck].classList.add('done'); });
      if (typeof l.ckEnd === 'number') at(end + 300, function () { checks[l.ckEnd].classList.add('done'); });
      t = end + 800;
    });
    at(t + 200, function () {
      checks[3].classList.add('done');
      aiTile.classList.remove('speaking'); callerTile.classList.remove('speaking');
    });
    return t + 900;
  }

  /* act 1 — the quote: the ask types itself, the staged run ticks, GBB lands */
  function runQuote(act, animate) {
    var typed = act.querySelector('.qc-typed');
    var build = act.querySelector('.qc-build');
    var stages = slice(act.querySelectorAll('.qs'));
    var result = act.querySelector('.qc-result');
    build.classList.remove('pressed'); result.classList.remove('on');
    stages.forEach(function (s) { s.classList.remove('run', 'done'); });

    if (!animate) {
      typed.textContent = QC_TEXT;
      build.classList.add('pressed');
      stages.forEach(function (s) { s.classList.add('done'); });
      result.classList.add('on');
      return 0;
    }
    typed.textContent = '';
    for (var i = 1; i <= QC_TEXT.length; i++) (function (n) {
      at(400 + n * TYPE_MS, function () { typed.textContent = QC_TEXT.slice(0, n); });
    })(i);
    var tType = 400 + QC_TEXT.length * TYPE_MS;
    at(tType + 350, function () { build.classList.add('pressed'); });
    var tSt = tType + 950;
    stages.forEach(function (s, i) {
      at(tSt + i * 850, function () { s.classList.add('run'); });
      at(tSt + i * 850 + 800, function () { s.classList.remove('run'); s.classList.add('done'); });
    });
    var tRes = tSt + stages.length * 850 + 350;
    at(tRes, function () { result.classList.add('on'); });
    return tRes + 700;
  }

  /* act 2 — the job: the checklist ticks itself, the crew reports by text */
  function runJob(act, animate) {
    var items = slice(act.querySelectorAll('.jc'));
    var text = act.querySelector('.job-text');
    var meta = act.querySelector('.job-meta');
    items.forEach(function (li) { li.classList.remove('done'); });
    text.classList.remove('on'); meta.classList.remove('on');
    if (!animate) {
      items.forEach(function (li) { li.classList.add('done'); });
      text.classList.add('on'); meta.classList.add('on');
      return 0;
    }
    items.forEach(function (li, i) {
      at(600 + i * 700, function () { li.classList.add('done'); });
    });
    var t = 600 + items.length * 700 + 500;
    at(t, function () { text.classList.add('on'); });
    at(t + 900, function () { meta.classList.add('on'); });
    return t + 1600;
  }

  /* act 3 — the invoice: automatic nudges, then PAID */
  function runInvoice(act, animate) {
    var msgs = slice(act.querySelectorAll('.inv-msg'));
    var paid = act.querySelector('.inv-paid');
    var status = act.querySelector('.inv-status');
    msgs.forEach(function (m) { m.classList.remove('on'); });
    paid.classList.remove('on'); status.classList.remove('paid'); status.textContent = 'SENT';
    function pay() { paid.classList.add('on'); status.classList.add('paid'); status.textContent = 'PAID'; }
    if (!animate) {
      msgs.forEach(function (m) { m.classList.add('on'); });
      pay();
      return 0;
    }
    at(700, function () { msgs[0].classList.add('on'); });
    at(2300, function () { msgs[1].classList.add('on'); });
    at(4100, pay);
    return 4900;
  }

  function frontDesk() {
    var actsWrap = document.getElementById('acts');
    if (!actsWrap) return;
    var acts = slice(actsWrap.querySelectorAll('.act'));
    var beats = slice(document.querySelectorAll('.h1-beats .beat'));
    var title = document.getElementById('stageTitle');
    var nextBtn = document.getElementById('stageNext');
    var RUN = [runCall, runQuote, runJob, runInvoice];
    var current = 0;

    function show(i, animate) {
      clearAct();
      current = i;
      acts.forEach(function (a, j) { a.classList.toggle('on', i === j); });
      beats.forEach(function (b, j) {
        b.classList.toggle('on', j <= i);
        b.classList.toggle('now', j === i);
      });
      if (title) title.textContent = TITLES[i];
      if (nextBtn) nextBtn.setAttribute('aria-label', NEXT_LABELS[i]);
      var dur = RUN[i](acts[i], animate);
      if (animate) at(dur + HOLD, function () { show((i + 1) % acts.length, true); });
    }

    if (nextBtn) nextBtn.addEventListener('click', function () {
      show((current + 1) % acts.length, !reduce);
    });
    beats.forEach(function (b, j) {
      b.setAttribute('role', 'button');
      b.setAttribute('tabindex', '0');
      b.addEventListener('click', function () { show(j, !reduce); });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(j, !reduce); }
      });
    });

    show(0, !reduce);
  }

  /* ============== ROI CALCULATOR ============== */
  /* Deliberately conservative model:
     - answerable = 50% of missed calls (some are spam/wrong numbers)
     - booked     = 40% of answerable
     - software savings = half the current bill
     - hours: ~2.5 office-hrs per tech per week + 6 base office hrs, capped display */
  /* ============== PILLAR VIGNETTES ============== */
  /* Each [data-vignette] card plays its .vg children in sequence while on
     screen, dwells, then loops. Off screen: paused. Reduced motion: static. */
  function vignettes() {
    var hosts = slice(document.querySelectorAll('[data-vignette]'));
    if (!hosts.length) return;
    function finishAll(host) {
      slice(host.querySelectorAll('.vg')).forEach(function (el) { el.classList.add('on'); });
    }
    if (reduce || !('IntersectionObserver' in window)) { hosts.forEach(finishAll); return; }

    var STEP_MS = 950, DWELL_MS = 3400;
    hosts.forEach(function (host) {
      var steps = slice(host.querySelectorAll('.vg'));
      var timers = [], playing = false;
      function stop() { timers.forEach(clearTimeout); timers = []; }
      function loop() {
        steps.forEach(function (el) { el.classList.remove('on'); });
        steps.forEach(function (el, i) {
          timers.push(setTimeout(function () { el.classList.add('on'); }, 400 + i * STEP_MS));
        });
        timers.push(setTimeout(loop, 400 + steps.length * STEP_MS + DWELL_MS));
      }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !playing) { playing = true; loop(); }
          else if (!e.isIntersecting && playing) { playing = false; stop(); finishAll(host); }
        });
      }, { threshold: 0.35 });
      io.observe(host);
    });
  }

  /* One slider set, four pillar payoffs. Deliberately modest assumptions
     (stated in the on-page fine print):
     - Front Desk: 50% of missed calls reachable × 40% book
     - Estimating: ~30 min saved per quote (AI drafts, owner reviews)
     - Foreman: a callback eats half a job's value; checklist prevents 1 in 3
     - Follow-ups: cash currently sitting in unpaid invoices (not in total —
       the chase accelerates it, it isn't new revenue)
     Total = front desk + foreman + software halved. */
  function roiCalc() {
    var r = {
      missed: document.getElementById('rMissed'),
      ticket: document.getElementById('rTicket'),
      quotes: document.getElementById('rQuotes'),
      callbacks: document.getElementById('rCallbacks'),
      unpaid: document.getElementById('rUnpaid'),
      bill: document.getElementById('rBill')
    };
    if (!r.missed) return;

    var fmt = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
    var totalNow = 0;

    function update() {
      var missed = +r.missed.value, ticket = +r.ticket.value, quotes = +r.quotes.value;
      var callbacks = +r.callbacks.value, unpaid = +r.unpaid.value, bill = +r.bill.value;

      document.getElementById('oMissed').textContent = missed;
      document.getElementById('oTicket').textContent = fmt(ticket);
      document.getElementById('oQuotes').textContent = quotes;
      document.getElementById('oCallbacks').textContent = callbacks;
      document.getElementById('oUnpaid').textContent = unpaid;
      document.getElementById('oBill').textContent = fmt(bill);

      var recoveredJobs = missed * 52 * 0.5 * 0.4;        // calls/yr → reachable → booked
      var jobsRevenue = recoveredJobs * ticket;
      var quoteHours = quotes * 52 * 0.5;                 // 30 min per quote
      var callbackSave = callbacks * 12 * (ticket * 0.5) / 3;
      var cashOut = unpaid * ticket;
      var softSaveYr = bill * 12 * 0.5;
      var softSaveMo = bill * 0.5;

      document.getElementById('roiJobs').textContent = fmt(jobsRevenue);
      document.getElementById('roiJobsN').textContent = Math.round(recoveredJobs);
      document.getElementById('roiEst').textContent = Math.round(quoteHours) + ' hrs';
      document.getElementById('roiFore').textContent = fmt(callbackSave);
      document.getElementById('roiCash').textContent = fmt(cashOut);
      document.getElementById('roiSoft').textContent = fmt(softSaveYr);
      document.getElementById('roiSoftM').textContent = fmt(softSaveMo);
      totalNow = jobsRevenue + callbackSave + softSaveYr;
      document.getElementById('roiTotal').textContent = fmt(totalNow);
    }

    Object.keys(r).forEach(function (k) { r[k].addEventListener('input', update); });
    update();

    // moving part: the headline number counts up the first time it scrolls in
    var big = document.getElementById('roiTotal');
    if (big && !reduce && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          io.disconnect();
          var target = totalNow, t0 = null, DUR = 950;
          function tick(ts) {
            if (!t0) t0 = ts;
            var p = Math.min((ts - t0) / DUR, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            big.textContent = fmt(target * eased);
            if (p < 1 && target === totalNow) requestAnimationFrame(tick);
            else big.textContent = fmt(totalNow); // hand back to update()
          }
          requestAnimationFrame(tick);
        });
      }, { threshold: 0.5 });
      io.observe(big);
    }
  }

  /* ============== CONSENT + VISITOR ID ============== */
  /* Shows the privacy-choices card once per visitor. Accept → loads analytics
     (RB2B). Decline → remembers and never loads. */
  var RB2B_KEY = '4O7Z0HZPM2NX'; // RB2B web-identification key (loads only after consent).

  /* Official RB2B snippet shape (app.rb2b.com/script), wrapped so it only runs post-consent. */
  function loadRB2B() {
    if (!RB2B_KEY) return; // not configured — consent choice is still honored
    if (window.reb2b) return;
    window.reb2b = { loaded: true };
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://ddwl4m2hdecbv.cloudfront.net/b/' + RB2B_KEY + '/' + RB2B_KEY + '.js.gz';
    var first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(s, first);
  }

  function consent() {
    var card = document.getElementById('consent');
    if (!card) return;
    var choice = null;
    try { choice = localStorage.getItem('mallet-consent'); } catch (e) { /* private mode */ }

    if (choice === 'yes') { loadRB2B(); return; }
    if (choice === 'no') return;

    card.hidden = false;
    document.getElementById('consentAccept').addEventListener('click', function () {
      try { localStorage.setItem('mallet-consent', 'yes'); } catch (e) {}
      card.hidden = true;
      loadRB2B();
    });
    document.getElementById('consentDecline').addEventListener('click', function () {
      try { localStorage.setItem('mallet-consent', 'no'); } catch (e) {}
      card.hidden = true;
    });
  }

  /* Book-a-demo: every .js-book-demo trigger opens the Calendly popup.
     Calendly's script + CSS are lazy-loaded on the FIRST click (keeps the page fast). */
  function wireCalendly() {
    var triggers = document.querySelectorAll('.js-book-demo');
    if (!triggers.length) return;
    var src = document.querySelector('[data-calendly]');
    var url = src ? (src.getAttribute('data-calendly') || '') : '';
    var configured = url && url.indexOf('MALLET_') !== 0;
    var loaded = false;

    function loadAssets() {
      if (loaded) return; loaded = true;
      var css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://assets.calendly.com/assets/external/widget.css';
      document.head.appendChild(css);
      var s = document.createElement('script');
      s.src = 'https://assets.calendly.com/assets/external/widget.js';
      s.async = true;
      document.body.appendChild(s);
    }

    function open(e) {
      e.preventDefault();
      if (!configured) { location.hash = '#demo'; return; }
      loadAssets();
      var tries = 0;
      (function go() {
        if (window.Calendly && typeof window.Calendly.initPopupWidget === 'function') {
          window.Calendly.initPopupWidget({ url: url });
        } else if (tries++ < 40) {
          setTimeout(go, 100);
        } else {
          window.open(url, '_blank', 'noopener');
        }
      })();
    }
    Array.prototype.forEach.call(triggers, function (t) { t.addEventListener('click', open); });
  }

  /* Load Tally's embed script only if a real iframe (data-tally-src) is present. */
  function loadTallyIfPresent() {
    if (!document.querySelector('iframe[data-tally-src]')) return;
    var s = document.createElement('script');
    s.src = 'https://tally.so/widgets/embed.js';
    s.async = true;
    document.body.appendChild(s);
  }
})();
