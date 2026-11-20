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
      ${bulletin ? '<button type="button" class="pp-copy-ia">Copier pour une IA (anonymisé)</button>' : ''}
      ${bulletin && !locked ? '<button type="button" class="pp-paste-ia">Coller la réponse de l’IA</button>' : ''}
      ${bulletin && !locked ? '<button type="button" class="danger pp-remove">Retirer ce bulletin</button>' : ''}
      ${count > 1 && !locked ? '<button type="button" class="danger pp-remove-all">Retirer tous les bulletins du trimestre</button>' : ''}
      </div><input type="file" class="pp-file" accept="application/pdf,.pdf" multiple hidden></div>
      <p class="muted pp-status" role="status">${message ? esc(message) : count ? `${count} bulletin${count > 1 ? 's' : ''} importé${count > 1 ? 's' : ''} pour ce trimestre.` : 'Importe le PDF des bulletins de la classe (ou d’un élève) exporté depuis PRONOTE. Il est lu dans l’appareil.'}</p>`;
    if (!bulletin) {
      container.innerHTML = html;
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
        ${ia ? ` · Analyse IA du ${esc(new Date(ia.date).toLocaleDateString('fr-FR'))} <button type="button" class="link-button pp-ia-clear">Revenir à l’analyse de l’appareil</button>` : ' · Analyse faite dans l’appareil'}</p>
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
    container.innerHTML = html;
    bind(container, context, result, bulletin);
  }

  function suggestion(mention, why) {
    if (!MENTIONS[mention]) return '<p class="muted">Mention suggérée : aucune.</p>';
    return `<p class="pp-mention">Mention suggérée : <strong>${MENTIONS[mention]}</strong>${why ? ` <span class="muted">— ${esc(why)}</span>` : ''}
      <button type="button" class="pp-check" data-mention="${mention}">Cocher</button></p>`;
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
    container.querySelector('.pp-ia-clear')?.addEventListener('click', () => {
      const {ia, ...rest} = bulletin;
      saveBulletin(context, student.id, rest);
      render(container, context);
    });
    container.querySelector('.pp-remove')?.addEventListener('click', () => {
      if (!confirm(`Retirer le bulletin importé de ${student.name} pour ce trimestre ? Son appréciation générale et sa mention ne sont pas touchées.`)) return;
      const all = {...(group.ppBulletins || {})};
      const termBulletins = {...(all[term] || {})};
      delete termBulletins[student.id];
      all[term] = termBulletins;
      if (!carnetCommit(group, 'ppBulletins', all, term)) return;
      CarnetStore.flush().catch(() => {});
      render(container, context, 'Bulletin retiré.');
    });
    container.querySelector('.pp-remove-all')?.addEventListener('click', () => {
      const total = Object.keys(store(group, term)).length;
      if (!confirm(`Retirer les ${total} bulletins importés de ce trimestre ? Les appréciations et mentions ne sont pas touchées.`)) return;
      const all = {...(group.ppBulletins || {})};
      delete all[term];
      if (!carnetCommit(group, 'ppBulletins', all, term)) return;
      CarnetStore.flush().catch(() => {});
      render(container, context, 'Bulletins du trimestre retirés.');
    });
    container.querySelector('.pp-check')?.addEventListener('click', event => context.onMention(event.target.dataset.mention));
    container.querySelector('.pp-copy-ia')?.addEventListener('click', async () => {
      const text = PPIA.prompt(bulletin, store(group, previousTerm(term))[student.id] || null, student.name);
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = 'Bulletin anonymisé copié, avec les consignes. Colle-le dans ton IA, puis recolle sa réponse ici.';
      } catch {
        status.textContent = 'Copie impossible sur cet appareil.';
      }
    });
    container.querySelector('.pp-paste-ia')?.addEventListener('click', () => {
      PPIA.askAnswer(answer => {
        saveBulletin(context, student.id, {...bulletin, ia: {...answer, date: new Date().toISOString()}});
        render(container, context, 'Réponse de l’IA enregistrée.');
      });
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

// Analyse par une IA de ton choix : le bulletin est anonymisé dans l'appareil, copié avec les consignes,
// puis la réponse de l'IA est recollée dans le carnet. Rien n'est envoyé automatiquement.
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
    };
  }

  const INSTRUCTIONS = `Tu aides un professeur principal de collège ou lycée français à préparer le conseil de classe.
On te donne le bulletin ANONYMISÉ d'un élève (désigné par [Prénom]) : pour chaque matière, la moyenne de l'élève, celle de la classe et l'appréciation de l'enseignant ; la vie scolaire ; parfois les moyennes du trimestre précédent.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la forme :
{
  "matieres": [{"matiere": "nom exact donné", "positif": ["extrait"], "negatif": ["extrait"], "corrections": [{"erreur": "extrait", "correction": "texte corrigé"}]}],
  "points_forts": ["phrase courte"],
  "points_faibles": ["phrase courte"],
  "remarque": "proposition de remarque de professeur principal",
  "mention": "felicitations" | "encouragements" | "aucune",
  "justification": "une phrase qui explique la mention proposée"
}

