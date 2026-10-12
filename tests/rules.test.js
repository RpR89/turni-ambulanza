const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rules.js');

function makeState(employees, assignments, settings) {
  return {
    settings: Object.assign({}, R.DEFAULT_SETTINGS, settings || {}),
    employees,
    assignments: assignments || {}
  };
}

const FT = { id: 'a', name: 'Anna', weeklyHours: 38 };
const PT = { id: 'b', name: 'Bruno', weeklyHours: 24 };

test('giorni lavorativi e monte ore mensile', () => {
  // Ottobre 2026: 22 giorni lun–ven
  assert.equal(R.workingDaysInMonth(2026, 10), 22);
  assert.equal(R.monthlyTarget(FT, 2026, 10), 167.2); // 22 × 7,6
  assert.equal(R.monthlyTarget(PT, 2026, 10), 105.6); // 22 × 4,8
  // Febbraio 2026: 20 giorni lun–ven
  assert.equal(R.workingDaysInMonth(2026, 2), 20);
  assert.equal(R.monthlyTarget(FT, 2026, 2), 152);
});

test('settimane da lunedì a domenica', () => {
  assert.equal(R.weekday('2026-10-12'), 0); // lunedì
  assert.equal(R.weekStart('2026-10-18'), '2026-10-12');
  assert.deepEqual(R.monthWeeks(2026, 2)[0], '2026-01-26');
});

test('notte seguita da giorno il mattino dopo viola il riposo', () => {
  const s = makeState([FT], { a: { '2026-10-12': 'N', '2026-10-13': 'G' } });
  const errs = R.validateMonth(s, 2026, 10).filter(i => i.type === 'rest');
  assert.equal(errs.length, 1);
  assert.deepEqual(errs[0].dates, ['2026-10-12', '2026-10-13']);
});

test('giorno e notte nello stesso giorno viola il riposo', () => {
  const s = makeState([FT], { a: { '2026-10-12': 'G' } });
  assert.equal(R.blockers(s, 'a', '2026-10-12', 'N').length, 0); // stesso giorno: viene sostituito
  s.assignments.a['2026-10-11'] = 'N';
  assert.equal(R.blockers(s, 'a', '2026-10-12', 'G').length, 1);
});

test('turni consecutivi dello stesso tipo hanno 12 h di riposo', () => {
  const s = makeState([FT], { a: { '2026-10-12': 'N', '2026-10-13': 'N', '2026-10-14': 'G' } });
  const rest = R.validateMonth(s, 2026, 10).filter(i => i.type === 'rest');
  assert.equal(rest.length, 1); // solo N 13 → G 14
  assert.deepEqual(rest[0].dates, ['2026-10-13', '2026-10-14']);
});

test('riposo controllato a cavallo tra due mesi', () => {
  const s = makeState([FT], { a: { '2026-09-30': 'N', '2026-10-01': 'G' } });
  assert.equal(R.validateMonth(s, 2026, 10).filter(i => i.type === 'rest').length, 1);
});

test('massimo 48 ore settimanali', () => {
  const a = {};
  ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].forEach(d => { a[d] = 'G'; });
  const s = makeState([FT], { a });
  assert.equal(R.weekHours(s, 'a', '2026-10-12'), 48);
  assert.equal(R.validateMonth(s, 2026, 10).filter(i => i.type === 'week').length, 0);
  assert.equal(R.blockers(s, 'a', '2026-10-17', 'G').length, 1);
  s.assignments.a['2026-10-17'] = 'G';
  assert.equal(R.validateMonth(s, 2026, 10).filter(i => i.type === 'week').length, 1);
});

test('ferie e malattia contano solo nei giorni lun–ven', () => {
  const s = makeState([FT, PT], {
    a: { '2026-10-12': 'F', '2026-10-17': 'F', '2026-10-13': 'G' },
    b: { '2026-10-12': 'M' }
  });
  const sa = R.monthSummary(s, FT, 2026, 10);
  assert.equal(sa.worked, 12);
  assert.equal(sa.absence, 7.6);
  assert.equal(sa.balance, Math.round((12 + 7.6 - 167.2) * 10) / 10);
  assert.equal(R.monthSummary(s, PT, 2026, 10).absence, 4.8);
});

test('copertura: segnala turni scoperti', () => {
  const s = makeState([FT], {}, { staffPerShift: { G: 1, N: 0 } });
  const cov = R.validateMonth(s, 2026, 10).filter(i => i.type === 'coverage');
  assert.equal(cov.length, 31);
});

test('la proposta automatica rispetta tutti i vincoli', () => {
  const employees = [];
  for (let i = 0; i < 12; i++) {
    employees.push({ id: 'e' + i, name: 'Dip ' + i, weeklyHours: i < 10 ? 38 : 24, role: i % 2 ? 'soccorritore' : 'autista' });
  }
  const s = makeState(employees, { e0: { '2026-10-05': 'F', '2026-10-06': 'F' } });
  const res = R.generateMonth(s, 2026, 10);
  const out = makeState(employees, res.assignments);
  const issues = R.validateMonth(out, 2026, 10);
  assert.equal(issues.filter(i => i.level === 'error').length, 0);
  assert.equal(res.uncovered.length, 0);
  assert.equal(issues.length, 0);
  // non sovrascrive quanto già inserito
  assert.equal(res.assignments.e0['2026-10-05'], 'F');
  // il part-time lavora meno del tempo pieno
  const ft = R.monthSummary(out, employees[0], 2026, 10);
  const pt = R.monthSummary(out, employees[11], 2026, 10);
  assert.ok(pt.worked < ft.worked + ft.absence);
});

