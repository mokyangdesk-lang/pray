/* 365 기도동행 · 목회자 앱 / 관리자 앱 (body data-mode 로 구분) */
(function () {
  'use strict';
  var $ = GD.$, $$ = GD.$$, el = GD.el;
  var MODE = document.body.dataset.mode;           // pastor | admin
  var TKEY = 'gd_staff_token';
  var token = GD.store.get(TKEY, null), me = null, view = null, refreshTimer = null;
  var app = $('#app');
  var params = new URLSearchParams(location.search);
  var CARE = { pray: '기도만', call: '전화 기도', meet: '만나서 기도', visit: '심방', team: '중보기도팀' };
  var SCOPE = { staff: '담당 목회자만', team: '중보기도팀과 함께', anon: '이름 없이 공유' };
  var ROLE = { admin: '관리자', pastor: '교구 목회자', team: '중보기도팀원' };
  var STATUS = { new: '배정 대기', assigned: '배정', contacted: '연락 완료', closed: '종결' };
  var KIND = { submit: '접수', assign: '배정', prayed: '함께 기도', contacted: '연락', memo: '메모', status: '상태', transfer: '교구 변경 요청', member: '성도' };

  GD.registerSW();

  function dir() { return location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, ''); }
  function memberUrl(code) { return dir() + (code ? '?p=' + code : ''); }
  function staffUrl(role, name) { return dir() + (role === 'admin' ? 'admin.html' : 'pastor.html') + (name ? '?n=' + encodeURIComponent(name) : ''); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function call(fn, args) {
    return GD.rpc(fn, Object.assign({ p_token: token }, args || {})).catch(function (e) { if (e.auth) logout(true); throw e; });
  }
  function logout(expired) {
    if (token && !expired) GD.rpc('gd_logout', { p_token: token }).catch(function () {});
    token = null; me = null; GD.store.del(TKEY); clearInterval(refreshTimer);
    loginView(expired ? '로그인이 끝났습니다. 다시 로그인해 주세요.' : '');
  }

  /* ───────── 로그인 ───────── */
  function loginView(msg) {
    app.innerHTML = '';
    var name = el('input', { class: 'input', id: 'lgName', maxlength: '30', autocomplete: 'username', value: params.get('n') || '' });
    var code = el('input', { class: 'input', id: 'lgCode', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '9', placeholder: '0000-0000' });
    code.addEventListener('input', function () { var d = code.value.replace(/\D/g, '').slice(0, 8); code.value = d.length > 4 ? d.slice(0, 4) + '-' + d.slice(4) : d; });
    var err = el('div', { class: 'err', hidden: !msg, text: msg || '' });
    var btn = el('button', { class: 'btn btn-primary', type: 'submit', text: '로그인' });
    var form = el('form', { class: 'panel login fade', novalidate: true, onsubmit: function (e) {
      e.preventDefault(); err.hidden = true;
      if (!name.value.trim() || code.value.replace(/\D/g, '').length !== 8) { err.textContent = '이름과 8자리 코드를 입력해 주세요.'; err.hidden = false; return; }
      GD.busy(btn, true, ' 확인 중…');
      GD.rpc('gd_login', { p_name: name.value.trim(), p_code: code.value }).then(function (r) {
        GD.busy(btn, false);
        if (r.error) { err.textContent = r.error; err.hidden = false; return; }
        token = r.token; GD.store.set(TKEY, token); me = r.staff; enter();
      }).catch(function (e) { GD.busy(btn, false); err.textContent = e.message; err.hidden = false; });
    } }, [
      el('div', { class: 'hero', style: 'padding:4px 0 18px' }, [el('h1', { text: '365 기도동행' }), el('div', { class: 'sub', text: MODE === 'admin' ? '관리자' : '목회자' })]),
      el('div', { class: 'field' }, [el('label', { class: 'lb', for: 'lgName', text: '이름' }), name]),
      el('div', { class: 'field' }, [el('label', { class: 'lb', for: 'lgCode', text: '코드 (8자리)' }), code]),
      btn, err,
      el('p', { class: 'small muted center', style: 'margin-top:14px', text: '관리자에게 받은 이름과 코드를 입력하세요. 한 번 로그인하면 이 기기에서는 계속 로그인됩니다.' })
    ]);
    app.appendChild(form);
    var ib = el('button', { class: 'btn btn-line', type: 'button', style: 'max-width:400px;margin:12px auto 0;display:flex', hidden: true, text: '＋ 홈 화면에 추가' });
    app.appendChild(ib); GD.Install.init(ib);
    if (!GD.configured()) { err.textContent = 'config.js 에 Supabase 주소와 키를 넣어 주세요.'; err.hidden = false; }
    (name.value ? code : name).focus();
  }

  function enter() {
    if (MODE === 'admin' && me.role !== 'admin') {
      app.innerHTML = '';
      app.appendChild(el('div', { class: 'panel login center' }, [
        el('p', { style: 'margin-bottom:12px', text: me.name + ' 님은 관리자 권한이 없습니다.' }),
        el('a', { class: 'btn btn-primary', href: 'pastor.html', text: '목회자 화면으로 가기' }),
        el('button', { class: 'btn btn-line', type: 'button', style: 'margin-top:8px', text: '로그아웃', onclick: function () { logout(); } })]));
      return;
    }
    shell();
    if (MODE === 'admin') go(params.get('tab') || 'dash'); else go('new');
    clearInterval(refreshTimer);
    refreshTimer = setInterval(function () { if (!document.hidden && !$('.overlay')) refreshCounts(); }, 60000);
  }

  /* ───────── 틀 ───────── */
  var TABS_P = [['new', '새로 온'], ['active', '진행 중'], ['today', '오늘 연락'], ['closed', '종결']];
  var TABS_A = [['dash', '현황'], ['inbox', '배정 대기'], ['all', '전체'], ['staff', '사역자'], ['links', '교구 링크'], ['settings', '설정']];
  function shell() {
    app.innerHTML = '';
    var ib = el('button', { class: 'icon-btn', type: 'button', hidden: true, text: '＋ 홈 화면' });
    app.appendChild(el('div', { class: 'top' }, [
      el('span', { class: 'brand', text: '기도동행 ' + (MODE === 'admin' ? '관리자' : '목회자') }),
      el('div', { class: 'actions' }, [ib,
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '새로고침', text: '↻', onclick: function () { go(view); } }),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '메뉴', text: '⋯', onclick: menu })])]));
    GD.Install.init(ib);
    var who = me.name + (me.title ? ' ' + me.title + '님' : ' 님');
    var where = me.role === 'admin' ? '전체 교구' : me.role === 'team' ? '중보기도팀' : (me.parishes || []).map(function (p) { return p.name; }).join(' · ');
    app.appendChild(el('div', { class: 'hero', style: 'padding:4px 0 16px;text-align:left' }, [
      el('div', { style: 'font-size:20px;font-weight:800', text: who }), el('div', { class: 'muted small', text: (me.church || '') + ' · ' + where })]));
    var tabs = el('div', { class: 'tabs' + (MODE === 'admin' ? ' six' : ''), role: 'tablist', id: 'tabs' });
    (MODE === 'admin' ? TABS_A : TABS_P).forEach(function (t) {
      tabs.appendChild(el('button', { class: 'tab', role: 'tab', type: 'button', 'data-v': t[0], 'aria-selected': 'false', onclick: function () { go(t[0]); } },
        [t[1], el('span', { class: 'badge', 'data-c': t[0], hidden: true })]));
    });
    app.appendChild(tabs);
    app.appendChild(el('div', { id: 'pane' }));
    app.appendChild(el('div', { class: 'foot', html: '365 기도동행 · 만든 곳 <a href="https://mokyangdesk.com" target="_blank" rel="noopener">AI목양지원센터</a>' }));
  }
  function menu() {
    var body = el('div', {}, [
      el('dl', { class: 'kv' }, [el('dt', { text: '이름' }), el('dd', { text: me.name + ' ' + (me.title || '') }), el('dt', { text: '역할' }), el('dd', { text: ROLE[me.role] }),
        el('dt', { text: '담당' }), el('dd', { text: me.role === 'admin' ? '전체' : (me.parishes || []).map(function (p) { return p.name; }).join(', ') || '-' })]),
      me.role === 'admin' ? el('a', { class: 'btn btn-line', style: 'margin-bottom:8px', href: MODE === 'admin' ? 'pastor.html' : 'admin.html', text: MODE === 'admin' ? '목회자 화면 보기' : '관리자 화면으로 가기' }) : null,
      el('a', { class: 'btn btn-line', href: memberUrl(''), target: '_blank', rel: 'noopener', text: '성도 화면 열기' })
    ]);
    GD.modal('메뉴', body, [el('button', { class: 'btn btn-danger', type: 'button', text: '로그아웃', onclick: function () { logout(); } })]);
  }
  function setTab(v) { $$('#tabs .tab').forEach(function (t) { t.setAttribute('aria-selected', t.dataset.v === v ? 'true' : 'false'); }); }
  function refreshCounts() {
    return call('gd_counts').then(function (c) {
      var map = MODE === 'admin' ? { inbox: c.inbox } : { new: c.new, active: c.active, today: c.today };
      $$('#tabs .badge').forEach(function (b) {
        var n = map[b.dataset.c]; b.hidden = !n; b.textContent = n || '';
        b.classList.toggle('red', (b.dataset.c === 'today' || b.dataset.c === 'inbox') && n > 0);
      });
      if (c.urgent && MODE === 'pastor') document.title = '(' + c.urgent + ') 기도동행 목회자';
    }).catch(function () {});
  }
  function pane() { return $('#pane'); }
  function loading() { pane().innerHTML = '<div class="empty">불러오는 중…</div>'; }
  function failPane(e) { pane().innerHTML = ''; pane().appendChild(el('div', { class: 'empty', text: e.message })); }

  function go(v) {
    view = v; setTab(v); refreshCounts();
    if (MODE === 'pastor') return listView({ view: v });
    ({ dash: dashView, inbox: function () { listView({ view: 'inbox' }); }, all: allView, staff: staffView, links: linksView, settings: settingsView }[v] || dashView)();
  }

  /* ───────── 기도제목 목록 ───────── */
  function listView(filter, into) {
    var box = into || pane();
    if (!into) loading();
    return call('gd_list', { f: filter }).then(function (rows) {
      box.innerHTML = '';
      if (!rows.length) {
        var msg = { new: '새로 온 기도제목이 없습니다.', today: '오늘 연락할 기도제목이 없습니다.', inbox: '배정을 기다리는 기도제목이 없습니다.', closed: '종결된 기도제목이 없습니다.' }[filter.view] || '기도제목이 없습니다.';
        box.appendChild(el('div', { class: 'empty', text: msg })); return;
      }
      var list = el('div', { class: 'list' + (MODE === 'admin' ? ' cols' : '') });
      rows.forEach(function (r) { list.appendChild(itemEl(r, filter.view)); });
      box.appendChild(list);
    }).catch(failPane);
  }

  function tagsFor(r) {
    var t = [];
    if (r.crisis) t.push(['위기 표현', 'red']);
    if (r.urgent) t.push(['긴급 요청', 'red']);
    else if (r.priority === '높음') t.push(['높음', 'orange']);
    if (r.needs_review) t.push(['교구 변경 요청', 'orange']);
    if (MODE === 'admin' || (me.parishes || []).length > 1) t.push([r.parish || ('배정 대기' + (r.parish_choice ? ' · ' + r.parish_choice : '')), r.parish ? '' : 'orange']);
    (r.categories || []).forEach(function (c) { t.push([c, 'green']); });
    if (r.situation && ['기도만', '긴급', '위기'].indexOf(r.situation) < 0) t.push([r.situation, '']);
    if (r.status === 'contacted' || r.status === 'closed') t.push([STATUS[r.status], '']);
    if (r.next_due && r.status !== 'closed') t.push(['연락일 ' + GD.fmtDate(r.next_due), r.next_due <= today() ? 'red' : '']);
    if (r.is_minor) t.push(['14세 미만', 'gold']);
    if (r.answered) t.push(['응답 감사', 'gold']);
    return el('div', { class: 'tags' }, t.map(function (x) { return el('span', { class: 'tag ' + x[1], text: x[0] }); }));
  }

  function prayBtn(r) {
    var b = el('button', { type: 'button', class: 'btn btn-line' + (r.prayed_today ? ' prayed' : ''), text: '🙏 ' + (r.prayed_today ? '기도함 ' : '기도 ') + (r.prayed_count || '') });
    b.addEventListener('click', function () {
      if (r.prayed_today) { GD.toast('오늘 이미 함께 기도했습니다'); return; }
      b.disabled = true;
      call('gd_pray', { p_id: r.id }).then(function (x) { r.prayed_today = true; r.prayed_count = x.prayed_count; b.classList.add('prayed'); b.textContent = '🙏 기도함 ' + x.prayed_count; b.disabled = false; GD.toast('함께 기도했습니다'); refreshCounts(); })
        .catch(function (e) { b.disabled = false; GD.toast(e.message); });
    });
    return b;
  }
  function smsBody(r) { return r.name + '님, ' + (me.church || '') + ' ' + me.name + ' ' + (me.title || '') + '입니다. 남겨 주신 기도제목으로 함께 기도하고 있습니다.'; }

  function itemEl(r, v) {
    var cls = 'item' + (r.status === 'closed' ? ' closed-row' : r.priority === '긴급' ? ' urgent-row' : r.priority === '높음' ? ' high-row' : '');
    var who = r.name + (r.relation ? ' · ' + r.relation + ' 위해' : '');
    var acts = el('div', { class: 'item-actions' });
    acts.appendChild(prayBtn(r));
    if (me.role !== 'team') {
      acts.appendChild(el('a', { class: 'btn btn-line', href: r.phone ? 'tel:' + r.phone.replace(/[^0-9+]/g, '') : '#', 'aria-disabled': !r.phone, style: r.phone ? '' : 'opacity:.4;pointer-events:none', text: '📞 전화' }));
      acts.appendChild(el('a', { class: 'btn btn-line', href: r.phone ? GD.smsLink(r.phone, smsBody(r)) : '#', style: r.phone ? '' : 'opacity:.4;pointer-events:none', text: '💬 문자' }));
    } else { acts.style.gridTemplateColumns = '1fr 1fr'; }
    acts.appendChild(el('button', { type: 'button', class: 'btn btn-primary', text: '자세히', onclick: function () { detail(r.id); } }));
    var item = el('div', { class: cls }, [
      el('div', { class: 'item-head' }, [el('span', { class: 'item-name', text: who }), el('span', { class: 'item-meta', text: GD.ago(r.created_at) })]),
      tagsFor(r), el('div', { class: 'item-text', text: r.content }), acts]);
    if (MODE === 'admin' && v === 'inbox') item.appendChild(assignRow(r, function () { item.remove(); refreshCounts(); }));
    return item;
  }

  function parishSelect(selected) {
    var s = el('select', { class: 'select' }, [el('option', { value: '', text: '교구 선택' })]);
    (me.all_parishes || []).filter(function (p) { return p.active; }).forEach(function (p) { s.appendChild(el('option', { value: p.id, text: p.name, selected: p.id === selected })); });
    return s;
  }
  function assignRow(r, done) {
    var s = parishSelect(null);
    var b = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '배정' });
    b.addEventListener('click', function () {
      if (!s.value) return GD.toast('교구를 골라 주세요');
      GD.busy(b, true);
      call('gd_assign', { p_id: r.id, p_parish: +s.value, p_note: '' }).then(function (x) { GD.toast(x.parish + '에 배정했습니다'); done && done(x); })
        .catch(function (e) { GD.busy(b, false); GD.toast(e.message); });
    });
    return el('div', { class: 'grid-2', style: 'margin-top:8px;grid-template-columns:1fr auto' }, [s, b]);
  }

  /* ───────── 자세히 ───────── */
  function detail(id) {
    call('gd_get', { p_id: id }).then(function (r) { openDetail(r); }).catch(function (e) { GD.toast(e.message); });
  }
  function openDetail(r) {
    var body = el('div');
    body.appendChild(tagsFor(r));
    var kv = el('dl', { class: 'kv' });
    function row(k, v, node) { if (!v && !node) return; kv.appendChild(el('dt', { text: k })); kv.appendChild(node ? el('dd', {}, [node]) : el('dd', { text: v })); }
    row('성함', r.name + (r.is_minor ? ' (14세 미만)' : ''));
    if (r.relation) row('기도 대상', r.relation);
    row('연락처', null, r.phone ? el('a', { href: 'tel:' + r.phone.replace(/[^0-9+]/g, ''), text: r.phone }) : el('span', { class: 'muted', text: me.role === 'team' ? '(중보기도팀에는 표시되지 않습니다)' : '없음' }));
    row('교구', (r.parish || '배정 대기') + (r.parish_choice && r.parish_choice !== r.parish ? ' (성도 선택: ' + r.parish_choice + ')' : ''));
    row('분야', (r.categories || []).join(', '));
    row('상황', r.situation + ' · ' + r.priority);
    if (r.important_date) row('중요한 날짜', r.important_date);
    row('원하는 돌봄', (r.care || []).map(function (c) { return CARE[c] || c; }).join(', '));
    if (r.contact_time && (r.care || []).some(function (c) { return c !== 'pray' && c !== 'team'; })) row('연락 시간', r.contact_time);
    row('공유 범위', SCOPE[r.scope]);
    row('접수', GD.fmtDate(r.created_at, true));
    row('상태', STATUS[r.status] + (r.last_contact ? ' · 마지막 연락 ' + GD.fmtDate(r.last_contact) : '') + (r.next_due && r.status !== 'closed' ? ' · 다음 연락 ' + GD.fmtDate(r.next_due) : ''));
    row('함께 기도', (r.prayed_count || 0) + '번');
    body.appendChild(kv);
    body.appendChild(el('div', { class: 'section-title', text: '기도제목' }));
    body.appendChild(el('div', { class: 'panel', style: 'white-space:pre-wrap;margin-bottom:0', text: r.content }));
    if (r.member_note) { body.appendChild(el('div', { class: 'section-title', text: '성도가 전한 응답' })); body.appendChild(el('div', { class: 'note ok', text: r.member_note })); }

    var foot = [];
    if (me.role !== 'team' && !r.purged) {
      var memo = el('textarea', { class: 'textarea', style: 'min-height:84px', maxlength: '1000', placeholder: '통화 내용, 심방 일정 등을 적어 두세요' });
      var mb = el('button', { type: 'button', class: 'btn btn-line btn-sm', style: 'margin-top:8px', text: '메모 저장' });
      mb.addEventListener('click', function () {
        if (!memo.value.trim()) return;
        GD.busy(mb, true);
        call('gd_memo', { p_id: r.id, p_note: memo.value }).then(function (x) { m.close(); openDetail(x); GD.toast('메모를 저장했습니다'); }).catch(function (e) { GD.busy(mb, false); GD.toast(e.message); });
      });
      body.appendChild(el('div', { class: 'section-title', text: '메모' })); body.appendChild(memo); body.appendChild(mb);

      if (MODE === 'admin') {
        body.appendChild(el('div', { class: 'section-title', text: '교구 배정' }));
        body.appendChild(assignRow(r, function (x) { m.close(); openDetail(x); refresh(); }));
      }
      if (r.status !== 'closed') {
        foot.push(el('button', { type: 'button', class: 'btn btn-primary', text: '연락 완료', onclick: function () { setStatus(r, 'contacted'); } }));
        foot.push(el('button', { type: 'button', class: 'btn btn-line', text: '종결', onclick: function () { setStatus(r, 'closed'); } }));
      } else {
        foot.push(el('button', { type: 'button', class: 'btn btn-line', text: '다시 진행', onclick: function () { setStatus(r, 'reopen'); } }));
      }
      if (MODE === 'pastor' && me.role === 'pastor' && r.parish_id) {
        foot.push(el('button', { type: 'button', class: 'btn btn-soft', text: '교구 변경', onclick: function () { transfer(r); } }));
      }
    }
    if (me.role !== 'team' && r.events && r.events.length) {
      body.appendChild(el('div', { class: 'section-title', text: '돌봄 기록' }));
      var tl = el('ul', { class: 'timeline' });
      r.events.forEach(function (e) {
        tl.appendChild(el('li', {}, [el('span', { class: 'when', text: GD.fmtDate(e.at, true) }), el('b', { text: (KIND[e.kind] || e.kind) }), (e.who ? ' · ' + e.who : ''), e.note ? el('div', { class: 'muted', text: e.note }) : null]));
      });
      body.appendChild(tl);
    }
    var m = GD.modal(r.name + (r.relation ? ' · ' + r.relation : ''), body, foot);
  }
  function refresh() { go(view); }
  function setStatus(r, st) {
    var label = { contacted: '연락 완료로 표시할까요?', closed: '이 기도제목을 종결할까요?', reopen: '다시 진행할까요?' }[st];
    var note = el('input', { class: 'input', maxlength: '200', placeholder: st === 'contacted' ? '예: 전화로 함께 기도함' : '메모 (선택)' });
    var mm = GD.modal(label, el('div', {}, [st === 'contacted' ? el('p', { class: 'muted small', style: 'margin-bottom:8px', text: '연락기준에 따라 다음 연락일이 자동으로 잡힙니다.' }) : null, st === 'reopen' ? null : note]), [
      el('button', { type: 'button', class: 'btn btn-line', text: '취소', onclick: function () { mm.close(); } }),
      el('button', { type: 'button', class: 'btn btn-primary', text: '확인', onclick: function () {
        call('gd_set_status', { p_id: r.id, p_status: st, p_note: note.value }).then(function (x) {
          $$('.overlay').forEach(function (o) { o.close(); }); GD.toast({ contacted: '연락 완료로 표시했습니다', closed: '종결했습니다', reopen: '다시 진행합니다' }[st]); refresh();
        }).catch(function (e) { GD.toast(e.message); });
      } })]);
  }
  function transfer(r) {
    var note = el('input', { class: 'input', maxlength: '200', placeholder: '예: 6교구 성도입니다' });
    var mm = GD.modal('우리 교구가 아닌가요?', el('div', {}, [el('p', { class: 'muted small', style: 'margin-bottom:8px', text: '관리자의 배정 대기함으로 돌아가고, 관리자가 맞는 교구로 다시 배정합니다.' }), note]), [
      el('button', { type: 'button', class: 'btn btn-line', text: '취소', onclick: function () { mm.close(); } }),
      el('button', { type: 'button', class: 'btn btn-primary', text: '요청하기', onclick: function () {
        call('gd_transfer', { p_id: r.id, p_note: note.value }).then(function () { $$('.overlay').forEach(function (o) { o.close(); }); GD.toast('관리자에게 넘겼습니다'); refresh(); }).catch(function (e) { GD.toast(e.message); });
      } })]);
  }

  /* ───────── 관리자: 현황 ───────── */
  function dashView() {
    loading();
    call('gd_stats').then(function (s) {
      var p = pane(); p.innerHTML = '';
      var tiles = el('div', { class: 'tiles' });
      [['진행 중인 기도제목', s.open], ['배정 대기', s.inbox, s.inbox > 0], ['긴급·높음', s.urgent, s.urgent > 0], ['연락일 지남', s.overdue, s.overdue > 0],
       ['3일째 확인 없음', s.stale, s.stale > 0], ['최근 30일 접수', s.month], ['응답 감사', s.answered], ['함께 기도', s.prayed]].forEach(function (t) {
        tiles.appendChild(el('div', { class: 'tile' + (t[2] ? ' alert' : '') }, [el('div', { class: 'k', text: t[0] }), el('div', { class: 'v', text: String(t[1] || 0) })]));
      });
      p.appendChild(tiles);
      p.appendChild(el('div', { class: 'section-title', text: '교구별' }));
      var tb = el('table', { class: 'table' }, [el('thead', {}, [el('tr', {}, ['교구', '진행 중', '오늘 연락', '30일 접수', '종결'].map(function (h, i) { return el('th', { class: i ? 'num' : '', text: h }); }))])]);
      var body = el('tbody');
      (s.by_parish || []).forEach(function (r) { body.appendChild(el('tr', {}, [el('td', { text: r.name }), el('td', { class: 'num', text: r.open }), el('td', { class: 'num', text: r.today }), el('td', { class: 'num', text: r.month }), el('td', { class: 'num', text: r.closed })])); });
      tb.appendChild(body); p.appendChild(tb);
      if ((s.by_category || []).length) {
        p.appendChild(el('div', { class: 'section-title', text: '최근 90일 분야' }));
        var max = Math.max.apply(null, s.by_category.map(function (c) { return c.n; }));
        var ct = el('table', { class: 'table' }); var cb = el('tbody');
        s.by_category.forEach(function (c) { cb.appendChild(el('tr', {}, [el('td', { style: 'width:38%', text: c.name }), el('td', {}, [el('div', { class: 'bar', style: 'width:' + Math.max(4, c.n / max * 100) + '%' })]), el('td', { class: 'num', style: 'width:56px', text: c.n })])); });
        ct.appendChild(cb); p.appendChild(ct);
      }
    }).catch(failPane);
  }

  /* ───────── 관리자: 전체 ───────── */
  function allView() {
    var p = pane(); p.innerHTML = '';
    var ps = parishSelect(null); ps.options[0].textContent = '모든 교구';
    var st = el('select', { class: 'select' }, [['', '모든 상태'], ['new', '배정 대기'], ['assigned', '배정'], ['contacted', '연락 완료'], ['closed', '종결']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var q = el('input', { class: 'input q', type: 'search', placeholder: '이름·내용 검색' });
    var out = el('div');
    var run = function () { out.innerHTML = '<div class="empty">불러오는 중…</div>'; listView({ view: 'all', parish_id: ps.value, status: st.value, q: q.value.trim() }, out); };
    ps.onchange = run; st.onchange = run; var t; q.oninput = function () { clearTimeout(t); t = setTimeout(run, 350); };
    p.appendChild(el('div', { class: 'toolbar' }, [ps, st, q])); p.appendChild(out); run();
  }

  /* ───────── 관리자: 사역자 ───────── */
  function staffView() {
    loading();
    call('gd_staff_list').then(function (rows) {
      var p = pane(); p.innerHTML = '';
      p.appendChild(el('div', { class: 'grid-2', style: 'margin-bottom:12px' }, [
        el('button', { type: 'button', class: 'btn btn-primary', text: '＋ 사역자 추가', onclick: function () { staffForm(null); } }),
        el('button', { type: 'button', class: 'btn btn-line', text: '목회자 로그인 주소 복사', onclick: function () { GD.copy(staffUrl('pastor')); } })]));
      var list = el('div', { class: 'list cols' });
      rows.forEach(function (s) {
        var pn = (me.all_parishes || []).filter(function (x) { return (s.parish_ids || []).indexOf(x.id) >= 0; }).map(function (x) { return x.name; }).join(', ');
        list.appendChild(el('div', { class: 'item' + (s.active ? '' : ' closed-row') }, [
          el('div', { class: 'item-head' }, [el('span', { class: 'item-name', text: s.name + (s.title ? ' ' + s.title : '') + (s.me ? ' (나)' : '') }), el('span', { class: 'item-meta', text: s.last_login ? '최근 ' + GD.ago(s.last_login) : '로그인 전' })]),
          el('div', { class: 'tags' }, [el('span', { class: 'tag ' + (s.role === 'admin' ? 'gold' : 'green'), text: ROLE[s.role] }), pn ? el('span', { class: 'tag', text: pn }) : null, s.active ? null : el('span', { class: 'tag red', text: '사용 중지' })]),
          el('div', { class: 'small muted', style: 'margin-bottom:10px', text: [s.phone, s.email].filter(Boolean).join(' · ') || '연락처 없음' }),
          el('div', { class: 'grid-2' }, [
            el('button', { type: 'button', class: 'btn btn-line btn-sm', text: '수정', onclick: function () { staffForm(s); } }),
            el('button', { type: 'button', class: 'btn btn-line btn-sm', text: '코드 재발급', disabled: !s.active, onclick: function () { resetCode(s); } })])]));
      });
      p.appendChild(list);
    }).catch(failPane);
  }
  function staffForm(s) {
    var isNew = !s; s = s || { role: 'pastor', parish_ids: [], active: true };
    var f = {
      name: el('input', { class: 'input', maxlength: '30', value: s.name || '' }), title: el('input', { class: 'input', maxlength: '20', value: s.title || '', placeholder: '목사, 전도사, 권사 …' }),
      phone: el('input', { class: 'input', type: 'tel', maxlength: '20', value: s.phone || '', placeholder: '010-0000-0000' }), email: el('input', { class: 'input', type: 'email', maxlength: '80', value: s.email || '', placeholder: '알림 메일 (선택)' })
    };
    var role = s.role, pids = (s.parish_ids || []).slice(), active = s.active !== false;
    var roleBox = el('div', { class: 'choices three' });
    [['pastor', '교구 목회자'], ['admin', '관리자'], ['team', '중보기도팀원']].forEach(function (r) {
      roleBox.appendChild(el('button', { type: 'button', class: 'choice', 'data-v': r[0], 'aria-pressed': role === r[0] ? 'true' : 'false', text: r[1], onclick: function () {
        role = r[0]; $$('.choice', roleBox).forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.v === role ? 'true' : 'false'); }); parField.hidden = role !== 'pastor';
      } }));
    });
    var parBox = el('div', { class: 'choices three' });
    (me.all_parishes || []).filter(function (p) { return p.active; }).forEach(function (p) {
      parBox.appendChild(el('button', { type: 'button', class: 'choice', 'aria-pressed': pids.indexOf(p.id) >= 0 ? 'true' : 'false', text: p.name, onclick: function () {
        var i = pids.indexOf(p.id); if (i >= 0) pids.splice(i, 1); else pids.push(p.id); this.setAttribute('aria-pressed', i >= 0 ? 'false' : 'true');
      } }));
    });
    var parField = el('div', { class: 'field', hidden: role !== 'pastor' }, [el('label', { class: 'lb', text: '담당 교구 (여러 개 가능)' }), parBox]);
    var act = el('label', { class: 'check', style: 'margin:0' }, [el('input', { type: 'checkbox', checked: active, onchange: function () { active = this.checked; } }), '사용 중 (끄면 바로 로그아웃되고 로그인할 수 없습니다)']);
    var body = el('div', {}, [
      el('div', { class: 'grid-2' }, [el('div', { class: 'field' }, [el('label', { class: 'lb', text: '이름' }), f.name]), el('div', { class: 'field' }, [el('label', { class: 'lb', text: '직분' }), f.title])]),
      el('div', { class: 'field' }, [el('label', { class: 'lb', text: '역할' }), roleBox]), parField,
      el('div', { class: 'grid-2' }, [el('div', { class: 'field' }, [el('label', { class: 'lb', text: '휴대폰' }), f.phone]), el('div', { class: 'field' }, [el('label', { class: 'lb', text: '이메일' }), f.email])]),
      isNew ? el('p', { class: 'small muted', text: '저장하면 8자리 코드가 만들어지고, 문자로 바로 보낼 수 있습니다.' }) : act
    ]);
    var save = el('button', { type: 'button', class: 'btn btn-primary', text: isNew ? '저장하고 코드 만들기' : '저장' });
    var m = GD.modal(isNew ? '사역자 추가' : '사역자 수정', body, [save]);
    save.addEventListener('click', function () {
      GD.busy(save, true);
      call('gd_staff_save', { p: { id: s.id || '', name: f.name.value, title: f.title.value, role: role, parish_ids: role === 'pastor' ? pids : [], phone: f.phone.value, email: f.email.value, active: active } })
        .then(function (r) { m.close(); staffView(); if (r.code) codeModal({ name: f.name.value.trim(), title: f.title.value.trim(), role: role, phone: f.phone.value, email: f.email.value, parish_ids: pids }, r.code); else GD.toast('저장했습니다'); })
        .catch(function (e) { GD.busy(save, false); GD.toast(e.message); });
    });
  }
  function resetCode(s) {
    var mm = GD.modal('코드를 새로 만들까요?', el('p', { text: s.name + ' 님의 기존 코드는 바로 쓸 수 없게 되고, 로그인된 기기도 모두 로그아웃됩니다.' }), [
      el('button', { type: 'button', class: 'btn btn-line', text: '취소', onclick: function () { mm.close(); } }),
      el('button', { type: 'button', class: 'btn btn-primary', text: '새 코드 만들기', onclick: function () { call('gd_staff_reset', { p_id: s.id }).then(function (r) { mm.close(); codeModal(s, r.code); }).catch(function (e) { GD.toast(e.message); }); } })]);
  }
  function codeModal(s, code) {
    var fmt = code.slice(0, 4) + '-' + code.slice(4);
    var pn = (me.all_parishes || []).filter(function (x) { return (s.parish_ids || []).indexOf(x.id) >= 0; }).map(function (x) { return x.name; }).join(', ');
    var what = s.role === 'admin' ? '관리자 페이지' : s.role === 'team' ? '중보기도팀 페이지' : (pn ? pn + ' ' : '') + '기도제목 페이지';
    var msg = '[365 기도동행] ' + s.name + (s.title ? ' ' + s.title : '') + '님, ' + what + ' 안내입니다.\n\n주소: ' + staffUrl(s.role) + '\n이름: ' + s.name + '\n코드: ' + fmt +
      '\n\n처음 한 번만 입력하면 계속 로그인됩니다. 홈 화면에 추가해 두시면 앱처럼 쓰실 수 있습니다. 코드는 다른 분과 나누지 마세요.';
    var body = el('div', {}, [
      el('p', { class: 'muted small', text: '이 코드는 지금 한 번만 보입니다. 문자나 메일로 바로 보내 주세요.' }),
      el('div', { class: 'code-big', text: fmt }),
      el('div', { class: 'consent', style: 'white-space:pre-wrap', text: msg })
    ]);
    GD.modal(s.name + ' 님 코드', body, [
      el('a', { class: 'btn btn-primary', href: GD.smsLink(s.phone || '', msg), text: '문자 보내기' }),
      el('a', { class: 'btn btn-line', href: 'mailto:' + encodeURIComponent(s.email || '') + '?subject=' + encodeURIComponent('[365 기도동행] ' + what + ' 안내') + '&body=' + encodeURIComponent(msg), text: '메일 보내기' }),
      el('button', { type: 'button', class: 'btn btn-line', text: '복사', onclick: function () { GD.copy(msg); } })]);
  }

  /* ───────── 관리자: 교구 링크 ───────── */
  function qrPng(url, label) {
    var q = GidoQR.encode(url), n = q.size + 8, scale = 12, W = n * scale, H = W + 90;
    var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#1d1b17';
    for (var yy = 0; yy < q.size; yy++) for (var xx = 0; xx < q.size; xx++) if (q.modules[yy][xx]) x.fillRect((xx + 4) * scale, (yy + 4) * scale, scale, scale);
    x.textAlign = 'center'; x.font = '700 36px "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif'; x.fillText(label, W / 2, W + 50);
    return c.toDataURL('image/png');
  }
  function linksView() {
    var p = pane(); p.innerHTML = '';
    p.appendChild(el('div', { class: 'note ok' }, [el('div', { html: '<b>교구별 링크를 교구 단톡방에 올려 주세요.</b>교구 링크로 들어온 기도제목은 관리자가 손대지 않아도 그 교구 목회자에게 바로 배정됩니다.' })]));
    var list = el('div', { class: 'list cols' });
    var all = [{ code: '', name: '전체 (교구 선택)', active: true }].concat(me.all_parishes || []);
    all.forEach(function (pa) {
      if (!pa.active) return;
      var url = memberUrl(pa.code);
      var label = pa.code ? '365 기도동행 · ' + pa.name : '365 기도동행';
      list.appendChild(el('div', { class: 'item' }, [el('div', { class: 'link-row' }, [
        el('div', { class: 'qr', html: GidoQR.svg(url, { border: 2 }) }),
        el('div', { style: 'flex:1;min-width:0' }, [el('div', { class: 'item-name', text: pa.name }), el('div', { class: 'url', text: url }),
          el('div', { class: 'grid-2' }, [
            el('button', { type: 'button', class: 'btn btn-line btn-sm', text: '링크 복사', onclick: function () { GD.copy(url); } }),
            el('button', { type: 'button', class: 'btn btn-line btn-sm', text: 'QR 저장', onclick: function () {
              var src = qrPng(url, label);
              GD.modal(pa.name + ' QR', el('div', { class: 'center' }, [el('img', { src: src, class: 'card-img', alt: label + ' QR' }), el('p', { class: 'small muted', text: '이미지를 길게 눌러 저장하세요' })]),
                [el('a', { class: 'btn btn-primary', href: src, download: 'QR_' + (pa.code || 'all') + '.png', text: '파일로 저장' })]);
            } })])])])]));
    });
    p.appendChild(list);
    p.appendChild(el('div', { class: 'section-title', text: '교구 관리' }));
    var tb = el('table', { class: 'table' }, [el('thead', {}, [el('tr', {}, ['교구', '링크 코드', '청소년', '사용', ''].map(function (h) { return el('th', { text: h }); }))])]);
    var body = el('tbody');
    (me.all_parishes || []).forEach(function (pa) {
      body.appendChild(el('tr', {}, [el('td', { text: pa.name }), el('td', { text: pa.code }), el('td', { text: pa.youth ? '예' : '' }), el('td', { text: pa.active ? '사용' : '중지' }),
        el('td', { class: 'num' }, [el('button', { type: 'button', class: 'icon-btn', text: '수정', onclick: function () { parishForm(pa); } })])]));
    });
    tb.appendChild(body); p.appendChild(tb);
    p.appendChild(el('button', { type: 'button', class: 'btn btn-line', style: 'margin-top:8px', text: '＋ 교구·부서 추가', onclick: function () { parishForm(null); } }));
  }
  function parishForm(pa) {
    pa = pa || { name: '', code: '', youth: false, active: true };
    var nm = el('input', { class: 'input', maxlength: '20', value: pa.name }), cd = el('input', { class: 'input', maxlength: '12', value: pa.code, placeholder: '영문 소문자·숫자 (예: p9)' });
    var y = el('input', { type: 'checkbox', checked: pa.youth }), a = el('input', { type: 'checkbox', checked: pa.active !== false });
    var m = GD.modal(pa.id ? '교구 수정' : '교구·부서 추가', el('div', {}, [
      el('div', { class: 'grid-2' }, [el('div', { class: 'field' }, [el('label', { class: 'lb', text: '이름' }), nm]), el('div', { class: 'field' }, [el('label', { class: 'lb', text: '링크 코드' }), cd])]),
      el('label', { class: 'check' }, [y, '청소년 부서 (만 14세 미만 확인)']), el('label', { class: 'check' }, [a, '사용']),
      pa.id ? el('p', { class: 'small muted', text: '링크 코드를 바꾸면 이미 나눠 준 교구 링크와 QR은 교구가 지정되지 않은 채로 열립니다.' }) : null]),
      [el('button', { type: 'button', class: 'btn btn-primary', text: '저장', onclick: function () {
        call('gd_parish_save', { p: { id: pa.id || '', name: nm.value, code: cd.value.trim().toLowerCase(), youth: y.checked, active: a.checked } })
          .then(function (x) { me = x; m.close(); linksView(); GD.toast('저장했습니다'); }).catch(function (e) { GD.toast(e.message); });
      } })]);
  }

  /* ───────── 관리자: 설정 ───────── */
  function settingsView() {
    loading();
    call('gd_settings_get').then(function (s) {
      var p = pane(); p.innerHTML = '';
      var F = [
        ['church', '교회 이름', 'input'], ['title', '앱 제목', 'input'], ['subtitle', '제목 아래 문구', 'input'],
        ['consent', '개인정보 수집·이용 동의 문구', 'textarea'], ['consent_sensitive', '민감정보 처리 동의 문구', 'textarea'],
        ['crisis', '위기 상담 안내', 'input'], ['retention_days', '종결 후 보관 일수 (지나면 내용 자동 삭제)', 'input'],
        ['app_url', '앱 주소 (알림 메일에 들어갈 주소)', 'input'],
        ['notify_url', '알림 메일 연결 주소 (선택 · 설치 안내 참고)', 'input'], ['notify_secret', '알림 연결 비밀값', 'input']
      ];
      var inputs = {};
      var panel = el('div', { class: 'panel' });
      F.forEach(function (f) {
        var i = f[2] === 'textarea' ? el('textarea', { class: 'textarea', style: 'min-height:100px' }) : el('input', { class: 'input' });
        i.value = s[f[0]] || ''; inputs[f[0]] = i;
        panel.appendChild(el('div', { class: 'field' }, [el('label', { class: 'lb', text: f[1] }), i]));
      });
      var lvl = el('select', { class: 'select' }, [el('option', { value: 'all', text: '새 기도제목마다' }), el('option', { value: 'high', text: '긴급·높음만' })]);
      lvl.value = s.notify_level || 'all'; inputs.notify_level = lvl;
      panel.appendChild(el('div', { class: 'field' }, [el('label', { class: 'lb', text: '알림 메일 보내는 때' }), lvl]));
      if (!inputs.app_url.value) inputs.app_url.value = dir();
      var save = el('button', { type: 'button', class: 'btn btn-primary', text: '설정 저장' });
      save.addEventListener('click', function () {
        var o = {}; Object.keys(inputs).forEach(function (k) { o[k] = inputs[k].value; });
        GD.busy(save, true);
        call('gd_settings_save', { p: o }).then(function () { GD.busy(save, false); GD.toast('저장했습니다'); }).catch(function (e) { GD.busy(save, false); GD.toast(e.message); });
      });
      panel.appendChild(save);
      p.appendChild(panel);

      var d1 = el('input', { class: 'input', type: 'date' }), d2 = el('input', { class: 'input', type: 'date', value: today() });
      var dd = new Date(); dd.setDate(dd.getDate() - 30); d1.value = dd.toISOString().slice(0, 10);
      var exp = el('button', { type: 'button', class: 'btn btn-line', text: '엑셀(CSV) 내려받기' });
      exp.addEventListener('click', function () {
        GD.busy(exp, true);
        call('gd_export', { p_from: d1.value, p_to: d2.value }).then(function (rows) { GD.busy(exp, false); downloadCsv(rows, '기도동행_' + d1.value + '_' + d2.value + '.csv'); })
          .catch(function (e) { GD.busy(exp, false); GD.toast(e.message); });
      });
      p.appendChild(el('div', { class: 'panel' }, [el('h2', { text: '백업 · 내려받기' }), el('p', { class: 'hint', text: '정기적으로 내려받아 교회 드라이브에 보관하세요. 파일에는 개인정보가 들어 있으니 공유에 주의해 주세요.' }),
        el('div', { class: 'grid-2', style: 'margin-bottom:8px' }, [d1, d2]), exp]));
    }).catch(failPane);
  }
  function downloadCsv(rows, name) {
    if (!rows.length) return GD.toast('해당 기간에 기도제목이 없습니다');
    var cols = Object.keys(rows[0]);
    var esc = function (v) { var s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    var csv = '﻿' + cols.map(esc).join(',') + '\n' + rows.map(function (r) { return cols.map(function (c) { return esc(r[c]); }).join(','); }).join('\n');
    var a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ───────── 시작 ───────── */
  if (!token) loginView();
  else GD.rpc('gd_me', { p_token: token }).then(function (m) { me = m; enter(); }).catch(function (e) { if (e.auth) logout(true); else { loginView(e.message); } });
})();
