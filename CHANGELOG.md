# Changelog

## 2026-09-23 — Milestone 3 : le Proofreader et le Mastermind

Les deux rôles restants du plan de migration (voir le doc de conception
« Fogbound V2 Architecture »). Aucun des deux n'écrit jamais ce que le
joueur voit — ils tournent en tâche de fond, hors du chemin critique,
exactement comme l'Archivist depuis le Milestone 1.

**Le Proofreader** (`roles/proofreader.js`) : première passe volontairement
étroite, comme annoncé dans son commentaire d'origine — uniquement le
langage de rythme temporel contre `storyClock`, le scénario précis qui a
motivé le doc (un mois qui vient de passer, mais le chapitre parle encore
de « ce matin »). Pas de vérification de contradiction complète sur
l'ensemble de l'archive de faits — ça, c'est le Milestone 4.

- Nouvelle table `proofreaderFlags` (une ligne par tour où une
  contradiction a réellement été détectée — la grande majorité des tours
  n'en produisent aucune, contrairement à `memoryFacts`/`turns`).
- Nouveau prompt dédié (`buildProofreaderPrompt`) : donne au modèle le
  chapitre qui vient d'être écrit et le `storyClock` juste après ce même
  tour, lui demande de ne signaler qu'une contradiction concrète et
  certaine — une fausse alerte coûte plus cher qu'un oubli, donc consigne
  explicite de rester silencieux (`{"contradiction": null}`) dans le doute.
- Déclenché depuis `playTurn`/`playTurnStreaming` uniquement — ni l'ellipse
  temporelle explicite (le joueur vient justement de demander qu'une longue
  période passe : ce n'est pas une contradiction), ni une scène POV (elle
  raconte un autre moment sur sa propre ancre « CURRENT SITUATION », sans
  faire avancer l'horloge narrative principale).
- Surfaçage strictement réservé au mode auteur (🔍) — jamais renvoyé par
  `GET /api/saves/:id` en dehors de `debug=1`, même traitement que
  `secretInfo`. Petit encart d'avertissement sur la page concernée
  (`.proofreader-flag-box`), jamais visible du joueur.

**Le Mastermind** (`roles/mastermind.js`) : maintient un plan narratif
caché — quelques futurs développements/événements de fond — que le Writer
peut mobiliser sans y être obligé. Contrairement au Proofreader (déclenché
à chaque tour normal), tourne sur un rythme périodique
(`MASTERMIND_EVERY = 5` tours, ancré sur `turnNumber % 5 === 1` pour amorcer
un premier plan dès le deuxième tour réel plutôt que de laisser la
sauvegarde sans plan jusqu'au tour 5).

- Table `mastermindPlans` (déjà présente dans le schéma depuis le
  Milestone 0, inutilisée jusqu'ici) : versionnée comme `memoryFacts`
  (`status: active|superseded`, `supersededBy`) — une ligne active par
  sauvegarde, l'historique n'est jamais supprimé.
- Garde-fou du doc, restauré textuellement dans le prompt lui-même
  (`buildMastermindMasterPrompt`) : le Mastermind propose, il ne réécrit
  jamais rétroactivement ce qui a déjà été raconté au joueur — tout ce
  qu'il veut voir établi doit d'abord être réellement écrit dans un
  chapitre, puis passer par le même pipeline Archivist que n'importe quel
  autre fait.
- Le plan actif est relu dans `gatherTurnContext` et injecté comme un
  nouveau bloc « MASTERMIND'S PLAN » (caché du joueur, même traitement que
  SECRET INFO) dans `buildNarrationPrompt`/`buildTurnPrompt` — pas dans les
  prompts d'ellipse temporelle/POV, même raisonnement de portée que le
  Proofreader ci-dessus.
- Décision de portée assumée : pas de surfaçage frontend, même en mode
  auteur — contrairement à `secretInfo` que l'auteur peut voir/éditer
  directement, le plan du Mastermind reste une donnée purement interne au
  Writer. Rien dans le doc de conception ne demande une UI dédiée pour ce
  rôle ; à reconsidérer si ça manque en pratique.

Vérifié de bout en bout (fournisseur mock) : le plan du Mastermind s'amorce
bien au tour 1, et le bloc MASTERMIND'S PLAN apparaît vérifié dans le
prompt du tour suivant (confirmé par lecture directe du texte généré, pas
seulement par la présence de la ligne en base). Un tour délibérément
contradictoire (« several weeks » dans `storyClock` contre « this morning »
dans le texte) produit bien une ligne `proofreaderFlags`, invisible sans
`debug=1` et visible avec. Rewind : une ligne `mastermindPlans` postérieure
au point de rewind disparaît, une ligne antérieure ou égale survit (testé
dans les deux cas) ; une ligne `proofreaderFlags` postérieure disparaît de
la même façon. Suppression en cascade d'un monde/d'une sauvegarde : les
deux nouvelles tables reviennent à 0 comme le reste. Aucune erreur dans les
logs sur l'ensemble de la session de test.

## 2026-09-23 — Mécanique de changement de point de vue (POV)

Ajouté hors plan de migration, à la demande explicite, en réaction directe à
une préoccupation posée en cours de route : forcer l'IA à changer de point
de vue longtemps finit par lui faire mélanger ce que le héros et le
personnage temporaire savent respectivement. La contrainte demandée était
un « mur » net entre ce que chaque personnage sait, pas seulement que ça
« ait été écrit ». Déclenchement exclusivement joueur/auteur, jamais
autonome (contrairement à l'ellipse temporelle) — décision explicite de
l'utilisateur face aux options proposées.

- **`memoryFacts.knownBy`** (nouveau champ, `string[] | null`, défaut
  `null` = connu publiquement) : distinct de `character` (qui déjà présent
  taguait le *sujet* du fait) — `knownBy` tague l'*audience*, qui a
  effectivement connaissance du fait. Appliqué au moment de la récupération
  (`searchMemoryFactsByEmbedding`/`retrieveRelevantFacts`, nouveau
  paramètre `viewerCharacter`), pas laissé au jugement du modèle — c'est
  exactement le mur demandé, imposé mécaniquement plutôt qu'espéré d'une
  instruction de prompt. Généralise au-delà du POV : tout partage
  d'information privée/secrète entre personnages passe par le même champ.
- **Scènes POV = un seul tour, autonome, sans changer `activeCharacterId`**
  : le personnage contrôlé par le joueur ne change jamais — c'est un
  procédé de narration ponctuel (une scène « pendant ce temps, ailleurs »),
  pas un changement de personnage persistant. Répond directement à
  l'inquiétude de départ : rien à suivre sur la durée, donc rien où l'IA
  puisse perdre le fil.
- **Voix narrative** : toujours à la troisième personne pour le personnage
  POV — « tu »/« vous » reste réservé au héros pendant toute la partie,
  pour qu'il n'y ait jamais d'ambiguïté sur qui agit.
- **`buildPovPrompt`/`buildPovMasterPrompt`** (nouveau prompt dédié,
  toujours single-shot) : bloc « VIEWPOINT CHARACTER » à la place de
  « PLAYER CHARACTER », aucun `secretInfo` (c'est l'état caché du
  héros/narrateur, pas de ce personnage), pas de bloc RECENT SCENES verbeux
  (même raisonnement que l'ellipse temporelle : une seule ancre « CURRENT
  SITUATION »), `outcome`/`skill_used`/`game_over`/`suggested_actions`
  toujours forcés à `n/a`/`null`/`null`/`[]` — il n'y a rien ici sur quoi le
  joueur agit. Le héros n'apparaît que comme une entrée synthétique dans
  OTHER CHARACTERS, filtrée par le même mur `knownBy`.
- **Archivist** : `buildArchivistPrompt`/`buildArchivistMasterPrompt`
  reçoivent un `povCharacter` optionnel qui change la consigne KNOWN BY —
  sur une scène POV, les nouveaux faits sont par défaut sus au minimum du
  personnage POV, avec instruction explicite de ne pas supposer que le
  héros (absent de la scène) les connaît ; sur un tour normal, le
  comportement par défaut ne change pas (`knownBy: null`, public).
- **`playPovTurnStreaming`** (nouvelle fonction, `lib/gameEngine.js`) :
  même mécanique de streaming que `playTimeSkipStreaming`
  (`===CHAPTER===`/`===META===`), route dédiée
  `POST /api/saves/:id/pov/stream`. Le tour produit porte
  `turn.povCharacter` (nom du personnage narré, `null` sur un tour normal).
- **UI** : bouton 🎭 à côté du bouton ⏩, ouvre un sélecteur de personnage
  (alimenté par `saveCharacters`, désormais exposé par
  `GET /api/saves/:id`) plus un champ d'indication optionnel sur ce que la
  scène doit montrer. Badge « 🎭 Du point de vue de X » affiché sur la page
  concernée, même traitement visuel que le badge d'ellipse temporelle.

Vérifié de bout en bout (fournisseur mock) : tour normal → scène POV
(troisième personne, `suggestedActions` vide, `povCharacter` correctement
posé) → nouveau fait tagué `knownBy: ["Keeper Oduya"]` par l'Archivist.
Mur de connaissance testé dans les deux sens via un appel direct à
`retriever.retrieveRelevantFacts` : vu par le héros, seul le fait public
apparaît (le fait privé de la scène POV est bien filtré) ; vu par le
personnage POV lui-même, les deux apparaissent. Rewind sur le tour POV :
le fait `knownBy`-tagué disparaît avec le tour (même mécanisme que
n'importe quel autre fait, aucune table dédiée à nettoyer). Régénération du
tour rewindé avec une action normale : redevient un tour normal, `povCharacter`
repasse à `null`. Suppression en cascade d'un monde/d'une sauvegarde :
toutes les tables (`worlds`, `saves`, `turns`, `memoryFacts`, `storyClock`,
`timelineEvents`, `saveCharacters`, `costLog`) reviennent à 0. Aucune
erreur sur l'ensemble de la session de test.

Même limite connue que l'ellipse temporelle, et pour la même raison :
régénérer un tour qui était une scène POV le repasse par le chemin de tour
normal (`regenerateTurn`/`regenerateTurnStreaming` ne passent pas
`povCharacter`) — l'identité « ceci était une scène POV » n'est pas
préservée à la régénération. Pas bloquant, à revisiter si ça gêne en
pratique.

## 2026-09-23 — Mécanique d'ellipse temporelle (avant le Milestone 3)

Ajouté hors plan de migration, à la demande explicite : l'IA a souvent du
mal à savoir quand *ne pas* raconter scène par scène (un trajet, une
convalescence, un apprentissage) et reste bloquée sur des moments à faible
enjeu au lieu d'avancer. Deux façons de déclencher une ellipse, comme
convenu :

- **Autonome** : le Writer peut désormais décider, sur n'importe quel tour
  normal, de compresser une période plutôt que de la raconter en temps réel
  — voir la section « PACING & TIME SKIPS » ajoutée à
  `buildNarrationMasterPrompt`/`buildMasterPrompt`. Aucune UI requise :
  c'est une extension du schéma de sortie existant (`time_skip`), au même
  titre que `game_over`.
- **Explicite** : nouveau bouton ⏩ à côté du formulaire d'action, qui ouvre
  un petit champ pour préciser vers quoi avancer (optionnel). Passe par un
  prompt de narration dédié (`buildTimeSkipPrompt`), volontairement
  différent de celui d'un tour normal — comme pressenti, la fenêtre de
  contexte compte autant que les instructions : le bloc RECENT SCENES
  (5 derniers tours, verbeux) est justement ce qui retient le modèle dans
  la scène immédiate, donc ce chemin le remplace par une seule ancre courte
  (« CURRENT SITUATION », le dernier chapitre uniquement) plutôt que
  d'empiler des instructions de compression sur un contexte qui pousse dans
  l'autre sens.
- **`timelineEvents`** (nouvelle table) : la « frise chronologique »
  demandée — un enregistrement par ellipse (jamais par tour normal),
  jamais purgé (sauf rewind), toujours inclus en entier dans chaque prompt
  suivant sous forme de bloc STORY TIMELINE. C'est ce qui permet à une
  histoire avec plusieurs ellipses de rester cohérente avec elle-même
  plutôt que de contredire une ellipse précédente.
- **`storyClock` n'est plus write-only** : alimenté depuis le Milestone 1
  mais jamais relu jusqu'ici — le Writer voit maintenant le point actuel
  dans le temps de l'histoire (bloc STORY CLOCK) avant de décider si une
  ellipse a du sens.
- Petit badge « ⏩ X passé » affiché sur la page du tour concerné, côté
  joueur comme auteur, alimenté par `GET /api/saves/:id` (le même appel
  déjà refait après chaque tour streamé).

Les deux chemins réutilisent le même appel d'état (`buildStatePrompt`)
sans modification pour la mise à jour des objets suivis/secretInfo — seule
la moitié narration diffère, exactement là où le cadrage doit changer.

Vérifié de bout en bout (fournisseur mock) : ellipse explicite via
l'endpoint streamé, écriture correcte de `timelineEvents`/`storyClock`,
le bloc STORY TIMELINE apparaît bien dans le tour suivant, nettoyage
correct au rewind (l'entrée de l'ellipse disparaît, `lastReferencedTurn`
est ramené au bon tour) et à la suppression en cascade d'un monde/d'une
sauvegarde. Aucune erreur sur l'ensemble de la session de test.

Limite connue : régénérer un tour qui était une ellipse le repasse par le
chemin de tour normal (`regenerateTurn` rejoue `playerAction` via
`playTurn`/`playTurnStreaming`, pas `playTimeSkipStreaming`) — l'identité
« ceci était une ellipse » n'est pas préservée à la régénération. Le Writer
peut toujours redécider d'une ellipse de lui-même sur ce tour rejoué (même
schéma de sortie), mais ce n'est plus garanti comme au premier passage.
Pas bloquant pour ce livrable, à revisiter si ça gêne en pratique.

## 2026-09-22 — Milestone 2 : le Retriever, mémoire par similarité plutôt que par récence

Livrable central du doc de conception : remplacer le plafond par récence
(Milestone 1) par une vraie recherche par similarité sur l'archive de
faits — voir la section « Retrieval mechanism ».

- **`providers/embeddingProviders.js`** (nouveau) : fournisseur `mock`
  (technique du hashing — FNV-1a dans un vecteur à largeur fixe,
  normalisé L2 — un vrai signal de similarité lexicale, pas un
  placeholder, et surtout utilisable sans aucune clé API, comme tous les
  autres fournisseurs `mock` de l'app) et fournisseur `gemini`
  (`text-embedding-004`, réutilise `apiKeys.gemini` existant). Nouveau
  réglage `settings.embeddingProvider` (défaut `mock`), même schéma que
  `textProvider`/`imageProvider`.
- **`sqlite-vec`** intégré à `lib/db.js` : table virtuelle
  `memoryFacts_vec` (768 dimensions, `lib/embeddingConfig.js` fait
  autorité), synchronisée par rowid avec `memoryFacts` à chaque
  insertion/suppression (`syncVecInsert`/`syncVecDelete`) — gameEngine.js
  et les rôles n'y touchent jamais directement, seulement via
  `db.get('memoryFacts')` comme n'importe quelle autre collection.
  `db.searchMemoryFactsByEmbedding()` fait la recherche KNN scopée par
  save + personnage (candidats indexés par `saveId`, filtrés en JS sur
  `status`/`character`/`type`, puis `rowid IN (...)` sur la table
  vectorielle — sqlite-vec 0.1.9 n'accepte pas de paramètre lié pour le
  rowid d'une table vec0 en écriture, d'où l'inlining documenté dans
  `lib/db.js`).
- **`roles/retriever.js`** implémenté : étant donné l'action du joueur +
  une fenêtre de scènes récentes, embed la requête et récupère le top-K
  par similarité, pour le pool général ET pour chaque personnage — les
  deux remplacent le plafond par récence du Milestone 1.
  `gatherTurnContext` (gameEngine.js) devient asynchrone en conséquence.
  WORLD LORE (faits biographiques sans personnage) reste statique et
  intégral, inchangé.
- Chaque fait créé (`roles/archivist.js`, et `maybeSummarize` pour le
  résumé périodique + ses faits manqués) est maintenant embeddé au moment
  de sa création via `lib/embedFact.js` — sinon un fait créé par le résumé
  périodique serait invisible au Retriever.

Vérifié avec un test synthétique de 105 faits sur 5 sujets distincts,
étalés sur les tours 1 à 105 : interroger sur « le joueur ramasse la
lanterne » fait remonter le fait le plus ancien de toute l'archive (tour 1)
en 4ᵉ position, alors qu'aucun des 55 faits les plus récents (tours
51-105, du remplissage hors-sujet) n'apparaît dans le top 8 — la preuve que
c'est bien la pertinence qui pilote la sélection, pas la récence. Même
constat sur une deuxième requête sans rapport (enquête de Detective Voss).
Régression complète revérifiée (playthrough, regenerate, rewind,
suppression en cascade y compris `memoryFacts_vec`) sans erreur.

## 2026-09-22 — Milestone 1 : l'Archivist devient asynchrone, plafond par personnage, horloge narrative

Premier jalon qui ajoute vraiment quelque chose (pas seulement un portage) —
voir la section « Migration plan » du doc de conception. Trois livrables :

- **L'Archivist tourne en tâche de fond.** L'extraction de faits
  (`new_facts`) était jusqu'ici noyée dans le même appel modèle que la mise à
  jour des objets suivis / secretInfo — un appel que le joueur attend
  forcément. Elle a maintenant son propre prompt (`buildArchivistPrompt`,
  `roles/archivist.js`) et son propre appel, déclenché *après* que le tour
  soit déjà persisté et renvoyé au joueur, sans jamais être attendu
  (`fireArchivist` dans `gameEngine.js`) — un échec ou une lenteur de
  l'Archivist ne peut plus ralentir ni casser un tour. `roles/archivist.js`
  est volontairement autonome (son propre appel modèle, son propre suivi de
  coûts) plutôt que de dépendre de `gameEngine.js`, pour éviter un require
  circulaire et respecter la frontière de module que le doc demande.
- **Les faits par personnage sont désormais plafonnés**, exactement comme le
  pool général (`RELEVANT_FACTS_LIMIT`, les plus récents d'abord) — c'est le
  correctif direct du bug de production qui avait fait déborder le contexte
  d'un modèle Ollama local : un personnage récurrent sur une longue partie
  accumulait des faits sans limite. Vérifié avec un test synthétique (200
  faits injectés pour un seul personnage) : le contexte réellement envoyé au
  modèle reste plafonné à 20, en gardant les plus récents.
- **L'horloge narrative (`story_clock`)** est ajoutée au schéma de l'appel
  d'état et remplie par le Writer à chaque tour (`current_date`,
  `elapsed_description`, table `storyClock`) — rien ne la lit encore
  (Milestone 3, le Proofreader), mais elle est déjà alimentée honnêtement
  pour ne nécessiter aucune migration plus tard.

`lib/memoryFacts.js` (nouveau) porte les helpers de forme des faits
(`normalizeNewFact`/`newMemoryFact`), partagés entre `gameEngine.js` et
`roles/archivist.js` sans dépendance circulaire entre les deux.

Vérifié de bout en bout : latence d'un tour inchangée par rapport au
Milestone 0 (l'appel Archivist n'est jamais attendu), plafond par personnage
confirmé sur un test synthétique à 200 faits, `storyClock` correctement mis
à jour à chaque tour et nettoyé à la suppression d'une sauvegarde.

## 2026-09-22 — Milestone 0 : socle du nouveau dépôt, parité avec Fogbound

Nouveau dépôt, nouveau nom (« Trame », choisi pour évoquer la technique
d'écriture — la structure tissée sous une histoire — plutôt qu'une ambiance
ponctuelle). Fait suite au doc de conception « Fogbound V2 Architecture »,
qui détaille pourquoi (mémoire par récupération plutôt que par troncature,
rôles Writer/Retriever/Archivist/Proofreader/Mastermind) et le plan de
migration en 5 jalons.

Ce premier jalon (Milestone 0) est volontairement sans nouveauté
fonctionnelle : il porte tout ce qui existait dans Fogbound sur un nouvel
environnement, pour que les jalons suivants aient une base saine à faire
évoluer plutôt qu'un fichier `gameEngine.js` monolithique.

- **Base de données : lowdb (JSON) → SQLite.** `lib/db.js` expose une API
  compatible avec les chaînes lowdb utilisées par `gameEngine.js`/`server.js`
  (`.get().find().assign().write()`, `.filter().sortBy()`, etc.), mais
  chaque table a de vraies colonnes indexées (`worldId`, `saveId`,
  `turnNumber`, `itemDefId`) — les requêtes qui filtraient tout le tableau
  en JS passent maintenant par de vraies clauses `WHERE`. Bénéfice
  secondaire : l'atomicité des écritures SQLite ferme la classe de bug qui
  avait corrompu la base de Fogbound en production (voir l'en-tête de
  `lib/db.js`) — plus besoin du hack d'écriture atomique par fichier
  temporaire + renommage que ça avait forcé à ajouter après coup.
- **`memoryFacts` gagne trois champs additifs** (`status`, `supersededBy`,
  `embedding`) dès maintenant, même si rien ne les lit encore — pour que les
  Milestones 2 (Retriever) et 4 (résolution de contradictions) n'aient
  besoin d'aucune migration de schéma le moment venu.
- **Nouvelles tables additives, vides pour l'instant** : `storyClock`
  (Milestone 3) et `mastermindPlans` (Milestone 3) — même raisonnement.
- **`roles/`** : chaque rôle du doc de conception a son propre fichier.
  `writer.js` est actif (réexporte la logique de tour de `gameEngine.js`,
  qui reste la seule implémentation réelle à ce stade) ; `archivist.js`,
  `retriever.js`, `proofreader.js`, `mastermind.js` sont des stubs qui
  documentent leur propre jalon d'arrivée plutôt que du code mort silencieux.
- **Pont PC local et interface** portés tels quels (aucune logique
  changée), juste rebaptisés Fogbound → Trame partout où le nom apparaît à
  l'utilisateur (PWA, fenêtre du lanceur, tunnel).
