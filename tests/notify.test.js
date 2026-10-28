const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/notify.js');

const UNIT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function fakeRes() {
  return { statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } };
}

// Supabase finto + invio finto delle mail.
function withEnv({ caller = { role: 'referente', unit_id: UNIT, active: true, is_admin: false }, published = true, coords = [], notified = null } = {}, fn) {
  const calls = [], mails = [];
  const orig = global.fetch;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.MAIL_FROM = 'turni@critn.it';
  process.env.SITE_URL = 'https://turni.example';
  handler._setTransport({ sendMail: async m => { mails.push(m); } });
  global.fetch = async (url, opts) => {
    calls.push(url + (opts && opts.method ? ' ' + opts.method : ''));
    const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (url.endsWith('/auth/v1/user')) return ok({ id: 'me' });
    if (url.includes('profiles?select=first_name,last_name')) {
      return ok([Object.assign({ first_name: 'Anna', last_name: 'Verdi', email: 'anna.verdi@critn.it' }, caller)]);
    }
    if (url.includes('/request_bumps?')) {
      if (opts && opts.method === 'PATCH') return ok(null, 204);
      return ok(url.includes('created_by=eq.me') ? [{ id: 'b1', employee_id: 'e2', day: '2026-12-10', kind: 'R', part: 'N' }] : []);
    }
    if (url.includes('/units?')) return ok([{ name: 'U.T. Trento' }]);
    if (url.includes('/published?')) {
      if (opts && opts.method === 'PATCH') return ok(null, 204);
      return ok(published ? [{ month: '2026-12', notified_at: notified }] : []);
    }
    if (url.includes('role=in.(coordinatore,vice_coordinatore)')) return ok(coords);
    if (url.includes('role=eq.dipendente')) {
      const all = [{ first_name: 'Luca', email: 'luca@critn.it', employee_id: 'e1' }, { first_name: 'Sara', email: 'sara@critn.it', employee_id: 'e2' }];
      const m = url.match(/employee_id=eq\.([^&]+)/);
      return ok(m ? all.filter(p => p.employee_id === decodeURIComponent(m[1])) : all);
    }
    throw new Error('url inattesa ' + url);
  };
  return fn(mails, calls).finally(() => { global.fetch = orig; handler._setTransport(null); });
}

const req = (body) => ({ method: 'POST', headers: { authorization: 'Bearer tok' }, body });

