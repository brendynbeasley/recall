// iOS/iPadOS home-screen web apps sometimes get stuck with a viewport that is shorter than the screen
// (a black band at the bottom) until the app is force-quit. It happens after the keyboard closes, when the app
// resumes from the background, or at launch. WebKit bugs: 301994, rdar 158055568.
// Fix, in three layers:
//   1. Remember the tallest viewport seen for the current width (and, in full-screen mode, the screen size).
//   2. Size the app shell to that height, so even a stuck viewport is painted edge to edge.
//   3. Force WebKit to re-measure (display toggle on a full-height element) whenever the viewport is short.
(function () {
  var ios = /iP(ad|hone|od)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return;
  var standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var root = document.documentElement; root.classList.add('vp-fix');
  var tallest = {};
  function expected() {
    var w = window.innerWidth, h = window.innerHeight, k = Math.round(w);
    if (!tallest[k] || h > tallest[k]) tallest[k] = h;
    // Only correct a full-screen app (window spans the screen width). A resized iPadOS window is left alone.
    if (!standalone || !screen || !screen.width || !screen.height) return h;
    var lw = Math.max(screen.width, screen.height), lh = Math.min(screen.width, screen.height);
    if (Math.abs(w - lw) <= 2) return Math.max(tallest[k], lh);      // landscape, full screen
    if (Math.abs(w - lh) <= 2) return Math.max(tallest[k], lw);      // portrait, full screen
    return h;
  }
  function apply() {
    var full = expected(), gap = Math.max(0, full - window.innerHeight);
    if (typing()) gap = 0; // the keyboard legitimately shrinks the viewport
    root.style.setProperty('--app-h', (typing() ? window.innerHeight : full) + 'px');
    root.style.setProperty('--vp-gap', gap + 'px');
    return gap;
  }
  function typing() { var a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); }
  function heal() {
    if (typing()) { apply(); return; }
    if (apply() <= 4) return;
    var app = document.getElementById('app'); if (!app) return;
    var sc = document.getElementById('main'); var top = sc ? sc.scrollTop : 0;
    app.style.display = 'none'; void app.offsetHeight; app.style.display = '';
    if (sc) sc.scrollTop = top;
    window.scrollTo(0, 0);
    requestAnimationFrame(function () { requestAnimationFrame(apply); });
  }
  var timer; function soon(ms) { clearTimeout(timer); timer = setTimeout(heal, ms); }
  addEventListener('resize', function () { apply(); soon(250); });
  if (window.visualViewport) visualViewport.addEventListener('resize', function () { apply(); soon(250); });
  addEventListener('orientationchange', function () { setTimeout(function () { apply(); heal(); }, 450); });
  document.addEventListener('focusout', function () { soon(180); setTimeout(heal, 700); }, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { soon(80); setTimeout(heal, 700); } });
  addEventListener('pageshow', function () { soon(80); });
  addEventListener('focus', function () { soon(120); });
  apply();
  addEventListener('DOMContentLoaded', function () { apply(); setTimeout(heal, 300); setTimeout(heal, 1500); });
  // Safety net: check every few seconds while visible (cheap; does nothing unless the viewport is short).
  setInterval(function () { if (!document.hidden) heal(); }, 4000);
})();
