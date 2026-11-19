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

function carnetCommit(group, key, value) {
  const previous = group[key];
  group[key] = value;
  if (save()) return true;
  group[key] = previous;
  return false;
}

function renderCarnet(group, tab, term) {
  const root = classRoute(group);
  const students = [...group.students].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  content.innerHTML = `<section class="route carnet personalized-class" style="${appearanceStyle(group.color)}">
    <a class="back-link" href="#classes">← Mes classes</a>
    <header class="carnet-head">
      <h1>${esc(group.name)}</h1>
      <a href="${root}/eleves">Modifier la classe et le trombinoscope</a>
    </header>
    <nav class="carnet-tabs" aria-label="Trimestre">${['1', '2', '3'].map(number =>
      `<a href="${root}/${tab}/${number}" ${term === number ? 'aria-current="page"' : ''}>Trimestre ${number}</a>`).join('')}</nav>
    <nav class="carnet-tabs carnet-sections" aria-label="Carnet">
      <a href="${root}/appel/${term}" ${tab === 'appel' ? 'aria-current="page"' : ''}>Appel</a>
      <a href="${root}/notes/${term}" ${tab === 'notes' ? 'aria-current="page"' : ''}>Notes</a>
      <a href="${root}/tableau-blanc/${term}">Tableau blanc</a>
    </nav>
    <div id="carnetContent"></div>
  </section>`;
  if (tab === 'notes') renderCarnetGrades(group, term, students);
  else renderCarnetAttendance(group, term, students);
}

function renderCarnetAttendance(group, term, students) {
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
  const activeExemption = id => (group.exemptions?.[id] || []).find(period =>
    period.start <= dateField.value && period.end >= dateField.value);

  function writeDay(entries, finalized = false) {
    const date = dateField.value;
    if (!dateField.reportValidity()) return false;
    return carnetCommit(group, 'attendance', {...group.attendance, [term]: {...termDays(), [date]: {entries, finalized}}});
  }

  function updateStudent(studentId, fields) {
    const updated = {...entry(studentId), ...fields};
    const entries = {...day()?.entries, [studentId]: updated};
    if (writeDay(entries)) paint();
  }

  let editing;
  function openExemption(student, long) {
    if (!dateField.reportValidity()) return;
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
    if (!carnetCommit(group, 'exemptions', {...group.exemptions, [student.id]: periods})) return;
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
      row.querySelector('.carnet-student').append(RosterPortraits.photo(student.portrait), document.createTextNode(student.name));
      const actions = document.createElement('div');
      actions.className = 'attendance-actions';
      function status(label, icon, color, pressed, apply) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `attendance-status ${color}`;
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
    message.textContent = day() ? '' : 'Un élève est présent par défaut. Coche les exceptions avant d’enregistrer.';
  }

  dateField.oninput = paint;
  history.onchange = () => { if (history.value) dateField.value = history.value; paint(); };
  $('finishAttendance').disabled = !students.length;
  $('finishAttendance').onclick = () => {
    if (!writeDay(day()?.entries || {}, true)) return;
    paint();
    message.textContent = 'Appel enregistré dans le carnet.';
  };

  paint();
}

function renderCarnetGrades(group, term, students) {
  const panel = $('carnetContent');
  const evaluations = group.evaluations?.[term] || [];
  panel.innerHTML = `<section class="carnet-panel">
    <div class="carnet-controls">
      <button id="newEvaluation" class="primary">Ajouter une évaluation</button>
      <p class="muted">Les moyennes sont ramenées sur 20 et pondérées par les coefficients.</p>
    </div>
    <div class="carnet-table-wrap"><table class="carnet-table grade-table">
      <thead><tr><th scope="col">Élève</th>${evaluations.map(item =>
        `<th scope="col">${esc(item.name)}<small>/${item.maximum} · coef. ${item.weight}</small></th>`).join('')}<th scope="col">Moyenne /20</th></tr></thead>
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
  function average(studentId) {
    let weighted = 0;
    let weights = 0;
    for (const evaluation of group.evaluations?.[term] || []) {
      const score = evaluation.scores[studentId];
      if (!Number.isFinite(score)) continue;
      weighted += (score / evaluation.maximum) * 20 * evaluation.weight;
      weights += evaluation.weight;
    }
    return weights ? new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 2}).format(weighted / weights) : '—';
  }

  for (const student of students) {
    const row = document.createElement('tr');
    row.innerHTML = '<th scope="row"><span class="carnet-student"></span></th>';
    row.querySelector('.carnet-student').append(RosterPortraits.photo(student.portrait), document.createTextNode(student.name));
    const result = document.createElement('td');
    result.className = 'carnet-average';
    result.textContent = average(student.id);
    for (const evaluation of evaluations) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = evaluation.maximum;
      input.step = 'any';
      input.value = evaluation.scores[student.id] ?? '';
      input.setAttribute('aria-label', `Note ${evaluation.name} · ${student.name}`);
      input.onchange = () => {
        if (!input.reportValidity()) return;
        const current = group.evaluations[term];
        const previous = current.find(item => item.id === evaluation.id);
        const scores = {...previous.scores};
        if (input.value === '') delete scores[student.id];
        else scores[student.id] = input.valueAsNumber;
        if (carnetCommit(group, 'evaluations', {...group.evaluations, [term]: current.map(item =>
          item.id === evaluation.id ? {...item, scores} : item)})) result.textContent = average(student.id);
        else input.value = previous.scores[student.id] ?? '';
      };
      cell.append(input);
      row.append(cell);
    }
    row.append(result);
    table.append(row);
  }
  $('newEvaluation').onclick = () => $('evaluationDialog').showModal();
  $('evaluationCancel').onclick = () => $('evaluationDialog').close();
  $('evaluationForm').onsubmit = event => {
    event.preventDefault();
    const name = $('evaluationName').value.trim();
    if (!name) return;
    const item = {id: uid(), name, maximum: $('evaluationMaximum').valueAsNumber, weight: $('evaluationWeight').valueAsNumber, scores: {}};
    if (carnetCommit(group, 'evaluations', {...group.evaluations, [term]: [...evaluations, item]})) renderCarnetGrades(group, term, students);
  };
}
