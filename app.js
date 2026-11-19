'use strict';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const STORAGE_KEY = 'mon-carnet-eps-v1';
const HOME_KEY = 'mon-carnet-eps-accueil';
const BUILTIN_PHOTOS = {
  'fond:cabines': ['Cabines jaunes et orange', './fonds/cabines.webp'],
  'fond:glacier': ['Glacier sous le ciel bleu', './fonds/glacier.webp'],
  'fond:telepherique': ['Téléphérique dans les Alpes', './fonds/telepherique.webp'],
  'fond:el-capitan': ['Escalade · El Capitan — Yosemite', './fonds/el-capitan.webp'],
  'fond:verdon': ['Escalade · Gorges du Verdon', './fonds/verdon.webp'],
  'fond:fontainebleau': ['Escalade · Blocs de Fontainebleau', './fonds/fontainebleau.webp'],
};
const APPEARANCE_COLORS = {
  vert: ['Vert', '#226047', '#e8f3eb'],
  bleu: ['Bleu', '#254e82', '#e9f1fc'],
  violet: ['Violet', '#65428b', '#f2eafb'],
  terre: ['Terracotta', '#884630', '#faeee8'],
  ardoise: ['Ardoise', '#425968', '#eaf0f4'],
  rose: ['Rose', '#8a315c', '#faebf3'],
  turquoise: ['Turquoise', '#17676d', '#e7f5f4'],
  ocre: ['Ocre', '#76540e', '#fbf2d9'],
  bordeaux: ['Bordeaux', '#843446', '#faebef'],
  indigo: ['Indigo', '#414487', '#eeeeff'],
};
const DEFAULT_HOME = {
  title: 'Mon Carnet de bord EPS',
  intro: 'Fais l’appel, retrouve les notes et organise tes séances par classe.',
  color: 'vert',
  photo: '',
  menuPhoto: '',
};
const MAX_OPEN_BOARDS = 4;
const content = $('content');
const cover = content.innerHTML;
let classes = [];
let canReadStorage = true;
let homeSettings = {};
let carnetReady = false;

function loadCarnet(stored) {
  canReadStorage = true;
  try {
    const saved = JSON.parse(stored.classes || '[]');
    if (!Array.isArray(saved)) throw Error('Format incorrect');
    classes = saved.map(group => {
      if (Array.isArray(group.boards)) return group;
      const {board, boardArchives, ...rest} = group;
      return {...rest, boards: [{id: 'principal', name: 'Tableau principal', board, boardArchives}]};
    });
  } catch {
    classes = [];
    canReadStorage = false;
  }
  try { homeSettings = JSON.parse(stored.home || '{}') || {}; }
  catch { homeSettings = {}; }
  assignClassColors();
}
try { localStorage.removeItem('mon-carnet-eps-pronote-direct'); } catch {}

let noticeTimer;
function notify(message) {
  const notice = $('appNotice');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 3800);
}

function storageErrorMessage(error) {
  return error?.name === 'QuotaExceededError'
    ? 'Le stockage de ce navigateur est plein. Les modifications n’ont pas été enregistrées.'
    : 'Enregistrement impossible dans ce navigateur.';
}

CarnetStore.onError = error => notify(storageErrorMessage(error));

function save(reportError = notify) {
  try {
    if (!canReadStorage || !carnetReady) throw Error('Lecture du stockage impossible');
    CarnetStore.set('classes', JSON.stringify(classes));
    if (typeof markCarnetChanged === 'function') markCarnetChanged();
    return true;
  } catch (error) {
    reportError(storageErrorMessage(error));
    return false;
  }
}

function saveHome(settings) {
  homeSettings = settings;
  CarnetStore.set('home', JSON.stringify(settings));
  if (typeof markCarnetChanged === 'function') markCarnetChanged();
}

