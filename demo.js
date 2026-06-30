/* Mallet landing — "See it work" tabs swap the embedded real-product iframe to each view. */
(function () {
  'use strict';
  window.demoTab = function (v, btn) {
    var f = document.getElementById('demoFrame');
    var win = document.getElementById('demoWindow');
    if (!f) return;
    f.src = 'demo-app.html?v=' + encodeURIComponent(v);
    if (win) win.classList.toggle('phone', v === 'field'); // field view shows the mobile app
    var tabs = document.querySelectorAll('.demo-tab');
    Array.prototype.forEach.call(tabs, function (t) {
      t.classList.toggle('on', t === btn || t.getAttribute('data-v') === v);
    });
  };
})();
