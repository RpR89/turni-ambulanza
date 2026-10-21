-- Simulazione minima dell'ambiente Supabase per provare schema.sql su un Postgres qualsiasi.
-- NON va eseguito su Supabase (lì esistono già i ruoli e lo schema auth).
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);
-- Come su Supabase: l'utente dalla variabile impostata nei test o dal token letto da PostgREST.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
