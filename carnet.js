'use strict';

function carnetDay() {
  const parts = new Intl.DateTimeFormat('fr-FR', {year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function carnetDate(value) {
  return new Date(value + 'T12:00:00').toLocaleDateString('fr-FR');
}

function carnetTermLocked(group, term) {
  return Boolean(group.termLocks?.[term]);
}

function carnetCommit(group, key, value, term) {
  if (term && carnetTermLocked(group, term)) return false;
  const previous = group[key];
  group[key] = value;
  if (save()) return true;
  group[key] = previous;
  return false;
}

function bindCarnetTermLocks(group) {
  const dialog = $('carnetTermDialog');
  const code = $('carnetTermCode');
  const read = $('carnetTermRead');
  const message = $('carnetTermError');
  let target;

  function open(link) {
    if (dialog.open || !link.isConnected) return;
    const term = link.dataset.term;
    const locked = carnetTermLocked(group, term);
    target = {term, href: link.getAttribute('href'), locked};
    $('carnetTermTitle').textContent = (locked ? 'Déverrouiller' : 'Verrouiller') + ' le trimestre ' + term;
    $('carnetTermDescription').textContent = locked
      ? 'Saisis le code pour réactiver les modifications.'
      : 'L’appel, les bulletins et les notes resteront consultables en lecture seule.';
    $('carnetTermCodeLabel').hidden = read.hidden = !locked;
    code.required = locked;
    code.value = '';
    message.textContent = '';
    $('carnetTermSubmit').textContent = locked ? 'Déverrouiller' : 'Verrouiller';
    dialog.showModal();
    if (locked) code.focus();
  }

  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    if (target.locked && code.value.trim() !== '46') {
      message.textContent = 'Code incorrect.';
      code.select();
      return;
    }
    const locks = {...group.termLocks};
    if (target.locked) delete locks[target.term];
    else locks[target.term] = {exemptions: group.exemptions || {}};
    if (!carnetCommit(group, 'termLocks', locks)) return;
    dialog.close();
    if (target.locked && location.hash !== target.href) location.hash = target.href;
    else render();
    notify(target.locked ? 'Trimestre déverrouillé.' : 'Trimestre verrouillé.');
  };
  $('carnetTermCancel').onclick = () => dialog.close();
  read.onclick = () => {
    dialog.close();
    location.hash = target.href;
  };
  code.oninput = () => { message.textContent = ''; };

  for (const link of document.querySelectorAll('[data-term]')) {
    let timer;
    let start;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    link.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || carnetTermLocked(group, link.dataset.term)) return;
      cancel();
      start = [event.clientX, event.clientY];
      timer = setTimeout(() => { cancel(); open(link); }, 650);
    });
    link.addEventListener('pointermove', event => {
      if (timer && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 10) cancel();
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) link.addEventListener(type, cancel);
    link.addEventListener('contextmenu', event => {
      event.preventDefault();
      cancel();
      open(link);
    });
    link.addEventListener('click', event => {
      if (dialog.open || carnetTermLocked(group, link.dataset.term)) {
        event.preventDefault();
        open(link);
      }
    });
  }
}

