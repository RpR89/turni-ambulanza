# Attivare l'accesso utenti (Supabase + Vercel)

Finché questi passi non sono fatti, l'app funziona come prima: senza login e con i dati nel browser.
Servono circa 20 minuti. Tutto è gratuito con i piani base di Supabase e Vercel.

## 1. Crea il progetto Supabase

1. Vai su <https://supabase.com>, crea un account (meglio con un indirizzo del comitato) e premi **New project**.
2. Nome: `turni-ambulanza`. Scegli una password per il database e conservala.
3. **Region: Central EU (Frankfurt)**: così i dati restano nell'Unione Europea (serve per il GDPR).
4. Attendi un paio di minuti che il progetto sia pronto.

## 2. Crea tabelle e regole di sicurezza

1. Nel progetto apri **SQL Editor → New query**.
2. Copia tutto il contenuto del file [`supabase/schema.sql`](../supabase/schema.sql), incollalo e premi **Run**.
   Deve comparire "Success". Il file si può rieseguire senza perdere dati (ad esempio dopo un aggiornamento).

Lo schema crea le unità, i profili degli utenti e i turni di ogni unità, e imposta le regole:
registrazione solo con indirizzi `@critn.it`, ognuno vede solo i turni della propria unità,
solo l'amministratore gestisce unità e utenti.

## 3. Impostazioni di accesso

In **Authentication**:

- **Sign In / Providers → Email**: attivo, con **Confirm email** attivo
  (chi si registra deve aprire il link ricevuto per confermare l'indirizzo).
  *Minimum password length*: `8`.
- **URL Configuration**:
  - *Site URL*: `https://turni-ambulanza.vercel.app`
  - *Redirect URLs*: aggiungi `https://turni-ambulanza.vercel.app/**` e, per provare le anteprime,
    `https://turni-ambulanza-*.vercel.app/**`
- **Emails → SMTP Settings** (consigliato prima di usarla davvero): il servizio di invio mail incluso in
  Supabase invia pochissime mail all'ora ed è pensato solo per le prove. Inserisci i dati del server di posta
  del comitato (host, porta, utente, password, mittente es. `turni@critn.it`).
- **Emails → Templates** (facoltativo): puoi tradurre in italiano i testi delle mail di conferma,
  invito e recupero password.

## 4. Collega il sito a Supabase

In Supabase apri **Project Settings** (oppure il pulsante **Connect** in alto) e copia:

- **Project URL** (es. `https://abcdefgh.supabase.co`)
- la **Publishable key** (`sb_publishable_…`, in *API Keys*) oppure la vecchia chiave **anon public** (`eyJ…`, scheda *Legacy API keys*)

Inseriscili in [`js/config.js`](../js/config.js) (`supabaseUrl` e `supabaseAnonKey`), oppure mandali a chi
mantiene l'app. Sono valori pubblici: la sicurezza è garantita dalle regole del database.

> **Non** mettere mai nel codice la chiave **secret** / **service_role**: dà accesso completo al database.

## 5. Chiave segreta su Vercel (per l'inserimento manuale degli utenti)

In Vercel apri il progetto **turni-ambulanza → Settings → Environment Variables** e aggiungi:

| Nome | Valore |
|---|---|
| `SUPABASE_URL` | il Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | la **Secret key** (`sb_secret_…`, in *API Keys*) oppure la vecchia **service_role** |
| `SITE_URL` | `https://turni-ambulanza.vercel.app` |

Poi da **Deployments** fai **Redeploy** dell'ultima pubblicazione, perché le variabili vengano lette.

### Mail ai dipendenti (pubblicazione dei turni e richieste non accolte)

Le mail ai dipendenti partono da un'unica casella dell'app (per esempio `turni@critn.it`, la stessa che puoi usare
in Supabase per le mail di conferma). Il mittente mostra il nome di chi pubblica o rifiuta, per esempio
*"Anna Verdi (referente) – Turni Ambulanza"*, e con "Rispondi" la risposta arriva direttamente a lui.
Aggiungi in Vercel, sempre in **Settings → Environment Variables**:

| Nome | Valore |
|---|---|
| `SMTP_HOST` | il server di posta in uscita (es. `smtp.office365.com`, `smtp.gmail.com`, `smtp-relay.brevo.com`) |
| `SMTP_PORT` | `587` (oppure `465` se il fornitore usa SSL) |
| `SMTP_USER` | l'utente della casella (di solito l'indirizzo, es. `turni@critn.it`) |
| `SMTP_PASS` | la password della casella o la "password per le app" |
| `MAIL_FROM` | l'indirizzo mittente, es. `turni@critn.it` |

