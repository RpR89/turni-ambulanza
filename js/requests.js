/*
 * Richieste dei dipendenti e turni pubblicati: logica senza DOM, usata dal browser
 * (window.Online) e dai test Node.
 *
 * - Le richieste (riposo R, permesso 104 P) arrivano dal server ed entrano nel tabellone del
 *   referente come caselle R/P "da richiesta" (segnate in state.reqTags), senza mai togliere
 *   un turno scritto a mano: in quel caso c'è un conflitto da risolvere.
 * - Il riposo può riguardare un solo turno (part G = a casa di giorno, N = a casa la notte): la casella
 *   non cambia, si tolgono solo i turni automatici di quella parte (state.reqTags 'R:G' / 'R:N').
 * - Al massimo il 33% dei dipendenti a casa per turno (la giornata intera conta in tutti i turni).
 * - La pubblicazione è una copia del mese per i dipendenti: malattia e 104 compaiono come
 *   assenza generica (A), senza il motivo.
 */
(function (root) {
  'use strict';

  var R = typeof module !== 'undefined' && module.exports ? require('./rules.js') : root.Rules;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function monthKey(y, m) { return y + '-' + pad(m); }

  // Ultimo giorno per le richieste del mese (y, m): il giorno `day` del mese precedente
  // (o l'ultimo giorno di quel mese, se è più corto).
  function requestDeadline(y, m, day) {
    var py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    var last = R.daysInMonth(py, pm);
    return R.toKey(py, pm, Math.min(Math.max(+day || 15, 1), last));
  }

  // Primo giorno per le richieste del mese (y, m): il 1° del mese precedente.
  function requestOpening(y, m) {
    return m === 1 ? R.toKey(y - 1, 12, 1) : R.toKey(y, m - 1, 1);
  }

  // Quante richieste al massimo per turno: la percentuale dei dipendenti attivi, almeno una
  // (Infinity con percentuale 0 = nessun limite). Come request_cap nel database.
  function requestCap(employees, percent) {
    var pct = percent == null ? 33 : +percent;
    if (!(pct > 0)) return Infinity;
    return Math.max(1, Math.floor(employees * Math.min(pct, 100) / 100));
  }

  // Richieste (di chiunque, 104 compresi) che tengono a casa qualcuno nella parte `part` del giorno.
  function partLoad(list, day, part) {
    return (list || []).filter(function (r) { return r.day === day && (!r.part || r.part === part); }).length;
  }

  /*
   * Nel tabellone del referente: il giorno ha già il massimo di persone a casa in almeno un turno?
   * Contano i dipendenti attivi con R o 104 nella giornata e quelli a casa per un solo turno
   * (escluso `exceptEmp`, quello che si sta modificando).
   */
  function dayFull(state, key, exceptEmp) {
    var active = state.employees.filter(function (e) { return e.active !== false; });
    var cap = requestCap(active.length, state.settings && state.settings.maxRequestPercent);
    if (cap === Infinity) return false;
    var parts = R.dayParts(state, key);
    if (!parts.length) parts = ['G'];
    return parts.some(function (part) {
      return active.filter(function (e) {
        if (e.id === exceptEmp) return false;
        var code = R.codeOn(state, e.id, key);
        return code === 'R' || code === 'P' || R.offPartOn(state, e.id, key) === part;
      }).length >= cap;
    });
  }

  // Segno della richiesta nel tabellone: 'R', 'P' o, per un solo turno, 'R:G' / 'R:N'.
  function requestTag(r) { return r.kind + (r.part ? ':' + r.part : ''); }

  // ---------- Pubblicazione ----------

  function publicEntry(state, entry) {
    var code = R.codeOf(entry);
    if (code === 'M' || code === 'P') return 'A';
    if (code === 'C') return { code: 'C', hours: entry.hours };
    if (code) return code;
    var ids = R.shiftIdsOf(state, entry);
    return ids.length ? R.shiftEntry(ids) : null;
  }

  // Copia del mese da mostrare ai dipendenti.
  function buildSnapshot(state, y, m) {
    var days = R.monthDays(y, m);
    var employees = state.employees.filter(function (e) { return e.active !== false; });
    var cells = {};
    employees.forEach(function (e) {
      var row = {};
      days.forEach(function (k) {
        var v = publicEntry(state, (state.assignments[e.id] || {})[k]);
        if (v) row[k] = v;
      });
      cells[e.id] = row;
    });
    return {
      month: monthKey(y, m),
      employees: employees.map(function (e) {
        return { id: e.id, name: e.name, role: e.role, shortName: e.shortName || '' };
      }),
      ambulances: R.ambulancesOf(state).map(function (a) {
        return {
          id: a.id, code: a.code || '',
          shifts: (a.shifts || []).map(function (s) {
            return { id: s.id, name: s.name, label: s.label, start: s.start, end: s.end };
          })
        };
      }),
      cells: cells,
      volunteers: monthVolunteers(state, days)
    };
  }

  // Volontari generici del mese: { giorno: { turno: { A, S } } } (solo i turni che ne hanno).
  function monthVolunteers(state, days) {
    var out = {};
    days.forEach(function (k) {
      var day = (state.volunteers || {})[k];
      if (!day) return;
      Object.keys(day).forEach(function (id) {
        var v = R.volunteersOn(state, k, id);
        if (!v.total || !R.shiftInfo(state, id)) return;
        (out[k] = out[k] || {})[id] = { A: v.drivers, S: v.rescuers };
      });
    });
    return out;
  }

  // Confronto indipendente dall'ordine delle chiavi (il database le riordina).
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  function sameSnapshot(a, b) {
    return canonical(a || null) === canonical(b || null);
  }

  // ---------- Richieste nel tabellone del referente ----------

  function tagOf(state, empId, key) {
    return state.reqTags && state.reqTags[empId] ? state.reqTags[empId][key] || '' : '';
  }

  function setTag(state, empId, key, kind) {
    if (!state.reqTags) state.reqTags = {};
    if (kind) {
      if (!state.reqTags[empId]) state.reqTags[empId] = {};
      state.reqTags[empId][key] = kind;
    } else if (state.reqTags[empId]) {
      delete state.reqTags[empId][key];
    }
  }

  // Toglie dalla casella i turni automatici della parte `part` (G/N); restituisce quanti ne ha tolti.
  function dropAutoPart(state, empId, key, part) {
    var ids = R.shiftIdsOn(state, empId, key);
    var autoIds = R.autoIdsOn(state, empId, key);
    var drop = ids.filter(function (id) { return autoIds.indexOf(id) >= 0 && R.shiftPart(R.shiftInfo(state, id)) === part; });
    if (!drop.length) return 0;
    var keep = ids.filter(function (id) { return drop.indexOf(id) < 0; });
    var keepAuto = autoIds.filter(function (id) { return drop.indexOf(id) < 0; });
    if (keep.length) state.assignments[empId][key] = R.shiftEntry(keep);
    else delete state.assignments[empId][key];
    if (state.auto && state.auto[empId]) {
      if (keepAuto.length) state.auto[empId][key] = keepAuto.length === keep.length ? true : keepAuto;
      else delete state.auto[empId][key];
    }
    return drop.length;
  }

  /*
   * Porta le richieste del server nel tabellone. `list`: [{ id, employee_id, day, kind, part }].
   * Giornata intera (R, P):
   * - casella vuota o con soli turni automatici → diventa R/P (segnata come richiesta);
   * - richiesta tolta dal dipendente → la casella R/P che aveva creato si svuota;
   * - casella con un turno scritto a mano o bloccata → conflitto (non si tocca nulla);
   * - casella già con ferie, malattia, formazione… → il dipendente non lavora comunque: nulla da fare.
   * Un solo turno (R con part G/N): si tolgono i turni automatici di quella parte e la casella resta
   * segnata; un turno di quella parte scritto a mano (o in una casella bloccata) è un conflitto.
   * Restituisce { changed, added, removed, conflicts }.
   */
  function syncRequests(state, list) {
    var out = { changed: false, added: 0, removed: 0, conflicts: [] };
    var want = {};
    var known = {};
    state.employees.forEach(function (e) { known[e.id] = true; });
    (list || []).forEach(function (r) {
      if (!want[r.employee_id]) want[r.employee_id] = {};
      want[r.employee_id][r.day] = r;
    });

    Object.keys(state.reqTags || {}).forEach(function (empId) {
      Object.keys(state.reqTags[empId]).forEach(function (key) {
        var tag = state.reqTags[empId][key];
        var r = want[empId] && want[empId][key];
        if (r && requestTag(r) === tag) return;
        if (tag.indexOf(':') < 0 && R.codeOn(state, empId, key) === tag && !R.isLocked(state, empId, key)) {
          delete state.assignments[empId][key];
          out.removed++;
        }
        setTag(state, empId, key, '');
        out.changed = true;
      });
    });

    (list || []).forEach(function (r) {
      var empId = r.employee_id, key = r.day;
      if (!known[empId]) return;
      if (!state.assignments[empId]) state.assignments[empId] = {};
      var entry = state.assignments[empId][key];
      var code = R.codeOf(entry);
      var tag = requestTag(r);
      var ids = R.shiftIdsOf(state, entry);
      var autoIds = R.autoIdsOn(state, empId, key);

      if (r.part) {
        var hit = ids.filter(function (id) { return R.shiftPart(R.shiftInfo(state, id)) === r.part; });
        var manual = hit.filter(function (id) { return autoIds.indexOf(id) < 0; });
        if (!code && hit.length && (manual.length || R.isLocked(state, empId, key))) {
          out.conflicts.push({ request: r, empId: empId, day: key, kind: r.kind, part: r.part, shifts: hit });
          return;
        }
        var fresh = tagOf(state, empId, key) !== tag;
        if (fresh) setTag(state, empId, key, tag);
        if (!code && dropAutoPart(state, empId, key, r.part)) fresh = true;
        if (fresh) { out.added++; out.changed = true; }
        return;
      }

      if (code === r.kind) {
        if (tagOf(state, empId, key) !== r.kind) { setTag(state, empId, key, r.kind); out.changed = true; }
        return;
      }
      if (code) return;
      var onlyAuto = ids.every(function (id) { return autoIds.indexOf(id) >= 0; });
      if (R.isLocked(state, empId, key) || !onlyAuto) {
        out.conflicts.push({ request: r, empId: empId, day: key, kind: r.kind, shifts: ids });
        return;
      }
      state.assignments[empId][key] = r.kind;
      if (state.auto && state.auto[empId]) delete state.auto[empId][key];
      setTag(state, empId, key, r.kind);
      out.added++;
      out.changed = true;
    });
    return out;
  }

  var Online = {
    monthKey: monthKey,
    requestDeadline: requestDeadline,
    requestOpening: requestOpening,
    requestCap: requestCap,
    partLoad: partLoad,
    dayFull: dayFull,
    requestTag: requestTag,
    buildSnapshot: buildSnapshot,
    sameSnapshot: sameSnapshot,
    syncRequests: syncRequests,
    tagOf: tagOf,
    setTag: setTag
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Online;
  else root.Online = Online;
})(this);
