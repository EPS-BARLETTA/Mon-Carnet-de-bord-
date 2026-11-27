'use strict';

const BULLETIN_MENTIONS = [
  ['felicitations', 'Félicitations'],
  ['encouragements', 'Encouragements'],
  ['travail', 'Avertissement travail'],
  ['conduite', 'Avertissement conduite'],
  ['mise-en-garde', 'Mise en garde'],
];

function bulletinEntry(group, term, studentId) {
  const entry = group.bulletins?.[term]?.[studentId];
  const text = key => typeof entry?.[key] === 'string' ? entry[key] : '';
  const mentions = Array.isArray(entry?.mentions) ? entry.mentions : [];
  const shared = typeof ClasseurNotes === 'object' ? ClasseurNotes.remark(group, term, studentId) : null;
  return {
    eps: shared ?? text('eps'),
    conseil: text('conseil'),
    memo: text('memo'),
    mentions: BULLETIN_MENTIONS.map(([key]) => key).filter(key => mentions.includes(key)),
    ...(entry?.validated ? {validated: true} : {}),
    ...(typeof entry?.conseilNote === 'string' && entry.conseilNote.trim() ? {conseilNote: entry.conseilNote.slice(0, 1000)} : {}),
  };
}

function bulletinNotesSummary(group, term, studentId) {
  const info = ClasseurNotes.student(group, term, studentId);
  if (!info.rows.length) return '<p class="muted">Aucune évaluation ce trimestre.</p>';
  const rows = info.rows.map(row => `<span${row.coef > 0 ? '' : ' class="bulletin-off"'}>${esc(row.name)} <strong>${row.statusLabel ? esc(row.statusLabel) : ClasseurNotes.format(row.note)}</strong>${row.coef > 0 ? '' : ` <small class="muted">(${row.formative && !row.kept ? 'formative, ' : ''}non comptée)</small>`}</span>`).join('');
  const tags = info.tags.map(tag => ClasseurNotes.TAGS[tag]).filter(Boolean);
  return `<p class="bulletin-mean">Moyenne EPS <strong>${ClasseurNotes.format(info.retained)}</strong> / 20${info.overridden ? ' <small class="muted">(moyenne retenue)</small>' : ''}</p>
    <p class="bulletin-notes">${rows}</p>${tags.length ? `<p class="muted">${esc(tags.join(' · '))}</p>` : ''}`;
}

