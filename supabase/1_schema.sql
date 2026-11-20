-- ════════════════════════════════════════════════════════════════
--  365 기도동행 · 데이터베이스와 보안 규칙  (v2.0)
--  만든 곳: AI목양지원센터 (mokyangdesk.com)
--
--  Supabase → SQL Editor → New query 에 이 파일 전체를 붙여 넣고 Run.
--  여러 번 실행해도 안전합니다 (기존 기도제목은 지워지지 않습니다).
--
--  보안 원칙
--   1) 모든 표는 잠겨 있습니다(RLS 켬, 허용 규칙 없음). 웹에서 표를 직접 읽거나 쓸 수 없습니다.
--   2) 웹은 아래 gd_ 로 시작하는 함수만 부를 수 있고, 함수가 매번 로그인과 권한을 확인합니다.
--   3) 성도는 기도제목을 '보내기'만 할 수 있습니다. 다른 사람 기도제목은 읽을 수 없습니다.
--   4) 교구 목회자는 자기 교구만, 중보기도팀원은 공유를 허락한 내용만(이름 가림), 관리자는 전체.
--   5) 사역자 코드는 암호화(bcrypt)해 저장합니다. 관리자도 다시 볼 수 없고 재발급만 됩니다.
-- ════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  begin create extension if not exists pg_net; exception when others then null; end;
end $$;

-- ───────────── 표 ─────────────
create table if not exists gd_settings (key text primary key, value text not null default '');

create table if not exists gd_parishes (
  id serial primary key,
  code text unique not null,          -- 링크용 (예: p5 → …/?p=p5)
  name text not null,
  sort int not null default 0,
  youth boolean not null default false,   -- 청소년 부서(만 14세 미만 확인)
  active boolean not null default true
);

create table if not exists gd_categories (
  id serial primary key,
  name text unique not null,
  icon text not null default '',
  tag text not null default '',
  grp text not null default '삶',     -- 삶 / 믿음 / 함께
  sort int not null default 0,
  mode text not null default 'care' check (mode in ('care','list')),  -- list: 개인 연락 없이 중보 목록으로만
  dated boolean not null default false,  -- 날짜가 중요한 분야 (시험일·수술일 등)
  active boolean not null default true
);

create table if not exists gd_verses (
  id serial primary key,
  category text not null,
  book text not null, chapter int not null, v_start int not null, v_end int not null,
  text text not null,
  active boolean not null default true,
  uses int not null default 0
);

create table if not exists gd_prayer_parts (
  id serial primary key,
  category text not null,
  part text not null check (part in ('부름','간구','맺음')),
  detail text not null default '',
  text text not null,
  active boolean not null default true,
  uses int not null default 0
);

create table if not exists gd_rules (
  situation text primary key,
  priority text not null check (priority in ('긴급','높음','보통','일반')),
  base text not null default '접수일' check (base in ('접수일','중요한 날짜')),
  first_days int,              -- null 이면 개인 연락 없음
  follow_days int,
  message text not null default '',
  sort int not null default 0
);

create table if not exists gd_staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text not null default '',            -- 목사, 전도사 …
  role text not null check (role in ('admin','pastor','team')),
  parish_ids int[] not null default '{}',
  phone text not null default '',
  email text not null default '',
  code_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

create table if not exists gd_sessions (
  token_hash text primary key,
  staff_id uuid not null references gd_staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen timestamptz not null default now()
);

create table if not exists gd_attempts (
  id bigserial primary key,
  name text, ip text, ok boolean, at timestamptz not null default now()
);

create table if not exists gd_prayers (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  receipt_hash text unique,
  parish_id int references gd_parishes(id),
  parish_choice text not null default '',     -- 성도가 고른 소속 (새가족·타 교회 등)
  via_link boolean not null default false,
  name text not null,
  phone text not null default '',
  is_minor boolean not null default false,
  for_whom text not null default 'self',
  relation text not null default '',
  categories text[] not null default '{}',
  content text not null,
  important_date date,
  care text[] not null default '{}',
  contact_time text not null default '',
  scope text not null default 'staff' check (scope in ('staff','team','anon')),
  urgent boolean not null default false,
  crisis boolean not null default false,
  situation text not null default '기도만',
  priority text not null default '일반',
  status text not null default 'new' check (status in ('new','assigned','contacted','closed')),
  needs_review boolean not null default false,
  first_due date, next_due date, last_contact date,
  prayed_count int not null default 0,
  answered boolean not null default false,
  member_note text not null default '',
  card jsonb,
  closed_at timestamptz,
  purged boolean not null default false,
  ip_hash text
);
create index if not exists gd_prayers_parish on gd_prayers(parish_id, status);
create index if not exists gd_prayers_created on gd_prayers(created_at desc);

