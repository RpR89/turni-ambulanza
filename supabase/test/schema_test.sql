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

-- amministratore impostato dall'editor SQL (nessun utente collegato)
update public.profiles set is_admin = true where email = 'capo@critn.it';

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
select 'FINE OK';
