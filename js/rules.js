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
    minDriversPerShift: 1,
    maxSameInRow: 2,
    maxWeekendsPerMonth: 2
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

  // Casella bloccata: la proposta automatica non la cambia mai (né la riempie se è vuota).
  function isLocked(state, empId, key) {
    return !!(state.locks && state.locks[empId] && state.locks[empId][key]);
  }

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
      counts: counts,
      nights: counts.N,
      weekends: weekendsWorked(state, emp.id, y, m).length
    };
  }

  function weekHours(state, empId, monday) {
    var tot = 0;
    for (var i = 0; i < 7; i++) tot += workHoursOn(state, empId, addDays(monday, i));
    return round1(tot);
  }

  // ---------- Weekend, sequenze ed equilibrio ----------

  // Weekend del mese: sabato e domenica della stessa settimana, solo i giorni dentro il mese.
  function monthWeekends(y, m) {
    var groups = {};
    var order = [];
    monthDays(y, m).forEach(function (key) {
      if (weekday(key) < 5) return;
      var w = weekStart(key);
      if (!groups[w]) { groups[w] = []; order.push(w); }
      groups[w].push(key);
    });
    return order.map(function (w) { return { week: w, days: groups[w] }; });
  }

  // Weekend del mese in cui il dipendente fa almeno un turno (basta il sabato o la domenica).
  function weekendsWorked(state, empId, y, m) {
    return monthWeekends(y, m).filter(function (we) {
      return we.days.some(function (k) { return SHIFTS[codeOn(state, empId, k)]; });
    });
  }

  // Lunghezza della serie di turni uguali consecutivi che si avrebbe mettendo `code` il giorno `key`.
  function sameRunWith(state, empId, key, code) {
    var n = 1, d;
    for (d = addDays(key, -1); codeOn(state, empId, d) === code; d = addDays(d, -1)) n++;
    for (d = addDays(key, 1); codeOn(state, empId, d) === code; d = addDays(d, 1)) n++;
    return n;
  }

  // Giorni consecutivi di turno che terminano il giorno prima di `key`.
  function streakBefore(state, empId, key) {
    var n = 0;
    for (var d = addDays(key, -1); SHIFTS[codeOn(state, empId, d)]; d = addDays(d, -1)) n++;
    return n;
  }

  // Peso del contratto per confrontare notti e weekend: part-time 24 h → 24/38.
  function contractWeight(state, emp) {
    return (emp.weeklyHours || 38) / settingNum(state, 'fullTimeWeeklyHours');
  }

  /*
   * Regole "da evitare" (superabili solo se non c'è alternativa) violate mettendo
   * `code` il giorno `key`: più di 2 turni uguali di fila, più di 2 weekend nel mese.
   */
  function softBlockers(state, empId, key, code) {
    var reasons = [];
    var maxRow = settingNum(state, 'maxSameInRow');
    var run = sameRunWith(state, empId, key, code);
    if (run > maxRow) reasons.push(run + ' turni ' + code + ' di fila');
    if (weekday(key) >= 5) {
      var p = parseKey(key);
      var worked = weekendsWorked(state, empId, p.y, p.m);
      var w = weekStart(key);
      var already = worked.some(function (we) { return we.week === w; });
      if (!already && worked.length >= settingNum(state, 'maxWeekendsPerMonth')) {
        reasons.push((worked.length + 1) + ' weekend nel mese');
      }
    }
    return reasons;
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

      // Da evitare: più di N turni uguali di fila (anche a cavallo dei mesi).
      var maxRow = settingNum(state, 'maxSameInRow');
      var seq = shiftsBetween(state, emp.id, addDays(first, -7), addDays(last, 7));
      var run = [];
      function flush() {
        if (run.length > maxRow && run.some(function (r) { return r.key >= first && r.key <= last; })) {
          issues.push({
            level: 'soft', type: 'sequence', empId: emp.id,
            dates: run.map(function (r) { return r.key; }),
            message: run.length + ' turni ' + run[0].code + ' di fila dal ' + run[0].key +
              ' (da evitare più di ' + maxRow + ')'
          });
        }
      }
      seq.forEach(function (sh) {
        var prev = run[run.length - 1];
        if (prev && prev.code === sh.code && addDays(prev.key, 1) === sh.key) run.push(sh);
        else { flush(); run = [sh]; }
      });
      flush();

      // Da evitare: più di N weekend lavorati nel mese.
      var maxWe = settingNum(state, 'maxWeekendsPerMonth');
      var weList = weekendsWorked(state, emp.id, y, m);
      if (weList.length > maxWe) {
        var weDates = [];
        weList.forEach(function (we) {
          we.days.forEach(function (k) { if (SHIFTS[codeOn(state, emp.id, k)]) weDates.push(k); });
        });
        issues.push({
          level: 'soft', type: 'weekends', empId: emp.id, dates: weDates,
          message: weList.length + ' weekend lavorati nel mese (da evitare più di ' + maxWe + ')'
        });
      }

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
   *
   * Vincoli rigidi (mai superati): riposo minimo, massimo settimanale, voce già presente nel giorno.
   * Regole da evitare (superate solo se nessun altro può coprire il posto): più di 2 turni
   * uguali di fila, più di 2 weekend nel mese.
   * Tra i candidati validi sceglie, in ordine:
   *  1. chi non supera il proprio monte ore;
   *  2. nel weekend, chi lavora già quel weekend (così se ne consumano meno), poi chi ne ha fatti meno;
   *  3. chi non arriverebbe al 4° giorno di lavoro di fila (blocchi G G N, G N N);
   *  4. per le notti, chi ne ha fatte meno (in proporzione al contratto);
   *  5. a autista già presente, un soccorritore, se non è molto più avanti con le ore;
   *  6. chi continua un blocco di lavoro invece di iniziarne uno nuovo;
   *  7. chi è più indietro con il monte ore.
   * Restituisce le nuove assegnazioni, i posti rimasti scoperti e le regole superate.
   */
  function generateMonth(state, y, m, opts) {
    var cfg = settingsOf(state);
    var work = {
      settings: state.settings,
      employees: activeOf(state),
      assignments: JSON.parse(JSON.stringify(state.assignments || {})),
      locks: state.locks || {}
    };
    // "Rifai proposta": toglie i turni G/N non bloccati del mese e li ricalcola.
    // Ferie, malattia, permessi, richieste di riposo e formazione restano sempre.
    if (opts && opts.regenerate) {
      work.employees.forEach(function (e) {
        var a = work.assignments[e.id] || {};
        monthDays(y, m).forEach(function (k) {
          if (SHIFTS[codeOf(a[k])] && !isLocked(state, e.id, k)) delete a[k];
        });
      });
    }
    // Punto di partenza: ciò che la proposta non può cambiare.
    var base = { settings: state.settings, employees: work.employees, locks: work.locks,
      assignments: JSON.parse(JSON.stringify(work.assignments)) };
    var minDrivers = settingNum(state, 'minDriversPerShift');
    var target = {}, done = {}, nights = {}, weight = {};
    work.employees.forEach(function (e) {
      if (!work.assignments[e.id]) work.assignments[e.id] = {};
      var s = monthSummary(work, e, y, m);
      target[e.id] = s.target;
      done[e.id] = s.worked + s.training + s.absence;
      nights[e.id] = s.nights;
      weight[e.id] = contractWeight(state, e) || 1;
    });

    var uncovered = [];
    var bypassed = [];
    monthDays(y, m).forEach(function (key) {
      var weekend = weekday(key) >= 5;
      var wStart = weekStart(key);
      ['G', 'N'].forEach(function (code) {
        var staffed = staffOn(work, key, code);
        var need = (+cfg.staffPerShift[code] || 0) - staffed.length;
        var driversNeeded = Math.max(0, minDrivers - staffed.filter(isDriver).length);
        while (need > 0) {
          var available = work.employees.filter(function (e) {
            return !work.assignments[e.id][key] && !isLocked(state, e.id, key) &&
              blockers(work, e.id, key, code).length === 0;
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

          // Le regole da evitare si superano solo se non c'è nessun'altra possibilità.
          var soft = {};
          candidates.forEach(function (e) { soft[e.id] = softBlockers(work, e.id, key, code); });
          var clean = candidates.filter(function (e) { return !soft[e.id].length; });
          if (clean.length) candidates = clean;

          var info = {};
          candidates.forEach(function (e) {
            var we = weekend ? weekendsWorked(work, e.id, y, m) : [];
            var streak = streakBefore(work, e.id, key);
            info[e.id] = {
              ratio: target[e.id] ? done[e.id] / target[e.id] : Infinity,
              over: done[e.id] + SHIFTS[code].hours > target[e.id] ? 1 : 0,
              inWeekend: we.some(function (w) { return w.week === wStart; }) ? 0 : 1,
              weekends: we.length / weight[e.id],
              nights: nights[e.id] / weight[e.id],
              // -1 continua un blocco di 1-2 giorni, +1 sarebbe il 4° giorno di fila, 0 altrimenti
              pattern: streak >= 3 ? 1 : streak >= 1 ? -1 : 0
            };
          });
          var preferNonDrivers = driversNeeded === 0;
          candidates.sort(function (a, b) {
            var ia = info[a.id], ib = info[b.id];
            if (ia.over !== ib.over) return ia.over - ib.over;
            if (weekend) {
              if (ia.inWeekend !== ib.inWeekend) return ia.inWeekend - ib.inWeekend;
              if (Math.abs(ia.weekends - ib.weekends) >= 1) return ia.weekends - ib.weekends;
            }
            // Non allungare un blocco oltre i 3 giorni (G G N, G N N), se c'è chi può farlo.
            if ((ia.pattern > 0) !== (ib.pattern > 0)) return ia.pattern > 0 ? 1 : -1;
            if (code === 'N' && Math.abs(ia.nights - ib.nights) >= 1) return ia.nights - ib.nights;
            // Risparmia gli autisti, ma solo finché non restano troppo indietro con le ore.
            if (preferNonDrivers && isDriver(a) !== isDriver(b) && Math.abs(ia.ratio - ib.ratio) < 0.1) {
              return isDriver(a) ? 1 : -1;
            }
            if (ia.pattern !== ib.pattern) return ia.pattern - ib.pattern;
            if (ia.ratio !== ib.ratio) return ia.ratio - ib.ratio;
            return String(a.name).localeCompare(String(b.name));
          });
          var pick = candidates[0];
          if (soft[pick.id].length) {
            bypassed.push({ date: key, shift: code, empId: pick.id, reasons: soft[pick.id] });
          }
          if (isDriver(pick)) driversNeeded = Math.max(0, driversNeeded - 1);
          work.assignments[pick.id][key] = code;
          done[pick.id] += SHIFTS[code].hours;
          if (code === 'N') nights[pick.id]++;
          need--;
        }
      });
    });

    improveMonth(work, base, y, m, target, weight);

    // Regole da evitare ancora superate in turni inseriti dalla proposta.
    var finalSoft = validateMonth(work, y, m).filter(function (i) {
      return i.level === 'soft' && i.dates.some(function (d) {
        return codeOn(work, i.empId, d) !== codeOn(base, i.empId, d);
      });
    });
    return { assignments: work.assignments, uncovered: uncovered, bypassed: finalSoft };
  }

  /*
   * Seconda fase della proposta: prova a scambiare i turni inseriti dalla proposta
   * (mai quelli scritti a mano) e tiene lo scambio solo se migliora il mese:
   * meno regole da evitare superate, notti/weekend/ore più equilibrati, blocchi G G N / G N N.
   * I vincoli rigidi (riposo, 48 h, autista nel turno) restano sempre rispettati.
   */
  function improveMonth(work, original, y, m, target, weight) {
    var emps = work.employees;
    if (emps.length < 2) return;
    var days = monthDays(y, m);
    var minDrivers = settingNum(original, 'minDriversPerShift');
    var maxRow = settingNum(original, 'maxSameInRow');
    var maxWe = settingNum(original, 'maxWeekendsPerMonth');

    function isFixed(id, key) { return !!empAssignments(original, id)[key] || isLocked(original, id, key); }

    // Valori "giusti" per ciascuno: totale del mese diviso in proporzione al contratto.
    var totW = 0, totN = 0, totWe = 0;
    emps.forEach(function (e) { totW += weight[e.id]; });
    var avgRatio = 0;
    function shares() {
      totN = 0; totWe = 0;
      var totDone = 0, totTarget = 0;
      emps.forEach(function (e) {
        var s = monthSummary(work, e, y, m);
        totDone += s.worked + s.training + s.absence;
        totTarget += target[e.id];
        totN += countCode(e.id, 'N');
        totWe += weekendsWorked(work, e.id, y, m).length;
      });
      avgRatio = totTarget ? totDone / totTarget : 0;
    }
    function countCode(id, code) {
      var n = 0;
      days.forEach(function (k) { if (codeOn(work, id, k) === code) n++; });
      return n;
    }

    function cost(e) {
      var id = e.id, c = 0;
      // regole da evitare
      var run = 0, prev = '', block = 0;
      for (var n = -7; n < days.length + 7; n++) {
        var key = addDays(days[0], n);
        var code = codeOn(work, id, key);
        var isShift = !!SHIFTS[code];
        run = isShift && code === prev ? run + 1 : isShift ? 1 : 0;
        if (run > maxRow && n >= 0 && n < days.length + maxRow) c += 100;
        block = isShift ? block + 1 : 0;
        if (block > 3 && n >= 0 && n < days.length) c += 4;          // 4° giorno di fila
        if (isShift && block === 1 && n >= 0 && n < days.length &&
          !SHIFTS[codeOn(work, id, addDays(key, 1))]) c += 1;      // turno isolato
        prev = isShift ? code : '';
      }
      var we = weekendsWorked(work, id, y, m).length;
      if (we > maxWe) c += 100 * (we - maxWe);
      var share = weight[id] / totW;
      var dn = countCode(id, 'N') - totN * share;
      var dw = we - totWe * share;
      // ore: scostamento dalla media, in proporzione al monte ore (circa in "turni")
      var s = monthSummary(work, e, y, m);
      var dh = target[id] ? ((s.worked + s.training + s.absence) / target[id] - avgRatio) * target[id] / 12 : 0;
      return c + 6 * dn * dn + 4 * dw * dw + 2 * dh * dh;
    }

    function driversOk(key, code) {
      var staff = staffOn(work, key, code);
      return !staff.length || staff.filter(isDriver).length >= minDrivers;
    }

    function setCode(id, key, code) {
      if (code) work.assignments[id][key] = code;
      else delete work.assignments[id][key];
    }

    // Prova una mossa: applica, controlla i vincoli rigidi e il costo, altrimenti annulla.
    function tryMove(changes, involved) {
      var before = 0;
      involved.forEach(function (e) { before += cost(e); });
      var old = changes.map(function (ch) { return codeOn(work, ch.id, ch.key); });
      changes.forEach(function (ch) { setCode(ch.id, ch.key, ch.code); });
      var ok = changes.every(function (ch) {
        return !ch.code || blockers(work, ch.id, ch.key, ch.code).length === 0;
      }) && changes.every(function (ch) {
        return driversOk(ch.key, 'G') && driversOk(ch.key, 'N');
      });
      if (ok) {
        var after = 0;
        involved.forEach(function (e) { after += cost(e); });
        if (after < before - 1e-9) return true;
      }
      changes.forEach(function (ch, i) { setCode(ch.id, ch.key, old[i]); });
      return false;
    }

    shares();
    for (var pass = 0; pass < 20; pass++) {
      var improved = false;
      days.forEach(function (key) {
        emps.forEach(function (x) {
          var cx = codeOn(work, x.id, key);
          if (!SHIFTS[cx] || isFixed(x.id, key)) return;
          emps.forEach(function (yE) {
            if (yE === x) return;
            var cy = codeOn(work, yE.id, key);
            if (!cy && !isLocked(original, yE.id, key)) {
              // il turno di x passa a y, libero quel giorno
              if (tryMove([{ id: x.id, key: key, code: '' }, { id: yE.id, key: key, code: cx }], [x, yE])) {
                improved = true;
                cx = '';
              }
            } else if (SHIFTS[cy] && cy !== cx && !isFixed(yE.id, key)) {
              // x e y si scambiano giorno e notte
              if (tryMove([{ id: x.id, key: key, code: cy }, { id: yE.id, key: key, code: cx }], [x, yE])) {
                improved = true;
                cx = cy;
              }
            }
          });
        });
      });
      if (!improved) break;
    }
  }

  var Rules = {
    SHIFTS: SHIFTS,
    ABSENCES: ABSENCES,
    OTHER: OTHER,
    ROLES: ROLES,
    isDriver: isDriver,
    codeOf: codeOf,
    codeOn: codeOn,
    isLocked: isLocked,
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
    monthWeekends: monthWeekends,
    weekendsWorked: weekendsWorked,
    softBlockers: softBlockers,
    generateMonth: generateMonth
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
  else root.Rules = Rules;
})(this);