create table if not exists gd_events (
  id bigserial primary key,
  prayer_id bigint not null references gd_prayers(id) on delete cascade,
  staff_id uuid, staff_name text not null default '',
  kind text not null,        -- submit / assign / prayed / contacted / memo / status / transfer / member
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists gd_events_prayer on gd_events(prayer_id, created_at);

-- 잠금: 표 직접 접근 금지
do $$ declare t text; begin
  foreach t in array array['gd_settings','gd_parishes','gd_categories','gd_verses','gd_prayer_parts','gd_rules',
    'gd_staff','gd_sessions','gd_attempts','gd_prayers','gd_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from public', t);
    begin execute format('revoke all on table %I from anon, authenticated', t); exception when undefined_object then null; end;
  end loop;
end $$;

-- ───────────── 내부 도우미 (웹에서 호출 불가) ─────────────
create or replace function _gd_today() returns date language sql stable as
$$ select (now() at time zone 'Asia/Seoul')::date $$;

create or replace function _gd_set(k text) returns text language sql stable security definer set search_path = public as
$$ select coalesce((select value from gd_settings where key = k), '') $$;

create or replace function _gd_hash(x text) returns text language sql immutable set search_path = public, extensions as
$$ select encode(extensions.digest(coalesce(x,''), 'sha256'), 'hex') $$;

create or replace function _gd_ip() returns text language plpgsql stable as $$
declare h text;
begin
  begin h := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  exception when others then h := null; end;
  return nullif(split_part(coalesce(h,''), ',', 1), '');
end $$;

create or replace function _gd_clean(x text, n int) returns text language sql immutable as
$$ select left(btrim(regexp_replace(coalesce(x,''), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), n) $$;

create or replace function _gd_josa(w text, j text) returns text language plpgsql immutable as $$
declare c int; jong int := 0; has boolean;
begin
  if j is null then return ''; end if;
  if coalesce(w,'') <> '' then
    c := ascii(right(w, 1));
    if c between 44032 and 55203 then jong := (c - 44032) % 28; end if;
  end if;
  has := jong <> 0;
  return case
    when j in ('을','를') then case when has then '을' else '를' end
    when j in ('이','가') then case when has then '이' else '가' end
    when j in ('은','는') then case when has then '은' else '는' end
    when j in ('과','와') then case when has then '과' else '와' end
    when j in ('으로','로') then case when has and jong <> 8 then '으로' else '로' end
    else j end;
end $$;

create or replace function _gd_fill(t text, target text) returns text language plpgsql immutable as $$
declare m text[];
begin
  for m in select distinct regexp_matches(t, '\{대상(:(을|를|이|가|은|는|과|와|의|으로|로))?\}', 'g') loop
    t := replace(t, '{대상' || coalesce(m[1], '') || '}', target || _gd_josa(target, m[2]));
  end loop;
  return t;
end $$;

create or replace function _gd_target(nm text, rel text) returns text language plpgsql immutable as $$
declare fam text[] := array['어머니','아버지','엄마','아빠','남편','아내','아들','딸','자녀','부모','시어머니','시아버지','장모','장인',
  '할머니','할아버지','손자','손녀','형','오빠','누나','언니','동생','친구','동료','조카','이모','고모','삼촌','사위','며느리','약혼자',
  '가족','시부모','남자친구','여자친구','선생님','제자','이웃','후배','선배'];
  w text;
begin
  if coalesce(rel,'') = '' then return nm || ' 님'; end if;
  foreach w in array fam loop
    if position(w in rel) = 1 then return nm || ' 님의 ' || rel; end if;
  end loop;
  if rel ~ '님$' then return rel; end if;
  return rel || ' 님';
end $$;

-- 로그인 확인: 토큰 → 사역자
create or replace function _gd_auth(p_token text) returns gd_staff language plpgsql security definer set search_path = public as $$
declare s gd_staff; sess gd_sessions;
begin
  select * into sess from gd_sessions where token_hash = _gd_hash(p_token) and expires_at > now();
  if not found then raise exception 'AUTH'; end if;
  select * into s from gd_staff where id = sess.staff_id and active;
  if not found then raise exception 'AUTH'; end if;
  if sess.last_seen < now() - interval '10 minutes' then
    update gd_sessions set last_seen = now() where token_hash = sess.token_hash;
  end if;
  return s;
end $$;

create or replace function _gd_require(s gd_staff, roles text[]) returns void language plpgsql as $$
begin
  if not (s.role = any(roles)) then raise exception '권한이 없습니다.'; end if;
end $$;

create or replace function _gd_can_see(s gd_staff, p gd_prayers) returns boolean language sql immutable as $$
  select case s.role
    when 'admin' then true
    when 'pastor' then p.parish_id is not null and p.parish_id = any(s.parish_ids)
    when 'team' then p.scope in ('team','anon') and not p.purged
    else false end
$$;

create or replace function _gd_new_code() returns text language sql volatile set search_path = public, extensions as $$
  select lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 100000000)::text, 8, '0')
$$;

create or replace function _gd_status_label(st text) returns text language sql immutable as $$
  select case st when 'new' then '배정 대기' when 'assigned' then '배정' when 'contacted' then '연락 완료' when 'closed' then '종결' else st end
$$;

create or replace function _gd_event(pid bigint, s gd_staff, k text, n text) returns void language sql security definer set search_path = public as $$
  insert into gd_events(prayer_id, staff_id, staff_name, kind, note)
  values (pid, s.id, coalesce(nullif(trim(s.name || ' ' || coalesce(s.title,'')), ''), ''), k, coalesce(n,''));
$$;

-- 사역자에게 알림 (선택: 설정의 notify_url 이 있을 때만, 기도 내용·이름은 보내지 않음)
create or replace function _gd_notify(pid bigint, k text) returns void language plpgsql security definer set search_path = public as $$
declare p gd_prayers; url text := _gd_set('notify_url'); lvl text := _gd_set('notify_level'); rec text[]; pname text; body jsonb;
begin
  if url = '' then return; end if;
  select * into p from gd_prayers where id = pid;
  if not found then return; end if;
  if lvl = 'high' and p.priority not in ('긴급','높음') and k = 'new' then return; end if;
  select name into pname from gd_parishes where id = p.parish_id;
  select coalesce(array_agg(distinct email), '{}') into rec from gd_staff
   where active and email <> '' and (
     (p.parish_id is not null and role = 'pastor' and p.parish_id = any(parish_ids))
     or (role = 'admin' and (p.parish_id is null or p.priority = '긴급')));
  if array_length(rec, 1) is null then return; end if;
  body := jsonb_build_object('secret', _gd_set('notify_secret'), 'kind', k, 'priority', p.priority, 'urgent', p.urgent,
    'parish', coalesce(pname, '배정 대기'), 'recipients', to_jsonb(rec), 'app', _gd_set('app_url'));
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := ''{"Content-Type":"application/json"}''::jsonb)' using url, body;
  exception when others then null;
  end;
end $$;

