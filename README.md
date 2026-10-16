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
  - `R`: richiesta di riposo, cioè il dipendente ha chiesto di non lavorare quel giorno (0 h);
    la proposta automatica non mette mai turni in quel giorno
  - `C`: formazione, con le ore indicate nel campo accanto al pulsante
- **Periodi**: con *Inserisci un periodo*, sopra il tabellone, metti in un colpo solo
  una richiesta di riposo, ferie o malattia dal giorno X al giorno Y per un dipendente.
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
  - **niente notte il giorno prima di un corso**: con la formazione (`C`) il giorno X,
    la notte del giorno prima (che finisce alle 7 del giorno X) non è ammessa;
  - **permessi 104**: al massimo 3 nel mese di calendario e solo per chi ha diritto alla 104.
    Accanto al nome compare il contatore dei permessi usati (es. `104 · 2/3`).
- **Regole da evitare** (superabili solo se non c'è alternativa, caselle in arancione):
  - non più di **2 G o 2 N di fila**: meglio blocchi alternati tipo `G G N` o `G N N`;
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
- **Copertura**: conta quante persone ci sono in ogni turno rispetto a quelle richieste
  (2 di giorno e 2 di notte, modificabili in *Impostazioni*) e quanti autisti ci sono in ciascun turno.
- **Proposta automatica**: riempie i turni scoperti senza toccare quelli già inseriti.
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
  - **Reset completo** cancella tutto il mese, anche i turni scritti a mano; restano solo le caselle bloccate 🔒.
- **Stampa** (A4 orizzontale).
- **Esporta Excel**: scarica il *Tabellone turni* in formato `.xlsx`, con lo stesso aspetto
  di quello del comitato: logo e titolo, colonne *GIORNO | UR*, *Note*, *NOTTE | UR*, *EXTRA*,
  *FORMAZIONE*, *MANIFESTAZIONI*, *ASSENZE*, weekend in verde, pronto da stampare su A4 orizzontale.
  - Comprende le settimane che iniziano con un lunedì del mese (ottobre 2026: dal 5/10 al 1/11).
  - In ogni turno l'autista è scritto per primo; in *FORMAZIONE* chi ha un corso; in *ASSENZE*
    ferie, malattia e permessi 104 (chi è assente più giorni resta nella stessa colonna).
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
- Weekend lavorato = almeno un turno `G` o `N` che inizia di sabato o di domenica.
  La notte tra venerdì e sabato conta come venerdì, quindi non consuma un weekend;
  la notte tra domenica e lunedì conta come domenica.
  Ferie, malattia, permessi 104, formazione e richieste di non lavorare nel weekend non contano.
- I dipendenti disattivati (spunta *Attivo* tolta) spariscono dal tabellone e dai controlli,
  ma i loro turni passati restano salvati.

## Come si usa

L'app è online su **https://turni-ambulanza.vercel.app**.
In alternativa basta aprire `index.html` con un doppio clic.

Il sito è pubblicato da Vercel: a ogni modifica sul ramo di produzione viene aggiornato da solo,
e per ogni pull request Vercel crea un'anteprima da provare prima di unirla.
Non serve nessuna build: Vercel pubblica i file così come sono.

> I nomi e i turni non finiscono online: restano salvati solo nel browser di chi usa l'app.
> Il link pubblica soltanto il programma. Non caricare nel repository i file di backup
> (`turni-backup-….json`), perché contengono i dati veri.

## Sviluppo

Non ci sono dipendenze né build: è HTML, CSS e JavaScript semplici.

```
npm test     # test delle regole (Node 18+), eseguiti anche da GitHub Actions a ogni push
npm start    # server locale su http://localhost:8080
```

- `js/rules.js`: calcolo ore, vincoli e proposta automatica (senza DOM, testato)
- `js/app.js`: interfaccia
- `js/export-xlsx.js`: tabellone in Excel; `js/vendor/exceljs.min.js` è [ExcelJS](https://github.com/exceljs/exceljs) 4.4.0 (licenza MIT)
- `tests/rules.test.js`: test delle regole
