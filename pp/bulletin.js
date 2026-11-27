'use strict';

// Lecture des bulletins PRONOTE (PDF) dans l'appareil, sans rien envoyer.
// Un PDF peut contenir le bulletin d'un élève ou de toute la classe (un bulletin par page ou plus).
// Résultat par bulletin :
//   {term, name, className, subjects: [{name, teacher, count, note, classAverage, appreciation, teachers: [...]}],
//    life: {text, halfDays, unjustified, late}}
const PronoteBulletin = (() => {
  let pdfjs = null;

  async function library() {
    if (pdfjs) return pdfjs;
    await import(new URL('pp/vendor/polyfills.mjs', document.baseURI).href);
    pdfjs = await import(new URL('pp/vendor/pdf.min.mjs', document.baseURI).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pp/vendor/pdf.worker.mjs', document.baseURI).href;
    return pdfjs;
  }

  const clean = text => text.replace(/\s+/g, ' ').trim();
  const number = text => {
    const value = Number(String(text).replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  };
  const TEACHER = /^(M\.|Mme|MME|Mlle|MLLE|M |MM\.|Mmes|Melle)\s*\S/;
  const COUNT = /^\d{1,2}\s*\/\s*\d{1,2}$/;
  const AVERAGE = /^\d{1,2}[,.]\d{1,2}$|^\d{1,2}$|^Abs$|^Disp$|^N\.?\s?Not\.?$/i;

  function upperShare(text) {
    const letters = text.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
    if (letters.length < 2) return 0;
    return letters.replace(/[^A-ZÀ-ÖØ-Þ]/g, '').length / letters.length;
  }

  // Regroupe les morceaux de texte d'une page en lignes (même hauteur).
  function lines(items) {
    const sorted = items.filter(item => item.str.trim() && Math.abs(item.transform[1]) < 0.01 && Math.abs(item.transform[2]) < 0.01)
      .map(item => ({text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, size: Math.abs(item.transform[3])}))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const item of sorted) {
      const row = rows.find(candidate => Math.abs(candidate.y - item.y) <= Math.max(2, item.size * 0.35));
      if (row) row.items.push(item);
      else rows.push({y: item.y, items: [item]});
    }
    for (const row of rows) row.items.sort((a, b) => a.x - b.x);
    return rows.sort((a, b) => b.y - a.y);
  }

  const join = items => clean(items.map(item => item.text).join(' '));

  function columns(rows) {
    const all = rows.flatMap(row => row.items);
    const find = pattern => all.find(item => pattern.test(item.text.trim()));
    const notes = find(/^Nb\.?$|^Nbr\.?$|^Nb\. ?Notes$/i);
    const pupil = find(/^[ÉE]l[èe]ve$/i);
    const klass = find(/^Clas\.?$|^Classe$/i);
    const remarks = find(/^App(\.|réciations?)/i);
    if (!pupil || !klass) return null;
    return {
      header: Math.min(pupil.y, klass.y),
      numbersStart: notes ? notes.x - 4 : pupil.x - 40,
      pupilX: pupil.x + pupil.width / 2,
      classX: klass.x + klass.width / 2,
      remarksStart: klass.x + klass.width + 3,
      remarksHeader: remarks,
    };
  }

  function parsePage(rows) {
    const cols = columns(rows);
    const all = rows.flatMap(row => row.items);
    const titleRow = rows.find(row => /Bulletin du/i.test(join(row.items)));
    const info = {term: null, name: '', className: ''};
    if (titleRow) {
      const match = /(\d)\s*(?:er|e|è|ème|eme)?\s*Trimestre/i.exec(join(titleRow.items));
      if (match) info.term = match[1];
      const title = titleRow.items.find(item => /Bulletin/i.test(item.text)) || titleRow.items[0];
      const below = rows.filter(row => row.y < titleRow.y && row.y > titleRow.y - 40)
        .map(row => join(row.items.filter(item => item.x >= title.x - 20)))
        .find(text => text && !/^N[ée]e? le/i.test(text));
      if (below) info.name = below;
    }
    const classRow = rows.find(row => /\(\s*\d+\s*él[èe]ves?\s*\)/i.test(join(row.items)));
    if (classRow) info.className = join(classRow.items).replace(/\(.*$/, '').trim();
    if (!cols) return {...info, subjects: [], life: null, continued: false};

    const lifeRow = rows.find(row => row.y < cols.header && /absence|retard/i.test(join(row.items)));
    const end = lifeRow ? lifeRow.y : -Infinity;
    const body = rows.filter(row => row.y < cols.header - 1 && row.y > end + 1 && !/Index Education/i.test(join(row.items)));
    const subjects = [];
    let subject = null;
    let target = null;
    let naming = false;
    let lastNameY = Infinity;

    for (const row of body) {
      const left = row.items.filter(item => item.x < cols.numbersStart);
      const middle = row.items.filter(item => item.x >= cols.numbersStart && item.x < cols.remarksStart);
      const right = row.items.filter(item => item.x >= cols.remarksStart);
      const label = join(left);
      const numbers = middle.map(item => ({...item, text: item.text.trim()})).filter(item => COUNT.test(item.text) || AVERAGE.test(item.text));
      const isTeacher = TEACHER.test(label);
      const isSubject = label && !isTeacher && upperShare(label) > 0.8;

      if (isSubject) {
        // Un nom de matière long continue sur la ligne suivante, juste en dessous et avant le nom du professeur.
        const size = left[0]?.size || 8;
        if (subject && naming && !subject.teacher && lastNameY - row.y < size * 1.8) {
          subject.name = clean(subject.name + ' ' + label);
        } else {
          subject = {name: label, teacher: '', count: '', note: null, classAverage: null, appreciation: '', teachers: []};
          subjects.push(subject);
        }
        target = subject;
        naming = true;
        lastNameY = row.y;
      } else if (isTeacher && subject) {
        naming = false;
        if (numbers.length && (subject.count || subject.note !== null)) {
          target = {teacher: label, count: '', note: null, classAverage: null, appreciation: ''};
          subject.teachers.push(target);
        } else if (!subject.teacher) {
          subject.teacher = label;
        } else {
          subject.teacher += ', ' + label;
        }
      } else if (label) {
        naming = false;
      }
      if (!target) continue;
      for (const item of numbers) {
        if (COUNT.test(item.text)) target.count = item.text.replace(/\s/g, '');
        else {
          const center = item.x + item.width / 2;
          const value = number(item.text);
          if (Math.abs(center - cols.pupilX) <= Math.abs(center - cols.classX)) target.note = value;
          else target.classAverage = value;
        }
      }
      if (right.length) target.appreciation = clean(target.appreciation + ' ' + join(right)).replace(/(\w)- (\w)/g, '$1$2');
    }

    let life = null;
    if (lifeRow) {
      const text = join(lifeRow.items);
      const half = /(\d+)\s*demi-journ/i.exec(text);
      const unjustified = /dont\s*(\d+)[^-]*non justifi/i.exec(text);
      const late = /Retards?\s*:\s*(\d+)/i.exec(text);
      life = {text, halfDays: half ? Number(half[1]) : 0, unjustified: unjustified ? Number(unjustified[1]) : 0, late: late ? Number(late[1]) : 0};
    }
    return {...info, subjects, life, continued: !titleRow};
  }

  // Évite une attente sans fin si le moteur PDF ne répond pas (vieux Safari, mémoire).
  const within = (promise, seconds, message) => Promise.race([promise,
    new Promise((resolve, reject) => setTimeout(() => reject(Error(message)), seconds * 1000))]);

  async function readPdf(buffer, onProgress = () => {}) {
    onProgress('Chargement du lecteur PDF…');
    const lib = await within(library(), 40, 'Le lecteur PDF ne se charge pas. Ferme complètement l’app, rouvre-la avec du réseau, puis réessaie.');
    onProgress('Ouverture du PDF…');
    const task = lib.getDocument({data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true});
    const doc = await within(task.promise, 60, 'Le PDF ne s’ouvre pas (fichier trop lourd ou protégé ?).');
    const bulletins = [];
    for (let index = 1; index <= doc.numPages; index++) {
      onProgress(`Lecture de la page ${index} sur ${doc.numPages}…`);
      const page = await within(doc.getPage(index), 60, `La page ${index} ne se lit pas.`);
      const content = await within(page.getTextContent(), 60, `La page ${index} ne se lit pas.`);
      const parsed = parsePage(lines(content.items));
      const previous = bulletins[bulletins.length - 1];
      if (parsed.continued && previous) {
        previous.subjects.push(...parsed.subjects);
        if (parsed.life) previous.life = parsed.life;
      } else if (parsed.subjects.length || parsed.name) {
        bulletins.push(parsed);
      }
    }
    await task.destroy();
    return bulletins.map(({continued, ...bulletin}) => bulletin);
  }

  return {readPdf};
})();