-- 보관 기간 정리 (하루 한 번, 로그인할 때 자동 실행)
create or replace function _gd_purge() returns int language plpgsql security definer set search_path = public as $$
declare d int := coalesce(nullif(_gd_set('retention_days'),'')::int, 365); n int;
begin
  update gd_prayers set name = '(삭제됨)', phone = '', relation = '', content = '(보관 기간이 지나 내용을 삭제했습니다)',
    member_note = '', card = null, ip_hash = null, purged = true
   where status = 'closed' and not purged and closed_at < now() - make_interval(days => d);
  get diagnostics n = row_count;
  update gd_events e set note = '(삭제됨)' from gd_prayers p
   where e.prayer_id = p.id and p.purged and e.kind in ('memo','transfer','member','status','assign') and e.note <> '(삭제됨)';
  delete from gd_sessions where expires_at < now();
  delete from gd_attempts where at < now() - interval '30 days';
  update gd_prayers set ip_hash = null where ip_hash is not null and created_at < now() - interval '1 day';
  insert into gd_settings(key, value) values ('last_purge', _gd_today()::text)
  on conflict (key) do update set value = excluded.value;
  return n;
end $$;

-- 상황 판단 → 우선순위·연락 기한
create or replace function _gd_situation(cats text[], care text[], txt text, has_date boolean, urgent boolean, crisis boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare all_list boolean; has_dated boolean;
begin
  if crisis then return '위기'; end if;
  if urgent then return '긴급'; end if;
  select bool_and(mode = 'list'), bool_or(dated) into all_list, has_dated from gd_categories where name = any(cats);
  if '건강·치유' = any(cats) and (has_date or txt ~ '수술|입원|시술|항암|투석|중환자|응급') then return '수술·입원'; end if;
  if '상실·애도' = any(cats) then return '상실·애도'; end if;
  if 'visit' = any(care) then return '방문 심방'; end if;
  if 'meet' = any(care) then return '만나서 기도'; end if;
  if 'call' = any(care) then return '전화 기도'; end if;
  if has_date and coalesce(has_dated, false) then return '일정 앞둠'; end if;
  if coalesce(all_list, false) then return '공동체 기도'; end if;
  if cats = array['감사·응답'] then return '감사'; end if;
  if 'team' = any(care) then return '중보기도팀'; end if;
  return '기도만';
end $$;

-- 말씀 카드 만들기
create or replace function _gd_card(cats text[], situation text, target text, title text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare vcat text; v gd_verses; v_detail text; op gd_prayer_parts; mid gd_prayer_parts; cl gd_prayer_parts;
  parts text[] := '{}'; used int[] := '{}'; c text; ref text; tag text;
begin
  vcat := case when situation = '위기' then '마음·회복' else cats[1] end;
  select * into v from gd_verses where active and category = vcat order by random() limit 1;
  if not found then select * into v from gd_verses where active and category = '일반' order by random() limit 1; end if;
  v_detail := case situation when '수술·입원' then '수술·입원' when '일정 앞둠' then '일정' when '위기' then '위기' when '긴급' then '긴급' else '' end;

  select * into op from gd_prayer_parts where active and part = '부름' and category in (cats[1], '공통') order by random() limit 1;
  if found then parts := parts || op.text; used := used || op.id; end if;

  foreach c in array (case when situation = '위기' then array['마음·회복'] || cats else cats end)[1:2] loop
    mid := null;
    if v_detail <> '' then
      select * into mid from gd_prayer_parts where active and part = '간구' and category = c and detail = v_detail
        and not (id = any(used)) order by random() limit 1;
      if mid.id is null then
        select * into mid from gd_prayer_parts where active and part = '간구' and category = '공통' and detail = v_detail
          and not (id = any(used)) order by random() limit 1;
      end if;
    end if;
    if mid.id is null then
      select * into mid from gd_prayer_parts where active and part = '간구' and category = c and detail = ''
        and not (id = any(used)) order by random() limit 1;
    end if;
    if mid.id is null then
      select * into mid from gd_prayer_parts where active and part = '간구' and category = '일반' and detail = ''
        and not (id = any(used)) order by random() limit 1;
    end if;
    if mid.id is not null then parts := parts || mid.text; used := used || mid.id; end if;
  end loop;

  select * into cl from gd_prayer_parts where active and part = '맺음' and category = cats[1] order by random() limit 1;
  if not found then select * into cl from gd_prayer_parts where active and part = '맺음' and category = '공통' order by random() limit 1; end if;
  if found then parts := parts || cl.text; used := used || cl.id; end if;

  update gd_prayer_parts set uses = uses + 1 where id = any(used);
  if v.id is not null then update gd_verses set uses = uses + 1 where id = v.id; end if;
  ref := case when v.id is null then '시편 23:1' else v.book || ' ' || v.chapter || ':' || v.v_start ||
         case when v.v_end > v.v_start then '-' || v.v_end else '' end end;
  select coalesce(nullif(gd_categories.tag,''), '#동행하시는_하나님') into tag from gd_categories where name = cats[1];
  return jsonb_build_object(
    'title', title, 'tag', coalesce(tag, '#동행하시는_하나님'), 'category', array_to_string(cats, ' · '),
    'verse', coalesce(v.text, '여호와는 나의 목자시니 내게 부족함이 없으리로다'), 'ref', ref,
    'prayer', _gd_fill(array_to_string(parts, ' '), target),
    'date', to_char(now() at time zone 'Asia/Seoul', 'YYYY. FMMM. FMDD.'));
end $$;

-- ───────────── 공개 함수 (성도 앱) ─────────────

-- 화면 설정
create or replace function gd_public_config() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'church', _gd_set('church'), 'title', _gd_set('title'), 'subtitle', _gd_set('subtitle'), 'maker', _gd_set('maker'),
    'consent', _gd_set('consent'), 'consent_sensitive', _gd_set('consent_sensitive'),
    'crisis', _gd_set('crisis'), 'translation', _gd_set('translation'),
    'parishes', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'youth', youth) order by sort)
                          from gd_parishes where active), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'icon', icon, 'grp', grp, 'mode', mode, 'dated', dated) order by sort)
                            from gd_categories where active), '[]'))
