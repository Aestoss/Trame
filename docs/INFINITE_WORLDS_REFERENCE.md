# Infinite Worlds — référence fonctionnelle & technique

Ce document analyse en détail le fonctionnement de **infiniteworlds.app**, le
produit que Fogbound cherche à égaler, à partir de :

1. la capture d'écran fournie de l'écran "Edit world" (187 champs visibles,
   tous décrits ci-dessous) ;
2. le wiki officiel du jeu (`infiniteworlds.mywikis.wiki`) ;
3. un guide de création de mondes détaillant le schéma JSON complet utilisé
   en interne (`github.com/sabreking/IWGameCreationGuide`) ;
4. un article de presse (Decrypt) sur l'architecture du moteur.

Sources citées à la fin. L'objectif : servir de cahier des charges pour
combler l'écart entre Fogbound (actuel) et Infinite Worlds (référence).

> **Statut : document d'analyse historique.** La feuille de route qu'il
> propose (section 6, Phases A à G) est entièrement implémentée — voir
> `CHANGELOG.md`. Conservé tel quel pour le contexte et l'analyse détaillée
> des mécaniques d'Infinite Worlds, utile en référence pour toute évolution
> future (ex. les "Trigger events / KIBs" de la section 2.8, jamais repris
> côté Fogbound).

---

## 1. Architecture générale du moteur

Trois IA distinctes travaillent ensemble à chaque tour :

| Rôle | Ce qu'elle fait |
|---|---|
| **Storyteller AI** | Génère le texte de l'issue du tour (narration), les actions suggérées, et les *prompts* d'illustration. C'est le modèle choisi dans "AI model" (GPT-4 par défaut selon Decrypt ; l'utilisateur peut probablement changer de modèle, à l'instar de notre `textProvider`). |
| **Summary AI** | Tourne en tâche de fond : résume les tours anciens, met à jour les notes de personnage, condense l'historique. Se déclenche environ tous les 6 tours à partir du tour 8 (comparer à notre `SUMMARIZE_EVERY = 10`, proche dans l'esprit). |
| **Image AI** | Génère les illustrations à partir des prompts écrits par le Storyteller AI (pas directement par le joueur). Modèles : Flux.1, DreamShaper, etc. |

**Ce qui est envoyé au Storyteller AI à chaque tour** (confirmé par le wiki) :
- les *Main instructions* complètes du monde ;
- l'action du joueur ;
- les **2 à 8 derniers tours, verbatim** (fenêtre glissante, paramétrable
  selon la source — chez nous fixe à 5, `RECENT_TURNS_WINDOW`) ;
- un **résumé** des tours plus anciens ;
- la liste des personnages rencontrés : résumé bref pour ceux absents
  récemment, fiche complète pour ceux présents dans les derniers tours.

Fogbound fait déjà cette architecture en couches (Master Prompt / World
Bible / Mémoire / Tours récents) — c'est le bon squelette. Ce qui manque,
ce sont les **couches de données structurées** que ce squelette est censé
transporter (skills, personnages, objets suivis, déclencheurs...).

---

## 2. Champs de configuration d'un monde — référence complète

Regroupés comme dans l'écran "Edit world" observé, avec le nom du champ
JSON interne (guide GitHub) entre parenthèses quand connu.

### 2.1 Introducing the story

**Légende État Fogbound :** ✅ implémenté et éditable par l'auteur
(manuellement et/ou via la retouche IA) · ⚠️ généré à la création mais pas
éditable ensuite, ou équivalent partiel · ❌ absent.

