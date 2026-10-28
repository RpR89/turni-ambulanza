/*
 * Funzione Vercel: avvisi via mail ai dipendenti.
 *   - type "published": i turni del mese sono stati pubblicati → a tutti i dipendenti
 *     attivi dell'unità e al coordinatore e vice coordinatore referenti (a loro con il tabellone Excel
 *     in allegato, se la pagina lo manda: campo excel in base64);
 *   - type "rejected": richieste di riposo / 104 non accolte, con la motivazione → al dipendente;
 *   - type "bumped": riposi annullati dal permesso 104 appena inserito da chi chiama (giornata al
 *     completo) → ai dipendenti che li avevano chiesti, senza dire chi ha preso il permesso.
 * "published" e "rejected" li può chiamare solo un referente o vice referente attivo dell'unità (o un
 * amministratore); "bumped" un dipendente attivo dell'unità, solo per gli annullamenti causati da lui.
 *
 * Le mail partono dalla casella dell'app (MAIL_FROM) con il nome di chi pubblica o rifiuta come mittente;
 * "Rispondi" arriva a lui (Reply-To).
 *
 * Variabili d'ambiente su Vercel, oltre a SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SITE_URL:
 *   SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER, SMTP_PASS
 *   MAIL_FROM  indirizzo della casella, es. turni@critn.it
 */
'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
  'settembre', 'ottobre', 'novembre', 'dicembre'];
const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const ROLE_TEXT = { referente: 'referente', vice_referente: 'vice referente',
  coordinatore: 'coordinatore referenti', vice_coordinatore: 'vice coordinatore referenti' };
const MAX_EXCEL = 3 * 1024 * 1024;
const PART_TEXT = { G: ' (solo il turno di giorno)', N: ' (solo il turno di notte)' };
const FOOTER = '\n\n— Turni Ambulanza · Croce Rossa Italiana, Comitato di Trento\n' +
  'Mail automatica: la ricevi perché sei registrato all\'app dei turni della tua unità.';

let transport = null; // sostituibile nei test

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

function oneLine(s, max) { return String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max); }

function dayText(key) {
  const [y, m, d] = key.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAYS[wd] + ' ' + d + ' ' + MONTHS[m - 1] + ' ' + y;
}

