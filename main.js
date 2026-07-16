/* Mallet landing — motion, embeds, front-desk demo, rotator, ROI calc, consent. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('DOMContentLoaded', function () {
    heroStagger();
    scrollReveal();
    wireCalendly();
    loadTallyIfPresent();
    frontDesk();
    rotator();
    roiCalc();
    consent();
  });

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
  var deskTimers = [];

  function renderScenario(feed, scenario, animate) {
    // clear pending timers + feed
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
    if (!animate) { lines.forEach(function (el) { el.classList.add('on'); }); return; }

    var STEP = [700, 1400, 1600, 1800, 1500];
    var t = 350;
    lines.forEach(function (el, i) {
      t += STEP[i] || 1400;
      deskTimers.push(setTimeout(function () { el.classList.add('on'); }, t));
    });
  }

  function frontDesk() {
    var feed = document.getElementById('deskFeed');
    if (!feed) return;
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.desk-tab'));

    function select(i) {
      tabs.forEach(function (tb, j) {
        tb.classList.toggle('on', i === j);
        tb.setAttribute('aria-selected', i === j ? 'true' : 'false');
      });
      renderScenario(feed, SCENARIOS[i] || SCENARIOS[0], !reduce);
    }

    tabs.forEach(function (tb) {
      tb.addEventListener('click', function () {
        select(parseInt(tb.getAttribute('data-scenario'), 10) || 0);
      });
    });

    select(0);
  }

  /* ============== ROTATING TRADE WORD (hero) ============== */
  /* Words chosen to be similar length so the headline doesn't reflow between
     two and three lines as they swap. */
  function rotator() {
    var host = document.getElementById('rotator');
    if (!host || reduce) return;
    var words = ['plumbing', 'electrical', 'cleaning', 'roofing', 'painting', 'plumbing', 'HVAC repair', 'landscape'];
    var i = 0;
    var el = host.querySelector('.rot-word');
    setInterval(function () {
      el.classList.remove('on');
      setTimeout(function () {
        i = (i + 1) % words.length;
        el.textContent = words[i];
        el.classList.add('on');
      }, 340);
    }, 2600);
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

      document.getElementById('roiJobs').textContent = fmt(jobsRevenue);
      document.getElementById('roiJobsN').textContent = Math.round(recoveredJobs);
      document.getElementById('roiSoft').textContent = fmt(softSaveYr);
      document.getElementById('roiSoftM').textContent = fmt(softSaveMo);
      document.getElementById('roiHours').textContent = Math.round(hours) + ' hrs';
      document.getElementById('roiTotal').textContent = fmt(jobsRevenue + softSaveYr);
    }

    Object.keys(r).forEach(function (k) { r[k].addEventListener('input', update); });
    update();
  }

  /* ============== CONSENT + VISITOR ID ============== */
  /* Shows the privacy-choices card once per visitor. Accept → loads analytics
     (RB2B). Decline → remembers and never loads. */
  var RB2B_KEY = ''; // TODO(Owen): paste your RB2B site key ("!function () {...}(KEY)" snippet value) here.

  function loadRB2B() {
    if (!RB2B_KEY) return; // not configured yet — consent choice is still honored
    !function () {
      var reb2b = window.reb2b = window.reb2b || [];
      if (reb2b.invoked) return;
      reb2b.invoked = true;
      reb2b.methods = ['identify', 'collect'];
      reb2b.factory = function (method) {
        return function () {
          var args = Array.prototype.slice.call(arguments);
          args.unshift(method); reb2b.push(args); return reb2b;
        };
      };
      for (var i = 0; i < reb2b.methods.length; i++) {
        var key = reb2b.methods[i]; reb2b[key] = reb2b.factory(key);
      }
      reb2b.load = function (key) {
        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://ddwl4m2hdecbv.cloudfront.net/b/' + key + '/' + key + '.js.gz';
        var first = document.getElementsByTagName('script')[0];
        first.parentNode.insertBefore(script, first);
      };
      reb2b.SNIPPET_VERSION = '1.0.1';
      reb2b.load(RB2B_KEY);
    }();
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