function renderCarnet(group, tab, term) {
  const root = classRoute(group);
  const students = [...group.students].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const locked = carnetTermLocked(group, term);
  content.innerHTML = `<section class="route carnet personalized-class" style="${appearanceStyle(group.color)}">
    <a class="back-link" href="#classes">← Mes classes</a>
    <header class="carnet-head photo-banner">
      ${bannerPhoto(group.banner)}
      <h1>${esc(group.name)}</h1>
      <a href="${root}/eleves">Modifier la classe et le trombinoscope</a>
    </header>
    <nav class="carnet-tabs" aria-label="Trimestre" ${tab === 'trombinoscope' ? 'hidden' : ''}>${['1', '2', '3'].map(number => {
      const isLocked = carnetTermLocked(group, number);
      return `<a href="${root}/${tab}/${number}" data-term="${number}" title="${isLocked ? 'Cliquer pour déverrouiller' : 'Appui long pour verrouiller'}"
        ${term === number ? 'aria-current="page"' : ''}>Trimestre ${number}${isLocked ? ' <span aria-hidden="true">🔒</span><span class="term-lock-label">Verrouillé</span>' : ''}</a>`;
    }).join('')}</nav>
    <nav class="carnet-tabs carnet-sections" aria-label="Carnet">
      <a href="${root}/appel/${term}" ${tab === 'appel' ? 'aria-current="page"' : ''}>Appel</a>
      <a href="${root}/notes/${term}" ${tab === 'notes' ? 'aria-current="page"' : ''}>Notes</a>
      <a href="${root}/bulletins/${term}" ${tab === 'bulletins' ? 'aria-current="page"' : ''}>Bulletins</a>
      <a href="${root}/trombinoscope/${term}" ${tab === 'trombinoscope' ? 'aria-current="page"' : ''}>Trombinoscope</a>
      ${group.principal === true ? `<a href="${root}/conseil/${term}" ${tab === 'conseil' ? 'aria-current="page"' : ''}>Prof principal</a>` : ''}
      <a href="${root}/tableau-blanc/${term}">Tableau blanc</a>
    </nav>
    ${locked && tab !== 'trombinoscope' ? '<p class="carnet-term-notice">Trimestre verrouillé · Lecture seule</p>' : ''}
    <div id="carnetContent"></div>
    <dialog id="carnetStudentDialog" class="student-profile" aria-labelledby="carnetStudentTitle">
      <header class="student-profile-head">
        <div id="carnetStudentIdentity"></div>
        <form method="dialog"><button autofocus>Fermer la fiche</button></form>
      </header>
      <label for="carnetStudentTerm">Trimestre</label>
      <select id="carnetStudentTerm">
        <option value="1">Trimestre 1</option>
        <option value="2">Trimestre 2</option>
        <option value="3">Trimestre 3</option>
      </select>
      <div id="carnetStudentDetails"></div>
    </dialog>
    <dialog id="carnetTermDialog" aria-labelledby="carnetTermTitle">
      <h2 id="carnetTermTitle"></h2>
      <p id="carnetTermDescription"></p>
      <form>
        <label id="carnetTermCodeLabel" hidden>Code <input id="carnetTermCode" type="password" inputmode="numeric" autocomplete="off" maxlength="2"></label>
        <p id="carnetTermError" class="term-lock-error" role="alert"></p>
        <div class="actions">
          <button id="carnetTermCancel" type="button" autofocus>Annuler</button>
          <button id="carnetTermRead" type="button" hidden>Consulter</button>
          <button id="carnetTermSubmit" class="primary" type="submit"></button>
        </div>
      </form>
    </dialog>
  </section>`;
  bindCarnetTermLocks(group);
  if (tab === 'notes') renderCarnetGrades(group, term, students);
  else if (tab === 'bulletins' || tab === 'conseil') renderBulletins(group, term, students, tab === 'conseil');
  else if (tab === 'trombinoscope') renderClassTrombinoscope(group, term, students);
  else renderCarnetAttendance(group, term, students);
}

function carnetPortraitTrigger(student, photo) {
  if (photo.tagName !== 'IMG') return photo;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'carnet-portrait-trigger';
  button.setAttribute('aria-label', 'Agrandir le portrait de ' + student.name);
  button.setAttribute('aria-haspopup', 'dialog');
  button.title = 'Double-clique ou touche deux fois pour agrandir';
  button.append(photo);

  function showPortrait() {
    let dialog = $('carnetPortraitDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'carnetPortraitDialog';
      dialog.className = 'board-portrait-dialog';
      dialog.setAttribute('aria-labelledby', 'carnetPortraitName');
      dialog.innerHTML = `<h2 id="carnetPortraitName"></h2>
        <img alt="">
        <form method="dialog"><button autofocus>Fermer le portrait</button></form>`;
      $('carnetContent').append(dialog);
    }
    if (dialog.open) return;
    $('carnetPortraitName').textContent = student.name;
    dialog.querySelector('img').src = photo.src;
    dialog.showModal();
  }

  let lastTap;
  button.addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    if (lastTap !== undefined && event.timeStamp - lastTap <= 400) {
      lastTap = undefined;
      showPortrait();
    } else {
      lastTap = event.timeStamp;
    }
  });
  button.addEventListener('dblclick', showPortrait);
  button.addEventListener('click', event => {
    if (event.detail === 0) showPortrait();
  });
  return button;
}

