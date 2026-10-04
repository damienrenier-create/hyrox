// Criteres de realisation (CR) des 21 exercices du WOD Level, fournis par Sartay le 28/09/2026, du plus
// important (securite, posture) au moins important (intensite, rythme). Module pur : arbitres (demineur),
// espace eleve (commentaire), recap du prof, dia des criteres.
// Depuis le 29/09 (Sartay), l'arbitre coche 4 CRITERES par exercice : les 3 criteres techniques les plus importants
// (les 3 premiers de la liste) + 1 critere d'intensite. Bareme : 0 critere = TI, 1 = I, 2 = S, 3 = B, 4 = TB ; avec
// les 4 coches, l'arbitre peut ajouter un ❤️ (« les 4 sont vraiment tres bien faits ») = E. Les evaluations d'avant
// (grille de 6) gardent leur ancien bareme (1 = TI ... 6 = E).

import { QUALITY_LEVELS } from "@/lib/wod-engines/core/quality";

export const CRITERIA: Record<string, string[]> = {
  POMPES: [
    "Le corps est parfaitement aligné en planche (tête, dos, bassin, jambes).",
    "La poitrine touche ou frôle le sol à chaque descente.",
    "Les bras sont complètement tendus lors de la remontée (fin de poussée).",
    "Le bassin ne s'affaisse pas et ne se lève pas pendant le mouvement.",
    "La descente est contrôlée (l'élève ne se laisse pas tomber).",
    "L'élève maintient un rythme régulier et fait de son mieux.",
  ],
  "SQUATS JUMP": [
    "Le bassin descend sous le niveau des genoux (squat profond) à la flexion.",
    "L'extension des hanches et des jambes est complète lors du saut.",
    "Les pieds décollent visiblement du sol lors de l'impulsion.",
    "L'atterrissage se fait en douceur (amorti sur la pointe puis talon) pour protéger le dos.",
    "Le dos reste droit et le regard droit devant pendant toute l'exécution.",
    "L'enchaînement est fluide sans pause excessive au sol.",
  ],
  BURPEES: [
    "La poitrine et les cuisses touchent le sol lors de la phase basse.",
    "L'extension du corps est complète lors du saut final.",
    "Les pieds décollent du sol et les mains tapent derrière/au-dessus de la tête à la fin du mouvement.",
    "Le retour des pieds vers les mains se fait de manière dynamique et groupée.",
    "L'élève ne s'écrase pas au sol (descente active).",
    "L'intensité est maintenue tout au long de l'épreuve.",
  ],
  "COMMANDO BRAS": [
    "Le corps reste bien aligné (planche) durant toute la transition.",
    "Le bassin reste le plus stable possible (pas de balancement excessif de gauche à droite).",
    "Les bras se tendent complètement lors de la montée sur les mains.",
    "Les coudes viennent se placer exactement à l'endroit où se trouvaient les mains.",
    "L'élève alterne le bras qui initie la montée (un coup à gauche, un coup à droite).",
    "Le mouvement est contrôlé, sans utiliser l'élan des hanches.",
  ],
  "BREAK DANCE": [
    "La jambe qui passe sous le corps est tendue au maximum.",
    "Le bassin pivote, descend, mais ne se repose pas sur le sol.",
    "Le tronc tourne correctement tout en gardant l'équilibre sur une main et un pied.",
    "Le bras libre accompagne le mouvement en tirant vers l'arrière de manière dynamique.",
    "Le retour en position initiale (quadrupédie) est stable.",
    "L'enchaînement gauche/droite est rythmé et fluide.",
  ],
  "ONE REP": [
    // Sartay 29/09 nuit : remplace « planche, dos plat ».
    "L'élève démarre debout et ses pieds ne bougent pas pendant l'exercice.",
    "Le bassin reste le plus stable possible et ne vrille pas de gauche à droite lors des touches croisées.",
    "Toutes les touches sont exécutées franchement et de manière croisée (main/épaule, main/genou, main/pied).",
    "La descente et la remontée (crawling) sont contrôlées et sécurisées sur les appuis.",
    "L'élève se redresse en station debout complète (extension totale) à la fin de la répétition.",
    "L'exercice est réalisé avec rythme et sans pause au sol.",
  ],
  CORDE: [
    "L'atterrissage et les sauts se font de manière souple (amorti sur l'avant du pied, genoux fléchis).",
    "Le dos est droit, les épaules sont relâchées et le regard est droit devant.",
    "Le mouvement de la corde est initié par une rotation des poignets (et non par les bras entiers).",
    "La corde passe de manière fluide et le mouvement est synchronisé.",
    "L'élève maintient un rythme régulier, continu, en essayant de limiter les ratés.",
    "L'intensité est maximale par rapport au niveau technique de l'élève.",
  ],
  "SMASH DOWN": [
    "La balle est montée bien au-dessus de la tête, bras tendus, avant le lancer.",
    "L'extension du corps est complète (chevilles, genoux, hanches) au point haut.",
    "Le lancer vers le sol est explosif et propulsé avec force (la balle n'est pas juste lâchée).",
    "Le dos reste droit : l'élève plie les jambes pour ramasser la balle.",
    "L'élève accompagne la balle vers le bas de manière dynamique.",
    "Le ramassage de la balle est immédiat pour un enchaînement rapide.",
  ],
  "WALL BALL SHOT": [
    "Le squat est profond (creux des hanches sous les genoux) avant le lancer.",
    "La balle touche la cible à la hauteur exacte demandée.",
    "L'élève réceptionne la balle en amortissant directement dans un nouveau squat.",
    "Le dos reste droit et le regard fixé sur la cible lors de la descente.",
    "Le mouvement est un seul flux continu (les jambes propulsent la balle).",
    "Les bras terminent en extension complète vers la cible.",
  ],
  "TIRE TAPIS": [
    "L'élève qui tire garde le dos bien droit et le buste fier (il ne s'enroule pas vers l'avant).",
    "L'effort est réalisé en poussant sur les jambes et en reculant avec le poids du corps.",
    "La prise sur le tapis est ferme, stable et symétrique des deux côtés.",
    "Le mouvement de traction est continu, l'élève ne s'arrête pas en chemin.",
    "Le tapis reste en mouvement du point de départ au point d'arrivée.",
    "L'élève met une intensité maximale et tracte son camarade avec une grande énergie.",
  ],
  "FLIP TAPIS": [
    "L'élève plie bien les jambes (squat) et garde le dos droit pour soulever le tapis (pas de dos rond).",
    "La poussée pour basculer le tapis est initiée par la force des jambes et des hanches.",
    "Le regard reste fixé droit devant (toujours du même côté) pour garder une bonne posture.",
    "L'élève gère la force et l'angle pour que le tapis retombe dans la zone définie sans s'éloigner de trop.",
    "L'enchaînement est rapide et l'élève se replace immédiatement en squat pour la répétition suivante.",
    "L'engagement physique est total, l'intensité est maintenue malgré le poids de l'obstacle.",
  ],
  "KB SNATCH": [
    "La kettlebell termine au-dessus de la tête avec le bras complètement tendu et verrouillé.",
    "Le mouvement est initié par une poussée explosive des hanches, non à la force du bras.",
    "La kettlebell « roule » autour du poignet et ne tape pas violemment l'avant-bras à la réception.",
    "Le corps est droit, épaule stable et bassin gainé en position haute.",
    "La descente est contrôlée dans l'élan pour amorcer la répétition suivante.",
    "Le rythme est soutenu et l'effort maximal.",
  ],
  "KB SWING": [
    "Le mouvement est initié par une extension explosive du bassin (les hanches propulsent le poids).",
    "Le dos reste droit, neutre et gainé.",
    "Les bras servent de balancier et restent souples (ils ne tirent pas le poids).",
    "La kettlebell atteint la hauteur demandée (yeux ou au-dessus de la tête).",
    "En fin d'extension (debout), les fessiers et les abdominaux sont contractés.",
    "La respiration accompagne l'effort (expiration lors de la montée du poids).",
  ],
  "KB TOUR": [
    "Le dos reste parfaitement droit du début à la fin.",
    "Les abdominaux et fessiers sont fortement contractés pour empêcher le bassin de bouger (aucun balancier).",
    "Le transfert de la kettlebell d'une main à l'autre se fait de manière assurée et sécurisée.",
    "Le chemin de la kettlebell reste près du corps, dans l'axe de la taille.",
    "Le poids utilisé est pertinent et représente un vrai défi physique pour l'élève.",
    "L'élève met de l'intensité et fait passer le poids à une vitesse soutenue.",
  ],
  "ALLER-RETOUR": [
    // Sartay 29/09 nuit : « l'élève freine en abaissant son centre de gravité ??? je dirais plutôt : court sur toute la longueur ».
    "L'élève court sur toute la longueur.",
    "Le sol ou la ligne sont clairement touchés/franchis à chaque extrémité.",
    "La relance après le changement de direction est immédiate et explosive.",
    "L'élève ne ralentit pas avant d'avoir complètement passé la ligne d'arrivée finale.",
    "L'allure de course correspond à un vrai sprint.",
    "L'élève donne tout ce qu'il a, l'intensité est maximale de bout en bout.",
  ],
  "MONKEY SLIDE": [
    "L'atterrissage se fait en douceur avec un amorti sécuritaire (pointes puis talons, genoux pliés).",
    "Les mains prennent un appui franc, solide et stable sur le tapis central pendant la phase de vol.",
    "L'élève descend bien en position de squat avant l'impulsion et lors de l'atterrissage.",
    "Les pieds décollent et atterrissent simultanément.",
    "L'enchaînement gauche-droite est fluide, la transition se fait sans s'écraser au sol.",
    "L'élève maintient un rythme très soutenu et fait le minimum de pauses.",
  ],
  "PLANK SLIDE": [
    "Le corps est parfaitement aligné en planche (tête, dos, bassin, jambes) tout au long de l'exercice.",
    // Sartay 29/09 nuit : « remplace ce critère par : le poids est déposé en débord de tapis ».
    "Le poids est déposé en débord de tapis.",
    "Le mouvement croisé est respecté : la main droite vient chercher le disque à gauche (et inversement).",
    "Le disque est tiré suffisamment loin de chaque côté (en débord du tapis) à chaque répétition.",
    "Les deux mains reviennent se poser de manière stable sur le tapis entre chaque glissement.",
    "Le mouvement est réalisé avec intensité et rythme, sans faire de pause au milieu.",
  ],
  "FENTES DISK": [
    "Le genou arrière touche ou frôle doucement le sol à chaque répétition.",
    "Le genou de la jambe avant reste dans l'axe et ne dépasse pas excessivement la pointe du pied.",
    "L'extension des jambes est complète (retour debout) entre chaque pas.",
    "Le buste reste bien droit et gainé (il ne s'affaisse pas vers l'avant).",
    "Le disque est tenu fermement de manière stable.",
    "L'équilibre latéral est parfaitement géré tout au long du déplacement.",
  ],
  TRACTIONS: [
    "Le menton passe clairement au-dessus de la barre à chaque montée.",
    "Les bras sont complètement tendus à la fin de la descente.",
    "L'élève ne « saute » pas ou n'utilise pas de mouvement de balancier exagéré.",
    "La descente est contrôlée et freinée.",
    "La prise est symétrique et solide sur la barre.",
    "L'élève met de l'intensité et fait du mieux qu'il peut.",
  ],
  "BOX JUMP": [
    "Le saut se fait à pieds joints.",
    "L'atterrissage se fait avec les deux pieds simultanément sur la box.",
    "L'extension des hanches est complète (l'élève se tient bien droit) une fois sur la box.",
    "La réception sur la box se fait de manière amortie (genoux fléchis, pas de choc rigide).",
    "Le retour au sol est contrôlé pour éviter les blessures (saut amorti ou descente un pied après l'autre).",
    "L'élève maintient un rythme continu sans pauses excessives.",
  ],
  // SQUATS (29/09 soir, squat sans saut des parcours 1 et 2 etoiles ; reecrit le 04/10 sur le standard HYROX du squat
  // des wall balls, rulebook 26/27 § 8.8 : hanches plus bas que les genoux, depart et fin debout hanches et genoux
  // tendus), puis la technique. Les evaluations deja rendues gardent les phrases d'avant.
  SQUATS: [
    "Les hanches descendent plus bas que les genoux (sous la parallèle) à chaque squat.",
    "Chaque squat se termine debout : hanches et genoux complètement tendus.",
    "Les talons restent au sol et les genoux suivent l'axe des pieds.",
    "Le dos reste droit, poitrine haute, regard devant.",
    "Les pieds restent écartés à la largeur des épaules et ne bougent pas pendant la série.",
    "L'élève enchaîne les squats à un rythme régulier, sans pause.",
  ],
  // HELICO (30/09) : criteres ecrits pour l'exercice ajoute par Sartay (3 techniques + intensite), a faire valider.
  HELICO: [
    "L'élève reste allongé sur le ventre, jambes au sol, le corps aligné (il ne se redresse pas en appui).",
    "Le poids passe bien dans le dos, de la main droite à la main gauche, sans tomber.",
    "Les bras sont tendus quand le poids repasse devant, sans que les mains se posent au sol.",
    "L'élève enchaîne les tours à un rythme régulier, sans pause.",
  ],
  // Stations du WOD Eval : 6 criteres par station. Sartay 04/10 : « essaye de trouver les criteres hyrox : pose des
  // mains juste devant les pieds etc. (…) et s'il n'y en a pas assez alors tu parles des criteres techniques ». Les
  // standards OFFICIELS d'abord (HYROX Rulebook Singles, saison 26/27 : § 8.4 burpee broad jump, § 8.7 sandbag lunge,
  // § 8.6 farmers carry), completes par la technique, le rythme en dernier (grille de l'arbitre eleve = les 3 premiers
  // + le dernier). « Pompage » = les criteres des POMPES (voir LEGACY_LABELS).
  "BURPEES BROAD JUMP": [
    "La poitrine touche clairement le sol en bas de chaque burpee.",
    "Les mains se posent juste devant les pieds (30 cm maximum, environ une longueur de pied) et n'avancent plus une fois posées.",
    "Le saut part des deux pieds en même temps et se réceptionne sur les deux pieds en même temps (pieds à la même hauteur).",
    "Aucun pas ni petit sursaut en plus : ni avant le saut, ni entre la réception et le burpee suivant.",
    "En se relevant du burpee, les pieds reviennent derrière les mains (ils ne dépassent pas le bout des doigts).",
    "L'élève travaille à une intensité qui lui est maximale.", // Sartay 04/10 : remplace « rythme soutenu, sans pause »
  ],
  "FENTES MARCHÉES": [
    "Le genou arrière touche clairement le sol à chaque fente (posé en douceur, sans le cogner).",
    "Chaque fente se termine debout : genoux et hanches complètement tendus.",
    "Les jambes alternent : c'est un genou différent qui touche le sol à chaque fente.",
    "Aucun pas ni petit pas d'ajustement entre deux fentes (on enchaîne, ou on s'arrête pieds parallèles).",
    "À chaque extrémité, le pied avant franchit complètement la ligne ; on repart debout, les deux pieds derrière la ligne.",
    "L'élève travaille à une intensité qui lui est maximale.", // Sartay 04/10 : remplace « rythme soutenu »
  ],
  "FARMER CARRY": [
    // Relu par Sartay le 04/10 : « la charge » (une ou deux), ligne franchie avec le pied, intensite en dernier. Il n'a
    // pas recopie le critere du souleve dos droit : garde en 5e (prof seulement) pour que la grille du prof reste a 6.
    "La charge est portée pendant tout le déplacement.",
    "Les bras chargés restent tendus le long du corps (ni sur l'épaule, ni contre le ventre).",
    "Pour se reposer, les charges sont posées sur place : elles ne sont ni lâchées, ni lancées, ni glissées vers l'avant.",
    "La ligne est franchie avec le pied à chaque extrémité.",
    "Les charges sont soulevées et reposées jambes fléchies, dos droit (jamais dos rond).",
    "L'élève travaille à une intensité qui lui est maximale.",
  ],
  "TOUR DE POUTRE": [
    "Les passages s'effectuent de façon contrôlée, sans heurter la poutre violemment.",
    "Lors du passage « au-dessus », l'élève s'élève suffisamment pour ne pas risquer de rester accroché.",
    "Lors du passage « en dessous », l'élève maîtrise son mouvement pour ne pas frotter le dos ou la tête au sol.",
    "Le retournement se fait de manière efficace et coordonnée.",
    "Les transitions entre le dessus et le dessous sont immédiates.",
    "L'élève se donne à 100 % pour boucler le circuit le plus rapidement possible.",
  ],
};