test('permessi 104: valgono 7,6 h ciascuno, solo per chi ha diritto, massimo 3 al mese', () => {
  const emp104 = { id: 'c', name: 'Carla', weeklyHours: 38, has104: true };
  const s = makeState([emp104, FT], {
    c: { '2026-10-05': 'P', '2026-10-12': 'P', '2026-10-17': 'P' },
    a: { '2026-10-05': 'P' }
  });
  assert.equal(R.monthSummary(s, emp104, 2026, 10).absence, 22.8); // anche di sabato
  let errs = R.validateMonth(s, 2026, 10).filter(i => i.type === 'perm104');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].empId, 'a'); // Anna non ha la 104

  s.assignments.c['2026-10-20'] = 'P';
  errs = R.validateMonth(s, 2026, 10).filter(i => i.type === 'perm104' && i.empId === 'c');
  assert.equal(errs.length, 1);
  assert.deepEqual(errs[0].dates, ['2026-10-20']);
  // il conteggio riparte ogni mese
  s.assignments.c['2026-11-02'] = 'P';
  assert.equal(R.validateMonth(s, 2026, 11).filter(i => i.type === 'perm104').length, 0);
});

test('formazione: conta come lavoro, anche nelle 48 h settimanali', () => {
  const a = { '2026-10-12': 'G', '2026-10-13': 'G', '2026-10-14': 'G', '2026-10-16': { code: 'C', hours: 6 } };
  const s = makeState([FT], { a });
  const sum = R.monthSummary(s, FT, 2026, 10);
  assert.equal(sum.worked, 36);
  assert.equal(sum.training, 6);
  assert.equal(sum.balance, Math.round((42 - 167.2) * 10) / 10);
  assert.equal(R.weekHours(s, 'a', '2026-10-12'), 42);
  assert.equal(R.blockers(s, 'a', '2026-10-17', 'G').length, 1); // 54 h > 48
  assert.equal(R.staffOn(s, '2026-10-16', 'G').length, 0);
});

test('la proposta automatica rispetta richieste di riposo, formazione e permessi', () => {
  const employees = [];
  for (let i = 0; i < 12; i++) {
    employees.push({ id: 'e' + i, name: 'Dip ' + i, weeklyHours: 38, has104: i === 0, role: i < 6 ? 'autista' : 'soccorritore' });
  }
  const fixed = {
    e0: { '2026-10-07': 'P' },
    e1: { '2026-10-07': 'R', '2026-10-08': 'R' },
    e2: { '2026-10-07': { code: 'C', hours: 8 } }
  };
  const s = makeState(employees, JSON.parse(JSON.stringify(fixed)));
  const res = R.generateMonth(s, 2026, 10);
  assert.deepEqual(res.assignments.e1['2026-10-07'], 'R');
  assert.deepEqual(res.assignments.e1['2026-10-08'], 'R');
  assert.deepEqual(res.assignments.e2['2026-10-07'], { code: 'C', hours: 8 });
  assert.equal(res.assignments.e0['2026-10-07'], 'P');
  const out = makeState(employees, res.assignments);
  assert.equal(R.validateMonth(out, 2026, 10).filter(i => i.level === 'error').length, 0);
});

const DRV = { id: 'd', name: 'Dario', weeklyHours: 38, role: 'autista' };
const SOC = { id: 's', name: 'Sofia', weeklyHours: 38, role: 'soccorritore' };
const SOC2 = { id: 't', name: 'Tina', weeklyHours: 38, role: 'soccorritore' };

test('ogni turno con personale deve avere almeno un autista soccorritore', () => {
  const s = makeState([DRV, SOC, SOC2], {
    s: { '2026-10-12': 'G', '2026-10-13': 'N' },
    t: { '2026-10-12': 'G' },
    d: { '2026-10-13': 'N' }
  });
  const errs = R.validateMonth(s, 2026, 10).filter(i => i.type === 'driver');
  assert.equal(errs.length, 1);
  assert.deepEqual(errs[0].dates, ['2026-10-12']);
  assert.deepEqual(errs[0].empIds.sort(), ['s', 't']);
  assert.equal(errs[0].level, 'error');
});

test('la proposta automatica mette sempre un autista e poi preferisce i soccorritori', () => {
  const employees = [];
  for (let i = 0; i < 12; i++) {
    employees.push({ id: 'e' + i, name: 'Dip ' + i, weeklyHours: i < 10 ? 38 : 24, role: i < 5 ? 'autista' : 'soccorritore' });
  }
  const s = makeState(employees, {});
  const res = R.generateMonth(s, 2026, 10);
  const out = makeState(employees, res.assignments);
  assert.equal(R.validateMonth(out, 2026, 10).filter(i => i.level === 'error').length, 0);
  assert.equal(res.uncovered.length, 0);
  R.monthDays(2026, 10).forEach(k => ['G', 'N'].forEach(c => {
    assert.equal(R.staffOn(out, k, c).filter(R.isDriver).length, 1, k + ' ' + c);
  }));
});

test('senza autisti disponibili il turno viene comunque coperto e segnalato', () => {
  const s = makeState([SOC, SOC2], {}, { staffPerShift: { G: 2, N: 0 } });
  const res = R.generateMonth(s, 2026, 10);
  assert.ok(res.uncovered.some(u => u.driver));
  assert.equal(R.staffOn(makeState([SOC, SOC2], res.assignments), '2026-10-01', 'G').length, 2);
});