| Champ | Description | État Fogbound |
|---|---|---|
| Title (`title`) | Nom du monde | ⚠️ généré (`world.title`), éditable seulement via la retouche IA — pas de champ texte direct dans l'éditeur |
| Track version number / Version (`version`, `autoAdvanceVersion`) | Numéro de version du monde, incrémenté automatiquement à chaque édition — sert quand l'auteur republie des mises à jour d'un monde partagé | ⚠️ `world.version` existe et s'incrémente bien à chaque édition, mais **n'est affiché nulle part dans l'interface** — invisible pour l'auteur |
| Description (`description`) | Résumé affiché dans le menu de sélection, **n'affecte pas le gameplay** | ✅ `world.description`, éditable, affichée dans la liste des mondes |
| "Show additional text on character selection screen" | Texte optionnel affiché à l'étape de choix du personnage | ❌ absent (seul un avertissement contenu mature peut s'afficher à cette étape) |
| Preview image + génération IA alternative / upload | Image affichée dans la liste des mondes | ⚠️ `coverImageUrl` généré automatiquement à la création si les images sont activées — **aucun bouton pour la régénérer ou en uploader une autre ensuite** |
| Background story (`background`) | Texte montré au joueur **avant** le début — influence la suite de l'histoire | ✅ `world.background`, généré à la création, montré en popup avant le premier tour, éditable depuis peu (corrigé suite à ta remarque) |
| First action (`firstInput`) | Première action prise automatiquement par le personnage au démarrage (ex. "Look around and reflect on my new situation") | ✅ `world.firstAction`, déclenche le vrai premier tour généré par IA après la popup background, éditable (même correctif) |
| Objective (`objective`) | Objectif montré au joueur dès le premier tour ; l'IA narrative en a connaissance en continu | ✅ `world.objective`, éditable, affiché en jeu et transmis à l'IA à chaque tour |

### 2.2 Main instructions

| Champ | Description | État Fogbound |
|---|---|---|
| Detail and instructions (`instructions`) | **Le champ le plus important** : contexte complet donné à l'IA — cadre, sujet du jeu, rôle du personnage joueur, instructions de narration. Convention : référer au perso joueur en "I" ("In this story I am trying to..."). Avertissement officiel : au-delà de quelques milliers de mots, le coût par tour augmente (mais certains mondes dépassent plusieurs milliers de mots sans problème) | ✅ `world.instructions`, généré à la création (même convention "I"), zone de texte libre longue, éditable |
| Extra instruction blocks | Blocs nommés (ex. "Know", "Int") ajoutés à la fin des instructions principales avant envoi à l'IA — utile pour l'organisation ou pour servir de cible aux *triggers* | ❌ absent |
| Author style (`authorStyle`) | Style d'écriture : "a bestselling novelist", un auteur précis ("Neil Gaiman"), ou un genre ("a writer of Children's books") | ✅ `world.authorStyle`, généré, éditable, transmis à l'IA à chaque tour |
| Design notes | Notes internes à l'auteur, sans effet sur le jeu — contient typiquement le prompt original tapé par l'utilisateur avant expansion par l'IA de génération de monde | ❌ absent — l'idée d'origine tapée par le joueur (`playerIdea`) n'est même pas conservée sur le monde une fois la génération faite |
| Mature content (`nsfw`) + Content warnings (`contentWarnings`) | Case à cocher "contenu mature (R)" déclenchant un avertissement au joueur, + liste libre de catégories de contenu sensible | ✅ `world.mature` + `world.contentWarnings`, éditables, avertissement affiché à la sélection du personnage |

### 2.3 Image style

| Champ | Description | État Fogbound |
|---|---|---|
| Image model (`imageModel`) | Modèle d'image actif (Flux.1, DreamShaper, ...) — bouton "Change image model" | ⚠️ choix de *provider* (Stability/Replicate/démo) dans Réglages, mais pas de modèle précis exposé, et pas par monde (réglage global) |
| Style details (`imageStyle`, `illustrationStyle*LowPriority/HighPriority`, `imageStyle*Pre/Post`) | Presets de style visuel, distincts pour "personnage" et "non-personnage" (décor), avec texte préfixe/suffixe ajouté automatiquement à chaque prompt d'image | ⚠️ `world.imageStyle` + `imageStylePrefix`/`imageStyleSuffix` généré et éditable, appliqué automatiquement à chaque `image_prompt` — mais **un seul style pour tout**, pas de distinction personnage vs décor |

