const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/admin-invite.js');

const UNIT = '11111111-1111-1111-1111-111111111111';

function fakeRes() {
  return { statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } };
}

// Supabase finto: utente chiamante, profilo e invito.
function withSupabase({ admin = true, active = true, inviteStatus = 200, patchStatus = 200 } = {}, fn) {
  const calls = [];
  const orig = global.fetch;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (url.endsWith('/auth/v1/user')) {
      return opts.headers.Authorization === 'Bearer good' ? ok({ id: 'u1' }) : ok({}, 401);
    }
    if (url.includes('/rest/v1/profiles') && opts.method === 'PATCH') {
      return patchStatus === 200 ? ok([{ id: 'new' }]) : ok({ message: 'violates check constraint' }, patchStatus);
    }
    if (url.includes('/rest/v1/profiles')) return ok([{ is_admin: admin, active }]);
    if (url.includes('/auth/v1/invite')) {
      return inviteStatus === 200 ? ok({ id: 'new' }) : ok({ msg: 'A user with this email address has already been registered' }, inviteStatus);
    }
    throw new Error('url inattesa ' + url);
  };
  return fn(calls).finally(() => { global.fetch = orig; });
}

const req = (body, token = 'good') => ({ method: 'POST', headers: { authorization: 'Bearer ' + token }, body });
const good = { email: 'Luca.Bianchi@critn.it', first_name: 'Luca', last_name: 'Bianchi', unit_id: UNIT, role: 'referente' };

test('invito: l\'amministratore inserisce un utente @critn.it', () => withSupabase({}, async (calls) => {
  const res = fakeRes();
  await handler(req(good), res);
  assert.equal(res.statusCode, 200);
  const inv = calls.find(c => c.url.includes('/auth/v1/invite'));
  const sent = JSON.parse(inv.opts.body);
  assert.equal(sent.email, 'luca.bianchi@critn.it');
  assert.deepEqual(sent.data, { first_name: 'Luca', last_name: 'Bianchi', unit_id: UNIT, role: 'referente' });
  assert.equal(inv.opts.headers.Authorization, 'Bearer service');
  // l'invitato è attivo subito (chi si registra da solo invece resta in attesa)
  const act = calls.find(c => c.opts.method === 'PATCH');
  assert.match(act.url, /\/rest\/v1\/profiles\?id=eq\.new$/);
  assert.deepEqual(JSON.parse(act.opts.body), { active: true, role: 'referente' });
}));

test('invito: rifiuta domini diversi da @critn.it e dati mancanti', () => withSupabase({}, async (calls) => {
  for (const bad of [{ ...good, email: 'luca@gmail.com' }, { ...good, email: 'luca@critn.it.evil.com' },
    { ...good, first_name: '' }, { ...good, unit_id: 'x' }, { ...good, role: 'capo' }]) {
    const res = fakeRes();
    await handler(req(bad), res);
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  assert.equal(calls.filter(c => c.url.includes('/invite')).length, 0);
}));

test('invito: solo un amministratore attivo con sessione valida', () => withSupabase({ admin: false }, async () => {
  let res = fakeRes();
  await handler(req(good), res);
  assert.equal(res.statusCode, 403);
  res = fakeRes();
  await handler(req(good, 'bad'), res);
  assert.equal(res.statusCode, 401);
  res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
}));

test('invito: utente già esistente', () => withSupabase({ inviteStatus: 422 }, async () => {
  const res = fakeRes();
  await handler(req(good), res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /Esiste già/);
}));

test('invito: coordinatore referenti senza unità', () => withSupabase({}, async (calls) => {
  const res = fakeRes();
  await handler(req({ ...good, unit_id: '', role: 'coordinatore' }), res);
  assert.equal(res.statusCode, 200);
  const sent = JSON.parse(calls.find(c => c.url.includes('/auth/v1/invite')).opts.body);
  assert.equal(sent.data.unit_id, '');
  assert.deepEqual(JSON.parse(calls.find(c => c.opts.method === 'PATCH').opts.body), { active: true, role: 'coordinatore' });
}));

test('invito: se il ruolo non si applica lo dice invece di "ok"', () => withSupabase({ patchStatus: 400 }, async () => {
  const res = fakeRes();
  await handler(req({ ...good, unit_id: '', role: 'coordinatore' }), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /ruolo non è stato impostato/);
}));