test('avviso di pubblicazione a tutti i dipendenti attivi, dal nome del referente', () => withEnv({}, async (mails) => {
  const res = fakeRes();
  await handler(req({ type: 'published', unit_id: UNIT, month: '2026-12' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { sent: 2, failed: 0 });
  assert.deepEqual(mails.map(m => m.to), ['luca@critn.it', 'sara@critn.it']);
  assert.equal(mails[0].from.name, 'Anna Verdi (referente) – Turni Ambulanza');
  assert.equal(mails[0].from.address, 'turni@critn.it');
  assert.deepEqual(mails[0].replyTo, { name: 'Anna Verdi', address: 'anna.verdi@critn.it' });
  assert.equal(mails[0].subject, 'Turni di dicembre 2026 pubblicati – U.T. Trento');
  assert.match(mails[0].text, /^Ciao Luca,/);
  assert.match(mails[0].text, /https:\/\/turni\.example/);
}));

test('pubblicazione: solo se il mese è davvero pubblicato', () => withEnv({ published: false }, async (mails) => {
  const res = fakeRes();
  await handler(req({ type: 'published', unit_id: UNIT, month: '2026-12' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(mails.length, 0);
}));

test('rifiuto: mail solo al dipendente interessato, con giorni e motivazione', () => withEnv({ caller: { role: 'vice_referente', unit_id: UNIT, active: true } }, async (mails) => {
  const res = fakeRes();
  await handler(req({ type: 'rejected', unit_id: UNIT, employee_id: 'e1', kind: 'R', days: ['2026-12-12', '2026-12-05'],
    reason: 'Turno scoperto, manca personale.' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'luca@critn.it');
  assert.equal(mails[0].from.name, 'Anna Verdi (vice referente) – Turni Ambulanza');
  assert.equal(mails[0].subject, 'Richiesta di riposo non accolta – 05/12, 12/12');
  assert.match(mails[0].text, /sabato 5 dicembre 2026/);
  assert.match(mails[0].text, /Motivazione:\nTurno scoperto, manca personale\./);
  // senza motivazione non parte nulla
  const res2 = fakeRes();
  await handler(req({ type: 'rejected', unit_id: UNIT, employee_id: 'e1', days: ['2026-12-05'], reason: ' ' }), res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(mails.length, 1);
}));

test('avvisi: solo referente o vice attivo della stessa unità', () => withEnv({ caller: { role: 'dipendente', unit_id: UNIT, active: true } }, async (mails) => {
  const res = fakeRes();
  await handler(req({ type: 'published', unit_id: UNIT, month: '2026-12' }), res);
  assert.equal(res.statusCode, 403);
  const res2 = fakeRes();
  await handler(req({ type: 'published', unit_id: OTHER, month: '2026-12' }), res2);
  assert.equal(res2.statusCode, 403);
  assert.equal(mails.length, 0);
}));

test('riposo annullato da un 104: mail al collega, senza dire chi', () => withEnv(
  { caller: { role: 'dipendente', unit_id: UNIT, active: true, is_admin: false } }, async (mails, calls) => {
    const res = fakeRes();
    await handler(req({ type: 'bumped', unit_id: UNIT }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(mails.map(m => m.to), ['sara@critn.it']);
    assert.equal(mails[0].from.name, 'Turni Ambulanza');
    assert.match(mails[0].text, /giovedì 10 dicembre 2026 \(solo il turno di notte\) è stata annullata/);
    assert.doesNotMatch(mails[0].text, /Anna|Verdi/);
    assert.ok(calls.some(c => c.includes('request_bumps?id=in.(b1)') && c.endsWith('PATCH')));
  }));

test('riposo annullato: solo dipendenti attivi della stessa unità', () => withEnv(
  { caller: { role: 'dipendente', unit_id: OTHER, active: true, is_admin: false } }, async (mails) => {
    const res = fakeRes();
    await handler(req({ type: 'bumped', unit_id: UNIT }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(mails.length, 0);
  }));

test('pubblicazione: anche al coordinatore e al vice, con il tabellone in Excel', () => withEnv(
  { coords: [{ first_name: 'Carla', email: 'carla.coord@critn.it' }, { first_name: 'Anna', email: 'anna.verdi@critn.it' }] },
  async (mails) => {
    const res = fakeRes();
    const excel = Buffer.from('PK\x03\x04 finto xlsx').toString('base64');
    await handler(req({ type: 'published', unit_id: UNIT, month: '2026-12', excel, excel_name: 'Tabellone dicembre 2026' }), res);
    assert.equal(res.statusCode, 200);
    // Anna pubblica: a lei non arriva
    assert.deepEqual(mails.map(m => m.to), ['luca@critn.it', 'sara@critn.it', 'carla.coord@critn.it']);
    const c = mails[2];
    assert.match(c.text, /^Ciao Carla,\n\nAnna Verdi \(referente\) ha pubblicato i turni di dicembre 2026 dell'unità U\.T\. Trento/);
    assert.equal(c.attachments[0].filename, 'Tabellone dicembre 2026.xlsx');
    assert.equal(c.attachments[0].content.toString(), 'PK\x03\x04 finto xlsx');
    assert.equal(mails[0].attachments, undefined); // ai dipendenti niente allegato
  }));

test('pubblicazione: niente allegato se non è un file Excel; una sola mail per pubblicazione', () => withEnv(
  { coords: [{ first_name: 'Carla', email: 'carla.coord@critn.it' }] }, async (mails, calls) => {
    const res = fakeRes();
    await handler(req({ type: 'published', unit_id: UNIT, month: '2026-12', excel: Buffer.from('<html>').toString('base64') }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(mails[2].attachments, undefined);
    assert.doesNotMatch(mails[2].text, /In allegato/);
    assert.ok(calls.some(c => c.includes('/published?unit_id=eq.' + UNIT + '&month=eq.2026-12') && c.endsWith('PATCH')));
  }));

test('pubblicazione già avvisata: non rimanda le mail', () => withEnv({ notified: '2026-11-20T10:00:00Z' }, async (mails) => {
  const res = fakeRes();
  await handler(req({ type: 'published', unit_id: UNIT, month: '2026-12' }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(mails.length, 0);
}));
