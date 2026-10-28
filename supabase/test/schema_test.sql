-- Prove dello schema: eseguire dopo mock_auth.sql e schema.sql (vedi tests/schema.test.js).
\set ON_ERROR_STOP 1
create extension if not exists pgcrypto;
-- "oggi" fisso per le finestre delle richieste (5 novembre 2026: aperte quelle di dicembre);
-- le prove lo spostano con set test.oggi.
create or replace function public.request_today() returns date language sql stable as $$
  select coalesce(nullif(current_setting('test.oggi', true), ''), '2026-11-05')::date
$$;
insert into public.units (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'U.T. Canal San Bovo'),
  ('22222222-2222-2222-2222-222222222222', 'U.T. Trento');

-- registrazione valida: crea il profilo con i dati del modulo
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Mario.Rossi@CRITN.it',
   '{"first_name":"Mario","last_name":"Rossi","unit_id":"11111111-1111-1111-1111-111111111111","role":"vice_referente"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'anna.verdi@critn.it',
   '{"first_name":"Anna","last_name":"Verdi","unit_id":"22222222-2222-2222-2222-222222222222","role":"referente"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'capo@critn.it', '{"first_name":"Capo","last_name":"Admin"}');
select 'profilo', email, first_name, last_name, role, unit_id is not null from public.profiles order by email;

-- dominio non consentito: deve fallire
do $$ begin
  insert into auth.users (email) values ('qualcuno@gmail.com');
  raise exception 'ERRORE: accettato un dominio non consentito';
exception when check_violation then raise notice 'OK dominio rifiutato';
end $$;
do $$ begin
  insert into auth.users (email) values ('finto@critn.it.evil.com');
  raise exception 'ERRORE: accettato un dominio falso';
exception when check_violation then raise notice 'OK dominio falso rifiutato';
end $$;

-- tutti in attesa dopo la registrazione
select 'in attesa', count(*) from public.profiles where not active and approved_at is null;  -- 3

-- un referente in attesa non vede né salva i turni
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  perform public.save_unit_data('11111111-1111-1111-1111-111111111111', '{}', 0);
  raise exception 'ERRORE: referente non approvato ha salvato';
exception when insufficient_privilege then raise notice 'OK referente in attesa bloccato';
end $$;
reset role;
reset request.jwt.claim.sub;

-- amministratore impostato dall'editor SQL (nessun utente collegato)
update public.profiles set is_admin = true, active = true, role = 'referente' where email = 'capo@critn.it';

-- l'amministratore approva i referenti e nomina un altro amministratore
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
-- chi si registra è sempre dipendente, anche se il modulo dice altro: il ruolo lo dà l'amministratore
select 'ruoli alla registrazione', string_agg(distinct role, ',') from public.profiles
  where email <> 'capo@critn.it';                                                   -- dipendente
update public.profiles set active = true, role = 'vice_referente' where email = 'mario.rossi@critn.it';
update public.profiles set active = true, role = 'referente' where email = 'anna.verdi@critn.it';
update public.profiles set is_admin = true where email = 'anna.verdi@critn.it';
reset role;
reset request.jwt.claim.sub;
select 'approvati', count(*) from public.profiles where active and approved_at is not null;   -- 3
select 'admin', string_agg(email, ',' order by email) from public.profiles where is_admin;    -- anna, capo
-- per le prove successive Anna torna referente semplice (glielo toglie un amministratore)
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
update public.profiles set is_admin = false where email = 'anna.verdi@critn.it';
reset role;
reset request.jwt.claim.sub;

grant usage on schema public to authenticated;

-- ===== come Mario (unità Canal San Bovo) =====
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'mario vede profili', count(*) from public.profiles;           -- 1 (solo il suo)
select 'mario salva v1', public.save_unit_data('11111111-1111-1111-1111-111111111111', '{"employees":[]}', 0);
select 'mario salva v2', public.save_unit_data('11111111-1111-1111-1111-111111111111', '{"employees":[1]}', 1);
do $$ begin
  perform public.save_unit_data('11111111-1111-1111-1111-111111111111', '{"x":1}', 1);
  raise exception 'ERRORE: conflitto non rilevato';
