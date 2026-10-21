# Turni Ambulanza

Web app per compilare i turni mensili dei dipendenti del comitato.
Si apre da un link nel browser del computer, senza installare niente.

Con il back end attivo (Supabase, vedi [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md)) si entra con
un account e i turni di ogni unità sono salvati online; senza, l'app funziona senza login con i dati nel browser.

## Cosa fa

- **Accesso utenti** (con il back end attivo):
  - registrazione con nome, cognome, email e **unità di appartenenza**: chi si registra è sempre un **dipendente**
    (referenti e vice li nomina l'amministratore, con l'invito o cambiando il ruolo);
    accettando l'informativa privacy; solo indirizzi **@critn.it** (controllo anche nel database) e conferma via mail;
  - accesso con email e password, recupero della password via mail;
  - chi si registra resta **in attesa di approvazione** del referente della sua unità; chi viene invitato
    dall'amministratore (con il ruolo scelto) è già approvato;
  - ogni utente vede e modifica solo i turni della **propria unità**, salvati online e condivisi tra
    referente e vice referente; se due persone salvano insieme l'app lo segnala e chiede quale versione tenere;
  - scheda **Amministrazione** (solo amministratori): unità di appartenenza, elenco utenti (prima quelli da approvare)
    con nome e cognome modificabili, unità, ruolo, attivo/disattivo e amministratore — **un amministratore può nominare altri amministratori** —,
    inserimento manuale di utenti con mail di invito;
  - [informativa privacy e cookie](privacy.html) e avviso informativo sui cookie (si usano solo strumenti tecnici).
- **Accesso dei dipendenti** (con il back end attivo):
  - il dipendente si registra dal sito; dopo la conferma della mail resta **in attesa** finché il
    referente (o il vice) della sua unità non lo approva nella scheda *Dipendenti → Account dei dipendenti*,
    scegliendo la sua riga del tabellone (proposta in automatico se nome e cognome coincidono);
  - il dipendente **non vede i turni in lavorazione**: per ogni mese vede i turni solo dopo che il referente preme
    **📢 Pubblica turni** (scheda Turni, menu *Altro* sul telefono). Si pubblica una "fotografia" del mese: le modifiche
    successive i dipendenti le vedono solo con **Aggiorna pubblicazione** (accanto al mese compare
    *modifiche non pubblicate*); **Ritira pubblicazione** la toglie;
  - nei turni pubblicati malattia e permessi 104 compaiono solo come **A** (assente), senza il motivo;
  - **mail di avviso**: quando il referente (o il vice) pubblica il mese, tutti i dipendenti registrati e attivi
    dell'unità ricevono una mail (solo con *Pubblica turni*: *Aggiorna pubblicazione* non manda mail). La mail parte
    dalla casella dell'app con il nome di chi pubblica come mittente, e "Rispondi" arriva a lui
    (configurazione in [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md));
  - finché il mese non è pubblicato il dipendente vede il **tabellone delle richieste** dell'unità (tutte le
    ambulanze) con le richieste dei colleghi, e tocca i giorni della sua riga per chiedere un **riposo (R)**
    — al massimo **4 al mese** — o un **permesso 104**, se ne ha diritto, nel limite mensile dei permessi.
    I permessi 104 dei colleghi li vede solo come **A**;
  - le richieste si possono inserire o togliere fino al **giorno limite** del mese precedente (predefinito il 15:
    per dicembre fino al 15 novembre) e mai dopo la pubblicazione. Limiti e giorno si cambiano in *Impostazioni*;
    i controlli li fa il database, non solo la pagina;
  - nel tabellone del referente le richieste entrano da sole come `R` / `104` **sottolineate** (anche al posto di
    turni messi dalla proposta automatica), e la proposta automatica le rispetta. Se in quel giorno c'è già un turno
    scritto a mano, la richiesta resta in sospeso e compare nei *Controlli* con **Rifiuta la richiesta**; se il
    referente cambia a mano una casella che veniva da una richiesta, l'app chiede se rifiutarla. Nella finestra di
    rifiuto si sceglie **"Devo informare il dipendente?"**: se sì, si scrive la motivazione e il dipendente riceve una
    mail con i giorni non accolti e il motivo.

- **Ambulanze e turni** (scheda *Impostazioni*): ogni ambulanza ha un **codice di 5 cifre** e i suoi turni,
  ciascuno con nome (es. `GIORNO`), sigla (es. `G`), **ora di inizio e di fine** e **giorni della settimana**
  in cui è in servizio. *Turnazione 24 ore* imposta subito `G` 07–19 e `N` 19–07 tutti i giorni;
  con *+ Turno* si aggiungono fasce con orari diversi. Un turno che passa la mezzanotte conta come notte.
  Senza modifiche c'è una sola ambulanza con `G` 07–19 e `N` 19–07 (come nelle versioni precedenti).