function download(name, data, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function classRoute(group) {
  return `#classe/${group.id}`;
}

function appearanceColor(value) {
  return Object.hasOwn(APPEARANCE_COLORS, value) ? value : 'vert';
}

function nextClassColor(groups) {
  const colors = Object.keys(APPEARANCE_COLORS);
  const counts = new Map(colors.map(color => [color, 0]));
  for (const {color} of groups) {
    if (counts.has(color)) counts.set(color, counts.get(color) + 1);
  }
  return colors.reduce((best, color) => counts.get(color) < counts.get(best) ? color : best);
}

function assignClassColors() {
  const assigned = [];
  for (const group of classes) {
    if (!Object.hasOwn(APPEARANCE_COLORS, group.color) ||
        (!group.colorAssigned && group.color === 'vert' && assigned.some(item => item.color === 'vert'))) {
      continue;
    }
    group.colorAssigned = true;
    assigned.push(group);
  }
  for (const group of classes) {
    if (assigned.includes(group)) continue;
    group.color = nextClassColor(assigned);
    group.colorAssigned = true;
    assigned.push(group);
  }
}

function appearanceOptions(value) {
  return Object.entries(APPEARANCE_COLORS).map(([id, [label]]) =>
    `<option value="${id}" ${appearanceColor(value) === id ? 'selected' : ''}>${label}</option>`).join('');
}

function appearanceStyle(color) {
  const [, ink, tint] = APPEARANCE_COLORS[appearanceColor(color)];
  return `--personal-color:${ink};--personal-tint:${tint}`;
}

function homeAppearance() {
  try {
    const settings = homeSettings || {};
    return {
      title: typeof settings.title === 'string' && settings.title.trim() ? settings.title.trim().slice(0, 70) : DEFAULT_HOME.title,
      intro: typeof settings.intro === 'string' ? settings.intro.slice(0, 160) : DEFAULT_HOME.intro,
      color: appearanceColor(settings.color),
      photo: appearancePhoto(settings.photo),
      menuPhoto: appearancePhoto(settings.menuPhoto),
    };
  } catch { return DEFAULT_HOME; }
}

function appearancePhoto(value) {
  if (typeof value !== 'string') return '';
  if (Object.hasOwn(BUILTIN_PHOTOS, value)) return value;
  return value.length <= 1000000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
}

function appearancePhotoSource(value) {
  const photo = appearancePhoto(value);
  return BUILTIN_PHOTOS[photo]?.[1] || photo;
}

function bannerPhoto(value) {
  const photo = appearancePhotoSource(value);
  return photo ? `<img class="banner-photo" src="${photo}" alt="">` : '';
}

function photoFields(prefix, label) {
  return `<label for="${prefix}Preset">${label}</label>
    <select id="${prefix}Preset">
      <option value="">Sans photo</option>
      ${Object.entries(BUILTIN_PHOTOS).map(([id, [name]]) => `<option value="${id}">${name}</option>`).join('')}
      <option value="custom" hidden>Photo personnelle</option>
    </select>
    <small><a href="./fonds/credits.html" target="_blank" rel="noopener">Crédits des photos d’escalade</a></small>
    <label for="${prefix}Photo">Importer une photo personnelle</label>
    <input id="${prefix}Photo" type="file" accept="image/*">
    <img id="${prefix}PhotoPreview" class="home-photo-preview" alt="Aperçu" hidden>
    <button id="${prefix}PhotoRemove" type="button" hidden>Retirer la photo</button>
    <p id="${prefix}PhotoStatus" class="muted" role="status" hidden></p>`;
}

function photoPicker(prefix, initial, maxSide = 1280) {
  let photo = appearancePhoto(initial);
  let pending = false;
  let photoRequest = 0;
  const fileInput = $(prefix + 'Photo');
  const preset = $(prefix + 'Preset');
  const preview = $(prefix + 'PhotoPreview');
  const remove = $(prefix + 'PhotoRemove');
  const status = $(prefix + 'PhotoStatus');
  function showPhoto() {
    preview.hidden = remove.hidden = !photo;
    const integrated = Object.hasOwn(BUILTIN_PHOTOS, photo);
    preset.options[preset.options.length - 1].hidden = !photo || integrated;
    preset.value = photo && !integrated ? 'custom' : photo;
    if (photo) preview.src = appearancePhotoSource(photo);
    else preview.removeAttribute('src');
  }
  function clearPhoto() {
    photoRequest++;
    photo = '';
    status.hidden = true;
    pending = false;
    showPhoto();
  }
  remove.onclick = clearPhoto;
  preset.onchange = () => {
    if (preset.value === 'custom') return;
    photoRequest++;
    pending = false;
    photo = appearancePhoto(preset.value);
    status.hidden = true;
    showPhoto();
  };
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const request = ++photoRequest;
    pending = true;
    status.hidden = false;
    status.textContent = 'Préparation de la photo…';
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('La photo dépasse 30 Mo.');
      const image = await imageFromFile(file);
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = rosterCanvas(Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const encoded = canvas.toDataURL('image/jpeg', .8);
      if (encoded.length > 1000000) throw new Error('Choisis une photo moins détaillée.');
      if (request !== photoRequest) return;
      photo = encoded;
      status.hidden = true;
      showPhoto();
    } catch (error) {
      if (request === photoRequest) status.textContent = error.message || 'Impossible d’ouvrir la photo.';
    } finally {
      if (request === photoRequest) pending = false;
    }
  };
  showPhoto();
  return {value: () => photo, busy: () => pending, clear: clearPhoto};
}