exception when serialization_failure then raise notice 'OK conflitto rilevato';
end $$;
do $$ begin
  perform public.save_unit_data('22222222-2222-2222-2222-222222222222', '{}', 0);
  raise exception 'ERRORE: scrittura su altra unità';
exception when insufficient_privilege then raise notice 'OK altra unità negata';
end $$;
do $$ begin
  update public.profiles set role = 'referente' where id = auth.uid();
  raise exception 'ERRORE: utente ha cambiato il proprio ruolo';
exception when insufficient_privilege then raise notice 'OK ruolo protetto';
end $$;
do $$ begin
  update public.profiles set is_admin = true where id = auth.uid();
  raise exception 'ERRORE: utente si è nominato amministratore';
exception when insufficient_privilege then raise notice 'OK amministratore protetto';
end $$;
update public.profiles set first_name = 'Marione' where id = auth.uid();
do $$ begin
  insert into public.units (name) values ('Unità abusiva');
  raise exception 'ERRORE: utente normale ha creato un''unità';
exception when insufficient_privilege then raise notice 'OK unità protette';
end $$;
do $$ begin
  insert into public.unit_data (unit_id, data) values ('22222222-2222-2222-2222-222222222222', '{}');
  raise exception 'ERRORE: scrittura diretta su unit_data';
exception when insufficient_privilege then raise notice 'OK scrittura diretta negata';
end $$;
reset role;
reset request.jwt.claim.sub;

-- ===== come Anna (altra unità): non vede i turni di Canal San Bovo =====
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select 'anna vede turni di altre unita', count(*) from public.unit_data;  -- 0
reset role;
reset request.jwt.claim.sub;

-- ===== utente disattivato: perde l'accesso ai turni =====
update public.profiles set active = false where email = 'mario.rossi@critn.it';
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'mario disattivato vede turni', count(*) from public.unit_data;     -- 0
reset role;
reset request.jwt.claim.sub;

-- ===== amministratore =====
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
select 'admin vede profili', count(*) from public.profiles;               -- 3
insert into public.units (name) values ('U.T. Primiero');
update public.profiles set unit_id = '22222222-2222-2222-2222-222222222222', role = 'referente'
  where email = 'mario.rossi@critn.it';
select 'admin salva altra unita', public.save_unit_data('22222222-2222-2222-2222-222222222222', '{}', 0);
select 'unita', count(*) from public.units;                                -- 3
reset role;
reset request.jwt.claim.sub;

-- ===== anonimo: vede solo l'elenco delle unità =====
set role anon;
select 'anon unita', count(*) from public.units;                           -- 3
do $$ begin
  perform count(*) from public.profiles;
  raise exception 'ERRORE: anonimo legge i profili';
exception when insufficient_privilege then raise notice 'OK profili negati ad anonimo';
end $$;
reset role;
reset request.jwt.claim.sub;
-- ===== dipendenti: registrazione, approvazione, richieste, pubblicazione =====
-- Turni dell'unità Trento con due dipendenti (Luca ha la 104), salvati dall'amministratore.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
select public.save_unit_data('22222222-2222-2222-2222-222222222222',
  '{"employees":[{"id":"e1","name":"Bianchi Luca","role":"autista","has104":true},
                 {"id":"e2","name":"Neri Sara","role":"soccorritore"}],
    "settings":{"maxRestRequests":2,"requestDeadlineDay":15}}', 1);
reset role;
reset request.jwt.claim.sub;
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000004', 'luca.bianchi@critn.it',
   '{"first_name":"Luca","last_name":"Bianchi","unit_id":"22222222-2222-2222-2222-222222222222","role":"dipendente"}'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'sara.neri@critn.it',
   '{"first_name":"Sara","last_name":"Neri","unit_id":"22222222-2222-2222-2222-222222222222","role":"dipendente"}');
select 'dipendente in attesa', role, active from public.profiles where email = 'luca.bianchi@critn.it'; -- dipendente | f

-- in attesa: non vede nulla e non può fare richieste
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000004';
select 'luca in attesa vede roster', public.unit_roster('22222222-2222-2222-2222-222222222222') is null; -- t
do $$ begin
  perform public.set_request(date '2026-12-01', 'R');
  raise exception 'ERRORE: richiesta da dipendente non approvato';