- **Visualizzazione con più ambulanze** (scheda *Impostazioni*, sotto le ambulanze):
  - *un solo tabellone*: ogni casella mostra i turni di tutte le ambulanze;
  - *un tabellone per ambulanza*: nella scheda *Turni* scegli l'ambulanza da modificare (menu *Tabellone*).
    Il tabellone delle altre ambulanze sta sotto, sovrapposto e sbiadito: nelle stesse caselle si vedono
    in trasparenza i loro turni (passa sopra con il mouse per il dettaglio), così inserisci tenendone conto.
    Nel tabellone scelto si inseriscono e cancellano solo i turni di quell'ambulanza; ferie, malattia, 104,
    riposo e formazione valgono per tutte. Totali, controlli, proposta automatica ed Excel restano unici.
- **Tabellone mensile**: una riga per dipendente e una colonna per giorno.
  Ogni casella può contenere:
  - uno o più **turni**, indicati con la loro sigla (es. `G`, `N`, `G2`);
    con <kbd>Maiusc</kbd>+clic si aggiunge un turno a quelli già presenti nel giorno
  - `F`: ferie
  - `M`: malattia
  - `P` (mostrato come `104`): permesso Legge 104 da 7,6 h, solo per i dipendenti con la 104 attiva
  - `R`: richiesta di riposo, cioè il dipendente ha chiesto di non lavorare quel giorno (0 h);
    la proposta automatica non mette mai turni in quel giorno
  - `C`: formazione, con le ore indicate nel campo accanto al pulsante
- **Periodi**: con *Inserisci un periodo*, sopra il tabellone, metti in un colpo solo
  una richiesta di riposo, ferie o malattia dal giorno X al giorno Y per un dipendente.
- **Inserimento veloce**: scegli cosa inserire e clicca (o trascina) sulle caselle.
  Da tastiera ti muovi con le frecce e scrivi con la sigla di un turno di una lettera (es. <kbd>G</kbd> <kbd>N</kbd>)
  o con <kbd>F</kbd> <kbd>M</kbd> <kbd>P</kbd> <kbd>R</kbd> <kbd>C</kbd>
  (<kbd>Canc</kbd> cancella, <kbd>Ctrl</kbd>+<kbd>Z</kbd> annulla).
