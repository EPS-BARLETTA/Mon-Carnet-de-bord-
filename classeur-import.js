'use strict';

// Import d'une sauvegarde de « Mon Classeur Prof » dans le carnet.
// Les classes sont associées par leur nom, les élèves par leur nom et prénom (dans n'importe quel ordre,
// sans tenir compte des accents ni des majuscules). Les élèves introuvables sont ajoutés à la classe.
const ClasseurImport = (() => {
  const nameKey = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
  // Confusions fréquentes de la lecture des captures PRONOTE : I, l et 1 ; O et 0.
  const looseKey = value => nameKey(value).replace(/[l1]/g, 'i').replace(/0/g, 'o');
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const kept = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = kept;
      }
    }
    return row[b.length];
  }
  // Même élève : nom identique, ou à une confusion de lecture près, ou à une lettre près (si un seul candidat).
  function findStudent(candidates, name) {
    const exact = candidates.find(candidate => nameKey(candidate.name) === nameKey(name));
    if (exact) return exact;
    const loose = candidates.filter(candidate => looseKey(candidate.name) === looseKey(name));
    if (loose.length === 1) return loose[0];
    const key = looseKey(name);
    if (key.replace(/ /g, '').length < 6) return null;
    const near = candidates.filter(candidate => distance(looseKey(candidate.name), key) <= 1);
    return near.length === 1 ? near[0] : null;
  }
  const classKey = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' ? value : '';

  function parse(raw) {
    let data;
    try { data = JSON.parse(raw); }
    catch { throw Error('Ce fichier est illisible.'); }
    if (!record(data) || !Array.isArray(data.classes) || data.format === 'mon-carnet-de-bord-eps') {
      throw Error('Choisis une sauvegarde de Mon Classeur Prof (fichier « mon-classeur-prof-sauvegarde-… .json »).');
    }
    const classesIn = data.classes.filter(item => record(item) && text(item.name).trim());
    if (!classesIn.length) throw Error('Cette sauvegarde ne contient aucune classe.');
    for (const item of classesIn) {
      if (!Array.isArray(item.students) || (item.tables !== undefined && !Array.isArray(item.tables))) {
        throw Error(`La classe « ${item.name} » de la sauvegarde est invalide.`);
      }
    }
    return {...data, classes: classesIn};
  }

  // Remplace les identifiants d'élèves du classeur par ceux du carnet partout où ils servent de clé.
  function remapTable(table, map) {
    const copy = JSON.parse(JSON.stringify(table));
    const results = {};
    for (const [id, value] of Object.entries(record(copy.results) ? copy.results : {})) results[map.get(id) || id] = value;
    copy.results = results;
    copy.groups = (Array.isArray(copy.groups) ? copy.groups : []).map(group => ({
      ...group, studentIds: (Array.isArray(group.studentIds) ? group.studentIds : []).map(id => map.get(id) || id),
    }));
    return copy;
  }

  function remapBilans(bilans, map) {
    const copy = JSON.parse(JSON.stringify(record(bilans) ? bilans : {}));
    for (const bilan of Object.values(copy)) {
      if (!record(bilan)) continue;
      for (const key of ['overrides', 'remarks', 'tags']) {
        if (!record(bilan[key])) continue;
        bilan[key] = Object.fromEntries(Object.entries(bilan[key]).map(([id, value]) => [map.get(id) || id, value]));
      }
    }
    return copy;
  }

  // Prépare l'import sans rien modifier, et renvoie le résultat avec un rapport.
  function plan(source, groups) {
    const next = JSON.parse(JSON.stringify(groups));
    const report = {created: [], merged: [], added: [], tables: 0};
    const usedIds = new Set(next.flatMap(group => [group.id, ...(group.students || []).map(student => student.id),
      ...(group.withdrawnStudents || []).map(student => student.id)]));
    const freshId = id => {
      let value = typeof id === 'string' && id && !usedIds.has(id) ? id : null;
      while (!value || usedIds.has(value)) value = uid();
      usedIds.add(value);
      return value;
    };

    for (const item of source.classes) {
      const tables = Array.isArray(item.tables) ? item.tables : [];
      report.tables += tables.length;
      let group = next.find(candidate => classKey(candidate.name) === classKey(item.name));
      const map = new Map();
      if (!group) {
        group = {id: freshId(item.id), name: text(item.name).trim(), students: [], boards: [{id: 'principal', name: 'Tableau principal'}]};
        next.push(group);
        report.created.push(group.name);
      } else {
        report.merged.push(group.name);
      }
      group.students = Array.isArray(group.students) ? group.students : [];
      const everyone = [...group.students, ...(group.withdrawnStudents || [])];
      for (const student of item.students.filter(entry => record(entry) && text(entry.name).trim())) {
        const match = findStudent(everyone, student.name);
        if (match) {
          map.set(student.id, match.id);
          if (!match.sex && (student.sex === 'F' || student.sex === 'M')) match.sex = student.sex;
        } else {
          const added = {id: freshId(student.id), name: text(student.name).trim()};
          if (student.sex === 'F' || student.sex === 'M') added.sex = student.sex;
          group.students.push(added);
          everyone.push(added);
          map.set(student.id, added.id);
          if (!report.created.includes(group.name)) report.added.push(`${added.name} (${group.name})`);
        }
      }
      const own = record(group.classeur) ? group.classeur : {};
      const existing = Array.isArray(own.tables) ? own.tables : [];
      const imported = tables.filter(record).map(table => remapTable(table, map));
      const importedIds = new Set(imported.map(table => table.id));
      const bilans = remapBilans(item.bilans, map);
      const mergedBilans = record(own.bilans) ? {...own.bilans} : {};
      for (const [term, bilan] of Object.entries(bilans)) {
        const before = record(mergedBilans[term]) ? mergedBilans[term] : {};
        mergedBilans[term] = {...before, ...bilan,
          ...Object.fromEntries(['coefs', 'overrides', 'remarks', 'tags'].map(key => [key, {...(before[key] || {}), ...(bilan[key] || {})}]))};
      }
      group.classeur = {
        ...own,
        tables: [...existing.filter(table => !importedIds.has(table.id)), ...imported],
        folders: [...(Array.isArray(own.folders) ? own.folders : []), ...(Array.isArray(item.folders) ? item.folders : [])
          .filter(folder => !(own.folders || []).some(existingFolder => existingFolder.id === folder?.id))],
        bilans: mergedBilans,
        archived: Boolean(own.archived || item.archived),
      };
    }
    return {groups: next, report, settings: {year: source.year, settings: record(source.settings) ? source.settings : {}}};
  }

  function summary({report}) {
    const lines = [];
    if (report.merged.length) lines.push(`Classes déjà dans le carnet : ${report.merged.join(', ')}.`);
    if (report.created.length) lines.push(`Nouvelles classes créées : ${report.created.join(', ')}.`);
    lines.push(`${report.tables} évaluation${report.tables > 1 ? 's' : ''} importée${report.tables > 1 ? 's' : ''}.`);
    if (report.added.length) {
      const shown = report.added.slice(0, 8).join(', ');
      lines.push(`Élèves introuvables dans le carnet, qui seront ajoutés : ${shown}${report.added.length > 8 ? ` et ${report.added.length - 8} autres` : ''}.`);
      lines.push('Vérifie l’orthographe de ces noms : s’il s’agit des mêmes élèves, corrige le nom dans le classeur ou le carnet avant d’importer.');
    }
    return lines.join('\n\n');
  }

  // Fusionne une classe en double dans une autre : évaluations, bilans et remarques du module,
  // élèves associés par leur nom. La classe en double est retirée de la liste renvoyée.
  function mergePlan(target, source, groups) {
    const own = record(source.classeur) ? source.classeur : {};
    const input = {classes: [{
      id: source.id,
      name: target.name,
      students: [...(source.students || []), ...(source.withdrawnStudents || [])],
      tables: Array.isArray(own.tables) ? own.tables : [],
      bilans: record(own.bilans) ? own.bilans : {},
      folders: Array.isArray(own.folders) ? own.folders : [],
    }]};
    const others = groups.filter(group => group.id !== source.id);
    const result = plan(input, others);
    const lost = [];
    if (Object.keys(source.attendance || {}).some(term => Object.keys(source.attendance[term] || {}).length)) lost.push('l’appel');
    if (Object.keys(source.bulletins || {}).some(term => Object.keys(source.bulletins[term] || {}).length)) lost.push('les bulletins et fiches PP');
    if (Object.keys(source.evaluations || {}).some(term => (source.evaluations[term] || []).length)) lost.push('les anciennes notes du carnet');
    if ((source.boards || []).some(board => board.board || (board.panels || []).length || (board.boardArchives || []).length)) lost.push('les tableaux blancs');
    return {...result, lost};
  }

  return {parse, plan, summary, mergePlan, nameKey, classKey, findStudent};
})();
