'use strict';

// Verrouillage de l'app (carnet et module Évaluations) : Face ID / Touch ID, ou code.
// Protection d'usage contre un regard indiscret (iPad laissé sur le bureau) : ce n'est pas un chiffrement.
// Réglage enregistré sur l'appareil : {salt, hash, faceId, delay}.
const CarnetLock = (() => {
  const KEY = 'mon-carnet-eps-verrou';
  const AWAY_KEY = 'mon-carnet-eps-verrou-absence';
  const ITERATIONS = 150000;
  let unlocked = false;
  let failures = 0;
  let blockedUntil = 0;

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch { return null; }
  };
  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unb64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

  async function hashCode(code, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS}, key, 256));
  }

  const faceIdAvailable = async () => {
    try { return Boolean(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch { return false; }
  };

  async function registerFaceId() {
    const credential = await navigator.credentials.create({publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: {name: 'Mon Carnet de bord EPS'},
      user: {id: crypto.getRandomValues(new Uint8Array(16)), name: 'Carnet EPS', displayName: 'Carnet EPS'},
      pubKeyCredParams: [{type: 'public-key', alg: -7}, {type: 'public-key', alg: -257}],
      authenticatorSelection: {authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged'},
      timeout: 60000,
    }});
    return b64(credential.rawId);
  }

  async function checkFaceId(id) {
    await navigator.credentials.get({publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{type: 'public-key', id: unb64(id), transports: ['internal']}],
      userVerification: 'required',
      timeout: 60000,
    }});
    return true;
  }

  function overlay() {
    let screen = document.getElementById('carnetLock');
    if (screen) return screen;
    document.body.insertAdjacentHTML('beforeend', `<div id="carnetLock" class="carnet-lock" role="dialog" aria-modal="true" aria-labelledby="carnetLockTitle" hidden>
      <form class="carnet-lock-box" id="carnetLockForm" autocomplete="off">
        <div class="carnet-lock-icon" aria-hidden="true">🔒</div>
        <h2 id="carnetLockTitle">Carnet verrouillé</h2>
        <button type="button" id="carnetLockFace" class="carnet-lock-face" hidden>Déverrouiller avec Face ID</button>
        <label for="carnetLockCode">Code</label>
        <input id="carnetLockCode" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" required>
        <button type="submit" class="carnet-lock-ok">Déverrouiller</button>
        <p id="carnetLockError" class="carnet-lock-error" role="alert"></p>
        <details class="carnet-lock-forgot"><summary>Code oublié ?</summary>
          <p>Efface le carnet de cet appareil, puis récupère-le depuis le cloud ou une sauvegarde avec ta phrase secrète.</p>
          <button type="button" id="carnetLockWipe" class="carnet-lock-wipe">Effacer le carnet de cet appareil</button>
        </details>
      </form>
    </div>`);
    screen = document.getElementById('carnetLock');
    return screen;
  }

  function show() {
    const settings = read();
    if (!settings) return;
    unlocked = false;
    document.documentElement.classList.add('carnet-locked');
    const screen = overlay();
    const code = document.getElementById('carnetLockCode');
    const error = document.getElementById('carnetLockError');
    const face = document.getElementById('carnetLockFace');
    screen.hidden = false;
    code.value = '';
    error.textContent = '';
    face.hidden = !settings.faceId;
    face.onclick = async () => {
      error.textContent = '';
      try {
        await checkFaceId(settings.faceId);
        hide();
      } catch {
        error.textContent = 'Face ID n’a pas abouti. Utilise ton code.';
        code.focus();
      }
    };
    document.getElementById('carnetLockForm').onsubmit = async event => {
      event.preventDefault();
      if (Date.now() < blockedUntil) {
        error.textContent = `Trop d’essais. Réessaie dans ${Math.ceil((blockedUntil - Date.now()) / 1000)} s.`;
        return;
      }
      if (await hashCode(code.value, unb64(settings.salt)) === settings.hash) {
        failures = 0;
        hide();
        return;
      }
      failures++;
      if (failures >= 5) blockedUntil = Date.now() + 30000 * (failures - 4);
      code.value = '';
      error.textContent = 'Code incorrect.';
      code.focus();
    };
    document.getElementById('carnetLockWipe').onclick = async () => {
      if (!confirm('Effacer tout le carnet de cet appareil ? Tu pourras le récupérer depuis le cloud ou une sauvegarde avec ta phrase secrète.')) return;
      await CarnetStore.wipe();
      try { localStorage.removeItem(KEY); } catch {}
      location.replace(location.pathname.replace(/classeur\/.*$/, '') + '#sauvegarde');
      location.reload();
    };
    if (settings.faceId) face.focus();
    else code.focus();
  }

  function hide() {
    unlocked = true;
    document.documentElement.classList.remove('carnet-locked');
    const screen = document.getElementById('carnetLock');
    if (screen) screen.hidden = true;
    try { sessionStorage.setItem(AWAY_KEY, String(Date.now())); } catch {}
  }

  // Verrouille à l'ouverture, puis au retour dans l'app après une absence plus longue que le délai choisi.
  function start() {
    const settings = read();
    if (!settings) return;
    let lastSeen = 0;
    try { lastSeen = Number(sessionStorage.getItem(AWAY_KEY)) || 0; } catch {}
    // Passage du carnet au module (même session, moins d'une minute) : pas de nouveau verrouillage.
    if (lastSeen && Date.now() - lastSeen < 60000) unlocked = true;
    else show();
    document.addEventListener('visibilitychange', () => {
      const current = read();
      if (!current) return;
      if (document.hidden) {
        if (unlocked) try { sessionStorage.setItem(AWAY_KEY, String(Date.now())); } catch {}
        return;
      }
      let away = 0;
      try { away = Number(sessionStorage.getItem(AWAY_KEY)) || 0; } catch {}
      if (unlocked && Date.now() - away >= (current.delay ?? 5) * 60000) show();
    });
    window.addEventListener('pagehide', () => {
      if (unlocked) try { sessionStorage.setItem(AWAY_KEY, String(Date.now())); } catch {}
    });
  }

  async function enable(code, {faceId = false, delay = 5} = {}) {
    if (!/^\d{4,8}$/.test(code)) throw Error('Choisis un code de 4 à 8 chiffres.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const settings = {salt: b64(salt), hash: await hashCode(code, salt), faceId: null, delay};
    if (faceId) settings.faceId = await registerFaceId();
    localStorage.setItem(KEY, JSON.stringify(settings));
    unlocked = true;
    try { sessionStorage.setItem(AWAY_KEY, String(Date.now())); } catch {}
  }

  async function verify(code) {
    const settings = read();
    return Boolean(settings && await hashCode(code, unb64(settings.salt)) === settings.hash);
  }

  function disable() {
    try { localStorage.removeItem(KEY); } catch {}
  }

  function setDelay(delay) {
    const settings = read();
    if (!settings) return;
    localStorage.setItem(KEY, JSON.stringify({...settings, delay}));
  }

  return {start, enable, disable, verify, setDelay, faceIdAvailable, show, get settings() { return read(); }};
})();

CarnetLock.start();
