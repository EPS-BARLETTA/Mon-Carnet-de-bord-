'use strict';

// Mode conseil de classe (prof principal) : un trombinoscope avec, pour chaque élève, uniquement ce qui sert au conseil :
// moyenne générale et de la classe, bilan, points forts et à travailler, appréciation générale, mentions, et une case « validé ».
const PPConseil = (() => {
  const MODE_KEY = 'mon-carnet-eps-mode-conseil';
  const previousTerm = term => String(Number(term) - 1);
  const ppStore = (group, term) => group.ppBulletins?.[term] || {};

  const isOn = () => { try { return sessionStorage.getItem(MODE_KEY) === '1'; } catch { return false; } };
  const setOn = on => { try { on ? sessionStorage.setItem(MODE_KEY, '1') : sessionStorage.removeItem(MODE_KEY); } catch {} };

  function info(group, term, student) {
    const bulletin = ppStore(group, term)[student.id] || null;
    const entry = bulletinEntry(group, term, student.id);
    if (!bulletin) return {entry, bulletin: null};
    const result = PPAnalyse.analyse(bulletin, ppStore(group, previousTerm(term))[student.id] || null);
    const ia = bulletin.ia || null;
    return {entry, bulletin, result,
      forts: ia?.points_forts || result.forts, faibles: ia?.points_faibles || result.faibles};
  }

  // Modifie la fiche de l'élève (appréciation, mentions, validation, note libre) sans quitter le mode conseil.
  function saveEntry(group, term, studentId, change) {
    const termEntries = {...group.bulletins?.[term]};
    const entry = {...bulletinEntry(group, term, studentId)};
    change(entry);
    if (!entry.validated) delete entry.validated;
    if (!entry.conseilNote?.trim()) delete entry.conseilNote;
    if (entry.eps || entry.conseil || entry.memo || entry.mentions.length || entry.validated || entry.conseilNote) termEntries[studentId] = entry;
    else delete termEntries[studentId];
    return carnetCommit(group, 'bulletins', {...group.bulletins, [term]: termEntries}, term);
  }
  const setValidated = (group, term, studentId, value) => saveEntry(group, term, studentId, entry => { entry.validated = value; });

  // Appui long (≈ 0,6 s) sur un élément ; un appui court ne déclenche rien.
  function onLongPress(element, action) {
    let timer;
    let start;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      start = [event.clientX, event.clientY];
      cancel();
      timer = setTimeout(() => { cancel(); if (navigator.vibrate) navigator.vibrate(15); action(); }, 600);
    });
    element.addEventListener('pointermove', event => {
      if (timer && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 10) cancel();
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => element.addEventListener(type, cancel));
    element.addEventListener('contextmenu', event => event.preventDefault());
  }

  const mentionsText = entry => BULLETIN_MENTIONS.filter(([key]) => entry.mentions.includes(key)).map(([, label]) => label).join(' · ');
  const list = items => items?.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p class="muted">—</p>';

  function render(panel, group, term, students, onExit) {
    const locked = carnetTermLocked(group, term);
    const done = students.filter(student => bulletinEntry(group, term, student.id).validated).length;
    panel.innerHTML = `<section class="card conseil">
      <div class="conseil-head">
        <div><h2>Conseil de classe · trimestre ${esc(term)}</h2>
          <p class="muted"><strong>${done} / ${students.length}</strong> élève${students.length > 1 ? 's' : ''} validé${done > 1 ? 's' : ''}</p></div>
        <button type="button" id="conseilExit" class="conseil-quit">✕ Quitter le mode conseil</button>
      </div>
      <div class="conseil-progress" aria-hidden="true"><span style="width:${students.length ? Math.round(done / students.length * 100) : 0}%"></span></div>
      <ul class="conseil-grid">${students.map((student, i) => {
        const {entry, result} = info(group, term, student);
        return `<li><button type="button" class="conseil-card${entry.validated ? ' is-valid' : ''}" data-conseil="${i}">
          <span class="conseil-photo" data-photo="${i}"></span>
          <strong>${esc(student.name)}</strong>
          <span class="conseil-mini">${result ? `${PPAnalyse.format(result.average)} · ${PPAnalyse.LEVELS[result.level]}` : '<span class="muted">pas de bulletin</span>'}</span>
          ${entry.validated ? '<span class="conseil-check" aria-label="Validé">✓</span>' : ''}
        </button></li>`;
      }).join('')}</ul>
      ${locked ? '<p class="muted">Trimestre verrouillé : lecture seule.</p>' : ''}
    </section>`;
    panel.querySelectorAll('[data-photo]').forEach(slot => slot.replaceWith(RosterPortraits.photo(students[Number(slot.dataset.photo)].portrait)));
    panel.querySelector('#conseilExit').onclick = () => { setOn(false); onExit(); };
    panel.querySelectorAll('[data-conseil]').forEach(card => card.onclick = () => fiche(panel, group, term, students, Number(card.dataset.conseil), onExit));
    window.scrollTo({top: panel.getBoundingClientRect().top + window.scrollY - 12});
  }

  const MENTION_TONE = {felicitations: 'gold', encouragements: 'green', travail: 'red', conduite: 'red', 'mise-en-garde': 'orange'};
  const LEVEL_TONE = {excellent: 'green', tresbon: 'green', satisfaisant: 'blue', mitige: 'orange', fragile: 'red'};

  function fiche(panel, group, term, students, index, onExit) {
    const student = students[index];
    const next = students[index + 1];
    const locked = carnetTermLocked(group, term);
    const {entry, result, forts, faibles} = info(group, term, student);
    const gap = result && result.average !== null && result.classAverage !== null ? Math.round((result.average - result.classAverage) * 100) / 100 : null;
    const mentions = BULLETIN_MENTIONS.filter(([key]) => entry.mentions.includes(key));
    panel.innerHTML = `<section class="card conseil-fiche${entry.validated ? ' is-valid' : ''}">
      <div class="conseil-head">
        <button type="button" id="conseilBack">← Trombinoscope</button>
        <span class="muted">${index + 1} sur ${students.length}</span>
        <button type="button" id="conseilQuit" class="conseil-quit">✕ Quitter le mode conseil</button>
      </div>
      <div class="cbox cbox-identity">
        <span id="conseilPhoto"></span>
        <div><h2>${esc(student.name)}</h2>
          ${result ? `<span class="cbadge tone-${LEVEL_TONE[result.level] || 'blue'}">Bilan · ${PPAnalyse.LEVELS[result.level]}</span>` : '<span class="cbadge tone-grey">Pas de bulletin importé</span>'}
          ${entry.validated ? '<span class="cbadge tone-valid">✓ Validé</span>' : ''}</div>
      </div>
      ${result ? `<div class="conseil-figures">
          <div class="cbox cbox-figure tone-${gap === null ? 'blue' : gap >= 0 ? 'green' : 'orange'}"><span>Moyenne générale</span><strong>${PPAnalyse.format(result.average)}</strong></div>
          <div class="cbox cbox-figure tone-grey"><span>Moyenne de la classe</span><strong>${PPAnalyse.format(result.classAverage)}</strong></div>
          <div class="cbox cbox-figure tone-${gap === null ? 'grey' : gap >= 0 ? 'green' : 'orange'}"><span>Écart à la classe</span><strong>${gap === null ? '–' : (gap > 0 ? '+' : '') + PPAnalyse.format(gap)}</strong></div>
        </div>
        <div class="conseil-points">
          <div class="cbox cbox-list tone-green"><h3>Points forts</h3>${list(forts)}</div>
          <div class="cbox cbox-list tone-orange"><h3>Points à travailler</h3>${list(faibles)}</div>
        </div>` : ''}
      <div class="cbox cbox-text tone-blue" id="conseilRemarkBox"><h3>Appréciation générale <small class="muted">· appui long pour modifier</small></h3>
        <p class="conseil-text">${entry.conseil ? esc(entry.conseil) : '<span class="muted">Aucune appréciation saisie.</span>'}</p></div>
      <div class="cbox cbox-mention"><h3>Mention <small class="muted">· appui long sur une mention pour la retirer</small></h3>
        <div class="conseil-mentions">${mentions.map(([key, label]) => `<span class="cbadge big tone-${MENTION_TONE[key]}" data-mention="${key}">${esc(label)}</span>`).join(' ') || '<span class="muted">Aucune mention.</span>'}
          ${!locked && mentions.length < BULLETIN_MENTIONS.length ? '<button type="button" class="conseil-add" id="conseilAddMention">+ Ajouter</button>' : ''}</div>
        <div class="conseil-choices" id="conseilMentionChoices" hidden>${BULLETIN_MENTIONS.filter(([key]) => !entry.mentions.includes(key)).map(([key, label]) => `<button type="button" class="cbadge big tone-${MENTION_TONE[key]}" data-add-mention="${key}">${esc(label)}</button>`).join('')}</div></div>
      <div class="conseil-bottom">
        <label class="conseil-validate"><input type="checkbox" id="conseilValid" ${entry.validated ? 'checked' : ''} ${locked ? 'disabled' : ''}> Validé au conseil</label>
        <label class="conseil-note"><span>Note du conseil</span><textarea id="conseilNote" rows="2" maxlength="1000" placeholder="À retenir pour cet élève…" ${locked ? 'disabled' : ''}>${esc(entry.conseilNote || '')}</textarea></label>
      </div>
      <div class="conseil-actions">
        ${next ? `<button type="button" class="primary" id="conseilNext">${esc(next.name)} →</button>` : '<button type="button" class="primary" id="conseilEnd">Fin de la liste · trombinoscope</button>'}
      </div>
      <p class="muted" id="conseilStatus" role="status"></p>
    </section>`;
    panel.querySelector('#conseilPhoto').replaceWith(RosterPortraits.photo(student.portrait));
    panel.querySelector('#conseilBack').onclick = () => render(panel, group, term, students, onExit);
    panel.querySelector('#conseilQuit').onclick = () => { setOn(false); onExit(); };
    const status = text => { panel.querySelector('#conseilStatus').textContent = text; };
    const reload = () => fiche(panel, group, term, students, index, onExit);
    if (!locked) {
      // Appréciation générale : appui long pour la modifier sur place.
      const box = panel.querySelector('#conseilRemarkBox');
      onLongPress(box, () => {
        if (box.querySelector('textarea')) return;
        box.innerHTML = `<h3>Appréciation générale</h3><textarea class="conseil-edit" rows="4" maxlength="1500">${esc(entry.conseil)}</textarea>
          <div class="row"><button type="button" class="primary" data-save>Enregistrer</button><button type="button" data-cancel>Annuler</button></div>`;
        const area = box.querySelector('textarea');
        area.focus();
        box.querySelector('[data-cancel]').onclick = reload;
        box.querySelector('[data-save]').onclick = () => {
          if (!saveEntry(group, term, student.id, item => { item.conseil = area.value.trim().slice(0, 1500); })) return status('Enregistrement impossible.');
          reload();
        };
      });
      // Mentions : appui long pour retirer, « + Ajouter » pour en mettre une.
      panel.querySelectorAll('[data-mention]').forEach(badge => onLongPress(badge, () => {
        const label = badge.textContent;
        if (!confirm(`Retirer la mention « ${label} » ?`)) return;
        if (!saveEntry(group, term, student.id, item => { item.mentions = item.mentions.filter(key => key !== badge.dataset.mention); })) return status('Enregistrement impossible.');
        reload();
      }));
      const add = panel.querySelector('#conseilAddMention');
      if (add) add.onclick = () => { const box = panel.querySelector('#conseilMentionChoices'); box.hidden = !box.hidden; };
      panel.querySelectorAll('[data-add-mention]').forEach(button => button.onclick = () => {
        if (!saveEntry(group, term, student.id, item => { item.mentions = BULLETIN_MENTIONS.map(([key]) => key).filter(key => item.mentions.includes(key) || key === button.dataset.addMention); })) return status('Enregistrement impossible.');
        reload();
      });
      // Note libre du conseil : enregistrée en tapant.
      let noteTimer;
      const note = panel.querySelector('#conseilNote');
      const saveNote = () => { clearTimeout(noteTimer); saveEntry(group, term, student.id, item => { item.conseilNote = note.value.slice(0, 1000); }); };
      note.oninput = () => { clearTimeout(noteTimer); noteTimer = setTimeout(saveNote, 500); };
      note.onblur = saveNote;
    }
    panel.querySelector('#conseilValid').onchange = event => {
      if (!setValidated(group, term, student.id, event.target.checked)) {
        event.target.checked = !event.target.checked;
        panel.querySelector('#conseilStatus').textContent = 'Enregistrement impossible.';
        return;
      }
      panel.querySelector('.conseil-fiche').classList.toggle('is-valid', event.target.checked);
      const badge = panel.querySelector('.cbox-identity .tone-valid');
      if (event.target.checked && !badge) panel.querySelector('.cbox-identity div').insertAdjacentHTML('beforeend', '<span class="cbadge tone-valid">✓ Validé</span>');
      if (!event.target.checked && badge) badge.remove();
    };
    const go = () => next ? fiche(panel, group, term, students, index + 1, onExit) : render(panel, group, term, students, onExit);
    (panel.querySelector('#conseilNext') || panel.querySelector('#conseilEnd')).onclick = go;
    window.scrollTo({top: panel.getBoundingClientRect().top + window.scrollY - 12});
  }

  return {render, isOn, setOn};
})();