// Critere d'intensite (4e) : le 6e critere de Sartay quand il parle de rythme ou d'intensite ; pour les 4 exercices
// dont le 6e critere est technique, une phrase ecrite le 29/09 dans le meme esprit (a faire valider par Sartay).
const INTENSITY: Record<string, string> = {
  "COMMANDO BRAS": "L'élève enchaîne les montées et descentes à un rythme soutenu, sans pause.",
  "WALL BALL SHOT": "L'élève enchaîne les lancers à un rythme soutenu, sans pause entre les répétitions.",
  "KB SWING": "Le rythme est soutenu : l'élève enchaîne les swings sans s'arrêter.",
  "FENTES DISK": "L'élève avance à un rythme soutenu, sans s'arrêter entre les pas.",
};
const INTENSITY_SHORT: Record<string, string> = { "COMMANDO BRAS": "Rythme soutenu", "WALL BALL SHOT": "Rythme soutenu", "KB SWING": "Rythme soutenu", "FENTES DISK": "Rythme soutenu" };
export const TECH_CRITERIA = 3;
// Grille de l'arbitre (4 criteres) pour chaque exercice connu.
export const REFEREE_CRITERIA: Record<string, string[]> = Object.fromEntries(
  Object.entries(CRITERIA).map(([k, list]) => [k, [...list.slice(0, TECH_CRITERIA), INTENSITY[k] ?? list[list.length - 1]]])
);