function carnetStudentName(group, term, student) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'student-profile-link';
  button.textContent = student.name;
  button.setAttribute('aria-label', `Ouvrir la fiche de ${student.name}`);
  button.setAttribute('aria-haspopup', 'dialog');
  button.onclick = () => showCarnetStudent(group, term, student);
  return button;
}

function carnetStudentExemptions(group, term, studentId) {
  const exemptions = carnetTermLocked(group, term) ? group.termLocks[term].exemptions : group.exemptions;
  return Array.isArray(exemptions?.[studentId]) ? exemptions[studentId] : [];
}

function carnetNumber(value) {
  return new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 2}).format(value);
}

function carnetAverage(evaluations, studentId) {
  let weighted = 0;
  let weights = 0;
  for (const evaluation of evaluations) {
    const score = evaluation.scores[studentId];
    if (!Number.isFinite(score)) continue;
    weighted += (score / evaluation.maximum) * 20 * evaluation.weight;
    weights += evaluation.weight;
  }
  return weights ? carnetNumber(weighted / weights) : '—';
}

function carnetStudentDetails(group, term, studentId) {
  const periods = carnetStudentExemptions(group, term, studentId);
  const calls = Object.entries(group.attendance?.[term] || {})
    .sort(([a], [b]) => b.localeCompare(a));
  const counts = {absences: 0, forgot: 0, exempt: 0};
  const history = [];
  for (const [date, day] of calls) {
    const state = day.entries?.[studentId] || {};
    const labels = [];
    if (state.absent) {
      counts.absences++;
      labels.push('Absent');
    } else {
      if (state.forgot) {
        counts.forgot++;
        labels.push('Oubli de tenue');
      }
      const long = periods.some(period => period.start <= date && period.end >= date);
      if (state.excused || long) counts.exempt++;
      if (state.excused) labels.push(state.minutes ? `Dispense de séance (${state.minutes} min)` : 'Dispense de séance');
      if (long) labels.push('Dispense longue durée');
    }
    if (labels.length) history.push(`<li><strong>${esc(carnetDate(date))}</strong><span>${esc(labels.join(' · '))}</span></li>`);
  }

  const evaluations = group.evaluations?.[term] || [];
  const appreciation = bulletinEntry(group, term, studentId);
  return `<section>
    <h3>Suivi de l’appel</h3>
    <dl class="student-profile-counts">
      <div><dt>Appels saisis</dt><dd>${calls.length}</dd></div>
      <div><dt>Absences</dt><dd>${counts.absences}</dd></div>
      <div><dt>Oublis de tenue</dt><dd>${counts.forgot}</dd></div>
      <div><dt>Séances dispensées</dt><dd>${counts.exempt}</dd></div>
    </dl>
    ${history.length ? `<ul class="student-profile-list">${history.join('')}</ul>` : '<p class="muted">Aucune absence, dispense de séance ou tenue oubliée dans les appels de ce trimestre.</p>'}
    ${periods.length ? `<h4>Dispenses longue durée</h4><ul class="student-profile-list">${[...periods].sort((a, b) => b.start.localeCompare(a.start)).map(period =>
      `<li>Du ${esc(carnetDate(period.start))} au ${esc(carnetDate(period.end))}</li>`).join('')}</ul>` : ''}
  </section>
  <section>
    <h3>Notes par évaluation</h3>
    ${evaluations.length ? `<ul class="student-profile-list">${evaluations.map(item => {
      const score = item.scores[studentId];
      return `<li><span>${esc(item.name)} <small class="muted">Coef. ${carnetNumber(item.weight)}</small></span>
        <strong>${Number.isFinite(score) ? `${carnetNumber(score)} / ${carnetNumber(item.maximum)}` : 'Non renseignée'}</strong></li>`;
    }).join('')}</ul><p><strong>Moyenne / 20</strong> · ${carnetAverage(evaluations, studentId)}</p>` : '<p class="muted">Aucune évaluation pour ce trimestre.</p>'}
  </section>
  <section>
    <h3>Appréciations</h3>
    <h4>EPS</h4><p class="student-profile-text">${esc(appreciation.eps || 'Aucune appréciation saisie.')}</p>
    ${group.principal === true ? `<h4>Conseil de classe</h4><p class="student-profile-text">${esc(appreciation.conseil || 'Aucune appréciation saisie.')}</p>` : ''}
  </section>`;
}