$$;

-- 기도제목 보내기
create or replace function gd_submit(p jsonb) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_name text := _gd_clean(p->>'name', 30);
  v_phone text := regexp_replace(_gd_clean(p->>'phone', 20), '[^0-9+\- ]', '', 'g');
  v_content text := _gd_clean(p->>'content', 2000);
  v_rel text := case when p->>'for_whom' = 'other' then _gd_clean(p->>'relation', 30) else '' end;
  v_minor boolean := coalesce((p->>'is_minor')::boolean, false);
  v_urgent boolean := coalesce((p->>'urgent')::boolean, false);
  v_scope text := case when p->>'scope' in ('staff','team','anon') then p->>'scope' else 'staff' end;
  v_time text := _gd_clean(p->>'contact_time', 10);
  v_choice text := _gd_clean(p->>'parish_choice', 20);
  v_cats text[]; v_care text[]; v_date date; v_parish gd_parishes; v_crisis boolean; v_sit text; r gd_rules;
  v_first date; v_status text; v_receipt text; v_card jsonb; v_id bigint; v_ip text := _gd_ip(); v_iph text; v_title text; v_target text;
begin
  if coalesce(p->>'website','') <> '' then return jsonb_build_object('ok', true); end if;   -- 스팸 함정
  if v_name = '' then raise exception '성함(또는 별명)을 입력해 주세요.'; end if;
  if v_content = '' then raise exception '기도제목을 입력해 주세요.'; end if;
  if not coalesce((p->>'consent')::boolean, false) or not coalesce((p->>'consent_sensitive')::boolean, false) then
    raise exception '개인정보 수집·이용과 민감정보 처리에 동의해 주셔야 보낼 수 있습니다.'; end if;
  if v_minor then v_phone := ''; elsif length(regexp_replace(v_phone, '\D', '', 'g')) < 9 then
    raise exception '연락처를 정확히 입력해 주세요.'; end if;

  if v_ip is not null then
    v_iph := _gd_hash(v_ip || _gd_set('salt'));
    if (select count(*) from gd_prayers where ip_hash = v_iph and created_at > now() - interval '10 minutes') >= 6 then
      raise exception '잠시 후 다시 보내 주세요.'; end if;
  end if;

  select coalesce(array_agg(c.name order by c.sort), '{}') into v_cats
    from gd_categories c where c.active and c.name in (select jsonb_array_elements_text(coalesce(p->'categories','[]')));
  v_cats := v_cats[1:2];
  if array_length(v_cats, 1) is null then v_cats := array['기타']; end if;
  select coalesce(array_agg(x), '{}') into v_care from jsonb_array_elements_text(coalesce(p->'care','[]')) x
   where x in ('pray','call','meet','visit','team');
  if array_length(v_care, 1) is null then v_care := array['pray']; end if;
  begin v_date := nullif(p->>'important_date','')::date; exception when others then v_date := null; end;

  select * into v_parish from gd_parishes where code = p->>'parish' and active;
  v_crisis := v_content ~ '죽고\s*싶|자살|극단적\s*(선택|생각)|살고\s*싶지\s*않|살기\s*싫|사라지고\s*싶|자해|목숨을\s*끊|생을\s*마감';
  v_sit := _gd_situation(v_cats, v_care, v_content, v_date is not null, v_urgent, v_crisis);
  select * into r from gd_rules where situation = v_sit;
  if not found then select * into r from gd_rules where situation = '기도만'; end if;
  if r.first_days is not null then
    v_first := case when r.base = '중요한 날짜' and v_date is not null then v_date + r.first_days
                    else _gd_today() + case when r.base = '중요한 날짜' then 1 else r.first_days end end;
    if v_first < _gd_today() then v_first := _gd_today(); end if;
  end if;
  v_status := case when v_parish.id is null then 'new' else 'assigned' end;

  v_target := _gd_target(v_name, v_rel);
  v_title := case when v_rel <> '' then v_target || _gd_josa(v_target, '을') || ' 위한 말씀과 기도' else v_name || ' 님을 위한 말씀과 기도' end;
  v_card := _gd_card(v_cats, v_sit, v_target, v_title) || jsonb_build_object('care', r.message);
  v_receipt := encode(gen_random_bytes(16), 'hex');

  insert into gd_prayers(receipt_hash, parish_id, parish_choice, via_link, name, phone, is_minor, for_whom, relation, categories, content,
    important_date, care, contact_time, scope, urgent, crisis, situation, priority, status, first_due, next_due, card, ip_hash)
  values (_gd_hash(v_receipt), v_parish.id, coalesce(nullif(v_choice,''), v_parish.name, ''), coalesce((p->>'via_link')::boolean, false),
    v_name, v_phone, v_minor, case when v_rel <> '' then 'other' else 'self' end, v_rel, v_cats, v_content,
    v_date, v_care, v_time, v_scope, v_urgent, v_crisis, v_sit, r.priority, v_status, v_first, v_first, v_card, v_iph)
  returning id into v_id;
  insert into gd_events(prayer_id, kind, note) values (v_id, 'submit', v_sit || ' · ' || r.priority || coalesce(' · ' || v_parish.name, ' · 배정 대기'));
  perform _gd_notify(v_id, 'new');

  return jsonb_build_object('ok', true, 'receipt', v_receipt, 'card', v_card, 'parish', v_parish.name,
    'crisis', case when v_crisis then jsonb_build_object('message', _gd_set('crisis')) else null end);
end $$;

-- 내 기도제목 (휴대폰에 저장된 접수증으로만 조회)
create or replace function gd_my(receipts text[]) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'receipt_hash', p.receipt_hash, 'created_at', p.created_at, 'categories', p.categories, 'content', left(p.content, 80),
      'status', case p.status when 'new' then '접수되었어요' when 'assigned' then '담당 목회자에게 전달되었어요'
                when 'contacted' then '목회자가 연락드렸어요' else '함께 기도를 마쳤어요' end,
      'prayed', p.prayed_count, 'answered', p.answered, 'card', p.card) order by p.created_at desc), '[]')
  from gd_prayers p where p.receipt_hash = any(select _gd_hash(x) from unnest(receipts[1:30]) x) and not p.purged
$$;

create or replace function gd_my_update(receipt text, action text, note text default '') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare p gd_prayers;
begin
  select * into p from gd_prayers where receipt_hash = _gd_hash(receipt) and not purged;
  if not found then raise exception '찾을 수 없습니다.'; end if;
  if action = 'answered' then
    update gd_prayers set answered = true, member_note = _gd_clean(note, 500) where id = p.id;
    insert into gd_events(prayer_id, kind, note) values (p.id, 'member', '성도: 기도가 응답되었어요' || coalesce(nullif(' — ' || _gd_clean(note, 500), ' — '), ''));
  elsif action = 'withdraw' then
    update gd_prayers set name = '(성도 요청으로 삭제)', phone = '', relation = '', content = '(성도 요청으로 내용을 삭제했습니다)',
      member_note = '', card = null, purged = true, status = 'closed', closed_at = now(), next_due = null where id = p.id;
    insert into gd_events(prayer_id, kind, note) values (p.id, 'member', '성도가 삭제를 요청했습니다');
  else raise exception '알 수 없는 요청입니다.';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── 사역자 로그인 ─────────────
create or replace function gd_login(p_name text, p_code text) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare nm text := _gd_clean(p_name, 30); cd text := regexp_replace(coalesce(p_code,''), '\D', '', 'g'); v_ip text := coalesce(_gd_ip(), '');
  s gd_staff; tok text; found_one boolean := false;
begin
  if (select count(*) from gd_attempts where name = nm and not ok and at > now() - interval '15 minutes') >= 5
     or (v_ip <> '' and (select count(*) from gd_attempts a where a.ip = v_ip and not ok and at > now() - interval '15 minutes') >= 20) then
    return jsonb_build_object('error', '여러 번 틀려서 잠시 잠겼습니다. 15분 뒤에 다시 시도해 주세요.');
  end if;
  for s in select * from gd_staff where name = nm and active loop
    if s.code_hash = crypt(cd, s.code_hash) then found_one := true; exit; end if;
  end loop;
  insert into gd_attempts(name, ip, ok) values (nm, v_ip, found_one);
  -- 오류를 내면 시도 기록까지 취소되므로, 틀린 경우에는 기록을 남기고 안내만 돌려줍니다 (잠금이 작동하도록)
  if not found_one then return jsonb_build_object('error', '이름 또는 코드가 맞지 않습니다.'); end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into gd_sessions(token_hash, staff_id, expires_at) values (_gd_hash(tok), s.id, now() + interval '180 days');
  update gd_staff set last_login = now() where id = s.id;
  if _gd_set('last_purge') <> _gd_today()::text then perform _gd_purge(); end if;
  return jsonb_build_object('token', tok, 'staff', gd_me(tok));
end $$;

create or replace function gd_me(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token);
begin
  return jsonb_build_object('id', s.id, 'name', s.name, 'title', s.title, 'role', s.role, 'parish_ids', to_jsonb(s.parish_ids),
    'parishes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name) order by sort)
                          from gd_parishes where id = any(s.parish_ids)), '[]'),
    'all_parishes', case when s.role = 'admin' then coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'youth', youth, 'active', active) order by sort) from gd_parishes), '[]') end,
    'church', _gd_set('church'), 'title_app', _gd_set('title'), 'app_url', _gd_set('app_url'));
end $$;

create or replace function gd_logout(p_token text) returns jsonb language sql volatile security definer set search_path = public as $$
  delete from gd_sessions where token_hash = _gd_hash(p_token);
  select jsonb_build_object('ok', true);
$$;

-- ───────────── 사역자: 기도제목 보기·돌보기 ─────────────
create or replace function _gd_row(s gd_staff, p gd_prayers) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare masked boolean := s.role = 'team'; nm text;
begin
  nm := case when not masked then p.name when p.scope = 'anon' then '익명' else left(p.name, 1) || repeat('○', greatest(char_length(p.name) - 1, 1)) end;
  return jsonb_build_object(
    'id', p.id, 'created_at', p.created_at, 'name', nm, 'phone', case when masked then '' else p.phone end,
    'is_minor', p.is_minor, 'relation', p.relation, 'parish_id', p.parish_id,
    'parish', (select name from gd_parishes where id = p.parish_id), 'parish_choice', p.parish_choice,
    'categories', p.categories, 'content', p.content, 'important_date', p.important_date, 'care', p.care,
    'contact_time', p.contact_time, 'scope', p.scope, 'urgent', p.urgent, 'crisis', p.crisis, 'situation', p.situation,
    'priority', p.priority, 'status', p.status, 'status_label', _gd_status_label(p.status), 'needs_review', p.needs_review,
    'next_due', p.next_due, 'last_contact', p.last_contact, 'prayed_count', p.prayed_count, 'answered', p.answered,
    'member_note', case when masked then '' else p.member_note end, 'purged', p.purged,
    'prayed_today', exists(select 1 from gd_events e where e.prayer_id = p.id and e.staff_id = s.id and e.kind = 'prayed'
                           and (e.created_at at time zone 'Asia/Seoul')::date = _gd_today()));
end $$;

create or replace function gd_list(p_token text, f jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); v text := coalesce(f->>'view', 'active'); q text := _gd_clean(f->>'q', 40);
  par int := nullif(f->>'parish_id','')::int; res jsonb;
