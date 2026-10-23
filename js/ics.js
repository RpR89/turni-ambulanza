/*
 * File di calendario (.ics, standard iCalendar) con i turni di un dipendente in un mese:
 * si apre con Google Calendar, il calendario dell'iPhone, Outlook… Senza DOM, testato (window.Ics).
 *
 * Ogni evento ha un identificativo fisso (mese, dipendente, giorno, turno): importando di nuovo il file
 * dopo un cambio, i calendari aggiornano gli eventi invece di duplicarli.
 */
(function (root) {
  'use strict';

  var TZ = 'Europe/Rome';
  var VTIMEZONE = [
    'BEGIN:VTIMEZONE', 'TZID:' + TZ,
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
    'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
    'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE'
  ];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function addDays(key, n) {
    var p = key.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function minutes(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? +m[1] * 60 + +m[2] : null;
  }

  // "2026-12-05", "07:00" → "20261205T070000"
  function stamp(key, time) { return key.replace(/-/g, '') + 'T' + time.replace(':', '') + '00'; }

  // Testo per iCalendar: \ ; , e a capo vanno protetti.
  function text(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // Righe lunghe spezzate a 75 byte (continuazione con uno spazio), senza tagliare i caratteri accentati.
  function fold(line) {
    var out = [], cur = '', bytes = 0;
    Array.from(line).forEach(function (ch) {
      var b = new TextEncoder().encode(ch).length;
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch;
      bytes += b;
    });
    out.push(cur);
    return out.join('\r\n ');
  }

  /*
   * Eventi del dipendente da { giorno: voce } (voce = id turno, elenco di id, {code:'C', hours}, codice).
   * shifts: id → { name, label, start: 'HH:MM', end: 'HH:MM', ambCode }.
   * Ci vanno i turni (con orario; quelli che passano la mezzanotte finiscono il giorno dopo) e la formazione
   * (tutto il giorno); ferie, riposi e assenze no.
   */
  function shiftEvents(entries, shifts) {
    var events = [];
    Object.keys(entries || {}).sort().forEach(function (day) {
      var e = entries[day];
      if (!e) return;
      if (typeof e === 'object' && !Array.isArray(e)) {
        if (e.code === 'C') events.push({ day: day, id: 'C', allDay: true, title: 'Formazione' + (e.hours ? ' (' + e.hours + ' h)' : '') });
        return;
      }
      (Array.isArray(e) ? e : [e]).forEach(function (id) {
        var s = shifts[id];
        if (!s) return;
        var a = minutes(s.start), b = minutes(s.end);
        if (a == null || b == null) return;
        events.push({
          day: day, id: id, start: s.start, end: s.end,
          endDay: b <= a ? addDays(day, 1) : day,
          title: 'Turno ' + (s.name || s.label) + (s.label && s.label !== s.name ? ' (' + s.label + ')' : '') +
            (s.ambCode ? ' · amb. ' + s.ambCode : ''),
          description: (s.name || s.label) + ' ' + s.start + '–' + s.end + (s.ambCode ? ', ambulanza ' + s.ambCode : '')
        });
      });
    });
    return events;
  }

  // opts: { name: nome del calendario, uidKey: es. "2026-12-e1", location, now: Date (per i test) }
  function buildCalendar(events, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var dtstamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' +
      pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CRI Comitato di Trento//Turni Ambulanza//IT',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    if (opts.name) lines.push('X-WR-CALNAME:' + text(opts.name));
    lines.push('X-WR-TIMEZONE:' + TZ);
    lines = lines.concat(VTIMEZONE);
    events.forEach(function (ev) {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + text((opts.uidKey || 'turni') + '-' + ev.day + '-' + ev.id) + '@turni-ambulanza');
      lines.push('DTSTAMP:' + dtstamp);
      if (ev.allDay) {
        lines.push('DTSTART;VALUE=DATE:' + ev.day.replace(/-/g, ''));
        lines.push('DTEND;VALUE=DATE:' + addDays(ev.day, 1).replace(/-/g, ''));
      } else {
        lines.push('DTSTART;TZID=' + TZ + ':' + stamp(ev.day, ev.start));
        lines.push('DTEND;TZID=' + TZ + ':' + stamp(ev.endDay, ev.end));
      }
      lines.push('SUMMARY:' + text(ev.title));
      if (ev.description) lines.push('DESCRIPTION:' + text(ev.description));
      if (opts.location) lines.push('LOCATION:' + text(opts.location));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  function fileName(monthTitle, person) {
    return ('Turni ' + monthTitle + ' - ' + person).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.ics';
  }

  var Ics = { shiftEvents: shiftEvents, buildCalendar: buildCalendar, fileName: fileName };

  if (typeof module !== 'undefined' && module.exports) module.exports = Ics;
  else root.Ics = Ics;
})(this);
