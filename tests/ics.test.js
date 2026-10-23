const test = require('node:test');
const assert = require('node:assert/strict');
const Ics = require('../js/ics.js');

const SHIFTS = {
  G: { name: 'GIORNO', label: 'G', start: '07:00', end: '19:00', ambCode: '12345' },
  N: { name: 'NOTTE', label: 'N', start: '19:00', end: '07:00', ambCode: '12345' },
  H: { name: 'H24', label: 'H', start: '08:00', end: '08:00', ambCode: '' }
};

test('eventi: turni con orario, notti al giorno dopo, formazione tutto il giorno, niente ferie', () => {
  const ev = Ics.shiftEvents({
    '2026-12-31': 'N', '2026-12-01': 'G', '2026-12-02': ['G', 'N'], '2026-12-03': 'F',
    '2026-12-04': { code: 'C', hours: 7 }, '2026-12-05': 'R', '2026-12-06': 'H', '2026-12-07': 'X'
  }, SHIFTS);
  assert.deepEqual(ev.map(e => e.day + ':' + e.id), ['2026-12-01:G', '2026-12-02:G', '2026-12-02:N', '2026-12-04:C', '2026-12-06:H', '2026-12-31:N']);
  const night = ev.find(e => e.day === '2026-12-31');
  assert.equal(night.endDay, '2027-01-01');                      // a cavallo dell'anno
  assert.equal(ev.find(e => e.id === 'H').endDay, '2026-12-07');  // 24 ore
  assert.equal(ev[0].title, 'Turno GIORNO (G) · amb. 12345');
});

test('file .ics valido per Google Calendar', () => {
  const ev = Ics.shiftEvents({ '2026-12-01': 'G', '2026-12-31': 'N', '2026-12-04': { code: 'C', hours: 7 } }, SHIFTS);
  const ics = Ics.buildCalendar(ev, { name: 'Turni dicembre 2026 – Rossi, Mario', uidKey: '2026-12-e1',
    location: 'U.T. Trento', now: new Date(Date.UTC(2026, 9, 23, 10, 0, 0)) });
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[lines.length - 2], 'END:VCALENDAR');
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(lines.includes('X-WR-CALNAME:Turni dicembre 2026 – Rossi\\, Mario'));
  assert.ok(lines.includes('BEGIN:VTIMEZONE'));
  assert.ok(lines.includes('DTSTART;TZID=Europe/Rome:20261201T070000'));
  assert.ok(lines.includes('DTEND;TZID=Europe/Rome:20261201T190000'));
  assert.ok(lines.includes('DTSTART;TZID=Europe/Rome:20261231T190000'));
  assert.ok(lines.includes('DTEND;TZID=Europe/Rome:20270101T070000'));
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20261204'));
  assert.ok(lines.includes('DTEND;VALUE=DATE:20261205'));
  assert.ok(lines.includes('UID:2026-12-e1-2026-12-01-G@turni-ambulanza'));
  assert.ok(lines.includes('DTSTAMP:20261023T100000Z'));
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 3);
  // nessuna riga oltre 75 byte
  lines.forEach(l => assert.ok(Buffer.byteLength(l) <= 75, l));
});

test('righe lunghe spezzate senza rompere le lettere accentate', () => {
  const ics = Ics.buildCalendar([{ day: '2026-12-01', id: 'G', start: '07:00', end: '19:00', endDay: '2026-12-01',
    title: 'Turno ' + 'è'.repeat(60), description: 'x' }], { now: new Date(0) });
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:Turno ' + 'è'.repeat(60)));
  ics.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l) <= 75));
  assert.equal(Ics.fileName('Dicembre 2026', 'Rossi Mario'), 'Turni Dicembre 2026 - Rossi Mario.ics');
});
