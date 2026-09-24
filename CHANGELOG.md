# Changelog

## 2026-09-24 — Retours de partie : temps/lieu visibles, plan du Mastermind consultable, objets suivis repliables, second champ pour l'ellipse

Suite à une partie réelle en production, quatre lacunes remontées par
l'utilisateur :

- **Panneau temps/lieu toujours visible** (`#storyTimePlace`, `public/
  index.html`/`app.js`/`style.css`) : bandeau collant (`position: sticky`)
  au-dessus du texte du chapitre, affichant la date courante (`storyClock`,
  déjà calculée depuis le Milestone 1 mais jamais renvoyée au client — ajouté
  à `GET /api/saves/:id`) et le lieu courant (`state_updates.location`,
  déjà généré par le Writer à chaque tour mais silencieusement ignoré par
  `persistTurn` — maintenant persisté sur `save.currentLocation`, inclus
  dans `captureSnapshot`/`rewindToTurn` pour rester cohérent avec "reprendre
  à partir d'ici").
- **Plan du Mastermind consultable en mode auteur** (`#mastermindPlanBox`) :
  jusqu'ici le plan actif (`mastermindPlans`, Milestone 3) n'était lisible
  nulle part dans l'app, même en mode auteur — `getActiveMastermindPlan`
  exporté et renvoyé par `GET /api/saves/:id?debug=1`, affiché en lecture
  seule (résumé + points) à côté de secretInfoBox/proofreaderFlagBox.
- **Objets suivis repliés par défaut** (`#trackedItemsToggleBtn`) : le
  panneau `trackedItemsPanel` démarre replié (`.collapsed`) et se déplie via
  un nouveau bouton 🎒 dans la rangée d'icônes, pour alléger la page de jeu.
- **Second champ pour l'ellipse temporelle** (`#timeSkipBehaviorInput`) :
  jusqu'ici "passer du temps" ne demandait que ce vers quoi l'ellipse devait
  mener (`hint`) ; un second champ optionnel décrit maintenant le
  comportement du personnage pendant cette période (`behavior`), transmis
  à `buildTimeSkipPrompt`/`playTimeSkipStreaming` et inclus dans la requête
  envoyée au Récupérateur (`[hint, behavior].join(' — ')`).

Point *volontairement* non traité dans ce lot : la refonte du Mastermind
pour qu'il tourne à chaque tour (au lieu de tous les `MASTERMIND_EVERY = 5`
tours) et que sa sortie alimente directement le Récupérateur — implique des
arbitrages coût/latence non tranchés, remis à l'utilisateur avant
implémentation.

## 2026-09-23 — Outils de débogage pour surveiller les 5 rôles en production

