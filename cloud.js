'use strict';

// Échanges avec la fonction Vercel /api/carnet. Seules des données déjà chiffrées sur l'appareil sont envoyées.
const CarnetCloud = (() => {
  const ENDPOINT = './api/carnet';
  const PART_SIZE = 3 * 1024 * 1024;
  let key = null;

  class CloudError extends Error {
    constructor(message, code, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }

  function deviceName() {
    const agent = navigator.userAgent;
    if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(agent)) return 'iPhone';
    if (/Android/.test(agent)) return 'Android';
    if (/Macintosh/.test(agent)) return 'Mac';
    if (/Windows/.test(agent)) return 'PC Windows';
    return 'Ordinateur';
  }

  async function call(path, options = {}) {
    if (!key) throw new CloudError('Déverrouille d’abord le cloud avec ta phrase secrète.', 'verrouille');
    let response;
    try {
      response = await fetch(ENDPOINT + path, {
        ...options,
        cache: 'no-store',
        headers: {...options.headers, Authorization: `Bearer ${key}`},
      });
    } catch {
      throw new CloudError('Connexion impossible. Vérifie le réseau.', 'reseau');
    }
    const json = (response.headers.get('content-type') || '').includes('application/json');
    if (!json && !response.ok) {
      throw new CloudError('Le cloud n’existe que sur la version Vercel du carnet.', 'indisponible');
    }
    if (response.ok) return response;
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 && body.vide) return null;
    if (response.status === 401) throw new CloudError('Le serveur refuse cette phrase secrète.', 'refuse');
    if (response.status === 503) throw new CloudError('Le cloud n’est pas encore configuré sur Vercel.', 'non-configure');
    if (response.status === 409) throw new CloudError('Le carnet en ligne a changé depuis un autre appareil.', 'conflit', body.actuel);
    throw new CloudError(body.message || 'Le serveur a renvoyé une erreur.', 'serveur');
  }

  function unlock(accessKey) {
    key = accessKey;
  }

  function lock() { key = null; }

  async function info() {
    const response = await call('');
    return response ? response.json() : null;
  }

  async function push(bytes, {base, force = false, progress = () => {}} = {}) {
    const version = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const parts = Math.max(1, Math.ceil(bytes.length / PART_SIZE));
    for (let part = 0; part < parts; part++) {
      progress(part, parts);
      await call(`?version=${encodeURIComponent(version)}&part=${part}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/octet-stream'},
        body: bytes.slice(part * PART_SIZE, (part + 1) * PART_SIZE),
      });
    }
    progress(parts, parts);
    const response = await call('?action=valider', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({version, parts, size: bytes.length, base: base || null, force, appareil: deviceName()}),
    });
    return response.json();
  }

  async function pull(manifest, progress = () => {}) {
    const output = new Uint8Array(manifest.size);
    let offset = 0;
    for (let part = 0; part < manifest.parts; part++) {
      progress(part, manifest.parts);
      const response = await call(`?version=${encodeURIComponent(manifest.version)}&part=${part}`);
      if (!response) throw new CloudError('Le carnet en ligne vient de changer. Réessaie.', 'conflit');
      const chunk = new Uint8Array(await response.arrayBuffer());
      if (offset + chunk.length > output.length) throw new CloudError('Le carnet en ligne est incomplet.', 'serveur');
      output.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== output.length) throw new CloudError('Le carnet en ligne est incomplet.', 'serveur');
    progress(manifest.parts, manifest.parts);
    return output;
  }

  async function remove() {
    await call('', {method: 'DELETE'});
  }

  return {unlock, lock, info, push, pull, remove, CloudError, get unlocked() { return Boolean(key); }};
})();
