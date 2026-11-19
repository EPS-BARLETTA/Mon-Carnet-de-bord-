'use strict';

const BACKUP_FORMAT = 'mon-carnet-de-bord-eps';
const BACKUP_WEEK_KEY = 'mon-carnet-eps-derniere-sauvegarde';
let backupBusy = false;

function backupWeek(date = new Date()) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-S${String(week).padStart(2, '0')}`;
}

function lastBackupWeek() {
  try { return localStorage.getItem(BACKUP_WEEK_KEY); }
  catch { return null; }
}

function updateBackupReminder() {
  const reminder = $('backupReminder');
  const status = $('backupWeekStatus');
  const week = backupWeek();
  const done = lastBackupWeek() === week;
  reminder.hidden = !classes.length || done || location.hash === '#sauvegarde';
  if (status) status.textContent = done ? 'Une sauvegarde a été exportée cette semaine.' : 'Sauvegarde ton carnet chaque lundi.';
}

function backupLayouts(groups) {
  const layouts = [];
  for (const group of groups) {
    for (const board of group.boards) {
      for (const panel of [board, ...(board.panels || [])]) {
        if (panel.board) layouts.push(panel.board);
        for (const archive of panel.boardArchives || []) layouts.push(archive.board);
      }
    }
  }
  return layouts;
}

async function makeBackup() {
  if (!canReadStorage) throw Error('Impossible de lire le carnet sur cet appareil.');
  const date = new Date();
  const snapshot = {format: BACKUP_FORMAT, version: 1, created: date.toISOString(),
    classes: JSON.parse(JSON.stringify(classes)), home: homeAppearance(), assets: []};
  const references = new Map();
  for (const layout of backupLayouts(snapshot.classes)) {
    if (layout.reference) references.set(layout.reference.id, layout.reference.type);
  }
  for (const [id, type] of references) {
    const blob = await boardFileTransaction('readonly', store => store.get(id));
    if (!blob || blob.type !== type) throw Error('Un barème est introuvable sur cet appareil. Réimporte le document dans le tableau avant de sauvegarder.');
    snapshot.assets.push({id, type, data: await sessionDataUrl(blob)});
  }
  const week = backupWeek(date);
  const clock = new Intl.DateTimeFormat('fr-FR', {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(date).replace(/\D/g, '');
  const file = new File([JSON.stringify(snapshot)], `Carnet-de-bord-semaine-${week}-${carnetDay()}-${clock}.json`, {type: 'application/json'});
  if (file.size > SESSION_FILE_LIMIT) throw Error('La sauvegarde dépasse la limite de 100 Mo.');
  return {file, week};
}

function validateBackupGroups(groups) {
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const values = value => value === undefined ? [] : Object.values(value || {});
  const validId = id => sessionIdentifier(id) && !Object.hasOwn(Object.prototype, id) && id !== 'prototype';
  function entries(items) {
    if (!Array.isArray(items) || !items.every(item => record(item) && validId(item.id) && typeof item.name === 'string') ||
        new Set(items.map(item => item.id)).size !== items.length) throw Error('La structure du carnet est invalide.');
  }
  entries(groups);
  for (const group of groups) {
    entries(group.students);
    entries(group.boards);
    for (const board of group.boards) {
      if (board.panels !== undefined) entries(board.panels);
      for (const panel of [board, ...(board.panels || [])]) {
        if (panel.board !== undefined && !record(panel.board)) throw Error('Un tableau du fichier est invalide.');
        if (panel.boardArchives !== undefined) {
          entries(panel.boardArchives);
          if (!panel.boardArchives.every(archive => record(archive.board))) throw Error('Une archive du fichier est invalide.');
        }
      }
    }
    for (const term of values(group.evaluations)) {
      entries(term);
      if (!term.every(item => Number.isFinite(item.maximum) && item.maximum > 0 &&
          Number.isFinite(item.weight) && item.weight > 0 && record(item.scores))) throw Error('Les notes du fichier sont invalides.');
    }
    for (const periods of values(group.exemptions)) {
      if (!Array.isArray(periods) || !periods.every(period => record(period) &&
          typeof period.start === 'string' && typeof period.end === 'string')) throw Error('Les dispenses du fichier sont invalides.');
    }
  }
}

async function readBackup(file) {
  if (file.size > SESSION_FILE_LIMIT) throw Error('La sauvegarde dépasse la limite de 100 Mo.');
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { throw Error('Ce fichier est illisible.'); }
  if (data?.format !== BACKUP_FORMAT || data.version !== 1 || !Array.isArray(data.assets) || !data.home ||
      typeof data.home !== 'object' || Array.isArray(data.home)) throw Error('Choisis une sauvegarde complète de Mon Carnet de bord EPS.');
  validateBackupGroups(data.classes);
  const assets = new Map();
  for (const asset of data.assets) {
    if (!sessionIdentifier(asset?.id) || assets.has(asset.id) || !BOARD_REFERENCE_TYPES.includes(asset.type) ||
        typeof asset.data !== 'string' || !asset.data.startsWith(`data:${asset.type};base64,`)) throw Error('Un barème de la sauvegarde est invalide.');
    const bytes = Uint8Array.from(atob(asset.data.slice(asset.data.indexOf(',') + 1)), char => char.charCodeAt(0));
    if (bytes.length > BOARD_REFERENCE_LIMIT || boardReferenceType(bytes.subarray(0, 8)) !== asset.type) throw Error('Un barème de la sauvegarde est invalide.');
    assets.set(asset.id, {id: uid(), blob: new Blob([bytes], {type: asset.type})});
  }
  for (const layout of backupLayouts(data.classes)) {
    if (!layout.reference) continue;
    const asset = assets.get(layout.reference.id);
    if (!asset || asset.blob.type !== layout.reference.type) throw Error('Il manque un barème dans cette sauvegarde.');
    layout.reference.id = asset.id;
  }
  return {classes: data.classes, home: data.home, assets};
}

async function restoreBackup(data) {
  if (!canReadStorage) throw Error('Impossible de lire le carnet sur cet appareil.');
  const updates = [[STORAGE_KEY, JSON.stringify(data.classes)], [HOME_KEY, JSON.stringify(data.home)]]
    .map(([key, next]) => ({key, next, previous: localStorage.getItem(key)}))
    .sort((a, b) => (a.next.length - (a.previous?.length || 0)) - (b.next.length - (b.previous?.length || 0)));
  if (data.assets.size) {
    await boardFileTransaction('readwrite', store => {
      let request;
      for (const {id, blob} of data.assets.values()) request = store.put(blob, id);
      return request;
    });
  }
  const written = [];
  try {
    for (const update of updates) {
      localStorage.setItem(update.key, update.next);
      written.push(update);
    }
  } catch {
    for (const {key, previous} of written.reverse()) {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    }
    if (data.assets.size) {
      await boardFileTransaction('readwrite', store => {
        let request;
        for (const {id} of data.assets.values()) request = store.delete(id);
        return request;
      }).catch(() => {});
    }
    throw Error('Le stockage de cet appareil est insuffisant pour restaurer cette sauvegarde.');
  }
  classes = data.classes;
  assignClassColors();
}

function renderBackup() {
  content.innerHTML = `<section class="route class-form">
    <a class="back-link" href="#accueil">← Accueil</a>
    <h1>Sauvegarde du carnet</h1>
    <div class="card backup-card">
      <p id="backupWeekStatus"></p>
      <p>Sur iPad, choisis <strong>Enregistrer dans Fichiers</strong>, puis ton dossier sur <strong>iCloud Drive</strong> ou <strong>Sur mon iPad</strong>.</p>
      <button id="exportBackup" class="primary" type="button">Sauvegarder tout</button>
      <button id="shareBackup" type="button" hidden>Enregistrer le fichier préparé</button>
      <button id="downloadBackup" type="button" hidden>Télécharger le fichier</button>
      <p id="backupFeedback" role="status" hidden></p>
    </div>
    <div class="card backup-card">
      <h2>Restaurer une sauvegarde</h2>
      <p>Le fichier restauré remplace le carnet de cet appareil. Sauvegarde d’abord le carnet actuel si tu souhaites en garder une copie.</p>
      <button id="importBackup" type="button">Choisir une sauvegarde</button>
      <input id="backupInput" type="file" accept=".json,application/json" hidden>
    </div>
  </section>`;
  const feedback = $('backupFeedback');
  const input = $('backupInput');
  const prepare = $('exportBackup');
  const share = $('shareBackup');
  const downloadButton = $('downloadBackup');
  const restore = $('importBackup');
  let pending;
  function report(message) {
    feedback.hidden = false;
    feedback.textContent = message;
  }
  function busy(value) {
    backupBusy = value;
    for (const id of ['exportBackup', 'shareBackup', 'downloadBackup', 'importBackup']) {
      const button = $(id);
      if (button) button.disabled = value;
    }
  }
  busy(backupBusy);
  function exported(week, message) {
    try { localStorage.setItem(BACKUP_WEEK_KEY, week); } catch {}
    updateBackupReminder();
    share.hidden = downloadButton.hidden = true;
    report(message);
  }
  function downloadPending() {
    download(pending.file.name, pending.file, pending.file.type);
    exported(pending.week, 'Téléchargement lancé. Vérifie que le fichier se trouve dans ton dossier.');
  }
  async function sharePending() {
    try {
      await navigator.share({files: [pending.file]});
      exported(pending.week, 'Export terminé. Vérifie la présence du fichier dans le dossier choisi.');
    } catch (error) {
      share.hidden = false;
      downloadButton.hidden = false;
      report(error.name === 'AbortError' ? 'Enregistrement annulé.' : 'Le partage du fichier n’a pas abouti. Réessaie ou télécharge-le.');
    }
  }
  prepare.onclick = async () => {
    busy(true);
    report('Préparation de la sauvegarde…');
    share.hidden = downloadButton.hidden = true;
    try {
      pending = await makeBackup();
      if (!prepare.isConnected) return;
      if (typeof navigator.canShare === 'function' && navigator.canShare({files: [pending.file]})) {
        if (navigator.userActivation?.isActive === false) {
          share.hidden = downloadButton.hidden = false;
          report('La sauvegarde est prête.');
        } else await sharePending();
      } else downloadPending();
    } catch (error) { report(error.message || 'Impossible de préparer la sauvegarde.'); }
    finally { busy(false); }
  };
  share.onclick = async () => {
    busy(true);
    try { await sharePending(); }
    finally { busy(false); }
  };
  downloadButton.onclick = downloadPending;
  restore.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file || backupBusy) return;
    busy(true);
    try {
      const data = await readBackup(file);
      if (!restore.isConnected || !confirm(`Restaurer ${data.classes.length} classe(s) et remplacer le carnet sur cet appareil ?`)) return;
      await restoreBackup(data);
      location.hash = '#accueil';
      notify('Sauvegarde restaurée.');
    } catch (error) { report(error.message || 'Impossible de restaurer la sauvegarde.'); }
    finally { busy(false); }
  };
  updateBackupReminder();
}

window.addEventListener('pageshow', updateBackupReminder);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateBackupReminder();
});