begin
  select coalesce(jsonb_agg(_gd_row(s, p) order by
           (p.priority = '긴급' and p.status <> 'closed') desc, p.needs_review desc,
           case when v = 'today' then p.next_due end asc nulls last, p.created_at desc), '[]')
    into res
    from (select * from gd_prayers p0 where _gd_can_see(s, p0)
      and (case v
        when 'inbox' then p0.parish_id is null and p0.status <> 'closed'
        when 'new' then p0.status in ('new','assigned') and not exists(select 1 from gd_events e where e.prayer_id = p0.id and e.kind in ('prayed','contacted','memo') )
        when 'active' then p0.status <> 'closed'
        when 'today' then p0.status <> 'closed' and p0.next_due <= _gd_today()
        when 'closed' then p0.status = 'closed'
        when 'urgent' then p0.status <> 'closed' and p0.priority in ('긴급','높음')
        else true end)
      and (par is null or p0.parish_id = par)
      and (f->>'status' is null or f->>'status' = '' or p0.status = f->>'status')
      and (q = '' or p0.name ilike '%' || q || '%' or p0.content ilike '%' || q || '%')
      order by p0.created_at desc limit coalesce(nullif(f->>'limit','')::int, 300)) p;
  return res;
end $$;

create or replace function gd_counts(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token);
begin
  return (select jsonb_build_object(
    'new', count(*) filter (where status in ('new','assigned') and not exists(select 1 from gd_events e where e.prayer_id = p.id and e.kind in ('prayed','contacted','memo'))),
    'active', count(*) filter (where status <> 'closed'),
    'today', count(*) filter (where status <> 'closed' and next_due <= _gd_today()),
    'inbox', count(*) filter (where parish_id is null and status <> 'closed'),
    'urgent', count(*) filter (where status <> 'closed' and priority in ('긴급','높음')),
    'closed', count(*) filter (where status = 'closed'))
   from gd_prayers p where _gd_can_see(s, p));
end $$;

create or replace function gd_get(p_token text, p_id bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); p gd_prayers;
begin
  select * into p from gd_prayers where id = p_id;
  if not found or not _gd_can_see(s, p) then raise exception '볼 수 없는 기도제목입니다.'; end if;
  return _gd_row(s, p) || jsonb_build_object('events',
    case when s.role = 'team' then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object('at', created_at, 'who', staff_name, 'kind', kind, 'note', note) order by created_at desc)
              from gd_events where prayer_id = p.id), '[]') end);
end $$;

create or replace function gd_pray(p_token text, p_id bigint) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); p gd_prayers; n int;
begin
  select * into p from gd_prayers where id = p_id;
  if not found or not _gd_can_see(s, p) then raise exception '볼 수 없는 기도제목입니다.'; end if;
  if not exists(select 1 from gd_events e where e.prayer_id = p.id and e.staff_id = s.id and e.kind = 'prayed'
                and (e.created_at at time zone 'Asia/Seoul')::date = _gd_today()) then
    update gd_prayers set prayed_count = prayed_count + 1 where id = p.id returning prayed_count into n;
    perform _gd_event(p.id, s, 'prayed', '');
  else n := p.prayed_count; end if;
  return jsonb_build_object('prayed_count', n, 'prayed_today', true);
end $$;

create or replace function gd_set_status(p_token text, p_id bigint, p_status text, p_note text default '') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); p gd_prayers; r gd_rules; nt text := _gd_clean(p_note, 1000);
begin
  perform _gd_require(s, array['admin','pastor']);
  select * into p from gd_prayers where id = p_id;
  if not found or not _gd_can_see(s, p) then raise exception '볼 수 없는 기도제목입니다.'; end if;
  if p.purged and p_status <> 'closed' then raise exception '삭제된 기도제목입니다.'; end if;
  if p_status = 'contacted' then
    select * into r from gd_rules where situation = p.situation;
    update gd_prayers set status = 'contacted', last_contact = _gd_today(),
      next_due = case when r.follow_days is null then null else _gd_today() + r.follow_days end where id = p.id;
    perform _gd_event(p.id, s, 'contacted', coalesce(nullif(nt,''), '연락 완료') ||
      case when r.follow_days is not null then ' → ' || r.follow_days || '일 뒤 후속 확인' else '' end);
  elsif p_status = 'closed' then
    update gd_prayers set status = 'closed', closed_at = now(), next_due = null where id = p.id;
    perform _gd_event(p.id, s, 'status', '종결' || coalesce(nullif(' — ' || nt, ' — '), ''));
  elsif p_status = 'reopen' then
    update gd_prayers set status = case when parish_id is null then 'new' else 'assigned' end, closed_at = null,
      next_due = coalesce(next_due, _gd_today() + 7) where id = p.id;
    perform _gd_event(p.id, s, 'status', '다시 진행');
  else raise exception '알 수 없는 상태입니다.';
  end if;
  return gd_get(p_token, p_id);
end $$;

create or replace function gd_memo(p_token text, p_id bigint, p_note text) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); p gd_prayers; nt text := _gd_clean(p_note, 1000);
begin
  perform _gd_require(s, array['admin','pastor']);
  select * into p from gd_prayers where id = p_id;
  if not found or not _gd_can_see(s, p) then raise exception '볼 수 없는 기도제목입니다.'; end if;
  if nt = '' then raise exception '메모를 입력해 주세요.'; end if;
  perform _gd_event(p.id, s, 'memo', nt);
  return gd_get(p_token, p_id);
end $$;

-- 교구 목회자: 우리 교구가 아니에요 → 관리자 배정 대기함으로
create or replace function gd_transfer(p_token text, p_id bigint, p_note text default '') returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); p gd_prayers; old text;
begin
  perform _gd_require(s, array['admin','pastor']);
  select * into p from gd_prayers where id = p_id;
  if not found or not _gd_can_see(s, p) then raise exception '볼 수 없는 기도제목입니다.'; end if;
  select name into old from gd_parishes where id = p.parish_id;
  update gd_prayers set parish_id = null, needs_review = true, status = case when status = 'closed' then status else 'new' end where id = p.id;
  perform _gd_event(p.id, s, 'transfer', coalesce(old, '') || ' → 배정 대기' || coalesce(nullif(' — ' || _gd_clean(p_note, 500), ' — '), ''));
  perform _gd_notify(p.id, 'transfer');
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── 관리자 ─────────────
create or replace function gd_assign(p_token text, p_id bigint, p_parish int, p_note text default '') returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); nm text;
begin
  perform _gd_require(s, array['admin']);
  select name into nm from gd_parishes where id = p_parish;
  if nm is null then raise exception '교구를 골라 주세요.'; end if;
  update gd_prayers set parish_id = p_parish, needs_review = false,
    status = case when status = 'new' then 'assigned' else status end where id = p_id;
  if not found then raise exception '찾을 수 없습니다.'; end if;
  perform _gd_event(p_id, s, 'assign', nm || ' 배정' || coalesce(nullif(' — ' || _gd_clean(p_note, 500), ' — '), ''));
  perform _gd_notify(p_id, 'assign');
  return gd_get(p_token, p_id);
end $$;

create or replace function gd_stats(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token);
begin
  perform _gd_require(s, array['admin']);
  return jsonb_build_object(
    'total', (select count(*) from gd_prayers),
    'month', (select count(*) from gd_prayers where created_at > now() - interval '30 days'),
    'open', (select count(*) from gd_prayers where status <> 'closed'),
    'inbox', (select count(*) from gd_prayers where parish_id is null and status <> 'closed'),
    'urgent', (select count(*) from gd_prayers where status <> 'closed' and priority in ('긴급','높음')),
    'overdue', (select count(*) from gd_prayers where status <> 'closed' and next_due < _gd_today()),
    'stale', (select count(*) from gd_prayers p where status = 'assigned' and created_at < now() - interval '3 days'
              and not exists(select 1 from gd_events e where e.prayer_id = p.id and e.kind in ('prayed','contacted','memo'))),
    'answered', (select count(*) from gd_prayers where answered),
    'prayed', (select coalesce(sum(prayed_count),0) from gd_prayers),
    'by_parish', coalesce((select jsonb_agg(x order by x->>'sort') from (
        select jsonb_build_object('name', pa.name, 'sort', lpad(pa.sort::text, 4, '0'),
          'open', count(p.*) filter (where p.status <> 'closed'),
          'today', count(p.*) filter (where p.status <> 'closed' and p.next_due <= _gd_today()),
          'month', count(p.*) filter (where p.created_at > now() - interval '30 days'),
          'closed', count(p.*) filter (where p.status = 'closed')) x
        from gd_parishes pa left join gd_prayers p on p.parish_id = pa.id group by pa.id) t), '[]'),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('name', c, 'n', n) order by n desc) from (
        select unnest(categories) c, count(*) n from gd_prayers where created_at > now() - interval '90 days' group by 1) t), '[]'));
end $$;

create or replace function gd_export(p_token text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token);
begin
  perform _gd_require(s, array['admin']);
  return coalesce((select jsonb_agg(jsonb_build_object(
    '번호', p.id, '접수일시', to_char(p.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), '교구', coalesce(pa.name, '배정 대기'),
    '성도가 고른 소속', p.parish_choice, '성함', p.name, '연락처', p.phone, '기도 대상', p.relation, '분야', array_to_string(p.categories, ', '),
    '기도제목', p.content, '중요한 날짜', p.important_date, '돌봄 요청', array_to_string(p.care, ', '), '공유 범위', p.scope,
    '상황', p.situation, '우선순위', p.priority, '상태', _gd_status_label(p.status), '다음 연락일', p.next_due,
    '마지막 연락일', p.last_contact, '함께 기도', p.prayed_count, '응답', case when p.answered then 'Y' else '' end) order by p.id)
    from gd_prayers p left join gd_parishes pa on pa.id = p.parish_id
    where (p.created_at at time zone 'Asia/Seoul')::date between p_from and p_to), '[]');
end $$;

create or replace function gd_staff_list(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token);
begin
  perform _gd_require(s, array['admin']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'title', title, 'role', role,
     'parish_ids', to_jsonb(parish_ids), 'phone', phone, 'email', email, 'active', active, 'last_login', last_login,
     'me', id = s.id) order by active desc, case role when 'admin' then 0 when 'pastor' then 1 else 2 end, name) from gd_staff), '[]');
end $$;

create or replace function gd_staff_save(p_token text, p jsonb) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare s gd_staff := _gd_auth(p_token); v_id uuid := nullif(p->>'id','')::uuid; code text; v_role text := p->>'role';
  v_par int[]; v_active boolean := coalesce((p->>'active')::boolean, true);
begin
  perform _gd_require(s, array['admin']);
  if _gd_clean(p->>'name', 30) = '' then raise exception '이름을 입력해 주세요.'; end if;
  if v_role not in ('admin','pastor','team') then raise exception '역할을 골라 주세요.'; end if;
  select coalesce(array_agg(x::int), '{}') into v_par from jsonb_array_elements_text(coalesce(p->'parish_ids','[]')) x
   where x::int in (select id from gd_parishes);
  if v_role = 'pastor' and array_length(v_par, 1) is null then raise exception '담당 교구를 하나 이상 골라 주세요.'; end if;
  if v_id is null then
    code := _gd_new_code();
    insert into gd_staff(name, title, role, parish_ids, phone, email, code_hash)
    values (_gd_clean(p->>'name', 30), _gd_clean(p->>'title', 20), v_role, v_par, _gd_clean(p->>'phone', 20), _gd_clean(p->>'email', 80), crypt(code, gen_salt('bf', 8)))
    returning id into v_id;
  else
    if v_id = s.id and (v_role <> 'admin' or not v_active) then raise exception '내 계정의 관리자 권한은 해제할 수 없습니다.'; end if;
    update gd_staff set name = _gd_clean(p->>'name', 30), title = _gd_clean(p->>'title', 20), role = v_role, parish_ids = v_par,
      phone = _gd_clean(p->>'phone', 20), email = _gd_clean(p->>'email', 80), active = v_active where id = v_id;
    if not v_active then delete from gd_sessions where staff_id = v_id; end if;
  end if;
  return jsonb_build_object('id', v_id, 'code', code);
