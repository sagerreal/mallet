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

  /* ============== FRONT DESK — scenario player ============== */
  /* Three call scenarios. Clicking a tab replays the feed for that scenario.
     Line kinds: meta (mono system line), in (Mallet bubble), out (caller bubble),
     done (mono success line). Reduced motion: render final state, no animation. */
  var SCENARIOS = [
    [ // 0 — water heater emergency
      { k: 'meta', t: '07:42:11', text: "Incoming call · (555) 480-2214 — you're under a sink. Mallet picks up." },
      { k: 'in',  text: '“Thanks for calling Rossi Plumbing — I can get someone out today. What’s going on?”' },
      { k: 'out', text: '“My water heater’s leaking all over the garage…”' },
      { k: 'in',  text: '“That’s an emergency — I have 2:00–4:00 today with Marco. Booked. Confirmation is on its way to your phone.”' },
      { k: 'done', t: '07:43:02', text: 'Job created · quote drafted from your pricebook · Marco notified by text' }
    ],
    [ // 1 — the 7:04 AM call
      { k: 'meta', t: '07:04:19', text: 'Incoming call · (555) 217-8830 — before opening hours. Mallet picks up.' },
      { k: 'out', text: '“Hi — our AC died overnight and we’ve got a baby at home. Anyone free today?”' },
      { k: 'in',  text: '“We can absolutely help. First opening is 9:30 this morning with Dana — should I lock it in?”' },
      { k: 'out', text: '“Yes please!”' },
      { k: 'done', t: '07:05:44', text: 'Booked 9:30 AM · customer texted a confirmation · Dana’s day updated' }
    ],
    [ // 2 — "can I get a quote?"
      { k: 'meta', t: '13:26:03', text: 'Text from (555) 903-4471 · photo attached — a rusted 40-gal water heater.' },
      { k: 'out', text: '“How much to replace this? It’s original to the house.”' },
      { k: 'in',  text: '“I’ll put together options right now — give me two minutes.”' },
      { k: 'in',  text: '“Sent! Good / Better / Best, priced from our book — tap to approve and we’ll get you scheduled.”' },
      { k: 'done', t: '13:29:31', text: 'Quote #1042 sent · 3 options from YOUR pricebook · follow-up scheduled for Thursday' }
    ]
  ];
  /* Stage choreography: as feed line `line` lands (+extra ms), light headline
     beat `beat` and/or pop receipt chip `chip` with `label`. Beats: 0 call,
     1 quote, 2 job, 3 invoice. */
  var CHOREO = [
    [ // 0 — water heater emergency
      { line: 0, beat: 0 },
      { line: 3, chip: 0, label: 'Booked · 2:00–4:00 · Marco' },
      { line: 4, beat: 1, chip: 1, label: 'Quote drafted · your pricebook' },
      { line: 4, extra: 800, beat: 2, chip: 2, label: 'Marco · notified by text' }
    ],
    [ // 1 — the 7:04 AM call
      { line: 0, beat: 0 },
      { line: 4, chip: 0, label: 'Booked · 9:30 · Dana' },
      { line: 4, extra: 700, chip: 1, label: 'Confirmation · texted' },
      { line: 4, extra: 1400, beat: 2, chip: 2, label: 'Dana’s day · updated' }
    ],
    [ // 2 — "can I get a quote?"
      { line: 0, beat: 0 },
      { line: 3, beat: 1, chip: 0, label: 'Quote #1042 · Good/Better/Best' },
      { line: 4, chip: 1, label: 'Priced from YOUR book' },
      { line: 4, extra: 800, beat: 3, chip: 2, label: 'Follow-up · Thursday' }
    ]
  ];
  var deskTimers = [];

  /* Renders a scenario into the feed. Returns the per-line reveal times (ms)
     so the stage can schedule chips/beats off the same clock. */
  function renderScenario(feed, scenario, animate) {
    deskTimers.forEach(clearTimeout);
    deskTimers = [];
    feed.innerHTML = '';

    scenario.forEach(function (line) {
      var el;
      if (line.k === 'meta' || line.k === 'done') {
        el = document.createElement('p');
        el.className = 'feed-meta' + (line.k === 'done' ? ' done' : '');
        el.setAttribute('data-t', line.t || '');
        if (line.k === 'done') {
          var ok = document.createElement('span');
          ok.className = 'ok'; ok.setAttribute('aria-hidden', 'true'); ok.innerHTML = '&check; ';
          el.appendChild(ok);
        }
        el.appendChild(document.createTextNode(line.text));
      } else {
        el = document.createElement('p');
        el.className = 'feed-bubble ' + line.k;
        el.textContent = line.text;
      }
      feed.appendChild(el);
    });

    var lines = Array.prototype.slice.call(feed.children);
    if (!animate) { lines.forEach(function (el) { el.classList.add('on'); }); return []; }

    var STEP = [700, 1400, 1600, 1800, 1500];
    var t = 350;
    var times = [];
    lines.forEach(function (el, i) {
      t += STEP[i] || 1400;
      times.push(t);
      deskTimers.push(setTimeout(function () { el.classList.add('on'); }, t));
    });
    return times;
  }

  /* The hero stage: scenarios auto-cycle; chips pop and headline beats light
     in sync with the feed. Dots switch scenarios manually. */
  var HOLD_AFTER = 3400; // dwell on the finished scenario before advancing

  function frontDesk() {
    var feed = document.getElementById('deskFeed');
    if (!feed) return;
    var dots = Array.prototype.slice.call(document.querySelectorAll('.sdot'));
    var chips = Array.prototype.slice.call(document.querySelectorAll('.stage-chips .chip'));
    var beats = Array.prototype.slice.call(document.querySelectorAll('.h1-beats .beat'));

    function resetStage() {
      chips.forEach(function (c) { c.classList.remove('on'); });
      beats.forEach(function (b) { b.classList.remove('on'); });
    }

    function applyEvent(ev) {
      if (typeof ev.beat === 'number' && beats[ev.beat]) beats[ev.beat].classList.add('on');
      if (typeof ev.chip === 'number' && chips[ev.chip] && ev.label) {
        chips[ev.chip].textContent = ev.label;
        chips[ev.chip].classList.add('on');
      }
    }

    function select(i) {
      dots.forEach(function (d, j) {
        d.classList.toggle('on', i === j);
        d.setAttribute('aria-selected', i === j ? 'true' : 'false');
      });
      resetStage();

      var scenario = SCENARIOS[i] || SCENARIOS[0];
      var events = CHOREO[i] || [];

      if (reduce) { // static final state: everything lit, no timers
        renderScenario(feed, scenario, false);
        beats.forEach(function (b) { b.classList.add('on'); });
        events.forEach(applyEvent);
        return;
      }

      var times = renderScenario(feed, scenario, true);
      var last = times[times.length - 1] || 0;
      events.forEach(function (ev) {
        var at = (times[ev.line] || 0) + 420 + (ev.extra || 0);
        last = Math.max(last, at);
        deskTimers.push(setTimeout(function () { applyEvent(ev); }, at));
      });
      deskTimers.push(setTimeout(function () { select((i + 1) % SCENARIOS.length); }, last + HOLD_AFTER));
    }

    dots.forEach(function (d) {
      d.addEventListener('click', function () {
        select(parseInt(d.getAttribute('data-scenario'), 10) || 0);
      });
    });

    select(0);
  }

  /* ============== ROI CALCULATOR ============== */
  /* Deliberately conservative model:
     - answerable = 50% of missed calls (some are spam/wrong numbers)
     - booked     = 40% of answerable
     - software savings = half the current bill
     - hours: ~2.5 office-hrs per tech per week + 6 base office hrs, capped display */
  function roiCalc() {
    var r = {
      techs: document.getElementById('rTechs'),
      missed: document.getElementById('rMissed'),
      ticket: document.getElementById('rTicket'),
      bill: document.getElementById('rBill')
    };
    if (!r.techs) return;

    var fmt = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };

    function update() {
      var techs = +r.techs.value, missed = +r.missed.value, ticket = +r.ticket.value, bill = +r.bill.value;

      document.getElementById('oTechs').textContent = techs;
      document.getElementById('oMissed').textContent = missed;
      document.getElementById('oTicket').textContent = fmt(ticket);
      document.getElementById('oBill').textContent = fmt(bill);

      var recoveredJobs = missed * 52 * 0.5 * 0.4;      // calls/yr → answerable → booked
      var jobsRevenue = recoveredJobs * ticket;
      var softSaveYr = bill * 12 * 0.5;
      var softSaveMo = bill * 0.5;
      var hours = Math.min(2.5 * techs + 6, 60);

      var hoursEl = document.getElementById('roiHours');
      if (hoursEl) hoursEl.textContent = Math.round(hours) + ' hrs';
      document.getElementById('roiJobs').textContent = fmt(jobsRevenue);
      document.getElementById('roiJobsN').textContent = Math.round(recoveredJobs);
      document.getElementById('roiSoft').textContent = fmt(softSaveYr);
      document.getElementById('roiSoftM').textContent = fmt(softSaveMo);
      document.getElementById('roiTotal').textContent = fmt(jobsRevenue + softSaveYr);
    }

    Object.keys(r).forEach(function (k) { r[k].addEventListener('input', update); });
    update();
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