Le guide JSON précise deux approches de prompt d'image bien distinctes
selon le modèle (voir §4).

### 2.4 Player character options — le cœur manquant

C'est la section la plus structurante et **la plus absente chez Fogbound**.

> *"Every time the player takes an action, the game system considers what
> skill would be needed to succeed (perhaps intelligence, or strength). The
> game then looks at the player character's skill levels to decide whether
> they succeed in the action, taking account of how hard the action would
> be."* — texte exact de l'écran Edit world

**Skills** (`skills`) : liste de 4 à 6 attributs définis par monde (pas
fixes globalement) — ex. fantasy: "Magic", "Combat" ; Jane Austen: "Wealth",
"Wit". Recommandation officielle : 4 à 6 skills.

État Fogbound : ✅ `world.skills` (string[]), généré à la création (4-6,
comme recommandé), utilisé pour la résolution de réussite/échec à chaque
tour. ⚠️ éditable seulement via la retouche IA (renommer/ajouter/retirer
un skill en langage naturel) — pas de petite liste éditable à la main.

**Characters** (`possibleCharacters`) : liste de personnages jouables
proposés au choix du joueur avant de commencer. Chacun a :
- `name`, `description` (influence réellement le gameplay : si la fiche
  mentionne une compétence en philatélie ou aux armes de siège, l'IA en
  tiendra compte) — ✅ équivalent chez Fogbound (`playableCharacters`),
  CRUD complet dans l'éditeur : ajout manuel, génération IA depuis une
  description, édition, suppression (aussi possible depuis l'écran de
  sélection lui-même) ;
- `portrait` (+ génération IA alternative / upload) — **uniquement affiché
  à l'écran de sélection, jamais montré en jeu** — ❌ absent chez Fogbound,
  aucune image par personnage ;
- `skills` : objet `{skillName: valeur numérique}`, avec un libellé
  qualitatif par palier observé dans la capture (2 = "Unskilled", 3 =
  "Competent", 4 = "Highly skilled", 5 = "Exceptional") — ✅ identique dans
  l'esprit (`character.skills`, 1-5, libellés qualitatifs affichés à la
  sélection) ;
- `initialTrackedItemValues` : valeurs de départ des objets suivis
  spécifiques à ce personnage (inventaire, relations, etc.) — ❌ absent,
  les objets suivis n'ont qu'une seule valeur initiale par monde, pas de
  variation par personnage.

**Customization settings** : au niveau monde, quels champs le joueur a le
droit de modifier une fois le personnage choisi (`allowChangeCharacterName`,
`...Description`, `...Skills`, `...ItemValues`, `...Portrait`,
`...NewPortrait` dans le JSON — via `permissionsOnceShared`).

État Fogbound : ❌ absent — aucun réglage de permission granulaire ; le
joueur peut éditer un personnage avant de le choisir (écran de sélection)
mais rien de comparable à "quels champs modifiables une fois en jeu".

Résolution de réussite/échec : ✅ implémentée (Phase A) — l'IA choisit le
skill pertinent, compare au niveau du personnage et à la difficulté
implicite de l'action, renvoie `outcome` (success/partial/failure/n/a),
caché au joueur par défaut (visible en mode auteur 🔍). Comme Infinite
Worlds, aucun générateur aléatoire (dés) : c'est le modèle de langage
lui-même qui juge narrativement, sans RNG serveur.

### 2.5 Items to track / Inventaire (`trackedItems`)

Fonctionnalité "optionnelle" (masquée derrière "Show optional features")
mais citée comme centrale pour tout ce qui dépasle les skills fixes :
inventaire, relations, préférences, jauges (faim, argent, réputation...).