// Version courte (2 a 5 mots, meme ordre) pour la dia unique a projeter aux arbitres ; l'arbitre coche toujours
// les phrases completes (REFEREE_CRITERIA).
export const SHORT_CRITERIA: Record<string, string[]> = {
  POMPES: ["Corps aligné", "Poitrine au sol", "Bras tendus en haut", "Bassin fixe", "Descente contrôlée", "Rythme régulier"],
  "SQUATS JUMP": ["Squat profond", "Extension complète", "Pieds décollent", "Réception amortie", "Dos droit, regard devant", "Enchaînement fluide"],
  BURPEES: ["Poitrine et cuisses au sol", "Extension au saut", "Décolle, mains en haut", "Pieds ramenés groupés", "Ne s'écrase pas", "Intensité maintenue"],
  "COMMANDO BRAS": ["Planche alignée", "Bassin stable", "Bras tendus en haut", "Coudes à la place des mains", "Bras alternés", "Sans élan des hanches"],
  "BREAK DANCE": ["Jambe tendue sous le corps", "Bassin ne touche pas le sol", "Tronc tourne, en équilibre", "Bras libre dynamique", "Retour stable à 4 pattes", "Gauche/droite rythmé"],
  "ONE REP": ["Debout, pieds fixes", "Bassin ne vrille pas", "Touches franches et croisées", "Crawling contrôlé", "Debout complet à la fin", "Rythme, sans pause"],
  CORDE: ["Sauts souples, amortis", "Dos droit, épaules relâchées", "Rotation des poignets", "Corde fluide", "Rythme régulier", "Intensité maximale"],
  "SMASH DOWN": ["Balle au-dessus de la tête", "Extension complète", "Lancer explosif", "Dos droit au ramassage", "Accompagne la balle", "Ramassage immédiat"],
  "WALL BALL SHOT": ["Squat profond", "Cible à la bonne hauteur", "Réception en squat", "Dos droit, regard cible", "Un seul flux continu", "Bras tendus vers la cible"],
  "TIRE TAPIS": ["Dos droit, buste fier", "Pousse avec les jambes", "Prise ferme, symétrique", "Traction continue", "Tapis toujours en mouvement", "Intensité maximale"],
  "FLIP TAPIS": ["Squat, dos droit", "Poussée jambes et hanches", "Regard devant", "Tapis dans la zone", "Replacement immédiat", "Engagement total"],
  "KB SNATCH": ["Bras verrouillé en haut", "Poussée des hanches", "La KB roule, ne tape pas", "Corps droit, gainé", "Descente contrôlée", "Rythme soutenu"],
  "KB SWING": ["Explosion du bassin", "Dos droit, gainé", "Bras souples", "Hauteur atteinte", "Fessiers et abdos serrés", "Expire en montant"],
  "KB TOUR": ["Dos droit", "Bassin immobile, gainé", "Passage de main sûr", "KB près du corps", "Poids adapté, vrai défi", "Vitesse soutenue"],
  "ALLER-RETOUR": ["Court sur toute la longueur", "Ligne touchée", "Relance explosive", "Ne ralentit pas avant la ligne", "Vrai sprint", "Intensité maximale"],
  "MONKEY SLIDE": ["Réception amortie", "Appui franc des mains", "Squat avant et après", "Pieds ensemble", "Gauche/droite fluide", "Rythme soutenu"],
  "PLANK SLIDE": ["Planche alignée", "Poids en débord du tapis", "Main croisée", "Disque loin de chaque côté", "Mains stables entre deux", "Rythme, sans pause"],
  "FENTES DISK": ["Genou arrière frôle le sol", "Genou avant dans l'axe", "Retour debout complet", "Buste droit, gainé", "Disque tenu ferme", "Équilibre géré"],
  TRACTIONS: ["Menton au-dessus de la barre", "Bras tendus en bas", "Sans saut ni balancier", "Descente freinée", "Prise symétrique", "Intensité"],
  "BOX JUMP": ["Pieds joints", "Arrivée à deux pieds", "Debout sur la box", "Réception amortie", "Descente contrôlée", "Rythme continu"],
  HELICO: ["Allongé, corps aligné", "Passage dans le dos", "Bras tendus devant", "Rythme régulier"],
  SQUATS: ["Hanches sous les genoux", "Debout complet en haut", "Talons au sol, genoux dans l'axe", "Dos droit, poitrine haute", "Pieds largeur d'épaules, fixes", "Rythme régulier"],
  "BURPEES BROAD JUMP": ["Poitrine au sol", "Mains juste devant les pieds", "Départ et arrivée à deux pieds", "Aucun pas en plus", "Pieds derrière les mains", "Intensité maximale"],
  "FENTES MARCHÉES": ["Genou arrière au sol", "Debout complet entre deux", "Jambes alternées", "Aucun pas entre deux fentes", "Pied avant passe la ligne", "Intensité maximale"],
  "FARMER CARRY": ["Charge toujours portée", "Bras chargés tendus", "Charges posées sur place", "Ligne franchie avec le pied","Soulevé jambes fléchies, dos droit", "Marche rapide"],
  "TOUR DE POUTRE": ["Passages contrôlés", "Assez haut au-dessus", "Maîtrisé en dessous", "Retournement coordonné", "Transitions immédiates", "À fond"],
};
export const shortCriteriaFor = (label: string): string[] => {
  const k = keyOf(label);
  const list = SHORT_CRITERIA[k];
  return list ? [...list.slice(0, TECH_CRITERIA), INTENSITY_SHORT[k] ?? list[list.length - 1]] : criteriaFor(label);
};

