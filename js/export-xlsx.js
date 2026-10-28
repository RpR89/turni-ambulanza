/*
 * Esportazione del tabellone turni in Excel (.xlsx), con lo stesso aspetto del
 * "TABELLONE TURNI" usato dal comitato: logo e titolo, un gruppo di colonne per ogni turno
 * di ogni ambulanza ("GIORNO | 12345", "NOTTE | 12345", …) con Note dopo il primo,
 * poi EXTRA, FORMAZIONE, MANIFESTAZIONI, ASSENZE, weekend in verde.
 * Usa ExcelJS (js/vendor/exceljs.min.js nel browser, il pacchetto npm nei test).
 */
(function (root) {
  'use strict';

  var MONTHS = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO',
    'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
  var MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  var WEEKDAYS = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];

  var DEFAULT_TITLE = 'TABELLONE TURNI - U.T. CANAL SAN BOVO';
  var FONT = 'Nunito';
  var GREEN = 'FFB3DA88';
  var GREY = 'FFEFEFEF';

  /*
   * Colonne (1 = A): gruppi con il numero di colonne di ciascuno. Con l'ambulanza
   * predefinita (G 07–19, N 19–07) è identico al modello: A-B giorno, C-E GIORNO, F Note,
   * G-I NOTTE, J-K EXTRA, L-P FORMAZIONE, Q-R MANIFESTAZIONI, S-W ASSENZE.
   */
  function layoutFor(Rules, state) {
    var shifts = Rules.shiftCatalog(state).list;
    var groups = [{ key: 'day', cols: 2 }];
    shifts.forEach(function (sh, i) {
      groups.push({ key: 's:' + sh.id, shift: sh, cols: 3 });
      if (i === 0) groups.push({ key: 'note', cols: 1 });
    });
    if (!shifts.length) groups.push({ key: 'note', cols: 1 });
    groups.push({ key: 'extra', cols: 2 }, { key: 'training', cols: 5 },
      { key: 'events', cols: 2 }, { key: 'absences', cols: 5 });
    var start = {}, c = 1;
    groups.forEach(function (g) { start[g.key] = c; g.start = c; c += g.cols; });
    // Bordo spesso a sinistra di ogni gruppo (tranne Note, sottile come nell'originale).
    var mediumLeft = {};
    groups.forEach(function (g) { if (g.key !== 'note' && g.key !== 'day') mediumLeft[g.start] = true; });
    return { groups: groups, start: start, lastCol: c - 1, mediumLeft: mediumLeft, shifts: shifts };
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // Nome breve nel tabellone: il cognome in maiuscolo; se due dipendenti hanno lo stesso
  // cognome si aggiungono le prime due lettere del nome ("BETTEGA GI.", "BETTEGA CH.").
  function defaultShortNames(employees) {
    var parts = employees.map(function (e) { return String(e.name || '').trim().split(/\s+/); });
    var count = {};
    parts.forEach(function (p) { var s = (p[0] || '').toUpperCase(); count[s] = (count[s] || 0) + 1; });
    var out = {};
    employees.forEach(function (e, i) {
      var p = parts[i], s = (p[0] || '').toUpperCase();
      out[e.id] = count[s] > 1 && p[1] ? s + ' ' + p[1].slice(0, 2).toUpperCase() + '.' : s;
    });
    return out;
  }

  function shortNameOf(emp, defaults) {
    var s = emp.shortName && String(emp.shortName).trim();
    return s || defaults[emp.id] || String(emp.name || '').toUpperCase();
  }

  // Settimane del tabellone: quelle che iniziano con un lunedì del mese (es. ottobre 2026:
  // da lunedì 5 ottobre a domenica 1 novembre). Con `whole` (copia dei turni pubblicati) tutte le
  // settimane che toccano il mese, così ci sono tutti i suoi giorni (es. dal 28 settembre).
  function tabelloneDays(Rules, y, m, whole) {
    var days = [];
    if (whole) {
      var month = Rules.monthDays(y, m);
      var d = Rules.weekStart(month[0]), end = Rules.addDays(Rules.weekStart(month[month.length - 1]), 6);
      for (; d <= end; d = Rules.addDays(d, 1)) days.push(d);
      return days;
    }
    Rules.monthDays(y, m).forEach(function (k) {
      if (Rules.weekday(k) === 0) for (var i = 0; i < 7; i++) days.push(Rules.addDays(k, i));
    });
    return days;
  }

  // Contenuto del tabellone, separato dalla grafica (usato anche dai test).
  // `whole`: tutte le settimane del mese, con vuoti i giorni degli altri mesi (non fanno parte dei turni
  // del mese: per esempio una pubblicazione non mostra i turni ancora in preparazione del mese dopo).
  function tabelloneRows(Rules, state, y, m, whole) {
    var monthKey = y + '-' + (m < 10 ? '0' : '') + m;
    var emps = (state.employees || []).filter(function (e) { return e.active !== false; });
    var defaults = defaultShortNames(emps);
    var name = function (e) { return shortNameOf(e, defaults); };
    function byDriverThenOrder(list) {
      return list.slice().sort(function (a, b) {
        if (Rules.isDriver(a) !== Rules.isDriver(b)) return Rules.isDriver(a) ? -1 : 1;
        return emps.indexOf(a) - emps.indexOf(b);
      });
    }
    // Chi è assente (o in formazione) per più giorni di fila resta nella stessa colonna.
    var prevSlots = { training: [], absences: [] };
    function slots(kind, names, n) {
      var out = new Array(n).fill('');
      var rest = [];
      names.forEach(function (nm) {
        var j = prevSlots[kind].indexOf(nm);
        if (j >= 0 && j < n && !out[j]) out[j] = nm; else rest.push(nm);
      });
      rest.forEach(function (nm) {
        var j = out.indexOf('');
        if (j >= 0) out[j] = nm;
      });
      prevSlots[kind] = out;
      return out;
    }
    return tabelloneDays(Rules, y, m, whole).map(function (k) {
      var p = k.split('-');
      var outside = whole && k.slice(0, 7) !== monthKey;
      var withCode = function (codes) {
        if (outside) return [];
        return emps.filter(function (e) { return codes.indexOf(Rules.codeOn(state, e.id, k)) >= 0; }).map(name);
      };
      var shifts = {};
      Rules.shiftCatalog(state).list.forEach(function (sh) {
        if (outside) { shifts[sh.id] = []; return; }
        // prima gli autisti (dipendenti, poi volontari), poi gli altri; i volontari senza nome
        var staff = byDriverThenOrder(Rules.staffOn(state, k, sh.id));
        var vol = Rules.volunteersOn(state, k, sh.id);
        var rep = function (label, n) { var out = []; for (var i = 0; i < n; i++) out.push(label); return out; };
        var drivers = staff.filter(Rules.isDriver).map(name).concat(rep('VOL. AUTISTA', vol.drivers));
        var others = staff.filter(function (e) { return !Rules.isDriver(e); }).map(name).concat(rep('VOLONTARIO', vol.rescuers));
        shifts[sh.id] = drivers.concat(others).slice(0, 3);
      });
      return {
        key: k,
        weekday: WEEKDAYS[Rules.weekday(k)],
        date: p[2] + '-' + MONTHS_SHORT[+p[1] - 1],
        weekend: Rules.weekday(k) >= 5,
        shifts: shifts,
        // EXTRA e MANIFESTAZIONI restano vuote: le compila a mano chi usa il file
        extra: [],
        training: slots('training', withCode(['C']), 5),
        events: [],
        absences: slots('absences', withCode(['F', 'M', 'P', 'R']), 5)
      };
    });
  }

  function thin() { return { style: 'thin', color: { argb: 'FF000000' } }; }
  function medium() { return { style: 'medium', color: { argb: 'FF000000' } }; }


  function buildWorkbook(ExcelJS, Rules, state, y, m, opts) {
    opts = opts || {};
    var title = (state.settings && state.settings.tabelloneTitle) || DEFAULT_TITLE;
    var rows = tabelloneRows(Rules, state, y, m, opts.wholeMonth);
    var L = layoutFor(Rules, state);
    var START = L.start, LAST_COL = L.lastCol, MEDIUM_LEFT = L.mediumLeft;

    var wb = new ExcelJS.Workbook();
    wb.creator = 'Turni Ambulanza';
    var ws = wb.addWorksheet(MONTHS[m - 1] + ' ' + y, {
      pageSetup: {
        paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1,
        horizontalCentered: true,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
      },
      views: [{ showGridLines: false }]
    });

    for (var c = 1; c <= LAST_COL; c++) ws.getColumn(c).width = c <= 2 ? 7.5 : 13;

    function cell(r, c) { return ws.getCell(r, c); }
    function style(r, c, s) {
      var x = cell(r, c);
      x.font = Object.assign({ name: FONT, size: 8 }, s.font || {});
      x.alignment = Object.assign({ horizontal: 'center', vertical: 'middle' }, s.alignment || {});
      if (s.fill) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } };
      x.border = s.border;
    }

    // ---------- Riga 1: logo e titolo ----------
    ws.getRow(1).height = 42;
    ws.mergeCells(1, 1, 1, 2);
    ws.mergeCells(1, 3, 1, LAST_COL);
    cell(1, 3).value = title;
    for (c = 1; c <= LAST_COL; c++) {
      style(1, c, {
        font: { size: 20, bold: true },
        border: { top: medium(), bottom: medium(), left: c === 1 || c === 3 ? medium() : undefined,
          right: c === LAST_COL || c === 2 ? medium() : undefined }
      });
    }
    if (opts.logoBase64) {
      var img = wb.addImage({ base64: opts.logoBase64, extension: 'png' });
      ws.addImage(img, { tl: { col: 0.62, row: 0.06 }, ext: { width: 58, height: 52 }, editAs: 'oneCell' });
    }

    // ---------- Righe 2-3: intestazioni ----------
    ws.getRow(2).height = 19;
    ws.getRow(3).height = 19;
    var FIXED = { day: MONTHS[m - 1], note: 'Note', extra: 'EXTRA', training: 'FORMAZIONE',
      events: 'MANIFESTAZIONI', absences: 'ASSENZE' };
    L.groups.forEach(function (g) {
      var h = g.shift
        ? { label: String(g.shift.name).toUpperCase() + ' | ' + (g.shift.ambCode || 'UR'),
          sub: g.shift.startText + ' - ' + g.shift.endText }
        : { label: FIXED[g.key], size: g.key === 'day' ? 12 : 10 };
      var c0 = g.start, c1 = c0 + g.cols - 1;
      if (h.sub) {
        ws.mergeCells(2, c0, 2, c1);
        ws.mergeCells(3, c0, 3, c1);
        cell(2, c0).value = h.label;
        cell(3, c0).value = h.sub;
      } else {
        ws.mergeCells(2, c0, 3, c1);
        cell(2, c0).value = h.label;
      }
      for (var r = 2; r <= 3; r++) {
        for (var cc = c0; cc <= c1; cc++) {
          style(r, cc, {
            font: { size: h.size || 10, bold: true },
            border: {
              top: r === 2 ? medium() : (h.sub ? thin() : undefined),
              bottom: r === 3 ? medium() : (h.sub ? thin() : undefined),
              left: cc === c0 ? (cc === 1 || cc === 3 || MEDIUM_LEFT[cc] ? medium() : thin()) : undefined,
              right: cc === c1 ? (cc === LAST_COL || cc === 2 || MEDIUM_LEFT[cc + 1] ? medium() : thin()) : undefined
            }
          });
        }
      }
    });

    // ---------- Giorni ----------
    rows.forEach(function (d, i) {
      var r = 4 + i;
      ws.getRow(r).height = 15;
      var values = {};
      values[1] = d.weekday;
      values[2] = d.date;
      L.shifts.forEach(function (sh) {
        (d.shifts[sh.id] || []).forEach(function (v, j) { if (v) values[START['s:' + sh.id] + j] = v; });
      });
      ['extra', 'training', 'events', 'absences'].forEach(function (k) {
        d[k].forEach(function (v, j) { if (v) values[START[k] + j] = v; });
      });
      var sat = d.weekend && d.weekday === 'SAB';
      var sun = d.weekend && d.weekday === 'DOM';
      var last = i === rows.length - 1;
      for (var cc = 1; cc <= LAST_COL; cc++) {
        if (values[cc] != null) cell(r, cc).value = values[cc];
        var isNote = cc === START.note;
        style(r, cc, {
          font: cc <= 2 ? { bold: true, size: 8 } : { size: 7.5 },
          fill: isNote ? GREY : d.weekend ? GREEN : undefined,
          border: {
            top: sat ? medium() : thin(),
            bottom: sun || last ? medium() : thin(),
            left: cc === 1 || MEDIUM_LEFT[cc] || cc === 3 ? medium() : thin(),
            right: cc === LAST_COL || MEDIUM_LEFT[cc + 1] || cc === 2 ? medium() : thin()
          }
        });
      }
    });

    return wb;
  }

  function fileName(y, m) {
    return 'Tabellone turni - ' + MONTHS[m - 1].charAt(0) + MONTHS[m - 1].slice(1).toLowerCase() + ' ' + y + '.xlsx';
  }

  var ExportXlsx = {
    DEFAULT_TITLE: DEFAULT_TITLE,
    defaultShortNames: defaultShortNames,
    tabelloneDays: tabelloneDays,
    tabelloneRows: tabelloneRows,
    layoutFor: layoutFor,
    buildWorkbook: buildWorkbook,
    fileName: fileName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ExportXlsx;
  else root.ExportXlsx = ExportXlsx;
})(this);
