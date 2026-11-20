/* 365 기도동행 · 성도 앱 */
(function () {
  'use strict';
  var $ = GD.$, $$ = GD.$$, el = GD.el;
  var params = new URLSearchParams(location.search);
  var CFGD = null;           // 서버 설정
  var state = { cats: [], care: [], time: '아무 때나', scope: '', forWhom: 'self', minor: false, linkParish: null };
  // 서버를 아직 3_options.sql 로 올리지 않았을 때 쓰는 기본 선택지 (지금 화면과 같음)
  var DEFAULT_OPTS = {
    care: [{ code: 'pray', label: '기도만 부탁해요', icon: '🙏', base: 'pray' }, { code: 'call', label: '전화로 기도해 주세요', icon: '📞', base: 'call' },
      { code: 'meet', label: '만나서 기도하고 싶어요', icon: '☕', base: 'meet' }, { code: 'visit', label: '심방(가정·병원)을 원해요', icon: '🏠', base: 'visit' },
      { code: 'team', label: '중보기도팀도 함께해 주세요', icon: '🤝', base: 'team' }],
    scope: [{ code: 'staff', label: '담당 목회자만', base: 'staff' }, { code: 'team', label: '중보기도팀과 함께', base: 'team' }, { code: 'anon', label: '이름 없이 내용만', base: 'anon' }]
  };
  var OPTS = DEFAULT_OPTS, CARE_BASE = {};
  var RKEY = 'gd_receipts';

  GD.registerSW();
  GD.Install.init($('#installBtn'));

  function showView(id) {
    ['formView', 'resultView', 'myView'].forEach(function (v) { $('#' + v).hidden = v !== id; });
    window.scrollTo(0, 0);
  }

  function single(box, key, after) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.choice'); if (!b) return;
      $$('.choice', box).forEach(function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
      state[key] = b.dataset.v; if (after) after();
    });
  }

  function parishByCode(code) { return (CFGD.parishes || []).filter(function (p) { return p.code === code; })[0]; }

  function syncParish() {
    var code = state.linkParish || $('#parish').value;
    var p = parishByCode(code);
    var youth = !!(p && p.youth);
    $('#minorField').hidden = !youth;
    if (!youth) { state.minor = false; $$('#minor .choice').forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.v === 'no' ? 'true' : 'false'); }); }
    syncMinor();
  }
  function syncMinor() {
    $('#phoneField').hidden = state.minor;
    $('#minorHint').hidden = !state.minor;
    $('#nameLabel').innerHTML = (state.minor ? '이름 또는 별명' : '성함') + ' <span class="req">*</span>';
  }
  function syncCare() {
    var listOnly = state.cats.length > 0 && state.cats.every(function (n) {
      var c = (CFGD.categories || []).filter(function (x) { return x.name === n; })[0]; return c && c.mode === 'list';
    });
    $('#carePanel').hidden = listOnly;
    var needTime = state.care.some(function (k) { var b = CARE_BASE[k]; return b === 'call' || b === 'meet' || b === 'visit'; });
    $('#timeField').hidden = !needTime;
  }

  function buildForm() {
    $('#appTitle').textContent = CFGD.title || '365 기도동행';
    $('#brandTop').textContent = CFGD.title || '365 기도동행';
    $('#appSub').textContent = CFGD.subtitle || '';
    document.title = (CFGD.title || '365 기도동행') + (CFGD.subtitle ? ' · ' + CFGD.subtitle : '');
    $('#consentText').textContent = CFGD.consent || '';
    $('#consentSensitiveText').textContent = CFGD.consent_sensitive || '';
    $('#foot').innerHTML = '';
    $('#foot').appendChild(el('a', { href: 'https://mokyangdesk.com', target: '_blank', rel: 'noopener', text: (CFGD.subtitle || '') + ' · 만든 곳 ' + (CFGD.maker || 'AI목양지원센터') }));

    // 소속
    var sel = $('#parish'); sel.innerHTML = '';
    sel.appendChild(el('option', { value: '', text: '선택해 주세요' }));
    (CFGD.parishes || []).forEach(function (p) { sel.appendChild(el('option', { value: p.code, text: p.name })); });
    [['@새가족', '처음 오셨어요 (새가족)'], ['@타교회', '다른 교회 성도예요'], ['@모름', '잘 모르겠어요']].forEach(function (o) { sel.appendChild(el('option', { value: o[0], text: o[1] })); });
    sel.addEventListener('change', syncParish);
    var lp = params.get('p') && parishByCode(params.get('p'));
    if (lp) {
      state.linkParish = lp.code;
      $('#parishFixed').hidden = false; $('#parishPick').hidden = true;
      $('#parishChip').textContent = lp.name + ' 기도제목으로 전달됩니다';
    }
    $('#parishChange').addEventListener('click', function () {
      state.linkParish = null; $('#parishFixed').hidden = true; $('#parishPick').hidden = false; sel.value = lp ? lp.code : ''; syncParish();
    });
    syncParish();

    // 돌봄 · 공유 범위 (관리자가 정한 선택지)
    OPTS = (CFGD.options && CFGD.options.care) ? CFGD.options : DEFAULT_OPTS;
    CARE_BASE = {}; OPTS.care.forEach(function (o) { CARE_BASE[o.code] = o.base; });
    var careBox = $('#care'); careBox.innerHTML = '';
    OPTS.care.forEach(function (o) {
      careBox.appendChild(el('button', { type: 'button', class: 'choice', 'data-v': o.code, 'aria-pressed': 'false' }, [o.icon ? el('span', { class: 'ic', text: o.icon }) : null, o.label]));
    });
    careBox.hidden = !OPTS.care.length; $('#careHint').hidden = !OPTS.care.length;
    var scopeBox = $('#scope'); scopeBox.innerHTML = '';
    OPTS.scope.forEach(function (o) {
      scopeBox.appendChild(el('button', { type: 'button', class: 'choice', 'data-v': o.code, 'aria-pressed': 'false' }, [o.icon ? el('span', { class: 'ic', text: o.icon }) : null, o.label]));
    });
    $('#scopeField').hidden = OPTS.scope.length < 2;   // 하나뿐이면 고를 필요가 없으니 숨김
    resetChoices();

    // 분야 (묶음별, 같은 크기 버튼)
    var box = $('#cats'); box.innerHTML = '';
    var groups = { '삶': '삶의 자리', '믿음': '믿음의 자리', '함께': '함께 드리는 기도 · 감사' };
    Object.keys(groups).forEach(function (g) {
      var items = (CFGD.categories || []).filter(function (c) { return c.grp === g; });
      if (!items.length) return;
      box.appendChild(el('div', { class: 'grp-label', text: groups[g] }));
      var grid = el('div', { class: 'choices cats' });
      items.forEach(function (c) {
        grid.appendChild(el('button', { type: 'button', class: 'choice', 'data-v': c.name, 'aria-pressed': 'false' }, [el('span', { class: 'ic', text: c.icon }), c.name]));
      });
      box.appendChild(grid);
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.choice'); if (!b) return;
      var v = b.dataset.v, i = state.cats.indexOf(v);
      if (i >= 0) state.cats.splice(i, 1);
      else { if (state.cats.length >= 2) { GD.toast('분야는 2개까지 고를 수 있어요'); return; } state.cats.push(v); }
      $$('#cats .choice').forEach(function (c) { c.setAttribute('aria-pressed', state.cats.indexOf(c.dataset.v) >= 0 ? 'true' : 'false'); });
      syncCare();
    });
  }

  // 처음 상태: 돌봄은 '기도만' 처리 방식의 첫 항목, 공유 범위는 맨 위 항목
  function defaultCare() { var o = OPTS.care.filter(function (x) { return x.base === 'pray'; })[0]; return o ? [o.code] : []; }
  function paintCare() { $$('#care .choice').forEach(function (c) { c.setAttribute('aria-pressed', state.care.indexOf(c.dataset.v) >= 0 ? 'true' : 'false'); }); }
  function resetChoices() {
    state.care = defaultCare(); paintCare();
    state.scope = OPTS.scope.length ? OPTS.scope[0].code : '';
    $$('#scope .choice').forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.v === state.scope ? 'true' : 'false'); });
  }

  // 돌봄 (여러 개, '기도만' 처리 방식은 단독)
  $('#care').addEventListener('click', function (e) {
    var b = e.target.closest('.choice'); if (!b) return;
    var v = b.dataset.v, i = state.care.indexOf(v), isPray = CARE_BASE[v] === 'pray';
    if (i >= 0) state.care.splice(i, 1); else state.care.push(v);
    if (isPray && i < 0) state.care = [v];
    else if (!isPray) state.care = state.care.filter(function (x) { return CARE_BASE[x] !== 'pray'; });
    if (!state.care.length) state.care = defaultCare();
    paintCare(); syncCare();
  });
  single($('#time'), 'time'); single($('#scope'), 'scope');
  single($('#forWhom'), 'forWhom', function () { $('#relationField').hidden = state.forWhom !== 'other'; });
  single($('#minor'), 'minorV', function () { state.minor = state.minorV === 'yes'; syncMinor(); });
  $('#content').addEventListener('input', function () { $('#cnt').textContent = this.value.length; });
  $('#urgent').addEventListener('change', function () { $('#urgentPanel').classList.toggle('is-urgent', this.checked); });

  function fail(msg) { var e = $('#err'); e.textContent = msg; e.hidden = false; }

  $('#form').addEventListener('submit', function (e) {
    e.preventDefault(); $('#err').hidden = true;
    var code = state.linkParish || $('#parish').value;
    var data = {
      name: $('#name').value.trim(), phone: $('#phone').value.trim(), is_minor: state.minor,
      parish: code && code[0] !== '@' ? code : '', parish_choice: code && code[0] === '@' ? code.slice(1) : '', via_link: !!state.linkParish,
      for_whom: state.forWhom, relation: $('#relation').value.trim(), categories: state.cats.slice(), content: $('#content').value.trim(),
      important_date: $('#date').value, care: state.care.slice(), contact_time: state.time, scope: state.scope, urgent: $('#urgent').checked,
      consent: $('#consent').checked, consent_sensitive: $('#consentSensitive').checked, website: $('#website').value
    };
    if (!code) return fail('소속 교구를 골라 주세요.');
    if (!data.name) return fail(state.minor ? '이름이나 별명을 적어 주세요.' : '성함을 적어 주세요.');
    if (!state.minor && data.phone.replace(/\D/g, '').length < 9) return fail('연락처를 정확히 적어 주세요.');
    if (!data.categories.length) return fail('기도 분야를 하나 이상 골라 주세요.');
    if (!data.content) return fail('기도제목을 적어 주세요.');
    if (!data.consent || !data.consent_sensitive) return fail('두 가지 동의에 모두 체크해 주세요.');
    var btn = $('#submitBtn'); GD.busy(btn, true, ' 보내는 중…');
    GD.rpc('gd_submit', { p: data }).then(function (res) {
      GD.busy(btn, false);
      if (!res || !res.card) { fail('접수되었습니다. 감사합니다.'); return; }
      var list = GD.store.get(RKEY, []); list.unshift(res.receipt); GD.store.set(RKEY, list.slice(0, 30));
      showResult(res);
    }).catch(function (er) { GD.busy(btn, false); fail(er.message); });
  });

  function meta() { return { church: CFGD.church, title: CFGD.title, subtitle: CFGD.subtitle, translation: CFGD.translation }; }

  function showResult(res) {
    GD.Card.render($('#card'), res.card, meta());
    $('#careMsg').textContent = (res.parish ? res.parish + ' · ' : '') + (res.card.care || '교회가 함께 기도하겠습니다.');
    var cb = $('#crisisBox'); cb.hidden = !res.crisis; cb.innerHTML = '';
    if (res.crisis) cb.appendChild(el('div', {}, [el('b', { text: '지금 많이 힘드시다면, 혼자 견디지 마세요.' }), res.crisis.message]));
    $('#saveImg').onclick = function () { GD.Card.saveImage(res.card, meta()); };
    $('#shareBtn').onclick = function () { GD.Card.shareText(res.card, meta()); };
    showView('resultView');
  }

  function resetForm() {
    $('#form').reset(); $('#cnt').textContent = '0'; state.cats = [];
    $$('#cats .choice').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
    resetChoices();
    $('#urgentPanel').classList.remove('is-urgent'); syncCare(); syncParish();
  }
  $('#againBtn').addEventListener('click', function () { resetForm(); showView('formView'); });
  $('#backBtn').addEventListener('click', function () { showView('formView'); });
  $('#myBtn').addEventListener('click', loadMy);

  function loadMy() {
    showView('myView');
    var box = $('#myList'); box.innerHTML = '<div class="empty">불러오는 중…</div>';
    var receipts = GD.store.get(RKEY, []);
    if (!receipts.length) { box.innerHTML = '<div class="empty">아직 이 휴대폰에서 보낸 기도제목이 없습니다.</div>'; return; }
    hashAll(receipts).then(function () { return GD.rpc('gd_my', { receipts: receipts }); }).then(function (rows) {
      box.innerHTML = '';
      if (!rows.length) { box.innerHTML = '<div class="empty">보관 기간이 지나 정리되었습니다.</div>'; return; }
      rows.forEach(function (r) {
        var receipt = receiptFor(r.receipt_hash, receipts);
        var item = el('div', { class: 'item' }, [
          el('div', { class: 'item-head' }, [el('span', { class: 'item-name', text: r.categories.join(' · ') }), el('span', { class: 'item-meta', text: GD.fmtDate(r.created_at, true) })]),
          el('div', { class: 'tags' }, [el('span', { class: 'tag green', text: r.status }), r.prayed ? el('span', { class: 'tag gold', text: '🙏 ' + r.prayed + '번 함께 기도했어요' }) : null, r.answered ? el('span', { class: 'tag gold', text: '응답 감사' }) : null]),
          el('div', { class: 'item-text', text: r.content }),
          el('div', { class: 'grid-3' }, [
            el('button', { type: 'button', class: 'btn btn-line btn-sm', text: '말씀 카드', disabled: !r.card, onclick: function () { var w = el('article', { class: 'card' }); GD.Card.render(w, r.card, meta()); GD.modal('말씀 카드', w, [el('button', { class: 'btn btn-primary', type: 'button', text: '이미지 저장', onclick: function () { GD.Card.saveImage(r.card, meta()); } })]); } }),
            el('button', { type: 'button', class: 'btn btn-line btn-sm', text: '응답 감사', disabled: r.answered, onclick: function () { answered(receipt); } }),
            el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: '삭제 요청', onclick: function () { withdraw(receipt); } })
          ])
        ]);
        box.appendChild(item);
      });
    }).catch(function (e) { box.innerHTML = ''; box.appendChild(el('div', { class: 'empty', text: e.message })); });
  }
  var hashCache = {};
  function receiptFor(hash, receipts) { return hashCache[hash] || null; }
  function hashAll(receipts) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve();
    return Promise.all(receipts.map(function (r) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(r)).then(function (b) {
        var h = Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
        hashCache[h] = r;
      });
    }));
  }
  function answered(receipt) {
    if (!receipt) return GD.toast('이 휴대폰에서는 바꿀 수 없습니다');
    var ta = el('textarea', { class: 'textarea', maxlength: '500', placeholder: '나누고 싶은 감사를 적어 주세요 (선택)' });
    var m = GD.modal('기도가 응답되었어요', el('div', {}, [el('p', { class: 'muted', style: 'margin-bottom:10px', text: '담당 목회자에게 감사 소식이 전해집니다.' }), ta]), [
      el('button', { class: 'btn btn-primary', type: 'button', text: '보내기', onclick: function () {
        GD.rpc('gd_my_update', { receipt: receipt, action: 'answered', note: ta.value }).then(function () { m.close(); GD.toast('감사 소식을 전했습니다'); loadMy(); }).catch(function (e) { GD.toast(e.message); });
      } })]);
  }
  function withdraw(receipt) {
    if (!receipt) return GD.toast('이 휴대폰에서는 바꿀 수 없습니다');
    var m = GD.modal('기도제목 삭제 요청', el('p', { text: '이 기도제목의 이름·연락처·내용이 바로 삭제됩니다. 되돌릴 수 없습니다.' }), [
      el('button', { class: 'btn btn-line', type: 'button', text: '취소', onclick: function () { m.close(); } }),
      el('button', { class: 'btn btn-danger', type: 'button', text: '삭제', onclick: function () {
        GD.rpc('gd_my_update', { receipt: receipt, action: 'withdraw' }).then(function () { m.close(); GD.toast('삭제했습니다'); loadMy(); }).catch(function (e) { GD.toast(e.message); });
      } })]);
  }

  // 시작
  if (!GD.configured()) { $('#notConfigured').hidden = false; }
  hashAll(GD.store.get(RKEY, []));
  GD.rpc('gd_public_config').then(function (cfg) {
    CFGD = cfg; buildForm(); syncCare();
    if (params.get('view') === 'my') loadMy();
  }).catch(function (e) { fail(e.message); CFGD = { parishes: [], categories: [] }; buildForm(); syncCare(); });
})();