exception when insufficient_privilege then raise notice 'OK dipendente non approvato bloccato';
end $$;
do $$ begin
  update public.profiles set active = true, employee_id = 'e1' where id = auth.uid();
  raise exception 'ERRORE: dipendente si è approvato da solo';
exception when insufficient_privilege then raise notice 'OK auto-approvazione negata';
end $$;
reset role;
reset request.jwt.claim.sub;

-- Anna (referente di Trento) vede e approva i dipendenti della sua unità
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select 'anna vede profili unita', count(*) from public.profiles where role = 'dipendente';  -- 2
select public.manage_employee_account('aaaaaaaa-0000-0000-0000-000000000004', 'e1', true);
select public.manage_employee_account('aaaaaaaa-0000-0000-0000-000000000005', 'e2', true);
do $$ begin
  perform public.manage_employee_account('aaaaaaaa-0000-0000-0000-000000000005', 'e1', true);
  raise exception 'ERRORE: stessa riga collegata a due account';
exception when unique_violation then raise notice 'OK riga già collegata';
end $$;
reset role;
reset request.jwt.claim.sub;

-- un referente di un'altra unità non può approvare
update public.profiles set role = 'referente', unit_id = '11111111-1111-1111-1111-111111111111', active = true
  where email = 'mario.rossi@critn.it';
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  perform public.manage_employee_account('aaaaaaaa-0000-0000-0000-000000000005', 'e2', false);
  raise exception 'ERRORE: referente di altra unità ha gestito un dipendente';
exception when insufficient_privilege then raise notice 'OK altra unità non gestisce';
end $$;
reset role;
reset request.jwt.claim.sub;

-- Luca approvato: vede il roster e le richieste, NON i turni in lavorazione
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000004';
select 'luca vede unit_data', count(*) from public.unit_data;                  -- 0
select 'luca roster', jsonb_array_length(public.unit_roster('22222222-2222-2222-2222-222222222222') -> 'employees'),
  public.unit_roster('22222222-2222-2222-2222-222222222222') ->> 'maxRestRequests'; -- 2 | 2
do $$
declare m date := date '2026-12-01';
begin
  perform public.set_request(m, 'R');
  perform public.set_request(m + 1, 'R');
  perform public.set_request(m + 2, 'P');                 -- 104: ha diritto
  begin
    perform public.set_request(m + 3, 'R');
    raise exception 'ERRORE: superato il massimo di riposi';
  exception when check_violation then raise notice 'OK massimo riposi';
  end;
  perform public.set_request(m + 1, null);                -- ne toglie una
  perform public.set_request(m + 3, 'R');                 -- e ne mette un'altra
  begin
    perform public.set_request(date '2026-11-21', 'R');
    raise exception 'ERRORE: accettata richiesta dopo il termine';
  exception when check_violation then raise notice 'OK termine scaduto';
  end;
end $$;
do $$ begin
  insert into public.requests (unit_id, employee_id, day, kind)
    values ('22222222-2222-2222-2222-222222222222', 'e2', current_date + 60, 'R');
  raise exception 'ERRORE: inserimento diretto di una richiesta';
exception when insufficient_privilege then raise notice 'OK inserimento diretto negato';
end $$;
reset role;
reset request.jwt.claim.sub;

-- Luca sospeso nel tabellone (active = false): non può più fare richieste
update public.unit_data set data = jsonb_set(data, '{employees,0,active}', 'false')
  where unit_id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000004';
do $$ begin
  perform public.set_request(date '2026-12-01' + 7, 'R');
  raise exception 'ERRORE: richiesta da dipendente sospeso';
exception when insufficient_privilege then raise notice 'OK sospeso non fa richieste';
end $$;
reset role;
reset request.jwt.claim.sub;
update public.unit_data set data = jsonb_set(data, '{employees,0,active}', 'true')
  where unit_id = '22222222-2222-2222-2222-222222222222';

-- Sara: senza 104 non può chiederla; vede il permesso di Luca solo come "A"
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000005';
do $$ begin
  perform public.set_request(date '2026-12-01' + 5, 'P');
  raise exception 'ERRORE: 104 senza diritto';
