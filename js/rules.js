/*
 * Regole di pianificazione turni: calcolo ore, vincoli e proposta automatica.
 * Nessuna dipendenza dal DOM: usato dal browser (window.Rules) e dai test Node.
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;

  // Turni di lavoro: ora di inizio e durata in ore.
  var SHIFTS = {
    G: { code: 'G', label: 'Giorno 7–19', start: 7, hours: 12 },
    N: { code: 'N', label: 'Notte 19–7', start: 19, hours: 12 }
  };

  // Assenze giustificate: valgono come ore lavorate nei giorni lun–ven.
  var ABSENCES = {
    F: { code: 'F', label: 'Ferie' },
    M: { code: 'M', label: 'Malattia' }
  };

  /*
   * Altre voci inseribili a mano:
   *  P = permesso Legge 104 (ore fisse, solo per chi ne ha diritto, max N al mese)
   *  R = richiesta di non lavorare (0 ore, la proposta automatica la rispetta)
   *  C = formazione/corso, con le ore indicate: conta come lavoro, anche nelle 48 h
   * Nell'archivio la formazione è { code: 'C', hours: 6 }, tutte le altre voci una stringa.
   */
  var OTHER = {
    P: { code: 'P', label: 'Permesso 104' },
    R: { code: 'R', label: 'Richiesta di non lavorare' },
    C: { code: 'C', label: 'Formazione' }
  };

  var DEFAULT_SETTINGS = {
    maxWeeklyHours: 48,
    minRestHours: 11,
    fullTimeWeeklyHours: 38,
    staffPerShift: { G: 2, N: 2 },
    perm104Hours: 7.6,
    perm104PerMonth: 3,
    minDriversPerShift: 1
  };

  // Qualifiche: l'autista soccorritore ha la patente per guidare l'ambulanza.
  var ROLES = {
    autista: 'Autista soccorritore',
    soccorritore: 'Soccorritore'
  };

  function isDriver(emp) { return emp.role === 'autista'; }

  // ---------- Date (sempre in UTC, così l'ora legale non sposta i giorni) ----------

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toKey(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  function parseKey(key) {
    var p = key.split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }

  function dayNumber(key) {
    var p = parseKey(key);
    return Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY_MS);
  }

  function keyFromDayNumber(n) {
    var dt = new Date(n * DAY_MS);
    return toKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  function addDays(key, n) { return keyFromDayNumber(dayNumber(key) + n); }

  // 0 = lunedì … 6 = domenica
  function weekday(key) {
    var p = parseKey(key);
    return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
  }

  function isWorkingDay(key) { return weekday(key) < 5; }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function monthDays(y, m) {
    var out = [];
    for (var d = 1; d <= daysInMonth(y, m); d++) out.push(toKey(y, m, d));
    return out;
  }

  // Lunedì della settimana che contiene la data.
  function weekStart(key) { return addDays(key, -weekday(key)); }

  // Settimane (lun–dom) che toccano il mese, anche solo in parte.
  function monthWeeks(y, m) {
    var days = monthDays(y, m);
    var out = [];
    var w = weekStart(days[0]);
    var last = days[days.length - 1];
    while (dayNumber(w) <= dayNumber(last)) {
      out.push(w);
      w = addDays(w, 7);
    }
    return out;
  }

  // ---------- Ore ----------

  function workingDaysInMonth(y, m) {
    return monthDays(y, m).filter(isWorkingDay).length;
  }

  function dailyHours(emp) { return emp.weeklyHours / 5; }

  // Monte ore del mese: giorni lun–ven × (ore settimanali / 5).
  // Tempo pieno 38 h → 7,6 h al giorno; part-time 24 h → 4,8 h al giorno.
  function monthlyTarget(emp, y, m) {
    return round1(workingDaysInMonth(y, m) * dailyHours(emp));
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  function empAssignments(state, empId) {
    return (state.assignments && state.assignments[empId]) || {};
  }

  function codeOf(entry) {
    if (!entry) return '';
    return typeof entry === 'string' ? entry : entry.code;
  }

  function codeOn(state, empId, key) { return codeOf(empAssignments(state, empId)[key]); }

  // Ore di lavoro effettivo del giorno: turni e formazione.
  // Un turno appartiene al giorno (e quindi a settimana e mese) in cui inizia.
  function workHoursOn(state, empId, key) {
    var entry = empAssignments(state, empId)[key];
    var code = codeOf(entry);
    if (SHIFTS[code]) return SHIFTS[code].hours;
    if (code === 'C') return +entry.hours || 0;
    return 0;
  }

  function settingNum(state, name) {
    var s = state.settings || {};
    return s[name] != null ? +s[name] : DEFAULT_SETTINGS[name];
  }

  function monthSummary(state, emp, y, m) {
    var a = empAssignments(state, emp.id);
    var worked = 0, training = 0, absence = 0, counts = { G: 0, N: 0, F: 0, M: 0, P: 0, R: 0, C: 0 };
    monthDays(y, m).forEach(function (key) {
      var code = codeOf(a[key]);
      if (!code) return;
      counts[code] = (counts[code] || 0) + 1;
      if (SHIFTS[code]) worked += SHIFTS[code].hours;
      else if (code === 'C') training += workHoursOn(state, emp.id, key);
      else if (code === 'P') absence += settingNum(state, 'perm104Hours');
      else if (ABSENCES[code] && isWorkingDay(key)) absence += dailyHours(emp);
    });
    var target = monthlyTarget(emp, y, m);
    absence = round1(absence);
    training = round1(training);
    return {
      worked: worked,
      training: training,
      absence: absence,
      target: target,
      balance: round1(worked + training + absence - target),
      counts: counts
    };
  }

  function weekHours(state, empId, monday) {
    var tot = 0;
    for (var i = 0; i < 7; i++) tot += workHoursOn(state, empId, addDays(monday, i));
    return round1(tot);
  }

  // ---------- Vincoli ----------

  // Inizio e fine di un turno in ore assolute (giorno × 24 + ora).
  function shiftSpan(key, code) {
    var s = SHIFTS[code];
    var start = dayNumber(key) * 24 + s.start;
    return { start: start, end: start + s.hours };
  }

  // Turni del dipendente nell'intervallo [from, to], in ordine.
  function shiftsBetween(state, empId, fromKey, toKey_) {
    var a = empAssignments(state, empId);
    var out = [];
    for (var n = dayNumber(fromKey); n <= dayNumber(toKey_); n++) {
      var key = keyFromDayNumber(n);
      if (SHIFTS[codeOf(a[key])]) out.push({ key: key, code: codeOf(a[key]) });
    }
    return out;
  }

  function settingsOf(state) {
    var s = state.settings || {};
    return {
      maxWeeklyHours: s.maxWeeklyHours != null ? s.maxWeeklyHours : DEFAULT_SETTINGS.maxWeeklyHours,
      minRestHours: s.minRestHours != null ? s.minRestHours : DEFAULT_SETTINGS.minRestHours,
      staffPerShift: s.staffPerShift || DEFAULT_SETTINGS.staffPerShift
    };
  }

  /*
   * Motivi per cui il dipendente non può fare il turno `code` il giorno `key`
   * (ignorando quello che c'è già scritto in quel giorno). Array vuoto = ok.
   */
  function blockers(state, empId, key, code) {
    var cfg = settingsOf(state);
    var reasons = [];
    var span = shiftSpan(key, code);

    shiftsBetween(state, empId, addDays(key, -2), addDays(key, 2)).forEach(function (s) {
      if (s.key === key) return;
      var other = shiftSpan(s.key, s.code);
      var gap = other.start >= span.end ? other.start - span.end : span.start - other.end;
      if (gap < cfg.minRestHours) {
        reasons.push('riposo di ' + Math.max(gap, 0) + ' h con il turno ' + s.code + ' del ' + s.key +
          ' (minimo ' + cfg.minRestHours + ' h)');
      }
    });

    var monday = weekStart(key);
    var hours = round1(weekHours(state, empId, monday) - workHoursOn(state, empId, key) + SHIFTS[code].hours);
    if (hours > cfg.maxWeeklyHours) {
      reasons.push(hours + ' h nella settimana dal ' + monday + ' (massimo ' + cfg.maxWeeklyHours + ' h)');
    }
    return reasons;
  }

  /*
   * Tutti i problemi del mese: violazioni dei vincoli (errori) e
   * copertura dei turni diversa da quella richiesta (avvisi).
   */
  function validateMonth(state, y, m) {
    var cfg = settingsOf(state);
    var days = monthDays(y, m);
    var first = days[0], last = days[days.length - 1];
    var issues = [];

    activeOf(state).forEach(function (emp) {
      // Riposo: controlla anche i turni a cavallo con il mese prima/dopo.
      var shifts = shiftsBetween(state, emp.id, addDays(first, -1), addDays(last, 1));
      for (var i = 1; i < shifts.length; i++) {
        var prev = shiftSpan(shifts[i - 1].key, shifts[i - 1].code);
        var cur = shiftSpan(shifts[i].key, shifts[i].code);
        var gap = cur.start - prev.end;
        var inMonth = shifts[i].key >= first && shifts[i].key <= last;
        if (gap < cfg.minRestHours && (inMonth || shifts[i - 1].key >= first)) {
          issues.push({
            level: 'error', type: 'rest', empId: emp.id,
            dates: [shifts[i - 1].key, shifts[i].key],
            message: 'Riposo di ' + Math.max(gap, 0) + ' h tra ' + shifts[i - 1].code + ' del ' +
              shifts[i - 1].key + ' e ' + shifts[i].code + ' del ' + shifts[i].key +
              ' (minimo ' + cfg.minRestHours + ' h)'
          });
        }
      }

      monthWeeks(y, m).forEach(function (monday) {
        var h = weekHours(state, emp.id, monday);
        if (h > cfg.maxWeeklyHours) {
          var dates = [];
          for (var d = 0; d < 7; d++) {
            if (workHoursOn(state, emp.id, addDays(monday, d))) dates.push(addDays(monday, d));
          }
          issues.push({
            level: 'error', type: 'week', empId: emp.id, dates: dates, week: monday,
            message: h + ' h nella settimana dal ' + monday + ' al ' + addDays(monday, 6) +
              ' (massimo ' + cfg.maxWeeklyHours + ' h)'
          });
        }
      });

      // Permessi 104: solo per chi ne ha diritto e al massimo N nel mese.
      var perms = days.filter(function (k) { return codeOn(state, emp.id, k) === 'P'; });
      var maxPerm = settingNum(state, 'perm104PerMonth');
      if (perms.length && !emp.has104) {
        issues.push({
          level: 'error', type: 'perm104', empId: emp.id, dates: perms,
          message: 'Permessi 104 inseriti ma il dipendente non risulta avere diritto alla 104'
        });
      } else if (perms.length > maxPerm) {
        issues.push({
          level: 'error', type: 'perm104', empId: emp.id, dates: perms.slice(maxPerm),
          message: perms.length + ' permessi 104 nel mese (massimo ' + maxPerm + ')'
        });
      }
    });

    days.forEach(function (key) {
      Object.keys(SHIFTS).forEach(function (code) {
        var need = +cfg.staffPerShift[code] || 0;
        var staff = staffOn(state, key, code);
        var have = staff.length;
        if (have !== need) {
          issues.push({
            level: 'warning', type: 'coverage', dates: [key], shift: code,
            message: 'Turno ' + code + ' del ' + key + ': ' + have + ' su ' + need +
              (have < need ? ' (scoperto)' : ' (in eccesso)')
          });
        }
        // Un turno con personale deve avere almeno un autista soccorritore.
        var minDrivers = settingNum(state, 'minDriversPerShift');
        var drivers = staff.filter(isDriver).length;
        if (have > 0 && drivers < minDrivers) {
          issues.push({
            level: 'error', type: 'driver', dates: [key], shift: code,
            empIds: staff.map(function (e) { return e.id; }),
            message: 'Turno ' + code + ' del ' + key + ': ' +
              (drivers ? drivers + ' autisti soccorritori su ' + minDrivers + ' richiesti' : 'manca l\'autista soccorritore')
          });
        }
      });
    });

    return issues;
  }

  // I dipendenti non più attivi restano nello storico ma non contano nei controlli.
  function activeOf(state) {
    return (state.employees || []).filter(function (e) { return e.active !== false; });
  }

  function staffOn(state, key, code) {
    return activeOf(state).filter(function (e) {
      return codeOn(state, e.id, key) === code;
    });
  }

  // ---------- Proposta automatica ----------

  /*
   * Riempie i turni scoperti del mese senza toccare quello che è già inserito.
   * Rispetta sempre riposo minimo e massimo settimanale; a parità sceglie chi
   * è più indietro rispetto al proprio monte ore mensile.
   * Restituisce un nuovo oggetto assignments e la lista dei turni rimasti scoperti.
   */
  function generateMonth(state, y, m) {
    var cfg = settingsOf(state);
    var work = {
      settings: state.settings,
      employees: activeOf(state),
      assignments: JSON.parse(JSON.stringify(state.assignments || {}))
    };
    var minDrivers = settingNum(state, 'minDriversPerShift');
    var target = {}, done = {};
    work.employees.forEach(function (e) {
      if (!work.assignments[e.id]) work.assignments[e.id] = {};
      var s = monthSummary(work, e, y, m);
      target[e.id] = s.target;
      done[e.id] = s.worked + s.training + s.absence;
    });

    var uncovered = [];
    monthDays(y, m).forEach(function (key) {
      ['G', 'N'].forEach(function (code) {
        var staffed = staffOn(work, key, code);
        var need = (+cfg.staffPerShift[code] || 0) - staffed.length;
        var driversNeeded = Math.max(0, minDrivers - staffed.filter(isDriver).length);
        while (need > 0) {
          var available = work.employees.filter(function (e) {
            return !work.assignments[e.id][key] && blockers(work, e.id, key, code).length === 0;
          });
          // Finché manca l'autista, il posto va a un autista soccorritore.
          var candidates = driversNeeded > 0 ? available.filter(isDriver) : available;
          if (!candidates.length && driversNeeded > 0 && available.length) {
            uncovered.push({ date: key, shift: code, missing: 0, driver: true });
            driversNeeded = 0;
            candidates = available;
          }
          if (!candidates.length) {
            uncovered.push({ date: key, shift: code, missing: need });
            break;
          }
          var preferNonDrivers = driversNeeded === 0;
          candidates.sort(function (a, b) {
            // Prima chi non ha ancora raggiunto il monte ore; poi, a autista già coperto,
            // i soccorritori (gli autisti servono negli altri turni); infine il più indietro.
            var ra = target[a.id] ? done[a.id] / target[a.id] : Infinity;
            var rb = target[b.id] ? done[b.id] / target[b.id] : Infinity;
            var oa = done[a.id] + SHIFTS[code].hours > target[a.id] ? 1 : 0;
            var ob = done[b.id] + SHIFTS[code].hours > target[b.id] ? 1 : 0;
            if (oa !== ob) return oa - ob;
            if (preferNonDrivers && isDriver(a) !== isDriver(b)) return isDriver(a) ? 1 : -1;
            if (ra !== rb) return ra - rb;
            return String(a.name).localeCompare(String(b.name));
          });
          var pick = candidates[0];
          if (isDriver(pick)) driversNeeded = Math.max(0, driversNeeded - 1);
          work.assignments[pick.id][key] = code;
          done[pick.id] += SHIFTS[code].hours;
          need--;
        }
      });
    });

    return { assignments: work.assignments, uncovered: uncovered };
  }

  var Rules = {
    SHIFTS: SHIFTS,
    ABSENCES: ABSENCES,
    OTHER: OTHER,
    ROLES: ROLES,
    isDriver: isDriver,
    codeOf: codeOf,
    codeOn: codeOn,
    workHoursOn: workHoursOn,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    toKey: toKey,
    addDays: addDays,
    weekday: weekday,
    isWorkingDay: isWorkingDay,
    daysInMonth: daysInMonth,
    monthDays: monthDays,
    weekStart: weekStart,
    monthWeeks: monthWeeks,
    workingDaysInMonth: workingDaysInMonth,
    monthlyTarget: monthlyTarget,
    monthSummary: monthSummary,
    weekHours: weekHours,
    blockers: blockers,
    validateMonth: validateMonth,
    staffOn: staffOn,
    generateMonth: generateMonth
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
  else root.Rules = Rules;
})(this);