function renderHomeSettings() {
  const current = homeAppearance();
  content.innerHTML = `<section class="route class-form">
    <a class="back-link" href="#accueil">← Accueil</a>
    <h1>Personnaliser l’accueil</h1>
    <form class="card" id="homeAppearance">
      <label for="homeTitle">Titre du carnet</label>
      <input id="homeTitle" maxlength="70" required value="${esc(current.title)}">
      <label for="homeIntro">Texte d’accueil</label>
      <textarea id="homeIntro" rows="2" maxlength="160">${esc(current.intro)}</textarea>
      <label for="homeColor">Couleur de l’accueil</label>
      <select id="homeColor">${appearanceOptions(current.color)}</select>
      ${photoFields('home', 'Photo de la page de garde')}
      ${photoFields('menu', 'Fond de l’accueil du carnet')}
      <div class="actions">
        <button id="homeReset" type="button">Rétablir les valeurs par défaut</button>
        <button id="homeSave" class="primary">Enregistrer</button>
      </div>
    </form>
  </section>`;
  const coverPhoto = photoPicker('home', current.photo);
  const menuPhoto = photoPicker('menu', current.menuPhoto, 1000);
  $('homeReset').onclick = () => {
    $('homeTitle').value = DEFAULT_HOME.title;
    $('homeIntro').value = DEFAULT_HOME.intro;
    $('homeColor').value = DEFAULT_HOME.color;
    coverPhoto.clear();
    menuPhoto.clear();
  };
  $('homeAppearance').onsubmit = event => {
    event.preventDefault();
    if (coverPhoto.busy() || menuPhoto.busy()) { notify('La photo est en cours de préparation.'); return; }
    try {
      saveHome({
        title: $('homeTitle').value.trim() || DEFAULT_HOME.title,
        intro: $('homeIntro').value.trim(),
        color: appearanceColor($('homeColor').value),
        photo: coverPhoto.value(),
        menuPhoto: menuPhoto.value(),
      });
    } catch {
      notify('Enregistrement impossible dans ce navigateur.');
      return;
    }
    location.hash = '#accueil';
  };
}

function boardRoute(group, board) {
  return `${classRoute(group)}/tableau/${board.id}`;
}

function createNamedBoard(group, name, board, term = '1') {
  const entry = {id: uid(), name, board, term};
  group.boards.push(entry);
  if (save()) return entry;
  group.boards.pop();
}

