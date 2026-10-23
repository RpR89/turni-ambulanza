/*
 * Schermata del dipendente (accesso utenti attivo, ruolo "dipendente").
 *
 * - Mese pubblicato dal referente: vede il tabellone dei turni (copia pubblicata) e l'elenco dei suoi turni.
 * - Mese non pubblicato: vede solo le richieste di riposo (e 104) dell'unità e, fino al giorno limite,
 *   inserisce o toglie le proprie toccando la sua riga.
 * I controlli veri (limiti, termine, diritto alla 104) li fa il database: qui si mostrano soltanto.
 */
(function () {
  'use strict';

  var R = window.Rules, O = window.Online;
  var MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio',
    'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  var WEEKDAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  var WEEKDAY_NAMES = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  var CODE_TEXT = { F: 'Ferie', R: 'Riposo', A: 'Assente', C: 'Formazione', P: 'Permesso 104' };

  var st = null;

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, sticky) { window.TurniApp.toast(msg, sticky); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDay(key) { return key.slice(8) + '/' + key.slice(5, 7); }
  function todayKey() { var d = new Date(); return R.toKey(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function shortName(name) {
    var parts = String(name).trim().split(/\s+/);
    return parts.length > 1 ? parts[0] + ' ' + parts[1].charAt(0) + '.' : parts[0];
  }
  function errText(e) {
    var m = String((e && (e.message || e.details)) || e || '');
    return /failed to fetch|network/i.test(m) ? 'Connessione non riuscita: riprova.' : m || 'Operazione non riuscita.';
  }

  // ---------- Dati ----------

  function load() {
    // dal mese prima a sei mesi dopo quello mostrato
    var d = new Date(st.y, st.m - 2, 1), to = new Date(st.y, st.m + 6, 0);
    var from = R.toKey(d.getFullYear(), d.getMonth() + 1, 1);
    return Promise.all([
      st.sb.rpc('unit_roster', { p_unit: st.unitId }),
      st.sb.from('published').select('month,data,published_at').eq('unit_id', st.unitId),
      st.sb.rpc('unit_requests', { p_unit: st.unitId, p_from: from,
        p_to: R.toKey(to.getFullYear(), to.getMonth() + 1, to.getDate()) })
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw r.error; });
      st.roster = res[0].data || { employees: [] };
      st.published = {};
      (res[1].data || []).forEach(function (row) { st.published[row.month] = row; });
      st.requests = res[2].data || [];
      st.loadedAt = Date.now();
    });
  }

  function me() {
    return (st.roster.employees || []).filter(function (e) { return e.id === st.profile.employee_id; })[0] || null;
  }

  function requestsOf(empId, monthKey) {
    return st.requests.filter(function (r) { return r.employee_id === empId && r.day.slice(0, 7) === monthKey; });
  }

  // ---------- Disegno ----------

  function render() {
    var key = O.monthKey(st.y, st.m);
    var pub = st.published[key];
    var title = MONTHS[st.m - 1] + ' ' + st.y;
    var h = '<div class="staff-head">' +
      '<div class="month-nav"><button type="button" data-nav="-1" title="Mese precedente">‹</button>' +
      '<h2>' + esc(title) + '</h2><button type="button" data-nav="1" title="Mese successivo">›</button></div>' +
      (me() ? '' : '<p class="staff-alert">Il tuo account non è collegato a una riga del tabellone: chiedi al referente.</p>') +
      '</div>';
    h += pub ? renderPublished(pub) : renderRequests(key, title);
    $('#staff-view').innerHTML = h;
  }

  function shiftsMap(snap) {
    var map = {};
    (snap.ambulances || []).forEach(function (a) {
      (a.shifts || []).forEach(function (s) {
        var st0 = R.parseTime(s.start), en = R.parseTime(s.end);
        map[s.id] = { label: s.label, name: s.name, start: s.start, end: s.end, code: a.code,
          night: st0 != null && en != null && en <= st0 };
      });
    });
    return map;
  }

  function cellView(entry, shifts) {
    if (!entry) return { text: '', cls: '' };
    if (typeof entry === 'object' && !Array.isArray(entry)) {
      return { text: 'C<small>' + esc(entry.hours) + 'h</small>', cls: ' cell-C', title: 'Formazione ' + entry.hours + ' h' };
    }
    if (typeof entry === 'string' && CODE_TEXT[entry]) {
      return { text: entry, cls: entry === 'A' ? ' cell-A' : ' cell-' + entry, title: CODE_TEXT[entry] };
    }
    var ids = (Array.isArray(entry) ? entry : [entry]).filter(function (id) { return shifts[id]; });
    if (!ids.length) return { text: '', cls: '' };
    var night = ids.some(function (id) { return shifts[id].night; });
    var labels = ids.map(function (id) { return esc(shifts[id].label); });
    return {
      text: ids.length > 1 ? '<span class="multi">' + labels.join('<br>') + '</span>' : labels[0],
      cls: (night ? ' cell-N' : ' cell-G') + (ids.length > 1 ? ' cell-multi' : ''),
      title: ids.map(function (id) {
        var s = shifts[id];
        return s.name + ' ' + s.start + '–' + s.end + (s.code ? ' · ambulanza ' + s.code : '');
      }).join(', ')
    };
  }

  function headRow(days) {
    var today = todayKey();
    return '<thead><tr><th class="name">Dipendente</th>' + days.map(function (k) {
      var wd = R.weekday(k);
      return '<th class="day' + (wd >= 5 ? ' weekend' : '') + (wd === 0 ? ' monday' : '') + (k === today ? ' today' : '') +
        '"><span>' + WEEKDAYS[wd] + '</span>' + (+k.slice(8)) + '</th>';
    }).join('') + '</tr></thead>';
  }

  function nameCell(e, mine) {
    return '<th class="name' + (mine ? ' mine' : '') + '">' +
      (e.role === 'autista' ? '<span class="drv" title="Autista soccorritore">A</span>' : '') +
      '<span class="nm-full">' + esc(e.name) + '</span><span class="nm-short">' + esc(shortName(e.name)) + '</span></th>';
  }

  function renderPublished(pub) {
    var snap = pub.data || {};
    var days = R.monthDays(st.y, st.m);
    var shifts = shiftsMap(snap);
    var mine = st.profile.employee_id;
    var cells = snap.cells || {};
    var at = new Date(pub.published_at);

    var list = days.filter(function (k) { return (cells[mine] || {})[k]; }).map(function (k) {
      var v = cellView(cells[mine][k], shifts);
      return '<li><span class="when">' + WEEKDAY_NAMES[R.weekday(k)] + ' ' + (+k.slice(8)) + '</span>' +
        '<span class="cell' + v.cls + '">' + v.text + '</span><span class="what">' + esc(v.title || '') + '</span></li>';
    }).join('');

    var h = '<p class="pub-status on">Turni pubblicati il ' + pad(at.getDate()) + '/' + pad(at.getMonth() + 1) +
      ' alle ' + pad(at.getHours()) + ':' + pad(at.getMinutes()) + '</p>';
    if ((snap.employees || []).some(function (e) { return e.id === mine; })) {
      h += '<section class="card"><h3>I tuoi turni</h3>' +
        (list ? '<ul class="my-shifts">' + list + '</ul>' +
          '<p class="ics-row"><button type="button" class="primary" data-ics>📅 Aggiungi i miei turni al calendario</button></p>' +
          '<p class="note">Si apre con Google Calendar, il calendario del telefono o Outlook. Su Google Calendar dal computer: ⚙ Impostazioni → Importa ed esporta → Importa. Se poi i turni cambiano, scarica e importa di nuovo il file: gli eventi si aggiornano senza doppioni.</p>'
          : '<p class="note">Nessun turno in questo mese.</p>') + '</section>';
    }
    h += '<section class="card"><h3>Tabellone dell\'unità</h3><div class="grid-wrap"><table class="grid staff-grid">' +
      headRow(days) + '<tbody>' + (snap.employees || []).map(function (e) {
        return '<tr' + (e.id === mine ? ' class="mine"' : '') + '>' + nameCell(e, e.id === mine) + days.map(function (k) {
          var v = cellView((cells[e.id] || {})[k], shifts), wd = R.weekday(k);
          return '<td class="cell' + v.cls + (wd >= 5 ? ' weekend' : '') + (wd === 0 ? ' monday' : '') + '"' +
            (v.title ? ' title="' + esc(v.title) + '"' : '') + '>' + v.text + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>' + volunteersRow(snap, days, shifts) + '</table></div>' +
      '<p class="note">G giorno · N notte · F ferie · R riposo · C formazione · A assente · V volontari. ' +
      'Per un cambio parla con il referente.</p></section>';
    return h;
  }

  // Riga dei volontari generici (senza nome) messi dal referente nei turni del mese.
  function volunteersRow(snap, days, shifts) {
    var vol = snap.volunteers || {};
    if (!Object.keys(vol).length) return '';
    return '<tfoot><tr><th class="name">Volontari</th>' + days.map(function (k) {
      var day = vol[k] || {}, n = 0, parts = [];
      Object.keys(day).forEach(function (id) {
        var a = +day[id].A || 0, r = +day[id].S || 0;
        n += a + r;
        parts.push((shifts[id] ? shifts[id].label : id) + ': ' + (a ? a + ' autista' : '') + (a && r ? ', ' : '') +
          (r ? r + ' soccorritor' + (r === 1 ? 'e' : 'i') : ''));
      });
      return '<td class="cov' + (R.weekday(k) === 0 ? ' monday' : '') + '"' + (n ? ' title="' + esc(parts.join(' · ')) + '"' : '') +
        '>' + (n ? n + 'V' : '') + '</td>';
    }).join('') + '</tr></tfoot>';
  }

  function renderRequests(key, title) {
    var days = R.monthDays(st.y, st.m);
    var self = me();
    var deadline = O.requestDeadline(st.y, st.m, st.roster.requestDeadlineDay);
    var open = todayKey() <= deadline;
    var maxR = +st.roster.maxRestRequests, maxP = +st.roster.perm104PerMonth;
    var mine = self ? requestsOf(self.id, key) : [];
    var usedR = mine.filter(function (r) { return r.kind === 'R'; }).length;
    var usedP = mine.filter(function (r) { return r.kind === 'P'; }).length;
    var canEdit = open && !!self;
    if (!self || !self.has104) st.tool = 'R';

    var h = '<p class="pub-status off">I turni di ' + esc(title.toLowerCase()) + ' non sono ancora pubblicati.</p>';
    h += '<section class="card"><h3>Richieste di riposo' + (self && self.has104 ? ' e permessi 104' : '') + '</h3>';
    h += open
      ? '<p class="note">Puoi inserire o togliere le tue richieste fino al <b>' + fmtDay(deadline) + '/' + deadline.slice(0, 4) +
        '</b>. Tocca un giorno della tua riga (evidenziata).</p>'
      : '<p class="note">Il termine per le richieste di questo mese è scaduto il ' + fmtDay(deadline) + '/' +
        deadline.slice(0, 4) + '. Per un cambio parla con il referente.</p>';
    if (self) {
      h += '<div class="req-tools">' +
        '<button type="button" class="tool cell-R' + (st.tool === 'R' ? ' active' : '') + '" data-tool="R"' +
        (canEdit ? '' : ' disabled') + '>R <small>riposo · ' + usedR + '/' + maxR + '</small></button>' +
        (self.has104 ? '<button type="button" class="tool cell-P' + (st.tool === 'P' ? ' active' : '') + '" data-tool="P"' +
          (canEdit ? '' : ' disabled') + '>104 <small>permesso · ' + usedP + '/' + maxP + '</small></button>' : '') +
        '</div>';
    }
    var byEmp = {};
    st.requests.forEach(function (r) {
      if (r.day.slice(0, 7) !== key) return;
      (byEmp[r.employee_id] = byEmp[r.employee_id] || {})[r.day] = r.kind;
    });
    h += '<div class="grid-wrap"><table class="grid staff-grid">' + headRow(days) + '<tbody>' +
      (st.roster.employees || []).map(function (e) {
        var isMe = self && e.id === self.id;
        return '<tr' + (isMe ? ' class="mine"' : '') + '>' + nameCell(e, isMe) + days.map(function (k) {
          var kind = (byEmp[e.id] || {})[k] || '', wd = R.weekday(k);
          var text = kind === 'P' ? '104' : kind;
          return '<td class="cell' + (kind ? ' cell-' + kind : '') + (wd >= 5 ? ' weekend' : '') + (wd === 0 ? ' monday' : '') +
            (isMe && canEdit ? ' editable' : '') + '"' + (isMe && canEdit ? ' data-day="' + k + '" tabindex="0"' : '') +
            (kind ? ' title="' + esc(kind === 'A' ? 'Assente' : CODE_TEXT[kind]) + '"' : '') + '>' + text + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    h += '<p class="note">Vedi anche le richieste dei colleghi (i permessi 104 degli altri compaiono come "A"). ' +
      'Le richieste non sono garantite: le valuta il referente quando prepara i turni.</p></section>';
    return h;
  }

  // ---------- Azioni ----------

  // File .ics con i propri turni pubblicati del mese (Google Calendar, telefono, Outlook).
  function downloadIcs() {
    var key = O.monthKey(st.y, st.m), pub = st.published[key];
    if (!pub) return;
    var snap = pub.data || {}, mine = st.profile.employee_id;
    var shifts = {};
    (snap.ambulances || []).forEach(function (a) {
      (a.shifts || []).forEach(function (s) {
        shifts[s.id] = { name: s.name, label: s.label, start: s.start, end: s.end, ambCode: a.code };
      });
    });
    var me = (snap.employees || []).filter(function (e) { return e.id === mine; })[0] || { name: '' };
    var title = MONTHS[st.m - 1] + ' ' + st.y;
    var events = window.Ics.shiftEvents((snap.cells || {})[mine] || {}, shifts);
    if (!events.length) return toast('Nessun turno da aggiungere in questo mese.');
    var ics = window.Ics.buildCalendar(events, { name: 'Turni ' + title, uidKey: key + '-' + mine, location: st.unitName || '' });
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = window.Ics.fileName(title, me.name);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast(events.length + ' eventi nel file del calendario: aprilo per aggiungerli.');
  }

  function toggle(day) {
    var key = O.monthKey(st.y, st.m), self = me();
    if (!self || st.busy) return;
    var current = requestsOf(self.id, key).filter(function (r) { return r.day === day; })[0];
    var kind = current && current.kind === st.tool ? null : st.tool;
    st.busy = true;
    st.sb.rpc('set_request', { p_day: day, p_kind: kind }).then(function (r) {
      if (r.error) throw r.error;
      return load();
    }).then(function () {
      st.busy = false;
      render();
      toast(kind ? (kind === 'R' ? 'Richiesta di riposo' : 'Permesso 104') + ' inserito per il ' + fmtDay(day) + '.'
        : 'Richiesta del ' + fmtDay(day) + ' tolta.');
    }).catch(function (e) {
      st.busy = false;
      toast(errText(e), true);
      load().then(render);
    });
  }

  function bind() {
    var box = $('#staff-view');
    box.addEventListener('click', function (ev) {
      var nav = ev.target.closest('[data-nav]');
      if (nav) {
        var m = st.m + +nav.getAttribute('data-nav');
        st.y += Math.floor((m - 1) / 12);
        st.m = ((m - 1) % 12 + 12) % 12 + 1;
        return load().then(render).catch(function (e) { toast(errText(e), true); });
      }
      if (ev.target.closest('[data-ics]')) return downloadIcs();
      var t = ev.target.closest('[data-tool]');
      if (t) { st.tool = t.getAttribute('data-tool'); return render(); }
      var cell = ev.target.closest('td[data-day]');
      if (cell) toggle(cell.getAttribute('data-day'));
    });
    box.addEventListener('keydown', function (ev) {
      var cell = ev.target.closest('td[data-day]');
      if (cell && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggle(cell.getAttribute('data-day')); }
    });
    window.addEventListener('focus', function () {
      if (st && Date.now() - st.loadedAt > 30000) load().then(render).catch(function () { /* riprova dopo */ });
    });
  }

  window.TurniStaff = {
    // opts: { sb, profile, unitId, unitName }
    start: function (opts) {
      var now = new Date();
      st = { sb: opts.sb, profile: opts.profile, unitId: opts.unitId, unitName: opts.unitName || '', roster: { employees: [] }, requests: [],
        published: {}, y: now.getFullYear(), m: now.getMonth() + 1, tool: 'R', loadedAt: 0 };
      document.body.classList.add('staff-mode');
      $('#staff-view').hidden = false;
      bind();
      return load().then(function () {
        // Si parte dal mese in corso se è pubblicato, altrimenti dal prossimo (quello delle richieste).
        if (!st.published[O.monthKey(st.y, st.m)]) {
          st.m = st.m === 12 ? 1 : st.m + 1;
          if (st.m === 1) st.y++;
          return load();
        }
      }).then(render).catch(function (e) { toast('Dati non caricati: ' + errText(e), true); });
    }
  };
})();
