/*
 * Richieste dei dipendenti e turni pubblicati: logica senza DOM, usata dal browser
 * (window.Online) e dai test Node.
 *
 * - Le richieste (riposo R, permesso 104 P) arrivano dal server ed entrano nel tabellone del
 *   referente come caselle R/P "da richiesta" (segnate in state.reqTags), senza mai togliere
 *   un turno scritto a mano: in quel caso c'è un conflitto da risolvere.
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

  /*
   * Porta le richieste del server nel tabellone. `list`: [{ id, employee_id, day, kind }].
   * - casella vuota o con soli turni automatici → diventa R/P (segnata come richiesta);
   * - richiesta tolta dal dipendente → la casella R/P che aveva creato si svuota;
   * - casella con un turno scritto a mano o bloccata → conflitto (non si tocca nulla);
   * - casella già con ferie, malattia, formazione… → il dipendente non lavora comunque: nulla da fare.
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
        var kind = state.reqTags[empId][key];
        var r = want[empId] && want[empId][key];
        if (r && r.kind === kind) return;
        if (R.codeOn(state, empId, key) === kind && !R.isLocked(state, empId, key)) {
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
      if (code === r.kind) {
        if (tagOf(state, empId, key) !== r.kind) { setTag(state, empId, key, r.kind); out.changed = true; }
        return;
      }
      if (code) return;
      var ids = R.shiftIdsOf(state, entry);
      var autoIds = R.autoIdsOn(state, empId, key);
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
    buildSnapshot: buildSnapshot,
    sameSnapshot: sameSnapshot,
    syncRequests: syncRequests,
    tagOf: tagOf,
    setTag: setTag
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Online;
  else root.Online = Online;
})(this);
