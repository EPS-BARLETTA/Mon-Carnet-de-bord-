'use strict';

// Import d'une sauvegarde de « Mon Classeur Prof » dans le carnet.
// Les classes sont associées par leur nom, les élèves par leur nom et prénom (dans n'importe quel ordre,
// sans tenir compte des accents ni des majuscules). Les élèves introuvables sont ajoutés à la classe.
const ClasseurImport = (() => {
  const nameKey = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
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
        const match = everyone.find(candidate => nameKey(candidate.name) === nameKey(student.name));
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

  return {parse, plan, summary, nameKey, classKey};
})();
