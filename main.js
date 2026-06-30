/* Mallet landing — sticky nav is CSS; this handles motion + embeds + form + lightbox. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('DOMContentLoaded', function () {
    heroStagger();
    scrollReveal();
    wireCalendly();
    loadTallyIfPresent();
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

/* Product-gallery lightbox — global (called from inline onclick in the gallery). */
function lightbox(src, cap) {
  var lb = document.getElementById('lightbox');
  var img = document.getElementById('lbImg');
  var fig = document.getElementById('lbCap');
  if (!lb || !img) return;
  img.src = src;
  img.alt = (cap || '').replace(/<[^>]*>/g, '');
  if (fig) fig.textContent = (cap || '').replace(/&amp;/g, '&').replace(/<[^>]*>/g, '');
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeLightbox(e) {
  if (e && e.target && e.target.id === 'lbImg') return; // clicks on the image itself don't close
  var lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.hidden = true;
  document.body.style.overflow = '';
}
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });
