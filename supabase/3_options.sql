-- ════════════════════════════════════════════════════════════════
--  365 기도동행 · 선택지 관리 추가  (v2.1)
--  만든 곳: AI목양지원센터 (mokyangdesk.com)
--
--  관리자가 성도 앱의 아래 세 가지를 직접 넣고 빼고 순서를 바꿀 수 있게 합니다.
--   · 어떤 돌봄을 원하시나요?   (gd_options, kind = 'care')
--   · 기도제목 공유 범위         (gd_options, kind = 'scope')
--   · 기도 분야                  (gd_categories)
--
--  1_schema.sql, 2_seed.sql 을 실행한 다음에 이 파일을 실행하세요.
--  이미 쓰고 있는 앱에도 그대로 실행하면 됩니다. 여러 번 실행해도 안전하고,
--  기존 기도제목은 바뀌거나 지워지지 않습니다.
--
--  보안 원칙은 그대로입니다.
--   · 새 선택지는 반드시 기존 '처리 방식' 가운데 하나를 고릅니다.
--     돌봄: 기도만 / 전화 / 만나서 / 심방 / 중보기도팀
--     공유: 담당 목회자만 / 중보기도팀과 함께(이름 가림) / 이름 없이(익명)
--   · 그래서 열람 권한과 우선순위·연락 기한 계산 규칙은 바뀌지 않습니다.
-- ════════════════════════════════════════════════════════════════

-- ───────────── 표 ─────────────
create table if not exists gd_options (
  id serial primary key,
  kind text not null check (kind in ('care','scope')),
  code text not null,                 -- 기도제목에 저장되는 값 (기본 항목은 pray, call … / 새 항목은 c12 처럼 자동)
  label text not null,                -- 성도 화면에 보이는 글자
  icon text not null default '',
  base text not null,                 -- 처리 방식
  sort int not null default 0,
  active boolean not null default true,
  unique (kind, code),
  check ((kind = 'care' and base in ('pray','call','meet','visit','team'))
      or (kind = 'scope' and base in ('staff','team','anon')))
);
alter table gd_options enable row level security;
revoke all on table gd_options from public;
do $$ begin execute 'revoke all on table gd_options from anon, authenticated'; exception when undefined_object then null; end $$;

-- 자동 판단에 쓰이는 분야 표시 (이름을 바꿔도 우선순위 판단이 그대로 되도록)
alter table gd_categories add column if not exists special text not null default '';
update gd_categories set special = 'health' where name = '건강·치유' and special = '';
update gd_categories set special = 'loss'   where name = '상실·애도' and special = '';
update gd_categories set special = 'thanks' where name = '감사·응답' and special = '';

-- 기본 선택지 (지금 화면과 똑같이)
insert into gd_options(kind, code, label, icon, base, sort) values
  ('care',  'pray',  '기도만 부탁해요',            '🙏', 'pray',  1),
  ('care',  'call',  '전화로 기도해 주세요',        '📞', 'call',  2),
  ('care',  'meet',  '만나서 기도하고 싶어요',      '☕', 'meet',  3),
  ('care',  'visit', '심방(가정·병원)을 원해요',    '🏠', 'visit', 4),
  ('care',  'team',  '중보기도팀도 함께해 주세요',  '🤝', 'team',  5),
  ('scope', 'staff', '담당 목회자만',               '',   'staff', 1),
  ('scope', 'team',  '중보기도팀과 함께',           '',   'team',  2),
  ('scope', 'anon',  '이름 없이 내용만',            '',   'anon',  3)
on conflict (kind, code) do nothing;

-- ───────────── 내부 도우미 ─────────────
create or replace function _gd_options_json(only_active boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'care',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'label', label, 'icon', icon, 'base', base, 'sort', sort, 'active', active) order by sort, id)
                       from gd_options where kind = 'care'  and (active or not only_active)), '[]'),
    'scope', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'label', label, 'icon', icon, 'base', base, 'sort', sort, 'active', active) order by sort, id)
                       from gd_options where kind = 'scope' and (active or not only_active)), '[]'))
$$;

-- 상황 판단: 분야 이름 대신 special 표시로 판단 (care 에는 처리 방식 값이 들어옵니다)
create or replace function _gd_situation(cats text[], care text[], txt text, has_date boolean, urgent boolean, crisis boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare all_list boolean; has_dated boolean; sp text[];
begin
  if crisis then return '위기'; end if;
  if urgent then return '긴급'; end if;
  select bool_and(mode = 'list'), bool_or(dated), coalesce(array_agg(special) filter (where special <> ''), '{}')
    into all_list, has_dated, sp from gd_categories where name = any(cats);
  if 'health' = any(sp) and (has_date or txt ~ '수술|입원|시술|항암|투석|중환자|응급') then return '수술·입원'; end if;
  if 'loss' = any(sp) then return '상실·애도'; end if;
  if 'visit' = any(care) then return '방문 심방'; end if;
  if 'meet' = any(care) then return '만나서 기도'; end if;
  if 'call' = any(care) then return '전화 기도'; end if;
  if has_date and coalesce(has_dated, false) then return '일정 앞둠'; end if;
  if coalesce(all_list, false) then return '공동체 기도'; end if;
  if array_length(cats, 1) = 1 and sp = array['thanks'] then return '감사'; end if;
  if 'team' = any(care) then return '중보기도팀'; end if;
  return '기도만';
end $$;

-- ───────────── 공개 함수 (성도 앱) ─────────────
create or replace function gd_public_config() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'church', _gd_set('church'), 'title', _gd_set('title'), 'subtitle', _gd_set('subtitle'), 'maker', _gd_set('maker'),
    'consent', _gd_set('consent'), 'consent_sensitive', _gd_set('consent_sensitive'),
    'crisis', _gd_set('crisis'), 'translation', _gd_set('translation'),
    'parishes', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'youth', youth) order by sort)
                          from gd_parishes where active), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'icon', icon, 'grp', grp, 'mode', mode, 'dated', dated) order by sort, id)
                            from gd_categories where active), '[]'),
    'options', _gd_options_json(true))
$$;

-- 기도제목 보내기 (돌봄·공유 범위를 관리자 선택지로 확인)
create or replace function gd_submit(p jsonb) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_name text := _gd_clean(p->>'name', 30);
  v_phone text := regexp_replace(_gd_clean(p->>'phone', 20), '[^0-9+\- ]', '', 'g');
  v_content text := _gd_clean(p->>'content', 2000);
  v_rel text := case when p->>'for_whom' = 'other' then _gd_clean(p->>'relation', 30) else '' end;
  v_minor boolean := coalesce((p->>'is_minor')::boolean, false);
  v_urgent boolean := coalesce((p->>'urgent')::boolean, false);
  v_scope text;
  v_time text := _gd_clean(p->>'contact_time', 10);
  v_choice text := _gd_clean(p->>'parish_choice', 20);
  v_cats text[]; v_care text[]; v_care_base text[]; v_date date; v_parish gd_parishes; v_crisis boolean; v_sit text; r gd_rules;
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

  select coalesce(array_agg(c.name order by c.sort, c.id), '{}') into v_cats
    from gd_categories c where c.active and c.name in (select jsonb_array_elements_text(coalesce(p->'categories','[]')));
  v_cats := v_cats[1:2];
  if array_length(v_cats, 1) is null then v_cats := array['기타']; end if;

  -- 돌봄: 사용 중인 선택지만 받고, 처리 방식으로 바꿔서 판단합니다
  select coalesce(array_agg(o.code order by o.sort, o.id), '{}'), coalesce(array_agg(distinct o.base), '{}') into v_care, v_care_base
    from gd_options o where o.kind = 'care' and o.active and o.code in (select jsonb_array_elements_text(coalesce(p->'care','[]')));
  if array_length(v_care, 1) is null then
    select array[code], array[base] into v_care, v_care_base from gd_options where kind = 'care' and active and base = 'pray' order by sort, id limit 1;
    if v_care is null then v_care := array['pray']; v_care_base := array['pray']; end if;
  end if;

  -- 공유 범위: 고른 선택지의 처리 방식을 저장합니다 (열람 권한은 이 값으로만 정해집니다)
  select base into v_scope from gd_options where kind = 'scope' and active and code = p->>'scope';
  if v_scope is null then
    select base into v_scope from gd_options where kind = 'scope' and active order by sort, id limit 1;
  end if;
  v_scope := coalesce(v_scope, 'staff');

  begin v_date := nullif(p->>'important_date','')::date; exception when others then v_date := null; end;

  select * into v_parish from gd_parishes where code = p->>'parish' and active;
  v_crisis := v_content ~ '죽고\s*싶|자살|극단적\s*(선택|생각)|살고\s*싶지\s*않|살기\s*싫|사라지고\s*싶|자해|목숨을\s*끊|생을\s*마감';
  v_sit := _gd_situation(v_cats, v_care_base, v_content, v_date is not null, v_urgent, v_crisis);
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

-- ───────────── 사역자: 선택지 이름표 (목회자 화면에 표시용, 숨긴 항목 포함) ─────────────
create or replace function gd_options_all(p_token text) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token);
begin
  return _gd_options_json(false) || jsonb_build_object('categories',
    case when s.role = 'admin' then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon, 'tag', c.tag, 'grp', c.grp,
        'mode', c.mode, 'dated', c.dated, 'special', c.special, 'sort', c.sort, 'active', c.active,
        'verses', (select count(*) from gd_verses v where v.category = c.name and v.active),
        'used', (select count(*) from gd_prayers p where c.name = any(p.categories))) order by c.sort, c.id) from gd_categories c), '[]')
    else '[]'::jsonb end);
end $$;

-- ───────────── 관리자: 선택지 관리 ─────────────
create or replace function gd_option_save(p_token text, p jsonb) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); v_id int := nullif(p->>'id','')::int; v_kind text := p->>'kind';
  v_label text := _gd_clean(p->>'label', 20); v_icon text := _gd_clean(p->>'icon', 4); v_base text := p->>'base'; v_sort int;
begin
  perform _gd_require(s, array['admin']);
  if v_kind not in ('care','scope') then raise exception '알 수 없는 종류입니다.'; end if;
  if v_label = '' then raise exception '보이는 이름을 입력해 주세요.'; end if;
  if v_kind = 'care' and coalesce(v_base,'') not in ('pray','call','meet','visit','team') then raise exception '처리 방식을 골라 주세요.'; end if;
  if v_kind = 'scope' and coalesce(v_base,'') not in ('staff','team','anon') then raise exception '처리 방식을 골라 주세요.'; end if;
  if exists(select 1 from gd_options where kind = v_kind and label = v_label and id is distinct from v_id) then
    raise exception '같은 이름의 선택지가 이미 있습니다.'; end if;
  if v_id is null then
    select coalesce(max(sort), 0) + 1 into v_sort from gd_options where kind = v_kind;
    insert into gd_options(kind, code, label, icon, base, sort, active)
    values (v_kind, 'tmp' || gen_random_uuid(), v_label, v_icon, v_base, v_sort, coalesce((p->>'active')::boolean, true))
    returning id into v_id;
    update gd_options set code = 'c' || v_id where id = v_id;
  else
    update gd_options set label = v_label, icon = v_icon, base = v_base, active = coalesce((p->>'active')::boolean, active)
     where id = v_id and kind = v_kind;
    if not found then raise exception '찾을 수 없습니다.'; end if;
  end if;
  return gd_options_all(p_token);
end $$;

create or replace function gd_option_delete(p_token text, p_id int) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); o gd_options;
begin
  perform _gd_require(s, array['admin']);
  select * into o from gd_options where id = p_id;
  if not found then raise exception '찾을 수 없습니다.'; end if;
  if o.kind = 'care' and exists(select 1 from gd_prayers where o.code = any(care)) then
    raise exception '이미 이 선택지로 들어온 기도제목이 있어서 지울 수 없습니다. 「숨기기」를 써 주세요.'; end if;
  delete from gd_options where id = p_id;
  return gd_options_all(p_token);
end $$;

create or replace function gd_category_save(p_token text, p jsonb) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); v_id int := nullif(p->>'id','')::int; old gd_categories;
  v_name text := _gd_clean(p->>'name', 12); v_grp text := coalesce(p->>'grp', '삶'); v_mode text := coalesce(p->>'mode', 'care'); v_sort int;
begin
  perform _gd_require(s, array['admin']);
  if v_name = '' then raise exception '분야 이름을 입력해 주세요.'; end if;
  if v_name in ('기타', '일반', '공통') then raise exception '「%」 이름은 앱이 내부에서 쓰고 있어서 쓸 수 없습니다.', v_name; end if;
  if v_grp not in ('삶','믿음','함께') then raise exception '묶음을 골라 주세요.'; end if;
  if v_mode not in ('care','list') then raise exception '돌봄 방식을 골라 주세요.'; end if;
  if exists(select 1 from gd_categories where name = v_name and id is distinct from v_id) then raise exception '같은 이름의 분야가 이미 있습니다.'; end if;
  if v_id is null then
    select coalesce(max(sort), 0) + 1 into v_sort from gd_categories;
    insert into gd_categories(name, icon, tag, grp, sort, mode, dated, active)
    values (v_name, _gd_clean(p->>'icon', 4), _gd_clean(p->>'tag', 30), v_grp, v_sort, v_mode, coalesce((p->>'dated')::boolean, false), coalesce((p->>'active')::boolean, true));
  else
    select * into old from gd_categories where id = v_id;
    if not found then raise exception '찾을 수 없습니다.'; end if;
    update gd_categories set name = v_name, icon = _gd_clean(p->>'icon', 4), tag = _gd_clean(p->>'tag', 30), grp = v_grp, mode = v_mode,
      dated = coalesce((p->>'dated')::boolean, dated), active = coalesce((p->>'active')::boolean, active) where id = v_id;
    if old.name <> v_name then   -- 이름을 바꾸면 그 분야의 말씀·기도문도 함께 따라갑니다
      update gd_verses set category = v_name where category = old.name;
      update gd_prayer_parts set category = v_name where category = old.name;
    end if;
  end if;
  return gd_options_all(p_token);