// Exercice ajoute plus tard sans criteres : grille generique (3 techniques + intensite).
export const GENERIC_CRITERIA = [
  "Le dos reste droit et la posture est sécurisée pendant tout le mouvement.",
  "L'amplitude du mouvement est complète à chaque répétition.",
  "Le mouvement est contrôlé, sans élan ni à-coup dangereux.",
  "L'intensité est maintenue du début à la fin.",
];

// Anciens libelles encore figes dans des seances passees (29/09 : le tire tapis n'est plus un aller-retour).
const LEGACY_LABELS: Record<string, string> = { "TIRE TAPIS AR": "TIRE TAPIS", POMPAGE: "POMPES", POMPAGES: "POMPES" }; // + alias : « pompage » = pompes (station du WOD Eval)
const keyOf = (label: string) => { const k = label.trim().toUpperCase(); return LEGACY_LABELS[k] ?? k; };
// Grille de l'arbitre pour un exercice : 4 criteres (3 techniques + intensite).
export const criteriaFor = (label: string): string[] => REFEREE_CRITERIA[keyOf(label)] ?? GENERIC_CRITERIA;
// Grille COMPLETE d'un exercice (les 6 criteres, du plus important au moins important) : arbitre prof du WOD Eval.
export const fullCriteriaFor = (label: string): string[] => CRITERIA[keyOf(label)] ?? GENERIC_CRITERIA;

