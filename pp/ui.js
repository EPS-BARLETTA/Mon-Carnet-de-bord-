'use strict';

// Espace professeur principal : import des bulletins PRONOTE, analyse et proposition de remarque.
// Les bulletins sont rangés dans la classe : group.ppBulletins[trimestre][idÉlève] (sauvegardés et chiffrés avec le carnet).
const PPPanel = (() => {
  const MENTIONS = {felicitations: 'Félicitations', encouragements: 'Encouragements'};
  let variant = 0;

  const store = (group, term) => group.ppBulletins?.[term] || {};
  const previousTerm = term => String(Number(term) - 1);

  function marked(parts) {
    return parts.map(part => {
      if (part.tone === 'pos') return `<mark class="pp-pos">${esc(part.text)}</mark>`;
      if (part.tone === 'neg') return `<mark class="pp-neg">${esc(part.text)}</mark>`;
      if (part.tone === 'fix') return `<span class="pp-fix"><u>${esc(part.text)}</u> <span class="pp-corr">(${esc(part.fix)})</span></span>`;
      return esc(part.text);
    }).join('');
  }

  // Surlignage proposé par l'IA : extraits exacts repérés dans le texte.
  function aiParts(text, info) {
    const marks = [];
    const add = (needle, tone, fix) => {
      if (!needle || typeof needle !== 'string') return;
      const at = text.indexOf(needle);
      if (at >= 0) marks.push({start: at, end: at + needle.length, tone, fix});
    };
    for (const item of info?.corrections || []) add(item.erreur, 'fix', item.correction);
    for (const item of info?.negatif || []) add(item, 'neg');
    for (const item of info?.positif || []) add(item, 'pos');
    const kept = [];
    for (const mark of marks) if (!kept.some(other => mark.start < other.end && other.start < mark.end)) kept.push(mark);
    kept.sort((a, b) => a.start - b.start);
    const parts = [];
    let cursor = 0;
    for (const mark of kept) {
      if (mark.start > cursor) parts.push({text: text.slice(cursor, mark.start), tone: ''});
      parts.push({text: text.slice(mark.start, mark.end), tone: mark.tone, fix: mark.fix});
      cursor = mark.end;
    }
    if (cursor < text.length) parts.push({text: text.slice(cursor), tone: ''});
    return parts;
  }

  function noteClass(subject) {
    if (subject.note === null) return '';
    if (subject.level === 'fort') return 'pp-good';
    if (subject.level === 'faible') return 'pp-bad';
    return '';
  }

  function render(container, context, message = '') {
    const {group, term, student, locked} = context;
    const bulletin = store(group, term)[student.id];
    const previous = store(group, previousTerm(term))[student.id] || null;
    const count = Object.keys(store(group, term)).length;
    let html = `<div class="pp-head"><h3>Bulletin PRONOTE</h3><div class="actions">
      ${locked ? '' : `<button type="button" class="pp-import">Importer des bulletins (PDF)</button>`}
      ${bulletin && !locked ? `<button type="button" class="pp-ia">${bulletin.ia ? 'Relancer l’analyse IA' : 'Analyse approfondie (IA)'}</button>` : ''}
      </div><input type="file" class="pp-file" accept="application/pdf,.pdf" multiple hidden></div>
      <p class="muted pp-status" role="status">${message ? esc(message) : count ? `${count} bulletin${count > 1 ? 's' : ''} importé${count > 1 ? 's' : ''} pour ce trimestre.` : 'Importe le PDF des bulletins de la classe (ou d’un élève) exporté depuis PRONOTE. Il est lu dans l’appareil.'}</p>`;
    if (!bulletin) {
      container.innerHTML = html + examplesBlock(context);
      bind(container, context, null, null);
      return;
    }
    const result = PPAnalyse.analyse(bulletin, previous);
    const ia = bulletin.ia || null;
    const iaFor = name => ia?.matieres?.find(item => item.matiere === name);
    html += `<p class="pp-summary"><strong>Moyenne ${PPAnalyse.format(result.average)}</strong> (classe ${PPAnalyse.format(result.classAverage)})
      · Bilan <strong>${PPAnalyse.LEVELS[result.level]}</strong>
      ${result.trend !== null ? `· <span class="${result.trend >= 0 ? 'pp-good' : 'pp-bad'}">${result.trend >= 0 ? '+' : ''}${PPAnalyse.format(result.trend)} depuis le T${previousTerm(term)}</span>` : ''}
      ${bulletin.life?.text ? `<br><span class="muted">${esc(bulletin.life.text)}</span>` : ''}</p>
      <div class="pp-table-wrap"><table class="pp-table"><thead><tr><th>Matière</th><th>Élève</th><th>Classe</th><th>Appréciation</th></tr></thead><tbody>
      ${result.subjects.map(subject => {
        const info = iaFor(subject.name);
        const show = text => marked(ia ? aiParts(text, info) : PPAnalyse.highlight(text));
        const rows = [`<tr><th scope="row">${esc(subject.label)}${subject.delta !== null && subject.delta !== undefined ? `<small class="${subject.delta >= 0 ? 'pp-good' : 'pp-bad'}">${subject.delta >= 0 ? '+' : ''}${PPAnalyse.format(subject.delta)}</small>` : ''}</th>
          <td class="${noteClass(subject)}">${PPAnalyse.format(subject.note)}</td><td>${PPAnalyse.format(subject.classAverage)}</td><td>${show(subject.appreciation || '')}</td></tr>`];
        for (const teacher of subject.teachers || []) {
          rows.push(`<tr class="pp-sub"><th scope="row"></th><td>${PPAnalyse.format(teacher.note)}</td><td>${PPAnalyse.format(teacher.classAverage)}</td><td>${show(teacher.appreciation || '')}</td></tr>`);
        }
        return rows.join('');
      }).join('')}</tbody></table></div>
      <p class="muted pp-legend"><mark class="pp-pos">positif</mark> <mark class="pp-neg">négatif</mark> <span class="pp-fix"><u>faute</u> <span class="pp-corr">(correction)</span></span>
        ${ia ? ` · Analyse IA du ${esc(new Date(ia.date).toLocaleDateString('fr-FR'))}` : ' · Analyse faite dans l’appareil'}</p>
      <div class="pp-synthesis">
        <div><h4>Points forts</h4><ul>${(ia?.points_forts || result.forts).map(item => `<li>${esc(item)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>
        <div><h4>Points à travailler</h4><ul>${(ia?.points_faibles || result.faibles).map(item => `<li>${esc(item)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>
      </div>
      ${locked ? '' : `<div class="pp-propose">
        <div class="actions">
          <button type="button" class="primary pp-remark">Proposer une remarque</button>
          ${ia?.remarque ? '<button type="button" class="pp-remark-ia">Remarque de l’IA</button>' : ''}
        </div>
        ${suggestion(ia?.mention && ia.mention !== 'aucune' ? ia.mention : result.mention, ia?.justification)}
      </div>`}`;
    container.innerHTML = html + examplesBlock(context);
    bind(container, context, result, bulletin);
  }

  function suggestion(mention, why) {
    if (!MENTIONS[mention]) return '<p class="muted">Mention suggérée : aucune.</p>';
    return `<p class="pp-mention">Mention suggérée : <strong>${MENTIONS[mention]}</strong>${why ? ` <span class="muted">— ${esc(why)}</span>` : ''}
      <button type="button" class="pp-check" data-mention="${mention}">Cocher</button></p>`;
  }

  function examplesBlock(context) {
    if (context.locked) return '';
    const examples = carnetModules.pp?.examples || '';
    return `<details class="pp-examples"><summary>Mes exemples de remarques (pour l’analyse IA)</summary>
      <p class="muted">Colle quelques remarques que tu as écrites, <strong>sans les prénoms</strong> : l’IA s’en inspire pour le ton et la structure. Elles restent dans ton carnet chiffré et ne sont envoyées qu’avec une analyse IA.</p>
      <textarea class="pp-examples-text" rows="6" maxlength="20000">${esc(examples)}</textarea>
      <button type="button" class="pp-examples-save">Enregistrer les exemples</button></details>`;
  }

  function bind(container, context, result, bulletin) {
    const {group, term, student} = context;
    const status = container.querySelector('.pp-status');
    container.querySelector('.pp-import')?.addEventListener('click', () => container.querySelector('.pp-file').click());
    container.querySelector('.pp-file')?.addEventListener('change', async event => {
      const files = [...event.target.files];
      event.target.value = '';
      if (!files.length) return;
      status.textContent = 'Lecture des bulletins…';
      try {
        const found = [];
        for (const file of files) found.push(...await PronoteBulletin.readPdf(await file.arrayBuffer()));
        if (!found.length) throw Error('Aucun bulletin reconnu dans ce PDF.');
        render(container, context, importBulletins(context, found));
      } catch (error) {
        status.textContent = error.message || 'Lecture impossible.';
      }
    });
    container.querySelector('.pp-remark')?.addEventListener('click', () => {
      context.onRemark(PPAnalyse.remark(result, student.name, variant++));
    });
    container.querySelector('.pp-remark-ia')?.addEventListener('click', () => {
      context.onRemark(String(bulletin.ia.remarque).replaceAll('[Prénom]', PPAnalyse.firstName(student.name)));
    });
    container.querySelector('.pp-check')?.addEventListener('click', event => context.onMention(event.target.dataset.mention));
    container.querySelector('.pp-ia')?.addEventListener('click', async event => {
      const button = event.target;
      button.disabled = true;
      status.textContent = 'Analyse en cours (données anonymisées)…';
      try {
        const answer = await PPIA.analyse(bulletin, store(group, previousTerm(term))[student.id] || null, student.name);
        saveBulletin(context, student.id, {...bulletin, ia: {...answer, date: new Date().toISOString()}});
        render(container, context);
      } catch (error) {
        status.textContent = error.message || 'L’analyse n’a pas abouti.';
        button.disabled = false;
      }
    });
    container.querySelector('.pp-examples-save')?.addEventListener('click', () => {
      const text = container.querySelector('.pp-examples-text').value.trim();
      carnetModules = {...carnetModules, pp: {...(carnetModules.pp || {}), examples: text}};
      CarnetStore.set('modules', JSON.stringify(carnetModules));
      if (typeof markCarnetChanged === 'function') markCarnetChanged();
      notify('Exemples enregistrés.');
    });
  }

  function saveBulletin(context, studentId, bulletin, term = context.term) {
    const {group} = context;
    const all = {...(group.ppBulletins || {})};
    all[term] = {...(all[term] || {}), [studentId]: bulletin};
    if (!carnetCommit(group, 'ppBulletins', all, term)) throw Error('Enregistrement impossible.');
    CarnetStore.flush().catch(() => {});
  }

  // Associe chaque bulletin lu à un élève de la classe, par son nom.
  function importBulletins(context, found) {
    const {group, term, student} = context;
    const everyone = [...group.students, ...(group.withdrawnStudents || [])];
    const all = {...(group.ppBulletins || {})};
    const missing = [];
    let done = 0;
    const otherTerms = new Set();
    for (const bulletin of found) {
      let match = bulletin.name ? ClasseurImport.findStudent(everyone, bulletin.name) : null;
      if (!match && found.length === 1 && confirm(`Le nom du bulletin (« ${bulletin.name || 'illisible'} ») ne correspond à aucun élève. L’associer à ${student.name} ?`)) match = student;
      if (!match) {
        missing.push(bulletin.name || 'nom illisible');
        continue;
      }
      const target = bulletin.term || term;
      if (target !== term) otherTerms.add(target);
      all[target] = {...(all[target] || {}), [match.id]: {term: target, subjects: bulletin.subjects, life: bulletin.life, importedAt: new Date().toISOString()}};
      done++;
    }
    if (done && !carnetCommit(group, 'ppBulletins', all, term)) throw Error('Enregistrement impossible.');
    CarnetStore.flush().catch(() => {});
    const parts = [`${done} bulletin${done > 1 ? 's' : ''} importé${done > 1 ? 's' : ''}.`];
    if (otherTerms.size) parts.push(`Rangé${done > 1 ? 's' : ''} dans le trimestre ${[...otherTerms].join(', ')} indiqué sur le bulletin.`);
    if (missing.length) parts.push(`Non associé${missing.length > 1 ? 's' : ''} : ${missing.join(', ')}.`);
    return parts.join(' ');
  }

  return {render, resetVariant() { variant = 0; }};
})();

// Analyse approfondie : le bulletin est anonymisé dans l'appareil avant l'envoi.
const PPIA = (() => {
  const strip = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function anonymizer(name) {
    const words = String(name || '').split(/[\s-]+/).filter(word => word.length >= 2);
    const first = PPAnalyse.firstName(name).split(/[\s-]+/).filter(Boolean);
    const patterns = words.map(word => ({
      regex: new RegExp(`(?<![\\p{L}])${escapeRegex(word)}(?![\\p{L}])`, 'giu'),
      plain: new RegExp(`(?<![\\p{L}])${escapeRegex(strip(word))}(?![\\p{L}])`, 'giu'),
      replacement: first.some(part => strip(part).toLowerCase() === strip(word).toLowerCase()) ? '[Prénom]' : '[Nom]',
    }));
    return text => {
      let output = String(text || '');
      for (const item of patterns) output = output.replace(item.regex, item.replacement).replace(item.plain, item.replacement);
      return output;
    };
  }

  // Prépare les exemples : retire les lignes d'en-tête (« Prénom 15,5 notes… ») et remplace ces prénoms partout.
  function cleanExamples(text) {
    const lines = String(text || '').split('\n');
    const header = /^([\p{Lu}][\p{L}'’]+(?:-[\p{Lu}][\p{L}'’]+)?)\s*(?::|\d|$|\()/u;
    const names = new Set();
    const kept = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const match = header.exec(trimmed);
      const sentence = /[.!?…]$/.test(trimmed) && trimmed.split(/\s+/).length > 5;
      if (match && !sentence) {
        if (!/^(Le|La|Les|Un|Une|Des|Nous|Vous|Il|Elle|Bilan|Conseil|Classe|Trimestre|FÉLICITATIONS|ENCOURAGEMENTS)$/i.test(match[1])) names.add(match[1]);
        continue;
      }
      if (/^\(.*\)$/.test(trimmed)) continue;
      kept.push(line);
    }
    let output = kept.join('\n');
    for (const name of names) output = output.replace(new RegExp(`(?<![\\p{L}])${escapeRegex(name)}(?![\\p{L}])`, 'gu'), '[Prénom]');
    return output.replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
  }

  function payload(bulletin, previous, name) {
    const hide = anonymizer(name);
    return {
      matieres: bulletin.subjects.map(subject => ({
        matiere: subject.name,
        moyenne_eleve: subject.note,
        moyenne_classe: subject.classAverage,
        appreciation: hide(subject.appreciation),
        enseignants_multiples: (subject.teachers || []).map(teacher => ({moyenne_eleve: teacher.note, moyenne_classe: teacher.classAverage, appreciation: hide(teacher.appreciation)})),
      })),
      vie_scolaire: bulletin.life ? {demi_journees_absence: bulletin.life.halfDays, non_justifiees: bulletin.life.unjustified, retards: bulletin.life.late} : null,
      trimestre_precedent: previous ? previous.subjects.map(subject => ({matiere: subject.name, moyenne_eleve: subject.note})) : null,
      exemples_du_professeur: cleanExamples(carnetModules.pp?.examples || '') || null,
    };
  }

  async function analyse(bulletin, previous, name) {
    let key = null;
    try { key = localStorage.getItem('mon-carnet-eps-cle-cloud'); } catch {}
    if (!key) {
      if (typeof askPhrase === 'function' && await askPhrase()) {
        try { key = localStorage.getItem('mon-carnet-eps-cle-cloud'); } catch {}
      }
      if (!key) throw Error('Saisis d’abord ta phrase secrète (page Sauvegarde) pour utiliser l’analyse IA.');
    }
    let response;
    try {
      response = await fetch('./api/analyse', {
        method: 'POST',
        cache: 'no-store',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
        body: JSON.stringify(payload(bulletin, previous, name)),
      });
    } catch {
      throw Error('Connexion impossible. Vérifie le réseau.');
    }
    const json = (response.headers.get('content-type') || '').includes('application/json');
    if (!json) throw Error('L’analyse IA n’existe que sur la version Vercel du carnet.');
    const body = await response.json();
    if (!response.ok) throw Error(body.message || 'L’analyse n’a pas abouti.');
    return body;
  }

  return {analyse, payload, anonymizer};
})();