Règles :
- « positif » et « negatif » : courts extraits (2 à 8 mots) recopiés EXACTEMENT, caractère pour caractère, depuis l'appréciation de la matière ; positif = qualité, réussite, progrès ; negatif = difficulté, manque, attitude à corriger.
- « corrections » : uniquement les vraies fautes d'orthographe, de grammaire ou d'accord dans les appréciations ; « erreur » est recopiée EXACTEMENT (quelques mots autour de la faute) ; « correction » est la même portion corrigée. N'invente pas de faute, ne corrige pas le style.
- Points forts et faibles : synthèse de l'ensemble du bulletin (matières, attitude, travail, vie scolaire, évolution), 2 à 5 éléments chacun, sans répéter les notes.
- Remarque : 300 à 600 caractères, en français soigné, au ton bienveillant et exigeant d'un conseil de classe : une première phrase de bilan d'ensemble (« Un excellent trimestre… », « Le bilan reste mitigé… »), l'évolution par rapport au trimestre précédent si elle est connue, les qualités soulignées par les enseignants, les points à travailler en nommant précisément les matières, puis un encouragement final (« Vous en êtes largement capable. », « Poursuivez ainsi. »). Vouvoie l'élève ou parle de lui à la troisième personne. Utilise [Prénom] pour désigner l'élève. Ne cite aucun enseignant. N'invente aucune information absente du bulletin. N'écris pas la mention dans la remarque.
- Mention : félicitations pour un excellent bilan sans réserve ; encouragements pour un bilan satisfaisant porté par les efforts ou les progrès ; sinon aucune.`;

  // Texte prêt à coller dans une IA : consignes + bulletin anonymisé (aucun nom).
  function prompt(bulletin, previous, name) {
    return `${INSTRUCTIONS}\n\nVoici le bulletin anonymisé (format JSON) :\n${JSON.stringify(payload(bulletin, previous, name), null, 1)}`;
  }

  function extract(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw Error('Je ne trouve pas de réponse au format attendu. Colle toute la réponse de l’IA.');
    const data = JSON.parse(text.slice(start, end + 1));
    if (!data || typeof data !== 'object' || (!Array.isArray(data.matieres) && !data.remarque)) throw Error('La réponse ne correspond pas au format demandé.');
    const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 12) : [];
    return {
      matieres: (Array.isArray(data.matieres) ? data.matieres : []).filter(item => item && typeof item.matiere === 'string').map(item => ({
        matiere: item.matiere, positif: list(item.positif), negatif: list(item.negatif),
        corrections: (Array.isArray(item.corrections) ? item.corrections : []).filter(fix => fix && typeof fix.erreur === 'string' && typeof fix.correction === 'string').slice(0, 12),
      })),
      points_forts: list(data.points_forts), points_faibles: list(data.points_faibles),
      remarque: typeof data.remarque === 'string' ? data.remarque.slice(0, 2000) : '',
      mention: ['felicitations', 'encouragements'].includes(data.mention) ? data.mention : 'aucune',
      justification: typeof data.justification === 'string' ? data.justification.slice(0, 300) : '',
    };
  }

  function askAnswer(done) {
    let dialog = document.getElementById('ppAnswerDialog');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `<dialog id="ppAnswerDialog" aria-labelledby="ppAnswerTitle"><form method="dialog" class="pp-answer">
        <h2 id="ppAnswerTitle">Réponse de l’IA</h2>
        <p class="muted">Colle ici toute la réponse de l’IA (elle commence par une accolade « { »).</p>
        <textarea id="ppAnswerText" rows="10"></textarea>
        <p id="ppAnswerError" class="phrase-error" role="alert" hidden></p>
        <div class="actions"><button type="button" id="ppAnswerCancel">Annuler</button><button class="primary" id="ppAnswerOk" type="submit">Enregistrer</button></div>
      </form></dialog>`);
      dialog = document.getElementById('ppAnswerDialog');
    }
    const area = document.getElementById('ppAnswerText');
    const error = document.getElementById('ppAnswerError');
    area.value = '';
    error.hidden = true;
    document.getElementById('ppAnswerCancel').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      try {
        const answer = extract(area.value);
        dialog.close();
        done(answer);
      } catch (problem) {
        error.textContent = problem.message || 'Réponse illisible.';
        error.hidden = false;
      }
    };
    dialog.showModal();
    area.focus();
  }

  return {payload, anonymizer, prompt, extract, askAnswer};
})();