// Emoji-resume de chaque critere de l'arbitre (Sartay 29/09 nuit : « pour que l'arbitre trouve plus vite ce qu'il doit
// observer ; l'emoji est une sorte de resume du critere »), dans l'ordre de REFEREE_CRITERIA (3 techniques + intensite).
// Reperes communs : 📏 corps aligne, 🧱 bassin stable, 🧍 dos droit / debout, ⬇️ amplitude basse, ↕️ extension, 💪 bras
// tendus, 🪶 reception amortie, 🚀 poussee explosive, ⏱️ rythme, 🔥 intensite.
export const CRITERIA_EMOJI: Record<string, string[]> = {
  POMPES: ["📏", "⬇️", "💪", "⏱️"],
  "SQUATS JUMP": ["⬇️", "↕️", "🦘", "🔁"],
  BURPEES: ["⬇️", "↕️", "🙌", "🔥"],
  "COMMANDO BRAS": ["📏", "🧱", "💪", "⏱️"],
  "BREAK DANCE": ["🦵", "🚫", "🌀", "↔️"],
  "ONE REP": ["🦶", "🧱", "✋", "⏱️"],
  CORDE: ["🪶", "🧍", "🔄", "🔥"],
  "SMASH DOWN": ["🙌", "↕️", "💥", "⚡"],
  "WALL BALL SHOT": ["⬇️", "🎯", "🤲", "⏱️"],
  "TIRE TAPIS": ["🧍", "🦵", "✊", "🔥"],
  "FLIP TAPIS": ["🧍", "🦵", "👀", "🔥"],
  "KB SNATCH": ["🔒", "🚀", "🌀", "⏱️"],
  "KB SWING": ["🚀", "🧍", "〰️", "⏱️"],
  "KB TOUR": ["🧍", "🧱", "🤝", "⏱️"],
  "ALLER-RETOUR": ["🏃", "👆", "⚡", "🔥"],
  "MONKEY SLIDE": ["🪶", "✋", "⬇️", "⏱️"],
  "PLANK SLIDE": ["📏", "📍", "🔀", "⏱️"],
  "FENTES DISK": ["🦵", "🎯", "🧍", "⏱️"],
  TRACTIONS: ["🔝", "💪", "🚫", "🔥"],
  "BOX JUMP": ["👣", "📦", "🧍", "⏱️"],
  SQUATS: ["⬇️", "↕️", "🦶", "⏱️"],
  HELICO: ["📏", "🔄", "💪", "⏱️"],
  "BURPEES BROAD JUMP": ["⬇️", "✋", "👣", "🔥"],
  "FENTES MARCHÉES": ["🦵", "🧍", "🔀", "🔥"],
  "FARMER CARRY": ["🏋️", "💪", "📍", "🔥"],
  "TOUR DE POUTRE": ["🛡️", "⬆️", "⬇️", "🔥"],
};
const GENERIC_EMOJI = ["🧍", "📐", "🎛️", "🔥"];
export const criteriaEmojisFor = (label: string): string[] => CRITERIA_EMOJI[keyOf(label)] ?? GENERIC_EMOJI;
// Emoji d'une phrase de critere (liste de l'arbitre, evaluations deja rendues) ; null pour une phrase d'avant.
const EMOJI_BY_SENTENCE = new Map<string, string>([
  ...Object.entries(REFEREE_CRITERIA).flatMap(([k, list]) => list.map((sentence, i) => [sentence, (CRITERIA_EMOJI[k] ?? GENERIC_EMOJI)[i]] as [string, string])),
  ...GENERIC_CRITERIA.map((sentence, i) => [sentence, GENERIC_EMOJI[i]] as [string, string]),
]);
export const criterionEmoji = (sentence: string): string | null => EMOJI_BY_SENTENCE.get(sentence) ?? null;


