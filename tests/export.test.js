const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rules.js');
const X = require('../js/export-xlsx.js');

test('tabellone: settimane che iniziano con un lunedì del mese', () => {
  const days = X.tabelloneDays(R, 2026, 10);
  assert.equal(days[0], '2026-10-05');
  assert.equal(days[days.length - 1], '2026-11-01');
  assert.equal(days.length, 28);
  assert.equal(X.tabelloneDays(R, 2026, 11).length, 35); // 5 lunedì: dal 2/11 al 6/12
});

test('nomi nel tabellone: cognome, con le iniziali del nome se il cognome è ripetuto', () => {
  const names = X.defaultShortNames([
    { id: 'a', name: 'Bettega Giulia' }, { id: 'b', name: 'Bettega Chiara' }, { id: 'c', name: 'Tomas Marco' }
  ]);
  assert.deepEqual(names, { a: 'BETTEGA GI.', b: 'BETTEGA CH.', c: 'TOMAS' });
});

test('righe del tabellone: giorno, notte, formazione e assenze', () => {
  const employees = [
    { id: 'a', name: 'Rossi Mario', role: 'soccorritore', weeklyHours: 38 },
    { id: 'b', name: 'Verdi Anna', role: 'autista', weeklyHours: 38, shortName: 'VERDI A.' },
    { id: 'c', name: 'Neri Luca', role: 'autista', weeklyHours: 38 },
    { id: 'd', name: 'Bianchi Sara', role: 'soccorritore', weeklyHours: 38 }
  ];
  const state = { settings: R.DEFAULT_SETTINGS, employees, assignments: {
    a: { '2026-10-05': 'G', '2026-10-06': 'F', '2026-10-07': 'F' },
    b: { '2026-10-05': 'G' },
    c: { '2026-10-05': 'N', '2026-10-06': { code: 'C', hours: 7 } },
    d: { '2026-10-06': 'P', '2026-10-07': 'F', '2026-10-10': 'R' }
  } };
  const rows = X.tabelloneRows(R, state, 2026, 10);
  assert.equal(rows[0].weekday, 'LUN');
  assert.equal(rows[0].date, '05-ott');
  assert.deepEqual(rows[0].shifts.G, ['VERDI A.', 'ROSSI']); // prima l'autista
  assert.deepEqual(rows[0].shifts.N, ['NERI']);
  assert.deepEqual(rows[1].training.filter(Boolean), ['NERI']);
  assert.deepEqual(rows[1].absences.slice(0, 2), ['ROSSI', 'BIANCHI']);
  assert.deepEqual(rows[2].absences.slice(0, 2), ['ROSSI', 'BIANCHI']); // stessa colonna nei giorni di fila
  assert.equal(rows[5].weekend, true);
  assert.deepEqual(rows[5].absences.filter(Boolean), []); // la richiesta di riposo non è un'assenza
  assert.equal(rows[27].date, '01-nov');
});
