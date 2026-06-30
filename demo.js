/* Mallet landing — interactive click-through demos (hand-built mocks, on-brand, no backend). */
(function () {
  'use strict';

  // Each flow is a linear click-through. The highlighted ".m-btn.hot" inside a frame
  // calls demoNext() to advance. Last frame shows replay + CTA.
  var FLOWS = {
    office: {
      device: 'desk',
      frames: [
        { cap: 'A new lead just called. Add them — one tap.',
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> Customers</div>'
            + '<div class="m-empty">No customers yet</div>'
            + '<button class="m-btn hot" onclick="demoNext()">+ New customer</button></div>' },
        { cap: "Customer's in. Now turn it into a job.",
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> Customers</div>'
            + '<div class="m-row"><div><b>Janet Kim</b><span class="m-sub">(925) 555-0142 · Google</span></div><span class="m-tag new">New</span></div>'
            + '<button class="m-btn hot" onclick="demoNext()">Create job →</button></div>' },
        { cap: 'Priced from your own pricebook, on the board. When the tech finishes —',
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> Jobs</div>'
            + '<div class="m-card"><div class="m-card-h"><b>Water heater replacement</b><span class="m-money">$2,150</span></div>'
            + '<span class="m-sub">Janet Kim · Thu 9:00 AM · Mike</span><span class="m-tag sched">Scheduled</span></div>'
            + '<button class="m-btn hot" onclick="demoNext()">✓ Mark done</button></div>' },
        { cap: '— the invoice writes itself.',
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> Jobs</div>'
            + '<div class="m-card done"><div class="m-card-h"><b>Water heater replacement</b><span class="m-tag ok">Done ✓</span></div><span class="m-sub">Janet Kim · 2.0 hrs</span></div>'
            + '<div class="m-card invoice"><div class="m-card-h"><b>Invoice INV-1042</b><span class="m-money">$2,150</span></div><span class="m-sub">Drafted automatically from the job</span></div>'
            + '<button class="m-btn hot" onclick="demoNext()">Send invoice →</button></div>' },
        { cap: 'Lead → paid in four taps. That’s the simple part.',
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> Money</div>'
            + '<div class="m-card invoice"><div class="m-card-h"><b>Invoice INV-1042</b><span class="m-tag ok">Sent ✓</span></div><span class="m-sub">$2,150 · Tap-to-Pay &amp; card-on-file ready</span></div>'
            + '<p class="m-foot-note">Need the depth? Checklists, pricebooks, financing, timesheets &amp; payroll are all in here too — they just stay out of your way until you want them.</p></div>' },
      ],
    },

    frontdesk: {
      device: 'desk',
      frames: [
        { cap: "You're under a sink. The phone rings — a number you don't know.",
          html: '<div class="m-app m-call"><div class="m-ring">●</div><b>Incoming call</b><span class="m-sub">Unknown · (510) 555-0199</span>'
            + '<button class="m-btn hot" onclick="demoNext()">▶ Let Mallet answer</button></div>' },
        { cap: 'Mallet picks up and talks like your best front-desk hire.',
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> AI Front Desk · live</div>'
            + '<div class="m-bubble in">Thanks for calling Rivera Plumbing! What can I help with?</div>'
            + '<div class="m-bubble out">My water heater’s leaking everywhere.</div>'
            + '<button class="m-btn hot" onclick="demoNext()">▶ Keep going</button></div>' },
        { cap: 'It understands the job and offers real openings from your calendar.',
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> AI Front Desk · live</div>'
            + '<div class="m-bubble in">Sounds like a water-heater repair. I can get a tech out <b>Thursday 9 AM</b> or <b>Friday 1 PM</b> — which works?</div>'
            + '<div class="m-bubble out">Thursday, please.</div>'
            + '<button class="m-btn hot" onclick="demoNext()">▶ Book it</button></div>' },
        { cap: 'Books it, texts the customer a confirmation, writes it to your calendar.',
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> AI Front Desk</div>'
            + '<div class="m-card"><div class="m-card-h"><b>✓ Booked</b><span class="m-tag sched">Thu 9:00 AM</span></div><span class="m-sub">Water heater · Rob Alvarez assigned</span></div>'
            + '<div class="m-note">📲 Confirmation text sent to (510) 555-0199</div>'
            + '<button class="m-btn hot" onclick="demoNext()">▶ See what you got</button></div>' },
        { cap: "You never touched your phone — and you didn't lose the job.",
          html: '<div class="m-app"><div class="m-top"><span class="m-mark">✦</span> Pipeline</div>'
            + '<div class="m-row"><div><b>Rob Alvarez</b><span class="m-sub">Water heater · booked by AI · Thu 9a</span></div><span class="m-tag new">New</span></div>'
            + '<p class="m-foot-note">Every missed call caught, qualified, and booked — day or night. 27% of calls to shops go unanswered. Not yours.</p></div>' },
      ],
    },

    field: {
      device: 'phone',
      frames: [
        { cap: 'Your tech is on a job and hits something they’re unsure about.',
          html: '<div class="m-pscreen"><div class="m-pjob"><b>Hernandez</b> · Two toilets<span class="m-tag sched">On site</span></div>'
            + '<div class="m-ask-hint">Stuck? Snap a photo and ask Mallet.</div>'
            + '<button class="m-btn hot wide" onclick="demoNext()">📷 What should I do here?</button></div>' },
        { cap: 'They snap a photo and ask — like texting a buddy who knows everything.',
          html: '<div class="m-pscreen"><div class="m-pjob"><b>Hernandez</b> · Two toilets</div>'
            + '<div class="m-bubble out"><span class="m-photo">📷</span> what should I do here?</div>'
            + '<button class="m-btn hot wide" onclick="demoNext()">▶ Ask Mallet</button></div>' },
        { cap: 'Mallet reads the photo and answers from the job + your pricebook.',
          html: '<div class="m-pscreen"><div class="m-pjob"><b>Hernandez</b> · Two toilets</div>'
            + '<div class="m-bubble out"><span class="m-photo">📷</span> what should I do here?</div>'
            + '<div class="m-bubble in">From your photo — that’s a corroded angle stop. Shut the main, swap it for a ¼-turn ½″ stop. Found work like this is billable.</div>'
            + '<button class="m-btn hot wide" onclick="demoNext()">✦ Add as found work</button></div>' },
        { cap: 'One tap turns the find into money the office can bill.',
          html: '<div class="m-pscreen"><div class="m-pjob"><b>Hernandez</b> · Two toilets</div>'
            + '<div class="m-bubble in">From your photo — that’s a corroded angle stop…</div>'
            + '<div class="m-note ok">✓ Added: Replace angle stop · $140 — sent to the office to bill</div>'
            + '<p class="m-foot-note">No app to learn. Your crew already knows how to text.</p></div>' },
      ],
    },
  };

  var cur = 'office', step = 0;

  window.demoTab = function (f) { if (!FLOWS[f]) return; cur = f; step = 0; renderDemo(); };
  window.demoNext = function () { var fr = FLOWS[cur].frames; if (step < fr.length - 1) { step++; renderDemo(); } };
  window.demoReset = function () { step = 0; renderDemo(); };

  function renderDemo() {
    var host = document.getElementById('demoStage');
    if (!host) return;
    var tabs = document.querySelectorAll('.demo-tab');
    Array.prototype.forEach.call(tabs, function (t) { t.classList.toggle('on', t.getAttribute('data-flow') === cur); });
    var flow = FLOWS[cur];
    var fr = flow.frames[step];
    var last = step === flow.frames.length - 1;
    var dots = flow.frames.map(function (_, i) { return '<span class="' + (i <= step ? 'on' : '') + '"></span>'; }).join('');
    host.innerHTML =
      '<p class="demo-cap">' + fr.cap + '</p>' +
      '<div class="demo-screen ' + (flow.device === 'phone' ? 'is-phone' : '') + '">' + fr.html + '</div>' +
      '<div class="demo-foot">' +
        '<div class="demo-dots">' + dots + '</div>' +
        (last
          ? '<div class="demo-end"><button class="demo-replay" onclick="demoReset()">↺ Start over</button><a class="btn-primary" href="#waitlist">I want this — claim my spot&nbsp;&rarr;</a></div>'
          : '<span class="demo-hint">↑ tap the highlighted button</span>') +
      '</div>';
  }

  document.addEventListener('DOMContentLoaded', function () { if (document.getElementById('demoStage')) renderDemo(); });
})();