end $$;

create or replace function gd_staff_reset(p_token text, p_id uuid) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare s gd_staff := _gd_auth(p_token); code text := _gd_new_code();
begin
  perform _gd_require(s, array['admin']);
  update gd_staff set code_hash = crypt(code, gen_salt('bf', 8)) where id = p_id;
  if not found then raise exception '찾을 수 없습니다.'; end if;
  delete from gd_sessions where staff_id = p_id;
  return jsonb_build_object('id', p_id, 'code', code);
end $$;

create or replace function gd_settings_get(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token);
begin
  perform _gd_require(s, array['admin']);
  return (select jsonb_object_agg(key, value) from gd_settings where key not in ('salt','last_purge'));
end $$;

create or replace function gd_settings_save(p_token text, p jsonb) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); k text;
begin
  perform _gd_require(s, array['admin']);
  for k in select jsonb_object_keys(p) loop
    if k in ('church','title','subtitle','maker','consent','consent_sensitive','crisis','translation','retention_days',
             'notify_url','notify_secret','notify_level','app_url') then
      insert into gd_settings(key, value) values (k, _gd_clean(p->>k, 3000))
      on conflict (key) do update set value = excluded.value;
    end if;
  end loop;
  return gd_settings_get(p_token);
end $$;

create or replace function gd_parish_save(p_token text, p jsonb) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); v_id int := nullif(p->>'id','')::int;
begin
  perform _gd_require(s, array['admin']);
  if _gd_clean(p->>'name', 20) = '' or coalesce(p->>'code','') !~ '^[a-z0-9]{1,12}$' then
    raise exception '교구 이름과 링크 코드(영문 소문자·숫자)를 입력해 주세요.'; end if;
  if v_id is null then
    insert into gd_parishes(code, name, sort, youth, active)
    values (p->>'code', _gd_clean(p->>'name', 20), coalesce((p->>'sort')::int, 99), coalesce((p->>'youth')::boolean, false), true);
  else
    update gd_parishes set code = p->>'code', name = _gd_clean(p->>'name', 20), sort = coalesce((p->>'sort')::int, sort),
      youth = coalesce((p->>'youth')::boolean, youth), active = coalesce((p->>'active')::boolean, active) where id = v_id;
  end if;
  return gd_me(p_token);
end $$;

-- 처음 한 번: 첫 관리자 만들기 (SQL Editor 에서만 실행 가능)
create or replace function gd_bootstrap(p_name text, p_title text default '') returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare code text := _gd_new_code();
begin
  if exists(select 1 from gd_staff where role = 'admin' and active) then
    raise exception '이미 관리자가 있습니다. 관리자 화면의 「사역자」에서 추가해 주세요.'; end if;
  insert into gd_staff(name, title, role, code_hash) values (p_name, coalesce(p_title,''), 'admin', crypt(code, gen_salt('bf', 8)));
  return '관리자 「' || p_name || '」 코드: ' || substr(code, 1, 4) || '-' || substr(code, 5, 4) || '  (이 코드는 다시 볼 수 없으니 적어 두세요)';
end $$;

-- 처음 한 번: 기본 설정값
insert into gd_settings(key, value) values
  ('church', '할렐루야교회'), ('title', '365 기도동행'), ('subtitle', '할렐루야교회 중보기도팀'), ('maker', 'AI목양지원센터'),
  ('consent', '수집 항목: 성함, 연락처, 소속, 기도제목' || chr(10) || '이용 목적: 기도와 목회적 돌봄(연락·심방)' || chr(10) ||
              '보관 기간: 돌봄 종결 후 1년, 이후 내용 삭제' || chr(10) || '열람 범위: 담당 교구 목회자와 중보기도 관리자' || chr(10) ||
              '동의하지 않으시면 접수할 수 없습니다.'),
  ('consent_sensitive', '기도제목에는 건강·가정 등 민감한 내용이 담길 수 있습니다. 이 내용은 기도와 목회적 돌봄에만 쓰이며, ' ||
              '공유 범위에서 허락하신 경우에만 중보기도팀과 나눕니다.'),
  ('crisis', '자살예방상담전화 109 (24시간)'), ('translation', '개역개정'), ('retention_days', '365'),
  ('notify_url', ''), ('notify_secret', ''), ('notify_level', 'all'), ('app_url', ''),
  ('salt', encode(extensions.gen_random_bytes(16), 'hex')), ('last_purge', '')
on conflict (key) do nothing;

-- ───────────── 권한: 웹에서 부를 수 있는 함수만 열기 ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'gd\_%' or p.proname like '\_gd\_%') loop
    execute format('revoke all on function %s from public', f.sig);
    begin execute format('revoke all on function %s from anon, authenticated', f.sig); exception when undefined_object then null; end;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('gd_public_config','gd_submit','gd_my','gd_my_update','gd_login','gd_me','gd_logout',
             'gd_list','gd_counts','gd_get','gd_pray','gd_set_status','gd_memo','gd_transfer','gd_assign','gd_stats','gd_export',
             'gd_staff_list','gd_staff_save','gd_staff_reset','gd_settings_get','gd_settings_save','gd_parish_save') loop
    begin execute format('grant execute on function %s to anon, authenticated', f.sig); exception when undefined_object then null; end;
  end loop;
end $$;
