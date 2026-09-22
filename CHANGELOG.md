# Changelog

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