function showCarnetStudent(group, term, student) {
  const dialog = $('carnetStudentDialog');
  const picker = $('carnetStudentTerm');
  const heading = document.createElement('h2');
  heading.id = 'carnetStudentTitle';
  heading.textContent = student.name;
  $('carnetStudentIdentity').replaceChildren(RosterPortraits.photo(student.portrait), heading);
  picker.value = term;
  picker.onchange = () => { $('carnetStudentDetails').innerHTML = carnetStudentDetails(group, picker.value, student.id); };
  picker.onchange();
  dialog.showModal();
  dialog.scrollTop = 0;
}

function renderClassTrombinoscope(group, term, students) {
  const panel = $('carnetContent');
  panel.innerHTML = `<section class="carnet-panel">
    <h2>Trombinoscope</h2>
    ${students.length ? '<ul id="classPortraits" class="class-portraits"></ul>' : '<p>Aucun élève dans cette classe.</p>'}
  </section>`;
  if (!students.length) return;
  $('classPortraits').append(...students.map(student => {
    const item = document.createElement('li');
    const portrait = RosterPortraits.photo(student.portrait);
    if (portrait.tagName === 'IMG') portrait.loading = 'lazy';
    else portrait.textContent = student.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('fr');
    item.append(carnetPortraitTrigger(student, portrait), carnetStudentName(group, term, student));
    return item;
  }));
}

