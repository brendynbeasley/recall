// iOS/iPadOS home-screen web apps can get stuck with a shorter viewport after the keyboard closes or the app
// resumes. Fix: remember the tallest viewport seen at the current width, size the app shell to it, and ask WebKit
// to re-measure once when a real shrink happens. No timers, no polling, no reloads.
(function () {
  var ios = /iP(ad|hone|od)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return;
  var root = document.documentElement; root.classList.add('vp-fix');
  var tallest = {};
  function typing() { var a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); }
  function apply() {
    var w = Math.round(innerWidth), h = innerHeight;
    if (!tallest[w] || h > tallest[w]) tallest[w] = h;
    var full = typing() ? h : tallest[w], gap = Math.max(0, full - h);
    root.style.setProperty('--app-h', full + 'px'); root.style.setProperty('--vp-gap', gap + 'px');
    return gap;
  }
  var healedFor = -1;
  function heal() {
    if (typing() || document.body.classList.contains('intro-playing')) { apply(); return; }
    var gap = apply(); if (gap <= 4 || gap === healedFor) return; // only once per distinct shrink
    healedFor = gap;
    var app = document.getElementById('app'); if (!app) return;
    var sc = document.getElementById('main'); var top = sc ? sc.scrollTop : 0;
    app.style.display = 'none'; void app.offsetHeight; app.style.display = '';
    if (sc) sc.scrollTop = top;
    requestAnimationFrame(function () { if (apply() <= 4) healedFor = -1; });
  }
  var t; function soon(ms) { clearTimeout(t); t = setTimeout(heal, ms); }
  addEventListener('resize', function () { apply(); soon(300); });
  addEventListener('orientationchange', function () { setTimeout(apply, 400); });
  document.addEventListener('focusout', function () { soon(250); }, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) soon(150); });
  apply(); addEventListener('DOMContentLoaded', apply);
})();
