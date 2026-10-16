/* Interfaccia del tabellone turni. Le regole stanno in rules.js (window.Rules). */
(function () {
  'use strict';

  var R = window.Rules;
  var STORAGE_KEY = 'turni-ambulanza:v1';
  var MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio',
    'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  var WEEKDAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  var CODES = ['G', 'N', 'F', 'M', 'P', 'R', 'C'];

  // ---------- Stato ----------

  function emptyState() {
    return {
      version: 1,
      settings: JSON.parse(JSON.stringify(R.DEFAULT_SETTINGS)),
      employees: [],
      assignments: {},
      locks: {},
      auto: {}
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* storage non disponibile o dati corrotti: si riparte vuoti */ }
    return emptyState();
  }

  function normalize(s) {
    var base = emptyState();
    if (!s || typeof s !== 'object' || !Array.isArray(s.employees)) throw new Error('Formato non valido');
    base.settings = Object.assign(base.settings, s.settings || {});
    base.settings.staffPerShift = Object.assign({}, R.DEFAULT_SETTINGS.staffPerShift,
      (s.settings && s.settings.staffPerShift) || {});
    base.employees = s.employees.map(function (e) {
      return {
        id: String(e.id), name: String(e.name || ''), weeklyHours: +e.weeklyHours || 38,
        role: e.role === 'autista' ? 'autista' : 'soccorritore',
        shortName: e.shortName ? String(e.shortName) : '',
        has104: !!e.has104, active: e.active !== false
      };
    });
    base.assignments = s.assignments && typeof s.assignments === 'object' ? s.assignments : {};
    base.locks = s.locks && typeof s.locks === 'object' ? s.locks : {};
    base.auto = s.auto && typeof s.auto === 'object' ? s.auto : {};
    return base;
  }

  var state = loadState();
  var saveFailed = false;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveFailed = false;
    } catch (e) {
      if (!saveFailed) toast('Attenzione: il browser non permette di salvare. Scarica un backup!', true);
      saveFailed = true;
    }
  }

  var undoStack = [];
  function snapshot() {
    undoStack.push(JSON.stringify({ assignments: state.assignments, locks: state.locks, auto: state.auto }));
    if (undoStack.length > 50) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return toast('Niente da annullare');
    var snap = JSON.parse(undoStack.pop());
    state.assignments = snap.assignments;
    state.locks = snap.locks || {};
    state.auto = snap.auto || {};
    save();
    renderMonth();
  }

  var now = new Date();
  var view = { y: now.getFullYear(), m: now.getMonth() + 1 };
  var tool = 'G';

  // ---------- Utilità ----------

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(x) { return (Math.round(x * 10) / 10).toLocaleString('it-IT'); }
  function fmtSigned(x) { return (x > 0 ? '+' : '') + fmt(x); }

  function fmtDate(key) {
    var p = key.split('-');
    return p[2] + '/' + p[1];
  }

  // I messaggi delle regole usano date ISO: in interfaccia le mostriamo gg/mm.
  function prettyDates(msg) {
    return msg.replace(/(\d{4})-(\d{2})-(\d{2})/g, function (_, y, m, d) { return d + '/' + m; });
  }

  function activeEmployees() { return state.employees.filter(function (e) { return e.active; }); }

  function empById(id) {
    for (var i = 0; i < state.employees.length; i++) if (state.employees[i].id === id) return state.employees[i];
    return null;
  }

  function newId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function contractLabel(h) {
    if (h === 38) return 'Tempo pieno';
    if (h === 24) return 'Part-time';
    return fmt(h) + ' h/sett.';
  }

  var toastTimer;
  function toast(msg, sticky) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, sticky ? 8000 : 3500);
  }

  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function trainingHours() {
    var h = +$('#training-hours').value;
    return h > 0 ? h : 8;
  }

  // Valore da salvare per un codice: la formazione porta con sé le ore.
  function makeEntry(code) {
    return code === 'C' ? { code: 'C', hours: trainingHours() } : code;
  }

  function sameEntry(a, b) { return JSON.stringify(a || '') === JSON.stringify(b || ''); }

  // Scrittura a mano: la casella non conta più come inserita dalla proposta automatica.
  function setCell(empId, key, entry) {
    if (!state.assignments[empId]) state.assignments[empId] = {};
    if (entry) state.assignments[empId][key] = entry;
    else delete state.assignments[empId][key];
    if (state.auto[empId]) delete state.auto[empId][key];
  }

  function getEntry(empId, key) {
    return (state.assignments[empId] || {})[key] || '';
  }

  function cellHtml(entry) {
    var code = R.codeOf(entry);
    if (code === 'C') return 'C<small>' + fmt(entry.hours) + 'h</small>';
    if (code === 'P') return '104';
    return code;
  }

  function perm104Count(empId) {
    return R.monthDays(view.y, view.m).filter(function (k) { return R.codeOn(state, empId, k) === 'P'; }).length;
  }

  // ---------- Tabellone del mese ----------

  function renderMonth() {
    var title = MONTHS[view.m - 1] + ' ' + view.y;
    $('#month-title').textContent = title;
    $('#print-title').textContent = 'Turni ' + title;
    $all('.max-week').forEach(function (el) { el.textContent = state.settings.maxWeeklyHours; });

    var issues = R.validateMonth(state, view.y, view.m);
    $('#btn-lock-month').textContent = monthLocked() ? '🔓 Sblocca mese' : '🔒 Blocca mese';
    renderGrid(issues);
    renderWeeks();
    renderIssues(issues);
  }

  function renderGrid(issues) {
    var days = R.monthDays(view.y, view.m);
    var emps = activeEmployees();
    var todayKey = R.toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

    // Celle con errori (rosso) o regole da evitare (arancione) → messaggi per il tooltip
    var cellErr = {}, cellSoft = {};
    issues.forEach(function (i) {
      if (i.level !== 'error' && i.level !== 'soft') return;
      var map = i.level === 'error' ? cellErr : cellSoft;
      (i.empIds || [i.empId]).forEach(function (id) {
        i.dates.forEach(function (d) {
          var k = id + '|' + d;
          (map[k] = map[k] || []).push(prettyDates(i.message) + (i.level === 'soft' ? ' — da evitare' : ''));
        });
      });
    });
    var avg = balanceAverages();

    var h = '<thead><tr><th class="name">Dipendente</th>';
    days.forEach(function (key) {
      var wd = R.weekday(key);
      var cls = (wd >= 5 ? 'weekend' : '') + (key === todayKey ? ' today' : '') + (wd === 0 ? ' monday' : '');
      h += '<th class="day ' + cls + '"><span>' + WEEKDAYS[wd] + '</span>' + (+key.slice(8)) + '</th>';
    });
    h += '<th class="sum" title="Turni di notte nel mese">Notti</th>' +
      '<th class="sum" title="Weekend lavorati (basta il sabato o la domenica)">Week<br>end</th>' +
      '<th class="sum" title="Ore dei turni G e N">Turni<br>h</th>' +
      '<th class="sum" title="Ore di formazione">Form.<br>h</th>' +
      '<th class="sum" title="Ferie e malattia nei giorni lun–ven, permessi 104">Assenze<br>h</th>' +
      '<th class="sum" title="Giorni lun–ven × ore settimanali ÷ 5">Previste<br>h</th>' +
      '<th class="sum" title="Turni + formazione + assenze − previste">Saldo<br>h</th></tr></thead><tbody>';

    if (!emps.length) {
      h += '<tr><td class="empty" colspan="' + (days.length + 8) + '">Nessun dipendente: aggiungili nella scheda ' +
        '<a href="#" data-goto="dipendenti">Dipendenti</a>.</td></tr>';
    }

    emps.forEach(function (e, row) {
      var s = R.monthSummary(state, e, view.y, view.m);
      var tag = '';
      if (e.has104) {
        var used = perm104Count(e.id), max = +state.settings.perm104PerMonth;
        tag = ' <span class="tag104' + (used >= max ? ' full' : '') + '" title="Permessi 104 usati nel mese">104 · ' +
          used + '/' + max + '</span>';
      }
      var info = R.ROLES[e.role] + (e.weeklyHours !== 38 ? ' · ' + contractLabel(e.weeklyHours) : '');
      h += '<tr><th class="name' + (R.isDriver(e) ? ' driver' : '') + '" title="' + esc(info) + '">' +
        '<button type="button" class="row-lock' + (rowLocked(e.id) ? ' on' : '') + '" data-lock-emp="' + esc(e.id) +
        '" title="' + (rowLocked(e.id) ? 'Sblocca' : 'Blocca') + ' tutto il mese di questo dipendente">' +
        (rowLocked(e.id) ? '🔒' : '🔓') + '</button>' +
        (R.isDriver(e) ? '<span class="drv" title="Autista soccorritore">A</span>' : '') + esc(e.name) + tag +
        '<small>' + esc(info) + '</small></th>';
      days.forEach(function (key, col) {
        var entry = getEntry(e.id, key);
        var code = R.codeOf(entry);
        var errs = cellErr[e.id + '|' + key];
        var softs = cellSoft[e.id + '|' + key];
        var tips = (errs || []).concat(softs || []);
        var wd = R.weekday(key);
        var cls = 'cell' + (code ? ' cell-' + code : '') + (wd >= 5 ? ' weekend' : '') +
          (wd === 0 ? ' monday' : '') + (errs ? ' error' : softs ? ' soft' : '') +
          (R.isLocked(state, e.id, key) ? ' locked' : '') + (R.isAuto(state, e.id, key) ? ' auto' : '');
        h += '<td class="' + cls + '" tabindex="' + (row === 0 && col === 0 ? 0 : -1) + '" data-emp="' + esc(e.id) +
          '" data-date="' + key + '" data-row="' + row + '" data-col="' + col + '"' +
          (tips.length ? ' title="' + esc(tips.join('\n')) + '"' : '') + '>' + cellHtml(entry) + '</td>';
      });
      var bal = s.balance;
      var maxWe = +state.settings.maxWeekendsPerMonth;
      var w = e.weeklyHours / (+state.settings.fullTimeWeeklyHours || 38);
      var nCls = Math.abs(s.nights / w - avg.nights) > 1.5 ? 'over' : '';
      h += '<td class="sum ' + nCls + '" title="Media in proporzione al contratto: ' + fmt(avg.nights * w) + '">' +
        s.nights + '</td><td class="sum ' + (s.weekends > maxWe ? 'over' : '') + '" title="Massimo ' + maxWe +
        ' — media in proporzione al contratto: ' + fmt(avg.weekends * w) + '">' + s.weekends + '</td>';
      h += '<td class="sum">' + fmt(s.worked) + '</td><td class="sum">' + (s.training ? fmt(s.training) : '') +
        '</td><td class="sum">' + (s.absence ? fmt(s.absence) : '') +
        '</td><td class="sum">' + fmt(s.target) + '</td><td class="sum ' +
        (bal > 0 ? 'over' : bal < 0 ? 'under' : 'ok') + '">' + fmtSigned(bal) + '</td></tr>';
    });
    h += '</tbody><tfoot>';

    ['G', 'N'].forEach(function (code) {
      var need = +state.settings.staffPerShift[code] || 0;
      h += '<tr><th class="name">Copertura ' + code + ' <small>(' + need + ' richiesti)</small></th>';
      days.forEach(function (key) {
        var have = R.staffOn(state, key, code).length;
        var cls = have < need ? 'under' : have > need ? 'over' : 'ok';
        h += '<td class="cov ' + cls + (R.weekday(key) === 0 ? ' monday' : '') + '" title="' +
          esc(R.staffOn(state, key, code)
            .map(function (e) { return e.name; }).join(', ') || 'Nessuno') + '">' + have + '</td>';
      });
      h += '<td colspan="7"></td></tr>';
    });
    var minDrivers = +state.settings.minDriversPerShift;
    ['G', 'N'].forEach(function (code) {
      h += '<tr class="drivers"><th class="name">Autisti ' + code + ' <small>(almeno ' + minDrivers + ')</small></th>';
      days.forEach(function (key) {
        var staff = R.staffOn(state, key, code);
        var drv = staff.filter(R.isDriver);
        var cls = staff.length && drv.length < minDrivers ? 'under' : drv.length ? 'ok' : '';
        h += '<td class="cov ' + cls + (R.weekday(key) === 0 ? ' monday' : '') + '" title="' +
          esc(drv.map(function (e) { return e.name; }).join(', ') || 'Nessun autista') + '">' + drv.length + '</td>';
      });
      h += '<td colspan="7"></td></tr>';
    });
    h += '</tfoot>';

    $('#grid').innerHTML = h;
  }

  // Notti e weekend medi per un tempo pieno, per evidenziare chi si discosta troppo.
  function balanceAverages() {
    var emps = activeEmployees();
    var full = +state.settings.fullTimeWeeklyHours || 38;
    var totW = 0, n = 0, we = 0;
    emps.forEach(function (e) {
      var s = R.monthSummary(state, e, view.y, view.m);
      totW += e.weeklyHours / full;
      n += s.nights;
      we += s.weekends;
    });
    return { nights: totW ? n / totW : 0, weekends: totW ? we / totW : 0 };
  }

  function renderWeeks() {
    var weeks = R.monthWeeks(view.y, view.m);
    var days = R.monthDays(view.y, view.m);
    var max = state.settings.maxWeeklyHours;
    var full = weeks.filter(function (w) { return days.indexOf(w) >= 0 && days.indexOf(R.addDays(w, 6)) >= 0; });
    var h = '<thead><tr><th class="name">Dipendente</th>';
    weeks.forEach(function (w) {
      h += '<th>' + fmtDate(w) + '–' + fmtDate(R.addDays(w, 6)) + '</th>';
    });
    h += '</tr></thead><tbody>';
    activeEmployees().forEach(function (e) {
      // Settimane intere del mese: turni (notte della domenica esclusa) troppo diversi tra loro?
      var counts = full.map(function (w) { return R.weekShiftCount(state, e.id, w); });
      var lo = Math.min.apply(null, counts), hi = Math.max.apply(null, counts);
      var uneven = counts.length > 1 && hi - lo > 1;
      h += '<tr><th class="name">' + esc(e.name) + '</th>';
      weeks.forEach(function (w) {
        var hrs = R.weekHours(state, e.id, w);
        var n = R.weekShiftCount(state, e.id, w);
        var isFull = full.indexOf(w) >= 0;
        var cls = hrs > max ? 'under' : uneven && isFull && (n === lo || n === hi) ? 'over' : '';
        h += '<td class="' + cls + '"' + (uneven && isFull ? ' title="Settimane sbilanciate: da ' + lo + ' a ' + hi +
          ' turni"' : '') + '>' + (hrs ? fmt(hrs) + ' h · ' + n + (n === 1 ? ' turno' : ' turni') : '–') + '</td>';
      });
      h += '</tr>';
    });
    $('#weeks').innerHTML = h + '</tbody>';
  }


  function renderIssues(issues) {
    var errors = issues.filter(function (i) { return i.level === 'error'; });
    var softs = issues.filter(function (i) { return i.level === 'soft'; });
    var missing = issues.filter(function (i) { return i.type === 'coverage' && /scoperto/.test(i.message); });
    var extra = issues.filter(function (i) { return i.type === 'coverage' && /eccesso/.test(i.message); });

    var badge = $('#issue-count');
    badge.textContent = (errors.length ? errors.length + ' errori' : 'nessun errore') +
      (softs.length ? ' · ' + softs.length + ' da evitare' : '');
    badge.className = 'badge ' + (errors.length ? 'bad' : softs.length ? 'soft' : 'good');

    var h = '';
    errors.forEach(function (i) {
      var empId = i.empId || (i.empIds || [])[0] || '';
      var e = i.empId ? empById(i.empId) : null;
      h += '<li class="err" data-emp="' + esc(empId) + '" data-date="' + i.dates[i.dates.length - 1] + '">' +
        (e ? '<b>' + esc(e.name) + '</b>: ' : '') + esc(prettyDates(i.message)) + '</li>';
    });
    softs.forEach(function (i) {
      var e = empById(i.empId);
      h += '<li class="err soft" data-emp="' + esc(i.empId) + '" data-date="' + i.dates[0] + '">' +
        '<b>' + esc(e ? e.name : '?') + '</b>: ' + esc(prettyDates(i.message)) + '</li>';
    });
    function group(list, label, cls) {
      if (!list.length) return '';
      return '<li class="' + cls + '"><details><summary>' + list.length + ' ' + label + '</summary><ul>' +
        list.map(function (i) { return '<li>' + esc(prettyDates(i.message)) + '</li>'; }).join('') +
        '</ul></details></li>';
    }
    h += group(missing, 'turni scoperti', 'warn');
    h += group(extra, 'turni con personale in eccesso', 'info');
    if (!h) h = '<li class="okmsg">Tutto a posto: vincoli e preferenze rispettati, turni coperti.</li>';
    $('#issues').innerHTML = h;
  }

  // ---------- Inserimento nel tabellone ----------

  var painting = null; // valore che si sta "dipingendo" trascinando il mouse

  function setLock(empId, key, on) {
    if (!state.locks[empId]) state.locks[empId] = {};
    if (on) state.locks[empId][key] = true;
    else delete state.locks[empId][key];
  }

  var lockWarned = false;

  // Scrive il codice nella casella; false se non cambia nulla o non è ammesso.
  // Con lo strumento "blocca" (L) invece blocca o sblocca la casella.
  function applyToCell(td, code) {
    var emp = td.getAttribute('data-emp'), key = td.getAttribute('data-date');
    if (code === 'L+' || code === 'L-') {
      if (R.isLocked(state, emp, key) === (code === 'L+')) return false;
      setLock(emp, key, code === 'L+');
      return true;
    }
    if (R.isLocked(state, emp, key)) {
      if (!lockWarned) toast('Casella bloccata 🔒: sbloccala con lo strumento "blocca" prima di modificarla.', true);
      lockWarned = true;
      return false;
    }
    var entry = makeEntry(code);
    if (sameEntry(getEntry(emp, key), entry)) return false;
    if (code === 'P' && !(empById(emp) || {}).has104) {
      toast((empById(emp) || {}).name + ' non ha diritto alla 104: attivala nella scheda Dipendenti.', true);
      return false;
    }
    setCell(emp, key, entry);
    return true;
  }

  function paintCell(td) {
    var entry = getEntry(td.getAttribute('data-emp'), td.getAttribute('data-date'));
    var code = R.codeOf(entry);
    var emp = td.getAttribute('data-emp'), key = td.getAttribute('data-date');
    td.className = td.className.replace(/ ?cell-[A-Z]| ?locked| ?auto/g, '') + (code ? ' cell-' + code : '') +
      (R.isLocked(state, emp, key) ? ' locked' : '') + (R.isAuto(state, emp, key) ? ' auto' : '');
    td.innerHTML = cellHtml(entry);
  }

  function commit(focusEmp, focusDate) {
    save();
    renderMonth();
    if (focusEmp) focusCell(focusEmp, focusDate);
  }

  function focusCell(emp, key) {
    var td = $all('#grid td.cell').filter(function (c) {
      return c.getAttribute('data-emp') === emp && c.getAttribute('data-date') === key;
    })[0];
    if (td) { setRoving(td); td.focus(); }
  }

  function setRoving(td) {
    $all('#grid td.cell[tabindex="0"]').forEach(function (c) { c.setAttribute('tabindex', '-1'); });
    td.setAttribute('tabindex', '0');
  }

  function initGridEvents() {
    var grid = $('#grid');

    grid.addEventListener('mousedown', function (ev) {
      var td = ev.target.closest('td.cell');
      if (!td || ev.button !== 0) return;
      ev.preventDefault();
      setRoving(td);
      td.focus();
      snapshot();
      lockWarned = false;
      if (tool === 'L') {
        // Il primo clic decide se il trascinamento blocca o sblocca.
        painting = R.isLocked(state, td.getAttribute('data-emp'), td.getAttribute('data-date')) ? 'L-' : 'L+';
      } else {
        var cur = getEntry(td.getAttribute('data-emp'), td.getAttribute('data-date'));
        // Cliccare una casella che contiene già il valore scelto la svuota.
        painting = sameEntry(cur, makeEntry(tool)) ? '' : tool;
      }
      if (applyToCell(td, painting)) paintCell(td);
    });

    grid.addEventListener('mouseover', function (ev) {
      if (painting === null) return;
      var td = ev.target.closest('td.cell');
      if (td && applyToCell(td, painting)) paintCell(td);
    });

    document.addEventListener('mouseup', function () {
      if (painting === null) return;
      painting = null;
      var focused = document.activeElement;
      var emp = focused && focused.getAttribute && focused.getAttribute('data-emp');
      commit(emp, emp && focused.getAttribute('data-date'));
    });

    grid.addEventListener('keydown', function (ev) {
      var td = ev.target.closest('td.cell');
      if (!td) return;
      var row = +td.getAttribute('data-row'), col = +td.getAttribute('data-col');
      var moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (moves[ev.key]) {
        ev.preventDefault();
        var next = grid.querySelector('td.cell[data-row="' + (row + moves[ev.key][0]) + '"][data-col="' +
          (col + moves[ev.key][1]) + '"]');
        if (next) { setRoving(next); next.focus(); }
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var k = ev.key.toUpperCase();
      lockWarned = false;
      if (k === 'L') {
        ev.preventDefault();
        snapshot();
        applyToCell(td, R.isLocked(state, td.getAttribute('data-emp'), td.getAttribute('data-date')) ? 'L-' : 'L+');
        commit(td.getAttribute('data-emp'), td.getAttribute('data-date'));
        return;
      }
      var code = CODES.indexOf(k) >= 0 ? k : (ev.key === 'Delete' || ev.key === 'Backspace' || ev.key === ' ') ? '' : null;
      if (code === null) return;
      ev.preventDefault();
      snapshot();
      if (applyToCell(td, code)) {
        // Dopo l'inserimento passa al giorno successivo, come in un foglio di calcolo.
        var nextKey = R.addDays(td.getAttribute('data-date'), 1);
        var inMonth = nextKey.slice(0, 7) === td.getAttribute('data-date').slice(0, 7);
        commit(td.getAttribute('data-emp'), inMonth ? nextKey : td.getAttribute('data-date'));
      } else {
        undoStack.pop();
      }
    });

    grid.addEventListener('click', function (ev) {
      var lockBtn = ev.target.closest('[data-lock-emp]');
      if (lockBtn) { toggleRowLock(lockBtn.getAttribute('data-lock-emp')); return; }
      var a = ev.target.closest('[data-goto]');
      if (a) { ev.preventDefault(); showTab(a.getAttribute('data-goto')); }
    });

    $('#issues').addEventListener('click', function (ev) {
      var li = ev.target.closest('li.err');
      if (li) focusCell(li.getAttribute('data-emp'), li.getAttribute('data-date'));
    });
  }

  function selectTool(code) {
    tool = code;
    $all('.tool').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tool') === code); });
  }

  // ---------- Azioni ----------

  // ---------- Blocchi ----------

  function rowLocked(empId) {
    return R.monthDays(view.y, view.m).every(function (k) { return R.isLocked(state, empId, k); });
  }

  function monthLocked() {
    var emps = activeEmployees();
    return emps.length > 0 && emps.every(function (e) { return rowLocked(e.id); });
  }

  function toggleRowLock(empId) {
    var on = !rowLocked(empId);
    snapshot();
    R.monthDays(view.y, view.m).forEach(function (k) { setLock(empId, k, on); });
    save();
    renderMonth();
    var e = empById(empId);
    toast((on ? 'Bloccato' : 'Sbloccato') + ' tutto ' + MONTHS[view.m - 1].toLowerCase() + ' di ' + (e ? e.name : '') + '.');
  }

  function toggleMonthLock() {
    var on = !monthLocked();
    snapshot();
    activeEmployees().forEach(function (e) {
      R.monthDays(view.y, view.m).forEach(function (k) { setLock(e.id, k, on); });
    });
    save();
    renderMonth();
    toast(on ? 'Mese bloccato: la proposta automatica non cambierà nulla.' : 'Mese sbloccato.');
  }

  function generate(regenerate) {
    if (!activeEmployees().length) return toast('Aggiungi prima i dipendenti');
    var msg = regenerate
      ? 'Rifare la proposta di ' + MONTHS[view.m - 1] + '?\nVengono ricalcolati SOLO i turni inseriti dalla proposta ' +
        'automatica (in corsivo). Restano i turni scritti a mano, quelli bloccati 🔒, ferie, malattia, permessi, ' +
        'richieste di riposo e formazione. Puoi sempre annullare.'
      : 'Riempire automaticamente i turni scoperti di ' + MONTHS[view.m - 1] + '?\n' +
        'I turni già inseriti non vengono toccati. Puoi sempre annullare.';
    if (!confirm(msg)) return;
    toast('Calcolo della proposta in corso…', true);
    // Lascia al browser il tempo di mostrare il messaggio prima del calcolo.
    setTimeout(function () { runGenerate(regenerate); }, 30);
  }

  function runGenerate(regenerate) {
    snapshot();
    var res = R.generateMonth(state, view.y, view.m, { regenerate: !!regenerate });
    state.assignments = res.assignments;
    state.auto = res.auto;
    save();
    renderMonth();
    var bypassNote = res.bypassed.length ? ' ' + res.bypassed.length +
      ' regole "da evitare" superate perché non c\'era alternativa (in arancione).' : '';
    if (res.uncovered.length) {
      var miss = res.uncovered.reduce(function (t, u) { return t + u.missing; }, 0);
      var noDriver = res.uncovered.filter(function (u) { return u.driver; }).length;
      var parts = [];
      if (miss) parts.push(miss + ' posti scoperti');
      if (noDriver) parts.push(noDriver + ' turni senza autista');
      toast('Fatto. Restano ' + parts.join(' e ') + ': non si possono sistemare senza violare i vincoli.' +
        bypassNote, true);
    } else {
      toast('Fatto: tutti i turni del mese sono coperti.' + bypassNote, !!bypassNote);
    }
  }

  // ---------- Inserimento di un periodo (richieste di riposo, ferie, malattia) ----------

  function renderPeriodForm() {
    var sel = $('#period-emp');
    var cur = sel.value;
    sel.innerHTML = activeEmployees().map(function (e) {
      return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>';
    }).join('');
    if (cur && empById(cur)) sel.value = cur;
    // Proponi le date del mese visualizzato se il campo è vuoto o fuori mese.
    var first = R.toKey(view.y, view.m, 1);
    ['#period-from', '#period-to'].forEach(function (id) {
      var el = $(id);
      if (!el.value || el.value.slice(0, 7) !== first.slice(0, 7)) el.value = first;
    });
  }

  function insertPeriod(ev) {
    ev.preventDefault();
    var empId = $('#period-emp').value;
    var code = $('#period-code').value;
    var from = $('#period-from').value, to = $('#period-to').value;
    var e = empById(empId);
    if (!e || !from || !to) return toast('Scegli dipendente e date.');
    if (to < from) return toast('La data "Al" è prima di "Dal".');
    var days = [];
    for (var k = from; k <= to; k = R.addDays(k, 1)) days.push(k);
    if (days.length > 366) return toast('Periodo troppo lungo (massimo un anno).');
    var locked = days.filter(function (k) { return R.isLocked(state, empId, k); });
    days = days.filter(function (k) { return !R.isLocked(state, empId, k); });
    if (!days.length) return toast('Tutti i giorni del periodo sono bloccati 🔒.');
    var busy = days.filter(function (k) {
      var c = R.codeOn(state, empId, k);
      return c && c !== code;
    });
    if (busy.length && !confirm('Nel periodo ' + e.name + ' ha già ' + busy.length +
      ' giorni con turni o altre voci (' + busy.map(fmtDate).slice(0, 6).join(', ') +
      (busy.length > 6 ? '…' : '') + ').\nSostituirli?')) return;
    snapshot();
    days.forEach(function (k) { setCell(empId, k, code); });
    save();
    renderMonth();
    var label = { R: 'Richiesta di riposo inserita', F: 'Ferie inserite', M: 'Malattia inserita' }[code];
    toast(label + ' per ' + e.name + ' dal ' + fmtDate(from) + ' al ' + fmtDate(to) + '.' +
      (locked.length ? ' ' + locked.length + ' giorni bloccati 🔒 lasciati com\'erano.' : ''));
  }

  // Reset completo: cancella tutto il mese, anche i turni scritti a mano. Restano solo le caselle bloccate.
  function clearMonth() {
    if (!confirm('RESET COMPLETO di ' + MONTHS[view.m - 1] + ' ' + view.y + '?\n' +
      'Vengono cancellati TUTTI i turni, anche quelli inseriti a mano, e ferie, malattie, permessi, ' +
      'richieste di riposo e formazione.\nRestano solo le caselle bloccate 🔒. Puoi annullare con "Annulla".')) return;
    snapshot();
    var days = R.monthDays(view.y, view.m);
    Object.keys(state.assignments).forEach(function (id) {
      days.forEach(function (k) { if (!R.isLocked(state, id, k)) setCell(id, k, ''); });
    });
    save();
    renderMonth();
    toast('Reset completo fatto. Puoi annullare con "Annulla".');
  }

  // ---------- Esporta Excel (tabellone turni) ----------

  var excelLoading = null;

  // ExcelJS è grande (~1 MB): si carica solo la prima volta che si esporta.
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!excelLoading) {
      excelLoading = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = 'js/vendor/exceljs.min.js';
        sc.onload = function () { resolve(window.ExcelJS); };
        sc.onerror = function () { excelLoading = null; reject(new Error('ExcelJS non caricato')); };
        document.head.appendChild(sc);
      });
    }
    return excelLoading;
  }

  function exportExcel() {
    if (!activeEmployees().length) return toast('Aggiungi prima i dipendenti');
    toast('Preparazione del file Excel…', true);
    loadExcelJS().then(function (ExcelJS) {
      var wb = window.ExportXlsx.buildWorkbook(ExcelJS, R, state, view.y, view.m,
        { logoBase64: window.LOGO_PNG_BASE64 });
      return wb.xlsx.writeBuffer();
    }).then(function (buf) {
      download(window.ExportXlsx.fileName(view.y, view.m), buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      var days = window.ExportXlsx.tabelloneDays(R, view.y, view.m);
      toast('Tabellone esportato: dal ' + fmtDate(days[0]) + ' al ' + fmtDate(days[days.length - 1]) + '.');
    }).catch(function () {
      toast('Non sono riuscito a creare il file Excel. Riprova.', true);
    });
  }

  function backup() {
    var d = new Date();
    var name = 'turni-backup-' + R.toKey(d.getFullYear(), d.getMonth() + 1, d.getDate()) + '.json';
    download(name, JSON.stringify(state, null, 2), 'application/json');
  }

  function restore(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = normalize(JSON.parse(reader.result)); } catch (e) {
        return toast('Il file non è un backup valido.', true);
      }
      if (!confirm('Sostituire tutti i dati attuali con il backup (' + data.employees.length + ' dipendenti)?')) return;
      state = data;
      undoStack = [];
      save();
      renderAll();
      toast('Backup caricato.');
    };
    reader.readAsText(file);
  }

  // ---------- Dipendenti ----------

  function renderEmployees() {
    var short = window.ExportXlsx.defaultShortNames(state.employees);
    var h = '<thead><tr><th></th><th>Nome</th><th title="Come compare nel tabellone esportato in Excel">Nome nel tabellone</th><th>Qualifica</th><th>Contratto</th><th>Monte ore ' + MONTHS[view.m - 1].toLowerCase() +
      '</th><th>Legge 104</th><th>Attivo</th><th></th></tr></thead><tbody>';
    if (!state.employees.length) h += '<tr><td colspan="9" class="empty">Nessun dipendente inserito.</td></tr>';
    state.employees.forEach(function (e, i) {
      var std = e.weeklyHours === 38 || e.weeklyHours === 24;
      h += '<tr data-id="' + esc(e.id) + '">' +
        '<td class="order"><button data-act="up" title="Sposta su"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button data-act="down" title="Sposta giù"' + (i === state.employees.length - 1 ? ' disabled' : '') + '>▼</button></td>' +
        '<td><input data-field="name" value="' + esc(e.name) + '"></td>' +
        '<td><input data-field="shortName" class="short" value="' + esc(e.shortName || '') + '" placeholder="' +
        esc(short[e.id] || '') + '" title="Vuoto = ' + esc(short[e.id] || '') + '"></td>' +
        '<td><select data-field="role">' +
        '<option value="autista"' + (R.isDriver(e) ? ' selected' : '') + '>Autista soccorritore</option>' +
        '<option value="soccorritore"' + (!R.isDriver(e) ? ' selected' : '') + '>Soccorritore</option></select></td>' +
        '<td><select data-field="contract">' +
        '<option value="38"' + (e.weeklyHours === 38 ? ' selected' : '') + '>Tempo pieno (38 h)</option>' +
        '<option value="24"' + (e.weeklyHours === 24 ? ' selected' : '') + '>Part-time (24 h)</option>' +
        '<option value="custom"' + (!std ? ' selected' : '') + '>Altro…</option></select> ' +
        '<input data-field="hours" type="number" min="1" max="48" step="0.5" value="' + e.weeklyHours + '"' +
        (std ? ' hidden' : '') + ' class="hours"></td>' +
        '<td>' + fmt(R.monthlyTarget(e, view.y, view.m)) + ' h</td>' +
        '<td><label class="check"><input type="checkbox" data-field="has104"' + (e.has104 ? ' checked' : '') +
        '> Sì</label></td>' +
        '<td><input type="checkbox" data-field="active"' + (e.active ? ' checked' : '') + '></td>' +
        '<td><button data-act="delete" class="danger">Elimina</button></td></tr>';
    });
    $('#emp-table').innerHTML = h + '</tbody>';
  }

  function initEmployees() {
    $('#emp-contract').addEventListener('change', function () {
      $('#emp-hours-field').hidden = this.value !== 'custom';
    });

    $('#emp-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = $('#emp-name').value.trim();
      if (!name) return;
      var c = $('#emp-contract').value;
      var hours = c === 'custom' ? +$('#emp-hours').value : +c;
      if (!(hours > 0)) return toast('Indica le ore settimanali');
      state.employees.push({ id: newId(), name: name, weeklyHours: hours, role: $('input[name="emp-role"]:checked').value,
        has104: $('#emp-104').checked, active: true });
      $('#emp-104').checked = false;
      save();
      $('#emp-name').value = '';
      $('#emp-name').focus();
      renderAll();
    });

    var table = $('#emp-table');
    table.addEventListener('change', function (ev) {
      var tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      var e = empById(tr.getAttribute('data-id'));
      var f = ev.target.getAttribute('data-field');
      if (f === 'name') e.name = ev.target.value.trim() || e.name;
      if (f === 'shortName') e.shortName = ev.target.value.trim().toUpperCase();
      if (f === 'active') e.active = ev.target.checked;
      if (f === 'has104') e.has104 = ev.target.checked;
      if (f === 'role') e.role = ev.target.value;
      if (f === 'contract') {
        if (ev.target.value === 'custom') {
          tr.querySelector('.hours').hidden = false;
          tr.querySelector('.hours').focus();
          return;
        }
        e.weeklyHours = +ev.target.value;
      }
      if (f === 'hours' && +ev.target.value > 0) e.weeklyHours = +ev.target.value;
      save();
      renderAll();
    });

    table.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      var tr = btn.closest('tr[data-id]');
      var id = tr.getAttribute('data-id');
      var idx = state.employees.indexOf(empById(id));
      var act = btn.getAttribute('data-act');
      if (act === 'delete') {
        if (!confirm('Eliminare ' + state.employees[idx].name + ' e tutti i suoi turni?\n' +
          'Se ha solo smesso di lavorare, togli la spunta "Attivo" per conservare lo storico.')) return;
        state.employees.splice(idx, 1);
        delete state.assignments[id];
      } else {
        var to = act === 'up' ? idx - 1 : idx + 1;
        var tmp = state.employees[to];
        state.employees[to] = state.employees[idx];
        state.employees[idx] = tmp;
      }
      save();
      renderAll();
    });
  }

  // ---------- Impostazioni ----------

  function renderSettings() {
    var f = $('#settings-form');
    f.maxWeeklyHours.value = state.settings.maxWeeklyHours;
    f.minRestHours.value = state.settings.minRestHours;
    f.staffG.value = state.settings.staffPerShift.G;
    f.staffN.value = state.settings.staffPerShift.N;
    f.perm104Hours.value = state.settings.perm104Hours;
    f.perm104PerMonth.value = state.settings.perm104PerMonth;
    f.tabelloneTitle.value = state.settings.tabelloneTitle || window.ExportXlsx.DEFAULT_TITLE;
    f.minDriversPerShift.value = state.settings.minDriversPerShift;
    f.maxSameInRow.value = state.settings.maxSameInRow;
    f.maxWeekendsPerMonth.value = state.settings.maxWeekendsPerMonth;
  }

  function initSettings() {
    $('#settings-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      state.settings.maxWeeklyHours = +f.maxWeeklyHours.value || R.DEFAULT_SETTINGS.maxWeeklyHours;
      state.settings.minRestHours = +f.minRestHours.value >= 0 ? +f.minRestHours.value : R.DEFAULT_SETTINGS.minRestHours;
      state.settings.staffPerShift = { G: Math.max(0, +f.staffG.value || 0), N: Math.max(0, +f.staffN.value || 0) };
      state.settings.perm104Hours = +f.perm104Hours.value >= 0 && f.perm104Hours.value !== ''
        ? +f.perm104Hours.value : R.DEFAULT_SETTINGS.perm104Hours;
      state.settings.tabelloneTitle = f.tabelloneTitle.value.trim() || window.ExportXlsx.DEFAULT_TITLE;
      state.settings.perm104PerMonth = +f.perm104PerMonth.value >= 0 && f.perm104PerMonth.value !== ''
        ? +f.perm104PerMonth.value : R.DEFAULT_SETTINGS.perm104PerMonth;
      state.settings.minDriversPerShift = f.minDriversPerShift.value !== '' && +f.minDriversPerShift.value >= 0
        ? +f.minDriversPerShift.value : R.DEFAULT_SETTINGS.minDriversPerShift;
      state.settings.maxSameInRow = +f.maxSameInRow.value >= 1 ? +f.maxSameInRow.value : R.DEFAULT_SETTINGS.maxSameInRow;
      state.settings.maxWeekendsPerMonth = f.maxWeekendsPerMonth.value !== '' && +f.maxWeekendsPerMonth.value >= 0
        ? +f.maxWeekendsPerMonth.value : R.DEFAULT_SETTINGS.maxWeekendsPerMonth;
      save();
      renderAll();
      toast('Impostazioni salvate.');
    });
    $('#btn-backup').addEventListener('click', backup);
    $('#file-restore').addEventListener('change', function () {
      if (this.files[0]) restore(this.files[0]);
      this.value = '';
    });
  }

  // ---------- Schede e avvio ----------

  function showTab(name) {
    $all('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    $all('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    if (name === 'dipendenti' && !state.employees.length) $('#emp-name').focus();
  }

  function renderAll() {
    renderMonth();
    renderPeriodForm();
    renderEmployees();
    renderSettings();
  }

  function changeMonth(delta) {
    var m = view.m + delta;
    view.y += Math.floor((m - 1) / 12);
    view.m = ((m - 1) % 12 + 12) % 12 + 1;
    renderMonth();
    renderEmployees();
    renderPeriodForm();
  }

  function init() {
    $all('.tab').forEach(function (t) {
      t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
    });
    $all('.tool').forEach(function (b) {
      b.addEventListener('click', function () { selectTool(b.getAttribute('data-tool')); });
    });
    $('#training-hours').addEventListener('focus', function () { selectTool('C'); });
    $('#prev-month').addEventListener('click', function () { changeMonth(-1); });
    $('#next-month').addEventListener('click', function () { changeMonth(1); });
    $('#today').addEventListener('click', function () {
      view = { y: now.getFullYear(), m: now.getMonth() + 1 };
      renderMonth();
      renderEmployees();
      renderPeriodForm();
    });
    $('#btn-generate').addEventListener('click', function () { generate(false); });
    $('#btn-regenerate').addEventListener('click', function () { generate(true); });
    $('#btn-lock-month').addEventListener('click', toggleMonthLock);
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-clear-month').addEventListener('click', clearMonth);
    $('#period-form').addEventListener('submit', insertPeriod);
    $('#btn-print').addEventListener('click', function () { window.print(); });
    $('#btn-excel').addEventListener('click', exportExcel);
    document.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' &&
        !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        ev.preventDefault();
        undo();
      }
    });

    initGridEvents();
    initEmployees();
    initSettings();
    renderAll();
    if (!state.employees.length) showTab('dipendenti');
  }

  init();
})();
