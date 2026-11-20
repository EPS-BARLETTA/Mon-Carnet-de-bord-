'use strict';

// Pont entre le module Évaluations (ancien « Mon Classeur Prof ») et la base du carnet.
// Le module travaille sur les mêmes classes et les mêmes élèves que le carnet.
// Ses données propres sont rangées dans chaque classe du carnet, dans group.classeur :
//   {tables, folders, bilans, archived}
// et ses réglages généraux dans les modules du carnet : modules.classeur = {year, settings, lastBackup}.
(() => {
  const CLOUD_STATE_KEY = 'mon-carnet-eps-cloud';
  const APP_SRC = document.currentScript?.dataset.app || 'assets/app.js';
  let groups = [];
  let modules = {};

  function markChanged() {
    try {
      const state = JSON.parse(localStorage.getItem(CLOUD_STATE_KEY) || 'null') || {version: null, created: null};
      if (!state.dirty) localStorage.setItem(CLOUD_STATE_KEY, JSON.stringify({...state, dirty: true}));
    } catch {}
  }

  function toClasseur() {
    const settings = modules.classeur || {};
    return {
      version: 1,
      year: settings.year,
      settings: settings.settings && typeof settings.settings === 'object' ? settings.settings : {},
      lastBackup: settings.lastBackup,
      classes: groups.map(group => {
        const own = group.classeur && typeof group.classeur === 'object' ? group.classeur : {};
        return {
          id: group.id,
          name: group.name,
          archived: Boolean(own.archived),
          students: Array.isArray(group.students) ? group.students : [],
          folders: Array.isArray(own.folders) ? own.folders : [],
          tables: Array.isArray(own.tables) ? own.tables : [],
          bilans: own.bilans && typeof own.bilans === 'object' ? own.bilans : {},
        };
      }),
    };
  }

  function fromClasseur(data) {
    const byId = new Map(data.classes.map(item => [item.id, item]));
    const known = new Set(groups.map(group => group.id));
    const apply = (group, item) => {
      group.name = item.name;
      group.students = item.students;
      group.classeur = {tables: item.tables, folders: item.folders, bilans: item.bilans || {}, archived: Boolean(item.archived)};
      return group;
    };
    const next = groups.map(group => byId.has(group.id) ? apply(group, byId.get(group.id)) : group);
    for (const item of data.classes) {
      if (known.has(item.id)) continue;
      next.push(apply({id: item.id, name: item.name, students: [], boards: [{id: 'principal', name: 'Tableau principal'}]}, item));
    }
    groups = next;
    modules = {...modules, classeur: {year: data.year, settings: data.settings || {}, lastBackup: data.lastBackup}};
  }

  window.ClasseurBridge = {
    data: null,
    save(data) {
      try {
        fromClasseur(data);
        CarnetStore.set('classes', JSON.stringify(groups));
        CarnetStore.set('modules', JSON.stringify(modules));
        markChanged();
        return true;
      } catch {
        return false;
      }
    },
  };

  CarnetStore.onError = () => alert('Enregistrement impossible dans ce navigateur : tes dernières saisies ne sont pas enregistrées.');

  CarnetStore.load().then(stored => {
    try {
      groups = JSON.parse(stored.classes || '[]');
      if (!Array.isArray(groups)) throw Error('format');
      modules = JSON.parse(stored.modules || '{}') || {};
    } catch {
      document.getElementById('app').innerHTML = '<p style="padding:24px">Le carnet enregistré sur cet appareil n’a pas pu être lu. <a href="../#sauvegarde">Restaurer une sauvegarde</a></p>';
      return;
    }
    window.ClasseurBridge.data = toClasseur();
    const script = document.createElement('script');
    script.src = APP_SRC;
    document.body.append(script);
  });
})();