function renderCarnetAttendance(group, term, students) {
  const locked = carnetTermLocked(group, term);
  $('carnetContent').innerHTML = `<div class="carnet-panel">
    <div class="carnet-controls">
      <label for="attendanceDate">Date de la séance <input id="attendanceDate" type="date" required></label>
      <label for="attendanceHistory">Séances enregistrées <select id="attendanceHistory"></select></label>
    </div>
    <div id="attendanceSummary" class="attendance-summary" role="status"></div>
    <div class="carnet-table-wrap"><table class="carnet-table"><thead><tr>
      <th scope="col">Élève</th><th scope="col">Présence et observations</th>
    </tr></thead><tbody id="attendanceRows"></tbody></table></div>
    <div class="carnet-footer">
      <button id="finishAttendance" class="primary" type="button">Enregistrer l’appel</button>
      <a class="action tool-blue" href="https://gvs.vauban.lu/login" target="_blank" rel="noopener noreferrer">Connexion Vauban pour PRONOTE</a>
      <p id="attendanceMessage" role="status"></p>
    </div>
  </div>
  <dialog id="excuseDialog" aria-labelledby="excuseTitle">
    <h2 id="excuseTitle"></h2>
    <form id="excuseForm">
      <div id="excuseMinutesField"><label for="excuseMinutes">Durée de la dispense (minutes)</label><input id="excuseMinutes" type="number" min="1" step="1" placeholder="Facultatif"></div>
      <div id="excuseDatesField" class="carnet-controls">
        <label for="excuseStart">Du <input id="excuseStart" type="date"></label>
        <label for="excuseEnd">Au (inclus) <input id="excuseEnd" type="date"></label>
      </div>
      <div class="actions">
        <button id="excuseRemove" class="danger" type="button" hidden>Retirer cette dispense</button>
        <button id="excuseCancel" type="button">Annuler</button><button class="primary">Enregistrer</button>
      </div>
    </form>
  </dialog>`;
  const dateField = $('attendanceDate');
  const history = $('attendanceHistory');
  const message = $('attendanceMessage');
  dateField.value = carnetDay();

  const termDays = () => group.attendance?.[term] || {};
  const day = () => termDays()[dateField.value];
  const entry = id => day()?.entries?.[id] || {};
  const activeExemption = id => carnetStudentExemptions(group, term, id).find(period =>
    period.start <= dateField.value && period.end >= dateField.value);

  function writeDay(entries, finalized = false) {
    const date = dateField.value;
    if (!dateField.reportValidity()) return false;
    return carnetCommit(group, 'attendance', {...group.attendance, [term]: {...termDays(), [date]: {entries, finalized}}}, term);
  }

  function updateStudent(studentId, fields) {
    const updated = {...entry(studentId), ...fields};
    const entries = {...day()?.entries, [studentId]: updated};
    if (writeDay(entries)) paint();
  }

  let editing;
  function openExemption(student, long) {
    if (carnetTermLocked(group, term) || !dateField.reportValidity()) return;
    const period = long ? activeExemption(student.id) : null;
    const current = entry(student.id);
    editing = {student, long, period};
    $('excuseTitle').textContent = (long ? 'Dispense longue durée' : 'Dispense pour la séance') + ' · ' + student.name;
    $('excuseMinutesField').hidden = long;
    $('excuseDatesField').hidden = !long;
    $('excuseStart').required = $('excuseEnd').required = long;
    $('excuseStart').value = period?.start || dateField.value;
    $('excuseEnd').value = period?.end || dateField.value;
    $('excuseEnd').min = $('excuseStart').value;
    $('excuseMinutes').value = long ? '' : current.minutes || '';
    $('excuseRemove').hidden = long ? !period : !current.excused;
    $('excuseDialog').showModal();
  }

  $('excuseStart').onchange = () => { $('excuseEnd').min = $('excuseStart').value; };
  $('excuseCancel').onclick = () => $('excuseDialog').close();
  function writeExemption(replacement) {
    const {student, period} = editing;
    const periods = (group.exemptions?.[student.id] || []).filter(item => item !== period);
    if (replacement) periods.push(replacement);
    if (!carnetCommit(group, 'exemptions', {...group.exemptions, [student.id]: periods}, term)) return;
    $('excuseDialog').close();
    paint();
  }
  $('excuseForm').onsubmit = event => {
    event.preventDefault();
    if (editing.long) {
      writeExemption({start: $('excuseStart').value, end: $('excuseEnd').value});
    } else {
      updateStudent(editing.student.id, {excused: true, minutes: Number($('excuseMinutes').value) || null});
      $('excuseDialog').close();
    }
  };
  $('excuseRemove').onclick = () => {
    if (editing.long) writeExemption(null);
    else {
      updateStudent(editing.student.id, {excused: false, minutes: null});
      $('excuseDialog').close();
    }
  };

  function paint() {
    const dates = Object.keys(termDays()).sort().reverse();
    history.replaceChildren(new Option('Choisir une séance', ''), ...dates.map(date => new Option(carnetDate(date), date)));
    history.value = day() ? dateField.value : '';
    const total = {present: 0, absent: 0, forgot: 0, excused: 0};
    const rows = students.map(student => {
      const state = entry(student.id);
      const long = activeExemption(student.id);
      if (state.absent) total.absent++;
      else {
        total.present++;
        if (state.forgot) total.forgot++;
        if (state.excused || long) total.excused++;
      }
      const row = document.createElement('tr');
      row.classList.toggle('carnet-absent', Boolean(state.absent));
      row.innerHTML = `<th scope="row"><span class="carnet-student"></span></th><td></td>`;
      const photo = RosterPortraits.photo(student.portrait);
      row.querySelector('.carnet-student').append(carnetPortraitTrigger(student, photo), carnetStudentName(group, term, student));
      const actions = document.createElement('div');
      actions.className = 'attendance-actions';
      function status(label, icon, color, pressed, apply) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `attendance-status ${color}`;
        button.disabled = locked;
        button.setAttribute('aria-pressed', String(Boolean(pressed)));
        const symbol = document.createElement('span');
        symbol.textContent = icon;
        symbol.setAttribute('aria-hidden', 'true');
        button.append(symbol, document.createTextNode(label));
        button.onclick = apply;
        actions.append(button);
      }
      status('Présent', '✓', 'tool-green', !state.absent, () => updateStudent(student.id, {absent: false}));
      status('Absent', '×', 'tool-red', state.absent, () => updateStudent(student.id, {absent: true}));
      status('Oubli', '!', 'tool-amber', state.forgot, () => updateStudent(student.id, {forgot: !state.forgot}));
      status(state.minutes ? `Disp. · ${state.minutes} min` : 'Disp. séance', '◷', 'tool-blue', state.excused, () => openExemption(student, false));
      status('Disp. longue', '▦', 'tool-purple', long, () => openExemption(student, true));
      row.lastElementChild.append(actions);
      if (long) {
        const periodLabel = document.createElement('small');
        periodLabel.textContent = `Dispense du ${carnetDate(long.start)} au ${carnetDate(long.end)}`;
        row.lastElementChild.append(periodLabel);
      }
      return row;
    });
    const count = (number, word) => `${number} ${word}${number > 1 ? 's' : ''}`;
    $('attendanceSummary').textContent = `${count(total.present, 'présent')} · ${count(total.absent, 'absent')} · Parmi les présents, ${count(total.excused, 'dispensé')} et ${count(total.forgot, 'oubli')}`;
    $('attendanceRows').replaceChildren(...rows);
    message.textContent = day() ? '' : locked ? 'Aucun appel enregistré pour cette date.' : 'Un élève est présent par défaut. Coche les exceptions avant d’enregistrer.';
  }

  dateField.oninput = paint;
  history.onchange = () => { if (history.value) dateField.value = history.value; paint(); };
  $('finishAttendance').disabled = locked || !students.length;
  $('finishAttendance').onclick = () => {
    if (!writeDay(day()?.entries || {}, true)) return;
    paint();
    message.textContent = 'Appel enregistré dans le carnet.';
  };

  if (locked && !day()) dateField.value = Object.keys(termDays()).sort().at(-1) || dateField.value;
  paint();
}