function getTransport() {
  if (transport) return transport;
  const nodemailer = require('nodemailer');
  const port = +process.env.SMTP_PORT || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transport;
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Metodo non consentito' });
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return send(res, 500, { error: 'Back end non configurato: su Vercel mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.' });
  }
  if (!transport && (!process.env.SMTP_HOST || !process.env.MAIL_FROM)) {
    return send(res, 503, { error: 'Invio delle mail non configurato: su Vercel mancano SMTP_HOST, SMTP_USER, SMTP_PASS e MAIL_FROM.' });
  }
  const admin = { apikey: key, Authorization: 'Bearer ' + key };
  const rest = (path) => fetch(url + '/rest/v1/' + path, { headers: admin })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('Supabase ' + r.status))));

  // Chi sta chiamando? Referente o vice attivo dell'unità, oppure amministratore.
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(res, 401, { error: 'Accesso richiesto' });
  const me = await fetch(url + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
  if (!me.ok) return send(res, 401, { error: 'Sessione non valida: accedi di nuovo' });
  const caller = await me.json();

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'Richiesta non valida' }); }
  const unit = String(body.unit_id || '');
  if (!UUID.test(unit)) return send(res, 400, { error: 'Unità non valida' });

  const prof = (await rest('profiles?select=first_name,last_name,email,role,unit_id,active,is_admin&id=eq.' +
    encodeURIComponent(caller.id)))[0];
  if (body.type === 'bumped') return bumped(res, rest, url, admin, unit, caller, prof);
  const manager = prof && prof.active && (prof.is_admin ||
    (prof.unit_id === unit && (prof.role === 'referente' || prof.role === 'vice_referente')));
  if (!manager) return send(res, 403, { error: 'Solo il referente o il vice referente dell\'unità può mandare avvisi' });

  const units = await rest('units?select=name&id=eq.' + unit);
  const unitName = units[0] ? units[0].name : '';
  const sender = oneLine(prof.first_name + ' ' + prof.last_name, 80) || 'Referente';
  const from = { name: sender + ' (' + (ROLE_TEXT[prof.role] || 'referente') + ') – Turni Ambulanza', address: process.env.MAIL_FROM || 'turni@critn.it' };
  const site = process.env.SITE_URL || '';
  const replyNote = '\n\nPer qualsiasi chiarimento rispondi a questa mail: arriva a ' + sender + '.';

  let messages = [];
  if (body.type === 'published') {
    const month = String(body.month || '');
    if (!MONTH.test(month)) return send(res, 400, { error: 'Mese non valido' });
    const pub = await rest('published?select=month&unit_id=eq.' + unit + '&month=eq.' + month);
    if (!pub.length) return send(res, 400, { error: 'I turni di questo mese non risultano pubblicati' });
    const [y, m] = month.split('-').map(Number);
    const title = MONTHS[m - 1] + ' ' + y;
    const staff = await rest('profiles?select=first_name,email&role=eq.dipendente&active=eq.true&unit_id=eq.' + unit);
    messages = staff.map(p => ({
      to: p.email,
      subject: 'Turni di ' + title + ' pubblicati' +
        (unitName ? ' – ' + unitName : ''),
      text: 'Ciao ' + oneLine(p.first_name, 80) + ',\n\n' +
        'sono stati pubblicati i turni di ' + title +
        (unitName ? ' dell\'unità ' + unitName : '') + '.\n' +
        (site ? 'Puoi vederli qui: ' + site + '\n' : '') + replyNote + FOOTER
    }));
    // Coordinatore e vice coordinatore referenti: ricevono ogni pubblicazione, con il tabellone in Excel.
    const excel = typeof body.excel === 'string' && body.excel.length <= MAX_EXCEL * 4 / 3 + 4
      ? Buffer.from(body.excel, 'base64') : null;
    const excelName = (oneLine(body.excel_name, 120).replace(/[\\/:*?"<>|]+/g, '') || 'Tabellone turni.xlsx')
      .replace(/(\.xlsx)?$/i, '.xlsx');
    const coords = await rest('profiles?select=first_name,email&active=eq.true&role=in.(coordinatore,vice_coordinatore)');
    const seen = {};
    staff.forEach(p => { seen[p.email] = true; });
    coords.filter(p => p.email !== prof.email && !seen[p.email]).forEach(p => {
      seen[p.email] = true;
      messages.push(Object.assign({
        to: p.email,
        subject: 'Turni di ' + title + ' pubblicati' + (unitName ? ' – ' + unitName : ''),
        text: 'Ciao ' + oneLine(p.first_name, 80) + ',\n\n' +
          sender + ' (' + (ROLE_TEXT[prof.role] || 'referente') + ') ha pubblicato i turni di ' + title +
          (unitName ? ' dell\'unità ' + unitName : '') + '.\n' +
          (excel && excel.length ? 'In allegato il tabellone in Excel.\n' : '') +
          (site ? 'Puoi vederli anche qui: ' + site + '\n' : '') + replyNote + FOOTER
      }, excel && excel.length ? { attachments: [{ filename: excelName, content: excel,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] } : {}));
    });
  } else if (body.type === 'rejected') {
    const emp = String(body.employee_id || '');
    const days = Array.isArray(body.days) ? body.days.map(String).filter(d => DAY.test(d)).slice(0, 31).sort() : [];
    const parts = body.parts && typeof body.parts === 'object' ? body.parts : {};
    const kind = body.kind === 'P' ? 'P' : 'R';
    const reason = String(body.reason || '').trim().slice(0, 1000);
    if (!emp || !days.length) return send(res, 400, { error: 'Dipendente o giorni mancanti' });
    if (!reason) return send(res, 400, { error: 'Scrivi la motivazione' });
    const staff = await rest('profiles?select=first_name,email&role=eq.dipendente&active=eq.true&unit_id=eq.' + unit +
      '&employee_id=eq.' + encodeURIComponent(emp));
    const what = kind === 'P' ? 'permesso 104' : 'riposo';
    const list = days.map(d => dayText(d) + (PART_TEXT[parts[d]] || ''));
    messages = staff.map(p => ({
      to: p.email,
      subject: 'Richiesta di ' + what + ' non accolta – ' + days.map(d => d.slice(8) + '/' + d.slice(5, 7)).join(', '),
      text: 'Ciao ' + oneLine(p.first_name, 80) + ',\n\n' +
        (list.length === 1 ? 'la tua richiesta di ' + what + ' per ' + list[0] + ' non è stata accolta.'
          : 'le tue richieste di ' + what + ' per questi giorni non sono state accolte:\n- ' + list.join('\n- ')) +
        '\n\nMotivazione:\n' + reason + replyNote + FOOTER
    }));
  } else {
    return send(res, 400, { error: 'Tipo di avviso non valido' });
  }

  const out = await deliver(messages, { from: from, replyTo: { name: sender, address: prof.email } });
  return send(res, out.status, out.body);
}

async function deliver(messages, envelope) {
  if (!messages.length) return { status: 200, body: { sent: 0, failed: 0 } };
  const mailer = getTransport();
  let sent = 0, failed = 0;
  for (const msg of messages) {
    try {
      await mailer.sendMail(Object.assign({}, envelope, msg));
      sent++;
    } catch (e) {
      failed++;
    }
  }
  return failed && !sent
    ? { status: 502, body: { error: 'Invio delle mail non riuscito: controlla le impostazioni SMTP su Vercel.', sent, failed } }
    : { status: 200, body: { sent, failed } };
}

// Riposi annullati da un permesso 104 di chi chiama e non ancora avvisati: una mail a ciascuno.
async function bumped(res, rest, url, admin, unit, caller, prof) {
  if (!prof || !prof.active || prof.unit_id !== unit) return send(res, 403, { error: 'Non autorizzato' });
  const rows = await rest('request_bumps?select=id,employee_id,day,kind,part&notified_at=is.null&unit_id=eq.' + unit +
    '&created_by=eq.' + encodeURIComponent(caller.id));
  if (!rows.length) return send(res, 200, { sent: 0, failed: 0 });
  const staff = await rest('profiles?select=first_name,email,employee_id&role=eq.dipendente&active=eq.true&unit_id=eq.' + unit);
  const site = process.env.SITE_URL || '';
  const messages = [];
  rows.forEach(b => {
    staff.filter(p => p.employee_id === b.employee_id).forEach(p => {
      messages.push({
        to: p.email,
        subject: 'Richiesta di riposo annullata – ' + b.day.slice(8) + '/' + b.day.slice(5, 7),
        text: 'Ciao ' + oneLine(p.first_name, 80) + ',\n\n' +
          'la tua richiesta di riposo per ' + dayText(b.day) + (PART_TEXT[b.part] || '') + ' è stata annullata: ' +
          'quel giorno era già al massimo delle richieste di riposo e un collega ha chiesto un permesso ' +
          'Legge 104, che ha la precedenza.\n' +
          'Se sei ancora nei termini puoi chiedere un altro giorno' + (site ? ': ' + site : '') + '.' +
          '\n\nPer chiarimenti parla con il referente.' + FOOTER
      });
    });
  });
  const out = await deliver(messages, { from: { name: 'Turni Ambulanza', address: process.env.MAIL_FROM || 'turni@critn.it' } });
  if (out.status === 200) {
    await fetch(url + '/rest/v1/request_bumps?id=in.(' + rows.map(b => b.id).join(',') + ')', {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, admin),
      body: JSON.stringify({ notified_at: new Date().toISOString() })
    });
  }
  return send(res, out.status, out.body);
}

module.exports = handler;
// Per i test: invio finto.
module.exports._setTransport = function (t) { transport = t; };