function openBoardView(group, boards) {
  if (boards.length === 1) location.hash = boardRoute(group, boards[0]);
  else if (boards.length) location.hash = `${classRoute(group)}/tableaux/${boards.map(board => board.id).join(',')}`;
  else location.hash = classRoute(group);
}

function rememberSession(group, boards) {
  const previous = group.sessionBoards;
  const ids = boards.map(board => board.id);
  if (JSON.stringify(previous) === JSON.stringify(ids)) return true;
  group.sessionBoards = ids;
  if (save()) return true;
  group.sessionBoards = previous;
  return false;
}

function openSession(group, session, hidden = []) {
  const route = `${classRoute(group)}/seance/${session.id}` + (hidden.length ? '/' + hidden.join(',') : '');
  if (location.hash === route) render();
  else location.hash = route;
}

function renderBoardDirectory(group, term) {
  const visibleBoards = term ? group.boards.filter(board => (board.term || '1') === term) : group.boards;
  const standalone = visibleBoards.filter(board => !board.panels?.length);
  const session = (group.sessionBoards || []).map(id => standalone.find(board => board.id === id)).filter(Boolean);
  const resume = session.length > 1 ? session : standalone.slice(0, MAX_OPEN_BOARDS);
  content.innerHTML = `<section class="route">
    <a class="back-link" href="${classRoute(group)}/appel/${term || '1'}">← Carnet de classe</a>
    <div class="route-head">
      <h1>${esc(group.name)}</h1>
      <div class="class-nav-actions">
        ${resume.length > 1 ? `<button id="resumeSession" class="primary" type="button">${session.length ? 'Reprendre la séance' : 'Ouvrir les tableaux ensemble'} · ${resume.length}</button>` : ''}
        <a href="${classRoute(group)}/eleves">Élèves et trombinoscope</a>
        <button id="importSession" type="button">Importer une séance</button>
        <input id="sessionFile" hidden type="file" accept=".json,application/json">
        <button id="newBoard" class="primary" type="button">+ Nouvelle séance</button>
      </div>
    </div>
    ${visibleBoards.length ? `<div class="class-grid">${visibleBoards.map(board => `<div class="board-directory-card">
      <a href="${boardRoute(group, board)}">${esc(board.name)}${board.panels?.length ? ` · ${board.panels.length + 1} tableaux` : ''}</a>
      <button class="board-delete danger" type="button" data-delete-board="${esc(board.id)}"
        aria-label="Supprimer ${esc(board.name)}" title="Supprimer le tableau">×</button>
    </div>`).join('')}</div>` : '<p>Aucun tableau dans cette classe.</p>'}
    <dialog id="newBoardDialog" aria-labelledby="newBoardTitle">
      <h2 id="newBoardTitle">Nouvelle séance</h2>
      <form id="createBoard">
        <label for="newBoardName">Nom de la séance</label>
        <input id="newBoardName" maxlength="80" placeholder="Ex. Badminton" required autofocus>
        <div class="actions">
          <button id="cancelNewBoard" type="button">Annuler</button>
          <button class="primary" type="submit">Créer la séance</button>
        </div>
      </form>
    </dialog>
  </section>`;
  $('importSession').onclick = () => $('sessionFile').click();
  $('sessionFile').onchange = async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const session = await importSessionFile(file, group);
      if (session) {
        session.term = term || '1';
        save();
        openSession(group, session);
      }
    } catch (error) {
      notify(error.message);
    }
  };
  const dialog = $('newBoardDialog');
  const resumeButton = $('resumeSession');
  if (resumeButton) resumeButton.onclick = () => openBoardView(group, resume);
  const input = $('newBoardName');
  $('newBoard').onclick = () => dialog.showModal();
  $('cancelNewBoard').onclick = () => dialog.close();
  $('createBoard').onsubmit = event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const board = createNamedBoard(group, name, undefined, term);
    if (board) openSession(group, board);
  };
  for (const button of content.querySelectorAll('[data-delete-board]')) {
    button.onclick = () => {
      const previous = group.boards;
      const board = previous.find(item => item.id === button.dataset.deleteBoard);
      if (!confirm(`Supprimer définitivement « ${board.name} » et ses sauvegardes ?`)) return;
      group.boards = previous.filter(item => item !== board);
      if (save()) {
        renderBoardDirectory(group, term);
        $('newBoard').focus({preventScroll: true});
      } else group.boards = previous;
    };
  }
}

