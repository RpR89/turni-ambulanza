-- =====================================================================
-- Turni Ambulanza — schema del database Supabase
--
-- Da eseguire UNA VOLTA nel progetto Supabase: Dashboard → SQL Editor →
-- New query → incolla tutto questo file → Run. Si può rieseguire senza
-- perdere dati (crea solo ciò che manca e aggiorna funzioni e regole).
--
-- Contiene:
--   units      Unità di appartenenza (gestite dall'amministratore)
--   profiles   dati degli utenti: nome, cognome, unità, ruolo, attivo, admin
--   unit_data  i turni di ciascuna unità (tutto il tabellone in JSON)
--   requests   richieste di riposo e permessi 104 inseriti dai dipendenti
--   published  i turni del mese resi pubblici per i dipendenti (copia "fotografata")
-- Regole:
--   - ci si può registrare solo con un indirizzo @critn.it (controllo nel database)
--   - referenti e vice referenti vedono e modificano solo i turni della propria unità
--   - i dipendenti, dopo l'approvazione del referente, vedono solo i turni pubblicati
--     e le richieste; inseriscono le proprie richieste entro il giorno limite
--   - l'amministratore gestisce unità e utenti e vede tutte le unità
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tabelle ----------

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  unit_id uuid references public.units (id) on delete set null,
  role text not null default 'referente',
  active boolean not null default true,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Aggiornamento delle installazioni precedenti: ruolo "dipendente" e collegamento al tabellone.
alter table public.profiles add column if not exists employee_id text;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('referente', 'vice_referente', 'dipendente'));

