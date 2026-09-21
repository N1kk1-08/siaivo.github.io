(function () {
  'use strict';

  var STYLE_ID = 'mylampa-splash-css';
  var BRAND_LOGO_SRC = './img/mylampa-mark-v2.svg';
  var CSS = "\n@font-face {\n  font-family: 'MyLampaLogo';\n  font-style: normal;\n  font-weight: 400;\n  src: url('./fonts/Audiowide-Regular.ttf') format('truetype');\n  font-display: block;\n}\n.welcome {\n  background: #020408 url('./img/mylampa-loader-background-desktop-v2.png') no-repeat 50% 50% !important;\n  background-size: cover !important;\n}\n.netflix-intro { padding-bottom: 0; background: transparent; }\n.netflix-intro__vig { background: radial-gradient(ellipse at center, rgba(2,7,15,.10) 0%, rgba(1,3,8,.56) 65%, rgba(0,0,0,.88) 100%); }\n.netflix-intro__stars { position:absolute; z-index:1; inset:0; overflow:hidden; pointer-events:none; }\n.netflix-intro__star {\n  position:absolute; top:-12vh; width:var(--size); height:var(--size); border-radius:50%;\n  background:#e8f6ff; box-shadow:0 0 7px 2px rgba(111,194,255,.65); opacity:0;\n  animation:mylampa-fall var(--duration) linear var(--delay) infinite;\n}\n@keyframes mylampa-fall {\n  0% { transform:translate3d(0,0,0) scale(.45); opacity:0; }\n  10%,82% { opacity:var(--opacity); }\n  100% { transform:translate3d(var(--drift),125vh,0) scale(1.2); opacity:0; }\n}\n.netflix-intro__tw { z-index:2; width:100%; padding:0 7vw; text-align:center; }\n.netflix-intro__mylampa {\n  display:inline-block; max-width:100%; overflow:visible; white-space:nowrap;\n  font-family:'MyLampaLogo','Arial Narrow',sans-serif; font-size:7.2vw; line-height:.95; letter-spacing:-.045em;\n  background:linear-gradient(90deg,#219cff 0%,#66d8ff 24%,#f6dc55 42%,#ff6b71 52%,#b85cff 64%,#40b8ff 82%,#219cff 100%);\n  background-size:300% 100%; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; color:transparent;\n  filter:drop-shadow(0 0 16px rgba(52,162,255,.36));\n  animation:mylampa-pulse 3.8s ease-in-out infinite, mylampa-shimmer 4.8s linear infinite;\n}\n.netflix-intro__mylampa-y { position:relative; top:-.075em; }\n@keyframes mylampa-pulse {\n  0%,100% { transform:scale(1); filter:drop-shadow(0 0 16px rgba(52,162,255,.30)); }\n  50% { transform:scale(1.045); filter:drop-shadow(0 0 32px rgba(247,207,62,.62)); }\n}\n@keyframes mylampa-shimmer { from { background-position:-180% center; } to { background-position:180% center; } }\n@media (min-width:1000px) { .netflix-intro__mylampa { font-size:92px; } }\n@media (max-width:600px) { .netflix-intro__mylampa { font-size:48px; } }\n@media (prefers-reduced-motion:reduce) { .netflix-intro__star,.netflix-intro__mylampa { animation:none; } }\n";
  var MOBILE_CSS = "\n@media (max-aspect-ratio:3/4) {\n  .welcome {\n    background-image:url('./img/mylampa-loader-background-mobile-v1.png') !important;\n    background-position:50% 50% !important;\n  }\n}\n";

  var HTML = '\n<div class="netflix-intro">\n' +
    '  <div class="netflix-intro__vig"></div>\n' +
    '  <div class="netflix-intro__stars" aria-hidden="true"></div>\n' +
    '  <div class="netflix-intro__tw">\n' +
    '    <div class="netflix-intro__mylampa">M<span class="netflix-intro__mylampa-y">y</span>Lampa</div>\n' +
    '  </div>\n</div>';

  function createStars(root) {
    var stars = root.querySelector('.netflix-intro__stars');
    if (!stars) return;

    for (var i = 0; i < 54; i++) {
      var star = document.createElement('i');
      star.className = 'netflix-intro__star';
      star.style.left = (Math.random() * 100).toFixed(2) + '%';
      star.style.setProperty('--size', (Math.random() * 2.4 + .7).toFixed(1) + 'px');
      star.style.setProperty('--duration', (Math.random() * 7 + 7).toFixed(1) + 's');
      star.style.setProperty('--delay', (-Math.random() * 14).toFixed(1) + 's');
      star.style.setProperty('--drift', ((Math.random() - .5) * 16).toFixed(1) + 'vw');
      star.style.setProperty('--opacity', (Math.random() * .47 + .20).toFixed(2));
      stars.appendChild(star);
    }
  }

  function inject() {
    var welcome = document.querySelector('.welcome');
    if (!welcome || !document.body.contains(welcome)) return;

    welcome.innerHTML = HTML;
    createStars(welcome);
  }

  function applyBrandMark() {
    var selector = '.head__logo-icon img, .lang__logo img';
    var marks = document.querySelectorAll(selector);
    var i;

    for (i = 0; i < marks.length; i++) marks[i].src = BRAND_LOGO_SRC;

    if (!window.Lampa || !Lampa.Template || typeof Lampa.Template.string !== 'function') return;

    ['head', 'lang_choice'].forEach(function (templateName) {
      var template = Lampa.Template.string(templateName);
      if (!template || template.indexOf('logo-icon') === -1 && template.indexOf('data:image/svg+xml') === -1) return;

      Lampa.Template.add(templateName, template.replace(/<img src="[^"]+"\s*\/>/, '<img src="' + BRAND_LOGO_SRC + '" />'));
    });
  }

  function boot() {
    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS + MOBILE_CSS;
      document.head.appendChild(style);
    }

    inject();
    applyBrandMark();
    setTimeout(applyBrandMark, 300);
    setTimeout(applyBrandMark, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
