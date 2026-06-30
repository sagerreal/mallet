/* Mallet landing — hand-built interactive flow demos in the PRODUCT's real visual language.
   Show, don't tell: tap the glowing action; the app advances like the real thing. */
(function () {
  'use strict';

  function shell(active, body) {
    var items = [['home', 'Home'], ['cust', 'Customers'], ['jobs', 'Jobs'], ['money', 'Money']];
    var nav = items.map(function (n) {
      return '<span class="mf-ni' + (n[0] === active ? ' on' : '') + '">' + n[1] + '</span>';
    }).join('');
    return '<div class="mflow">'
      + '<aside class="mf-side">'
      + '<div class="mf-brand"><span class="mf-mark">✦</span>Mallet<span class="mf-tld">.ai</span></div>'
      + '<div class="mf-new">+ New</div>'
      + '<nav class="mf-nav">' + nav + '</nav>'
      + '</aside>'
      + '<div class="mf-main"><div class="mf-body">' + body + '</div></div>'
      + '</div>';
  }

  // create customer -> job -> invoice. Each frame: nav-active + the body. The .mf-btn.hot advances.
  var OFFICE = [
    { nav: 'cust', body:
      '<div class="mf-head"><h3 class="mf-h">Customers</h3><button class="mf-btn hot" onclick="mfNext()">+ New customer</button></div>'
      + '<div class="mf-empty">A call just came in — add them.</div>' },
    { nav: 'cust', body:
      '<div class="mf-head"><h3 class="mf-h">Customers</h3><button class="mf-btn hot" onclick="mfNext()">Create job →</button></div>'
      + '<div class="mf-row"><span class="mf-av">JK</span><span class="mf-rm"><b>Janet Kim</b><span class="mf-sub">(925) 555-0142 · Google</span></span><span class="mf-pill blue">New lead</span></div>' },
    { nav: 'jobs', body:
      '<div class="mf-head"><h3 class="mf-h">Jobs</h3><button class="mf-btn hot" onclick="mfNext()">✓ Mark done</button></div>'
      + '<div class="mf-card"><div class="mf-ch"><b>Water heater replacement</b><span class="mf-money">$2,150</span></div><div class="mf-sub">Janet Kim · Thu 9:00 AM · Mike</div><span class="mf-pill amber">Scheduled · priced from your book</span></div>' },
    { nav: 'jobs', body:
      '<div class="mf-head"><h3 class="mf-h">Jobs</h3><button class="mf-btn hot" onclick="mfNext()">Send invoice →</button></div>'
      + '<div class="mf-card"><div class="mf-ch"><b>Water heater replacement</b><span class="mf-pill ok">Done ✓</span></div><div class="mf-sub">Janet Kim · 2.0 hrs logged</div></div>'
      + '<div class="mf-card inv"><div class="mf-ch"><b>Invoice INV-1042</b><span class="mf-money">$2,150</span></div><div class="mf-sub">Drafted automatically the moment the job closed.</div></div>' },
    { nav: 'money', body:
      '<div class="mf-head"><h3 class="mf-h">Money</h3></div>'
      + '<div class="mf-card inv"><div class="mf-ch"><b>Invoice INV-1042</b><span class="mf-pill ok">Sent ✓</span></div><div class="mf-sub">$2,150 · Tap-to-Pay &amp; card-on-file ready</div></div>'
      + '<div class="mf-end">Lead → paid in four taps. <button class="mf-replay" onclick="mfReset()">↺ replay</button></div>' },
  ];

  var step = 0;
  window.mfNext = function () { if (step < OFFICE.length - 1) { step++; render(); } };
  window.mfReset = function () { step = 0; render(); };

  function render() {
    var host = document.getElementById('mfStage');
    if (!host) return;
    var fr = OFFICE[step];
    host.innerHTML = shell(fr.nav, fr.body);
    var hint = document.getElementById('mfHint');
    if (hint) hint.style.visibility = (step === OFFICE.length - 1) ? 'hidden' : 'visible';
    var dots = document.getElementById('mfDots');
    if (dots) dots.innerHTML = OFFICE.map(function (_, i) { return '<span class="' + (i <= step ? 'on' : '') + '"></span>'; }).join('');
  }

  document.addEventListener('DOMContentLoaded', function () { if (document.getElementById('mfStage')) render(); });
})();