create table if not exists public.unit_data (
  unit_id uuid primary key references public.units (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------- Dominio email consentito ----------

create or replace function public.allowed_email(addr text)
returns boolean language sql immutable as $$
  select lower(coalesce(addr, '')) like '%@critn.it'
$$;

-- Blocca la creazione di utenti con email di altri domini (registrazione e inviti).
create or replace function public.enforce_email_domain()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.allowed_email(new.email) then
    raise exception 'Registrazione consentita solo con indirizzi @critn.it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_email_domain on auth.users;
create trigger enforce_email_domain
  before insert or update of email on auth.users
  for each row execute function public.enforce_email_domain();

-- Crea il profilo con i dati inseriti alla registrazione (o nell'invito).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  unit uuid;
begin
  begin
    unit := nullif(meta ->> 'unit_id', '')::uuid;
  exception when others then
    unit := null;
  end;
  if unit is not null and not exists (select 1 from public.units where id = unit) then
    unit := null;
  end if;
  -- I dipendenti restano in attesa finché il referente della loro unità non li approva.
  insert into public.profiles (id, email, first_name, last_name, unit_id, role, active)
  values (
    new.id,
    lower(new.email),
    left(trim(coalesce(meta ->> 'first_name', '')), 80),
    left(trim(coalesce(meta ->> 'last_name', '')), 80),
    unit,
    case meta ->> 'role' when 'vice_referente' then 'vice_referente' when 'dipendente' then 'dipendente'
      else 'referente' end,
    coalesce(meta ->> 'role', '') <> 'dipendente'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Funzioni di supporto per le regole ----------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.my_unit()
returns uuid language sql stable security definer set search_path = public as $$
  select unit_id from public.profiles where id = auth.uid() and active
$$;

-- Referente o vice referente attivo dell'unità (oppure amministratore): gestisce turni e dipendenti.
create or replace function public.is_manager_of(p_unit uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles
    where id = auth.uid() and active and unit_id = p_unit and role in ('referente', 'vice_referente'))
$$;

-- Riga del tabellone collegata al dipendente che ha fatto l'accesso (null per gli altri).
create or replace function public.my_employee_id()
returns text language sql stable security definer set search_path = public as $$
  select employee_id from public.profiles where id = auth.uid() and active and role = 'dipendente'
$$;

-- Un utente non può cambiarsi da solo unità, ruolo, stato, collegamento o diritti di amministratore.
create or replace function public.protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() è vuoto per l'editor SQL e per le funzioni del server (chiave di servizio);
  -- turni.gestione = 'on' solo dentro manage_employee_account, che fa i suoi controlli.
  if auth.uid() is not null and not public.is_admin()
    and coalesce(current_setting('turni.gestione', true), '') <> 'on' then
    if new.unit_id is distinct from old.unit_id or new.role is distinct from old.role
      or new.active is distinct from old.active or new.is_admin is distinct from old.is_admin
      or new.email is distinct from old.email or new.employee_id is distinct from old.employee_id then
      raise exception 'Solo l''amministratore può modificare unità, ruolo e stato'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------- Regole di accesso (Row Level Security) ----------

alter table public.units enable row level security;
alter table public.profiles enable row level security;
alter table public.unit_data enable row level security;

-- Unità: l'elenco dei nomi serve anche nel modulo di registrazione (prima del login).
drop policy if exists units_read on public.units;
create policy units_read on public.units for select to anon, authenticated using (true);
drop policy if exists units_admin_write on public.units;
create policy units_admin_write on public.units for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Profili: ognuno vede e corregge nome/cognome del proprio; il referente vede quelli della
-- sua unità (per approvare i dipendenti); l'amministratore tutti.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or (unit_id is not null and public.is_manager_of(unit_id)));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.is_admin());

-- Turni in lavorazione: solo referenti e vice referenti dell'unità, oppure l'amministratore.
-- I dipendenti non li leggono: vedono solo i turni pubblicati (tabella published).
drop policy if exists unit_data_read on public.unit_data;
create policy unit_data_read on public.unit_data for select to authenticated
  using (public.is_manager_of(unit_id));

-- Le scritture passano solo dalla funzione save_unit_data (controllo delle versioni).
revoke insert, update, delete on public.unit_data from anon, authenticated;
grant select on public.unit_data to authenticated;
grant select on public.units to anon, authenticated;
grant insert, update, delete on public.units to authenticated;
grant select, update, delete on public.profiles to authenticated;

-- Salva i turni di un'unità solo se nessun altro li ha cambiati nel frattempo.
-- Restituisce la nuova versione; errore 'conflitto' se la versione non corrisponde.
create or replace function public.save_unit_data(p_unit uuid, p_data jsonb, p_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  cur integer;
begin
  if auth.uid() is null or not public.is_manager_of(p_unit) then
    raise exception 'Non autorizzato' using errcode = 'insufficient_privilege';
  end if;
  select version into cur from public.unit_data where unit_id = p_unit for update;
  if cur is null then
    if coalesce(p_version, 0) <> 0 then
      raise exception 'conflitto' using errcode = 'serialization_failure';
    end if;
    insert into public.unit_data (unit_id, data, version, updated_by)
    values (p_unit, p_data, 1, auth.uid());
    return 1;
  end if;
  if cur <> p_version then
    raise exception 'conflitto' using errcode = 'serialization_failure';
  end if;
  update public.unit_data
    set data = p_data, version = cur + 1, updated_at = now(), updated_by = auth.uid()
    where unit_id = p_unit;
  return cur + 1;
end;
$$;

revoke all on function public.save_unit_data(uuid, jsonb, integer) from public, anon;
grant execute on function public.save_unit_data(uuid, jsonb, integer) to authenticated;

-- ---------- Dipendenti: approvazione e collegamento al tabellone ----------

-- Il referente approva (o disattiva) un dipendente della sua unità e sceglie la sua riga nel tabellone.
create or replace function public.manage_employee_account(p_profile uuid, p_employee_id text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  target public.profiles;
begin
  select * into target from public.profiles where id = p_profile for update;
  if target.id is null or target.role <> 'dipendente' or target.unit_id is null
    or not public.is_manager_of(target.unit_id) then
    raise exception 'Non autorizzato' using errcode = 'insufficient_privilege';
  end if;
  if p_active and coalesce(p_employee_id, '') = '' then
    raise exception 'Scegli la riga del tabellone del dipendente' using errcode = 'check_violation';
  end if;
  if p_active and exists (
    select 1 from public.profiles
    where unit_id = target.unit_id and employee_id = p_employee_id and active and id <> p_profile) then
    raise exception 'Questa riga del tabellone è già collegata a un altro account' using errcode = 'unique_violation';
  end if;
  perform set_config('turni.gestione', 'on', true);
  update public.profiles
    set active = p_active, employee_id = coalesce(nullif(p_employee_id, ''), employee_id)
    where id = p_profile;
  perform set_config('turni.gestione', 'off', true);
end;
$$;

revoke all on function public.manage_employee_account(uuid, text, boolean) from public, anon;
grant execute on function public.manage_employee_account(uuid, text, boolean) to authenticated;

-- Impostazioni del tabellone dell'unità (con i valori predefiniti dell'app).
create or replace function public.unit_setting(p_unit uuid, p_name text, p_default integer)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select (data -> 'settings' ->> p_name)::numeric::integer
    from public.unit_data where unit_id = p_unit), p_default)
$$;

-- Elenco dei dipendenti dell'unità (solo nome, qualifica e diritto alla 104) e regole per le
-- richieste: serve ai dipendenti, che non possono leggere i turni in lavorazione.
create or replace function public.unit_roster(p_unit uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_unit = public.my_unit() or public.is_admin() then jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e ->> 'id', 'name', e ->> 'name', 'role', e ->> 'role', 'shortName', e ->> 'shortName',
        'has104', coalesce((e ->> 'has104')::boolean, false)) order by ord)
      from public.unit_data d, jsonb_array_elements(d.data -> 'employees') with ordinality as x(e, ord)
      where d.unit_id = p_unit and coalesce((e ->> 'active')::boolean, true)), '[]'::jsonb),
    'maxRestRequests', public.unit_setting(p_unit, 'maxRestRequests', 4),
    'requestDeadlineDay', public.unit_setting(p_unit, 'requestDeadlineDay', 15),
    'perm104PerMonth', public.unit_setting(p_unit, 'perm104PerMonth', 3))
  end