end $$;

create or replace function gd_category_delete(p_token text, p_id int) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); c gd_categories;
begin
  perform _gd_require(s, array['admin']);
  select * into c from gd_categories where id = p_id;
  if not found then raise exception '찾을 수 없습니다.'; end if;
  if c.special <> '' then raise exception '이 분야는 우선순위 자동 판단에 쓰여서 지울 수 없습니다. 「숨기기」를 써 주세요.'; end if;
  if exists(select 1 from gd_prayers where c.name = any(categories)) then
    raise exception '이미 이 분야로 들어온 기도제목이 있어서 지울 수 없습니다. 「숨기기」를 써 주세요.'; end if;
  if exists(select 1 from gd_verses where category = c.name) or exists(select 1 from gd_prayer_parts where category = c.name) then
    raise exception '이 분야에 연결된 말씀·기도문이 있어서 지울 수 없습니다. 「숨기기」를 써 주세요.'; end if;
  delete from gd_categories where id = p_id;
  return gd_options_all(p_token);
end $$;

-- 순서 바꾸기: 화면에서 정한 순서(id 목록) 그대로 저장
create or replace function gd_reorder(p_token text, p_kind text, p_ids int[]) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token); i int;
begin
  perform _gd_require(s, array['admin']);
  if p_kind not in ('care','scope','category') then raise exception '알 수 없는 종류입니다.'; end if;
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    if p_kind = 'category' then update gd_categories set sort = i where id = p_ids[i];
    else update gd_options set sort = i where id = p_ids[i] and kind = p_kind; end if;
  end loop;
  return gd_options_all(p_token);
end $$;

-- 엑셀 내려받기: 돌봄·공유 범위를 보이는 이름으로
create or replace function gd_export(p_token text, p_from date, p_to date) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s gd_staff := _gd_auth(p_token);
begin
  perform _gd_require(s, array['admin']);
  return coalesce((select jsonb_agg(jsonb_build_object(
    '번호', p.id, '접수일시', to_char(p.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), '교구', coalesce(pa.name, '배정 대기'),
    '성도가 고른 소속', p.parish_choice, '성함', p.name, '연락처', p.phone, '기도 대상', p.relation, '분야', array_to_string(p.categories, ', '),
    '기도제목', p.content, '중요한 날짜', p.important_date,
    '돌봄 요청', (select string_agg(coalesce(o.label, x), ', ' order by ord) from unnest(p.care) with ordinality u(x, ord)
                   left join gd_options o on o.kind = 'care' and o.code = u.x),
    '공유 범위', coalesce((select o.label from gd_options o where o.kind = 'scope' and o.base = p.scope order by o.active desc, o.sort limit 1), p.scope),
    '상황', p.situation, '우선순위', p.priority, '상태', _gd_status_label(p.status), '다음 연락일', p.next_due,
    '마지막 연락일', p.last_contact, '함께 기도', p.prayed_count, '응답', case when p.answered then 'Y' else '' end) order by p.id)
    from gd_prayers p left join gd_parishes pa on pa.id = p.parish_id
    where (p.created_at at time zone 'Asia/Seoul')::date between p_from and p_to), '[]');
end $$;

-- ───────────── 권한 ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'gd\_%' or p.proname like '\_gd\_%') loop
    execute format('revoke all on function %s from public', f.sig);
    begin execute format('revoke all on function %s from anon, authenticated', f.sig); exception when undefined_object then null; end;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('gd_public_config','gd_submit','gd_my','gd_my_update','gd_login','gd_me','gd_logout',
             'gd_list','gd_counts','gd_get','gd_pray','gd_set_status','gd_memo','gd_transfer','gd_assign','gd_stats','gd_export',
             'gd_staff_list','gd_staff_save','gd_staff_reset','gd_settings_get','gd_settings_save','gd_parish_save',
             'gd_options_all','gd_option_save','gd_option_delete','gd_category_save','gd_category_delete','gd_reorder') loop
    begin execute format('grant execute on function %s to anon, authenticated', f.sig); exception when undefined_object then null; end;
  end loop;
end $$;