export type CriterionCheck = { label: string; met: boolean };
export function readCriteria(raw: unknown): CriterionCheck[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.filter((c): c is CriterionCheck => !!c && typeof c === "object" && typeof (c as CriterionCheck).label === "string" && typeof (c as CriterionCheck).met === "boolean");
  return out.length ? out : null;
}

// Appreciation « coup de coeur » (E) : les 4 criteres coches ET le ❤️ de l'arbitre.
export const LIKE_VALUE = QUALITY_LEVELS[QUALITY_LEVELS.length - 1].value;
// Appreciation (valeur de l'echelle) d'apres les criteres coches.
// Grille de 4 (depuis le 29/09) : 0 = TI, 1 = I, 2 = S, 3 = B, 4 = TB ; 4 + ❤️ = E. Une grille d'une autre taille
// est ramenee a 4, sauf l'ancienne grille de 6 (evaluations d'avant le 29/09) : 1 = TI ... 6 = E.
export function qualityFromCriteria(met: number, total: number, liked = false): number {
  if (total === 6) {
    const scaled = Math.round((met / total) * 6);
    return QUALITY_LEVELS[Math.max(0, Math.min(QUALITY_LEVELS.length - 1, scaled - 1))].value;
  }
  if (total > 0 && met >= total && liked) return LIKE_VALUE;
  const idx = total > 0 ? Math.round((met / total) * 4) : 0; // 0..4 -> TI, I, S, B, TB
  return QUALITY_LEVELS[Math.max(0, Math.min(4, idx))].value;
}
// Evaluation « aimee » : tous les criteres coches et appreciation E.
export const isLiked = (note: number, checks: CriterionCheck[] | null | undefined) => !!checks?.length && checks.every((c) => c.met) && note === LIKE_VALUE;

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "");
// « KB SNATCH » -> « KB snatch », « TIRE TAPIS » -> « Tire tapis » : sigles gardes en capitales.
export const exoLabel = (label: string) => label.trim().split(" ").map((w, i) => (w === "KB" || w === "AR" ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase())).join(" ");
const exoName = exoLabel;

