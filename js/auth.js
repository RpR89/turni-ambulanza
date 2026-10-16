/*
 * Accesso, registrazione e amministrazione con Supabase; salvataggio dei turni per unità.
 *
 * Se js/config.js non contiene i dati del progetto Supabase questo file non fa nulla
 * (a parte l'avviso sui cookie) e l'app funziona come prima, con i dati nel browser.
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
  window.TurniAuthRequired = configured;

  var DOMAIN = '@' + String(CFG.allowedDomain || 'critn.it').toLowerCase();
  var ROLES = { referente: 'Referente', vice_referente: 'Vice referente' };
  var COOKIE_KEY = 'turni-ambulanza:avviso-cookie';

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, sticky) { if (window.TurniApp) window.TurniApp.toast(msg, sticky); else alert(msg); }

  // ---------- Avviso sui cookie (solo informativo: si usano solo strumenti tecnici) ----------

  function cookieNotice() {
    var bar = $('#cookie-notice');
    if (!bar) return;
    var seen = false;
    try { seen = !!localStorage.getItem(COOKIE_KEY); } catch (e) { /* storage non disponibile */ }
    if (seen) return;
    bar.hidden = false;
    $('#cookie-ok').addEventListener('click', function () {
      try { localStorage.setItem(COOKIE_KEY, new Date().toISOString()); } catch (e) { /* ignora */ }
      bar.hidden = true;
    });
  }

  function validEmail(email) {
    var e = String(email || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+$/.test(e) && e.slice(-DOMAIN.length) === DOMAIN;
  }

  if (!configured) {
    document.addEventListener('DOMContentLoaded', cookieNotice);
    return;
  }

  // Finché non si è entrati, il tabellone resta nascosto.
  document.body.classList.add('auth-mode');
  var logo = document.getElementById('auth-logo');
  if (logo && window.LOGO_PNG_BASE64) logo.src = 'data:image/png;base64,' + window.LOGO_PNG_BASE64;

  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  // Tipo di link da cui si arriva (invito o recupero password: va scelta la password).
  var linkType = new URLSearchParams(location.hash.slice(1)).get('type');
  var siteUrl = location.origin + location.pathname;

  var ctx = { session: null, profile: null, units: [], unitId: null, version: 0, pending: false,
    saving: false, timer: null, started: false };

  // ---------- Schermata di accesso ----------

  function showAuth(mode, message) {
    document.body.classList.add('auth-mode');
    $('#auth-screen').hidden = false;
    $all('#auth-screen [data-auth]').forEach(function (el) { el.hidden = el.getAttribute('data-auth') !== mode; });
    $all('#auth-screen .auth-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    $('#auth-tabs').hidden = mode !== 'login' && mode !== 'signup';
    setAuthMessage(message || '', false);
  }

  function hideAuth() {
    document.body.classList.remove('auth-mode');
    $('#auth-screen').hidden = true;
  }

  function setAuthMessage(msg, isError) {
    var el = $('#auth-message');
    el.textContent = msg;
    el.hidden = !msg;
    el.className = 'auth-message' + (isError ? ' error' : '');
  }

  function busy(form, on) {
    $all('#' + form.id + ' button, #' + form.id + ' input, #' + form.id + ' select')
      .forEach(function (el) { el.disabled = on; });
  }

  function translateError(err) {
    var m = String((err && (err.message || err.error_description || err.msg)) || err || '');
    if (/invalid login credentials/i.test(m)) return 'Email o password non corretti.';
    if (/email not confirmed/i.test(m)) return 'Devi prima confermare l\'indirizzo: apri il link nella mail che ti abbiamo mandato.';
    if (/database error saving new user|critn/i.test(m)) return 'Registrazione consentita solo con indirizzi ' + DOMAIN + '.';
    if (/password should be at least|weak/i.test(m)) return 'Password troppo debole: usa almeno 8 caratteri.';
    if (/rate limit|too many/i.test(m)) return 'Troppi tentativi: riprova tra qualche minuto.';
    if (/already registered/i.test(m)) return 'Questo indirizzo è già registrato: accedi o usa "Password dimenticata".';
    if (/failed to fetch|network/i.test(m)) return 'Connessione non riuscita: controlla la rete e riprova.';
    return m || 'Operazione non riuscita.';
  }

  function fillUnitSelect(sel, selected, withEmpty) {
    sel.innerHTML = (withEmpty ? '<option value="">— nessuna —</option>' : '<option value="" disabled' +
      (selected ? '' : ' selected') + '>Scegli l\'unità…</option>') +
      ctx.units.map(function (u) {
        return '<option value="' + esc(u.id) + '"' + (u.id === selected ? ' selected' : '') + '>' + esc(u.name) + '</option>';
      }).join('');
  }

  function loadUnits() {
    return sb.from('units').select('id,name').order('name').then(function (r) {
      if (r.error) throw r.error;
      ctx.units = r.data || [];
      fillUnitSelect($('#su-unit'), null, false);
      return ctx.units;
    });
  }

  function initAuthForms() {
    $all('#auth-screen .auth-tab').forEach(function (b) {
      b.addEventListener('click', function () { showAuth(b.getAttribute('data-mode')); });
    });
    $all('#auth-screen [data-goto-mode]').forEach(function (a) {
      a.addEventListener('click', function (ev) { ev.preventDefault(); showAuth(a.getAttribute('data-goto-mode')); });
    });

    $('#login-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var email = f.email.value.trim().toLowerCase();
      if (!validEmail(email)) return setAuthMessage('Usa il tuo indirizzo ' + DOMAIN + '.', true);
      busy(f, true);
      sb.auth.signInWithPassword({ email: email, password: f.password.value }).then(function (r) {
        busy(f, false);
        if (r.error) return setAuthMessage(translateError(r.error), true);
        afterLogin(r.data.session);
      });
    });

    $('#signup-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var email = f.email.value.trim().toLowerCase();
      if (!f.first_name.value.trim() || !f.last_name.value.trim()) return setAuthMessage('Inserisci nome e cognome.', true);
      if (!validEmail(email)) return setAuthMessage('Ci si può registrare solo con un indirizzo ' + DOMAIN + '.', true);
      if (!f.unit.value) return setAuthMessage('Scegli la tua unità di appartenenza.', true);
      if (f.password.value.length < 8) return setAuthMessage('La password deve avere almeno 8 caratteri.', true);
      if (f.password.value !== f.password2.value) return setAuthMessage('Le due password non coincidono.', true);
      if (!f.privacy.checked) return setAuthMessage('Per registrarti devi prendere visione dell\'informativa privacy.', true);
      busy(f, true);
      sb.auth.signUp({
        email: email,
        password: f.password.value,
        options: {
          emailRedirectTo: siteUrl,
          data: {
            first_name: f.first_name.value.trim(), last_name: f.last_name.value.trim(),
            unit_id: f.unit.value, role: f.role.value, privacy_accepted_at: new Date().toISOString()
          }
        }
      }).then(function (r) {
        busy(f, false);
        if (r.error) return setAuthMessage(translateError(r.error), true);
        f.reset();
        showAuth('login', 'Quasi fatto: ti abbiamo mandato una mail a ' + email +
          '. Apri il link per confermare l\'indirizzo, poi accedi con la tua password.');
      });
    });

    $('#forgot-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var email = f.email.value.trim().toLowerCase();
      if (!validEmail(email)) return setAuthMessage('Usa il tuo indirizzo ' + DOMAIN + '.', true);
      busy(f, true);
      sb.auth.resetPasswordForEmail(email, { redirectTo: siteUrl }).then(function (r) {
        busy(f, false);
        if (r.error) return setAuthMessage(translateError(r.error), true);
        showAuth('login', 'Se l\'indirizzo è registrato riceverai una mail con il link per scegliere una nuova password.');
      });
    });

    $('#newpass-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      if (f.password.value.length < 8) return setAuthMessage('La password deve avere almeno 8 caratteri.', true);
      if (f.password.value !== f.password2.value) return setAuthMessage('Le due password non coincidono.', true);
      busy(f, true);
      sb.auth.updateUser({ password: f.password.value }).then(function (r) {
        busy(f, false);
        if (r.error) return setAuthMessage(translateError(r.error), true);
        linkType = null;
        history.replaceState(null, '', siteUrl);
        sb.auth.getSession().then(function (s) { afterLogin(s.data.session); });
      });
    });
  }

  // ---------- Dopo l'accesso ----------

  function afterLogin(session) {
    ctx.session = session;
    if (!session) return showAuth('login');
    if (linkType === 'invite' || linkType === 'recovery') return showAuth('newpass');
    sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(function (r) {
      if (r.error || !r.data) return showAuth('info', 'Profilo non trovato. Contatta l\'amministratore.');
      ctx.profile = r.data;
      if (!r.data.active) return showAuth('info', 'Il tuo account è disattivato. Contatta l\'amministratore.');
      return loadUnits().then(function () {
        var unit = r.data.unit_id && ctx.units.some(function (u) { return u.id === r.data.unit_id; }) ? r.data.unit_id : null;
        if (!unit && r.data.is_admin) unit = ctx.units.length ? ctx.units[0].id : null;
        if (!unit && !r.data.is_admin) {
          return showAuth('info', 'Non hai ancora un\'unità assegnata. Contatta l\'amministratore.');
        }
        hideAuth();
        renderUserBar();
        renderAdmin();
        if (unit) return loadUnit(unit);
        // Amministratore senza unità: prima si creano le unità.
        startApp({ employees: [] }, null);
        $('#tab-admin-btn').click();
        toast('Crea la prima unità nella scheda Amministrazione.', true);
      });
    }).catch(function (e) { showAuth('info', translateError(e)); });
  }

  function unitName(id) {
    var u = ctx.units.filter(function (x) { return x.id === id; })[0];
    return u ? u.name : '—';
  }

  function startApp(data, unitId) {
    ctx.unitId = unitId;
    window.TurniApp.start({ state: data, persist: unitId ? queueSave : function () { toast('Nessuna unità selezionata: i dati non vengono salvati.'); } });
    ctx.started = true;
    renderUserBar();
  }

  function fetchUnit(unitId) {
    return sb.from('unit_data').select('data,version').eq('unit_id', unitId).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  function loadUnit(unitId) {
    setStatus('Caricamento…');
    return fetchUnit(unitId).then(function (row) {
      ctx.version = row ? row.version : 0;
      ctx.pending = false;
      var data = row && row.data && Array.isArray(row.data.employees) ? row.data : null;
      var local = !data && window.TurniApp.localState();
      if (!data && local && local.employees.length && confirm('L\'unità ' + unitName(unitId) +
        ' non ha ancora turni salvati online.\nIn questo browser ci sono dati salvati in precedenza (' +
        local.employees.length + ' dipendenti).\nVuoi usarli come punto di partenza per questa unità?')) {
        data = local;
        startApp(data, unitId);
        return saveNow();
      }
      startApp(data || { employees: [] }, unitId);
      setStatus(row ? 'Turni dell\'unità caricati' : 'Nuova unità: nessun turno salvato');
    }).catch(function (e) {
      setStatus('Errore di caricamento', true);
      toast('Non sono riuscito a caricare i turni: ' + translateError(e), true);
    });
  }

  // ---------- Salvataggio sul server (con controllo delle modifiche altrui) ----------

  function setStatus(msg, isError) {
    var el = $('#save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'save-status' + (isError ? ' error' : ctx.pending ? ' pending' : '');
  }

  function queueSave() {
    ctx.pending = true;
    setStatus('Modifiche da salvare…');
    clearTimeout(ctx.timer);
    ctx.timer = setTimeout(saveNow, 800);
  }

  function saveNow() {
    if (!ctx.unitId) return Promise.resolve();
    if (ctx.saving) { queueSave(); return Promise.resolve(); }
    clearTimeout(ctx.timer);
    ctx.saving = true;
    ctx.pending = false;
    setStatus('Salvataggio…');
    var data = JSON.parse(JSON.stringify(window.TurniApp.getState()));
    return sb.rpc('save_unit_data', { p_unit: ctx.unitId, p_data: data, p_version: ctx.version }).then(function (r) {
      ctx.saving = false;
      if (r.error) {
        if (/conflitto/i.test(r.error.message || '')) return handleConflict();
        ctx.pending = true;
        setStatus('Non salvato: riprovo tra poco', true);
        clearTimeout(ctx.timer);
        ctx.timer = setTimeout(saveNow, 10000);
        return;
      }
      ctx.version = r.data;
      var t = new Date();
      setStatus('Salvato alle ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'));
    });
  }

  function handleConflict() {
    return fetchUnit(ctx.unitId).then(function (row) {
      var keepMine = confirm('Un altro utente ha salvato modifiche ai turni di ' + unitName(ctx.unitId) +
        ' mentre lavoravi.\n\nOK = tieni la TUA versione (sostituisce quella dell\'altro utente)\n' +
        'Annulla = carica la versione dell\'altro utente (le tue ultime modifiche si perdono)');
      ctx.version = row ? row.version : 0;
      if (keepMine) return saveNow();
      startApp(row && row.data && Array.isArray(row.data.employees) ? row.data : { employees: [] }, ctx.unitId);
      setStatus('Caricata la versione dell\'altro utente');
    });
  }

  // Tornando sulla pagina: se qualcun altro ha salvato e qui non c'è nulla da salvare, si aggiorna.
  function checkRemote() {
    if (!ctx.unitId || ctx.pending || ctx.saving || !ctx.started) return;
    fetchUnit(ctx.unitId).then(function (row) {
      if (row && row.version > ctx.version && !ctx.pending) {
        ctx.version = row.version;
        startApp(row.data, ctx.unitId);
        toast('Turni aggiornati con le modifiche salvate da un altro utente.');
      }
    }).catch(function () { /* riproverà al prossimo ritorno */ });
  }

  // ---------- Barra utente ----------

  function renderUserBar() {
    var p = ctx.profile;
    var bar = $('#userbar');
    if (!p) { bar.hidden = true; return; }
    bar.hidden = false;
    var unitPart = p.is_admin && ctx.units.length
      ? '<select id="unit-switch" title="Unità di cui stai modificando i turni">' + ctx.units.map(function (u) {
        return '<option value="' + esc(u.id) + '"' + (u.id === ctx.unitId ? ' selected' : '') + '>' + esc(u.name) + '</option>';
      }).join('') + '</select>'
      : '<b>' + esc(unitName(ctx.unitId)) + '</b>';
    bar.innerHTML = '<span class="who">' + esc(p.first_name + ' ' + p.last_name) + ' · ' +
      (p.is_admin ? 'Amministratore' : esc(ROLES[p.role] || p.role)) + '</span> ' + unitPart +
      ' <span id="save-status" class="save-status"></span>' +
      ' <button type="button" id="logout" class="ghost">Esci</button>';
    $('#logout').addEventListener('click', logout);
    var sw = $('#unit-switch');
    if (sw) sw.addEventListener('change', function () {
      var next = sw.value;
      (ctx.pending ? saveNow() : Promise.resolve()).then(function () { loadUnit(next); });
    });
    $('#tab-admin-btn').hidden = !p.is_admin;
  }

  function logout() {
    (ctx.pending ? saveNow() : Promise.resolve()).then(function () {
      return sb.auth.signOut();
    }).then(function () { location.replace(siteUrl); });
  }

  // ---------- Amministrazione: unità e utenti ----------

  function renderAdmin() {
    if (!ctx.profile || !ctx.profile.is_admin) return;
    renderUnitsAdmin();
    loadUsers();
    fillUnitSelect($('#invite-form').unit, null, false);
  }

  function renderUnitsAdmin() {
    $('#units-table').innerHTML = '<thead><tr><th>Unità</th><th></th></tr></thead><tbody>' +
      (ctx.units.length ? '' : '<tr><td colspan="2" class="empty">Nessuna unità: aggiungi la prima.</td></tr>') +
      ctx.units.map(function (u) {
        return '<tr data-unit="' + esc(u.id) + '"><td><input data-f="name" value="' + esc(u.name) + '"></td>' +
          '<td><button type="button" data-act="del-unit" class="danger">Elimina</button></td></tr>';
      }).join('') + '</tbody>';
  }

  function refreshUnits() {
    return loadUnits().then(function () { renderUnitsAdmin(); renderUserBar(); fillUnitSelect($('#invite-form').unit, null, false); loadUsers(); });
  }

  function loadUsers() {
    sb.from('profiles').select('*').order('last_name').then(function (r) {
      if (r.error) return toast('Utenti non caricati: ' + translateError(r.error), true);
      var me = ctx.profile.id;
      $('#users-table').innerHTML = '<thead><tr><th>Cognome e nome</th><th>Email</th><th>Unità</th><th>Ruolo</th>' +
        '<th>Attivo</th><th>Amministratore</th></tr></thead><tbody>' +
        (r.data.length ? '' : '<tr><td colspan="6" class="empty">Nessun utente.</td></tr>') +
        r.data.map(function (u) {
          var unitOpts = '<option value="">— nessuna —</option>' + ctx.units.map(function (x) {
            return '<option value="' + esc(x.id) + '"' + (x.id === u.unit_id ? ' selected' : '') + '>' + esc(x.name) + '</option>';
          }).join('');
          return '<tr data-user="' + esc(u.id) + '"><td>' + esc(u.last_name + ' ' + u.first_name) + '</td><td>' + esc(u.email) + '</td>' +
            '<td><select data-f="unit_id">' + unitOpts + '</select></td>' +
            '<td><select data-f="role"><option value="referente"' + (u.role === 'referente' ? ' selected' : '') +
            '>Referente</option><option value="vice_referente"' + (u.role === 'vice_referente' ? ' selected' : '') +
            '>Vice referente</option></select></td>' +
            '<td><input type="checkbox" data-f="active"' + (u.active ? ' checked' : '') + (u.id === me ? ' disabled' : '') + '></td>' +
            '<td><input type="checkbox" data-f="is_admin"' + (u.is_admin ? ' checked' : '') + (u.id === me ? ' disabled' : '') + '></td></tr>';
        }).join('') + '</tbody>';
    });
  }

  function initAdmin() {
    $('#unit-add-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = ev.target.name.value.trim();
      if (!name) return;
      sb.from('units').insert({ name: name }).then(function (r) {
        if (r.error) return toast(/duplicate|unique/i.test(r.error.message) ? 'Esiste già un\'unità con questo nome.' : translateError(r.error), true);
        ev.target.reset();
        refreshUnits().then(function () {
          if (!ctx.unitId && ctx.units.length) loadUnit(ctx.units[0].id);
        });
        toast('Unità aggiunta.');
      });
    });

    $('#units-table').addEventListener('change', function (ev) {
      var tr = ev.target.closest('[data-unit]');
      if (!tr || ev.target.getAttribute('data-f') !== 'name') return;
      var name = ev.target.value.trim();
      if (!name) return refreshUnits();
      sb.from('units').update({ name: name }).eq('id', tr.getAttribute('data-unit')).then(function (r) {
        if (r.error) toast(translateError(r.error), true);
        refreshUnits();
      });
    });

    $('#units-table').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act="del-unit"]');
      if (!b) return;
      var id = b.closest('[data-unit]').getAttribute('data-unit');
      if (!confirm('Eliminare l\'unità ' + unitName(id) + '?\nATTENZIONE: vengono cancellati anche TUTTI i suoi turni ' +
        'salvati online. Gli utenti dell\'unità restano, ma senza unità finché non ne assegni un\'altra.')) return;
      sb.from('units').delete().eq('id', id).then(function (r) {
        if (r.error) return toast(translateError(r.error), true);
        toast('Unità eliminata.');
        refreshUnits().then(function () {
          if (ctx.unitId === id) {
            if (ctx.units.length) loadUnit(ctx.units[0].id); else startApp({ employees: [] }, null);
          }
        });
      });
    });

    $('#users-table').addEventListener('change', function (ev) {
      var tr = ev.target.closest('[data-user]');
      if (!tr) return;
      var f = ev.target.getAttribute('data-f');
      var patch = {};
      patch[f] = ev.target.type === 'checkbox' ? ev.target.checked : (ev.target.value || null);
      sb.from('profiles').update(patch).eq('id', tr.getAttribute('data-user')).then(function (r) {
        if (r.error) { toast(translateError(r.error), true); return loadUsers(); }
        toast('Utente aggiornato.');
      });
    });

    $('#invite-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var email = f.email.value.trim().toLowerCase();
      if (!validEmail(email)) return toast('Serve un indirizzo ' + DOMAIN + '.', true);
      if (!f.unit.value) return toast('Scegli l\'unità.', true);
      busy(f, true);
      sb.auth.getSession().then(function (s) {
        return fetch('/api/admin-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s.data.session && s.data.session.access_token) },
          body: JSON.stringify({ email: email, first_name: f.first_name.value, last_name: f.last_name.value,
            unit_id: f.unit.value, role: f.role.value })
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, body: j }; });
      }).then(function (r) {
        busy(f, false);
        if (!r.ok) return toast(r.body.error || 'Invito non riuscito.', true);
        f.reset();
        toast('Invito inviato a ' + email + ': riceverà una mail per scegliere la password.', true);
        setTimeout(loadUsers, 1500);
      }).catch(function (e) { busy(f, false); toast(translateError(e), true); });
    });
  }

  // ---------- Avvio ----------

  function boot() {
    cookieNotice();
    initAuthForms();
    initAdmin();
    window.addEventListener('focus', checkRemote);
    window.addEventListener('beforeunload', function (ev) {
      if (ctx.pending || ctx.saving) { saveNow(); ev.preventDefault(); ev.returnValue = ''; }
    });
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY') { linkType = 'recovery'; showAuth('newpass'); }
    });
    loadUnits().catch(function () { /* elenco unità non disponibile: lo si vede nel modulo */ });
    sb.auth.getSession().then(function (r) {
      if (r.data.session) afterLogin(r.data.session); else showAuth('login');
    });
  }

  document.addEventListener('DOMContentLoaded', boot);

  // Per i test e la console.
  window.TurniAuth = { validEmail: validEmail, client: sb, ctx: ctx, saveNow: saveNow };
})();
