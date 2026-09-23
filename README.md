# Trame

Application d'aventure textuelle en choix multiples, générée par IA à
chaque tour, avec une vraie mémoire structurée (pas juste un historique de
chat qui grossit à l'infini). Successeur de
[Fogbound](https://github.com/Aestoss/CYOA-App-aventure) — voir le doc de
conception « Fogbound V2 Architecture » pour le détail des choix (rôles
Writer/Retriever/Archivist/Proofreader/Mastermind, mémoire par récupération
plutôt que par troncature, plan de migration en 5 étapes). Inspirée
également d'[Infinite Worlds](https://infiniteworlds.app) (voir
`docs/INFINITE_WORLDS_REFERENCE.md`).

**Statut actuel : Milestone 4 (plan de migration complet : Writer,
Retriever, Archivist, Proofreader, Mastermind, y compris la détection de
contradiction complète du Proofreader) + mécanique d'ellipse temporelle +
mécanique de point de vue (POV).** Le Retriever tourne : les faits
pertinents pour un tour (pool général + faits par personnage) sont
sélectionnés par similarité (embeddings + sqlite-vec) plutôt que par un
plafond de récence. L'Archivist tourne en tâche de fond (hors du chemin
critique du joueur), et l'horloge narrative (`storyClock`) est lue et
alimentée à chaque tour. Le Proofreader vérifie deux choses sur chaque
chapitre — le rythme temporel contre `storyClock`, et toute contradiction
factuelle concrète contre les faits les plus pertinents de l'archive,
récupérés de façon omnisciente (au-delà du mur de connaissance `knownBy`,
puisqu'il s'agit d'une vérification narrateur, pas d'un personnage) — et
signale chaque contradiction trouvée en mode auteur uniquement. Le
Mastermind maintient un plan narratif caché (rythme périodique, jamais
montré au joueur ni à l'auteur) que le Writer peut mobiliser sans y être
obligé. En plus du plan de migration : une mécanique d'ellipse temporelle
(autonome ou déclenchée par le joueur via le bouton ⏩) avec sa propre
« frise chronologique » (`timelineEvents`), et une mécanique de changement
de point de vue (déclenchée uniquement par le joueur via le bouton 🎭 —
jamais autonome) qui raconte un tour à la troisième personne du point de
vue d'un personnage rencontré, sans jamais changer le personnage contrôlé
par le joueur, avec un mur de connaissance (`memoryFacts.knownBy`) qui
empêche un fait appris dans une scène POV de fuiter vers le héros — voir
CHANGELOG.md. Pas encore déployé.

## Fonctionnalités

- **Monde vs sauvegarde** : un monde est un modèle réutilisable (univers,
  personnages jouables, règles, style) ; chaque nouvelle aventure démarrée
  depuis un monde crée une sauvegarde indépendante (ses propres objets
  suivis, personnages rencontrés, état caché...).
- **Création de monde par IA** à partir d'une idée en une phrase, avec
  langue choisie à la création (figée sur ce monde ensuite) — génère
  personnages jouables, compétences, PNJ, objets suivis, conditions de
  victoire/défaite, style visuel, et un texte d'introduction ("background")
  montré au joueur au lancement de chaque nouvelle aventure.
- **Éditeur de monde** : tout ce que l'IA a généré est modifiable
  (instructions, style, personnages — ajout manuel, génération IA, édition,
  suppression), plus une retouche IA en langage naturel pour des ajustements
  légers.
- **Pagination par tour** (façon Infinite Worlds) : chaque tour est une
  page navigable, avec retour en arrière destructif ("reprendre à partir
  d'ici") et régénération d'un tour (action modifiée, ou note de recadrage
  pour l'IA en gardant l'action d'origine).
- **Compétences et résolution** : l'IA juge réussite/échec selon les
  compétences du personnage joué ; caché au joueur par défaut.
- **Mode auteur** (🔍) : révèle l'état caché (`secretInfo`, objets suivis
  IA-seule) et permet de parler directement au narrateur, hors-personnage.
- **Objets/état suivis** typés (inventaire, jauges de relation...),
  visibles par le joueur ou réservés à l'IA.
- **Mémoire structurée** : faits extraits par l'Archivist (async, hors du
  chemin critique du joueur) + résumé automatique des tours anciens. Les
  faits pertinents pour un tour (pool général et par personnage) sont
  sélectionnés par similarité (embeddings + sqlite-vec, voir
  `roles/retriever.js`) plutôt que par un plafond de récence.
- **Proofreader** (`roles/proofreader.js`) : vérifie chaque chapitre sur
  deux plans — le langage de rythme temporel contre `storyClock`, et toute
  contradiction factuelle concrète contre les faits les plus pertinents de
  l'archive (récupération omnisciente, au-delà du mur `knownBy` : c'est une
  vérification narrateur, pas celle d'un personnage). Chaque contradiction
  trouvée est signalée en mode auteur uniquement, jamais visible du joueur.
- **Mastermind** (`roles/mastermind.js`) : plan narratif caché (futurs
  développements, événements de fond), révisé sur un rythme périodique et
  mobilisable par le Writer sans y être obligé — jamais montré au joueur,
  et jamais réécrit rétroactivement sur ce qui a déjà été raconté.
- **Point de vue (POV)** : voir une scène à la troisième personne à travers
  les yeux d'un personnage rencontré (bouton 🎭, déclenché uniquement par le
  joueur) — un tour ponctuel, sans jamais changer le personnage contrôlé.
  Un mur de connaissance (`memoryFacts.knownBy`) garantit qu'un fait appris
  dans cette scène ne fuite pas vers le héros s'il n'y était pas.