- **Vincoli controllati in tempo reale**, con le caselle in errore evidenziate in rosso:
  - massimo **48 ore** per settimana (da lunedì a domenica) e **12 ore al giorno**
    (si possono fare più turni nello stesso giorno solo se rispettano tutte le regole);
  - almeno **11 ore** di riposo tra la fine di un turno e l'inizio del successivo.
    Il controllo vale anche a cavallo tra due mesi.
    Con i turni predefiniti non sono ammessi una `N` seguita da una `G` il giorno dopo, né `G` e `N` nello stesso giorno.
  - al massimo **6 giorni di lavoro di fila**, contando anche il giorno dello **smonto notte**
    (es. `G G N N` occupa 5 giorni: dal primo `G` al mattino dopo l'ultima `N`). Vale anche a cavallo tra due mesi
    e il numero si cambia in *Impostazioni*. Ferie, riposi e formazione interrompono la serie.
  - **almeno un autista soccorritore** in ogni turno di ogni ambulanza: ogni dipendente è *Autista soccorritore*
    (con patente) oppure *Soccorritore* (senza patente). Gli autisti sono segnati con una **A** accanto al nome.
  - **niente notte il giorno prima di un corso**: con la formazione (`C`) il giorno X,
    un turno di notte del giorno prima (che finisce il giorno X) non è ammesso;
  - **permessi 104**: al massimo 3 nel mese di calendario e solo per chi ha diritto alla 104.
    Accanto al nome compare il contatore dei permessi usati (es. `104 · 2/3`).
- **Regole da evitare** (superabili solo se non c'è alternativa, caselle in arancione):
  - non più di **2 giorni o 2 notti di fila**: meglio blocchi alternati tipo `G G N` o `G N N`;
  - non più di **2 weekend al mese**: un weekend conta anche se si lavora solo il sabato o solo la domenica,
    e contano anche i turni inseriti a mano;
  - turni **distribuiti in modo uniforme tra le settimane** (es. 2-3 ogni settimana, non 4 e poi 1);
    nel conteggio la notte della domenica non conta. Nella tabella *Ore e turni per settimana*
    le settimane troppo sbilanciate sono in arancione.
- **Equilibrio**: le colonne *Notti* e *Weekend* mostrano quanti ne ha fatti ciascuno.
  Il valore è evidenziato quando si discosta troppo dalla media, calcolata in proporzione al contratto.
- **Monte ore mensile** per ogni dipendente:
  - giorni dal lunedì al venerdì del mese × 7,6 h per il tempo pieno (38 h/settimana);
  - giorni dal lunedì al venerdì × 4,8 h per il part-time da 24 h/settimana (24 ÷ 5).

  Accanto al monte ore trovi le ore fatte e il saldo (+/−).
  Si può impostare anche un orario settimanale diverso, a scelta.
- **Copertura**: sotto il tabellone, una riga per ogni turno di ogni ambulanza con quante persone ci sono
  (2 richieste per turno, modificabile in *Impostazioni*); in rosso se mancano persone o l'autista,
  `–` nei giorni in cui il turno non è previsto.
- **Volontari generici**: cliccando un numero della copertura si mettono nel turno uno o più volontari senza nome,
  *autista soccorritore* o *soccorritore* (sotto il numero compare per esempio `2V`). Contano per la copertura e per
  l'autista richiesto, la proposta automatica non mette dipendenti dove bastano, non hanno ore. In Excel compaiono come
  `VOL. AUTISTA` / `VOLONTARIO`, nei turni pubblicati in una riga *Volontari*. *Reset completo* li toglie.
- **Proposta automatica**: riempie i turni scoperti di tutte le ambulanze, nei giorni previsti,
  senza toccare quelli già inseriti.
  Rispetta sempre i vincoli e dà la precedenza a chi è più indietro con il monte ore.
  In ogni turno mette prima un autista soccorritore e poi, se possibile, un soccorritore,
  così gli autisti restano disponibili per gli altri turni.
  Pianifica prima i weekend, poi i giorni feriali.
  Cerca di formare blocchi `G G N` / `G N N`, di far lavorare la stessa persona sabato e domenica
  e di distribuire notti, weekend e ore in modo equo. Poi prova a migliorare il mese con degli scambi
  tra dipendenti. Supera le regole da evitare solo quando non c'è alternativa e lo segnala.
- **Turni bloccati 🔒**: con lo strumento *blocca* (tasto <kbd>L</kbd>) blocchi le caselle che hai sistemato a mano.
  Il lucchetto accanto al nome blocca tutto il mese di un dipendente, *Blocca mese* blocca tutto.
  Una casella bloccata, anche vuota, non viene mai cambiata dalla proposta automatica né dal *Reset completo*,
  e non si modifica per sbaglio: va prima sbloccata.
- **Turni a mano e turni automatici**: l'app ricorda quali turni ha inserito la proposta automatica
  (mostrati in *corsivo*) e quali hai scritto tu (normali). Se modifichi a mano un turno automatico, diventa tuo.
  - **Proposta automatica** riempie solo le caselle vuote.
  - **Rifai proposta** ricalcola **solo i turni automatici** non bloccati: i turni scritti a mano,
    ferie, malattia, permessi, richieste di riposo e formazione restano.
  - **Cancella automatici** toglie **solo i turni automatici** non bloccati, senza ricalcolarli:
    restano i turni scritti o modificati a mano, i bloccati e tutte le altre voci.
  - **Reset completo** cancella tutto il mese, anche i turni scritti a mano; restano solo le caselle bloccate 🔒.
- **Stampa** (A4 orizzontale).
- **Esporta Excel**: scarica il *Tabellone turni* in formato `.xlsx`, con lo stesso aspetto
  di quello del comitato: logo e titolo, un gruppo di colonne per ogni turno di ogni ambulanza
  (*GIORNO | 12345*, *NOTTE | 12345*, …; *UR* se il codice non è impostato), *Note*, *EXTRA*,
  *FORMAZIONE*, *MANIFESTAZIONI*, *ASSENZE*, weekend in verde, pronto da stampare su A4 orizzontale.
  Con una sola ambulanza 24 ore il foglio è identico al modello.
  - Comprende le settimane che iniziano con un lunedì del mese (ottobre 2026: dal 5/10 al 1/11).
  - In ogni turno l'autista è scritto per primo; in *FORMAZIONE* chi ha un corso; in *ASSENZE*
    ferie, malattia, permessi 104 e richieste di riposo (chi è assente più giorni resta nella stessa colonna).
  - I nomi sono quelli del campo *Nome nel tabellone* (scheda Dipendenti): se è vuoto si usa il cognome,
    con le iniziali del nome quando due dipendenti hanno lo stesso cognome (`BETTEGA GI.`, `BETTEGA CH.`).
  - Il titolo si cambia in *Impostazioni*. *Note*, *EXTRA* e *MANIFESTAZIONI* restano da compilare a mano.
- **Backup**: i dati stanno nel browser. Con *Scarica backup* / *Carica backup* li salvi
  o li sposti su un altro computer.

### Convenzioni di calcolo

- Un turno conta per intero nel giorno in cui inizia: la notte di domenica 19–7
  appartiene alla settimana di quella domenica.
- Ferie e malattia nei giorni lun–ven valgono come ore svolte, con la stessa quota giornaliera
  del monte ore (7,6 h oppure 4,8 h). Nel fine settimana valgono 0.
- Il permesso 104 vale 7,6 h in qualsiasi giorno, anche per i part-time.
  Ore e numero massimo si cambiano in *Impostazioni*.
- La formazione conta come lavoro: entra nelle ore del mese e nel massimo di 48 h settimanali.
- Weekend lavorato = almeno un turno che inizia di sabato o di domenica.
  La notte tra venerdì e sabato conta come venerdì, quindi non consuma un weekend;
  la notte tra domenica e lunedì conta come domenica.
  Ferie, malattia, permessi 104, formazione e richieste di non lavorare nel weekend non contano.
- **Sospendere un dipendente** (scheda Dipendenti, *Sospendi* / *Riattiva*): finché è sospeso non compare nel
  tabellone, nei controlli, nella proposta automatica, in Excel e nei turni pubblicati (i suoi turni restano salvati);
  con l'accesso utenti attivo il suo account viene bloccato e non può entrare né fare richieste, finché non lo riattivi.

## Come si usa

L'app è online su **https://turni-ambulanza.vercel.app**.
In alternativa basta aprire `index.html` con un doppio clic.

Il sito è pubblicato da Vercel: a ogni modifica sul ramo di produzione viene aggiornato da solo,
e per ogni pull request Vercel crea un'anteprima da provare prima di unirla.
Non serve nessuna build: Vercel pubblica i file così come sono.

> Con l'accesso utenti attivo (Supabase) i turni sono salvati online, separati per unità; senza, restano
> solo nel browser di chi usa l'app. Non caricare nel repository i file di backup
> (`turni-backup-….json`), perché contengono i dati veri.

### Dal cellulare

Si apre lo stesso link dal browser del telefono; la pagina si adatta allo schermo:

- **menu ☰** in alto con le schede (Turni, Dipendenti, Impostazioni, Amministrazione) e l'utente;
- **barra in basso** sempre a portata di pollice con i turni, `F` `M` `P` `R` `C`, cancella e blocca;
- **＋ aggiungi turno**: quando è attivo, toccando una casella il turno scelto si aggiunge a quelli del giorno
  (o si toglie), come Maiusc+clic sul computer;
- in alto restano *Proposta automatica* e *Annulla* (↶); le altre azioni sono nel menu **☰ Altro**;
- nel tabellone i nomi sono abbreviati (cognome e iniziale) per vedere più giorni; si scorre di lato;
- **icona sulla schermata Home**: su iPhone *Condividi → Aggiungi alla schermata Home*, su Android
  *⋮ → Aggiungi a schermata Home* (o *Installa app*). Si apre a tutto schermo come un'app.

## Sviluppo

Non ci sono dipendenze né build: è HTML, CSS e JavaScript semplici.

```
npm test     # test delle regole (Node 18+), eseguiti anche da GitHub Actions a ogni push
npm start    # server locale su http://localhost:8080
```

- `js/rules.js`: calcolo ore, vincoli e proposta automatica (senza DOM, testato)
- `js/app.js`: interfaccia del tabellone
- `js/requests.js`: richieste dei dipendenti nel tabellone e copia pubblicata del mese (senza DOM, testato)
- `js/staff.js`: schermata del dipendente (turni pubblicati e richieste)
- `js/auth.js`, `js/config.js`: accesso, registrazione, amministrazione e salvataggio online (Supabase);
  `js/vendor/supabase.min.js` è [supabase-js](https://github.com/supabase/supabase-js) 2.45.4 (licenza MIT)
- `api/admin-invite.js`: funzione Vercel per l'inserimento manuale degli utenti (usa la chiave service_role)
- `api/notify.js`: funzione Vercel per le mail ai dipendenti (pubblicazione, richieste non accolte), con
  [nodemailer](https://nodemailer.com) (licenza MIT-0)
- `supabase/schema.sql`: tabelle e regole di sicurezza del database; `supabase/test/` le prove su un Postgres locale:
  `psql -f supabase/test/mock_auth.sql -f supabase/schema.sql -f supabase/test/schema_test.sql`
- `js/export-xlsx.js`: tabellone in Excel; `js/vendor/exceljs.min.js` è [ExcelJS](https://github.com/exceljs/exceljs) 4.4.0 (licenza MIT)
- `tests/rules.test.js`: test delle regole; `tests/requests.test.js`: richieste e pubblicazione
