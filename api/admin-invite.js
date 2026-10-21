/*
 * Funzione Vercel: l'amministratore inserisce a mano un nuovo utente.
 * Supabase manda all'utente una mail di invito per scegliere la password.
 *
 * Variabili d'ambiente da impostare su Vercel (Settings → Environment Variables):
 *   SUPABASE_URL               es. https://abcdefgh.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  la chiave "service_role" (segreta: mai nel codice del sito)
 *   SITE_URL                   (facoltativa) indirizzo del sito, es. https://turni-ambulanza.vercel.app
 */
'use strict';

const ALLOWED_DOMAIN = '@critn.it';
const ROLES = ['referente', 'vice_referente'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Metodo non consentito' });
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return send(res, 500, { error: 'Back end non configurato: su Vercel mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.' });
  }
  const admin = { apikey: key, Authorization: 'Bearer ' + key };

  // Chi sta chiamando? Deve essere un amministratore attivo.
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(res, 401, { error: 'Accesso richiesto' });
  const me = await fetch(url + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
  if (!me.ok) return send(res, 401, { error: 'Sessione non valida: accedi di nuovo' });
  const caller = await me.json();
  const profRes = await fetch(url + '/rest/v1/profiles?select=is_admin,active&id=eq.' + encodeURIComponent(caller.id),
    { headers: admin });
  const prof = profRes.ok ? await profRes.json() : [];
  if (!prof[0] || !prof[0].is_admin || !prof[0].active) {
    return send(res, 403, { error: 'Solo l\'amministratore può inserire utenti' });
  }

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'Richiesta non valida' }); }
  const email = String(body.email || '').trim().toLowerCase();
  const first = String(body.first_name || '').trim().slice(0, 80);
  const last = String(body.last_name || '').trim().slice(0, 80);
  const unit = String(body.unit_id || '');
  const role = String(body.role || '');
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !email.endsWith(ALLOWED_DOMAIN)) {
    return send(res, 400, { error: 'Serve un indirizzo ' + ALLOWED_DOMAIN });
  }
  if (!first || !last) return send(res, 400, { error: 'Nome e cognome sono obbligatori' });
  if (!UUID.test(unit)) return send(res, 400, { error: 'Scegli l\'unità di appartenenza' });
  if (ROLES.indexOf(role) < 0) return send(res, 400, { error: 'Ruolo non valido' });

  const redirect = process.env.SITE_URL ? '?redirect_to=' + encodeURIComponent(process.env.SITE_URL) : '';
  const inv = await fetch(url + '/auth/v1/invite' + redirect, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, admin),
    body: JSON.stringify({ email: email, data: { first_name: first, last_name: last, unit_id: unit, role: role } })
  });
  if (!inv.ok) {
    let msg = 'Invito non riuscito';
    try {
      const j = await inv.json();
      msg = j.msg || j.message || j.error_description || msg;
    } catch (e) { /* risposta non JSON */ }
    if (/already|registered|exists/i.test(msg)) msg = 'Esiste già un utente con questo indirizzo';
    return send(res, inv.status === 422 ? 409 : 400, { error: msg });
  }
  // Chi si registra da solo è un dipendente in attesa; chi invita l'amministratore ha il ruolo scelto
  // ed è già approvato (con la chiave di servizio il controllo sui profili non si applica).
  const user = await inv.json().catch(() => ({}));
  if (user && user.id) {
    await fetch(url + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, admin),
      body: JSON.stringify({ active: true, role: role })
    });
  }
  return send(res, 200, { ok: true });
}

module.exports = handler;