function renderCarnetGrades(group, term, students) {
  const panel = $('carnetContent');
  const locked = carnetTermLocked(group, term);
  const evaluations = group.evaluations?.[term] || [];
  panel.innerHTML = `<section class="carnet-panel">
    <div class="carnet-controls">
      <button id="newEvaluation" class="primary" ${locked ? 'disabled' : ''}>Ajouter une évaluation</button>
      <p class="muted">Les moyennes sont ramenées sur 20 et pondérées par les coefficients.${!locked && evaluations.length ? ' Appui long sur le titre d’une évaluation pour la supprimer.' : ''}</p>
    </div>
    <div class="carnet-table-wrap"><table class="carnet-table grade-table">
      <thead><tr><th scope="col">Élève</th>${evaluations.map(item =>
        `<th scope="col" ${locked ? '' : `class="evaluation-head" data-evaluation="${esc(item.id)}" title="Appui long pour supprimer"`}>${esc(item.name)}<small>/${item.maximum} · coef. ${item.weight}</small></th>`).join('')}<th scope="col">Moyenne /20</th></tr></thead>
      <tbody></tbody>
    </table></div>
  </section>
  <dialog id="evaluationDialog" aria-labelledby="evaluationTitle"><h2 id="evaluationTitle">Nouvelle évaluation</h2>
    <form id="evaluationForm">
      <label for="evaluationName">Nom de l’évaluation</label><input id="evaluationName" required maxlength="80">
      <div class="carnet-controls">
        <label for="evaluationMaximum">Barème <input id="evaluationMaximum" type="number" min="0.01" step="0.01" value="20" required></label>
        <label for="evaluationWeight">Coefficient <input id="evaluationWeight" type="number" min="0.01" step="0.01" value="1" required></label>
      </div>
      <div class="actions"><button id="evaluationCancel" type="button">Annuler</button><button class="primary">Ajouter</button></div>
    </form>
  </dialog>`;
  const table = panel.querySelector('tbody');
  for (const student of students) {
    const row = document.createElement('tr');
    row.innerHTML = '<th scope="row"><span class="carnet-student"></span></th>';
    row.querySelector('.carnet-student').append(RosterPortraits.photo(student.portrait), carnetStudentName(group, term, student));
    const result = document.createElement('td');
    result.className = 'carnet-average';
    result.textContent = carnetAverage(evaluations, student.id);
    for (const evaluation of evaluations) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = evaluation.maximum;
      input.step = 'any';
      input.value = evaluation.scores[student.id] ?? '';
      input.readOnly = locked;
      input.setAttribute('aria-label', `Note ${evaluation.name} · ${student.name}`);
      input.onchange = () => {
        if (!input.reportValidity()) return;
        const current = group.evaluations[term];
        const previous = current.find(item => item.id === evaluation.id);
        const scores = {...previous.scores};
        if (input.value === '') delete scores[student.id];
        else scores[student.id] = input.valueAsNumber;
        if (carnetCommit(group, 'evaluations', {...group.evaluations, [term]: current.map(item =>
          item.id === evaluation.id ? {...item, scores} : item)}, term)) result.textContent = carnetAverage(group.evaluations[term], student.id);
        else input.value = previous.scores[student.id] ?? '';
      };
      cell.append(input);
      row.append(cell);
    }
    row.append(result);
    table.append(row);
  }
  function removeEvaluation(id) {
    const current = group.evaluations?.[term] || [];
    const evaluation = current.find(item => item.id === id);
    if (!evaluation || carnetTermLocked(group, term)) return;
    const count = Object.values(evaluation.scores).filter(Number.isFinite).length;
    const notes = count ? ` et ses ${count} note${count === 1 ? '' : 's'}` : '';
    if (!confirm(`Supprimer l’évaluation « ${evaluation.name} »${notes} ?\n\nLes moyennes seront recalculées. Cette action est définitive.`)) return;
    if (carnetCommit(group, 'evaluations', {...group.evaluations, [term]: current.filter(item => item.id !== id)}, term)) {
      renderCarnetGrades(group, term, students);
      notify(`Évaluation « ${evaluation.name} » supprimée.`);
    }
  }
  for (const head of panel.querySelectorAll('[data-evaluation]')) {
    let timer = null;
    let start = null;
    const cancel = () => { clearTimeout(timer); timer = null; head.classList.remove('pressing'); };
    head.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      start = [event.clientX, event.clientY];
      head.classList.add('pressing');
      timer = setTimeout(() => { cancel(); removeEvaluation(head.dataset.evaluation); }, 650);
    });
    head.addEventListener('pointermove', event => {
      if (timer && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 10) cancel();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) head.addEventListener(type, cancel);
    head.addEventListener('contextmenu', event => {
      event.preventDefault();
      cancel();
      removeEvaluation(head.dataset.evaluation);
    });
  }
  $('newEvaluation').onclick = () => $('evaluationDialog').showModal();
  $('evaluationCancel').onclick = () => $('evaluationDialog').close();
  $('evaluationForm').onsubmit = event => {
    event.preventDefault();
    const name = $('evaluationName').value.trim();
    if (!name) return;
    const item = {id: uid(), name, maximum: $('evaluationMaximum').valueAsNumber, weight: $('evaluationWeight').valueAsNumber, scores: {}};
    if (carnetCommit(group, 'evaluations', {...group.evaluations, [term]: [...evaluations, item]}, term)) renderCarnetGrades(group, term, students);
  };
}
