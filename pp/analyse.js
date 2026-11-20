'use strict';

// Analyse d'un bulletin dans l'appareil (sans IA) et proposition de remarque de professeur principal.
// Les tournures suivent la structure des remarques du professeur : bilan d'ensemble, évolution,
// qualités soulignées, matières à travailler, attitude, encouragement final, puis mention.
const PPAnalyse = (() => {
  const SUBJECTS = [
    [/^MATH/i, 'Mathématiques'], [/^PHYSIQUE/i, 'Physique-Chimie'], [/^SCIENCES DE LA VIE|^SVT/i, 'SVT'],
    [/^TECHNO/i, 'Technologie'], [/^FRAN[CÇ]AIS/i, 'Français'], [/^ALLEMAND/i, 'Allemand'], [/^ESPAGNOL/i, 'Espagnol'],
    [/^ITALIEN/i, 'Italien'], [/^LATIN/i, 'Latin'], [/^LANG.*ANGLAIS|^ANGLAIS/i, 'Anglais'], [/^HIST/i, 'Histoire-Géographie'],
    [/^ARTS? PLAST/i, 'Arts plastiques'], [/^EDUCATION MUSICALE|^ÉDUCATION MUSICALE|^MUSIQUE/i, 'Éducation musicale'],
    [/^ED\.?\s*PHYSIQUE|^EPS|^EDUCATION PHYSIQUE/i, 'EPS'], [/^ELOQUENCE|^ÉLOQUENCE/i, 'Éloquence'], [/^CHORALE/i, 'Chorale'],
    [/^PHILO/i, 'Philosophie'], [/^S\.?E\.?S|^SCIENCES ECONOMIQUES/i, 'SES'], [/^NSI/i, 'NSI'], [/^ENS.*SCIENTIFIQUE/i, 'Enseignement scientifique'],
  ];
  const subjectName = raw => {
    const found = SUBJECTS.find(([pattern]) => pattern.test(raw));
    if (found) return found[1];
    const lower = raw.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  // Expressions positives et négatives les plus fréquentes dans les appréciations.
  const POSITIVE = [
    'excellent(?:e|s|es)? (?:trimestre|travail|résultats?|début|ensemble)', 'excellent(?:e)?', 'très bon(?:ne)?s? (?:trimestre|résultats?|travail|participation|élève|ensemble|début)',
    'bon(?:ne)? (?:trimestre|travail|participation|début|ensemble|résultats?)', 'très satisfaisant(?:e|s)?', 'satisfaisant(?:e|s)?', 'félicitations?', 'bravo',
    'sérieu(?:x|se|ses)', 'appliqué(?:e|s|es)?', 'volontaire', 'travailleu(?:r|se)', 'rigoureu(?:x|se)', 'rigueur', 'régulier(?:e|s)?|régulière', 'régularité',
    'investi(?:e|s|es)?', 'implication', 'impliqué(?:e)?', 'participation (?:active|dynamique|pertinente|constructive)', 'participe (?:activement|volontiers|beaucoup)',
    'curieu(?:x|se)', 'curiosité', 'dynamique', 'motivé(?:e)?', 'motivation', 'autonome', 'autonomie', 'exemplaire', 'agréable', 'efficace', 'brillamment',
    'progrès', 'progresse', 'en (?:nette )?hausse', 'aisance', 'bases solides', 'soucieu(?:x|se) de bien (?:faire|comprendre)', 'à l.écoute', 'attentif|attentive',
    'continue(?:z)? (?:ainsi|dans cette voie|sur cette)', 'poursui(?:s|vez|vre) (?:ainsi|sur cette|dans cette)', 'prometteu(?:r|se)', 'qualité',
  ];
  const NEGATIVE = [
    'beaucoup de difficultés', 'difficultés?', 'lacunes?', 'fragile(?:s)?', 'fragilités?', 'insuffisant(?:e|s|es)?', 'insuffisance', 'manque(?:s)? (?:de|d.)\\s?\\S+',
    'bavard(?:e|s|es)?', 'bavardages?', 'distrait(?:e|s)?', 'se (?:laisse|laissant) distraire', 'dissipé(?:e|s)?', 'agité(?:e|s)?', 'inattenti(?:f|ve)',
    'irrégulier(?:e|s)?|irrégulière', 'irrégularité', 'en baisse', 'baisse', 'décevant(?:e|s)?', 'inquiétant(?:e|s)?', 'préoccupant(?:e|s)?', 'relâchement', 'relâch(?:er|e)',
    'travail (?:personnel )?(?:insuffisant|superficiel|irrégulier)', 'peu de travail', 'pas assez', 'trop (?:peu|de bavardages|bavard(?:e)?|passi(?:f|ve)|souvent)', 'passi(?:f|ve)',
    'comportement (?:inadapté|à revoir|perturbateur)', 'attitude (?:inadaptée|à revoir|peu propice)', 'oublis?', 'retards?', 'absences?', 'n.a pas (?:rendu|fait|travaillé)',
    'ne fournit pas', 'doit (?:se ressaisir|redoubler|impérativement)', 'mitigé(?:e|s)?', 'moyen(?:ne)?(?= trimestre| bilan)', 'catastrophique', 'en difficulté',
  ];
  const pattern = list => new RegExp(`(?<![\\p{L}])(?:${list.join('|')})(?![\\p{L}])`, 'giu');
  const POS = pattern(POSITIVE);
  const NEG = pattern(NEGATIVE);

  // Fautes fréquentes repérées sans IA (l'analyse approfondie fait une vraie correction).
  const FIXES = [
    [/\ble soucis (de|d’|d')/gi, 'le souci $1'], [/\baucun raison\b/gi, 'aucune raison'], [/\bséreu(x|se)\b/gi, 'sérieu$1'], [/\bdes le début\b/gi, 'dès le début'],
    [/\ba coté\b/gi, 'à côté'], [/\ben terme de\b/gi, 'en termes de'], [/\bmalgrés\b/gi, 'malgré'], [/\bquelque soit\b/gi, 'quel que soit'], [/\bparmis\b/gi, 'parmi'],
    [/\bdans la réponses\b/gi, 'dans les réponses'], [/\bplus précise dans la\b/gi, 'plus précise dans les'], [/\bil faut qu'il (\w+)s\b/gi, null],
    [/\bsi il\b/gi, 's’il'], [/\bça et là\b/gi, 'çà et là'], [/\bpallier à\b/gi, 'pallier'], [/\bse rappeler de\b/gi, 'se rappeler'], [/\bde part sa\b/gi, 'de par sa'],
    [/\bje vous encourage a\b/gi, 'je vous encourage à'], [/\bdois\b(?= (?:poursuivre|continuer|travailler))/g, null],
  ].filter(([, fix]) => fix !== null);

  // Découpe une appréciation en morceaux colorés : {text, tone: 'pos' | 'neg' | '', fix?}.
  function highlight(text) {
    const marks = [];
    const collect = (regex, tone) => {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text))) marks.push({start: match.index, end: match.index + match[0].length, tone});
    };
    collect(NEG, 'neg');
    collect(POS, 'pos');
    for (const [regex, fix] of FIXES) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text))) {
        marks.push({start: match.index, end: match.index + match[0].length, tone: 'fix', fix: match[0].replace(new RegExp(regex.source, regex.flags.replace('g', '')), fix)});
      }
    }
    // Les corrections priment, puis le négatif ; pas de chevauchement.
    const order = {fix: 0, neg: 1, pos: 2};
    marks.sort((a, b) => order[a.tone] - order[b.tone] || a.start - b.start);
    const kept = [];
    for (const mark of marks) if (!kept.some(other => mark.start < other.end && other.start < mark.end)) kept.push(mark);
    kept.sort((a, b) => a.start - b.start);
    const parts = [];
    let cursor = 0;
    for (const mark of kept) {
      if (mark.start > cursor) parts.push({text: text.slice(cursor, mark.start), tone: ''});
      parts.push({text: text.slice(mark.start, mark.end), tone: mark.tone, fix: mark.fix});
      cursor = mark.end;
    }
    if (cursor < text.length) parts.push({text: text.slice(cursor), tone: ''});
    return parts;
  }

  const QUALITIES = [
    [/sérieu|rigueur|rigoureu/i, 'votre sérieux'], [/participation (?:active|dynamique)|participe (?:activement|volontiers)/i, 'votre participation active'],
    [/investi|implication|impliqué/i, 'votre implication'], [/volontaire|motiv/i, 'votre bonne volonté'], [/curieu|curiosité/i, 'votre curiosité'],
    [/régulier|régulière|régularité/i, 'votre régularité'], [/exemplaire/i, 'votre attitude exemplaire'], [/appliqué/i, 'votre application'],
    [/autonom/i, 'votre autonomie'], [/progrès|progresse|en hausse/i, 'vos progrès'],
  ];
  const ISSUES = [
    [/bavard|dissipé|agité|distrai|inattenti|attitude (?:inadaptée|à revoir|peu propice)|comportement/i, 'attitude', 'l’attitude en classe'],
    [/manque de travail|travail (?:personnel )?(?:insuffisant|irrégulier|superficiel)|peu de travail|travail personnel|irrégulier|irrégulière/i, 'travail', 'la régularité du travail personnel'],
    [/oral|participation (?:insuffisante|timide|à développer)|passi(?:f|ve)|ose(?:z|r)?|discr[eè]t/i, 'oral', 'la participation à l’oral'],
    [/lacunes?|difficultés?|fragil|méthode|méthodologi/i, 'acquis', 'des fragilités dans certains apprentissages'],
    [/oubli|matériel|devoirs? (?:non|pas) (?:fait|rendu)|consigne/i, 'organisation', 'l’organisation et le suivi des consignes'],
  ];

  const mean = values => {
    const list = values.filter(Number.isFinite);
    return list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length * 100) / 100 : null;
  };
  const format = value => value === null || value === undefined ? '–' : String(Math.round(value * 100) / 100).replace('.', ',');

  // Toutes les appréciations du bulletin, y compris celles des professeurs d'une matière partagée.
  const appreciations = subject => [subject.appreciation, ...(subject.teachers || []).map(teacher => teacher.appreciation)].filter(Boolean);

  function analyse(bulletin, previous) {
    const subjects = bulletin.subjects.map(subject => {
      const diff = subject.note !== null && subject.classAverage !== null ? subject.note - subject.classAverage : null;
      const texts = appreciations(subject);
      const tones = texts.flatMap(highlight);
      const pos = tones.filter(part => part.tone === 'pos').length;
      const neg = tones.filter(part => part.tone === 'neg').length;
      const before = previous?.subjects?.find(item => item.name === subject.name);
      const delta = before && subject.note !== null && before.note !== null ? Math.round((subject.note - before.note) * 100) / 100 : null;
      let level = '';
      if (subject.note !== null) {
        if (subject.note >= 16 || (diff !== null && diff >= 2)) level = 'fort';
        if (subject.note < 10 || (diff !== null && diff <= -2.5) || (subject.note < 12 && neg > pos)) level = 'faible';
      } else if (neg > pos + 1) level = 'faible';
      return {...subject, label: subjectName(subject.name), diff, pos, neg, delta, level, texts};
    });
    const average = mean(subjects.map(subject => subject.note));
    const classAverage = mean(subjects.map(subject => subject.classAverage));
    const previousAverage = previous ? mean(previous.subjects.map(subject => subject.note)) : null;
    const trend = average !== null && previousAverage !== null ? Math.round((average - previousAverage) * 100) / 100 : null;
    const positiveText = subjects.flatMap(subject => subject.texts.flatMap(highlight)).filter(part => part.tone === 'pos').map(part => part.text).join(' | ');
    const qualities = QUALITIES.filter(([regex]) => regex.test(positiveText)).map(([, label]) => label);
    const negatives = subjects.flatMap(subject => subject.texts.flatMap(highlight)).filter(part => part.tone === 'neg').map(part => part.text).join(' ');
    const issues = ISSUES.filter(([regex]) => regex.test(negatives)).map(([, key, label]) => ({key, label}));
    const strong = subjects.filter(subject => subject.level === 'fort');
    const weak = subjects.filter(subject => subject.level === 'faible');
    const life = bulletin.life || {halfDays: 0, unjustified: 0, late: 0, text: ''};
    const positives = subjects.reduce((sum, subject) => sum + subject.pos, 0);
    const negativeCount = subjects.reduce((sum, subject) => sum + subject.neg, 0);

    let level = 'satisfaisant';
    if (average !== null) {
      if (average >= 16 && weak.length === 0) level = 'excellent';
      else if (average >= 14.5 && weak.length <= 1) level = 'tresbon';
      else if (average >= 12) level = weak.length >= 3 ? 'mitige' : 'satisfaisant';
      else if (average >= 10) level = 'mitige';
      else level = 'fragile';
    } else if (negativeCount > positives) level = 'mitige';

    const forts = [];
    if (strong.length) forts.push(`Très bons résultats en ${list(strong.map(subject => subject.label))}`);
    if (qualities.length) forts.push(`Souligné par les enseignants : ${qualities.slice(0, 4).map(text => text.replace(/^votre |^vos /, '')).join(', ')}`);
    if (trend !== null && trend >= 0.8) forts.push(`Moyenne en hausse (+${format(trend)} point${trend >= 2 ? 's' : ''})`);
    const faibles = [];
    if (weak.length) faibles.push(`Résultats fragiles en ${list(weak.map(subject => subject.label))}`);
    for (const issue of issues) faibles.push(issue.label.charAt(0).toUpperCase() + issue.label.slice(1));
    if (trend !== null && trend <= -0.8) faibles.push(`Moyenne en baisse (${format(trend)} point${trend <= -2 ? 's' : ''})`);
    if (life.unjustified || life.halfDays >= 6) faibles.push(`Assiduité : ${life.halfDays} demi-journée${life.halfDays > 1 ? 's' : ''} d’absence${life.unjustified ? `, dont ${life.unjustified} non justifiée${life.unjustified > 1 ? 's' : ''}` : ''}`);
    if (life.late >= 3) faibles.push(`Ponctualité : ${life.late} retards`);

    let mention = '';
    if (level === 'excellent' || (level === 'tresbon' && !issues.some(issue => issue.key === 'attitude') && positives >= negativeCount * 2)) mention = 'felicitations';
    else if ((level === 'tresbon' || level === 'satisfaisant') && !issues.some(issue => issue.key === 'attitude') && (positives > negativeCount || (trend !== null && trend >= 0.8))) mention = 'encouragements';
    else if ((trend !== null && trend >= 1.5) && !issues.some(issue => issue.key === 'attitude')) mention = 'encouragements';

    return {subjects, average, classAverage, trend, level, strong, weak, qualities, issues, life, forts, faibles, mention};
  }

  function list(items) {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
  }

  const pick = (choices, seed) => choices[Math.abs(seed) % choices.length];

  // Prénom à partir du nom du carnet (« DUPONT Léa » → « Léa »).
  function firstName(name) {
    const words = String(name || '').trim().split(/\s+/);
    const mixed = words.filter(word => word !== word.toUpperCase() || word.length === 1);
    return mixed.length ? mixed.join(' ') : words[words.length - 1] || '';
  }

  const OPENERS = {
    excellent: ['Un excellent trimestre pour {P}.', 'Excellent trimestre. {P} fournit un travail sérieux et de qualité dans l’ensemble des matières.', 'Quel bilan, {P} ! Vos enseignants sont unanimes : ce trimestre est excellent.'],
    tresbon: ['Un très bon bilan trimestriel pour {P}.', 'Des résultats plus que satisfaisants ce trimestre pour {P}.', 'Un très bon trimestre dans l’ensemble pour {P}.'],
    satisfaisant: ['Le bilan de ce trimestre est satisfaisant pour {P}.', 'Un bilan satisfaisant dans l’ensemble pour {P}.', 'Des résultats satisfaisants ce trimestre pour {P}.'],
    mitige: ['Un bilan mitigé ce trimestre pour {P}.', 'Le bilan reste mitigé ce trimestre.', 'Des résultats en demi-teinte ce trimestre pour {P}.'],
    fragile: ['Des résultats fragiles ce trimestre pour {P}.', 'Le bilan de ce trimestre est préoccupant.', 'Un trimestre difficile pour {P}.'],
  };
  const CLOSERS = {
    excellent: ['Ne changez rien.', 'Poursuivez ainsi.', 'Bravo et continuez sur cette lancée !'],
    tresbon: ['Poursuivez ainsi.', 'Conservez ce bel état d’esprit.', 'Il faudra poursuivre ainsi sans faiblir.'],
    satisfaisant: ['Vous en êtes largement capable.', 'À vous de jouer !', 'Nous comptons sur vous pour le trimestre prochain.'],
    mitige: ['Vous en êtes capable, à vous de jouer !', 'Nous comptons sur vous pour inverser la tendance.', 'Ne vous découragez pas, vous en êtes capable.'],
    fragile: ['Ne vous découragez pas et poursuivez vos efforts.', 'Nous comptons sur vous pour réagir rapidement.', 'Il faudra impérativement vous mobiliser, vous en êtes capable.'],
  };

  function remark(result, name, variant = 0) {
    const P = firstName(name) || 'l’élève';
    const sentences = [];
    sentences.push(pick(OPENERS[result.level], variant).replace('{P}', P));
    if (result.trend !== null && result.trend >= 0.8) {
      sentences.push(pick([`${P} a su prendre en compte les remarques du précédent trimestre pour progresser. Bravo !`, 'Les résultats sont en hausse : c’est encourageant.', 'Une belle réaction par rapport au trimestre précédent.'], variant));
    } else if (result.trend !== null && result.trend <= -0.8) {
      sentences.push(pick(['Des résultats en baisse par rapport au trimestre précédent : attention à ce relâchement.', 'Attention, les résultats sont en baisse et ce relâchement risque de vous faire accumuler des lacunes.'], variant));
    }
    if (result.qualities.length && result.level !== 'fragile') {
      const picked = result.qualities.slice(0, 2);
      sentences.push(pick([`Vos enseignants soulignent ${list(picked)}.`, `L’ensemble de l’équipe pédagogique souligne ${list(picked)}.`], variant));
    } else if (result.qualities.length) {
      sentences.push(`Vos enseignants notent cependant ${list(result.qualities.slice(0, 2))}.`);
    }
    const weak = result.weak.map(subject => subject.label);
    if (weak.length === 1) {
      sentences.push(pick([`Attention cependant en ${weak[0]} où le niveau reste fragile.`, `Des fragilités persistent en ${weak[0]} : il faudra y accentuer votre travail.`], variant));
    } else if (weak.length > 1) {
      sentences.push(pick([`Attention cependant en ${list(weak.slice(0, 3))} où les résultats ne sont pas à la hauteur de votre potentiel.`, `Il faudra fournir davantage d’efforts en ${list(weak.slice(0, 3))}.`], variant));
    }
    const keys = new Set(result.issues.map(issue => issue.key));
    if (keys.has('attitude')) sentences.push('Il vous faudra également adopter une attitude plus propice au travail en classe.');
    if (keys.has('travail') && result.level !== 'excellent') sentences.push('Un travail personnel plus régulier sera nécessaire pour progresser.');
    if (keys.has('oral') && ['excellent', 'tresbon', 'satisfaisant'].includes(result.level)) sentences.push('Osez davantage participer à l’oral, vous avez beaucoup à partager.');
    if (result.life.unjustified || result.life.halfDays >= 6) sentences.push('Veillez également à votre assiduité.');
    else if (result.life.late >= 3) sentences.push('Attention aussi à la ponctualité.');
    sentences.push(pick(CLOSERS[result.level], variant + 1));
    return sentences.join(' ');
  }

  const LEVELS = {excellent: 'Excellent', tresbon: 'Très bon', satisfaisant: 'Satisfaisant', mitige: 'Mitigé', fragile: 'Fragile'};

  return {analyse, highlight, remark, firstName, format, subjectName, LEVELS};
})();