Chaque *tracked item* a :
- **Data Type** (ex. Text, Number...) ;
- **Description** — à qui/quoi ça sert ;
- **Visibility** — visible au joueur seul, à l'IA seule, ou aux deux ;
- **Update Automatically** (oui/non) ;
- **Update Instructions** — texte libre très spécifique, ex. *"Update
  whenever I gain or lose an item. Only add an item if I have actually
  acquired it, not simply encountered it."*
- Limite : 10 000 caractères par tracked item (au-delà, troncature).

Le wiki avertit que l'IA n'est pas toujours fiable pour décider seule des
mises à jour — recommande de dupliquer le suivi dans le `secretInfo` (voir
2.6) pour plus de cohérence.

État Fogbound : ✅ implémenté (Phase C) — `trackedItemDefs` typés (text/
number), avec description, visibilité (`player_and_ai`/`ai_only`),
`updateAutomatically` et `updateInstructions` dédiées, exactement comme
décrit. `memoryFacts` existe en plus, en complément, pour des faits libres
non structurés (proche de l'esprit `secretInfo`/notes de personnage).
⚠️ **Mais aucune interface pour ajouter, éditer ou supprimer un tracked
item après la création du monde** — ils sont générés une fois (2-5 par
monde) puis figés ; seules leurs *valeurs* évoluent en jeu, pas leur
définition.

### 2.6 Secret info — état caché

`secretInfo` + `secretInfoInstructions` : un bloc de données **jamais
montré au joueur**, mis à jour chaque tour par l'IA elle-même pour garder
la cohérence sur des éléments que le joueur ne voit pas :
temps qui passe, sous-intrigues en arrière-plan, pensées/réactions
internes des PNJ, besoins vitaux, relations à long terme, particularités
de lieux, etc. Le guide donne des catégories types : `CharCurrent`,
`CharPersona`, `CharPhilosophy`, `CharMotive`, `CharAbility`, `CharQuirk`,
`CharRelation`, `CharBody`, `CharNeeds`, `LocationDetails`.

État Fogbound : ✅ implémenté (Phase E) — `save.secretInfo`, bloc cumulatif
mis à jour par l'IA chaque tour (`secret_info` dans la réponse), jamais
exposé au client par défaut, révélé seulement en mode auteur (🔍). Pas de
sous-catégories nommées comme `CharMotive`/`CharQuirk`/etc. — c'est un seul
bloc de texte libre plutôt qu'une structure par catégorie, mais le principe
(caché, cumulatif, réécrit en entier chaque tour) est le même.

### 2.7 NPCs (Other Characters)

Liste de personnages **non jouables** pré-écrits par l'auteur, que le
joueur peut rencontrer en jeu. Chaque NPC a : `name`, `detail` (fiche
complète), `one_liner` (résumé court utilisé quand le PNJ n'est pas apparu
récemment — cf. §1), `appearance`, `location` (lieu par défaut),
`secret_info` (motivations cachées), `names` (surnoms), et des champs
dédiés à l'image (`img_appearance`, `img_clothing`).

État Fogbound : ✅ implémenté (Phase E) — `worldNpcs` pré-écrits à la
création du monde (`name`, `role`, `detail`, `oneLiner`, `appearance`,
`location`), copiés dans chaque nouvelle sauvegarde (`saveCharacters`) et
mis à jour en jeu ensuite. La logique "vu récemment → fiche complète,
sinon → résumé" est bien implémentée (`buildTurnPrompt`, recherche du nom
dans les dernières scènes). ⚠️ Pas de champ `secret_info` par PNJ (le
secret est un seul bloc au niveau de la sauvegarde, pas par personnage), et
**aucune interface pour éditer/ajouter/supprimer un PNJ** après la
création — comme les tracked items, ils sont générés une fois puis figés
côté auteur (seul leur état évolue en jeu).

### 2.8 Trigger events / Keyword Instruction Blocks (KIBs)

