/*
 * Esportazione del tabellone turni in Excel (.xlsx), con lo stesso aspetto del
 * "TABELLONE TURNI" usato dal comitato: logo e titolo, colonne GIORNO | UR, Note,
 * NOTTE | UR, EXTRA, FORMAZIONE, MANIFESTAZIONI, ASSENZE, weekend in verde.
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

  // Colonne (1 = A): gruppi con il numero di colonne di ciascuno.
  var GROUPS = [
    { key: 'day', cols: 2 },          // A-B  giorno della settimana e data
    { key: 'G', cols: 3 },            // C-E  GIORNO | UR
    { key: 'note', cols: 1 },         // F    Note
    { key: 'N', cols: 3 },            // G-I  NOTTE | UR
    { key: 'extra', cols: 2 },        // J-K  EXTRA
    { key: 'training', cols: 5 },     // L-P  FORMAZIONE
    { key: 'events', cols: 2 },       // Q-R  MANIFESTAZIONI
    { key: 'absences', cols: 5 }      // S-W  ASSENZE
  ];
  var START = {};
  (function () {
    var c = 1;
    GROUPS.forEach(function (g) { START[g.key] = c; c += g.cols; });
  })();
  var LAST_COL = 23;

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
  // da lunedì 5 ottobre a domenica 1 novembre).
  function tabelloneDays(Rules, y, m) {
    var days = [];
    Rules.monthDays(y, m).forEach(function (k) {
      if (Rules.weekday(k) === 0) for (var i = 0; i < 7; i++) days.push(Rules.addDays(k, i));
    });
    return days;
  }

  // Contenuto del tabellone, separato dalla grafica (usato anche dai test).
  function tabelloneRows(Rules, state, y, m) {
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
    return tabelloneDays(Rules, y, m).map(function (k) {
      var p = k.split('-');
      var withCode = function (codes) {
        return emps.filter(function (e) { return codes.indexOf(Rules.codeOn(state, e.id, k)) >= 0; }).map(name);
      };
      var day = byDriverThenOrder(Rules.staffOn(state, k, 'G')).map(name);
      var night = byDriverThenOrder(Rules.staffOn(state, k, 'N')).map(name);
      return {
        key: k,
        weekday: WEEKDAYS[Rules.weekday(k)],
        date: p[2] + '-' + MONTHS_SHORT[+p[1] - 1],
        weekend: Rules.weekday(k) >= 5,
        G: day.slice(0, 3),
        N: night.slice(0, 3),
        // oltre la terza persona del turno si scrive in EXTRA
        extra: day.slice(3).concat(night.slice(3)).slice(0, 2),
        training: slots('training', withCode(['C']), 5),
        events: [],
        absences: slots('absences', withCode(['F', 'M', 'P']), 5)
      };
    });
  }

  function thin() { return { style: 'thin', color: { argb: 'FF000000' } }; }
  function medium() { return { style: 'medium', color: { argb: 'FF000000' } }; }

  // Bordo spesso a sinistra di ogni gruppo di colonne (tranne tra GIORNO e Note, come nell'originale).
  var MEDIUM_LEFT = {};
  [START.G, START.N, START.extra, START.training, START.events, START.absences].forEach(function (c) {
    MEDIUM_LEFT[c] = true;
  });

  function buildWorkbook(ExcelJS, Rules, state, y, m, opts) {
    opts = opts || {};
    var title = (state.settings && state.settings.tabelloneTitle) || DEFAULT_TITLE;
    var rows = tabelloneRows(Rules, state, y, m);

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
    var headers = [
      { key: 'day', label: MONTHS[m - 1], size: 12 },
      { key: 'G', label: 'GIORNO | UR', sub: '07:00 - 19:00' },
      { key: 'note', label: 'Note' },
      { key: 'N', label: 'NOTTE | UR', sub: '19:00 - 07:00' },
      { key: 'extra', label: 'EXTRA' },
      { key: 'training', label: 'FORMAZIONE' },
      { key: 'events', label: 'MANIFESTAZIONI' },
      { key: 'absences', label: 'ASSENZE' }
    ];
    headers.forEach(function (h) {
      var g = GROUPS.filter(function (x) { return x.key === h.key; })[0];
      var c0 = START[h.key], c1 = c0 + g.cols - 1;
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
      ['G', 'N', 'extra', 'training', 'events', 'absences'].forEach(function (k) {
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
    buildWorkbook: buildWorkbook,
    fileName: fileName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ExportXlsx;
  else root.ExportXlsx = ExportXlsx;
})(this);
