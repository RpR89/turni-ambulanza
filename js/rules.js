/*
 * Regole di pianificazione turni: calcolo ore, vincoli e proposta automatica.
 * Nessuna dipendenza dal DOM: usato dal browser (window.Rules) e dai test Node.
 *
 * I turni di lavoro sono definiti dalle ambulanze (Impostazioni): ogni ambulanza ha un
 * codice di 5 cifre e una o più fasce orarie, ciascuna con i suoi giorni della settimana.
 * Senza ambulanze configurate vale quella predefinita con G 07–19 e N 19–07 tutti i giorni.
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var ALL_DAYS = [true, true, true, true, true, true, true];

  // Ambulanza predefinita: copertura 24 ore con giorno e notte (anche i dati vecchi usano G e N).
  function preset24h() {
    return [
      { id: 'G', name: 'GIORNO', label: 'G', start: '07:00', end: '19:00', days: ALL_DAYS.slice() },
      { id: 'N', name: 'NOTTE', label: 'N', start: '19:00', end: '07:00', days: ALL_DAYS.slice() }
    ];
  }

  function defaultAmbulances() {
    return [{ id: 'A1', code: '', shifts: preset24h() }];
  }

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
   * Nell'archivio la formazione è { code: 'C', hours: 6 }; i turni sono l'id del turno
   * (es. 'G') oppure un elenco di id se nello stesso giorno ce n'è più di uno.
   */
  var OTHER = {
    P: { code: 'P', label: 'Permesso 104' },
    R: { code: 'R', label: 'Richiesta di non lavorare' },
    C: { code: 'C', label: 'Formazione' }
  };
  var RESERVED = { F: 1, M: 1, P: 1, R: 1, C: 1 };

  var DEFAULT_SETTINGS = {
    maxWeeklyHours: 48,
    maxDailyHours: 12,
    minRestHours: 11,
    fullTimeWeeklyHours: 38,
    crewSize: 2,
    perm104Hours: 7.6,
    perm104PerMonth: 3,
    minDriversPerShift: 1,
    maxSameInRow: 2,
    maxWeekendsPerMonth: 2,
    maxConsecutiveDays: 6,
    maxRestRequests: 4,
    requestDeadlineDay: 15
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

  function round1(x) { return Math.round(x * 10) / 10; }

  // ---------- Turni delle ambulanze ----------

  // "07:30" → 7.5
  function parseTime(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    if (!m) return null;
    var h = +m[1], min = +m[2];
    if (h > 24 || min > 59) return null;
    return h + min / 60;
  }

  var DEFAULT_AMBULANCES = defaultAmbulances();

  function ambulancesOf(state) {
    var a = state.settings && state.settings.ambulances;
    return Array.isArray(a) && a.length ? a : DEFAULT_AMBULANCES;
  }

  // Il catalogo si ricalcola solo quando cambia l'elenco delle ambulanze (nuovo oggetto);
  // chi modifica le ambulanze sul posto deve chiamare resetShiftCatalog().
  var catalogCache = { src: null, value: null };

  function resetShiftCatalog() { catalogCache = { src: null, value: null }; }

  /*
   * Catalogo dei turni: id → { id, ambId, ambCode, ambIndex, name, label, start, hours,
   * days, night, order }. `night` = il turno passa la mezzanotte (smonta il giorno dopo).
   */
  function shiftCatalog(state) {
    var ambs = ambulancesOf(state);
    if (catalogCache.src === ambs) return catalogCache.value;
    var out = { list: [], byId: {} };
    ambs.forEach(function (amb, ai) {
      (amb.shifts || []).forEach(function (s) {
        var st = parseTime(s.start), en = parseTime(s.end);
        if (st == null || en == null || !s.id || RESERVED[s.id]) return;
        var hours = en > st ? en - st : en + 24 - st; // inizio = fine → 24 ore
        var info = {
          id: s.id, ambId: amb.id, ambCode: amb.code || '', ambIndex: ai,
          name: s.name || s.label || s.id, label: s.label || s.id,
          start: st, hours: round1(hours), startText: s.start, endText: s.end,
          days: Array.isArray(s.days) && s.days.length === 7 ? s.days.map(Boolean) : ALL_DAYS.slice(),
          night: st + hours > 24,
          order: out.list.length
        };
        out.list.push(info);
        out.byId[info.id] = info;
      });
    });
    catalogCache = { src: ambs, value: out };
    return out;
  }

  function shiftInfo(state, id) { return shiftCatalog(state).byId[id] || null; }

  // Turni previsti in un giorno (in base ai giorni della settimana di ciascuno), per ora d'inizio.
  function shiftsForDay(state, key) {
    var wd = weekday(key);
    return shiftCatalog(state).list.filter(function (s) { return s.days[wd]; })
      .sort(function (a, b) { return a.start - b.start || a.order - b.order; });
  }

  function shiftText(s) {
    return s.label + (s.ambCode ? ' (' + s.ambCode + ')' : '');
  }

  // ---------- Caselle ----------

  function empAssignments(state, empId) {
    return (state.assignments && state.assignments[empId]) || {};
  }

  // Codice di una voce non di lavoro (F, M, P, R, C); '' per i turni o la casella vuota.
  function codeOf(entry) {
    if (!entry || Array.isArray(entry)) return '';
    if (typeof entry === 'string') return RESERVED[entry] ? entry : '';
    return entry.code || '';
  }

  function codeOn(state, empId, key) { return codeOf(empAssignments(state, empId)[key]); }

  // Id dei turni scritti in una voce (stringa singola o elenco), solo quelli che esistono.
  function shiftIdsOf(state, entry) {
    if (!entry) return [];
    var cat = shiftCatalog(state).byId;
    if (typeof entry === 'string') return cat[entry] ? [entry] : [];
    if (Array.isArray(entry)) return entry.filter(function (id) { return cat[id]; });
    return [];
  }

  function shiftIdsOn(state, empId, key) { return shiftIdsOf(state, empAssignments(state, empId)[key]); }

  function hasShiftOn(state, empId, key) { return shiftIdsOn(state, empId, key).length > 0; }

  // Voce da salvare per un elenco di turni: stringa se è uno solo, elenco se sono più.
  function shiftEntry(ids) {
    if (!ids.length) return '';
    return ids.length === 1 ? ids[0] : ids.slice();
  }

  // Categoria del giorno per le sequenze: 'N' se c'è un turno di notte, 'G' se solo di giorno.
  function dayCategory(state, empId, key) {
    var ids = shiftIdsOn(state, empId, key);
    if (!ids.length) return '';
    return ids.some(function (id) { return shiftInfo(state, id).night; }) ? 'N' : 'G';
  }

  // Turno inserito dalla proposta automatica (e non toccato a mano da allora).
  // In archivio: true (tutti i turni della casella) oppure l'elenco degli id automatici.
  function autoIdsOn(state, empId, key) {
    var v = state.auto && state.auto[empId] && state.auto[empId][key];
    if (!v) return [];
    var ids = shiftIdsOn(state, empId, key);
    return v === true ? ids : ids.filter(function (id) { return v.indexOf(id) >= 0; });
  }

  // La casella è "automatica" se tutti i suoi turni sono stati messi dalla proposta.
  function isAuto(state, empId, key) {
    var ids = shiftIdsOn(state, empId, key);
    return ids.length > 0 && autoIdsOn(state, empId, key).length === ids.length;
  }

  // Casella bloccata: la proposta automatica non la cambia mai (né la riempie se è vuota).
  function isLocked(state, empId, key) {
    return !!(state.locks && state.locks[empId] && state.locks[empId][key]);
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

  function shiftHoursOn(state, empId, key) {
    var tot = 0;
    shiftIdsOn(state, empId, key).forEach(function (id) { tot += shiftInfo(state, id).hours; });
    return tot;
  }

  // Ore di lavoro effettivo del giorno: turni e formazione.
  // Un turno appartiene al giorno (e quindi a settimana e mese) in cui inizia.
  function workHoursOn(state, empId, key) {
    var entry = empAssignments(state, empId)[key];
    if (codeOf(entry) === 'C') return +entry.hours || 0;
    return shiftHoursOn(state, empId, key);
  }

  function settingNum(state, name) {
    var s = state.settings || {};
    if (name === 'crewSize' && s.crewSize == null && s.staffPerShift) return +s.staffPerShift.G || 0;
    return s[name] != null ? +s[name] : DEFAULT_SETTINGS[name];
  }

  function monthSummary(state, emp, y, m) {
    var a = empAssignments(state, emp.id);
    var worked = 0, training = 0, absence = 0, nights = 0;
    var counts = { F: 0, M: 0, P: 0, R: 0, C: 0 };
    monthDays(y, m).forEach(function (key) {
      var ids = shiftIdsOf(state, a[key]);
      ids.forEach(function (id) {
        var s = shiftInfo(state, id);
        worked += s.hours;
        counts[id] = (counts[id] || 0) + 1;
        if (s.night) nights++;
      });
      var code = codeOf(a[key]);
      if (!code) return;
      counts[code]++;
      if (code === 'C') training += workHoursOn(state, emp.id, key);
      else if (code === 'P') absence += settingNum(state, 'perm104Hours');
      else if (ABSENCES[code] && isWorkingDay(key)) absence += dailyHours(emp);
    });
    var target = monthlyTarget(emp, y, m);
    worked = round1(worked);
    absence = round1(absence);
    training = round1(training);
    return {
      worked: worked,
      training: training,
      absence: absence,
      target: target,
      balance: round1(worked + training + absence - target),
      counts: counts,
      nights: nights,
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
      return we.days.some(function (k) { return hasShiftOn(state, empId, k); });
    });
  }

  // Giorni di fila con la stessa categoria (G = giorno, N = notte) mettendo `cat` il giorno `key`.
  function sameRunWith(state, empId, key, cat) {
    var n = 1, d;
    for (d = addDays(key, -1); dayCategory(state, empId, d) === cat; d = addDays(d, -1)) n++;
    for (d = addDays(key, 1); dayCategory(state, empId, d) === cat; d = addDays(d, 1)) n++;
    return n;
  }

  // Giorni consecutivi di turno che terminano il giorno prima di `key`.
  function streakBefore(state, empId, key) {
    var n = 0;
    for (var d = addDays(key, -1); hasShiftOn(state, empId, d); d = addDays(d, -1)) n++;
    return n;
  }

  // Turni della settimana (lun–dom) per l'equilibrio settimanale; le notti che iniziano la
  // domenica non contano, perché finiscono nella settimana dopo. Con `onlyMonth` solo il mese.
  function weekShiftCount(state, empId, monday, onlyMonth) {
    var n = 0;
    for (var i = 0; i < 7; i++) {
      var k = addDays(monday, i);
      if (onlyMonth && k.slice(0, 7) !== onlyMonth) continue;
      shiftIdsOn(state, empId, k).forEach(function (id) {
        if (!(i === 6 && shiftInfo(state, id).night)) n++;
      });
    }
    return n;
  }

  // Peso del contratto per confrontare notti e weekend: part-time 24 h → 24/38.
  function contractWeight(state, emp) {
    return (emp.weeklyHours || 38) / settingNum(state, 'fullTimeWeeklyHours');
  }

  /*
   * Regole "da evitare" (superabili solo se non c'è alternativa) violate aggiungendo il turno
   * `shiftId` il giorno `key`: più di 2 giorni o 2 notti di fila, più di 2 weekend nel mese.
   */
  function softBlockers(state, empId, key, shiftId) {
    var reasons = [];
    var s = shiftInfo(state, shiftId);
    var cat = s.night ? 'N' : 'G';
    var maxRow = settingNum(state, 'maxSameInRow');
    var run = sameRunWith(state, empId, key, cat);
    if (run > maxRow) reasons.push(run + ' turni ' + cat + ' di fila');
    if (weekday(key) >= 5 && !hasShiftOn(state, empId, key)) {
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
  function shiftSpan(state, key, id) {
    var s = shiftInfo(state, id);
    var start = dayNumber(key) * 24 + s.start;
    return { start: start, end: start + s.hours };
  }

  // Turni del dipendente nell'intervallo [from, to], in ordine di inizio.
  function shiftsBetween(state, empId, fromKey, toKey_) {
    var out = [];
    for (var n = dayNumber(fromKey); n <= dayNumber(toKey_); n++) {
      var key = keyFromDayNumber(n);
      shiftIdsOn(state, empId, key).forEach(function (id) {
        var sp = shiftSpan(state, key, id);
        out.push({ key: key, id: id, start: sp.start, end: sp.end });
      });
    }
    return out.sort(function (a, b) { return a.start - b.start; });
  }

  // Giorno di lavoro: inizia un turno oppure si smonta una notte iniziata il giorno prima.
  function workedDay(state, empId, key) {
    if (hasShiftOn(state, empId, key)) return true;
    var prev = addDays(key, -1), midnight = dayNumber(key) * 24;
    return shiftIdsOn(state, empId, prev).some(function (id) { return shiftSpan(state, prev, id).end > midnight; });
  }

  // Giorni di lavoro di fila (smonto compreso) se il dipendente facesse anche il turno `shiftId` il giorno `key`.
  function runWith(state, empId, key, shiftId) {
    var span = shiftSpan(state, key, shiftId);
    var from = dayNumber(key);
    var to = span.end > (from + 1) * 24 ? from + 1 : from;   // la notte occupa anche il giorno dello smonto
    var limit = 31;
    while (limit-- && workedDay(state, empId, keyFromDayNumber(from - 1))) from--;
    limit = 31;
    while (limit-- && workedDay(state, empId, keyFromDayNumber(to + 1))) to++;
    return { from: keyFromDayNumber(from), to: keyFromDayNumber(to), days: to - from + 1 };
  }

  function settingsOf(state) {
    return {
      maxWeeklyHours: settingNum(state, 'maxWeeklyHours'),
      maxDailyHours: settingNum(state, 'maxDailyHours'),
      minRestHours: settingNum(state, 'minRestHours'),
      crewSize: settingNum(state, 'crewSize'),
      minDrivers: settingNum(state, 'minDriversPerShift'),
      maxConsecutive: settingNum(state, 'maxConsecutiveDays')
    };
  }

  /*
   * Motivi per cui il dipendente non può aggiungere il turno `shiftId` il giorno `key`,
   * tenendo conto degli altri turni che ha già (anche nello stesso giorno). Array vuoto = ok.
   */
  function blockers(state, empId, key, shiftId) {
    var cfg = settingsOf(state);
    var reasons = [];
    var s = shiftInfo(state, shiftId);
    var span = shiftSpan(state, key, shiftId);
    var label = function (id) { return shiftText(shiftInfo(state, id)); };

    shiftsBetween(state, empId, addDays(key, -2), addDays(key, 2)).forEach(function (o) {
      if (o.key === key && o.id === shiftId) return;
      var gap = o.start >= span.end ? o.start - span.end : span.start - o.end;
      if (gap < cfg.minRestHours) {
        reasons.push('riposo di ' + round1(Math.max(gap, 0)) + ' h con il turno ' + label(o.id) + ' del ' + o.key +
          ' (minimo ' + cfg.minRestHours + ' h)');
      }
    });

    // Un turno che passa la mezzanotte finisce il giorno dopo: non si smonta notte il giorno di un corso.
    if (s.night && codeOn(state, empId, addDays(key, 1)) === 'C') {
      reasons.push('il ' + addDays(key, 1) + ' c\'è la formazione: non può smontare notte quel giorno');
    }

    var already = shiftIdsOn(state, empId, key).indexOf(shiftId) >= 0 ? s.hours : 0;
    var day = round1(workHoursOn(state, empId, key) - already + s.hours);
    if (day > cfg.maxDailyHours) {
      reasons.push(day + ' h il ' + key + ' (massimo ' + cfg.maxDailyHours + ' h al giorno)');
    }

    if (cfg.maxConsecutive > 0) {
      var run = runWith(state, empId, key, shiftId);
      if (run.days > cfg.maxConsecutive) {
        reasons.push(run.days + ' giorni di lavoro di fila dal ' + run.from + ' al ' + run.to +
          ', smonto notte compreso (massimo ' + cfg.maxConsecutive + ')');
      }
    }

    var monday = weekStart(key);
    var hours = round1(weekHours(state, empId, monday) - already + s.hours);
    if (hours > cfg.maxWeeklyHours) {
      reasons.push(hours + ' h nella settimana dal ' + monday + ' (massimo ' + cfg.maxWeeklyHours + ' h)');
    }
    return reasons;
  }

  /*
   * Tutti i problemi del mese: violazioni dei vincoli (errori), regole da evitare (soft) e
   * copertura dei turni diversa da quella richiesta (avvisi).
   */
  function validateMonth(state, y, m) {
    var cfg = settingsOf(state);
    var days = monthDays(y, m);
    var first = days[0], last = days[days.length - 1];
    var issues = [];
    var label = function (id) { return shiftText(shiftInfo(state, id)); };

    activeOf(state).forEach(function (emp) {
      // Riposo: controlla anche i turni a cavallo con il mese prima/dopo.
      var shifts = shiftsBetween(state, emp.id, addDays(first, -1), addDays(last, 1));
      for (var i = 1; i < shifts.length; i++) {
        var prev = shifts[i - 1], cur = shifts[i];
        var gap = cur.start - prev.end;
        var inMonth = cur.key >= first && cur.key <= last;
        if (gap < cfg.minRestHours && (inMonth || prev.key >= first)) {
          issues.push({
            level: 'error', type: 'rest', empId: emp.id,
            dates: prev.key === cur.key ? [cur.key] : [prev.key, cur.key],
            message: 'Riposo di ' + round1(Math.max(gap, 0)) + ' h tra ' + label(prev.id) + ' del ' +
              prev.key + ' e ' + label(cur.id) + ' del ' + cur.key + ' (minimo ' + cfg.minRestHours + ' h)'
          });
        }
      }

      // Massimo di ore al giorno (turni che iniziano quel giorno).
      days.forEach(function (k) {
        var h = workHoursOn(state, emp.id, k);
        if (h > cfg.maxDailyHours) {
          issues.push({
            level: 'error', type: 'daily', empId: emp.id, dates: [k],
            message: h + ' h il ' + k + ' (massimo ' + cfg.maxDailyHours + ' h al giorno)'
          });
        }
      });

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

      // Massimo di giorni di lavoro di fila, contando anche il giorno dello smonto notte.
      if (cfg.maxConsecutive > 0) {
        var work = [];
        var flushWork = function () {
          if (work.length > cfg.maxConsecutive && work.some(function (k) { return k >= first && k <= last; })) {
            issues.push({
              level: 'error', type: 'consecutive', empId: emp.id, dates: work.slice(),
              message: work.length + ' giorni di lavoro di fila dal ' + work[0] + ' al ' + work[work.length - 1] +
                ', smonto notte compreso (massimo ' + cfg.maxConsecutive + ')'
            });
          }
          work = [];
        };
        for (var wn = dayNumber(first) - 14; wn <= dayNumber(last) + 14; wn++) {
          var wk = keyFromDayNumber(wn);
          if (workedDay(state, emp.id, wk)) work.push(wk); else flushWork();
        }
        flushWork();
      }

      // Da evitare: più di N giorni (o notti) di fila, anche a cavallo dei mesi.
      var maxRow = settingNum(state, 'maxSameInRow');
      var run = [], runCat = '';
      function flush() {
        if (run.length > maxRow && run.some(function (k) { return k >= first && k <= last; })) {
          issues.push({
            level: 'soft', type: 'sequence', empId: emp.id, dates: run.slice(),
            message: run.length + ' turni ' + runCat + ' di fila dal ' + run[0] + ' (da evitare più di ' + maxRow + ')'
          });
        }
      }
      for (var n = dayNumber(first) - 7; n <= dayNumber(last) + 7; n++) {
        var k = keyFromDayNumber(n);
        var cat = dayCategory(state, emp.id, k);
        if (cat && cat === runCat) run.push(k);
        else { flush(); run = cat ? [k] : []; runCat = cat; }
      }
      flush();

      // Da evitare: più di N weekend lavorati nel mese.
      var maxWe = settingNum(state, 'maxWeekendsPerMonth');
      var weList = weekendsWorked(state, emp.id, y, m);
      if (weList.length > maxWe) {
        var weDates = [];
        weList.forEach(function (we) {
          we.days.forEach(function (k) { if (hasShiftOn(state, emp.id, k)) weDates.push(k); });
        });
        issues.push({
          level: 'soft', type: 'weekends', empId: emp.id, dates: weDates,
          message: weList.length + ' weekend lavorati nel mese (da evitare più di ' + maxWe + ')'
        });
      }

      // Formazione: il giorno del corso non può smontare notte (turno notturno il giorno prima).
      days.concat([addDays(last, 1)]).forEach(function (k) {
        var prev = addDays(k, -1);
        if (codeOn(state, emp.id, k) !== 'C' || !(k >= first && k <= last || prev >= first)) return;
        shiftIdsOn(state, emp.id, prev).forEach(function (id) {
          if (!shiftInfo(state, id).night) return;
          issues.push({
            level: 'error', type: 'training', empId: emp.id, dates: [prev, k],
            message: 'Notte ' + label(id) + ' del ' + prev + ' e formazione il ' + k +
              ': non può smontare notte il giorno del corso'
          });
        });
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
      var wd = weekday(key);
      shiftCatalog(state).list.forEach(function (s) {
        var need = s.days[wd] ? cfg.crewSize : 0;
        var staff = staffOn(state, key, s.id);
        var have = staff.length;
        if (have !== need) {
          issues.push({
            level: 'warning', type: 'coverage', dates: [key], shift: s.id,
            message: 'Turno ' + shiftText(s) + ' del ' + key + ': ' + have + ' su ' + need +
              (have < need ? ' (scoperto)' : need ? ' (in eccesso)' : ' (turno non previsto quel giorno)')
          });
        }
        // Un turno con personale deve avere almeno un autista soccorritore.
        var drivers = staff.filter(isDriver).length;
        if (have > 0 && drivers < cfg.minDrivers) {
          issues.push({
            level: 'error', type: 'driver', dates: [key], shift: s.id,
            empIds: staff.map(function (e) { return e.id; }),
            message: 'Turno ' + shiftText(s) + ' del ' + key + ': ' +
              (drivers ? drivers + ' autisti soccorritori su ' + cfg.minDrivers + ' richiesti' : 'manca l\'autista soccorritore')
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

  function staffOn(state, key, shiftId) {
    return activeOf(state).filter(function (e) {
      return shiftIdsOn(state, e.id, key).indexOf(shiftId) >= 0;
    });
  }

  // ---------- Proposta automatica ----------

  function addShift(work, empId, key, id) {
    var ids = shiftIdsOn(work, empId, key);
    if (ids.indexOf(id) < 0) ids.push(id);
    work.assignments[empId][key] = shiftEntry(ids);
  }

  function removeShift(work, empId, key, id) {
    var ids = shiftIdsOn(work, empId, key).filter(function (x) { return x !== id; });
    var e = shiftEntry(ids);
    if (e) work.assignments[empId][key] = e;
    else delete work.assignments[empId][key];
  }

  /*
   * Riempie i turni scoperti del mese senza toccare quello che è già inserito.
   *
   * Vincoli rigidi (mai superati): riposo minimo, massimo giornaliero e settimanale,
   * ferie/assenze/formazione/richieste nel giorno, caselle bloccate.
   * Regole da evitare (superate solo se nessun altro può coprire il posto): più di 2 giorni
   * o 2 notti di fila, più di 2 weekend nel mese.
   * Tra i candidati validi sceglie, in ordine:
   *  1. chi non supera il proprio monte ore;
   *  2. nel weekend, chi lavora già quel weekend (così se ne consumano meno), poi chi ne ha fatti meno;
   *  3. chi non arriverebbe al 4° giorno di lavoro di fila (blocchi G G N, G N N);
   *  4. turni distribuiti in modo uniforme tra le settimane;
   *  5. per le notti, chi ne ha fatte meno (in proporzione al contratto);
   *  6. a autista già presente, un soccorritore, se non è molto più avanti con le ore;
   *  7. chi continua un blocco di lavoro invece di iniziarne uno nuovo;
   *  8. chi è più indietro con il monte ore.
   * Restituisce le nuove assegnazioni, i turni automatici, i posti scoperti e le regole superate.
   */
  function generateMonth(state, y, m, opts) {
    var cfg = settingsOf(state);
    var work = {
      settings: state.settings,
      employees: activeOf(state),
      assignments: JSON.parse(JSON.stringify(state.assignments || {})),
      locks: state.locks || {}
    };
    var auto = JSON.parse(JSON.stringify(state.auto || {}));
    work.employees.forEach(function (e) { if (!work.assignments[e.id]) work.assignments[e.id] = {}; });

    // "Rifai proposta": toglie e ricalcola solo i turni inseriti dalla proposta e non bloccati.
    // I turni scritti a mano, ferie, malattia, permessi, richieste di riposo e formazione restano.
    if (opts && opts.regenerate) {
      work.employees.forEach(function (e) {
        monthDays(y, m).forEach(function (k) {
          if (isLocked(state, e.id, k)) return;
          autoIdsOn(state, e.id, k).forEach(function (id) { removeShift(work, e.id, k, id); });
          if (auto[e.id]) delete auto[e.id][k];
        });
      });
    }
    // Punto di partenza: ciò che la proposta non può cambiare.
    var base = { settings: state.settings, employees: work.employees, locks: work.locks,
      assignments: JSON.parse(JSON.stringify(work.assignments)) };

    var target = {}, done = {}, nights = {}, weight = {};
    work.employees.forEach(function (e) {
      var s = monthSummary(work, e, y, m);
      target[e.id] = s.target;
      done[e.id] = s.worked + s.training + s.absence;
      nights[e.id] = s.nights;
      weight[e.id] = contractWeight(state, e) || 1;
    });

    var uncovered = [];
    // Prima i weekend (il limite di 2 al mese è il vincolo più stretto), poi i giorni feriali.
    var allDays = monthDays(y, m);
    var order = allDays.filter(function (k) { return weekday(k) >= 5; })
      .concat(allDays.filter(function (k) { return weekday(k) < 5; }));
    order.forEach(function (key) {
      var weekend = weekday(key) >= 5;
      var wStart = weekStart(key);
      shiftsForDay(work, key).forEach(function (sh) {
        var code = sh.id;
        var staffed = staffOn(work, key, code);
        var need = cfg.crewSize - staffed.length;
        var driversNeeded = Math.max(0, cfg.minDrivers - staffed.filter(isDriver).length);
        while (need > 0) {
          var available = work.employees.filter(function (e) {
            return !codeOn(work, e.id, key) && !isLocked(state, e.id, key) &&
              shiftIdsOn(work, e.id, key).indexOf(code) < 0 &&
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
              over: done[e.id] + sh.hours > target[e.id] ? 1 : 0,
              inWeekend: we.some(function (w) { return w.week === wStart; }) ? 0 : 1,
              weekends: we.length / weight[e.id],
              nights: nights[e.id] / weight[e.id],
              week: weekShiftCount(work, e.id, wStart) / weight[e.id],
              // -1 continua un blocco di 1-2 giorni, +1 sarebbe il 4° giorno di fila, 0 altrimenti
              pattern: streak >= 3 ? 1 : streak >= 1 ? -1 : 0,
              sameDay: hasShiftOn(work, e.id, key) ? 1 : 0
            };
          });
          var preferNonDrivers = driversNeeded === 0;
          candidates.sort(function (a, b) {
            var ia = info[a.id], ib = info[b.id];
            if (ia.over !== ib.over) return ia.over - ib.over;
            // Un secondo turno nello stesso giorno solo se serve.
            if (ia.sameDay !== ib.sameDay) return ia.sameDay - ib.sameDay;
            if (weekend) {
              if (ia.inWeekend !== ib.inWeekend) return ia.inWeekend - ib.inWeekend;
              if (Math.abs(ia.weekends - ib.weekends) >= 1) return ia.weekends - ib.weekends;
            }
            // Non allungare un blocco oltre i 3 giorni (G G N, G N N), se c'è chi può farlo.
            if ((ia.pattern > 0) !== (ib.pattern > 0)) return ia.pattern > 0 ? 1 : -1;
            // Turni distribuiti in modo uniforme tra le settimane.
            if (Math.abs(ia.week - ib.week) >= 1) return ia.week - ib.week;
            if (sh.night && Math.abs(ia.nights - ib.nights) >= 1) return ia.nights - ib.nights;
            // Risparmia gli autisti, ma solo finché non restano troppo indietro con le ore.
            if (preferNonDrivers && isDriver(a) !== isDriver(b) && Math.abs(ia.ratio - ib.ratio) < 0.1) {
              return isDriver(a) ? 1 : -1;
            }
            if (ia.pattern !== ib.pattern) return ia.pattern - ib.pattern;
            if (ia.ratio !== ib.ratio) return ia.ratio - ib.ratio;
            return String(a.name).localeCompare(String(b.name));
          });
          var pick = candidates[0];
          if (isDriver(pick)) driversNeeded = Math.max(0, driversNeeded - 1);
          addShift(work, pick.id, key, code);
          done[pick.id] += sh.hours;
          if (sh.night) nights[pick.id]++;
          need--;
        }
      });
    });

    improveMonth(work, base, y, m, target, weight);

    // Turni messi (o spostati) dalla proposta: automatici.
    var isNew = function (id, k, sid) { return shiftIdsOn(base, id, k).indexOf(sid) < 0; };
    work.employees.forEach(function (e) {
      monthDays(y, m).forEach(function (k) {
        var added = shiftIdsOn(work, e.id, k).filter(function (sid) { return isNew(e.id, k, sid); });
        if (!added.length) return;
        var keep = autoIdsOn(Object.assign({}, work, { auto: auto }), e.id, k)
          .filter(function (sid) { return added.indexOf(sid) < 0; });
        if (!auto[e.id]) auto[e.id] = {};
        auto[e.id][k] = keep.concat(added);
      });
    });

    // Regole da evitare ancora superate in turni inseriti dalla proposta.
    var finalSoft = validateMonth(work, y, m).filter(function (i) {
      return i.level === 'soft' && i.dates.some(function (d) {
        return shiftIdsOn(work, i.empId, d).some(function (sid) { return isNew(i.empId, d, sid); });
      });
    });
    return { assignments: work.assignments, auto: auto, uncovered: uncovered, bypassed: finalSoft };
  }

  /*
   * Seconda fase della proposta: prova a spostare o scambiare i turni inseriti dalla proposta
   * (mai quelli scritti a mano) e tiene la modifica solo se migliora il mese:
   * meno regole da evitare superate, notti/weekend/ore/settimane più equilibrati, blocchi G G N.
   * I vincoli rigidi (riposo, 12 h al giorno, 48 h, autista nel turno) restano sempre rispettati.
   */
  function improveMonth(work, original, y, m, target, weight) {
    var emps = work.employees;
    if (emps.length < 2) return;
    var days = monthDays(y, m);
    var minDrivers = settingNum(original, 'minDriversPerShift');
    var maxRow = settingNum(original, 'maxSameInRow');
    var maxWe = settingNum(original, 'maxWeekendsPerMonth');

    function isFixed(id, key, sid) {
      return isLocked(original, id, key) || shiftIdsOn(original, id, key).indexOf(sid) >= 0;
    }

    function countNights(id) {
      var n = 0;
      days.forEach(function (k) {
        shiftIdsOn(work, id, k).forEach(function (sid) { if (shiftInfo(work, sid).night) n++; });
      });
      return n;
    }

    // Valori "giusti" per ciascuno: totale del mese diviso in proporzione al contratto.
    var totW = 0, totN = 0, totWe = 0, avgRatio = 0;
    emps.forEach(function (e) { totW += weight[e.id]; });
    (function shares() {
      var totDone = 0, totTarget = 0;
      emps.forEach(function (e) {
        var s = monthSummary(work, e, y, m);
        totDone += s.worked + s.training + s.absence;
        totTarget += target[e.id];
        totN += countNights(e.id);
        totWe += weekendsWorked(work, e.id, y, m).length;
      });
      avgRatio = totTarget ? totDone / totTarget : 0;
    })();

    var weeks = monthWeeks(y, m).map(function (w) {
      var n = 0;
      for (var i = 0; i < 7; i++) if (addDays(w, i).slice(0, 7) === days[0].slice(0, 7)) n++;
      return { monday: w, days: n };
    });

    function cost(e) {
      var id = e.id, c = 0;
      // regole da evitare
      var run = 0, prev = '', block = 0;
      for (var n = -7; n < days.length + 7; n++) {
        var key = addDays(days[0], n);
        var cat = dayCategory(work, id, key);
        run = cat && cat === prev ? run + 1 : cat ? 1 : 0;
        if (run > maxRow && n >= 0 && n < days.length + maxRow) c += 100;
        block = cat ? block + 1 : 0;
        if (block > 3 && n >= 0 && n < days.length) c += 4;          // 4° giorno di fila
        if (cat && block === 1 && n >= 0 && n < days.length &&
          !hasShiftOn(work, id, addDays(key, 1))) c += 1;             // turno isolato
        if (n >= 0 && n < days.length && shiftIdsOn(work, id, key).length > 1) c += 3; // due turni nel giorno
        prev = cat;
      }
      var we = weekendsWorked(work, id, y, m).length;
      if (we > maxWe) c += 300 * (we - maxWe);
      // equilibrio tra le settimane: ogni settimana in proporzione ai suoi giorni nel mese
      var monthKey = days[0].slice(0, 7), tot = 0, wc = [];
      weeks.forEach(function (w) { var n = weekShiftCount(work, id, w.monday, monthKey); wc.push(n); tot += n; });
      weeks.forEach(function (w, i) { var d = wc[i] - tot * w.days / days.length; c += 5 * d * d; });
      var share = weight[id] / totW;
      var dn = countNights(id) - totN * share;
      var dw = we - totWe * share;
      // ore: scostamento dalla media, in proporzione al monte ore (circa in "turni")
      var s = monthSummary(work, e, y, m);
      var dh = target[id] ? ((s.worked + s.training + s.absence) / target[id] - avgRatio) * target[id] / 12 : 0;
      return c + 6 * dn * dn + 4 * dw * dw + 2 * dh * dh;
    }

    function driversOk(key, sid) {
      var staff = staffOn(work, key, sid);
      return !staff.length || staff.filter(isDriver).length >= minDrivers;
    }

    // Prova una mossa (elenco di [dipendente, giorno, turno tolto, turno aggiunto]):
    // applica, controlla i vincoli rigidi e il costo, altrimenti annulla.
    function tryMove(moves, involved) {
      var before = 0;
      involved.forEach(function (e) { before += cost(e); });
      var snapshot = moves.map(function (mv) { return [mv.emp, mv.key, work.assignments[mv.emp][mv.key]]; });
      moves.forEach(function (mv) { if (mv.remove) removeShift(work, mv.emp, mv.key, mv.remove); });
      moves.forEach(function (mv) { if (mv.add) addShift(work, mv.emp, mv.key, mv.add); });
      var ok = moves.every(function (mv) {
        return !mv.add || blockers(work, mv.emp, mv.key, mv.add).length === 0;
      }) && moves.every(function (mv) {
        return (!mv.add || driversOk(mv.key, mv.add)) && (!mv.remove || driversOk(mv.key, mv.remove));
      });
      if (ok) {
        var after = 0;
        involved.forEach(function (e) { after += cost(e); });
        if (after < before - 1e-9) return true;
      }
      snapshot.forEach(function (s) {
        if (s[2] === undefined) delete work.assignments[s[0]][s[1]];
        else work.assignments[s[0]][s[1]] = s[2];
      });
      return false;
    }

    function freeFor(emp, key) { return !codeOn(work, emp, key) && !isLocked(original, emp, key); }

    for (var pass = 0; pass < 20; pass++) {
      var improved = false;
      days.forEach(function (key) {
        emps.forEach(function (x) {
          shiftIdsOn(work, x.id, key).forEach(function (sx) {
            if (isFixed(x.id, key, sx) || shiftIdsOn(work, x.id, key).indexOf(sx) < 0) return;
            for (var j = 0; j < emps.length; j++) {
              var yE = emps[j];
              if (yE === x || !freeFor(yE.id, key)) continue;
              var ys = shiftIdsOn(work, yE.id, key);
              if (ys.indexOf(sx) >= 0) continue;
              if (!ys.length) {
                // il turno di x passa a y, libero quel giorno
                if (tryMove([{ emp: x.id, key: key, remove: sx }, { emp: yE.id, key: key, add: sx }], [x, yE])) {
                  improved = true;
                  return;
                }
              } else if (ys.length === 1 && shiftIdsOn(work, x.id, key).length === 1 && !isFixed(yE.id, key, ys[0])) {
                // x e y si scambiano i turni del giorno (es. giorno e notte)
                var sy = ys[0];
                if (tryMove([{ emp: x.id, key: key, remove: sx, add: sy }, { emp: yE.id, key: key, remove: sy, add: sx }], [x, yE])) {
                  improved = true;
                  return;
                }
              }
            }
          });
        });
      });
      if (!improved) break;
    }
  }

  var Rules = {
    ABSENCES: ABSENCES,
    OTHER: OTHER,
    ROLES: ROLES,
    RESERVED_CODES: Object.keys(RESERVED),
    preset24h: preset24h,
    defaultAmbulances: defaultAmbulances,
    parseTime: parseTime,
    ambulancesOf: ambulancesOf,
    shiftCatalog: shiftCatalog,
    resetShiftCatalog: resetShiftCatalog,
    shiftInfo: shiftInfo,
    shiftsForDay: shiftsForDay,
    shiftText: shiftText,
    isDriver: isDriver,
    codeOf: codeOf,
    codeOn: codeOn,
    shiftIdsOf: shiftIdsOf,
    shiftIdsOn: shiftIdsOn,
    shiftEntry: shiftEntry,
    hasShiftOn: hasShiftOn,
    autoIdsOn: autoIdsOn,
    isLocked: isLocked,
    isAuto: isAuto,
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
    weekShiftCount: weekShiftCount,
    workedDay: workedDay,
    generateMonth: generateMonth
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
  else root.Rules = Rules;
})(this);