// Commentaire constructif pour l'eleve : ce qui est acquis, puis les criteres non realises dans l'ordre
// d'importance (securite et posture d'abord), formules comme des objectifs.
export function criteriaComment(exerciseLabel: string, checks: CriterionCheck[], liked = false): string {
  const met = checks.filter((c) => c.met);
  const todo = checks.filter((c) => !c.met);
  const exo = exoName(exerciseLabel);
  if (!todo.length && liked) return `Excellent en ${exo} : les ${checks.length} critères sont réalisés, et l'arbitre a eu un coup de cœur ❤️. Tu peux servir d'exemple !`;
  if (!todo.length) return `Très bien en ${exo} : les ${checks.length} critères sont réalisés. Continue comme ça !`;
  const parts: string[] = [];
  parts.push(met.length ? `${exo} : ${met.length} critère${met.length > 1 ? "s" : ""} sur ${checks.length} déjà réalisé${met.length > 1 ? "s" : ""}, c'est une bonne base.` : `${exo} : c'est le moment de reprendre les bases, pas à pas.`);
  parts.push(`Ton prochain objectif : ${lowerFirst(todo[0].label)}.`);
  if (todo[1]) parts.push(`Ensuite, veille à ceci : ${lowerFirst(todo[1].label)}.`);
  if (todo.length > 2) parts.push(`Encore ${todo.length - 2} point${todo.length - 2 > 1 ? "s" : ""} à travailler après ça : tu vas y arriver.`);
  return parts.join(" ");
}
