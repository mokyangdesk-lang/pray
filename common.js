/* 365 기도동행 · 공통 기능 (성도 앱·목회자 앱·관리자 앱이 함께 사용) */
(function () {
  'use strict';
  var CFG = window.GD_CONFIG || {};

  /* ── 서버 호출 ── */
  function rpc(fn, args) {
    var url = (CFG.SUPABASE_URL || '').replace(/\/$/, '') + '/rest/v1/rpc/' + fn;
    var key = CFG.SUPABASE_ANON_KEY || '';
    var headers = { 'apikey': key, 'Content-Type': 'application/json' };
    if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key;   // 예전 anon 키(JWT)만 Authorization 에도 넣음 (새 sb_publishable_ 키는 apikey 만)
    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(args || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var d; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
        if (!r.ok) {
          var msg = (d && (d.message || d.hint)) || '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
          var err = new Error(msg === 'AUTH' ? '로그인이 끝났습니다. 다시 로그인해 주세요.' : msg);
          err.auth = msg === 'AUTH';
          throw err;
        }
        return d;
      });
    }, function () { throw new Error('인터넷 연결을 확인해 주세요.'); });
  }

  /* ── 저장소 (사용할 수 없는 환경에서도 앱이 멈추지 않게) ── */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* ── 화면 도우미 ── */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function toast(msg, ms) {
    var t = el('div', { class: 'toast', role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, ms || 2600);
  }
  function modal(title, body, actions) {
    var close = function () { m.remove(); document.body.classList.remove('locked'); };
    var box = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'sheet-head' }, [el('h3', { text: title }), el('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', text: '✕', onclick: function () { close(); } })]),
      el('div', { class: 'sheet-body' }, [body]),
      actions && actions.length ? el('div', { class: 'sheet-foot' }, actions) : null
    ]);
    var m = el('div', { class: 'overlay', onclick: function (e) { if (e.target === m) close(); } }, [box]);
    document.body.appendChild(m); document.body.classList.add('locked');
    m.close = close;
    return m;
  }
  function fmtDate(s, withTime) {
    if (!s) return '';
    var d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
    if (isNaN(d)) return s;
    var t = (d.getMonth() + 1) + '/' + d.getDate();
    if (withTime) t += ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return t;
  }
  function ago(s) {
    var m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
    if (m < 1) return '방금'; if (m < 60) return m + '분 전';
    var h = Math.floor(m / 60); if (h < 24) return h + '시간 전';
    var d = Math.floor(h / 24); if (d < 8) return d + '일 전';
    return fmtDate(s);
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + (label || ''); }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }
  function copy(text) {
    var done = function () { toast('복사했습니다'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    fallback();
    function fallback() {
      var ta = el('textarea', { class: 'copy-ta' }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('길게 눌러 복사해 주세요'); }
      ta.remove();
    }
  }
  var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function smsLink(phone, body) {
    var n = String(phone || '').replace(/[^0-9+]/g, '');
    return 'sms:' + n + (isIOS ? '&' : '?') + 'body=' + encodeURIComponent(body);
  }

  /* ── 홈 화면에 추가 ── */
  var Install = {
    deferred: null,
    standalone: function () { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
    inApp: function () { return /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent); },
    init: function (btn) {
      var self = this;
      if (!btn) return;
      if (this.standalone()) { btn.hidden = true; return; }
      window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); self.deferred = e; btn.hidden = false; });
      window.addEventListener('appinstalled', function () { btn.hidden = true; toast('홈 화면에 추가되었습니다'); });
      btn.hidden = false;
      btn.addEventListener('click', function () { self.prompt(); });
    },
    prompt: function () {
      var self = this;
      if (this.deferred) { this.deferred.prompt(); this.deferred.userChoice.then(function () { self.deferred = null; }); return; }
      var steps;
      if (this.inApp()) {
        steps = isIOS
          ? ['오른쪽 아래 <b>⋯</b> 또는 <b>공유</b> 버튼을 누릅니다', '<b>Safari로 열기</b>(다른 브라우저로 열기)를 누릅니다', 'Safari에서 다시 이 화면의 <b>홈 화면에 추가</b>를 누릅니다']
          : ['오른쪽 위(또는 아래) <b>⋮</b> 버튼을 누릅니다', '<b>다른 브라우저로 열기</b>를 누릅니다 (Chrome 또는 삼성 인터넷)', '열린 화면에서 다시 <b>홈 화면에 추가</b>를 누릅니다'];
      } else if (isIOS) {
        steps = ['화면 아래(또는 위)의 <b>공유 버튼</b> <span class="kbd">⬆︎</span>을 누릅니다', '목록을 내려 <b>홈 화면에 추가</b>를 누릅니다', '오른쪽 위 <b>추가</b>를 누르면 홈 화면에 앱이 생깁니다'];
      } else {
        steps = ['브라우저 오른쪽 위 <b>⋮</b> 버튼을 누릅니다', '<b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누릅니다', '<b>추가</b>를 누르면 홈 화면에 앱이 생깁니다'];
      }
      var ol = el('ol', { class: 'guide-steps' });
      steps.forEach(function (s) { ol.appendChild(el('li', { html: s })); });
      var note = this.inApp() ? el('p', { class: 'muted small', text: '카카오톡 같은 앱 안에서 열면 홈 화면에 추가할 수 없어서, 먼저 기본 브라우저로 열어야 합니다.' }) : null;
      modal('홈 화면에 추가하기', el('div', {}, [ol, note]), [el('button', { class: 'btn btn-primary', type: 'button', text: '확인', onclick: function () { this.closest('.overlay').close(); } })]);
    }
  };

  /* ── 명조 글꼴: 다 받은 뒤 보여 주고, 3초 안에 못 받으면 기본 글꼴로 ── */
  var Font = (function () {
    var de = document.documentElement, FONTS = ['400 20px "Gowun Batang"'];
    function ready(texts) {
      var txt = (texts || []).join('');
      if (de.classList.contains('serif-fallback')) return Promise.resolve(false);
      if (!txt || !document.fonts || !document.fonts.load) return Promise.resolve(true);
      de.classList.add('serif-wait');
      var done = Promise.all(FONTS.map(function (f) { return document.fonts.load(f, txt); }))
        .then(function () { return FONTS.every(function (f) { return document.fonts.check(f, txt); }); })
        .catch(function () { return false; });
      var late = new Promise(function (r) { setTimeout(function () { r(false); }, 3000); });
      return Promise.race([done, late]).then(function (ok) {
        if (!ok) de.classList.add('serif-fallback');
        de.classList.remove('serif-wait');
        return ok;
      });
    }
    return { ready: ready, usable: function () { return !de.classList.contains('serif-fallback'); } };
  })();

  /* ── 말씀 카드 ── */
  var Card = (function () {
    var SERIF_WEB = '"Gowun Batang", "Noto Serif KR", serif', SERIF_SYS = '"AppleMyungjo", "Nanum Myeongjo", "Noto Serif KR", "Noto Serif CJK KR", serif';
    var SANS = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", system-ui, sans-serif';
    function render(target, card, meta) {
      target.innerHTML = '';
      target.appendChild(el('div', { class: 'c-title', text: card.title }));
      target.appendChild(el('div', { class: 'c-tag', text: card.tag }));
      target.appendChild(el('div', { class: 'c-verse', text: card.verse }));
      target.appendChild(el('div', { class: 'c-ref', text: card.ref + ' · ' + (meta.translation || '개역개정') }));
      target.appendChild(el('div', { class: 'c-sep' }));
      target.appendChild(el('div', { class: 'c-label', text: '함께 드리는 기도' }));
      target.appendChild(el('div', { class: 'c-prayer', text: card.prayer }));
      target.appendChild(el('div', { class: 'c-foot', text: (card.date || '') + ' · ' + (meta.subtitle || meta.church || '') }));
      Font.ready([card.verse]);
    }
    function wrap(ctx, text, maxW) {
      var lines = [], words = String(text).split(/\s+/), line = '';
      words.forEach(function (w) {
        var test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width <= maxW) { line = test; return; }
        if (line) lines.push(line);
        if (ctx.measureText(w).width <= maxW) { line = w; return; }
        line = '';
        for (var i = 0; i < w.length; i++) { var t = line + w[i]; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w[i]; } else line = t; }
      });
      if (line) lines.push(line);
      return lines;
    }
    function draw(card, meta) {
      return Font.ready([card.verse]).then(function (ok) {
        var SERIF = ok && Font.usable() ? SERIF_WEB : SERIF_SYS;
        var W = 1080, PAD = 110, inner = W - PAD * 2, primary = '#1f4d3a', gold = '#a8792a';
        var c = document.createElement('canvas'), ctx = c.getContext('2d'), blocks = [];
        function add(text, font, color, lh, align, gap, maxW) { ctx.font = font; blocks.push({ lines: wrap(ctx, text, maxW || inner), font: font, color: color, lh: lh, align: align, gap: gap }); }
        add(meta.title || '365 기도동행', '700 30px ' + SANS, primary, 44, 'center', 34);
        add(card.title, '800 46px ' + SANS, '#22201c', 64, 'center', 18);
        add(card.tag, '700 30px ' + SANS, gold, 44, 'center', 70);
        add(card.verse, '52px ' + SERIF, '#22201c', 92, 'center', 30, inner - 20);
        add('— ' + card.ref + ' · ' + (meta.translation || '개역개정') + ' —', '700 32px ' + SANS, gold, 46, 'center', 70);
        add('함께 드리는 기도', '800 34px ' + SANS, primary, 50, 'left', 16);
        add(card.prayer, '35px ' + SANS, '#3b3832', 62, 'left', 0);
        var top = 170, body = 0; blocks.forEach(function (b) { body += b.lines.length * b.lh + b.gap; });
        var H = Math.max(1350, top + body + 210);
        c.width = W; c.height = H;
        ctx.fillStyle = '#fbf8f1'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(168,121,42,.55)'; ctx.lineWidth = 3; ctx.strokeRect(44, 44, W - 88, H - 88);
        ctx.strokeStyle = 'rgba(168,121,42,.25)'; ctx.lineWidth = 1.5; ctx.strokeRect(60, 60, W - 120, H - 120);
        ctx.fillStyle = primary; ctx.fillRect(W / 2 - 2, 96, 4, 34); ctx.fillRect(W / 2 - 13, 106, 26, 4);
        var y = top;
        blocks.forEach(function (b, bi) {
          ctx.font = b.font; ctx.fillStyle = b.color; ctx.textAlign = b.align;
          var x = b.align === 'center' ? W / 2 : PAD;
          b.lines.forEach(function (ln) { y += b.lh; ctx.fillText(ln, x, y - b.lh * 0.28); });
          y += b.gap;
          if (bi === 4) { ctx.strokeStyle = '#e6ddcc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(PAD + 40, y - 38); ctx.lineTo(W - PAD - 40, y - 38); ctx.stroke(); }
        });
        ctx.textAlign = 'center'; ctx.fillStyle = '#8a8378'; ctx.font = '26px ' + SANS;
        ctx.fillText((card.date || '') + '  ·  당신을 위해 기도합니다', W / 2, H - 112);
        ctx.fillStyle = primary; ctx.font = '700 24px ' + SANS;
        ctx.fillText(meta.subtitle || meta.church || '', W / 2, H - 76);
        return c.toDataURL('image/jpeg', 0.92);
      });
    }
    function saveImage(card, meta) {
      var wrapEl = el('div', { class: 'img-wrap' }, [el('p', { class: 'muted', text: '카드를 만드는 중입니다…' })]);
      var m = modal('카드 이미지 저장', wrapEl);
      draw(card, meta).then(function (url) {
        var name = '말씀카드_' + String(card.ref || '').replace(/[\s:]/g, '') + '.jpg';
        wrapEl.innerHTML = '';
        wrapEl.appendChild(el('img', { src: url, alt: '말씀 카드 이미지', class: 'card-img' }));
        wrapEl.appendChild(el('p', { class: 'center small', html: '<b>이미지를 길게 눌러 사진에 저장</b>하세요<br><span class="muted">PC는 이미지에서 오른쪽 클릭 → 이미지 저장</span>' }));
        var foot = el('div', { class: 'grid-2' }, [
          el('a', { class: 'btn btn-primary', href: url, download: name, text: '파일로 저장' }),
          el('button', { class: 'btn btn-line', type: 'button', text: '공유하기', onclick: function () {
            try {
              var b = atob(url.split(',')[1]), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
              var f = new File([a], name, { type: 'image/jpeg' });
              if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: card.title }).catch(function () {}); return; }
            } catch (e) {}
            shareText(card, meta);
          } })
        ]);
        wrapEl.appendChild(foot);
      }).catch(function () { wrapEl.innerHTML = '<p>이미지를 만들지 못했습니다. 화면을 캡처해 주세요.</p>'; });
      return m;
    }
    function shareText(card, meta) {
      var text = '🌿 ' + card.title + '\n\n📖 ' + card.verse + '\n— ' + card.ref + ' (' + (meta.translation || '개역개정') + ')\n\n🙏 함께 드리는 기도\n' + card.prayer + '\n\n' + (meta.subtitle || '') + ' · 365 기도동행';
      if (navigator.share) { navigator.share({ title: card.title, text: text }).catch(function (e) { if (e && e.name !== 'AbortError') copy(text); }); return; }
      copy(text);
    }
    return { render: render, draw: draw, saveImage: saveImage, shareText: shareText };
  })();

  /* ── 서비스 워커 (홈 화면 앱) ── */
  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  /* ── 버튼 글자 맞춤: 선택 버튼 글자가 두 줄로 꺾이지 않게, 넘치면 글자 크기를 조금씩 줄입니다 ── */
  function fit(root) {
    var groups = [];
    $$('.choice, .tab', root || document).forEach(function (b) {
      if (!b.clientWidth) return;                       // 화면에 안 보이는 버튼은 보일 때 다시 맞춤
      b.style.fontSize = '';
      var size = parseFloat(getComputedStyle(b).fontSize), start = size, min = 11;
      while (b.scrollWidth > b.clientWidth + 1 && size > min) { size -= 0.5; b.style.fontSize = size + 'px'; }
      if (size < start) { var g = b.parentNode; if (groups.indexOf(g) < 0) groups.push(g); g._fit = Math.min(g._fit || 99, size); }
    });
    // 한 줄에 있는 버튼끼리는 글자 크기를 똑같이 맞춤
    groups.forEach(function (g) {
      Array.prototype.forEach.call(g.children, function (c) { if (c.classList.contains('choice') || c.classList.contains('tab')) c.style.fontSize = g._fit + 'px'; });
      g._fit = 0;
    });
  }
  var fitQueued = false;
  function fitSoon() { if (fitQueued) return; fitQueued = true; requestAnimationFrame(function () { fitQueued = false; fit(); }); }
  if (window.MutationObserver) {
    var mo = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var t = ms[i].target; if (!(t.classList && (t.classList.contains('choice') || t.classList.contains('tab')))) { fitSoon(); return; } }
    });
    var startObs = function () { mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] }); fitSoon(); };
    if (document.body) startObs(); else document.addEventListener('DOMContentLoaded', startObs);
  }
  window.addEventListener('resize', fitSoon);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSoon);

  function configured() { return CFG.SUPABASE_URL && CFG.SUPABASE_URL.indexOf('여기에') < 0; }

  window.GD = { rpc: rpc, store: store, $: $, $$: $$, el: el, toast: toast, modal: modal, fmtDate: fmtDate, ago: ago, busy: busy, copy: copy,
    smsLink: smsLink, isIOS: isIOS, Install: Install, Font: Font, Card: Card, registerSW: registerSW, configured: configured, fit: fit };
})();
