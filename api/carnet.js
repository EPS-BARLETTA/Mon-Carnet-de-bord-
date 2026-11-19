// Fonction Vercel : stocke le carnet chiffré dans un store Vercel Blob privé.
// Le serveur ne voit jamais la phrase secrète ni le contenu du carnet : il reçoit des morceaux déjà chiffrés.
//
// Configuration (Vercel → Settings → Environment Variables) :
//   CARNET_CLE_ACCES = code d'accès affiché par le carnet (page Sauvegarde → Configuration et options)
// Et un store Blob en mode « Private » relié au projet (onglet Storage).

import { put, get, del, list } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const PREFIX = 'carnet/';
const MANIFEST = `${PREFIX}actuel.json`;
const PART_LIMIT = 4 * 1024 * 1024;
const MAX_PARTS = 80;
const VERSION = /^[A-Za-z0-9-]{8,64}$/;
const DEVICE = /^[\p{L}\p{N} .'-]{1,40}$/u;

function reply(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function checkAccess(request) {
  const expected = (process.env.CARNET_CLE_ACCES || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) return 'absent';
  const header = request.headers.get('authorization') || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const digest = createHash('sha256').update(key).digest();
  return timingSafeEqual(digest, Buffer.from(expected, 'hex')) ? 'ok' : 'refuse';
}

async function readBlob(pathname) {
  try {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return result;
  } catch (error) {
    if (error?.name === 'BlobNotFoundError') return null;
    throw error;
  }
}

async function readManifest() {
  const result = await readBlob(MANIFEST);
  if (!result) return null;
  return JSON.parse(await new Response(result.stream).text());
}

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

function partPath(version, part) {
  return `${PREFIX}${version}/${part}.bin`;
}

function partParams(url) {
  const version = url.searchParams.get('version');
  const part = Number(url.searchParams.get('part'));
  if (!VERSION.test(version || '') || !Number.isInteger(part) || part < 0 || part >= MAX_PARTS) return null;
  return { version, part };
}

async function handle(request) {
  const access = checkAccess(request);
  if (access === 'absent') return reply(503, { message: 'Le cloud n’est pas configuré (CARNET_CLE_ACCES).' });
  if (access !== 'ok') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return reply(401, { message: 'Accès refusé.' });
  }

  const url = new URL(request.url);
  const method = request.method;

  // Informations sur la version en ligne, ou téléchargement d'un morceau.
  if (method === 'GET') {
    const manifest = await readManifest();
    if (!url.searchParams.has('part')) return manifest ? reply(200, manifest) : reply(404, { vide: true });
    const params = partParams(url);
    if (!params) return reply(400, { message: 'Requête invalide.' });
    if (!manifest || manifest.version !== params.version || params.part >= manifest.parts) return reply(404, { vide: true });
    const result = await readBlob(partPath(params.version, params.part));
    if (!result) return reply(404, { vide: true });
    return new Response(result.stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // Envoi d'un morceau chiffré.
  if (method === 'PUT') {
    const params = partParams(url);
    if (!params) return reply(400, { message: 'Requête invalide.' });
    const body = new Uint8Array(await request.arrayBuffer());
    if (!body.length || body.length > PART_LIMIT) return reply(413, { message: 'Morceau trop volumineux.' });
    await put(partPath(params.version, params.part), Buffer.from(body), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/octet-stream',
    });
    return reply(200, { ok: true });
  }

  // Validation d'un envoi complet : la nouvelle version devient la version en ligne.
  if (method === 'POST' && url.searchParams.get('action') === 'valider') {
    let input;
    try { input = await request.json(); }
    catch { return reply(400, { message: 'Requête invalide.' }); }
    const { version, parts, size, base, force } = input || {};
    if (!VERSION.test(version || '') || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS ||
        !Number.isInteger(size) || size < 1) return reply(400, { message: 'Requête invalide.' });
    const current = await readManifest();
    if (current && force !== true && current.version !== base) return reply(409, { conflit: true, actuel: current });
    const uploaded = await listAll(`${PREFIX}${version}/`);
    const expected = new Set(Array.from({ length: parts }, (_, part) => partPath(version, part)));
    const total = uploaded.filter(blob => expected.has(blob.pathname)).reduce((sum, blob) => sum + blob.size, 0);
    if (uploaded.filter(blob => expected.has(blob.pathname)).length !== parts || total !== size) {
      return reply(400, { message: 'L’envoi est incomplet. Réessaie.' });
    }
    const appareil = typeof input.appareil === 'string' && DEVICE.test(input.appareil) ? input.appareil : 'Appareil';
    const manifest = { version, parts, size, created: new Date().toISOString(), appareil };
    await put(MANIFEST, JSON.stringify(manifest), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    // Nettoyage des anciennes versions et des envois interrompus.
    const old = (await listAll(PREFIX))
      .map(blob => blob.pathname)
      .filter(pathname => pathname !== MANIFEST && !pathname.startsWith(`${PREFIX}${version}/`));
    if (old.length) await del(old);
    return reply(200, manifest);
  }

  // Suppression complète du carnet en ligne.
  if (method === 'DELETE') {
    const all = (await listAll(PREFIX)).map(blob => blob.pathname);
    if (all.length) await del(all);
    return reply(200, { ok: true });
  }

  return reply(405, { message: 'Méthode non prise en charge.' });
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (error) {
      console.error('carnet', error?.name, error?.message);
      return reply(500, { message: 'Erreur du serveur de stockage.' });
    }
  },
};
