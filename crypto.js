'use strict';

// Chiffrement des sauvegardes : AES-GCM 256 bits, clé dérivée de la phrase secrète (PBKDF2-SHA256).
// Format binaire : "CARNETEPS" + version (1 octet) + options (1 octet) + sel (16) + IV (12) + données chiffrées.
const CarnetCrypto = (() => {
  const MAGIC = new TextEncoder().encode('CARNETEPS');
  const VERSION = 1;
  const ITERATIONS = 600000;
  const HEADER = MAGIC.length + 2 + 16 + 12;
  const FLAG_GZIP = 1;
  const ACCESS_SALT = new TextEncoder().encode('mon-carnet-eps:acces-cloud:v1');

  const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

  async function baseKey(phrase) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(phrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
  }

  async function encryptionKey(phrase, salt) {
    return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS},
      await baseKey(phrase), {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  }

  async function transform(bytes, Stream) {
    const stream = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function isEncrypted(bytes) {
    return bytes.length > HEADER && MAGIC.every((byte, index) => bytes[index] === byte);
  }

  async function encrypt(plain, phrase) {
    let data = plain instanceof Uint8Array ? plain : new TextEncoder().encode(plain);
    let flags = 0;
    if (typeof CompressionStream === 'function') {
      data = await transform(data, CompressionStream);
      flags |= FLAG_GZIP;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const header = new Uint8Array(HEADER);
    header.set(MAGIC, 0);
    header[MAGIC.length] = VERSION;
    header[MAGIC.length + 1] = flags;
    header.set(salt, MAGIC.length + 2);
    header.set(iv, MAGIC.length + 18);
    const key = await encryptionKey(phrase, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: header}, key, data));
    const output = new Uint8Array(HEADER + cipher.length);
    output.set(header, 0);
    output.set(cipher, HEADER);
    return output;
  }

  async function decrypt(bytes, phrase) {
    if (!isEncrypted(bytes)) throw Error('Ce fichier n’est pas une sauvegarde chiffrée.');
    if (bytes[MAGIC.length] !== VERSION) throw Error('Cette sauvegarde vient d’une version plus récente du carnet.');
    const flags = bytes[MAGIC.length + 1];
    const header = bytes.slice(0, HEADER);
    const salt = header.slice(MAGIC.length + 2, MAGIC.length + 18);
    const iv = header.slice(MAGIC.length + 18, HEADER);
    const key = await encryptionKey(phrase, salt);
    let data;
    try {
      data = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv, additionalData: header}, key, bytes.subarray(HEADER)));
    } catch {
      throw Error('Phrase secrète incorrecte, ou fichier abîmé.');
    }
    if (flags & FLAG_GZIP) {
      if (typeof DecompressionStream !== 'function') throw Error('Ce navigateur est trop ancien pour ouvrir cette sauvegarde.');
      data = await transform(data, DecompressionStream);
    }
    return new TextDecoder().decode(data);
  }

  // Clé d'accès au cloud : dérivée de la phrase avec un sel fixe différent.
  // Elle ne permet pas de déchiffrer le carnet. Le serveur ne garde que son empreinte SHA-256.
  async function accessKey(phrase) {
    const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: ACCESS_SALT, iterations: ITERATIONS},
      await baseKey(phrase), 256);
    return hex(bits);
  }

  async function accessCode(key) {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  }

  return {encrypt, decrypt, isEncrypted, accessKey, accessCode};
})();
