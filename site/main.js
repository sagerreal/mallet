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
    platformTour();
    easyScenes();
    tradeFlip();
    roiCalc();
    consent();
    wireConversionEvents();
    scrollDepth();
    exitIntent();
    mobileNav();
  });

  /* Hero trade rotator: cycles the verticals; the slot's width animates to
     each word so the sentence slides instead of reflowing. Reduced motion:
     stays on the first trade. */
  function tradeFlip() {
    var host = document.getElementById('tradeFlip');
    if (!host || reduce) return;
    var TRADES = ['plumbers', 'electricians', 'garage door pros', 'roofers', 'HVAC techs', 'tree crews', 'septic pros', 'appliance techs', 'fence builders', 'painters'];
    var word = host.querySelector('.tf-word');

    // hidden measurer with the same type styles → target width per word
    var meas = document.createElement('b');
    meas.className = 'tf-word';
    meas.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;opacity:1;transform:none;white-space:nowrap';
    host.appendChild(meas);
    function widthOf(t) { meas.textContent = t; return meas.offsetWidth; }

    host.style.width = widthOf(TRADES[0]) + 'px';
    var i = 0;
    setInterval(function () {
      i = (i + 1) % TRADES.length;
      word.classList.remove('on');
      host.style.width = widthOf(TRADES[i]) + 'px'; // width glides while the word fades
      setTimeout(function () {
        word.textContent = TRADES[i];
        word.classList.add('on');
      }, 230);
    }, 2100);
  }

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
  var WORD_MS = 125, TYPE_MS = 20, HOLD = 1400;

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

    var t = 350;
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
      t = end + 420;
    });
    at(t + 150, function () {
      checks[3].classList.add('done');
      aiTile.classList.remove('speaking'); callerTile.classList.remove('speaking');
    });
    return t + 550;
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
    at(tType + 250, function () { build.classList.add('pressed'); });
    var tSt = tType + 650;
    stages.forEach(function (s, i) {
      at(tSt + i * 550, function () { s.classList.add('run'); });
      at(tSt + i * 550 + 500, function () { s.classList.remove('run'); s.classList.add('done'); });
    });
    var tRes = tSt + stages.length * 550 + 250;
    at(tRes, function () { result.classList.add('on'); });
    return tRes + 450;
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
      at(400 + i * 420, function () { li.classList.add('done'); });
    });
    var t = 400 + items.length * 420 + 350;
    at(t, function () { text.classList.add('on'); });
    at(t + 550, function () { meta.classList.add('on'); });
    return t + 1000;
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
    at(450, function () { msgs[0].classList.add('on'); });
    at(1450, function () { msgs[1].classList.add('on'); });
    at(2600, pay);
    return 3200;
  }

  /* Scroll-driven on desktop: the .hero-track is tall, the scene pins, and
     scroll progress picks the stage (Front Desk → Estimating → Foreman →
     Follow-ups). The flow rail fills and the outcome card updates in step.
     Mobile / reduced motion: no pin (CSS), the acts auto-play instead. */
  var ANNO = [
    { t: 'MISSED CALL', w: 'Sarah K.', rows: ['Texted back in 6 seconds', 'Booked without you'] },
    { t: 'NEW QUOTE', w: 'Sarah K.', rows: ['Priced from your book', 'Good / Better / Best sent'] },
    { t: 'ON SITE', w: 'Marco', rows: ['Checklist from the office', 'Photos land in the job file'] },
    { t: 'PAID', w: '$2,585', rows: ['Reminders sent themselves', 'Paid — no chasing'] }
  ];

  function frontDesk() {
    var actsWrap = document.getElementById('acts');
    if (!actsWrap) return;
    var acts = slice(actsWrap.querySelectorAll('.act'));
    var frNodes = slice(document.querySelectorAll('.flow-rail .fr'));
    var frFill = document.getElementById('frFill');
    var title = document.getElementById('stageTitle');
    var nextBtn = document.getElementById('stageNext');
    var acTitle = document.getElementById('acTitle');
    var acWho = document.getElementById('acWho');
    var acList = document.getElementById('acList');
    var track = document.querySelector('.hero-track');
    var RUN = [runCall, runQuote, runJob, runInvoice];
    var N = acts.length, current = -1;
    var pinScroll = !!track && !reduce && window.matchMedia('(min-width:861px)').matches;
    var driven = pinScroll; // scroll picks the stage; timer runs otherwise

    function paintRail(i) {
      frNodes.forEach(function (n, j) {
        n.classList.toggle('on', j === i);
        n.classList.toggle('done', j < i);
      });
      if (frFill) frFill.style.height = (N > 1 ? (i / (N - 1)) * 100 : 0) + '%';
    }
    function paintAnno(i) {
      var a = ANNO[i]; if (!a) return;
      if (acTitle) acTitle.textContent = a.t;
      if (acWho) acWho.textContent = a.w;
      if (acList) acList.innerHTML = a.rows.map(function (r) { return '<li>✓ ' + r + '</li>'; }).join('');
    }
    function show(i, animate) {
      if (i === current) return;
      clearAct();
      current = i;
      acts.forEach(function (a, j) { a.classList.toggle('on', i === j); });
      paintRail(i); paintAnno(i);
      if (title) title.textContent = TITLES[i];
      if (nextBtn) nextBtn.setAttribute('aria-label', NEXT_LABELS[i]);
      var dur = RUN[i](acts[i], animate);
      if (!driven && animate) at(dur + HOLD, function () { show((i + 1) % N, true); });
    }
    function scrollToStage(j) {
      if (!track) return;
      var total = track.offsetHeight - window.innerHeight;
      var y = track.offsetTop + Math.min(0.99, (j + 0.15) / N) * total;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }

    if (nextBtn) nextBtn.addEventListener('click', function () {
      if (pinScroll) scrollToStage((current + 1) % N);
      else { driven = false; show((current + 1) % N, !reduce); }
    });
    frNodes.forEach(function (n, j) {
      n.setAttribute('role', 'button');
      n.setAttribute('tabindex', '0');
      function go() { if (pinScroll) scrollToStage(j); else { driven = false; show(j, !reduce); } }
      n.addEventListener('click', go);
      n.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });

    if (pinScroll) {
      var ticking = false;
      var onScroll = function () {
        var total = track.offsetHeight - window.innerHeight;
        var scrolled = -track.getBoundingClientRect().top;
        var p = total > 0 ? Math.min(1, Math.max(0, scrolled / total)) : 0;
        var i = Math.min(N - 1, Math.floor(p * N));
        if (i !== current) show(i, true);
      };
      window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; requestAnimationFrame(function () { onScroll(); ticking = false; }); }
      }, { passive: true });
      show(0, true); onScroll();
    } else {
      show(0, !reduce);
    }
  }

  /* ============== THE PLATFORM TOUR (pinned scrolly) ============== */
  /* Desktop: the .tour section is 420vh; the frame pins and scroll progress
     picks the active stop (Messages → Pipeline → Jobs → Invoices). Sidebar
     stops scroll you to their segment. Mobile/reduced motion: no pinning
     (CSS unpins), stops are plain tabs. */
  /* --- per-stop scenes: each panel plays itself when it becomes active --- */
  var tourTimers = [];
  function tAt(ms, fn) { tourTimers.push(setTimeout(fn, ms)); }
  function clearTour() { tourTimers.forEach(clearTimeout); tourTimers = []; }

  /* steps carry their own clock: data-t = reveal ms, data-off = hide ms */
  function sceneMessages(panel, animate) {
    var steps = slice(panel.querySelectorAll('.sc'));
    steps.forEach(function (s) { s.classList.remove('on', 'gone'); });
    if (!animate) {
      steps.forEach(function (s) {
        s.classList.add('on');
        if (s.hasAttribute('data-off')) s.classList.add('gone');
      });
      return;
    }
    steps.forEach(function (s) {
      tAt(parseInt(s.getAttribute('data-t'), 10) || 400, function () { s.classList.add('on'); });
      if (s.hasAttribute('data-off')) {
        tAt(parseInt(s.getAttribute('data-off'), 10), function () { s.classList.add('gone'); });
      }
    });
  }

  function scenePipeline(panel, animate) {
    var chips = slice(panel.querySelectorAll('.sc-g'));
    var card = panel.querySelector('#cardSarah');
    var ghost = panel.querySelector('#cardSarahOut');
    var cq = panel.querySelector('#cntQuoting'), co = panel.querySelector('#cntOut');
    chips.forEach(function (ch) { ch.classList.remove('on'); });
    card.classList.remove('depart'); card.style.display = '';
    ghost.classList.remove('arrive');
    cq.textContent = '2'; co.textContent = '1';
    if (!animate) {
      chips.forEach(function (ch) { ch.classList.add('on'); });
      card.style.display = 'none';
      ghost.classList.add('arrive');
      cq.textContent = '1'; co.textContent = '2';
      return;
    }
    chips.forEach(function (ch, i) { tAt(600 + i * 320, function () { ch.classList.add('on'); }); });
    tAt(2400, function () { card.classList.add('depart'); });
    tAt(2950, function () {
      card.style.display = 'none';
      ghost.classList.add('arrive');
      cq.textContent = '1'; co.textContent = '2';
    });
  }

  function sceneJobs(panel, animate) {
    var items = slice(panel.querySelectorAll('.sc-ck'));
    var done = panel.querySelector('.sc-ckdone');
    var status = panel.querySelector('#jobSarahStatus');
    items.forEach(function (li) { li.classList.remove('on', 'done'); });
    done.classList.remove('on');
    status.textContent = 'IN PROGRESS'; status.className = 'af-status prog';
    if (!animate) {
      items.forEach(function (li) { li.classList.add('on', 'done'); });
      done.classList.add('on');
      status.textContent = 'DONE · UNBILLED'; status.className = 'af-status done';
      return;
    }
    items.forEach(function (li, i) {
      tAt(400 + i * 250, function () { li.classList.add('on'); });
      tAt(1600 + i * 650, function () { li.classList.add('done'); });
    });
    var tEnd = 1600 + items.length * 650 + 300;
    tAt(tEnd, function () { done.classList.add('on'); });
    tAt(tEnd + 700, function () {
      status.textContent = 'DONE · UNBILLED'; status.className = 'af-status done';
    });
  }

  var AGENT_Q = 'what money can I go get today?';
  function sceneAgent(panel, animate) {
    var q = panel.querySelector('#agentQ');
    var caret = panel.querySelector('#agentCaret');
    var thinking = panel.querySelector('#agentThinking');
    var answer = panel.querySelector('#agentAnswer');
    var hector = panel.querySelector('#invHectorStatus');
    q.textContent = ''; caret.style.display = '';
    thinking.classList.remove('on', 'gone');
    answer.classList.remove('on');
    hector.textContent = 'OVERDUE · 42D'; hector.className = 'af-status warn';
    if (!animate) {
      q.textContent = AGENT_Q; caret.style.display = 'none';
      thinking.classList.add('gone');
      answer.classList.add('on');
      hector.textContent = 'CHASE SENT'; hector.className = 'af-status done';
      return;
    }
    for (var i = 1; i <= AGENT_Q.length; i++) (function (n) {
      tAt(400 + n * 45, function () { q.textContent = AGENT_Q.slice(0, n); });
    })(i);
    var tQ = 400 + AGENT_Q.length * 45;
    tAt(tQ + 300, function () { thinking.classList.add('on'); });
    tAt(tQ + 2100, function () { thinking.classList.add('gone'); answer.classList.add('on'); });
    tAt(tQ + 3300, function () {
      hector.textContent = 'CHASE SENT'; hector.className = 'af-status done';
    });
  }

  var SCENES = [sceneMessages, scenePipeline, sceneJobs, sceneAgent];
  var SCENE_DUR = [7000, 5600, 7200, 8600]; // scene length + dwell before auto-advancing

  function platformTour() {
    var tour = document.querySelector('.tour');
    if (!tour) return;
    var stops = slice(tour.querySelectorAll('.af-item.stop'));
    var panels = slice(tour.querySelectorAll('.af-panel'));
    var order = stops.map(function (s) { return parseInt(s.getAttribute('data-stop'), 10) || 0; });
    var current = -1;
    var auto = true; // pages flip themselves until someone clicks one

    function activate(i) {
      if (i === current) return;
      current = i;
      clearTour();
      panels.forEach(function (p, j) { p.classList.toggle('on', i === j); });
      stops.forEach(function (s, k) { s.classList.toggle('on', order[k] === i); });
      SCENES[i](panels[i], !reduce);
      if (auto && !reduce) {
        tAt(SCENE_DUR[i], function () { activate((i + 1) % panels.length); });
      }
    }

    stops.forEach(function (s, k) {
      s.addEventListener('click', function () {
        auto = false; // they picked a page — stay on it
        activate(order[k]);
      });
    });

    // start the loop when the frame first comes into view
    if (!reduce && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { io.disconnect(); activate(0); }
        });
      }, { threshold: 0.25 });
      io.observe(tour.querySelector('.app-frame'));
    } else {
      activate(0);
    }
  }

  /* ============== THE EASY PART — both cards loop their scene ============== */
  var EZ_ASK = 'invoice the Johnson job and remind Rita about Thursday';
  function easyScenes() {
    var section = document.querySelector('.easy');
    if (!section) return;
    var steps = slice(section.querySelectorAll('.ez'));
    var typed = document.getElementById('ezTyped');
    if (reduce) {
      steps.forEach(function (s) { s.classList.add('on'); });
      if (typed) typed.textContent = EZ_ASK;
      return;
    }
    var timers = [], playing = false;
    function loop() {
      steps.forEach(function (s) { s.classList.remove('on'); });
      if (typed) typed.textContent = '';
      steps.forEach(function (s) {
        timers.push(setTimeout(function () { s.classList.add('on'); },
          parseInt(s.getAttribute('data-t'), 10) || 400));
      });
      for (var i = 1; i <= EZ_ASK.length; i++) (function (n) {
        timers.push(setTimeout(function () { typed.textContent = EZ_ASK.slice(0, n); }, 500 + n * 42));
      })(i);
      timers.push(setTimeout(loop, 5200 + 3400)); // longest step + dwell
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !playing) { playing = true; loop(); }
        else if (!e.isIntersecting && playing) {
          playing = false;
          timers.forEach(clearTimeout); timers = [];
          steps.forEach(function (s) { s.classList.add('on'); });
          if (typed) typed.textContent = EZ_ASK;
        }
      });
    }, { threshold: 0.3 });
    io.observe(section.querySelector('.easy-grid'));
  }

  /* The math, one panel per pillar. Tabs/▸ switch panels (same grammar as
     the hero stage); the job-value slider appears in three panels and stays
     synced. Assumptions are deliberately modest and stated in the fine print:
     - Front Desk: 50% of missed calls reachable × 40% book
     - Estimating: ~30 min saved per quote (drafts itself, owner reviews)
     - Foreman: a callback eats half a job's value; checklist prevents 1 in 3
     - Follow-ups: cash sitting in unpaid invoices (not in the annual total —
       it's money already earned, the chase just brings it in sooner)
     Total = front desk + foreman. */
  function roiCalc() {
    var r = {
      missed: document.getElementById('rMissed'),
      quotes: document.getElementById('rQuotes'),
      callbacks: document.getElementById('rCallbacks'),
      unpaid: document.getElementById('rUnpaid')
    };
    if (!r.missed) return;
    var tickets = slice(document.querySelectorAll('.js-ticket'));
    var ticketOuts = slice(document.querySelectorAll('.js-ticket-out'));

    var fmt = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
    var totalNow = 0;
    var pctReal = 50, pctBook = 40; // the receipt's adjustable assumptions

    function update() {
      var missed = +r.missed.value, quotes = +r.quotes.value, callbacks = +r.callbacks.value;
      var unpaid = +r.unpaid.value;
      var ticket = tickets.length ? +tickets[0].value : 450;

      document.getElementById('oMissed').textContent = missed;
      document.getElementById('oQuotes').textContent = quotes;
      document.getElementById('oCallbacks').textContent = callbacks;
      document.getElementById('oUnpaid').textContent = unpaid;
      ticketOuts.forEach(function (o) { o.textContent = fmt(ticket); });

      var recoveredJobs = missed * 52 * (pctReal / 100) * (pctBook / 100); // calls/yr → real → booked
      var jobsRevenue = recoveredJobs * ticket;
      var quoteHours = quotes * 52 * 0.5;                 // 30 min per quote
      var callbackSave = callbacks * 12 * (ticket * 0.5) / 3;
      var cashOut = unpaid * ticket;

      document.getElementById('pDesk').textContent = fmt(jobsRevenue);
      document.getElementById('pDeskN').textContent = Math.round(recoveredJobs);
      var wm1 = document.getElementById('wm1');
      if (wm1) {
        var callsYr = missed * 52;
        wm1.textContent = callsYr.toLocaleString('en-US');
        document.getElementById('wm2').textContent = Math.round(callsYr * pctReal / 100).toLocaleString('en-US');
        document.getElementById('wm3').textContent = Math.round(recoveredJobs).toLocaleString('en-US') + ' jobs';
        document.getElementById('wm4').textContent = fmt(jobsRevenue);
        document.getElementById('wkPctReal').textContent = pctReal + '%';
        document.getElementById('wkPctBook').textContent = (pctBook / 10) + ' in 10';
      }
      var wksEl = document.getElementById('pEstWeeks');
      if (wksEl) wksEl.textContent = 'almost ' + (Math.round(quoteHours / 40 * 10) / 10) + ' 40-hour weeks';
      document.getElementById('pEst').textContent = Math.round(quoteHours) + ' hrs';
      document.getElementById('pFore').textContent = fmt(callbackSave);
      document.getElementById('pCash').textContent = fmt(cashOut);
      document.getElementById('roiHrs').textContent = Math.round(quoteHours);
      totalNow = jobsRevenue + callbackSave;
      document.getElementById('roiTotal').textContent = fmt(totalNow);
    }

    Object.keys(r).forEach(function (k) { r[k].addEventListener('input', update); });
    var mBtn = document.getElementById('wkMathBtn'), mBox = document.getElementById('wkMath');
    if (mBox) {
      mBox.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-t]');
        if (!b) return;
        var d = parseInt(b.getAttribute('data-d'), 10);
        if (b.getAttribute('data-t') === 'real') pctReal = Math.min(90, Math.max(30, pctReal + d));
        else pctBook = Math.min(70, Math.max(20, pctBook + d));
        update();
        window.malletTrack('worksheet_assumption_adjust', { real: pctReal, book: pctBook });
      });
    }
    if (mBtn && mBox) {
      mBtn.addEventListener('click', function () {
        var open = mBox.hidden;
        mBox.hidden = !open;
        mBtn.innerHTML = open ? 'Hide the math &uarr;' : 'See the math &darr;';
        window.malletTrack('worksheet_math_open', {});
      });
    }
    tickets.forEach(function (t) {
      t.addEventListener('input', function () {
        tickets.forEach(function (o) { if (o !== t) o.value = t.value; });
        update();
      });
    });
    update();

    // panel switching: tabs jump, ▸ advances and loops
    var tabs = slice(document.querySelectorAll('.mtab'));
    var panels = slice(document.querySelectorAll('.mpanel'));
    var next = document.getElementById('mathNext');
    var cur = 0;
    function show(i) {
      cur = i;
      tabs.forEach(function (t, j) {
        t.classList.toggle('on', i === j);
        t.setAttribute('aria-selected', i === j ? 'true' : 'false');
      });
      panels.forEach(function (p, j) { p.classList.toggle('on', i === j); });
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () { show(parseInt(t.getAttribute('data-panel'), 10) || 0); });
    });
    if (next) next.addEventListener('click', function () { show((cur + 1) % panels.length); });

    // moving part: the total counts up the first time it scrolls in
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
  /* ============== MOBILE NAV ============== */
  function mobileNav() {
    var burger = document.querySelector('.nav-burger');
    var panel = document.getElementById('mnav');
    if (!burger || !panel) return;
    burger.addEventListener('click', function () {
      var open = panel.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    slice(panel.querySelectorAll('a')).forEach(function (a) {
      a.addEventListener('click', function () {
        panel.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ============== EXIT INTENT — the Leak Check, one last time ============== */
  /* Desktop only (needs a real cursor). Shows once per visitor when the mouse
     leaves the top of the viewport after 5s of dwell. Skipped on /leak-check
     and for anyone who already finished the check. */
  function exitIntent() {
    if (location.pathname.indexOf('leak-check') !== -1) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    try {
      if (localStorage.getItem('mallet-exit-shown') || localStorage.getItem('mallet-lc-done')) return;
    } catch (e) { return; }

    var t0 = Date.now(), shown = false;

    function dismiss(ov) {
      ov.remove();
      window.malletTrack('exit_popup_dismiss', {});
    }

    function build() {
      var ov = document.createElement('div');
      ov.className = 'exit-ov';
      ov.innerHTML =
        '<div class="exit-card" role="dialog" aria-modal="true" aria-labelledby="exitH">' +
        '<p class="hero-kicker">Before you go</p>' +
        '<h3 id="exitH">Leaving without your number?</h3>' +
        '<p class="exit-p">Seven questions, two minutes &mdash; see what missed calls, slow quotes, and unpaid invoices cost your shop every year.</p>' +
        '<div class="exit-actions">' +
        '<a class="btn-amber lg" href="/leak-check">Get my Leak Score &rarr;</a>' +
        '<button class="exit-no" type="button">No thanks</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) dismiss(ov); });
      ov.querySelector('.exit-no').addEventListener('click', function () { dismiss(ov); });
      ov.querySelector('a').addEventListener('click', function () {
        window.malletTrack('exit_popup_click', {});
      });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', esc); if (ov.parentNode) dismiss(ov); }
      });
      window.malletTrack('exit_popup_shown', {});
    }

    document.addEventListener('mouseout', function (e) {
      if (shown || e.relatedTarget || e.clientY > 0) return;
      if (Date.now() - t0 < 5000) return;
      shown = true;
      try { localStorage.setItem('mallet-exit-shown', '1'); } catch (err) {}
      build();
    });
  }

  /* ============== CONSENT + VISITOR ID + ANALYTICS ============== */
  /* Shows the privacy-choices card once per visitor. Accept → loads analytics
     (RB2B + GA4). Decline → remembers and never loads. */
  var RB2B_KEY = '4O7Z0HZPM2NX'; // RB2B web-identification key (loads only after consent).
  var GA4_ID = 'G-DQFMJ5R3K5';               // e.g. 'G-XXXXXXXXXX' — paste from GA4 Admin → Data Streams. Empty = GA off.

  /* GA4, consent-gated. window.malletTrack(event, params) is safe to call anywhere. */
  function loadGA4() {
    if (!GA4_ID || window.gtag) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID);
  }
  window.malletTrack = function (ev, params) {
    if (window.gtag) window.gtag('event', ev, params || {});                      // GA4 (consent-gated)
    try { if (typeof window.va === 'function') window.va('event', { name: ev }); } catch (e) {} // Vercel (cookieless — counts everyone)
  };

  /* Conversion events: demo clicks + Tally form submissions (postMessage). */
  function wireConversionEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('.js-book-demo'), function (t) {
      t.addEventListener('click', function () {
        window.malletTrack('demo_click', { page: location.pathname });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('a[href*="leak-check"]'), function (t) {
      t.addEventListener('click', function () {
        window.malletTrack('leak_check_click', { page: location.pathname, spot: t.className.indexOf('notice') !== -1 ? 'bar' : 'cta' });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('a[href*="waitlist"]'), function (t) {
      t.addEventListener('click', function () {
        window.malletTrack('pilot_click', { page: location.pathname });
      });
    });
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (typeof d === 'string' && d.indexOf('Tally.FormSubmitted') !== -1) {
        window.malletTrack('lead_submit', { page: location.pathname });
      } else if (d && d.event === 'Tally.FormSubmitted') {
        window.malletTrack('lead_submit', { page: location.pathname });
      }
    });
  }

  /* Scroll depth: fire once at each quarter reached — shows how far visitors get before they leave. */
  function scrollDepth() {
    var marks = [25, 50, 75, 100], hit = {}, ticking = false;
    function check() {
      var doc = document.documentElement;
      var total = doc.scrollHeight - window.innerHeight;
      if (total <= 0) return;
      var pct = Math.round((window.scrollY || doc.scrollTop) / total * 100);
      marks.forEach(function (m) {
        if (!hit[m] && pct >= m) { hit[m] = 1; window.malletTrack('scroll_' + m); }
      });
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(function () { check(); ticking = false; }); }
    }, { passive: true });
    check();
  }

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
    var choice = null;
    try { choice = localStorage.getItem('mallet-consent'); } catch (e) { /* private mode */ }
    var card = document.getElementById('consent');

    if (choice === 'yes') { loadRB2B(); loadGA4(); return; }
    if (choice === 'no' || !card) return;

    card.hidden = false;
    document.getElementById('consentAccept').addEventListener('click', function () {
      try { localStorage.setItem('mallet-consent', 'yes'); } catch (e) {}
      card.hidden = true;
      loadRB2B();
      loadGA4();
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