function renderOpenBoards(group, boards, session = null, hidden = []) {
  const students = [...group.students].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const multiple = boards.length > 1;
  const allPanels = session ? [session, ...(session.panels || [])] : boards;
  const canAddBoard = session || boards.length < MAX_OPEN_BOARDS;
  const available = (session ? allPanels : group.boards).filter(board => !boards.includes(board));
  const sessionName = session?.name || (multiple ? group.name : boards[0].name);
  content.innerHTML = `<div class="class-nav">
    <a href="${classRoute(group)}/tableau-blanc/${session?.term || boards[0]?.term || '1'}">← Tableaux de ${esc(group.name)}</a>
    <h1>${esc(sessionName)}</h1>
    <div class="class-nav-actions">
      <button id="saveSession" class="tool-purple" type="button">${session ? 'Nommer la séance' : 'Regrouper et nommer'}</button>
      <button id="exportSession" class="tool-blue" type="button">Télécharger la séance</button>
      <button id="captureSession" type="button">Capture PNG</button>
      ${canAddBoard ? '<button id="addOpenBoard" class="primary" type="button">+ Ajouter un tableau</button>' : ''}
      ${canAddBoard && available.length ? `<select id="openSavedBoard" aria-label="Ouvrir un tableau enregistré">
        <option value="">Ouvrir un tableau enregistré</option>
        ${available.map(board => `<option value="${esc(board.id)}">${esc(board.name)}</option>`).join('')}
      </select>` : ''}
      <a href="${classRoute(group)}/eleves">Gérer les élèves</a>
    </div>
  </div><dialog id="sessionNameDialog"><form id="sessionNameForm"><label for="sessionName">Nom de la séance</label><input id="sessionName" maxlength="80" required><div class="actions"><button id="sessionNameCancel" type="button">Annuler</button><button class="primary">Enregistrer</button></div></form></dialog><div class="open-boards${multiple ? ' open-boards-multiple' : ''}"></div>`;
  if (!session && multiple) rememberSession(group, boards);
  const nameDialog = $('sessionNameDialog');
  $('saveSession').onclick = () => {
    $('sessionName').value = sessionName;
    nameDialog.showModal();
  };
  $('sessionNameCancel').onclick = () => nameDialog.close();
  $('sessionNameForm').onsubmit = event => {
    event.preventDefault();
    const name = $('sessionName').value.trim();
    if (!name) return;
    if (session) {
      const previous = session.name;
      session.name = name;
      if (!save()) { session.name = previous; return; }
      openSession(group, session, hidden);
      return;
    }
    const [first, ...others] = boards;
    const combined = {...first, id: uid(), name,
      panels: others.map(board => ({id: uid(), name: board.name, board: board.board, boardArchives: board.boardArchives}))};
    group.boards.push(combined);
    if (save()) openSession(group, combined);
    else group.boards.pop();
  };
  $('exportSession').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await downloadSessionFile(group, sessionName, allPanels);
    } catch (error) {
      notify(error.message || 'Impossible d’exporter cette séance.');
    } finally {
      button.disabled = false;
    }
  };
  if (canAddBoard) {
    $('addOpenBoard').onclick = () => {
      if (session) {
        const previous = session.panels;
        const existing = previous || [];
        const names = new Set(existing.map(panel => panel.name));
        let number = existing.length + 2;
        while (names.has(`Tableau ${number}`)) number++;
        session.panels = [...existing, {id: uid(), name: `Tableau ${number}`}];
        if (save()) openSession(group, session, hidden);
        else session.panels = previous;
        return;
      }
      const [first, ...others] = boards;
      const combined = {...first, id: uid(), panels: [
        ...others.map(board => ({id: uid(), name: board.name, board: board.board, boardArchives: board.boardArchives})),
        {id: uid(), name: `Tableau ${boards.length + 1}`},
      ]};
      group.boards.push(combined);
      if (save()) openSession(group, combined);
      else group.boards.pop();
    };
  }
  const savedPicker = $('openSavedBoard');
  if (savedPicker) {
    savedPicker.onchange = () => {
      const board = available.find(item => item.id === savedPicker.value);
      if (!board) return;
      if (session) openSession(group, session, hidden.filter(id => id !== board.id));
      else openBoardView(group, [...boards, board]);
    };
  }
  const grid = content.querySelector('.open-boards');
  $('captureSession').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const image = await captureBoardSession(grid, group.name, boards.map(board => board.name));
      download(`Seance-${group.name.replace(/[^a-z0-9_-]/gi, '_')}-${today()}.png`, image, 'image/png');
    } catch {
      notify('La capture PNG n’a pas pu être créée.');
    } finally {
      button.disabled = false;
    }
  };
  for (const board of boards) {
    const container = document.createElement('div');
    grid.append(container);
    renderClassBoard(board, students, group.id, container, multiple,
      (name, layout) => createNamedBoard(group, name, layout, session?.term || board.term),
      () => {
        if (!session) openBoardView(group, boards.filter(item => item !== board));
        else if (boards.length === 1) location.hash = classRoute(group);
        else openSession(group, session, [...hidden, board.id]);
      });
  }
}

