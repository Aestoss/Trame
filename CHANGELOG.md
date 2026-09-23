# Changelog

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
