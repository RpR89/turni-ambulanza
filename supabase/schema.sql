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
-- Regole:
--   - ci si può registrare solo con un indirizzo @critn.it (controllo nel database)
--   - ognuno vede e modifica solo i turni della propria unità
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
  role text not null default 'referente' check (role in ('referente', 'vice_referente')),
  active boolean not null default true,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

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
  insert into public.profiles (id, email, first_name, last_name, unit_id, role)
  values (
    new.id,
    lower(new.email),
    left(trim(coalesce(meta ->> 'first_name', '')), 80),
    left(trim(coalesce(meta ->> 'last_name', '')), 80),
    unit,
    case when meta ->> 'role' = 'vice_referente' then 'vice_referente' else 'referente' end
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

-- Un utente non può cambiarsi da solo unità, ruolo, stato o diritti di amministratore.
create or replace function public.protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() è vuoto per l'editor SQL e per le funzioni del server (chiave di servizio).
  if auth.uid() is not null and not public.is_admin() then
    if new.unit_id is distinct from old.unit_id or new.role is distinct from old.role
      or new.active is distinct from old.active or new.is_admin is distinct from old.is_admin
      or new.email is distinct from old.email then
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

-- Profili: ognuno vede e corregge nome/cognome del proprio; l'amministratore tutti.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.is_admin());

-- Turni: solo la propria unità (utente attivo) oppure l'amministratore.
drop policy if exists unit_data_read on public.unit_data;
create policy unit_data_read on public.unit_data for select to authenticated
  using (unit_id = public.my_unit() or public.is_admin());

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
  if auth.uid() is null or not (p_unit = public.my_unit() or public.is_admin()) then
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

-- =====================================================================
-- DOPO la tua registrazione, rendi amministratore il tuo utente
-- (sostituisci l'indirizzo e esegui solo questa riga):
--
--   update public.profiles set is_admin = true where email = 'nome.cognome@critn.it';
-- =====================================================================