exception when check_violation then raise notice 'OK 104 solo con diritto';
end $$;
select 'sara vede richieste dirette', count(*) from public.requests;              -- 0 (solo le sue: nessuna)
select 'sara vede richieste unita', string_agg(kind, '' order by day)
  from public.unit_requests('22222222-2222-2222-2222-222222222222', '2026-11-01', '2027-03-31'); -- RAR
reset role;
reset request.jwt.claim.sub;

-- Anna pubblica il mese: Luca vede la pubblicazione e non può più cambiare le richieste
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select 'anna vede richieste', string_agg(kind, '' order by day) from public.requests;  -- RPR
insert into public.published (unit_id, month, data, published_by)
  values ('22222222-2222-2222-2222-222222222222', '2026-12',
          '{"cells":{}}', auth.uid());
reset role;
reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000004';
select 'luca vede pubblicati', count(*) from public.published;                    -- 1
do $$ begin
  perform public.set_request(date '2026-12-01' + 10, 'R');
  raise exception 'ERRORE: richiesta su mese pubblicato';
exception when check_violation then raise notice 'OK mese pubblicato bloccato';
end $$;
do $$ begin
  delete from public.published;
  if found then raise exception 'ERRORE: dipendente ha cancellato la pubblicazione'; end if;
  raise notice 'OK pubblicazione protetta';
end $$;
select 'luca vede ancora pubblicati', count(*) from public.published;             -- 1
do $$ begin
  perform public.save_unit_data('22222222-2222-2222-2222-222222222222', '{}', 2);
  raise exception 'ERRORE: dipendente ha salvato i turni';
exception when insufficient_privilege then raise notice 'OK dipendente non salva i turni';
end $$;
reset role;
reset request.jwt.claim.sub;

-- ===== limite del 25% per turno, riposo per un solo turno, precedenza del 104, finestra =====
-- Canal: 8 dipendenti (al massimo 2 a casa per turno), giorno 07–19 tutti i giorni, notte 19–07 solo lun–ven.
insert into public.unit_data (unit_id, data, version) values ('11111111-1111-1111-1111-111111111111',
  '{"employees":[{"id":"c1","name":"Uno","has104":true},{"id":"c2","name":"Due","has104":true},
                 {"id":"c3","name":"Tre","has104":true},{"id":"c4","name":"Quattro"},{"id":"c5","name":"Cinque"},
                 {"id":"c6","name":"Sei"},{"id":"c7","name":"Sette"},{"id":"c8","name":"Otto"}],
    "settings":{"ambulances":[{"id":"A1","shifts":[
      {"id":"G","start":"07:00","end":"19:00","days":[true,true,true,true,true,true,true]},
      {"id":"N","start":"19:00","end":"07:00","days":[true,true,true,true,true,false,false]}]}]}}', 1)
  on conflict (unit_id) do update set data = excluded.data;
insert into auth.users (id, email, raw_user_meta_data)
  select ('aaaaaaaa-0000-0000-0000-00000000001' || i)::uuid, 'c' || i || '@critn.it',
    jsonb_build_object('first_name', 'C' || i, 'last_name', 'Canal', 'unit_id', '11111111-1111-1111-1111-111111111111')
  from generate_series(1, 4) i;
select 'parti gio 10/12', public.day_parts('11111111-1111-1111-1111-111111111111', '2026-12-10'); -- {G,N}
select 'parti sab 12/12', public.day_parts('11111111-1111-1111-1111-111111111111', '2026-12-12'); -- {G}
select 'limite canal', public.request_cap('11111111-1111-1111-1111-111111111111');                -- 2
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.manage_employee_account(('aaaaaaaa-0000-0000-0000-00000000001' || i)::uuid, 'c' || i, true)
  from generate_series(1, 4) i;
