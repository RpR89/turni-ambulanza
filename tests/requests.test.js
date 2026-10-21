const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rules.js');
const O = require('../js/requests.js');

function makeState(assignments, extra) {
  return Object.assign({
    settings: Object.assign({}, R.DEFAULT_SETTINGS),
    employees: [
      { id: 'a', name: 'Rossi Mario', role: 'autista', weeklyHours: 38, has104: true },
      { id: 'b', name: 'Verdi Anna', role: 'soccorritore', weeklyHours: 38 }
    ],
    assignments: assignments || {},
    locks: {},
    auto: {}
  }, extra || {});
}

test('giorno limite per le richieste: nel mese precedente', () => {
  assert.equal(O.requestDeadline(2026, 12, 15), '2026-11-15');
  assert.equal(O.requestDeadline(2027, 1, 15), '2026-12-15');
  assert.equal(O.requestDeadline(2026, 3, 31), '2026-02-28'); // febbraio più corto
});

test('le richieste entrano nel tabellone senza togliere i turni scritti a mano', () => {
  const s = makeState(
    { a: { '2026-12-03': 'G', '2026-12-04': 'N' }, b: { '2026-12-05': 'F' } },
    { auto: { a: { '2026-12-04': true } }, locks: { b: { '2026-12-07': true } } });
  const res = O.syncRequests(s, [
    { id: 1, employee_id: 'a', day: '2026-12-02', kind: 'R' },  // casella vuota
    { id: 2, employee_id: 'a', day: '2026-12-03', kind: 'R' },  // turno a mano → conflitto
    { id: 3, employee_id: 'a', day: '2026-12-04', kind: 'P' },  // turno automatico → lo sostituisce
    { id: 4, employee_id: 'b', day: '2026-12-05', kind: 'R' },  // già in ferie → nulla
    { id: 5, employee_id: 'b', day: '2026-12-07', kind: 'R' },  // casella bloccata → conflitto
    { id: 6, employee_id: 'zz', day: '2026-12-07', kind: 'R' }  // dipendente non più nel tabellone
  ]);
  assert.equal(res.added, 2);
  assert.equal(s.assignments.a['2026-12-02'], 'R');
  assert.equal(s.assignments.a['2026-12-03'], 'G');
  assert.equal(s.assignments.a['2026-12-04'], 'P');
  assert.equal(s.auto.a['2026-12-04'], undefined);
  assert.equal(s.assignments.b['2026-12-05'], 'F');
  assert.deepEqual(res.conflicts.map(c => c.request.id), [2, 5]);
  assert.equal(O.tagOf(s, 'a', '2026-12-02'), 'R');

  // una seconda sincronizzazione uguale non cambia nulla
  assert.equal(O.syncRequests(s, [
    { id: 1, employee_id: 'a', day: '2026-12-02', kind: 'R' },
    { id: 3, employee_id: 'a', day: '2026-12-04', kind: 'P' }
  ]).changed, false);

  // il dipendente toglie la richiesta → la casella torna vuota
  const res2 = O.syncRequests(s, [{ id: 3, employee_id: 'a', day: '2026-12-04', kind: 'P' }]);
  assert.equal(res2.removed, 1);
  assert.equal(s.assignments.a['2026-12-02'], undefined);
  assert.equal(O.tagOf(s, 'a', '2026-12-02'), '');

  // se il referente aveva già cambiato la casella, resta la sua scelta
  s.assignments.a['2026-12-04'] = 'G';
  O.syncRequests(s, []);
  assert.equal(s.assignments.a['2026-12-04'], 'G');
});

test('pubblicazione: solo il mese, malattia e 104 senza motivo', () => {
  const s = makeState({
    a: { '2026-12-01': 'G', '2026-12-02': ['G', 'N'], '2026-12-03': 'M', '2026-12-04': 'P', '2027-01-01': 'G' },
    b: { '2026-12-01': { code: 'C', hours: 7 }, '2026-12-02': 'F', '2026-12-03': 'R' }
  });
  s.employees.push({ id: 'c', name: 'Ex Dipendente', role: 'soccorritore', weeklyHours: 38, active: false });
  const snap = O.buildSnapshot(s, 2026, 12);
  assert.equal(snap.month, '2026-12');
  assert.deepEqual(snap.employees.map(e => e.id), ['a', 'b']);
  assert.deepEqual(snap.cells.a, { '2026-12-01': 'G', '2026-12-02': ['G', 'N'], '2026-12-03': 'A', '2026-12-04': 'A' });
  assert.deepEqual(snap.cells.b, { '2026-12-01': { code: 'C', hours: 7 }, '2026-12-02': 'F', '2026-12-03': 'R' });
  assert.equal(snap.employees[0].has104, undefined); // nessun dato sulla 104 nella copia pubblica
  assert.equal(snap.ambulances[0].shifts[0].label, 'G');
  assert.deepEqual(snap.volunteers, {});
  s.volunteers = { '2026-12-05': { G: { A: 1, S: 0 }, N: { A: 0, S: 0 } }, '2027-01-02': { G: { A: 1, S: 1 } } };
  assert.deepEqual(O.buildSnapshot(s, 2026, 12).volunteers, { '2026-12-05': { G: { A: 1, S: 0 } } });
  delete s.volunteers;
  assert.ok(O.sameSnapshot(snap, O.buildSnapshot(s, 2026, 12)));
  // il database restituisce le chiavi in un altro ordine: conta solo il contenuto
  const reverseKeys = v => Array.isArray(v) ? v.map(reverseKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reverseKeys(v[k])])) : v;
  const reordered = reverseKeys(snap);
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(snap));
  assert.ok(O.sameSnapshot(snap, reordered));
  s.assignments.b['2026-12-10'] = 'N';
  assert.ok(!O.sameSnapshot(snap, O.buildSnapshot(s, 2026, 12)));
});