function renderMenu() {
  const home = homeAppearance();
  content.innerHTML = `<section class="route home-menu" style="${appearanceStyle(home.color)}">
    <header class="home-heading photo-banner">
      ${bannerPhoto(home.menuPhoto)}
      <div><h1>${esc(home.title)}</h1>${home.intro ? `<p>${esc(home.intro)}</p>` : ''}</div>
      <a class="action home-settings" href="#personnaliser">Personnaliser l’accueil</a>
    </header>
    <div class="menu-grid">
      <a class="menu-card" href="#classes"><span class="menu-icon" aria-hidden="true">▦</span><h2>Mes classes</h2><p>Retrouve tes classes et leurs tableaux.</p></a>
      <a class="menu-card" href="#creer"><span class="menu-icon" aria-hidden="true">+</span><h2>Créer une classe</h2><p>Importe un trombinoscope PRONOTE ou saisis une liste.</p></a>
    </div>
  </section>`;
}

function renderDirectory() {
  content.innerHTML = `<section class="route">
    <div class="route-head"><h1>Mes classes</h1><a class="primary action" href="#creer">Créer une classe</a></div>
    ${classes.length ? `<div class="class-grid class-directory-grid">${classes.map(group => `<a class="menu-card class-tile photo-banner" style="${appearanceStyle(group.color)}" href="${classRoute(group)}">
      ${bannerPhoto(group.banner)}
      <div><h2>${esc(group.name)}</h2><p>${group.students.length} élève${group.students.length === 1 ? '' : 's'} · ${group.boards.length} tableau${group.boards.length === 1 ? '' : 'x'}</p></div>
    </a>`).join('')}</div>` : '<p>Aucune classe pour le moment. Tu peux en créer une avec ton trombinoscope.</p>'}
  </section>`;
}