Contexte : impossible pour moi (l'assistant) d'atteindre directement l'URL
de l'app en production (bloqué par la politique réseau du bac à sable, testé
avec curl et WebFetch, sur le domaine Railway comme sur les endpoints
`/api/...`) — donc pas d'accès direct à la base ni à un endpoint HTTP, quel
qu'il soit. Solution retenue avec l'utilisateur : puisque les journaux de
déploiement Railway restent lisibles (via l'outil `railway-agent`), faire
écrire à l'app elle-même tout ce qui est nécessaire au diagnostic dans ses
propres logs plutôt que d'exposer un endpoint à interroger.

- **Traces systématiques par rôle**, désormais loguées à chaque exécution
  (pas seulement à l'échec comme avant) — une ligne par appel, métadonnées
  structurelles uniquement (jamais le contenu du prompt/de la réponse) :
  - `[writer] kind=... save=... provider=... model=...` (`callText`/
    `streamTextTracked`, `lib/gameEngine.js`) — chaque appel du Writer
    (narration, état, ellipse, POV, création de monde...), avec le
    fournisseur/modèle réellement utilisé (confirme un éventuel fallback).
  - `[turn] save=... turn=N outcome=...` (`persistTurn`) — un tour persisté,
    quel que soit le chemin (normal, streaming, ellipse, POV).
  - `[archivist] save=... turn=N provider=... model=...: X/Y fact(s) written`
  - `[proofreader] save=... turn=N provider=... model=...: X flag(s) raised`
    (le cas 0 flag, très majoritaire, est maintenant distinguable d'un rôle
    qui ne tourne pas du tout).
  - `[mastermind] save=... turn=N provider=... model=...: plan updated (X beat(s))`
    ou `: empty plan received` selon le cas.
- **`logDebugSnapshot(saveId)`** (nouveau, `lib/gameEngine.js`) + route
  `POST /api/saves/:id/debug-dump` (`server.js`) : instantané complet d'une
  sauvegarde en une seule ligne JSON dans les logs — tours récents, faits
  récents de l'Archivist, plan actif complet du Mastermind (jamais visible
  ailleurs, y compris en mode auteur), tous les signalements du Proofreader,
  répartition des coûts par rôle, et un résumé des réglages actifs
  (fournisseur/modèle principal, clé du modèle léger configurée ou non,
  fournisseur d'images/d'embeddings) — sans jamais renvoyer de clé brute.
- **Bouton 📋 en mode auteur** (`public/index.html`/`app.js`) : déclenche le
  dump ci-dessus depuis l'interface, à côté des autres actions réservées au
  mode auteur (🔍/⏩/🎭/🗑️🖼️).

Vérifié de bout en bout (fournisseur mock, Playwright pour l'UI) : chaque
rôle produit bien sa ligne de log à chaque tour ; le Mastermind loggue
correctement au tour 1 (`MASTERMIND_EVERY`) ; le bouton de dump est bien
caché hors mode auteur, apparaît en mode auteur, et produit une ligne
`[debug-dump]` contenant un JSON valide et complet en un seul appel.

## 2026-09-23 — Champ apparence physique pour les personnages jouables

Les personnages non-joueurs (`starting_characters`) avaient déjà un champ
`appearance` dédié depuis le début ; les personnages jouables n'en avaient
aucun — seul `description` existait, documenté comme « background,
personnalité », pas l'apparence physique. Conséquence concrète : le
portrait généré par IA n'avait souvent rien de concret à représenter, et le
narrateur ne recevait jamais de description fixe du personnage joué, donc
rien n'empêchait une contradiction d'un tour à l'autre (âge, carrure,
origine...). Signalé explicitement par l'utilisateur : le genre/sexe,
l'origine ethnique et les traits physiques concrets doivent être présents,
pour le modèle d'image comme pour la cohérence narrative.

- `lib/promptBuilder.js` : nouveau champ `appearance` dans le schéma
  `playable_characters` de `buildWorldCreationPrompt` (création de monde)
  et dans `buildCharacterGenerationPrompt` (génération d'un personnage par
  IA) — consigne explicite : âge, genre/présentation, origine ethnique ou
  carnation, carrure, cheveux, traits distinctifs, jamais vague ni omis.
  Consigne équivalente renforcée sur le champ `appearance` déjà existant des
  `starting_characters`.
- `buildTurnContextBlocks` : le bloc PLAYER CHARACTER inclut désormais une
  ligne `Appearance:` quand elle existe — lu à chaque tour, donc le
  narrateur reste cohérent sur qui est ce personnage au lieu de
  l'improviser à nouveau à chaque fois.
- `lib/gameEngine.js` : `appearance` porté de bout en bout — création de
  monde, `addCharacter`/`addCharacterWithPortrait` (ajout manuel),
  `generateCharacterWithAI`, `updateCharacter`. `defaultPortraitPromptText`
  utilise maintenant `appearance` en priorité (avant `description`) pour
  construire le prompt du portrait — c'est le champ réellement visuel.
- `server.js` : `POST /api/worlds/:id/characters` et
  `PATCH /api/worlds/:worldId/characters/:characterId` acceptent et
  transmettent `appearance`.
- Frontend (`public/app.js`) : nouveau champ apparence dans la fiche
  personnage de l'éditeur de monde et dans le formulaire d'édition rapide à
  la sélection de personnage — même libellé que celui déjà utilisé pour les
  PNJ. Miroir client de `defaultPortraitPromptText` mis à jour pareil.
- `providers/textProviders.js` (fournisseur mock) : les personnages
  d'exemple (création de monde et génération à la volée) ont maintenant un
  `appearance` réaliste, pour que le comportement de démo corresponde à ce
  qu'un vrai fournisseur produira désormais.

Vérifié de bout en bout (fournisseur mock) : `appearance` bien persisté par
les quatre chemins (création de monde, ajout manuel, génération IA, édition
PATCH) ; la ligne `Appearance:` apparaît bien dans le prompt de narration
réel envoyé au modèle (vérifié par inspection directe du texte généré, pas
seulement par la présence du champ en base) ; champ vérifié dans l'éditeur
de monde via Playwright — pré-rempli depuis la création, modifiable,
sauvegardé, survit à un rechargement de page. Aucune erreur JS introduite.

## 2026-09-23 — Sections repliables dans les réglages

Réglages a accumulé assez de champs (fournisseur + clés texte, modèle
léger, images + clés) que le défilement était devenu la vraie plainte.
Chaque `.settings-group` de cette vue (Texte, Modèle léger, Images, Coûts)
se replie maintenant au clic sur son titre — état mémorisé par section
(`localStorage`, uniquement côté navigateur, rien à synchroniser côté
serveur). Texte et Images démarrent repliés (les deux plus longs) ;
Modèle léger et Coûts restent ouverts par défaut (courts). L'éditeur de
monde réutilise la même classe `.settings-group` mais n'est pas concerné —
seules les sections de la vue Réglages sont câblées.

- `public/index.html` : `data-group-id` sur chaque section de Réglages,
  classe `collapsed` par défaut sur Texte et Images.
- `public/style.css` : chevron (`::after`, rotation au repli) et masquage
  du contenu d'une section repliée, scopés à `#view-settings` pour ne pas
  affecter l'éditeur de monde.
- `public/app.js` : `initSettingsGroupToggles()` — clic sur le titre bascule
  `collapsed` et persiste l'état par `data-group-id`.

Vérifié avec Playwright (Chromium headless) : état initial correct par
section, un clic replie/déplie et l'état choisi survit à un rechargement de
page, les sections restent indépendantes les unes des autres, aucune
erreur JS introduite.

## 2026-09-23 — Modèle léger verrouillé pour les rôles de fond

Nouveau réglage `backgroundModel` (une seule clé API Gemini) utilisé par
l'Archivist, le Proofreader et le Mastermind — les trois rôles asynchrones,
jamais sur le chemin critique du joueur. Contrairement au fournisseur
principal (`textProvider`/`textModel`, choisi librement dans les réglages),
le modèle de ces trois rôles est verrouillé en dur sur Gemini 3.5 Flash Lite
(`lib/backgroundModel.js`) — pas de sélecteur, juste la clé. Sans clé
renseignée, ils continuent d'utiliser le fournisseur principal comme avant
(comportement inchangé pour toute installation existante).

- `lib/backgroundModel.js` : `getBackgroundModelConfig(settings)`, seul
  point d'entrée utilisé par les trois rôles.
- `lib/db.js` : `DEFAULT_SETTINGS.backgroundModel = { apiKey: '' }`.
- `server.js` : `GET /api/settings` masque la clé (booléen, comme les
  autres) ; `POST /api/settings` la fusionne comme `apiKeys`.
- `roles/archivist.js`, `roles/proofreader.js`, `roles/mastermind.js` :
  utilisent `getBackgroundModelConfig` au lieu de
  `settings.textProvider`/`textModel`/`apiKeys[textProvider]`.
- Réglages (`public/index.html` + `app.js`) : nouvelle section « Modèle
  léger (tâches de fond) » avec un seul champ clé API.

## 2026-09-23 — Milestone 4 : détection de contradiction complète du Proofreader

Complète le Proofreader du Milestone 3 (qui ne vérifiait que le rythme
temporel contre `storyClock`) avec le second volet annoncé dans son propre
commentaire d'origine : une vérification contre les faits enregistrés,
au-delà du seul rythme temporel.

- **Récupération omnisciente** (`lib/db.js` : nouveau paramètre
  `omniscient` sur `searchMemoryFactsByEmbedding`, répercuté dans
  `roles/retriever.js`) : contourne délibérément le mur de connaissance
  `knownBy` du mécanisme POV. Ce mur existe pour empêcher un *personnage*
  de savoir quelque chose qu'il n'a aucun moyen de savoir — il n'a jamais
  eu vocation à cacher des faits à une vérification de cohérence narrateur,
  qui doit au contraire voir un fait privé ou un secret : c'est justement
  le genre de détail qu'une contradiction peut concerner.
- Le chapitre qui vient d'être écrit est maintenant vérifié contre les
  faits les plus pertinents pour lui (`gameEngine.js`'s `fireProofreader`
  interroge `retriever.retrieveRelevantFacts` avec le texte du chapitre
  comme requête, `omniscient: true`) — même mécanisme borné par similarité
  que le bloc KNOWN FACTS du Writer, volontairement pas un déversement de
  l'archive entière à chaque tour (coût et latence réels sur une longue
  sauvegarde, pour un bénéfice décroissant).
