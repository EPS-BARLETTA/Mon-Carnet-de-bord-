'use strict';

// Lecture des évaluations du module Classeur depuis le carnet (fiche élève, bulletins).
// Reprend exactement les règles de calcul du module : degrés et points, compétences collectives,
// CCF Terminale, élèves absents ou dispensés, coefficients et moyenne retenue du bilan.
const ClasseurNotes = (() => {
  const STATUS = {absent: 'Absent', dispense: 'Dispensé'};
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const termKey = term => 'T' + term;

  function parseNote(value) {
    if (value === '' || value == null) return null;
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) ? number : null;
  }

  const tables = group => Array.isArray(group?.classeur?.tables) ? group.classeur.tables : [];
  const tablesFor = (group, term) => tables(group).filter(table => table.trimester === termKey(term));
  const scored = table => (table.observables || []).filter(item => Number(item.points) > 0);
  const degreePoints = (item, level) => Number(item.points) * level / 4;
  const isCcf = table => Boolean(table?.ccf && window.CCF?.SPECS?.[table.ccf.apsa]);

  function computedScore(table, studentId) {
    const items = scored(table);
    if (!items.length) return null;
    const result = table.results?.[studentId] || {};
    const team = (table.groups || []).find(group => (group.studentIds || []).includes(studentId));
    let earned = 0;
    let max = 0;
    let missing = 0;
    for (const item of items) {
      const points = Number(item.points);
      const level = item.scope === 'collective' ? team?.levels?.[item.id] : result.levels?.[item.id];
      max += points;
      if (level) earned += degreePoints(item, level);
      else missing++;
    }
    return {earned, max, missing, note: missing ? null : Math.round(earned / max * 20 * 4) / 4};
  }

  function finalNote(group, table, studentId) {
    const result = table.results?.[studentId];
    if (isCcf(table)) {
      if (result && STATUS[result.status]) return null;
      const student = (group.students || []).find(item => item.id === studentId);
      return window.CCF.evaluate(table.ccf.apsa, result?.ccf, student?.sex || '')?.note ?? null;
    }
    return scored(table).length ? computedScore(table, studentId).note : parseNote(result?.note);
  }

  function bilan(group, term) {
    const value = group?.classeur?.bilans?.[termKey(term)];
    const safe = record(value) ? value : {};
    return {
      coefs: record(safe.coefs) ? safe.coefs : {},
      keep: record(safe.keep) ? safe.keep : {},
      overrides: record(safe.overrides) ? safe.overrides : {},
      remarks: record(safe.remarks) ? safe.remarks : {},
      tags: record(safe.tags) ? safe.tags : {},
    };
  }

  // Évaluation retenue pour le bulletin : choix du bilan, sinon toutes sauf les formatives.
  function kept(summary, table) {
    return typeof summary.keep[table.id] === 'boolean' ? summary.keep[table.id] : !table.formative;
  }

  function coefOf(summary, table) {
    if (!kept(summary, table)) return 0;
    const value = parseNote(summary.coefs[table.id]);
    return value === null || value < 0 ? 1 : value;
  }

  // Résumé d'un élève pour un trimestre : une ligne par évaluation, moyenne calculée et retenue.
  function student(group, term, studentId) {
    const summary = bilan(group, term);
    const rows = tablesFor(group, term).map(table => {
      const result = table.results?.[studentId] || {};
      const status = STATUS[result.status] ? result.status : '';
      const score = !status && !isCcf(table) ? computedScore(table, studentId) : null;
      return {
        id: table.id,
        name: table.name || 'Évaluation',
        coef: coefOf(summary, table),
        kept: kept(summary, table),
        formative: Boolean(table.formative),
        status,
        statusLabel: STATUS[status] || '',
        note: status ? null : finalNote(group, table, studentId),
        missing: score?.missing || 0,
        comment: typeof result.comment === 'string' ? result.comment : '',
      };
    });
    let sum = 0;
    let weight = 0;
    for (const row of rows) {
      if (row.note !== null && row.coef > 0) {
        sum += row.note * row.coef;
        weight += row.coef;
      }
    }
    const computed = weight ? Math.round(sum / weight * 100) / 100 : null;
    const override = parseNote(summary.overrides[studentId]);
    const retained = override !== null && override >= 0 && override <= 20 ? override : computed;
    return {
      rows,
      computed,
      retained,
      overridden: retained !== computed,
      remark: typeof summary.remarks[studentId] === 'string' ? summary.remarks[studentId] : '',
      tags: Array.isArray(summary.tags[studentId]) ? summary.tags[studentId] : [],
    };
  }

  // Appréciation d'EPS : celle du bilan du module, partagée avec l'onglet Bulletins du carnet.
  function remark(group, term, studentId) {
    const value = bilan(group, term).remarks[studentId];
    return typeof value === 'string' ? value : null;
  }

  function setRemark(group, term, studentId, text) {
    const own = record(group.classeur) ? group.classeur : {tables: [], folders: [], bilans: {}};
    const bilans = record(own.bilans) ? {...own.bilans} : {};
    const key = termKey(term);
    const current = record(bilans[key]) ? bilans[key] : {};
    const remarks = {...(record(current.remarks) ? current.remarks : {})};
    if (text) remarks[studentId] = text;
    else delete remarks[studentId];
    bilans[key] = {coefs: {}, overrides: {}, tags: {}, classTags: [], classRemark: '', ...current, remarks};
    return {...own, bilans};
  }

  const TAGS = {investi: 'Investi·e', discret: 'Discret·ète', progres: 'En progrès', comportement: 'Comportement à revoir',
    implication: 'Manque d’implication', arrive: 'Arrivé·e en cours de trimestre'};

  const format = value => value === null ? '–' : String(Math.round(value * 100) / 100).replace('.', ',');

  return {student, remark, setRemark, tablesFor, format, TAGS, STATUS};
})();