do $$
declare res jsonb;
begin
  -- c2 e c3 chiedono la notte del 10: la notte è al completo, il giorno no
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000012', false);
  perform public.set_request('2026-12-10', 'R', 'N');
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000013', false);
  perform public.set_request('2026-12-10', 'R', 'N');
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000014', false);
  begin
    perform public.set_request('2026-12-10', 'R', 'N');
    raise exception 'ERRORE: superato il limite di notte';
  exception when check_violation then
    if sqlerrm not like 'Limite di richieste per quel giorno già raggiunto%' then raise; end if;
    raise notice 'OK notte al completo: %', sqlerrm;
  end;
  begin
    perform public.set_request('2026-12-10', 'R');
    raise exception 'ERRORE: giornata intera con la notte al completo';
  exception when check_violation then raise notice 'OK giornata intera rifiutata';
  end;
  perform public.set_request('2026-12-10', 'R', 'G');          -- il giorno ha ancora posto
  -- sabato c'è solo il giorno: la richiesta "notte" vale per la giornata
  perform public.set_request('2026-12-12', 'R', 'N');
  -- c1 chiede la 104 il 10: la notte era al completo, salta il riposo di c3 (l'ultimo)
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000011', false);
  res := public.set_request('2026-12-10', 'P');
  if (res ->> 'bumped')::integer <> 1 then raise exception 'ERRORE: 104 senza precedenza (%)', res; end if;
  -- l'11 due 104 (c1, c2): la terza (c3) non entra
  perform public.set_request('2026-12-11', 'P');
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000012', false);
  perform public.set_request('2026-12-11', 'P');
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000013', false);
  begin
    perform public.set_request('2026-12-11', 'P');
    raise exception 'ERRORE: più 104 del 25%%';
  exception when check_violation then raise notice 'OK 104 al completo: %', sqlerrm;
  end;
  -- finestra: gennaio non è ancora aperto; dopo il 15 novembre dicembre è chiuso
  begin
    perform public.set_request('2027-01-05', 'R');
    raise exception 'ERRORE: richiesta prima dell''apertura';
  exception when check_violation then raise notice 'OK non ancora aperte: %', sqlerrm;
  end;
  perform set_config('test.oggi', '2026-11-16', false);
  begin
    perform public.set_request('2026-12-20', 'R');
    raise exception 'ERRORE: richiesta dopo il 15';
  exception when check_violation then raise notice 'OK chiuse dopo il 15';
  end;
  perform set_config('test.oggi', '', false);
end $$;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000013';
select 'c3 vede il riposo annullato', day, kind, part from public.request_bumps;   -- 2026-12-10 | R | N
select 'c3 richieste unita 10/12', string_agg(employee_id || ':' || kind || coalesce(part, ''), ',' order by employee_id)
  from public.unit_requests('11111111-1111-1111-1111-111111111111', '2026-12-10', '2026-12-10'); -- c1:A,c2:RN,c4:RG
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000014';
select 'c4 sabato', kind, part is null from public.requests where day = '2026-12-12';   -- R | t
select 'c4 non vede annullati altrui', count(*) from public.request_bumps;              -- 0
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'mario vede annullati', count(*) from public.request_bumps;                      -- 1
do $$ begin
  insert into public.request_bumps (unit_id, employee_id, day, kind)
    values ('11111111-1111-1111-1111-111111111111', 'c4', '2026-12-01', 'R');
  raise exception 'ERRORE: scritto un annullamento a mano';
exception when insufficient_privilege then raise notice 'OK annullamenti protetti';
end $$;
reset role;
reset request.jwt.claim.sub;

-- ===== coordinatore e vice coordinatore referenti: senza unità e sempre amministratori =====
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000021', 'coord@critn.it',
   '{"first_name":"Carla","last_name":"Coord","unit_id":"22222222-2222-2222-2222-222222222222"}');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
update public.profiles set active = true, role = 'coordinatore' where email = 'coord@critn.it';
update public.profiles set is_admin = false where email = 'coord@critn.it';       -- resta amministratore
reset role;
reset request.jwt.claim.sub;
select 'coordinatore', role, unit_id is null, is_admin from public.profiles where email = 'coord@critn.it'; -- t | t
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000021';
select 'coordinatore vede le unità', public.is_manager_of('11111111-1111-1111-1111-111111111111'); -- t
reset role;
reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
update public.profiles set role = 'referente', unit_id = '22222222-2222-2222-2222-222222222222' where email = 'coord@critn.it';
reset role;
reset request.jwt.claim.sub;
select 'ex coordinatore', role, is_admin from public.profiles where email = 'coord@critn.it';     -- referente | f
do $$ begin
  if not (select is_admin from public.profiles where email = 'coord@critn.it') then
    raise notice 'OK coordinatore tolto: niente più amministratore';
  else raise exception 'ERRORE: ex coordinatore ancora amministratore'; end if;
end $$;

select 'FINE OK';
