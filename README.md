# Turni Ambulanza

Web app per compilare i turni mensili dei dipendenti del comitato.
Si apre da un link nel browser del computer. Non serve installare niente, non c'è login
e non c'è un server con i dati.

## Cosa fa

- **Tabellone mensile**: una riga per dipendente e una colonna per giorno.
  Ogni casella può contenere:
  - `G`: turno giorno, 7–19 (12 h)
  - `N`: turno notte, 19–7 (12 h)
  - `F`: ferie
  - `M`: malattia
  - `P` (mostrato come `104`): permesso Legge 104 da 7,6 h, solo per i dipendenti con la 104 attiva
  - `R`: richiesta di non lavorare (0 h); la proposta automatica non mette turni in quel giorno
  - `C`: formazione, con le ore indicate nel campo accanto al pulsante
- **Inserimento veloce**: scegli cosa inserire e clicca (o trascina) sulle caselle.
  Da tastiera ti muovi con le frecce e scrivi con <kbd>G</kbd> <kbd>N</kbd> <kbd>F</kbd> <kbd>M</kbd> <kbd>P</kbd> <kbd>R</kbd> <kbd>C</kbd>
  (<kbd>Canc</kbd> cancella, <kbd>Ctrl</kbd>+<kbd>Z</kbd> annulla).
- **Vincoli controllati in tempo reale**, con le caselle in errore evidenziate in rosso:
  - massimo **48 ore** per settimana (da lunedì a domenica);
  - almeno **11 ore** di riposo tra la fine di un turno e l'inizio del successivo.
    Il controllo vale anche a cavallo tra due mesi.
    In pratica non sono ammessi una `N` seguita da una `G` il giorno dopo, né `G` e `N` nello stesso giorno.
  - **almeno un autista soccorritore** in ogni turno: ogni dipendente è *Autista soccorritore*
    (con patente) oppure *Soccorritore* (senza patente). Gli autisti sono segnati con una **A** accanto al nome.
  - **permessi 104**: al massimo 3 nel mese di calendario e solo per chi ha diritto alla 104.
    Accanto al nome compare il contatore dei permessi usati (es. `104 · 2/3`).
- **Monte ore mensile** per ogni dipendente:
  - giorni dal lunedì al venerdì del mese × 7,6 h per il tempo pieno (38 h/settimana);
  - giorni dal lunedì al venerdì × 4,8 h per il part-time da 24 h/settimana (24 ÷ 5).

  Accanto al monte ore trovi le ore fatte e il saldo (+/−).
  Si può impostare anche un orario settimanale diverso, a scelta.
- **Copertura**: conta quante persone ci sono in ogni turno rispetto a quelle richieste
  (2 di giorno e 2 di notte, modificabili in *Impostazioni*) e quanti autisti ci sono in ciascun turno.
- **Proposta automatica**: riempie i turni scoperti senza toccare quelli già inseriti.
  Rispetta sempre i vincoli e dà la precedenza a chi è più indietro con il monte ore.
  In ogni turno mette prima un autista soccorritore e poi, se possibile, un soccorritore,
  così gli autisti restano disponibili per gli altri turni.
- **Stampa** (A4 orizzontale) ed **esportazione CSV** per Excel.
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
- I dipendenti disattivati (spunta *Attivo* tolta) spariscono dal tabellone e dai controlli,
  ma i loro turni passati restano salvati.

## Come si usa

Basta aprire `index.html` con un doppio clic, oppure pubblicarla online:

1. Unisci questo branch su `main`.
2. Su GitHub vai in **Settings → Pages** e alla voce *Source* scegli **GitHub Actions**.
3. A ogni modifica su `main` il sito viene pubblicato su `https://<utente>.github.io/turni-ambulanza/`.

> I nomi e i turni non finiscono online: restano salvati solo nel browser di chi usa l'app.
> Il link pubblica soltanto il programma.

## Sviluppo

Non ci sono dipendenze né build: è HTML, CSS e JavaScript semplici.

```
npm test     # test delle regole (Node 18+)
npm start    # server locale su http://localhost:8080
```

- `js/rules.js`: calcolo ore, vincoli e proposta automatica (senza DOM, testato)
- `js/app.js`: interfaccia
- `tests/rules.test.js`: test delle regole