Poi **Redeploy**. Senza queste variabili l'app funziona lo stesso: pubblicazione e rifiuti vanno a buon fine e un
messaggio avvisa che le mail non sono partite.

**Non hai una casella del comitato da usare?** Il servizio di posta incluso in Supabase non va bene: manda solo le
mail di accesso (conferma, invito, password) e con limiti molto bassi. La strada più semplice e gratuita è un account
Gmail dedicato all'app (es. `turni.cri.trento@gmail.com`):

1. crea l'account e attiva la **verifica in due passaggi** (Account Google → Sicurezza);
2. sempre in Sicurezza crea una **password per le app** (16 caratteri);
3. su Vercel: `SMTP_HOST` = `smtp.gmail.com`, `SMTP_PORT` = `465`, `SMTP_USER` e `MAIL_FROM` = l'indirizzo Gmail,
   `SMTP_PASS` = la password per le app (senza spazi).

Gmail permette circa 500 mail al giorno, molto più del necessario. Il dipendente vede comunque come mittente il nome
del referente, e "Rispondi" arriva al referente. La stessa casella puoi usarla anche in Supabase
(*Authentication → Emails → SMTP Settings*) per le mail di conferma della registrazione, così non hai più i limiti
del servizio incluso.

## 6. Diventa amministratore

1. Apri il sito e **registrati** con il tuo indirizzo `@critn.it` (per la prima registrazione scegli
   un'unità qualsiasi, o creane una prima dal SQL Editor con
   `insert into public.units (name) values ('U.T. Canal San Bovo');`).
2. Conferma l'indirizzo dal link nella mail.
3. In Supabase, **SQL Editor**, esegui (con il tuo indirizzo):

   ```sql
   update public.profiles set is_admin = true, active = true, role = 'referente' where email = 'nome.cognome@critn.it';
   ```

4. Rientra nel sito: compare la scheda **Amministrazione**, dove gestisci unità e utenti.
   Chi si registra dal sito è sempre un **dipendente** (lo approva il referente della sua unità, scheda *Dipendenti*).
   Referenti e vice li crei tu: con *Aggiungi un utente* (invito per mail, già attivo) oppure cambiando il ruolo di
   un utente registrato nella tabella *Utenti* e premendo **Approva**. Con la casella **Amministratore** nomini altri
   amministratori.

## 7. Aggiornare il database a una nuova versione

Quando una nuova versione dell'app lo richiede (per esempio la 3.0, con l'accesso dei dipendenti), riapri
**SQL Editor → New query**, incolla di nuovo tutto [`supabase/schema.sql`](../supabase/schema.sql) e premi **Run**.
I dati esistenti (unità, utenti, turni) restano; vengono aggiunte le nuove tabelle e aggiornate le regole.

**La versione 3.6** (richieste per un solo turno, limite del 25% per turno, precedenza dei permessi 104) richiede
questo passaggio: finché lo schema non è aggiornato i dipendenti non riescono a inserire richieste.

## 8. Prima di aprire l'app a tutti

- Completa e fai verificare dal DPO l'[informativa privacy](../privacy.html) (parti evidenziate in giallo).
- Se in un browser c'erano già turni salvati senza account, al primo accesso l'app propone di usarli come
  punto di partenza per la tua unità.
- Fai ogni tanto *Scarica backup* dalla scheda Impostazioni: oltre ai backup di Supabase, hai una copia tua.