$$;

revoke all on function public.unit_roster(uuid) from public, anon;
grant execute on function public.unit_roster(uuid) to authenticated;

-- ---------- Richieste dei dipendenti (riposo R e permesso 104 P) ----------

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  employee_id text not null,
  day date not null,
  kind text not null check (kind in ('R', 'P')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (unit_id, employee_id, day)
);

create table if not exists public.published (
  unit_id uuid not null references public.units (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  data jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  primary key (unit_id, month)
);

alter table public.requests enable row level security;
alter table public.published enable row level security;

-- Richieste: il referente le vede tutte e può cancellarle (rifiutarle); il dipendente vede le sue.
-- Quelle dei colleghi le vede con unit_requests, che nasconde il motivo dei permessi 104.
drop policy if exists requests_read on public.requests;
create policy requests_read on public.requests for select to authenticated
  using (public.is_manager_of(unit_id) or (unit_id = public.my_unit() and employee_id = public.my_employee_id()));
drop policy if exists requests_manager_delete on public.requests;
create policy requests_manager_delete on public.requests for delete to authenticated
  using (public.is_manager_of(unit_id));
revoke insert, update, delete on public.requests from anon, authenticated;
grant select, delete on public.requests to authenticated;

-- Turni pubblicati: li leggono tutti gli utenti attivi dell'unità; li scrive il referente.
drop policy if exists published_read on public.published;
create policy published_read on public.published for select to authenticated
  using (unit_id = public.my_unit() or public.is_admin());
drop policy if exists published_write on public.published;
create policy published_write on public.published for all to authenticated
  using (public.is_manager_of(unit_id)) with check (public.is_manager_of(unit_id));
revoke all on public.published from anon;
grant select, insert, update, delete on public.published to authenticated;

-- Ultimo giorno utile per le richieste di un mese: il giorno limite del mese precedente.
create or replace function public.request_deadline(p_unit uuid, p_month date)
returns date language sql stable security definer set search_path = public as $$
  select (date_trunc('month', p_month) - interval '1 month')::date
    + least(greatest(public.unit_setting(p_unit, 'requestDeadlineDay', 15), 1),
            extract(day from date_trunc('month', p_month) - interval '1 day')::integer) - 1
$$;

-- Richieste dell'unità in un periodo, per i dipendenti: i permessi 104 dei colleghi compaiono
-- solo come "A" (assente), senza il motivo.
create or replace function public.unit_requests(p_unit uuid, p_from date, p_to date)
returns table (employee_id text, day date, kind text) language sql stable security definer
set search_path = public as $$
  select r.employee_id, r.day,
    case when r.kind = 'P' and r.employee_id is distinct from public.my_employee_id()
      and not public.is_manager_of(p_unit) then 'A' else r.kind end
  from public.requests r
  where r.unit_id = p_unit and r.day between p_from and p_to
    and (p_unit = public.my_unit() or public.is_admin())
$$;

revoke all on function public.unit_requests(uuid, date, date) from public, anon;
grant execute on function public.unit_requests(uuid, date, date) to authenticated;

-- Il dipendente inserisce (p_kind 'R' o 'P') o toglie (p_kind null) una sua richiesta.
-- Controlli: giorno limite, mese non ancora pubblicato, massimo riposi al mese, 104 solo se ne
-- ha diritto e nel limite mensile.
create or replace function public.set_request(p_day date, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  month_start date := date_trunc('month', p_day)::date;
  month_key text := to_char(p_day, 'YYYY-MM');
  today date := (now() at time zone 'Europe/Rome')::date;
  used integer;
  emp jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.active or me.role <> 'dipendente' or me.unit_id is null
    or coalesce(me.employee_id, '') = '' then
    raise exception 'Solo i dipendenti approvati possono inserire richieste' using errcode = 'insufficient_privilege';
  end if;
  if p_kind is not null and p_kind not in ('R', 'P') then
    raise exception 'Tipo di richiesta non valido' using errcode = 'check_violation';
  end if;
  if today > public.request_deadline(me.unit_id, month_start) then
    raise exception 'Termine scaduto: le richieste per questo mese si potevano inserire fino al %',
      to_char(public.request_deadline(me.unit_id, month_start), 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.published where unit_id = me.unit_id and month = month_key) then
    raise exception 'I turni di questo mese sono già pubblicati: per cambiare chiedi al referente'
      using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext(me.unit_id::text || '|' || me.employee_id));
  if p_kind is null then
    delete from public.requests where unit_id = me.unit_id and employee_id = me.employee_id and day = p_day;
    return;
  end if;
  select count(*) into used from public.requests
    where unit_id = me.unit_id and employee_id = me.employee_id and kind = p_kind and day <> p_day
      and day >= month_start and day < (month_start + interval '1 month');
  if p_kind = 'R' and used >= public.unit_setting(me.unit_id, 'maxRestRequests', 4) then
    raise exception 'Hai già % richieste di riposo in questo mese (massimo %)',
      used, public.unit_setting(me.unit_id, 'maxRestRequests', 4) using errcode = 'check_violation';
  end if;
  if p_kind = 'P' then
    select e into emp from public.unit_data d, jsonb_array_elements(d.data -> 'employees') e
      where d.unit_id = me.unit_id and e ->> 'id' = me.employee_id;
    if not coalesce((emp ->> 'has104')::boolean, false) then
      raise exception 'Non risulti avere diritto ai permessi 104: parlane con il referente' using errcode = 'check_violation';
    end if;
    if used >= public.unit_setting(me.unit_id, 'perm104PerMonth', 3) then
      raise exception 'Hai già % permessi 104 in questo mese (massimo %)',
        used, public.unit_setting(me.unit_id, 'perm104PerMonth', 3) using errcode = 'check_violation';
    end if;
  end if;
  insert into public.requests (unit_id, employee_id, day, kind, created_by)
    values (me.unit_id, me.employee_id, p_day, p_kind, auth.uid())
    on conflict (unit_id, employee_id, day) do update set kind = excluded.kind, created_by = excluded.created_by,
      created_at = now();
end;
$$;

revoke all on function public.set_request(date, text) from public, anon;
grant execute on function public.set_request(date, text) to authenticated;

-- =====================================================================
-- DOPO la tua registrazione, rendi amministratore il tuo utente
-- (sostituisci l'indirizzo e esegui solo questa riga):
--
--   update public.profiles set is_admin = true where email = 'nome.cognome@critn.it';
-- =====================================================================