Mécanisme avancé : après génération de l'issue principale du tour, le
système active les *triggers* pertinents selon la situation. Un trigger
peut **remplacer le texte d'un extra instruction block** (utile pour gérer
une transformation de personnage, un changement d'état majeur, une nouvelle
phase de jeu). Les "keyword instruction blocks" sont ajoutés en fin
d'instructions principales seulement quand certains mots-clés sont détectés
dans le contexte récent.

Chez Fogbound : absent. Le prompt est statique d'un tour à l'autre (à part
l'ajout de nouveaux faits).

### 2.9 Victory and defeat conditions

- **Victory** : case à cocher "Enable victory condition" + texte libre de
  la condition (ex. *"The player character has escaped the maze"*) + texte
  affiché au joueur quand la condition est remplie.
- **Defeat** : même structure, optionnelle.
- Avertissement du wiki : ces conditions "can be finicky, and are prone to
  misfires without careful wording" — donc à formuler prudemment côté
  prompt (l'IA évalue elle-même si la condition est remplie, tour après
  tour, vraisemblablement en incluant la condition dans le prompt système
  et en demandant un champ de sortie booléen).

État Fogbound : ✅ implémenté (Phase B) — `victoryCondition`/`victoryText`
et `defeatCondition`/`defeatText`, optionnels, jugés par l'IA à chaque tour
(`game_over` dans la réponse). Une défaite termine l'histoire pour de bon ;
une victoire peut être suivie ("continuer à jouer"). ⚠️ Éditables
seulement via la retouche IA, pas de champ texte direct dans l'éditeur.

### 2.10 Show optional features

Six sections avancées supplémentaires sont masquées par défaut derrière
cette case. D'après le wiki, elles "ne sont pas nécessaires pour produire
un monde agréable" mais permettent des systèmes complexes, plus de
conditions de victoire/défaite, et un contrôle plus direct sur les sorties
et le résumé. La capture fournie ne montre pas leur contenu détaillé (la
case n'était pas cochée) — à explorer si besoin plus tard, non prioritaire.

---

## 3. Boucle de jeu (résumé opérationnel)

```
Tour N :
  entrée  = instructions principales (+ extra instruction blocks actifs)
          + action du joueur
          + 2-8 derniers tours (verbatim)
          + résumé des tours antérieurs
          + fiches des personnages présents récemment (complètes)
          + résumé bref des personnages absents récemment
          + secretInfo courant
  sortie  = texte de narration (descriptionRequest guide le format)
          + mise à jour de secretInfo (secretInfoInstructions)
          + mise à jour des tracked items concernés (leurs update instructions)
          + évaluation victoire/défaite si activées
          + prompt(s) d'illustration (imagePromptDetails)
          + actions suggérées

  Après la sortie : activation des triggers pertinents (peuvent réécrire
  des extra instruction blocks pour le tour suivant).

  Tous les ~6 tours à partir du tour 8 : Summary AI condense l'historique
  et met à jour les notes de personnages.
```

---

## 4. Prompt engineering — patterns observés

### `descriptionRequest` (équivalent de notre `MASTER_PROMPT`)
Doit spécifier : point de vue narratif (généralement 1ère personne),
niveau de détail (dialogues, descriptions, environnement), comment les
mécaniques de jeu s'intègrent dans le texte, ton, éléments à éviter
(clichés), ordre de présentation des informations critiques, réflexion de
l'état du personnage (température, vêtements, santé), actions autonomes
des PNJ/environnement au-delà de la seule réaction à l'action du joueur,
dialogues naturels multi-personnages, mise en forme Markdown (italique,
gras, MAJUSCULES) pour l'emphase.

### `summaryRequest`
Doit spécifier explicitement quels états doivent être conservés en
priorité : intrigue significative, règles/mécaniques à documenter
méticuleusement, motivations et relations des personnages, éléments propres
au monde (actions autonomes, états environnementaux). Principe : se
concentrer sur ce qui pilote les mécaniques ou l'intrigue, pas les détails
mineurs.

### Prompts d'image — deux approches distinctes selon le modèle
- **Modèles type Flux** : langage naturel long, détaillé, évocateur. Ne
  pas être concis. `illustrAppearance`, `illustrClothes`,
  `illustrExpressionPosition`, `illustrSetting` doivent chacun être
  développés en prose riche.
- **Modèles non-Flux (ex. DreamShaper)** : inverse — descriptions par tags
  courts séparés par virgules (ex. "young woman, long black hair"),
  qualificatifs type "hyper-realistic, 8k". `imageStyle` doit être mis à
  `null` pour ces modèles.
- Règles universelles : `illustrIsCharacter=true` quand un personnage est
  le sujet ; ne jamais désigner un objet/décor comme sujet principal si un
  personnage est présent ; mettre à jour l'apparence/les vêtements dès
  qu'ils changent en jeu plutôt que de laisser le prompt devenir obsolète.

---

## 5. Écart actualisé Fogbound → Infinite Worlds — pour arbitrage

Repasse complète demandée en session (post Phases A-G + lots suivants) :
la synthèse ci-dessous d'origine était devenue fausse — presque tout ce
qu'elle listait "absent" est maintenant implémenté (détail champ par champ
en section 2, mis à jour). Cette liste-ci ne garde que ce qui **manque
réellement encore aujourd'hui**, ou n'est qu'**éditable indirectement**
(via retouche IA plutôt qu'un champ dédié), pour trancher ce qui vaut la
peine d'être ajouté.

**Restant non fait — délibérément mis de côté :**

| # | Fonctionnalité Infinite Worlds | Pourquoi mis de côté |
|---|---|---|
| 1 | Extra instruction blocks + Triggers/Keyword Instruction Blocks | Seul item resté "Élevé" en effort — un vrai sous-système à concevoir (détection de mots-clés en jeu, réécriture active de blocs d'instructions), pas un simple champ. Mis de côté volontairement en attendant un feu vert explicite dédié, plutôt que bâclé dans le même lot que le reste. |
| 2 | Distinction style d'image personnage vs décor | Secondaire une fois les portraits par personnage en place (ils utilisent déjà le style du monde) — writeup gardé si le besoin se fait sentir. |

**Fait (15/09, troisième lot — portraits, éditeurs post-création, valeurs
par personnage, champs directs) :** tout le reste de la liste "vrais
absents" et "éditable seulement via retouche IA" du lot précédent est
maintenant implémenté :

- **Portrait par personnage jouable** : généré automatiquement (IA + génération
  de personnage) quand les images sont activées, bouton "Régénérer le
  portrait" sinon/toujours, affiché à l'écran de sélection et dans
  l'éditeur — jamais montré en jeu (comme Infinite Worlds). Génération
  d'image désactivée dans Réglages → erreur claire au clic sur
  "régénérer", pas de plantage ; la génération automatique à la création
  d'un personnage est simplement sautée.
- **Éditeur de tracked items après création** (ajouter/éditer/supprimer) —
  supprimer un objet nettoie les valeurs de sauvegardes existantes ; en
  ajouter un nouveau ne casse rien pour les parties en cours (retombent
  sur la valeur par défaut tant qu'elles ne l'ont pas rencontré).
- **Éditeur de PNJ après création** (ajouter/éditer/supprimer) — les
  sauvegardes déjà commencées gardent leur propre copie, non affectée.
- **Valeurs initiales de tracked items par personnage** — un personnage
  peut démarrer avec une valeur différente (ex. plus de confiance, plus
  d'argent) ; appliqué au moment de choisir le personnage (pas à la
  création de la sauvegarde, puisque le personnage n'est pas encore
  connu à cet instant).
- **Design notes**, **texte additionnel à l'écran de sélection**, **modèle
  d'image par monde** (supporté pour Replicate ; Stability n'a pas de
  paramètre de modèle simple, son endpoint fixe reste utilisé tel quel).
- **Titre, skills, setting/tone/rules, conditions et textes de
  victoire/défaite** : champs dédiés dans le formulaire manuel, plus
  besoin de passer par la retouche IA pour ça.
- **Numéro de version affiché**, **bouton de régénération de l'image de
  couverture**.

**Déjà couvert, pour mémoire (pas d'action nécessaire) :** skills +
résolution de réussite/échec, sélection de personnage, tracked items
typés, conditions de victoire/défaite, instructions principales + style
d'auteur, PNJ enrichis + secretInfo, style d'image, objectif affiché,
contenu mature + avertissements, description + background + première
action, langue par monde.

---

## 6. Feuille de route d'implémentation proposée

**Phase A — Le cœur du jeu (skills + personnages + résolution)**
- Étendre le schéma de monde : `skills: string[]` (4-6, définis à la
  création), `characters: [{name, description, skills: {skill: 1-5}, portrait?}]`.
- Écran de sélection de personnage avant le premier tour.
- Enrichir `MASTER_PROMPT`/`buildTurnPrompt` pour transmettre les skills du
  personnage actif et demander explicitement à l'IA de juger succès/échec
  en fonction du skill pertinent et de la difficulté perçue de l'action
  (champ de sortie `outcome: "success"|"partial"|"failure"` par ex.).

**Phase B — Fin de partie**
- Champs `victoryCondition`/`defeatCondition` (texte libre, optionnels) au
  niveau monde.
- Demander à l'IA un champ `game_over: {result: "victory"|"defeat"|null, text}`
  à chaque tour, affiché et bloquant la suite si non-null.

**Phase C — Objets/état suivis**
- Remplacer/étendre `memoryFacts` par des `trackedItems` typés (nom,
  description, visibilité, instructions de mise à jour), mis à jour par
  l'IA comme aujourd'hui les `new_facts` mais de façon structurée par item.

**Phase D — Personnalisation des instructions**
- Champ `instructions` libre et éditable par monde (au lieu du seul
  `MASTER_PROMPT` fixe), + `authorStyle`. Générés par défaut à la création
  (comme aujourd'hui) mais éditables ensuite.

**Phase E — PNJ enrichis + secretInfo**
- `npcs: [{name, detail, oneLiner, appearance, location, secretInfo}]`
  pré-écrits, injectés dans le prompt selon apparition récente ou non.
- Bloc `secretInfo` cumulatif, non montré au joueur, mis à jour chaque tour.

**Phase F — Image style structuré**
- Champs de style d'image par monde (préfixe/suffixe, ton visuel), utilisés
  pour cadrer le `image_prompt` généré par le narrateur.

**Phase G — Confort auteur**
- Description/version/image de couverture de monde, objectif affiché,
  contenu mature + avertissements.

Chaque phase est livrable indépendamment et n'exige pas de réécrire les
phases précédentes.

---

## Sources

- [How AI Generates Dynamic Text Adventures in 'Infinite Worlds' Game — Decrypt](https://decrypt.co/217340/infinite-worlds-generative-ai-text-adventure-game)
- [How Infinite Worlds works — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/How_Infinite_Worlds_works)
- [World editing — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/World_editing)
- [Trigger events — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/Trigger_events)
- [Creating an Inventory — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/Creating_an_Inventory)
- [Illustration Instructions — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/Illustration_Instructions)
- [AI models — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/AI_models)
- [Frequently Asked Questions — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/Frequently_Asked_Questions)
- [sabreking/IWGameCreationGuide — schéma JSON complet (GitHub)](https://github.com/sabreking/IWGameCreationGuide)
- Capture d'écran fournie par l'utilisateur : `screencapture-infiniteworlds-app-2026-09-13-19_42_34.pdf` (écran "Edit world", 5 pages)