function renderClassForm(group) {
  const heading = group ? 'Élèves de ' + group.name : 'Créer une classe';
  content.innerHTML = `<section class="route class-form">
    <a class="back-link" href="${group ? classRoute(group) : '#accueil'}">← ${group ? 'Carnet de classe' : 'Accueil'}</a>
    <h1>${esc(heading)}</h1>
    <form id="classForm" class="card">
      <label for="className">Nom de la classe</label>
      <input id="className" maxlength="80" required value="${esc(group?.name || '')}" placeholder="Ex. 6e B">
      <label for="classColor">Couleur de la classe</label>
      <select id="classColor">${appearanceOptions(group?.color || nextClassColor(classes))}</select>
      ${photoFields('classBanner', 'Fond du bandeau de la classe')}
      <label class="choice-line"><input id="classPrincipal" type="checkbox" ${group?.principal === true ? 'checked' : ''}> Je suis professeur principal de cette classe</label>
      <div class="roster-import">
        <button id="importPortraits" class="primary" type="button">Importer un trombinoscope</button>
        <input type="file" id="pictureInput" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden>
        <p class="muted">Choisis une capture PRONOTE en JPG ou PNG, avec les photos et les noms visibles. Les portraits restent sur l’appareil.</p>
      </div>
      ${group ? '<h2>Liste des élèves</h2><ul id="rosterPreview" class="roster-preview"></ul>' : ''}
      <label for="manualNames">${group ? 'Ajouter des élèves à la liste' : 'Saisir les élèves à la main'}</label>
      <textarea id="manualNames" rows="4" placeholder="Un nom et un prénom par ligne"></textarea>
      <button class="${group ? 'primary' : ''}" type="submit">${group ? 'Enregistrer' : 'Créer la classe'}</button>
    </form>
    ${group ? `<div class="actions"><button id="deleteClass" class="danger" type="button">Supprimer cette classe</button></div>` : ''}
  </section>`;
  const name = $('className');
  const file = $('pictureInput');
  const photo = photoPicker('classBanner', group?.banner, 800);

  if (group) {
    $('deleteClass').onclick = () => {
      if (!confirm(`Supprimer « ${group.name} » de cet appareil ? Ses élèves, photos, appels, notes, bulletins et tableaux seront retirés. Une sauvegarde existante pourra être restaurée.`)) return;
      const previous = classes;
      classes = classes.filter(item => item.id !== group.id);
      if (!save()) {
        classes = previous;
        return;
      }
      location.hash = '#classes';
      notify(`Classe « ${group.name} » supprimée.`);
    };
  }

  function validName() {
    if (photo.busy()) { notify('La photo est en cours de préparation.'); return false; }
    name.setCustomValidity(name.value.trim() ? '' : 'Indique le nom de la classe.');
    return name.reportValidity();
  }

  name.oninput = () => name.setCustomValidity('');

  function paintRoster() {
    const list = $('rosterPreview');
    if (!list) return;
    list.replaceChildren(...group.students.map(student => {
      const item = document.createElement('li');
      item.append(RosterPortraits.photo(student.portrait), document.createTextNode(student.name));
      return item;
    }));
  }

  function saveRoster(students, reportError) {
    const previous = classes;
    const updated = {...group, id: group?.id || uid(), name: name.value.trim(),
      color: appearanceColor($('classColor').value), colorAssigned: true, students,
      banner: photo.value(), principal: $('classPrincipal').checked,
      boards: group?.boards || [{id: 'principal', name: 'Tableau principal'}]};
    classes = group ? classes.map(c => c.id === group.id ? updated : c) : [...classes, updated];
    if (!save(reportError)) {
      classes = previous;
      return false;
    }
    if (group) Object.assign(group, updated);
    else location.hash = classRoute(updated);
    return true;
  }

  $('importPortraits').onclick = () => { if (validName()) file.click(); };
  file.onchange = () => {
    const selected = file.files[0];
    file.value = '';
    if (!selected) return;
    RosterPortraits.importRoster({
      file: selected,
      className: group ? '' : name.value.trim(),
      items: group?.students.map(student => ({...student, line: student.name})) || [],
      itemName: line => ({name: line}),
      save(items, reportError) {
        const students = items.map(item => ({
          id: item.id || uid(), name: item.line,
          ...(validRosterPortrait(item.portrait) ? {portrait: item.portrait} : {}),
        }));
        if (!saveRoster(students, reportError)) return false;
        items.forEach((item, index) => { item.id = students[index].id; });
        paintRoster();
        notify('Trombinoscope enregistré.');
        return true;
      },
    });
  };

  $('classForm').onsubmit = event => {
    event.preventDefault();
    if (!validName()) return;
    const students = [...(group?.students || [])];
    const names = new Set(students.map(student => portraitNameKey(student.name)));
    for (const line of $('manualNames').value.split(/\r?\n/)) {
      const cleaned = line.trim().replace(/\s+/g, ' ').slice(0, 120);
      const key = portraitNameKey(cleaned);
      if (!key || names.has(key)) continue;
      names.add(key);
      students.push({id: uid(), name: cleaned});
    }
    if (!students.length && !group) {
      notify('Ajoute au moins un élève, ou importe le trombinoscope.');
      return;
    }
    if (saveRoster(students) && group) location.hash = classRoute(group);
  };
  paintRoster();
}