- **Interface traduite** (français/anglais) suivant le réglage de langue,
  installable comme PWA sur téléphone.
- **Suivi des coûts** IA (jetons + estimation $) et fournisseurs
  interchangeables sans toucher au code : Anthropic, OpenAI, OpenRouter,
  Google Gemini, un Ollama local (PC personnel via tunnel), ou une démo
  locale sans clé pour tester sans rien payer. Images optionnelles via
  Stability AI, Replicate, ou un Stable Diffusion local (Forge/Chroma).

## Démarrer en local

```bash
npm install
npm start
```

Puis ouvre `http://localhost:3000`. Le fournisseur "Démo locale (sans
clé)" fonctionne immédiatement, sans configuration. Pour utiliser un vrai
modèle (Claude, GPT-4, Gemini...), va dans Réglages ⚙ une fois l'app
ouverte et colle ta clé API — elle est stockée côté serveur uniquement,
jamais dans le code.

Variables d'environnement optionnelles (voir `.env.example`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute du serveur |
| `DATA_DIR` | `./data` | Dossier de `trame.db` (base SQLite) et des images générées |

## Structure du projet

```
server.js                    → routes de l'API Express
lib/db.js                    → base de données (SQLite via better-sqlite3, voir son en-tête)
lib/schema.sql                → schéma des tables
lib/backup.js                 → sauvegardes glissantes de trame.db
lib/promptBuilder.js         → assemblage des prompts en couches envoyés à l'IA
lib/gameEngine.js            → logique de jeu : mondes, sauvegardes, tours, mémoire
lib/memoryFacts.js            → forme partagée des faits mémoire (gameEngine.js + roles/archivist.js)
lib/embedFact.js               → embed un fait à sa création (roles/archivist.js + maybeSummarize)
lib/embeddingConfig.js         → dimension des vecteurs d'embedding, source unique (db.js + embeddingProviders.js)
lib/pricing.js               → tarifs approximatifs $/1M tokens par fournisseur
lib/costTracker.js           → enregistrement et agrégation des coûts d'appels IA
providers/textProviders.js   → Anthropic / OpenAI / OpenRouter / Gemini / Ollama / démo
providers/imageProviders.js  → Stability / Replicate / Stable Diffusion local / démo
providers/embeddingProviders.js → mock (hashing local, sans clé) / Gemini (text-embedding-004)
roles/                        → Writer, Archivist, Retriever, Proofreader, Mastermind
                                 (les 5 rôles du plan de migration, tous actifs)
public/                      → interface (HTML/CSS/JS), installable en PWA
scripts/windows/              → pont PC local (Ollama/Forge/Chroma, tunnel Tailscale)
docs/INFINITE_WORLDS_REFERENCE.md → analyse de référence ayant guidé la conception
CHANGELOG.md                 → historique de ce qui a été livré
```

Pas de framework frontend (JS vanilla). Base de données SQLite via
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — un seul
fichier, pas de service externe à gérer, mêmes garanties d'atomicité que ce
que Fogbound a dû ajouter à la main après un incident de corruption réel
(voir l'en-tête de `lib/db.js` pour le détail). La recherche par similarité
du Retriever passe par [sqlite-vec](https://github.com/asg017/sqlite-vec),
une extension SQLite — toujours un seul fichier, aucune base vectorielle
séparée à faire tourner.

## Déploiement

Pas encore déployé. Fogbound tournait sur Railway avec un volume persistant
monté sur `/data` (`DATA_DIR=/data`) — même approche prévue ici une fois ce
premier jalon terminé.
