-- Prove dello schema: eseguire dopo mock_auth.sql e schema.sql (vedi tests/schema.test.js).
\set ON_ERROR_STOP 1
create extension if not exists pgcrypto;
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
update public.profiles set is_admin = true, active = true where email = 'capo@critn.it';

-- l'amministratore approva i referenti e nomina un altro amministratore
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
update public.profiles set active = true where email in ('mario.rossi@critn.it', 'anna.verdi@critn.it');
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
  perform public.set_request((date_trunc('month', current_date) + interval '2 month')::date, 'R');
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
declare m date := (date_trunc('month', current_date) + interval '2 month')::date;
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
    perform public.set_request(date_trunc('month', current_date)::date + 20, 'R');
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

-- Sara: senza 104 non può chiederla; vede il permesso di Luca solo come "A"
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000005';
do $$ begin
  perform public.set_request((date_trunc('month', current_date) + interval '2 month')::date + 5, 'P');
  raise exception 'ERRORE: 104 senza diritto';
exception when check_violation then raise notice 'OK 104 solo con diritto';
end $$;
select 'sara vede richieste dirette', count(*) from public.requests;              -- 0 (solo le sue: nessuna)
select 'sara vede richieste unita', string_agg(kind, '' order by day)
  from public.unit_requests('22222222-2222-2222-2222-222222222222', current_date, current_date + 120); -- RAR
reset role;
reset request.jwt.claim.sub;

-- Anna pubblica il mese: Luca vede la pubblicazione e non può più cambiare le richieste
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select 'anna vede richieste', string_agg(kind, '' order by day) from public.requests;  -- RPR
insert into public.published (unit_id, month, data, published_by)
  values ('22222222-2222-2222-2222-222222222222', to_char(current_date + interval '2 month', 'YYYY-MM'),
          '{"cells":{}}', auth.uid());
reset role;
reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000004';
select 'luca vede pubblicati', count(*) from public.published;                    -- 1
do $$ begin
  perform public.set_request((date_trunc('month', current_date) + interval '2 month')::date + 10, 'R');
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

select 'FINE OK';