function render() {
  if (!carnetReady) return;
  const [page, id, subpage, boardId, hiddenIds] = location.hash.slice(1).split('/');
  updateBackupReminder();
  $('navHome').hidden = !page || page === 'accueil';
  const home = homeAppearance();
  document.querySelector('.brand').textContent = home.title;
  document.title = home.title;
  if (!page) {
    content.innerHTML = cover;
    const hero = content.querySelector('.cover');
    hero.style.cssText = appearanceStyle(home.color);
    hero.querySelector('h1').textContent = home.title;
    const intro = hero.querySelector('p');
    intro.textContent = home.intro;
    intro.hidden = !home.intro;
    if (home.photo) {
      const image = document.createElement('img');
      image.className = 'cover-photo';
      image.src = appearancePhotoSource(home.photo);
      image.alt = 'Photo d’accueil personnalisée';
      hero.querySelector('.cover-art').replaceWith(image);
    }
  } else if (page === 'sauvegarde') {
    renderBackup();
  } else if (page === 'personnaliser') {
    renderHomeSettings();
  } else if (page === 'creer') {
    renderClassForm();
  } else if (page === 'classes') {
    renderDirectory();
  } else if (page === 'classe') {
    const group = classes.find(c => c.id === id);
    if (!group) {
      renderDirectory();
    } else if (!subpage || ['appel', 'notes', 'bulletins', 'conseil', 'trombinoscope'].includes(subpage)) {
      const tab = subpage === 'conseil' && group.principal !== true ? 'bulletins' : subpage || 'appel';
      renderCarnet(group, tab, ['1', '2', '3'].includes(boardId) ? boardId : '1');
    } else if (subpage === 'tableau-blanc') {
      renderBoardDirectory(group, ['1', '2', '3'].includes(boardId) ? boardId : '1');
    } else if (subpage === 'eleves') {
      renderClassForm(group);
    } else if (subpage === 'seance' || subpage === 'tableau') {
      const session = group.boards.find(board => board.id === boardId);
      if (!session) { renderBoardDirectory(group); return; }
      const hidden = (hiddenIds || '').split(',').filter(Boolean);
      const panels = [session, ...(session.panels || [])].filter(panel => !hidden.includes(panel.id));
      if (panels.length) renderOpenBoards(group, panels, session, hidden);
      else renderBoardDirectory(group);
    } else {
      const ids = subpage === 'tableaux' ? (boardId || '').split(',').slice(0, MAX_OPEN_BOARDS)
        : subpage === 'tableau' ? [boardId] : [];
      const boards = [...new Set(ids)].map(id => group.boards.find(board => board.id === id)).filter(Boolean);
      if (boards.length) renderOpenBoards(group, boards);
      else renderBoardDirectory(group);
    }
  } else {
    renderMenu();
  }
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
CarnetStore.load().then(stored => {
  loadCarnet(stored);
  carnetReady = true;
  render();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