- `buildProofreaderPrompt`/`buildProofreaderMasterPrompt` : le modèle
  vérifie maintenant deux choses, et seulement deux — le rythme temporel
  (inchangé depuis le Milestone 3) et une contradiction factuelle concrète
  (un nom, un chiffre, une date, un lien entre personnages qui ne peut pas
  être vrai en même temps que ce qui est déjà enregistré). Forme de
  réponse changée d'un objet `contradiction` nullable unique à un tableau
  `contradictions` (chaque entrée taguée `type: "pacing" | "fact"`) — un
  même chapitre peut légitimement cumuler les deux.
- `roles/proofreader.js` : `checkChapter` accepte désormais `relevantFacts`
  et écrit une ligne `proofreaderFlags` par contradiction trouvée (la table
  n'a jamais eu de contrainte d'unicité sur `(saveId, turnNumber)`, donc
  plusieurs lignes pour un même tour est la forme attendue, pas un bug).
- Surfaçage frontend (`.proofreader-flag-box`) : affiche désormais tous les
  signalements d'un tour, chacun préfixé selon son type
  (`proofreaderFlagPacingPrefix`/`proofreaderFlagFactPrefix`), toujours
  strictement réservé au mode auteur.

Vérifié de bout en bout (fournisseur mock, nouveau déclencheur d'action
« fact test » en plus de « pacing test ») : un fait enregistré par
l'Archivist sur un tour antérieur (« Keeper Oduya tient le phare depuis
onze ans ») est bien retrouvé par la récupération omnisciente réelle (pas
un raccourci codé en dur) lorsqu'un tour ultérieur la présente comme étant
« à son premier jour » — signalement `type: "fact"` produit. Le chemin
« rythme temporel » du Milestone 3 continue de fonctionner sans
régression. Un tour normal ne produit aucun signalement. Mode auteur :
signalements absents sans `debug=1`, présents avec. Rewind/suppression en
cascade : nettoyage correct de `proofreaderFlags` quel que soit le nombre
de lignes pour un tour donné. Aucune erreur dans les logs sur l'ensemble
de la session de test.

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