function renderBulletins(group, term, students, principal) {
  const panel = $('carnetContent');
  const locked = carnetTermLocked(group, term);
  if (!students.length) {
    panel.innerHTML = '<p class="card">Ajoute des élèves à la classe pour préparer les bulletins.</p>';
    return;
  }

  if (principal && PPConseil.isOn()) {
    PPConseil.render(panel, group, term, students, () => renderBulletins(group, term, students, principal));
    return;
  }

  panel.innerHTML = `<section class="card bulletin">
    <div class="bulletin-title"><h2>${principal ? 'Fiches pour le conseil de classe' : 'Appréciations EPS'}</h2>
      ${principal ? '<button type="button" class="primary conseil-open" id="conseilOpen">Mode conseil de classe</button>' : ''}</div>
    <div class="bulletin-nav">
      <button id="bulletinPrev" type="button">← Précédent</button>
      <label for="bulletinStudent">Élève
        <select id="bulletinStudent"></select>
      </label>
      <button id="bulletinNext" type="button">Suivant →</button>
    </div>
    <div id="bulletinIdentity" class="carnet-student bulletin-identity" aria-live="polite"></div>
    <form id="bulletinForm">
      ${principal ? '<section id="ppPanel" class="pp-panel" aria-label="Bulletin PRONOTE et analyse"></section>' : '<div id="bulletinSummary" class="bulletin-summary"></div>'}
      <label for="bulletinRemark">${principal ? 'Appréciation générale' : 'Appréciation EPS'}</label>
      <textarea id="bulletinRemark" rows="5" maxlength="6000" ${locked ? 'readonly' : ''}></textarea>
      ${principal ? `<fieldset class="bulletin-mentions" ${locked ? 'disabled' : ''}><legend>Mentions</legend>
        ${BULLETIN_MENTIONS.map(([key, label]) =>
          `<label class="choice-line"><input type="checkbox" name="mention" value="${key}"> ${label}</label>`).join('')}
      </fieldset>
      <label for="bulletinMemo">Mémo pour le conseil</label>
      <textarea id="bulletinMemo" rows="4" maxlength="6000" ${locked ? 'readonly' : ''}></textarea>` : ''}
      <div class="actions">
        <button type="button" id="copyBulletin">Copier l’appréciation</button>
        ${principal ? '<button type="button" id="bulletinRead">Lire la fiche</button>' : ''}
        ${locked ? '' : '<button class="primary">Enregistrer</button>'}
      </div>
    </form>
    ${principal ? `<section id="bulletinReading" hidden>
      <h3>Appréciation générale</h3><p id="bulletinReadRemark"></p>
      <h3>Mentions</h3><p id="bulletinReadMentions"></p>
      <h3>Mémo pour le conseil</h3><p id="bulletinReadMemo"></p>
      <button id="bulletinEdit" type="button">${locked ? 'Retour à la fiche' : 'Modifier la fiche'}</button>
    </section>` : ''}
    <p id="bulletinStatus" class="muted" role="status"></p>
  </section>`;

  if (principal) $('conseilOpen').onclick = () => { commit(); PPConseil.setOn(true); renderBulletins(group, term, students, principal); };
  const picker = $('bulletinStudent');
  const prev = $('bulletinPrev');
  const next = $('bulletinNext');
  const form = $('bulletinForm');
  const remark = $('bulletinRemark');
  const memo = $('bulletinMemo');
  const status = $('bulletinStatus');
  const copy = $('copyBulletin');
  const checks = [...form.querySelectorAll('input[name="mention"]')];
  let index = 0;
  let reading = false;
  let current;
  let lastProposal = '';
  students.forEach((student, i) => picker.add(new Option(student.name, String(i))));

  function showReading(entry) {
    $('bulletinReadRemark').textContent = entry.conseil || 'Aucune appréciation saisie.';
    $('bulletinReadMentions').textContent = BULLETIN_MENTIONS.filter(([key]) => entry.mentions.includes(key))
      .map(([, label]) => label).join(' · ') || 'Aucune mention.';
    $('bulletinReadMemo').textContent = entry.memo || 'Aucun mémo.';
  }

  function load() {
    const student = students[index];
    current = bulletinEntry(group, term, student.id);
    picker.value = String(index);
    prev.disabled = index === 0;
    next.disabled = index === students.length - 1;
    $('bulletinIdentity').replaceChildren(RosterPortraits.photo(student.portrait), carnetStudentName(group, term, student));
    remark.value = current[principal ? 'conseil' : 'eps'];
    lastProposal = '';
    if (!principal) $('bulletinSummary').innerHTML = bulletinNotesSummary(group, term, student.id);
    copy.disabled = !remark.value.trim();
    if (principal) {
      memo.value = current.memo;
      for (const check of checks) check.checked = current.mentions.includes(check.value);
      PPPanel.resetVariant();
      PPPanel.render($('ppPanel'), {group, term, student, locked: carnetTermLocked(group, term),
        hasRemark: () => Boolean(remark.value.trim()),
        currentRemark: () => remark.value.trim(),
        onRemark(text) {
          // Pas de confirmation quand on reformule une proposition non retouchée.
          const own = remark.value.trim() && remark.value.trim() !== lastProposal;
          if (own && remark.value.trim() !== text && !confirm('Remplacer l’appréciation déjà écrite par la proposition ?')) return;
          lastProposal = text;
          remark.value = text;
          copy.disabled = !text.trim();
          commit();
          remark.focus();
        },
        onClearRemark() {
          if (remark.value.trim() && remark.value.trim() !== lastProposal && !confirm('Effacer l’appréciation générale de cet élève ?')) return;
          remark.value = '';
          lastProposal = '';
          copy.disabled = true;
          commit();
          status.textContent = 'Remarque effacée.';
        },
        onMention(key) {
          for (const check of checks) check.checked = check.value === key ? true : check.checked;
          commit();
          status.textContent = 'Mention cochée.';
        }});
      if (reading) showReading(current);
    }
    status.textContent = '';
  }

  function commit() {
    if (carnetTermLocked(group, term)) return true;
    if (!principal) {
      // L'appréciation EPS est celle du bilan du module Évaluations : un seul texte, visible aux deux endroits.
      if (remark.value === current.eps) return true;
      const studentId = students[index].id;
      if (!carnetCommit(group, 'classeur', ClasseurNotes.setRemark(group, term, studentId, remark.value), term)) {
        status.textContent = 'L’appréciation n’a pas été enregistrée. Tu peux encore copier le texte.';
        return false;
      }
      const old = group.bulletins?.[term]?.[studentId];
      if (old?.eps) {
        const termEntries = {...group.bulletins[term]};
        const {eps, ...rest} = old;
        if (rest.conseil || rest.memo || rest.mentions?.length) termEntries[studentId] = rest;
        else delete termEntries[studentId];
        carnetCommit(group, 'bulletins', {...group.bulletins, [term]: termEntries}, term);
      }
      current = {...current, eps: remark.value};
      status.textContent = 'Appréciation enregistrée (aussi dans le bilan des évaluations).';
      return true;
    }
    const entry = principal
      ? {...current, conseil: remark.value, memo: memo.value, mentions: checks.filter(check => check.checked).map(check => check.value)}
      : {...current, eps: remark.value};
    if (JSON.stringify(entry) === JSON.stringify(current)) return true;
    const studentId = students[index].id;
    const termEntries = {...group.bulletins?.[term]};
    if (entry.eps || entry.conseil || entry.memo || entry.mentions.length || entry.validated || entry.conseilNote) termEntries[studentId] = entry;
    else delete termEntries[studentId];
    if (!carnetCommit(group, 'bulletins', {...group.bulletins, [term]: termEntries}, term)) {
      status.textContent = 'La fiche n’a pas été enregistrée. Tu peux encore copier le texte.';
      return false;
    }
    current = entry;
    status.textContent = 'Fiche enregistrée sur cet appareil.';
    return true;
  }

  function move(target) {
    if (target < 0 || target >= students.length || !commit()) {
      picker.value = String(index);
      return;
    }
    index = target;
    load();
  }

  prev.onclick = () => move(index - 1);
  next.onclick = () => move(index + 1);
  picker.onchange = () => move(Number(picker.value));
  form.onchange = commit;
  form.onsubmit = event => {
    event.preventDefault();
    if (!locked && commit()) status.textContent = 'Fiche enregistrée sur cet appareil.';
  };
  remark.oninput = () => {
    copy.disabled = !remark.value.trim();
    const panel = $('ppPanel');
    if (panel) {
      const has = Boolean(remark.value.trim());
      const button = panel.querySelector('.pp-remark');
      if (button) button.textContent = has ? 'Reformuler la remarque' : 'Proposer une remarque';
      const clear = panel.querySelector('.pp-remark-clear');
      if (clear) clear.hidden = !has;
    }
  };
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(remark.value);
      status.textContent = 'Appréciation copiée.';
    } catch {
      remark.focus();
      remark.select();
      status.textContent = 'Texte sélectionné. Utilise la commande Copier.';
    }
  };
  if (principal) {
    const readPanel = $('bulletinReading');
    $('bulletinRead').onclick = () => {
      if (!commit()) return;
      reading = true;
      showReading(current);
      form.hidden = true;
      readPanel.hidden = false;
      $('bulletinEdit').focus();
    };
    $('bulletinEdit').onclick = () => {
      reading = false;
      readPanel.hidden = true;
      form.hidden = false;
      remark.focus();
    };
  }
  load();
}
