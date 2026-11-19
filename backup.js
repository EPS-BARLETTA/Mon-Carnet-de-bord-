'use strict';

const BACKUP_FORMAT = 'mon-carnet-de-bord-eps';
const BACKUP_WEEK_KEY = 'mon-carnet-eps-derniere-sauvegarde';
const PHRASE_CODE_KEY = 'mon-carnet-eps-phrase';
const CLOUD_STATE_KEY = 'mon-carnet-eps-cloud';
const PHRASE_MIN = 10;
let backupBusy = false;
let sessionPhrase = null;

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

// ---------- État de synchronisation avec le cloud ----------

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { return null; }
}

let cloudState = readJson(CLOUD_STATE_KEY) || {version: null, created: null, dirty: false};

function setCloudState(next) {
  cloudState = {...cloudState, ...next};
  try { localStorage.setItem(CLOUD_STATE_KEY, JSON.stringify(cloudState)); } catch {}
}

function markCarnetChanged() {
  if (!cloudState.dirty) setCloudState({dirty: true});
}

function frenchDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'});
}

function megabytes(bytes) {
  return (bytes / 1024 / 1024).toLocaleString('fr-FR', {maximumFractionDigits: 1}) + ' Mo';
}

// ---------- Phrase secrète ----------

function phraseDialog() {
  let dialog = $('phraseDialog');
  if (dialog) return dialog;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="phraseDialog" aria-labelledby="phraseTitle">
    <form id="phraseForm" class="phrase-form">
      <h2 id="phraseTitle"></h2>
      <p id="phraseHelp" class="muted"></p>
      <label for="phraseInput">Phrase secrète</label>
      <input id="phraseInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required>
      <div id="phraseConfirmField">
        <label for="phraseConfirm">Saisis-la une deuxième fois</label>
        <input id="phraseConfirm" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <label class="choice-line"><input id="phraseShow" type="checkbox"> Afficher la phrase</label>
      <p id="phraseError" class="phrase-error" role="alert" hidden></p>
      <div class="actions">
        <button id="phraseCancel" type="button">Annuler</button>
        <button id="phraseSubmit" class="primary" type="submit">Valider</button>
      </div>
    </form>
  </dialog>`);
  dialog = $('phraseDialog');
  $('phraseShow').onchange = event => {
    $('phraseInput').type = $('phraseConfirm').type = event.target.checked ? 'text' : 'password';
  };
  return dialog;
}

// Ouvre la fenêtre de saisie. check(phrase) renvoie un message d'erreur ou rien.
function promptPhrase({title, help, confirm = false, check = async () => {}}) {
  const dialog = phraseDialog();
  const input = $('phraseInput');
  const second = $('phraseConfirm');
  const error = $('phraseError');
  const submit = $('phraseSubmit');
  $('phraseTitle').textContent = title;
  $('phraseHelp').textContent = help;
  $('phraseConfirmField').hidden = !confirm;
  input.value = second.value = '';
  $('phraseShow').checked = false;
  input.type = second.type = 'password';
  error.hidden = true;
  submit.disabled = false;
  return new Promise(resolve => {
    const finish = value => {
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.onclose = () => resolve(null);
    $('phraseCancel').onclick = () => finish(null);
    $('phraseForm').onsubmit = async event => {
      event.preventDefault();
      const phrase = input.value;
      const fail = message => { error.textContent = message; error.hidden = false; submit.disabled = false; };
      if (confirm && phrase.length < PHRASE_MIN) return fail(`Choisis une phrase d’au moins ${PHRASE_MIN} caractères (par exemple quatre mots).`);
      if (confirm && phrase !== second.value) return fail('Les deux saisies ne sont pas identiques.');
      submit.disabled = true;
      error.textContent = 'Vérification…';
      error.hidden = false;
      const problem = await check(phrase).catch(() => 'Vérification impossible.');
      if (problem) return fail(problem);
      finish(phrase);
    };
    dialog.showModal();
    input.focus();
  });
}

// Renvoie la phrase secrète de la session (demandée une seule fois), et déverrouille le cloud.
async function askPhrase() {
  if (sessionPhrase) return sessionPhrase;
  const known = (() => { try { return localStorage.getItem(PHRASE_CODE_KEY); } catch { return null; } })();
  let accessKey;
  const phrase = await promptPhrase(known ? {
    title: 'Phrase secrète',
    help: 'Elle chiffre tes sauvegardes et ouvre ton carnet en ligne.',
    check: async value => {
      accessKey = await CarnetCrypto.accessKey(value);
      if (await CarnetCrypto.accessCode(accessKey) !== known) return 'Ce n’est pas la phrase enregistrée sur cet appareil.';
    },
  } : {
    title: 'Choisis ta phrase secrète',
    help: 'Elle chiffre tes sauvegardes et ton carnet en ligne. Si tu l’as déjà choisie sur un autre appareil, saisis la même. Personne ne pourra la retrouver si tu l’oublies : note-la en lieu sûr.',
    confirm: true,
    check: async value => { accessKey = await CarnetCrypto.accessKey(value); },
  });
  if (!phrase) return null;
  if (!known) {
    try { localStorage.setItem(PHRASE_CODE_KEY, await CarnetCrypto.accessCode(accessKey)); } catch {}
  }
  sessionPhrase = phrase;
  CarnetCloud.unlock(accessKey);
  return phrase;
}

function forgetPhrase() {
  sessionPhrase = null;
  CarnetCloud.lock();
  try { localStorage.removeItem(PHRASE_CODE_KEY); } catch {}
}

// ---------- Création et lecture des sauvegardes ----------

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

async function makeSnapshot() {
  if (!canReadStorage) throw Error('Impossible de lire le carnet sur cet appareil.');
  await CarnetStore.flush();
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
  const json = JSON.stringify(snapshot);
  if (json.length > SESSION_FILE_LIMIT) throw Error('La sauvegarde dépasse la limite de 100 Mo.');
  return {json, date, week: backupWeek(date)};
}

async function makeBackup(encrypted) {
  const {json, date, week} = await makeSnapshot();
  const clock = new Intl.DateTimeFormat('fr-FR', {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(date).replace(/\D/g, '');
  const name = `Carnet-de-bord-semaine-${week}-${carnetDay()}-${clock}`;
  if (!encrypted) return {file: new File([json], `${name}.json`, {type: 'application/json'}), week};
  const phrase = await askPhrase();
  if (!phrase) return null;
  const bytes = await CarnetCrypto.encrypt(json, phrase);
  return {file: new File([bytes], `${name}.carnet`, {type: 'application/octet-stream'}), week};
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

function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); }
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
  return {classes: data.classes, home: data.home, assets, created: data.created};
}

async function decryptWithPhrase(bytes) {
  const tried = sessionPhrase;
  if (tried) {
    try { return await CarnetCrypto.decrypt(bytes, tried); }
    catch (error) { if (!/Phrase/.test(error.message)) throw error; }
  }
  let text;
  const phrase = await promptPhrase({
    title: 'Sauvegarde chiffrée',
    help: tried ? 'Cette sauvegarde a été chiffrée avec une autre phrase. Saisis celle qui avait servi.' : 'Saisis la phrase secrète qui a servi à chiffrer cette sauvegarde.',
    check: async value => {
      try { text = await CarnetCrypto.decrypt(bytes, value); }
      catch (error) { return error.message; }
    },
  });
  return phrase ? text : null;
}

async function readBackup(file) {
  if (file.size > SESSION_FILE_LIMIT * 1.5) throw Error('La sauvegarde dépasse la limite de 100 Mo.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!CarnetCrypto.isEncrypted(bytes)) return parseBackup(new TextDecoder().decode(bytes));
  const text = await decryptWithPhrase(bytes);
  return text === null ? null : parseBackup(text);
}

async function restoreBackup(data) {
  if (data.assets.size) {
    await boardFileTransaction('readwrite', store => {
      let request;
      for (const {id, blob} of data.assets.values()) request = store.put(blob, id);
      return request;
    });
  }
  try {
    CarnetStore.set('classes', JSON.stringify(data.classes));
    CarnetStore.set('home', JSON.stringify(data.home));
    await CarnetStore.flush();
  } catch {
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
  homeSettings = data.home;
  canReadStorage = true;
  assignClassColors();
}

// ---------- Page Sauvegarde ----------

function renderBackup() {
  content.innerHTML = `<section class="route class-form">
    <a class="back-link" href="#accueil">← Accueil</a>
    <h1>Sauvegarde du carnet</h1>
    <div class="card backup-card">
      <p id="backupWeekStatus"></p>
      <p>Sur iPad, choisis <strong>Enregistrer dans Fichiers</strong>, puis ton dossier sur <strong>iCloud Drive</strong> ou <strong>Sur mon iPad</strong>.</p>
      <label class="choice-line"><input id="backupEncrypt" type="checkbox" checked> Chiffrer avec ma phrase secrète (recommandé)</label>
      <button id="exportBackup" class="primary" type="button">Sauvegarder tout</button>
      <button id="shareBackup" type="button" hidden>Enregistrer le fichier préparé</button>
      <button id="downloadBackup" type="button" hidden>Télécharger le fichier</button>
      <p id="backupFeedback" role="status" hidden></p>
    </div>
    <div class="card backup-card">
      <h2>Restaurer une sauvegarde</h2>
      <p>Le fichier restauré remplace le carnet de cet appareil. Sauvegarde d’abord le carnet actuel si tu souhaites en garder une copie. Les anciennes sauvegardes non chiffrées (.json) restent lisibles.</p>
      <button id="importBackup" type="button">Choisir une sauvegarde</button>
      <input id="backupInput" type="file" hidden>
    </div>
    <div class="card backup-card" id="cloudCard">
      <h2>Carnet en ligne</h2>
      <p>Envoie ton carnet pour le retrouver sur un autre appareil. Il est chiffré sur cet appareil avant l’envoi : le serveur ne reçoit qu’un fichier illisible.</p>
      <p id="cloudStatus" class="muted">Verrouillé. Ta phrase secrète te sera demandée.</p>
      <div class="actions">
        <button id="cloudPush" class="primary" type="button">Envoyer vers le cloud</button>
        <button id="cloudPull" type="button">Récupérer depuis le cloud</button>
      </div>
      <p id="cloudFeedback" role="status" hidden></p>
      <details class="cloud-setup">
        <summary>Configuration et options</summary>
        <p>Pour la première mise en place, affiche ton code d’accès et copie-le dans Vercel : <strong>Settings → Environment Variables</strong>, nom <code>CARNET_CLE_ACCES</code>, puis redéploie le projet. Ce code ne permet pas de lire le carnet.</p>
        <button id="cloudCode" type="button">Afficher mon code d’accès</button>
        <p id="cloudCodeBox" hidden><code id="cloudCodeValue" class="cloud-code"></code> <button id="cloudCodeCopy" type="button">Copier</button></p>
        <hr>
        <button id="phraseChange" type="button">Changer de phrase secrète</button>
        <button id="cloudDelete" class="danger" type="button">Supprimer le carnet en ligne</button>
      </details>
    </div>
    <div class="card backup-card">
      <h2>Cet appareil</h2>
      <p id="storageStatus" class="muted"></p>
      <p>Sur un ordinateur partagé, envoie d’abord ton carnet vers le cloud, puis efface-le de l’appareil avant de partir.</p>
      <button id="wipeDevice" class="danger" type="button">Effacer le carnet de cet appareil</button>
    </div>
  </section>`;
  const feedback = $('backupFeedback');
  const input = $('backupInput');
  const prepare = $('exportBackup');
  const share = $('shareBackup');
  const downloadButton = $('downloadBackup');
  const restore = $('importBackup');
  const cloudFeedback = $('cloudFeedback');
  const BUTTONS = ['exportBackup', 'shareBackup', 'downloadBackup', 'importBackup', 'cloudPush', 'cloudPull', 'cloudCode', 'phraseChange', 'cloudDelete', 'wipeDevice'];
  let pending;
  function report(message) {
    feedback.hidden = false;
    feedback.textContent = message;
  }
  function cloudReport(message) {
    cloudFeedback.hidden = !message;
    cloudFeedback.textContent = message || '';
  }
  function busy(value) {
    backupBusy = value;
    for (const id of BUTTONS) {
      const button = $(id);
      if (button) button.disabled = value;
    }
  }
  busy(backupBusy);

  // Sauvegarde dans un fichier
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
      pending = await makeBackup($('backupEncrypt').checked);
      if (!pending) { report('Sauvegarde annulée.'); return; }
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

  // Restauration d'un fichier
  restore.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file || backupBusy) return;
    busy(true);
    try {
      const data = await readBackup(file);
      if (!data) return;
      if (!restore.isConnected || !confirm(`Restaurer ${data.classes.length} classe(s) et remplacer le carnet sur cet appareil ?`)) return;
      await restoreBackup(data);
      setCloudState({dirty: true});
      location.hash = '#accueil';
      notify('Sauvegarde restaurée.');
    } catch (error) { report(error.message || 'Impossible de restaurer la sauvegarde.'); }
    finally { busy(false); }
  };

  // Carnet en ligne
  function describeCloud(manifest) {
    const local = cloudState.dirty ? ' Cet appareil a des modifications non envoyées.' : '';
    if (!manifest) return `Aucun carnet en ligne pour l’instant.${local}`;
    const same = manifest.version === cloudState.version;
    return `En ligne : version envoyée ${frenchDate(manifest.created)} depuis ${manifest.appareil || 'un appareil'} (${megabytes(manifest.size)}).` +
      (same ? (cloudState.dirty ? local : ' Cet appareil est à jour.') : ' Cet appareil n’a pas encore cette version.' + local);
  }
  async function refreshCloud() {
    const status = $('cloudStatus');
    if (!CarnetCloud.unlocked) {
      status.textContent = cloudState.dirty && cloudState.version ? 'Verrouillé. Cet appareil a des modifications non envoyées.' : 'Verrouillé. Ta phrase secrète te sera demandée.';
      return undefined;
    }
    status.textContent = 'Vérification du carnet en ligne…';
    try {
      const manifest = await CarnetCloud.info();
      if (status.isConnected) status.textContent = describeCloud(manifest);
      return manifest;
    } catch (error) {
      if (status.isConnected) status.textContent = error.message;
      throw error;
    }
  }
  const progressText = (verb, done, total) => total > 1 ? `${verb}… ${Math.round(done / total * 100)} %` : `${verb}…`;

  $('cloudPush').onclick = async () => {
    busy(true);
    cloudReport('');
    try {
      const phrase = await askPhrase();
      if (!phrase) return;
      cloudReport('Chiffrement du carnet…');
      const {json} = await makeSnapshot();
      const bytes = await CarnetCrypto.encrypt(json, phrase);
      const progress = (done, total) => cloudReport(progressText('Envoi', done, total));
      let manifest;
      try {
        manifest = await CarnetCloud.push(bytes, {base: cloudState.version, progress});
      } catch (error) {
        if (error.code !== 'conflit') throw error;
        const other = error.details;
        if (!confirm(`Le carnet en ligne a été envoyé ${frenchDate(other?.created)} depuis ${other?.appareil || 'un autre appareil'}, après la dernière synchronisation de cet appareil.\n\nLe remplacer par le carnet de cet appareil ?`)) {
          cloudReport('Envoi annulé. Tu peux d’abord récupérer la version en ligne.');
          return;
        }
        manifest = await CarnetCloud.push(bytes, {base: cloudState.version, force: true, progress});
      }
      setCloudState({version: manifest.version, created: manifest.created, dirty: false});
      cloudReport(`Carnet envoyé (${megabytes(manifest.size)} chiffrés).`);
      $('cloudStatus').textContent = describeCloud(manifest);
    } catch (error) {
      cloudReport(error.message || 'L’envoi n’a pas abouti.');
    } finally { busy(false); }
  };

  $('cloudPull').onclick = async () => {
    busy(true);
    cloudReport('');
    try {
      const phrase = await askPhrase();
      if (!phrase) return;
      cloudReport('Recherche du carnet en ligne…');
      const manifest = await refreshCloud();
      if (!manifest) { cloudReport('Il n’y a encore aucun carnet en ligne.'); return; }
      const bytes = await CarnetCloud.pull(manifest, (done, total) => cloudReport(progressText('Téléchargement', done, total)));
      cloudReport('Déchiffrement…');
      let text;
      try { text = await CarnetCrypto.decrypt(bytes, phrase); }
      catch { throw Error('Le carnet en ligne a été chiffré avec une autre phrase secrète.'); }
      const data = parseBackup(text);
      const warning = cloudState.dirty ? '\n\nAttention : les modifications faites sur cet appareil depuis le dernier envoi seront perdues.' : '';
      if (!confirm(`Remplacer le carnet de cet appareil par la version en ligne envoyée ${frenchDate(manifest.created)} (${data.classes.length} classe(s)) ?${warning}`)) {
        cloudReport('Récupération annulée.');
        return;
      }
      await restoreBackup(data);
      setCloudState({version: manifest.version, created: manifest.created, dirty: false});
      location.hash = '#accueil';
      notify('Carnet récupéré depuis le cloud.');
    } catch (error) {
      cloudReport(error.message || 'La récupération n’a pas abouti.');
    } finally { busy(false); }
  };

  $('cloudCode').onclick = async () => {
    busy(true);
    try {
      if (!await askPhrase()) return;
      let code = null;
      try { code = localStorage.getItem(PHRASE_CODE_KEY); } catch {}
      if (!code) throw Error('Code introuvable sur cet appareil.');
      $('cloudCodeValue').textContent = code;
      $('cloudCodeBox').hidden = false;
    } catch (error) {
      cloudReport(error.message);
    } finally { busy(false); }
  };
  $('cloudCodeCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('cloudCodeValue').textContent);
      notify('Code copié.');
    } catch {
      notify('Sélectionne le code et copie-le à la main.');
    }
  };

  $('phraseChange').onclick = () => {
    if (!confirm('Changer de phrase secrète ?\n\nTes anciennes sauvegardes resteront lisibles avec l’ancienne phrase. Après le changement, mets à jour CARNET_CLE_ACCES dans Vercel avec le nouveau code, puis renvoie ton carnet.')) return;
    forgetPhrase();
    $('cloudCodeBox').hidden = true;
    refreshCloud().catch(() => {});
    cloudReport('Phrase oubliée sur cet appareil. La nouvelle te sera demandée à la prochaine action.');
  };

  $('cloudDelete').onclick = async () => {
    busy(true);
    try {
      if (!await askPhrase()) return;
      if (!confirm('Supprimer définitivement le carnet en ligne ? Le carnet de cet appareil n’est pas touché.')) return;
      await CarnetCloud.remove();
      setCloudState({version: null, created: null});
      cloudReport('Carnet en ligne supprimé.');
      refreshCloud().catch(() => {});
    } catch (error) {
      cloudReport(error.message);
    } finally { busy(false); }
  };

  // Cet appareil
  CarnetStore.usage().then(info => {
    const status = $('storageStatus');
    if (!status) return;
    const mode = CarnetStore.backend === 'indexeddb' ? 'Le carnet est enregistré dans la base de données du navigateur.' : 'Le carnet est enregistré dans l’ancien stockage du navigateur (place limitée).';
    status.textContent = info ? `${mode} Espace utilisé : ${megabytes(info.used || 0)}${info.quota ? ` sur ${megabytes(info.quota)} disponibles` : ''}.${info.persisted ? ' Stockage protégé contre l’effacement automatique.' : ''}` : mode;
  });

  $('wipeDevice').onclick = async () => {
    const warning = cloudState.dirty ? '\n\nAttention : des modifications n’ont pas été envoyées vers le cloud ni sauvegardées.' : '';
    if (!confirm(`Effacer tout le carnet de cet appareil (classes, photos, notes, fiches, tableaux, phrase secrète) ?${warning}`)) return;
    if (!confirm('Confirme : le carnet sera supprimé de cet appareil. Cette action est définitive.')) return;
    busy(true);
    try {
      sessionPhrase = null;
      CarnetCloud.lock();
      carnetReady = false;
      await CarnetStore.wipe();
      location.replace(location.pathname + '#');
      location.reload();
    } catch {
      busy(false);
      cloudReport('L’effacement n’a pas abouti.');
    }
  };

  updateBackupReminder();
  refreshCloud().catch(() => {});
}

window.addEventListener('pageshow', updateBackupReminder);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateBackupReminder();
});
