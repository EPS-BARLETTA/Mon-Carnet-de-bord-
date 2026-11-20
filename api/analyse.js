// Fonction Vercel : analyse approfondie d'un bulletin par l'IA (Claude, d'Anthropic).
// Le carnet n'envoie qu'un bulletin ANONYMISÉ : ni nom, ni prénom, ni professeurs, ni date de naissance.
//
// Configuration (Vercel → Settings → Environment Variables) :
//   ANTHROPIC_API_KEY = clé d'API Anthropic (console.anthropic.com)
//   CARNET_CLE_ACCES  = même code d'accès que le carnet en ligne
//   CARNET_IA_MODELE  = (facultatif) modèle à utiliser

import { createHash, timingSafeEqual } from 'node:crypto';

const MODEL = process.env.CARNET_IA_MODELE || 'claude-sonnet-5-5';
const LIMIT = 60000;

function reply(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'},
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

const SYSTEM = `Tu aides un professeur principal de collège ou lycée français à préparer le conseil de classe.
On te donne le bulletin ANONYMISÉ d'un élève (désigné par [Prénom]) : pour chaque matière, la moyenne de l'élève, celle de la classe et l'appréciation de l'enseignant ; la vie scolaire ; parfois les moyennes du trimestre précédent ; parfois des exemples de remarques écrites par ce professeur principal.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, de la forme :
{
  "matieres": [{"matiere": "nom exact donné", "positif": ["extrait"], "negatif": ["extrait"], "corrections": [{"erreur": "extrait", "correction": "texte corrigé"}]}],
  "points_forts": ["phrase courte"],
  "points_faibles": ["phrase courte"],
  "remarque": "proposition de remarque de professeur principal",
  "mention": "felicitations" | "encouragements" | "aucune",
  "justification": "une phrase qui explique la mention proposée"
}

Règles :
- « positif » et « negatif » : courts extraits (2 à 8 mots) recopiés EXACTEMENT, caractère pour caractère, depuis l'appréciation de la matière ; positif = qualité, réussite, progrès ; negatif = difficulté, manque, attitude à corriger.
- « corrections » : uniquement les vraies fautes d'orthographe, de grammaire ou d'accord dans les appréciations ; « erreur » est recopiée EXACTEMENT (quelques mots autour de la faute) ; « correction » est la même portion corrigée. N'invente pas de faute, ne corrige pas le style.
- Points forts et faibles : synthèse de l'ensemble du bulletin (matières, attitude, travail, vie scolaire, évolution), 2 à 5 éléments chacun, sans répéter les notes.
- Remarque : 300 à 600 caractères, en français soigné, dans le ton et la structure des exemples du professeur s'il y en a (bilan d'ensemble, évolution, points à travailler précis en nommant les matières, encouragement final). Utilise [Prénom] pour désigner l'élève. Ne cite aucun enseignant. N'invente aucune information absente du bulletin. N'écris pas la mention dans la remarque.
- Mention : félicitations pour un excellent bilan sans réserve ; encouragements pour un bilan satisfaisant porté par les efforts ou les progrès ; sinon aucune.`;

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw Error('Réponse illisible');
  return JSON.parse(text.slice(start, end + 1));
}

async function handle(request) {
  if (request.method !== 'POST') return reply(405, {message: 'Méthode non prise en charge.'});
  const access = checkAccess(request);
  if (access === 'absent') return reply(503, {message: 'Le cloud n’est pas configuré (CARNET_CLE_ACCES).'});
  if (access !== 'ok') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return reply(401, {message: 'Accès refusé.'});
  }
  if (!process.env.ANTHROPIC_API_KEY) return reply(503, {message: 'L’analyse IA n’est pas configurée (ANTHROPIC_API_KEY).'});
  const raw = await request.text();
  if (raw.length > LIMIT) return reply(413, {message: 'Bulletin trop long.'});
  let input;
  try { input = JSON.parse(raw); }
  catch { return reply(400, {message: 'Requête invalide.'}); }
  if (!input || !Array.isArray(input.matieres)) return reply(400, {message: 'Requête invalide.'});

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01'},
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{role: 'user', content: JSON.stringify(input)}],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('anthropic', response.status, detail.slice(0, 300));
    return reply(502, {message: response.status === 401 ? 'Clé d’API Anthropic refusée.' : response.status === 429 ? 'Trop de demandes, réessaie dans une minute.' : 'Le service d’IA n’a pas répondu.'});
  }
  const result = await response.json();
  const text = (result.content || []).filter(part => part.type === 'text').map(part => part.text).join('');
  try {
    return reply(200, extractJson(text));
  } catch {
    return reply(502, {message: 'La réponse de l’IA est illisible. Réessaie.'});
  }
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (error) {
      console.error('analyse', error?.name, error?.message);
      return reply(500, {message: 'Erreur du serveur d’analyse.'});
    }
  },
};
