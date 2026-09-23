const API = '/api';

const views = {
  home: document.getElementById('view-home'),
  characterSelect: document.getElementById('view-character-select'),
  story: document.getElementById('view-story'),
  worldEdit: document.getElementById('view-world-edit'),
  settings: document.getElementById('view-settings')
};

// ---------- i18n: the app's own interface (menus, buttons, labels) ----------
// Distinct from a world's own `language` (baked in at creation, used for
// AI-generated story text) — this is settings.language driving the chrome
// around it. See t()/applyUiLanguage() below.
let currentLang = 'fr';

const UI = {
  fr: {
    settingsBtn: 'Réglages',
    tabCreate: 'Créer un monde', tabWorlds: 'Mes mondes', tabSaves: 'Mes sauvegardes',
    createPanelTitle: 'Nouveau monde',
    createPanelHint: 'Décris une idée en une phrase — lieu, ambiance, ou personnage.',
    ideaInputPlaceholder: 'Un détective steampunk dans une ville de brouillard...',
    worldLanguageLabel: "Langue de l'histoire",
    createWorldBtn: 'Créer le monde',
    worldsTabHint: 'Un monde propose toujours une nouvelle aventure depuis le début.',
    noSavesHint: "Pas encore de sauvegarde — commence une aventure depuis un monde.",
    backgroundModalTitle: 'Avant de commencer...',
    backgroundModalCloseBtn: "Commencer l'aventure",
    preparingFirstChapter: 'Préparation du premier chapitre...',
    firstTurnError: "Le premier chapitre n'a pas pu être généré — nouvelle tentative...",
    backToStories: '‹ Mes histoires',
    backGeneric: '‹ Retour',
    authorModeBtn: 'Mode auteur (révéler les informations cachées)',
    editWorldBtn: 'Modifier le monde',
    timeSkipBtn: 'Passer du temps',
    purgeImagesBtn: 'Purger les images de cette partie',
    purgeImagesConfirm: 'Supprimer toutes les images déjà générées dans cette partie ? Le texte des tours est conservé, seules les images sont effacées.',
    purgeImagesStatus: 'Images supprimées.',
    prevPageBtn: 'Tour précédent',
    prevTurnLabel: 'Précédent',
    nextPageBtn: 'Tour suivant',
    nextTurnLabel: 'Suivant',
    turnIndicator: (n, total) => `Tour ${n} / ${total}`,
    resumeFromPageBtn: "⏪ Reprendre à partir d'ici",
    resumeFromPageHint: 'Tout ce qui vient après cette page sera perdu.',
    rewindConfirm: 'Reprendre à partir de cette page ? Tout ce qui vient après sera définitivement perdu.',
    regenerateActionLabel: 'Action',
    regenerateNoteLabel: 'Note pour le narrateur',
    regenerateNoteHint: '(optionnel — "je veux qu\'il se passe plutôt...")',
    regenerateConfirmBtn: 'Régénérer',
    regenerateBtn: 'Régénérer ce tour',
    regenerateLabel: 'Régénérer',
    regeneratePastWarning: n => `⚠️ Régénérer ce tour supprimera aussi les ${n} tour${n > 1 ? 's' : ''} suivant${n > 1 ? 's' : ''}.`,
    regeneratePastConfirm: 'Régénérer ce tour supprimera définitivement tous les tours suivants. Continuer ?',
    timeSkipHintLabel: 'Vers quoi veux-tu avancer ?',
    timeSkipHintHint: '(optionnel — "jusqu\'à mon arrivée à la capitale", "jusqu\'à ce que je sois guéri"...)',
    timeSkipConfirmBtn: '⏩ Passer du temps',
    timeSkipThinking: 'Le temps passe...',
    timeSkipEcho: hint => hint ? `⏩ Passage du temps : ${hint}` : '⏩ Passage du temps',
    timeSkipBadge: elapsed => `⏩ ${elapsed} passé`,
    cancelBtn: 'Annuler',
    saveBtn: 'Enregistrer',
    sendBtn: 'Envoyer',
    actionSegmentLabel: 'Ton action',
    instructionSegmentLabel: 'Instruction au narrateur (optionnel)',
    actionInputPlaceholder: 'Que fais-tu ?',
    instructionPlaceholder: 'Ce que tu veux qu\'il se passe...',
    narratorThinking: 'Le narrateur réfléchit...',
    narratorApplyingInstruction: "Le narrateur applique l'instruction...",
    illegibleResponse: n => `Réponse du serveur illisible (HTTP ${n}).`,
    retryHint: ' — réessaie.',
    regenFailedHint: ' — la régénération a peut-être échoué, réessaie.',
    errorPrefix: 'Erreur : ',
    gameOverVictoryLabel: 'Victoire',
    gameOverEndLabel: "Fin de l'histoire",
    continuePlayingBtn: 'Continuer à jouer',
    cannotContinue: 'Impossible de continuer : ',
    outcomeSuccess: '✅ Réussite', outcomePartial: '⚠️ Réussite partielle', outcomeFailure: '❌ Échec',
    storyCharacterPrefix: name => `Tu joues ${name}`,
    chooseCharacterTitle: title => `Choisis ton personnage — ${title}`,
    matureWarningPrefix: warnings => `⚠️ Contenu mature${warnings ? ' : ' + warnings : ''}`,
    chooseCharacterBtn: name => `Choisir ${name}`,
    editCharacterBtn: '✏️ Modifier',
    skillNotRated: 'Non noté',
    skillLabels: { 1: 'Débutant', 2: 'Novice', 3: 'Compétent', 4: 'Très compétent', 5: 'Exceptionnel' },
    cannotChooseCharacter: 'Impossible de choisir ce personnage : ',
    cannotStartAdventure: 'Impossible de démarrer une aventure : ',
    cannotCreateWorld: 'Impossible de créer le monde : ',
    turnCount: n => `${n} tour${n > 1 ? 's' : ''}`,
    saveCountSuffix: n => ` · ${n} sauvegarde${n > 1 ? 's' : ''}`,
    notStartedYet: 'Pas encore commencé',
    gameOverVictorySub: '🏆 Terminé (victoire)', gameOverDefeatSub: '💀 Terminé (défaite)',
    deleteSaveConfirm: title => `Supprimer cette sauvegarde de "${title}" ? Cette action est irréversible.`,
    deleteWorldConfirm: title => `Supprimer le monde "${title}" et toutes ses sauvegardes ? Cette action est irréversible.`,
    creationInProgress: 'Génération du monde en cours...',
    worldEditInfoHeading: 'Informations',
    worldLanguageInfo: name => `Langue de ce monde : ${name} (fixée à la création)`,
    worldVersionInfo: v => `Version : ${v}`,
    worldTitleLabel: 'Titre',
    regenerateCoverBtn: "🖼️ Régénérer l'image de couverture",
    regeneratingCoverStatus: 'Génération en cours...',
    coverRegeneratedStatus: 'Image régénérée.',
    editCoverPromptBtn: '🔍 Voir / modifier le prompt de la couverture',
    editPortraitPromptBtn: '🔍 Voir / modifier le prompt du portrait',
    imagePromptLabel: 'Détails envoyés à l\'IA pour générer cette image',
    generatePreviewBtn: '✨ Générer un aperçu',
    previewGeneratingStatus: "Génération de l'aperçu...",
    validateImageBtn: '✅ Valider cette image',
    discardPreviewBtn: 'Rejeter cet aperçu',
    imageValidatedStatus: 'Image mise à jour.',
    worldDescriptionLabel: 'Description', worldDescriptionHint: '(affichée dans la liste des mondes, sans effet sur le jeu)',
    worldObjectiveLabel: 'Objectif', worldObjectiveHint: '(affiché au joueur dès le premier tour, optionnel)',
    worldBackgroundLabel: 'Background', worldBackgroundHint: '(texte montré au joueur en popup avant le premier chapitre, identique à chaque nouvelle aventure — vide = pas de popup, ancien chapitre d\'ouverture statique à la place)',
    worldFirstActionLabel: 'Première action', worldFirstActionHint: '(action fixe qui déclenche le premier chapitre généré par IA, après la popup background)',
    worldMatureLabel: 'Contenu mature (R)',
    worldContentWarningsLabel: 'Avertissements de contenu', worldContentWarningsHint: '(séparés par des virgules)',
    worldContentWarningsPlaceholder: 'violence, horreur...',
    worldCharacterSelectTextLabel: 'Texte à la sélection du personnage', worldCharacterSelectTextHint: '(optionnel, affiché en plus de l\'avertissement contenu mature)',
    worldImageModelLabel: "Modèle d'image", worldImageModelHint: "(optionnel — remplace le modèle par défaut du fournisseur ; pour l'IA locale, choisissez dans la liste détectée ou tapez le nom exact du fichier checkpoint)",
    worldImageModelPlaceholder: 'ex : NoobAI-XL-v1.1.safetensors',
    imageModelCategoryIllustration: 'Illustration', imageModelCategoryPhotorealistic: 'Photoréaliste', imageModelCategoryMature: 'Mature / non censuré', imageModelCategoryOther: 'Autre',
    worldDesignNotesLabel: "Notes de conception", worldDesignNotesHint: "(usage personnel, jamais envoyé à l'IA, sans effet sur le jeu — l'idée d'origine par défaut)",
    worldInstructionsLabel: 'Instructions principales',
    worldAuthorStyleLabel: "Style d'auteur", worldAuthorStyleHint: '(ex : "Neil Gaiman", "un romancier de thriller")',
    worldImageStyleLabel: 'Style visuel', worldImageStyleHint: '(description générale, ex : "aquarelle sombre, palette froide")',
    worldImageStylePrefixLabel: "Préfixe d'image", worldImageStylePrefixHint: "(ajouté avant chaque prompt d'image)",
    worldImageStyleSuffixLabel: "Suffixe d'image", worldImageStyleSuffixHint: "(ajouté après chaque prompt d'image)",
    worldSettingLabel: 'Setting', worldSettingHint: '(lieu, époque, ambiance)',
    worldToneLabel: 'Ton', worldToneHint: '(ex : "noir tendu", "fantaisie légère")',
    worldRulesLabel: 'Règles du monde', worldRulesHint: '(une par ligne)',
    savedStatus: 'Enregistré.',
    worldSkillsHeading: 'Compétences',
    worldSkillsHint: "Utilisées par l'IA pour juger la réussite ou l'échec des actions (4 à 6 recommandées). Renommer ou supprimer une compétence ne met pas à jour les personnages déjà créés.",
    addSkillBtn: '+ Ajouter une compétence',
    regeneratePortraitBtn: '🖼️ Régénérer le portrait',
    startingItemValuesHint: "Valeurs de départ spécifiques à ce personnage — laisser vide pour utiliser la valeur par défaut de l'objet.",
    trackedItemsHeading: 'Objets suivis',
    trackedItemsHint: "Inventaire, jauges, réputation... Ajouter un nouvel objet n'affecte pas les parties en cours (elles gardent la valeur par défaut tant qu'elles ne l'ont pas rencontré).",
    addTrackedItemBtn: '+ Ajouter un objet suivi',
    newTrackedItemDefaultName: 'Nouvel objet',
    trackedItemNamePlaceholder: 'Nom (ex : Inventaire)',
    trackedItemDescPlaceholder: 'À quoi ça sert et pourquoi',
    dataTypeText: 'Texte', dataTypeNumber: 'Nombre',
    visibilityPlayerAndAi: 'Joueur + IA', visibilityAiOnly: 'IA seule (caché)',
    updateAutomaticallyLabel: 'Mise à jour auto',
    updateInstructionsPlaceholder: 'Instructions de mise à jour (si mise à jour auto)',
    initialValuePlaceholder: 'Valeur initiale',
    npcsHeading: 'Personnages non-joueurs (PNJ)',
    npcsHint: "Pré-écrits par toi, rencontrés en jeu. Éditer ou supprimer un PNJ ici n'affecte pas les parties déjà en cours (chacune garde sa propre copie).",
    addNpcBtn: '+ Ajouter un PNJ',
    newNpcDefaultName: 'Nouveau PNJ',
    npcNamePlaceholder: 'Nom',
    npcRolePlaceholder: 'Rôle',
    npcDetailPlaceholder: 'Fiche complète (personnalité, motivations...)',
    npcOneLinerPlaceholder: "Résumé court (utilisé quand le PNJ n'est pas apparu récemment)",
    npcAppearancePlaceholder: 'Apparence physique',
    npcLocationPlaceholder: 'Lieu habituel',
    victoryDefeatHeading: 'Fin de partie',
    worldVictoryConditionLabel: 'Condition de victoire', worldConditionHint: '(vide = désactivée)',
    worldVictoryTextLabel: 'Texte affiché en cas de victoire',
    worldDefeatConditionLabel: 'Condition de défaite',
    worldDefeatTextLabel: 'Texte affiché en cas de défaite',
    worldAiEditHeading: 'Retouche IA',
    worldAiEditHint: "Décris un changement en langage naturel — l'IA ajuste le monde en conséquence (léger, pas une régénération complète).",
    worldAiEditPlaceholder: 'Rends le ton plus sombre, ajoute un rival...',
    worldAiEditBtn: "✨ Retoucher avec l'IA",
    retouchingStatus: 'Retouche en cours...',
    worldRetouchedStatus: 'Monde retouché.',
    playableCharactersHeading: 'Personnages jouables',
    addCharacterBtn: '+ Ajouter un personnage',
    addCharacterDefaultName: 'Nouveau personnage',
    aiCharacterDescPlaceholder: 'Décris le personnage à générer...',
    generateCharacterBtn: '✨ Générer avec l\'IA',
    generatingStatus: 'Génération en cours...',
    charGeneratedStatus: name => `${name} généré.`,
    errorSavingCharacter: "Erreur lors de l'enregistrement.",
    characterSavedStatus: 'Personnage enregistré.',
    deleteCharacterBtn: 'Supprimer',
    deleteCharacterConfirm: name => `Supprimer ${name} ?`,
    startAdventureBtn: '▶ Commencer une aventure',
    deleteWorldBtn: '🗑️ Supprimer ce monde',
    settingsHeading: 'Réglages',
    settingsTextHeading: 'Texte',
    responseLanguageLabel: 'Langue des réponses',
    chapterLengthLabelText: 'Longueur des chapitres',
    chapterLengthWords: n => `~${n} mots`,
    providerLabel: 'Fournisseur',
    providerMock: 'Démo locale (sans clé)',
    providerOpenrouter: 'OpenRouter (plusieurs modèles)',
    providerOllama: 'Ollama (modèle local)',
    modelPresetLabel: 'Modèle préréglé', modelPresetCustom: '(manuel — voir le champ ci-dessous)',
    modelLabel: 'Modèle', modelHint: '(optionnel, sinon valeur par défaut)',
    keyAnthropicLabel: 'Clé API Anthropic', keyOpenaiLabel: 'Clé API OpenAI', keyOpenrouterLabel: 'Clé API OpenRouter',
    keyGeminiLabel: 'Clé API Gemini', keyGeminiHint: '(gratuite pour tester)',
    ollamaBaseUrlLabel: 'Adresse du serveur Ollama', ollamaBaseUrlHint: '(local uniquement — pas accessible si Trame tourne sur Railway, sauf via un tunnel)',
    keyOllamaLabel: 'Clé API Ollama', keyOllamaHint: '(généralement inutile en local)',
    ollamaStatusOffline: 'Ollama : hors ligne', ollamaStatusBusy: 'Ollama : indisponible (GPU sollicité)', ollamaStatusAvailable: 'Ollama : disponible',
    ollamaRefreshBtn: '🔄 Actualiser',
    fallbackProviderLabel: 'Fournisseur de secours', fallbackProviderHint: '(utilisé ponctuellement si Ollama est hors ligne ou indisponible)',
    fallbackProviderNone: '(aucun)',
    fallbackModelLabel: 'Modèle de secours',
    fallbackConfirmOfflineMsg: 'Ollama semble hors ligne (PC éteint ou pont non démarré).',
    fallbackConfirmBusyMsg: 'Le GPU de votre PC est très sollicité — la génération via Ollama risque d\'être lente.',
    fallbackConfirmUseBtn: 'Utiliser {provider} pour ce tour',
    fallbackConfirmWaitBtn: 'Essayer quand même avec Ollama',
    settingsImagesHeading: 'Images', imagesEnabledLabel: "Génération d'images",
    keyStabilityLabel: 'Clé API Stability', keyReplicateLabel: 'Clé API Replicate',
    providerLocalSd: 'IA locale (Stable Diffusion)',
    localImageBaseUrlLabel: 'Adresse du serveur Stable Diffusion', localImageBaseUrlHint: '(Forge lancé avec --api ; même principe que pour Ollama — voir plus haut. Chroma est proposé automatiquement dans la liste des modèles ci-dessous, pas besoin d\'une adresse séparée)',
    keyLocalSdLabel: 'Clé API IA locale (images)', keyLocalSdHint: '(généralement inutile en local)',
    imageModelPresetLabel: 'Modèle d\'image détecté', imageModelPresetHint: '(checkpoints trouvés sur Forge, plus Chroma toujours proposé à part — utilisé par défaut pour toutes les images)',
    localsdRefreshBtn: '🔄 Actualiser',
    imageModelLabel: 'Modèle d\'image', imageModelHint: '(optionnel, sinon le checkpoint déjà chargé sur Forge)',
    keyAlreadySaved: '•••••••• (déjà enregistrée)',
    costsHeading: '💰 Coûts',
    costsHint: "Estimation approximative — les tarifs des fournisseurs changent, et OpenRouter n'a pas de tarif fixe (jetons seulement).",
    costCallsLabel: 'Appels IA', costInputLabel: 'Jetons entrée', costOutputLabel: 'Jetons sortie', costEstimateLabel: 'Coût estimé',
    costUnknown: '(inconnu)',
    costUnknownHint: "Certains appels (ex. OpenRouter) n'ont pas de tarif connu et ne sont pas inclus dans l'estimation."
  },
  en: {
    settingsBtn: 'Settings',
    tabCreate: 'Create a world', tabWorlds: 'My worlds', tabSaves: 'My saves',
    createPanelTitle: 'New world',
    createPanelHint: 'Describe an idea in a sentence — a place, a mood, or a character.',
    ideaInputPlaceholder: 'A steampunk detective in a fog-bound city...',
    worldLanguageLabel: 'Story language',
    createWorldBtn: 'Create the world',
    worldsTabHint: 'A world always offers a brand new adventure from the start.',
    noSavesHint: "No saves yet — start an adventure from one of your worlds.",
    backgroundModalTitle: 'Before you begin...',
    backgroundModalCloseBtn: 'Begin the adventure',
    preparingFirstChapter: 'Preparing the first chapter...',
    firstTurnError: 'The first chapter could not be generated — retrying...',
    backToStories: '‹ My stories',
    backGeneric: '‹ Back',
    authorModeBtn: 'Author mode (reveal hidden information)',
    editWorldBtn: 'Edit the world',
    timeSkipBtn: 'Skip ahead in time',
    purgeImagesBtn: 'Purge this save\'s images',
    purgeImagesConfirm: 'Delete every image already generated in this save? Turn text is kept — only images are cleared.',
    purgeImagesStatus: 'Images deleted.',
    prevPageBtn: 'Previous turn',
    prevTurnLabel: 'Previous',
    nextPageBtn: 'Next turn',
    nextTurnLabel: 'Next',
    turnIndicator: (n, total) => `Turn ${n} / ${total}`,
    resumeFromPageBtn: '⏪ Resume from here',
    resumeFromPageHint: 'Everything after this page will be lost.',
    rewindConfirm: 'Resume from this page? Everything after it will be permanently lost.',
    regenerateActionLabel: 'Action',
    regenerateNoteLabel: 'Note for the narrator',
    regenerateNoteHint: '(optional — "I want this to happen instead...")',
    regenerateConfirmBtn: 'Regenerate',
    regenerateBtn: 'Regenerate this turn',
    regenerateLabel: 'Regenerate',
    regeneratePastWarning: n => `⚠️ Regenerating this turn will also delete the ${n} turn${n > 1 ? 's' : ''} after it.`,
    regeneratePastConfirm: 'Regenerating this turn will permanently delete every turn after it. Continue?',
    timeSkipHintLabel: 'What should the skip lead to?',
    timeSkipHintHint: '(optional — "until I reach the capital", "until I\'m healed"...)',
    timeSkipConfirmBtn: '⏩ Skip ahead',
    timeSkipThinking: 'Time passes...',
    timeSkipEcho: hint => hint ? `⏩ Time skip: ${hint}` : '⏩ Time skip',
    timeSkipBadge: elapsed => `⏩ ${elapsed} passed`,
    cancelBtn: 'Cancel',
    saveBtn: 'Save',
    sendBtn: 'Send',
    actionSegmentLabel: 'Your action',
    instructionSegmentLabel: 'Instruction to the narrator (optional)',
    actionInputPlaceholder: 'What do you do?',
    instructionPlaceholder: 'What you want to happen...',
    narratorThinking: 'The narrator is thinking...',
    narratorApplyingInstruction: 'The narrator is applying the instruction...',
    illegibleResponse: n => `Unreadable server response (HTTP ${n}).`,
    retryHint: ' — try again.',
    regenFailedHint: ' — the regeneration may have failed, try again.',
    errorPrefix: 'Error: ',
    gameOverVictoryLabel: 'Victory',
    gameOverEndLabel: 'The story ends',
    continuePlayingBtn: 'Keep playing',
    cannotContinue: 'Could not continue: ',
    outcomeSuccess: '✅ Success', outcomePartial: '⚠️ Partial success', outcomeFailure: '❌ Failure',
    storyCharacterPrefix: name => `You are playing ${name}`,
    chooseCharacterTitle: title => `Choose your character — ${title}`,
    matureWarningPrefix: warnings => `⚠️ Mature content${warnings ? ': ' + warnings : ''}`,
    chooseCharacterBtn: name => `Choose ${name}`,
    editCharacterBtn: '✏️ Edit',
    skillNotRated: 'Unrated',
    skillLabels: { 1: 'Untrained', 2: 'Unskilled', 3: 'Competent', 4: 'Highly skilled', 5: 'Exceptional' },
    cannotChooseCharacter: 'Could not choose this character: ',
    cannotStartAdventure: 'Could not start an adventure: ',
    cannotCreateWorld: 'Could not create the world: ',
    turnCount: n => `${n} turn${n > 1 ? 's' : ''}`,
    saveCountSuffix: n => ` · ${n} save${n > 1 ? 's' : ''}`,
    notStartedYet: 'Not started yet',
    gameOverVictorySub: '🏆 Finished (victory)', gameOverDefeatSub: '💀 Finished (defeat)',
    deleteSaveConfirm: title => `Delete this save of "${title}"? This cannot be undone.`,
    deleteWorldConfirm: title => `Delete the world "${title}" and all its saves? This cannot be undone.`,
    creationInProgress: 'Generating the world...',
    worldEditInfoHeading: 'Information',
    worldLanguageInfo: name => `This world's language: ${name} (fixed at creation)`,
    worldVersionInfo: v => `Version: ${v}`,
    worldTitleLabel: 'Title',
    regenerateCoverBtn: '🖼️ Regenerate cover image',
    regeneratingCoverStatus: 'Generating...',
    coverRegeneratedStatus: 'Image regenerated.',
    editCoverPromptBtn: '🔍 View / edit cover prompt',
    editPortraitPromptBtn: '🔍 View / edit portrait prompt',
    imagePromptLabel: 'Details sent to the AI to generate this image',
    generatePreviewBtn: '✨ Generate a preview',
    previewGeneratingStatus: 'Generating preview...',
    validateImageBtn: '✅ Keep this image',
    discardPreviewBtn: 'Discard this preview',
    imageValidatedStatus: 'Image updated.',
    worldDescriptionLabel: 'Description', worldDescriptionHint: "(shown in the world list, doesn't affect gameplay)",
    worldObjectiveLabel: 'Objective', worldObjectiveHint: '(shown to the player from the first turn, optional)',
    worldBackgroundLabel: 'Background', worldBackgroundHint: '(text shown to the player in a popup before the first chapter, same every new adventure — empty = no popup, falls back to the old static opening chapter)',
    worldFirstActionLabel: 'First action', worldFirstActionHint: '(fixed action that triggers the AI-generated first chapter, after the background popup)',
    worldMatureLabel: 'Mature content (R)',
    worldContentWarningsLabel: 'Content warnings', worldContentWarningsHint: '(comma-separated)',
    worldContentWarningsPlaceholder: 'violence, horror...',
    worldCharacterSelectTextLabel: 'Text at character selection', worldCharacterSelectTextHint: '(optional, shown alongside the mature-content warning)',
    worldImageModelLabel: 'Image model', worldImageModelHint: "(optional — overrides the provider's default model; for local AI, pick from the detected list or type the exact checkpoint filename)",
    worldImageModelPlaceholder: 'e.g. NoobAI-XL-v1.1.safetensors',
    imageModelCategoryIllustration: 'Illustration', imageModelCategoryPhotorealistic: 'Photorealistic', imageModelCategoryMature: 'Mature / uncensored', imageModelCategoryOther: 'Other',
    worldDesignNotesLabel: 'Design notes', worldDesignNotesHint: "(personal use, never sent to the AI, no effect on gameplay — defaults to the original idea)",
    worldInstructionsLabel: 'Main instructions',
    worldAuthorStyleLabel: 'Author style', worldAuthorStyleHint: '(e.g. "Neil Gaiman", "a thriller novelist")',
    worldImageStyleLabel: 'Visual style', worldImageStyleHint: '(general description, e.g. "dark watercolor, cool palette")',
    worldImageStylePrefixLabel: 'Image prefix', worldImageStylePrefixHint: '(added before every image prompt)',
    worldImageStyleSuffixLabel: 'Image suffix', worldImageStyleSuffixHint: '(added after every image prompt)',
    worldSettingLabel: 'Setting', worldSettingHint: '(place, era, atmosphere)',
    worldToneLabel: 'Tone', worldToneHint: '(e.g. "tense noir", "whimsical fantasy")',
    worldRulesLabel: 'World rules', worldRulesHint: '(one per line)',
    savedStatus: 'Saved.',
    worldSkillsHeading: 'Skills',
    worldSkillsHint: "Used by the AI to judge whether actions succeed or fail (4-6 recommended). Renaming or removing a skill doesn't update characters already created.",
    addSkillBtn: '+ Add a skill',
    regeneratePortraitBtn: '🖼️ Regenerate portrait',
    startingItemValuesHint: "Starting values specific to this character — leave blank to use the item's default value.",
    trackedItemsHeading: 'Tracked items',
    trackedItemsHint: "Inventory, gauges, reputation... Adding a new item doesn't affect saves already in progress (they keep the default value until they encounter it).",
    addTrackedItemBtn: '+ Add a tracked item',
    newTrackedItemDefaultName: 'New item',
    trackedItemNamePlaceholder: 'Name (e.g. Inventory)',
    trackedItemDescPlaceholder: "What it's for and why it matters",
    dataTypeText: 'Text', dataTypeNumber: 'Number',
    visibilityPlayerAndAi: 'Player + AI', visibilityAiOnly: 'AI only (hidden)',
    updateAutomaticallyLabel: 'Update automatically',
    updateInstructionsPlaceholder: 'Update instructions (if updated automatically)',
    initialValuePlaceholder: 'Initial value',
    npcsHeading: 'Non-player characters (NPCs)',
    npcsHint: "Pre-written by you, encountered in play. Editing or deleting an NPC here doesn't affect saves already in progress (each keeps its own copy).",
    addNpcBtn: '+ Add an NPC',
    newNpcDefaultName: 'New NPC',
    npcNamePlaceholder: 'Name',
    npcRolePlaceholder: 'Role',
    npcDetailPlaceholder: 'Full sheet (personality, motivations...)',
    npcOneLinerPlaceholder: "Short reminder (used when this NPC hasn't appeared recently)",
    npcAppearancePlaceholder: 'Physical appearance',
    npcLocationPlaceholder: 'Usual location',
    victoryDefeatHeading: 'Ending the story',
    worldVictoryConditionLabel: 'Victory condition', worldConditionHint: '(empty = disabled)',
    worldVictoryTextLabel: 'Text shown on victory',
    worldDefeatConditionLabel: 'Defeat condition',
    worldDefeatTextLabel: 'Text shown on defeat',
    worldAiEditHeading: 'AI retouch',
    worldAiEditHint: 'Describe a change in plain language — the AI adjusts the world accordingly (light touch, not a full regeneration).',
    worldAiEditPlaceholder: 'Make the tone darker, add a rival...',
    worldAiEditBtn: '✨ Retouch with AI',
    retouchingStatus: 'Retouching...',
    worldRetouchedStatus: 'World retouched.',
    playableCharactersHeading: 'Playable characters',
    addCharacterBtn: '+ Add a character',
    addCharacterDefaultName: 'New character',
    aiCharacterDescPlaceholder: 'Describe the character to generate...',
    generateCharacterBtn: '✨ Generate with AI',
    generatingStatus: 'Generating...',
    charGeneratedStatus: name => `${name} generated.`,
    errorSavingCharacter: 'Error while saving.',
    characterSavedStatus: 'Character saved.',
    deleteCharacterBtn: 'Delete',
    deleteCharacterConfirm: name => `Delete ${name}?`,
    startAdventureBtn: '▶ Start an adventure',
    deleteWorldBtn: '🗑️ Delete this world',
    settingsHeading: 'Settings',
    settingsTextHeading: 'Text',
    responseLanguageLabel: 'Response language',
    chapterLengthLabelText: 'Chapter length',
    chapterLengthWords: n => `~${n} words`,
    providerLabel: 'Provider',
    providerMock: 'Local demo (no key)',
    providerOpenrouter: 'OpenRouter (multiple models)',
    providerOllama: 'Ollama (local model)',
    modelPresetLabel: 'Preset model', modelPresetCustom: '(manual — see field below)',
    modelLabel: 'Model', modelHint: '(optional, otherwise the default)',
    keyAnthropicLabel: 'Anthropic API key', keyOpenaiLabel: 'OpenAI API key', keyOpenrouterLabel: 'OpenRouter API key',
    keyGeminiLabel: 'Gemini API key', keyGeminiHint: '(free to try)',
    ollamaBaseUrlLabel: 'Ollama server address', ollamaBaseUrlHint: "(local only — unreachable if Trame runs on Railway, unless tunneled)",
    keyOllamaLabel: 'Ollama API key', keyOllamaHint: '(usually unnecessary locally)',
    ollamaStatusOffline: 'Ollama: offline', ollamaStatusBusy: 'Ollama: unavailable (GPU busy)', ollamaStatusAvailable: 'Ollama: available',
    ollamaRefreshBtn: '🔄 Refresh',
    fallbackProviderLabel: 'Fallback provider', fallbackProviderHint: '(used one-off if Ollama is offline or unavailable)',
    fallbackProviderNone: '(none)',
    fallbackModelLabel: 'Fallback model',
    fallbackConfirmOfflineMsg: 'Ollama appears to be offline (PC off, or the bridge isn\'t running).',
    fallbackConfirmBusyMsg: 'Your PC\'s GPU is under heavy load — generating via Ollama may be slow.',
    fallbackConfirmUseBtn: 'Use {provider} for this turn',
    fallbackConfirmWaitBtn: 'Try with Ollama anyway',
    settingsImagesHeading: 'Images', imagesEnabledLabel: 'Image generation',
    keyStabilityLabel: 'Stability API key', keyReplicateLabel: 'Replicate API key',
    providerLocalSd: 'Local AI (Stable Diffusion)',
    localImageBaseUrlLabel: 'Stable Diffusion server address', localImageBaseUrlHint: '(Forge run with --api; same idea as Ollama above. Chroma is offered automatically in the model list below, no separate address needed)',
    keyLocalSdLabel: 'Local AI (images) API key', keyLocalSdHint: '(usually unnecessary locally)',
    imageModelPresetLabel: 'Detected image model', imageModelPresetHint: '(checkpoints found on Forge, plus Chroma always offered separately — used by default for every image)',
    localsdRefreshBtn: '🔄 Refresh',
    imageModelLabel: 'Image model', imageModelHint: '(optional, otherwise whatever checkpoint Forge already has loaded)',
    keyAlreadySaved: '•••••••• (already saved)',
    costsHeading: '💰 Costs',
    costsHint: "Rough estimate — provider pricing changes, and OpenRouter has no fixed rate (tokens only).",
    costCallsLabel: 'AI calls', costInputLabel: 'Input tokens', costOutputLabel: 'Output tokens', costEstimateLabel: 'Estimated cost',
    costUnknown: '(unknown)',
    costUnknownHint: "Some calls (e.g. OpenRouter) have no known price and aren't included in the estimate."
  }
};

function t(key) {
  const val = (UI[currentLang] && UI[currentLang][key] !== undefined) ? UI[currentLang][key] : UI.fr[key];
  return val;
}

function applyUiLanguage() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = t(el.dataset.i18n);
    if (typeof val === 'string') el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const val = t(el.dataset.i18nTitle);
    el.title = val;
    el.setAttribute('aria-label', val);
  });
}

let currentSaveId = null;   // active save while in the story / character-select views
let currentWorldId = null;  // active world while in the world-editor view
let currentWorldSkills = []; // world.skills, needed to render character skill inputs
let currentSave = null;     // last-fetched save object (gameOver, activeCharacterId, secretInfo if debug)
let currentTurns = [];      // all turns of the open save, oldest first — one "page" each
let currentPageIndex = 0;   // which turn is currently displayed
let currentTimelineEvents = []; // past time skips (see gameEngine.js's timelineEvents), keyed by turnNumber for the badge in renderPage
let debugModeOn = false;    // "mode auteur": reveals hidden info (secret info box, outcome badges) -- talking
                             // to the narrator is a separate, always-visible field (#instructionInput below)
let previousView = 'home';
let currentHomeTab = 'create'; // which home tab is active: 'create' | 'worlds' | 'saves'
let pendingFirstAction = null; // world.firstAction while a background-popup first turn is being prefetched
let firstTurnPromise = null;   // in-flight promise for that prefetch, so the popup close button can await it

// Auto-growing textareas (action box, regenerate popover, author-instruction
// popover): grow in height as content is typed instead of scrolling
// horizontally like a single-line <input> did, which made re-reading a long
// message while typing it very hard. Capped via CSS max-height so a very
// long message scrolls internally instead of taking over the screen.
const MAX_TEXTAREA_HEIGHT = 160; // px, matches .action-form/.regenerate-popover textarea max-height in style.css

function resizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT) + 'px';
}

// submitOnEnter, if given, is called when Enter is pressed without Shift
// (Shift+Enter still inserts a newline) -- the same convention used by
// Claude's own chat input.
function autoGrowTextarea(el, submitOnEnter) {
  el.addEventListener('input', () => resizeTextarea(el));
  if (submitOnEnter) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitOnEnter();
      }
    });
  }
  resizeTextarea(el);
}

function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

// Called whenever a new turn/chapter has just been generated, so the player
// starts reading it from the top instead of wherever the scroll happened to be.
function scrollStoryToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Home ----------

const HOME_TABS = ['create', 'worlds', 'saves'];

function showHomeTab(name) {
  currentHomeTab = name;
  HOME_TABS.forEach(tab => {
    document.getElementById(`homeTab${tab[0].toUpperCase()}${tab.slice(1)}`).classList.toggle('hidden', tab !== name);
    document.getElementById(`homeTabBtn${tab[0].toUpperCase()}${tab.slice(1)}`).classList.toggle('active', tab === name);
  });
}
HOME_TABS.forEach(tab => {
  document.getElementById(`homeTabBtn${tab[0].toUpperCase()}${tab.slice(1)}`).onclick = () => showHomeTab(tab);
});

async function loadHome() {
  const [saves, worlds] = await Promise.all([
    fetch(`${API}/saves`).then(r => r.json()),
    fetch(`${API}/worlds`).then(r => r.json())
  ]);
  renderSaveList(saves);
  renderWorldList(worlds);
  // Land returning players on their saves, new users on the create tab.
  showHomeTab(saves.length ? 'saves' : 'create');
  const langSelect = document.getElementById('worldLanguageSelect');
  if (langSelect && !langSelect.dataset.touched) langSelect.value = currentLang;
}

function renderSaveList(saves) {
  const list = document.getElementById('saveList');
  const emptyHint = document.getElementById('noSavesHint');
  list.innerHTML = '';
  emptyHint.classList.toggle('hidden', Boolean(saves.length));
  saves.slice().reverse().forEach(s => {
    const card = document.createElement('div');
    card.className = 'save-card';
    const cover = s.coverImageUrl ? `<img class="world-card-cover" src="${s.coverImageUrl}" alt="">` : '';
    const sub = s.gameOver
      ? (s.gameOver.result === 'victory' ? t('gameOverVictorySub') : t('gameOverDefeatSub'))
      : (s.lastAction && s.lastAction !== '(story begins)' ? `→ ${escapeHtml(s.lastAction)}` : t('notStartedYet'));
    card.innerHTML = `
      ${cover}
      <span class="world-card-body">
        <span class="world-card-title">${escapeHtml(s.worldTitle)}</span>
        <span class="world-card-desc">${sub}</span>
        <small>${t('turnCount')(s.turnCount)}</small>
      </span>
      <button class="icon-btn danger-text save-delete-btn" title="${t('deleteCharacterBtn')}">🗑️</button>
    `;
    card.querySelector('.world-card-body').onclick = () => openSave(s.id);
    card.querySelector('.save-delete-btn').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(t('deleteSaveConfirm')(s.worldTitle))) return;
      await fetch(`${API}/saves/${s.id}`, { method: 'DELETE' });
      loadHome();
    };
    list.appendChild(card);
  });
}

function renderWorldList(worlds) {
  const list = document.getElementById('worldList');
  list.innerHTML = '';
  worlds.slice().reverse().forEach(w => {
    const card = document.createElement('div');
    card.className = 'world-card';
    const cover = w.coverImageUrl ? `<img class="world-card-cover" src="${w.coverImageUrl}" alt="">` : '';
    const desc = w.description ? `<span class="world-card-desc">${escapeHtml(w.description)}</span>` : '';
    card.innerHTML = `
      ${cover}
      <span class="world-card-body">
        <span class="world-card-title">${escapeHtml(w.title)}</span>
        ${desc}
        <small>${escapeHtml(w.tone || '')}${w.saveCount ? t('saveCountSuffix')(w.saveCount) : ''}</small>
      </span>
      <span class="world-card-actions">
        <button class="icon-btn" title="${t('startAdventureBtn')}">▶</button>
        <button class="icon-btn" title="${t('editWorldBtn')}">✏️</button>
        <button class="icon-btn danger-text" title="${t('deleteCharacterBtn')}">🗑️</button>
      </span>
    `;
    const [playBtn, editBtn, delBtn] = card.querySelectorAll('button');
    playBtn.onclick = () => startNewAdventure(w.id);
    editBtn.onclick = () => openWorldEditor(w.id);
    delBtn.onclick = async () => {
      if (!confirm(t('deleteWorldConfirm')(w.title))) return;
      await fetch(`${API}/worlds/${w.id}`, { method: 'DELETE' });
      loadHome();
    };
    list.appendChild(card);
  });
}

// ---------- Create world ----------

// A world's JSON (title, description, rules, skills, playable characters,
// tracked items, NPCs...) runs a fairly stable size across ideas/providers —
// this is a rough approximation used only to turn "chars received so far"
// into a percentage, capped below 100% (see updateCreationProgress) so a
// more verbose-than-usual response never looks stuck or overshoots.
const ESTIMATED_WORLD_JSON_CHARS = 6000;

function startCreationProgress() {
  document.getElementById('creationProgress').classList.remove('hidden');
  updateCreationProgress(0);
}

function updateCreationProgress(chars) {
  const fill = document.querySelector('#creationProgress .progress-bar-fill');
  const percent = Math.min(95, Math.round((chars / ESTIMATED_WORLD_JSON_CHARS) * 100));
  fill.style.width = `${percent}%`;
  document.getElementById('creationProgressText').textContent = `${t('creationInProgress')} ${percent}%`;
}

function finishCreationProgress() {
  document.querySelector('#creationProgress .progress-bar-fill').style.width = '100%';
  document.getElementById('creationProgressText').textContent = `${t('creationInProgress')} 100%`;
}

function stopCreationProgress() {
  document.getElementById('creationProgress').classList.add('hidden');
  document.querySelector('#creationProgress .progress-bar-fill').style.width = '0%';
}

document.getElementById('worldLanguageSelect').onchange = (e) => {
  e.target.dataset.touched = '1'; // stop loadHome() from overwriting a deliberate choice
};

document.getElementById('createWorldBtn').onclick = async () => {
  const idea = document.getElementById('ideaInput').value.trim();
  if (!idea) return;
  const language = document.getElementById('worldLanguageSelect').value;
  const btn = document.getElementById('createWorldBtn');
  btn.disabled = true;
  startCreationProgress();
  try {
    // Streamed (see POST /api/worlds/stream and createWorld's onChunk) so
    // this progress bar reflects real generation progress -- chars actually
    // received from the model -- instead of a fixed-duration animation with
    // no relationship to what the server is actually doing.
    const res = await fetch(`${API}/worlds/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea, language })
    });
    if (!res.ok || !res.body) throw new Error(t('illegibleResponse')(res.status));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneEvent = null;
    let errorMessage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch (e) { continue; }
        if (event.type === 'progress') {
          updateCreationProgress(event.chars);
        } else if (event.type === 'done') {
          doneEvent = event;
        } else if (event.type === 'error') {
          errorMessage = event.message;
        }
      }
    }

    if (errorMessage) throw new Error(errorMessage);
    if (!doneEvent) throw new Error(t('illegibleResponse')(res.status));
    finishCreationProgress();
    document.getElementById('ideaInput').value = '';
    await openWorldEditor(doneEvent.world.id);
  } catch (e) {
    alert(t('cannotCreateWorld') + e.message);
  } finally {
    btn.disabled = false;
    stopCreationProgress();
  }
};

// ---------- World editor ----------

let currentWorldTrackedItems = []; // full (unfiltered) list, needed for per-character starting-value inputs

async function openWorldEditor(worldId) {
  const [data, trackedItems, npcs] = await Promise.all([
    fetch(`${API}/worlds/${worldId}`).then(r => r.json()),
    fetch(`${API}/worlds/${worldId}/tracked-items`).then(r => r.json()),
    fetch(`${API}/worlds/${worldId}/npcs`).then(r => r.json())
  ]);
  currentWorldTrackedItems = trackedItems;
  populateWorldEditor(data.world, data.playableCharacters);
  renderTrackedItemsEditor(trackedItems);
  renderNpcEditor(npcs);
  showView('worldEdit');
}

const LANGUAGE_NAMES = { fr: 'Français', en: 'English' };

function renderSkillsEditor(skills) {
  const list = document.getElementById('worldSkillsList');
  list.innerHTML = '';
  (skills || []).forEach(addSkillRow);
}

function addSkillRow(value) {
  const list = document.getElementById('worldSkillsList');
  const row = document.createElement('div');
  row.className = 'skill-edit-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value || '';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn danger-text skill-remove-btn';
  removeBtn.textContent = '✕';
  removeBtn.onclick = () => row.remove();
  row.appendChild(input);
  row.appendChild(removeBtn);
  list.appendChild(row);
}

function readSkillsEditor() {
  return [...document.querySelectorAll('#worldSkillsList .skill-edit-row input')]
    .map(input => input.value.trim())
    .filter(Boolean);
}

document.getElementById('addSkillBtn').onclick = () => addSkillRow('');

function renderWorldCover(world) {
  const wrap = document.getElementById('worldCoverWrap');
  const img = document.getElementById('worldCoverImg');
  if (world.coverImageUrl) {
    img.src = world.coverImageUrl;
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}

// Mirrors gameEngine.js's defaultCoverPromptText() -- only used to pre-fill
// the editable textarea before the author has ever set an override; the
// server is always the actual source of truth for what gets sent to the
// image provider (see previewWorldCover/generateCoverImage there).
function defaultCoverPromptText(world) {
  return `Cover art for "${world.title}": ${world.setting}`;
}

let coverPreviewImageUrl = null;

function resetCoverPromptPanel(world) {
  document.getElementById('coverPromptPanel').classList.add('hidden');
  document.getElementById('coverPromptInput').value = world.coverImagePromptOverride || defaultCoverPromptText(world);
  document.getElementById('coverPromptPreviewWrap').classList.add('hidden');
  document.getElementById('coverPromptValidateActions').classList.add('hidden');
  document.getElementById('coverPromptStatus').textContent = '';
  coverPreviewImageUrl = null;
}

document.getElementById('worldCoverImg').onclick = () => {
  document.getElementById('coverPromptPanel').classList.toggle('hidden');
};
document.getElementById('toggleCoverPromptBtn').onclick = () => {
  document.getElementById('coverPromptPanel').classList.toggle('hidden');
};

document.getElementById('coverPromptPreviewBtn').onclick = async () => {
  const btn = document.getElementById('coverPromptPreviewBtn');
  const status = document.getElementById('coverPromptStatus');
  const prompt = document.getElementById('coverPromptInput').value.trim();
  btn.disabled = true;
  status.textContent = t('previewGeneratingStatus');
  try {
    const res = await fetch(`${API}/worlds/${currentWorldId}/cover/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    coverPreviewImageUrl = data.imageUrl;
    document.getElementById('coverPromptPreviewImg').src = data.imageUrl;
    document.getElementById('coverPromptPreviewWrap').classList.remove('hidden');
    document.getElementById('coverPromptValidateActions').classList.remove('hidden');
    status.textContent = '';
  } catch (e) {
    status.textContent = t('errorPrefix') + e.message;
  } finally {
    btn.disabled = false;
  }
};

document.getElementById('coverPromptAcceptBtn').onclick = async () => {
  if (!coverPreviewImageUrl) return;
  const status = document.getElementById('coverPromptStatus');
  const prompt = document.getElementById('coverPromptInput').value.trim();
  try {
    const res = await fetch(`${API}/worlds/${currentWorldId}/cover/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageUrl: coverPreviewImageUrl, prompt })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderWorldCover(data.world);
    document.getElementById('worldVersionInfo').textContent = t('worldVersionInfo')(data.world.version);
    resetCoverPromptPanel(data.world);
    status.textContent = t('imageValidatedStatus');
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (e) {
    status.textContent = t('errorPrefix') + e.message;
  }
};

document.getElementById('coverPromptDiscardBtn').onclick = () => {
  coverPreviewImageUrl = null;
  document.getElementById('coverPromptPreviewWrap').classList.add('hidden');
  document.getElementById('coverPromptValidateActions').classList.add('hidden');
  document.getElementById('coverPromptStatus').textContent = '';
};

function populateWorldEditor(world, playableCharacters) {
  currentWorldId = world.id;
  currentWorldSkills = world.skills || [];
  document.getElementById('worldEditTitle').textContent = world.title;
  document.getElementById('worldLanguageInfo').textContent = t('worldLanguageInfo')(LANGUAGE_NAMES[world.language] || LANGUAGE_NAMES.fr);
  document.getElementById('worldVersionInfo').textContent = t('worldVersionInfo')(world.version);
  document.getElementById('worldTitleInput').value = world.title || '';
  renderWorldCover(world);
  document.getElementById('coverStatus').textContent = '';
  resetCoverPromptPanel(world);
  document.getElementById('worldDescriptionInput').value = world.description || '';
  document.getElementById('worldObjectiveInput').value = world.objective || '';
  document.getElementById('worldBackgroundInput').value = world.background || '';
  document.getElementById('worldFirstActionInput').value = world.firstAction || '';
  document.getElementById('worldMatureInput').checked = Boolean(world.mature);
  document.getElementById('worldContentWarningsInput').value = (world.contentWarnings || []).join(', ');
  document.getElementById('worldCharacterSelectTextInput').value = world.characterSelectText || '';
  document.getElementById('worldImageModelInput').value = world.imageModel || '';
  document.getElementById('worldImageModelPreset').value = '';
  refreshLocalSdModels();
  document.getElementById('worldDesignNotesInput').value = world.designNotes || '';
  document.getElementById('worldSettingInput').value = world.setting || '';
  document.getElementById('worldToneInput').value = world.tone || '';
  document.getElementById('worldRulesInput').value = (world.rules || []).join('\n');
  document.getElementById('worldInstructionsInput').value = world.instructions || '';
  document.getElementById('worldAuthorStyleInput').value = world.authorStyle || '';
  document.getElementById('worldImageStyleInput').value = world.imageStyle || '';
  document.getElementById('worldImageStylePrefixInput').value = world.imageStylePrefix || '';
  document.getElementById('worldImageStyleSuffixInput').value = world.imageStyleSuffix || '';
  renderSkillsEditor(world.skills || []);
  document.getElementById('worldVictoryConditionInput').value = world.victoryCondition || '';
  document.getElementById('worldVictoryTextInput').value = world.victoryText || '';
  document.getElementById('worldDefeatConditionInput').value = world.defeatCondition || '';
  document.getElementById('worldDefeatTextInput').value = world.defeatText || '';
  document.getElementById('worldAiEditInput').value = '';
  document.getElementById('worldAiEditStatus').textContent = '';
  renderCharacterEditList(playableCharacters || []);
}

document.getElementById('regenerateCoverBtn').onclick = async () => {
  const btn = document.getElementById('regenerateCoverBtn');
  const status = document.getElementById('coverStatus');
  btn.disabled = true;
  status.textContent = t('regeneratingCoverStatus');
  try {
    const res = await fetch(`${API}/worlds/${currentWorldId}/regenerate-cover`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderWorldCover(data.world);
    document.getElementById('worldVersionInfo').textContent = t('worldVersionInfo')(data.world.version);
    resetCoverPromptPanel(data.world);
    status.textContent = t('coverRegeneratedStatus');
  } catch (e) {
    status.textContent = t('errorPrefix') + e.message;
  } finally {
    btn.disabled = false;
    setTimeout(() => { status.textContent = ''; }, 2500);
  }
};

document.getElementById('closeWorldEditBtn').onclick = () => {
  showView(currentSaveId ? 'story' : 'home');
  if (!currentSaveId) loadHome();
};

document.getElementById('saveWorldEditBtn').onclick = async () => {
  const body = {
    title: document.getElementById('worldTitleInput').value.trim() || undefined,
    description: document.getElementById('worldDescriptionInput').value,
    objective: document.getElementById('worldObjectiveInput').value || null,
    background: document.getElementById('worldBackgroundInput').value,
    firstAction: document.getElementById('worldFirstActionInput').value || null,
    mature: document.getElementById('worldMatureInput').checked,
    contentWarnings: document.getElementById('worldContentWarningsInput').value.split(',').map(s => s.trim()).filter(Boolean),
    characterSelectText: document.getElementById('worldCharacterSelectTextInput').value || null,
    imageModel: document.getElementById('worldImageModelInput').value || null,
    designNotes: document.getElementById('worldDesignNotesInput').value,
    setting: document.getElementById('worldSettingInput').value,
    tone: document.getElementById('worldToneInput').value,
    rules: document.getElementById('worldRulesInput').value.split('\n').map(s => s.trim()).filter(Boolean),
    instructions: document.getElementById('worldInstructionsInput').value,
    authorStyle: document.getElementById('worldAuthorStyleInput').value,
    imageStyle: document.getElementById('worldImageStyleInput').value,
    imageStylePrefix: document.getElementById('worldImageStylePrefixInput').value,
    imageStyleSuffix: document.getElementById('worldImageStyleSuffixInput').value,
    skills: readSkillsEditor(),
    victoryCondition: document.getElementById('worldVictoryConditionInput').value || null,
    victoryText: document.getElementById('worldVictoryTextInput').value || null,
    defeatCondition: document.getElementById('worldDefeatConditionInput').value || null,
    defeatText: document.getElementById('worldDefeatTextInput').value || null
  };
  const res = await fetch(`${API}/worlds/${currentWorldId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const status = document.getElementById('worldEditStatus');
  if (!res.ok) {
    status.textContent = t('errorPrefix') + data.error;
    return;
  }
  currentWorldSkills = data.world.skills || [];
  document.getElementById('worldEditTitle').textContent = data.world.title;
  document.getElementById('worldVersionInfo').textContent = t('worldVersionInfo')(data.world.version);
  status.textContent = t('savedStatus');
  setTimeout(() => { status.textContent = ''; }, 2000);
};

document.getElementById('worldAiEditBtn').onclick = async () => {
  const instruction = document.getElementById('worldAiEditInput').value.trim();
  if (!instruction) return;
  const btn = document.getElementById('worldAiEditBtn');
  const status = document.getElementById('worldAiEditStatus');
  btn.disabled = true;
  status.textContent = t('retouchingStatus');
  try {
    const res = await fetch(`${API}/worlds/${currentWorldId}/ai-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await openWorldEditor(currentWorldId);
    document.getElementById('worldAiEditStatus').textContent = t('worldRetouchedStatus');
    setTimeout(() => { document.getElementById('worldAiEditStatus').textContent = ''; }, 2500);
  } catch (e) {
    status.textContent = t('errorPrefix') + e.message;
  } finally {
    btn.disabled = false;
  }
};

document.getElementById('startAdventureBtn').onclick = async () => {
  const res = await fetch(`${API}/worlds/${currentWorldId}/saves`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return alert(t('cannotStartAdventure') + data.error);
  const worldData = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
  showCharacterSelect(worldData.world, worldData.playableCharacters, data.save.id);
};

document.getElementById('deleteWorldBtn').onclick = async () => {
  const title = document.getElementById('worldEditTitle').textContent;
  if (!confirm(t('deleteWorldConfirm')(title))) return;
  await fetch(`${API}/worlds/${currentWorldId}`, { method: 'DELETE' });
  currentWorldId = null;
  showView('home');
  loadHome();
};

// ---------- Character editing (in the world editor) ----------

function skillInputsHtml(skills, idPrefix) {
  return currentWorldSkills.map(skill => `
    <label class="skill-input-label">${escapeHtml(skill)}
      <input type="number" min="1" max="5" id="${idPrefix}-skill-${escapeHtml(skill)}" value="${(skills && skills[skill]) || 3}">
    </label>
  `).join('');
}

function readSkillInputs(idPrefix) {
  const skills = {};
  currentWorldSkills.forEach(skill => {
    const input = document.getElementById(`${idPrefix}-skill-${skill}`);
    skills[skill] = input ? Number(input.value) || 1 : 3;
  });
  return skills;
}

// One input per tracked item, prefilled with this character's override if it
// has one — left blank (placeholder shows the item's normal default) means
// "start like everyone else". Mirrors skillInputsHtml/readSkillInputs.
function itemValueInputsHtml(character, idPrefix) {
  if (!currentWorldTrackedItems.length) return '';
  const overrides = character.initialTrackedItemValues || {};
  return currentWorldTrackedItems.map(item => `
    <label class="skill-input-label">${escapeHtml(item.name)}
      <input type="text" id="${idPrefix}-item-${escapeHtml(item.name)}" value="${escapeHtml(overrides[item.name] !== undefined ? String(overrides[item.name]) : '')}" placeholder="${escapeHtml(String(item.initialValue))}">
    </label>
  `).join('');
}

function readItemValueInputs(idPrefix) {
  const values = {};
  currentWorldTrackedItems.forEach(item => {
    const input = document.getElementById(`${idPrefix}-item-${item.name}`);
    if (input && input.value.trim() !== '') {
      values[item.name] = item.dataType === 'number' ? Number(input.value) : input.value;
    }
  });
  return values;
}

// Mirrors gameEngine.js's defaultPortraitPromptText() -- see the matching
// comment on defaultCoverPromptText() above.
function defaultPortraitPromptText(character) {
  return `Portrait of ${character.name}: ${character.description}`;
}

function renderCharacterPortrait(card, character, worldId) {
  const img = card.querySelector('.character-portrait-img');
  if (character.portraitUrl) {
    img.src = character.portraitUrl;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }
  const btn = card.querySelector('.regen-portrait-btn');
  const status = card.querySelector('.portrait-status');
  btn.onclick = async () => {
    btn.disabled = true;
    status.textContent = t('regeneratingCoverStatus');
    try {
      const res = await fetch(`${API}/worlds/${worldId}/characters/${character.id}/regenerate-portrait`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      character.portraitUrl = data.character.portraitUrl;
      img.src = data.character.portraitUrl || '';
      img.classList.toggle('hidden', !data.character.portraitUrl);
      status.textContent = t('coverRegeneratedStatus');
    } catch (e) {
      status.textContent = t('errorPrefix') + e.message;
    } finally {
      btn.disabled = false;
      setTimeout(() => { status.textContent = ''; }, 2500);
    }
  };

  // "Open the portrait" flow: view/edit the prompt, generate a preview,
  // only replace the real portrait once explicitly validated. Mirrors the
  // world cover's own flow (see toggleCoverPromptBtn and friends above).
  const panel = card.querySelector('.portrait-prompt-panel');
  const promptInput = card.querySelector('.portrait-prompt-input');
  const previewWrap = card.querySelector('.portrait-prompt-preview-wrap');
  const previewImg = card.querySelector('.portrait-prompt-preview-img');
  const validateActions = card.querySelector('.portrait-prompt-validate-actions');
  const promptStatus = card.querySelector('.portrait-prompt-status');
  let portraitPreviewImageUrl = null;

  promptInput.value = character.portraitPromptOverride || defaultPortraitPromptText(character);
  const togglePanel = () => panel.classList.toggle('hidden');
  img.onclick = togglePanel;
  card.querySelector('.toggle-portrait-prompt-btn').onclick = togglePanel;

  card.querySelector('.portrait-prompt-preview-btn').onclick = async () => {
    const previewBtn = card.querySelector('.portrait-prompt-preview-btn');
    previewBtn.disabled = true;
    promptStatus.textContent = t('previewGeneratingStatus');
    try {
      const res = await fetch(`${API}/worlds/${worldId}/characters/${character.id}/portrait/preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: promptInput.value.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      portraitPreviewImageUrl = data.imageUrl;
      previewImg.src = data.imageUrl;
      previewWrap.classList.remove('hidden');
      validateActions.classList.remove('hidden');
      promptStatus.textContent = '';
    } catch (e) {
      promptStatus.textContent = t('errorPrefix') + e.message;
    } finally {
      previewBtn.disabled = false;
    }
  };

  card.querySelector('.portrait-prompt-accept-btn').onclick = async () => {
    if (!portraitPreviewImageUrl) return;
    try {
      const res = await fetch(`${API}/worlds/${worldId}/characters/${character.id}/portrait/accept`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageUrl: portraitPreviewImageUrl, prompt: promptInput.value.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      character.portraitUrl = data.character.portraitUrl;
      character.portraitPromptOverride = data.character.portraitPromptOverride;
      img.src = data.character.portraitUrl || '';
      img.classList.toggle('hidden', !data.character.portraitUrl);
      previewWrap.classList.add('hidden');
      validateActions.classList.add('hidden');
      portraitPreviewImageUrl = null;
      promptStatus.textContent = t('imageValidatedStatus');
      setTimeout(() => { promptStatus.textContent = ''; }, 2500);
    } catch (e) {
      promptStatus.textContent = t('errorPrefix') + e.message;
    }
  };

  card.querySelector('.portrait-prompt-discard-btn').onclick = () => {
    portraitPreviewImageUrl = null;
    previewWrap.classList.add('hidden');
    validateActions.classList.add('hidden');
    promptStatus.textContent = '';
  };
}

function renderCharacterEditList(characters) {
  const list = document.getElementById('editCharacterList');
  list.innerHTML = '';
  characters.forEach(c => {
    const idPrefix = `char-${c.id}`;
    const card = document.createElement('div');
    card.className = 'character-edit-card';
    card.innerHTML = `
      <div class="portrait-row">
        <img class="character-portrait-img hidden" alt="">
        <button type="button" class="text-btn regen-portrait-btn">${t('regeneratePortraitBtn')}</button>
        <button type="button" class="text-btn toggle-portrait-prompt-btn">${t('editPortraitPromptBtn')}</button>
      </div>
      <p class="hint portrait-status"></p>
      <div class="portrait-prompt-panel image-prompt-panel hidden">
        <label><span>${t('imagePromptLabel')}</span>
          <textarea class="portrait-prompt-input" rows="2"></textarea>
        </label>
        <div class="image-actions-row">
          <button type="button" class="text-btn portrait-prompt-preview-btn">${t('generatePreviewBtn')}</button>
        </div>
        <div class="story-image hidden portrait-prompt-preview-wrap"><img class="portrait-prompt-preview-img" alt=""></div>
        <div class="image-actions-row hidden portrait-prompt-validate-actions">
          <button type="button" class="primary-btn portrait-prompt-accept-btn">${t('validateImageBtn')}</button>
          <button type="button" class="text-btn portrait-prompt-discard-btn">${t('discardPreviewBtn')}</button>
        </div>
        <p class="hint portrait-prompt-status"></p>
      </div>
      <input type="text" id="${idPrefix}-name" value="${escapeHtml(c.name)}">
      <textarea id="${idPrefix}-desc" rows="2">${escapeHtml(c.description || '')}</textarea>
      <div class="skill-inputs">${skillInputsHtml(c.skills, idPrefix)}</div>
      ${currentWorldTrackedItems.length ? `<p class="hint-inline">${t('startingItemValuesHint')}</p><div class="skill-inputs">${itemValueInputsHtml(c, idPrefix)}</div>` : ''}
      <div class="character-edit-actions">
        <button class="text-btn char-save-btn">${t('saveBtn')}</button>
        <button class="text-btn danger-text char-delete-btn">${t('deleteCharacterBtn')}</button>
      </div>
    `;
    renderCharacterPortrait(card, c, currentWorldId);
    card.querySelector('.char-save-btn').onclick = async () => {
      const body = {
        name: document.getElementById(`${idPrefix}-name`).value,
        description: document.getElementById(`${idPrefix}-desc`).value,
        skills: readSkillInputs(idPrefix),
        initialTrackedItemValues: readItemValueInputs(idPrefix)
      };
      const res = await fetch(`${API}/worlds/${currentWorldId}/characters/${c.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      const status = document.getElementById('characterEditStatus');
      status.textContent = res.ok ? t('characterSavedStatus') : t('errorSavingCharacter');
      setTimeout(() => { status.textContent = ''; }, 2000);
    };
    card.querySelector('.char-delete-btn').onclick = async () => {
      if (!confirm(t('deleteCharacterConfirm')(c.name))) return;
      await fetch(`${API}/worlds/${currentWorldId}/characters/${c.id}`, { method: 'DELETE' });
      card.remove();
    };
    list.appendChild(card);
  });
}

// ---------- Tracked items editor (in the world editor) ----------

function renderTrackedItemsEditor(items) {
  const list = document.getElementById('trackedItemsEditList');
  list.innerHTML = '';
  items.forEach(item => {
    const idPrefix = `ti-${item.id}`;
    const card = document.createElement('div');
    card.className = 'tracked-item-edit-card';
    card.innerHTML = `
      <input type="text" id="${idPrefix}-name" value="${escapeHtml(item.name)}" placeholder="${t('trackedItemNamePlaceholder')}">
      <textarea id="${idPrefix}-desc" rows="2" placeholder="${t('trackedItemDescPlaceholder')}">${escapeHtml(item.description || '')}</textarea>
      <div class="tracked-item-edit-row">
        <select id="${idPrefix}-datatype">
          <option value="text">${t('dataTypeText')}</option>
          <option value="number">${t('dataTypeNumber')}</option>
        </select>
        <select id="${idPrefix}-visibility">
          <option value="player_and_ai">${t('visibilityPlayerAndAi')}</option>
          <option value="ai_only">${t('visibilityAiOnly')}</option>
        </select>
        <label class="toggle-inline"><input type="checkbox" id="${idPrefix}-auto"> ${t('updateAutomaticallyLabel')}</label>
      </div>
      <textarea id="${idPrefix}-update-instructions" rows="2" placeholder="${t('updateInstructionsPlaceholder')}">${escapeHtml(item.updateInstructions || '')}</textarea>
      <input type="text" id="${idPrefix}-initial" value="${escapeHtml(String(item.initialValue ?? ''))}" placeholder="${t('initialValuePlaceholder')}">
      <div class="character-edit-actions">
        <button class="text-btn ti-save-btn">${t('saveBtn')}</button>
        <button class="text-btn danger-text ti-delete-btn">${t('deleteCharacterBtn')}</button>
      </div>
    `;
    card.querySelector(`#${idPrefix}-datatype`).value = item.dataType;
    card.querySelector(`#${idPrefix}-visibility`).value = item.visibility;
    card.querySelector(`#${idPrefix}-auto`).checked = Boolean(item.updateAutomatically);
    card.querySelector('.ti-save-btn').onclick = async () => {
      const dataType = document.getElementById(`${idPrefix}-datatype`).value;
      const rawInitial = document.getElementById(`${idPrefix}-initial`).value;
      const body = {
        name: document.getElementById(`${idPrefix}-name`).value,
        description: document.getElementById(`${idPrefix}-desc`).value,
        dataType,
        visibility: document.getElementById(`${idPrefix}-visibility`).value,
        updateAutomatically: document.getElementById(`${idPrefix}-auto`).checked,
        updateInstructions: document.getElementById(`${idPrefix}-update-instructions`).value,
        initialValue: dataType === 'number' ? Number(rawInitial) || 0 : rawInitial
      };
      const res = await fetch(`${API}/worlds/${currentWorldId}/tracked-items/${item.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok) Object.assign(item, data.item);
      const status = document.getElementById('characterEditStatus');
      status.textContent = res.ok ? t('characterSavedStatus') : t('errorSavingCharacter');
      setTimeout(() => { status.textContent = ''; }, 2000);
    };
    card.querySelector('.ti-delete-btn').onclick = async () => {
      if (!confirm(t('deleteCharacterConfirm')(item.name))) return;
      await fetch(`${API}/worlds/${currentWorldId}/tracked-items/${item.id}`, { method: 'DELETE' });
      currentWorldTrackedItems = currentWorldTrackedItems.filter(i => i.id !== item.id);
      card.remove();
    };
    list.appendChild(card);
  });
}

document.getElementById('addTrackedItemBtn').onclick = async () => {
  const res = await fetch(`${API}/worlds/${currentWorldId}/tracked-items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: t('newTrackedItemDefaultName'), dataType: 'text', visibility: 'player_and_ai', initialValue: '' })
  });
  const data = await res.json();
  if (!res.ok) return alert(t('errorPrefix') + data.error);
  const items = await fetch(`${API}/worlds/${currentWorldId}/tracked-items`).then(r => r.json());
  currentWorldTrackedItems = items;
  renderTrackedItemsEditor(items);
};

// ---------- NPC editor (in the world editor) ----------

function renderNpcEditor(npcs) {
  const list = document.getElementById('npcEditList');
  list.innerHTML = '';
  npcs.forEach(npc => {
    const idPrefix = `npc-${npc.id}`;
    const card = document.createElement('div');
    card.className = 'npc-edit-card';
    card.innerHTML = `
      <input type="text" id="${idPrefix}-name" value="${escapeHtml(npc.name)}" placeholder="${t('npcNamePlaceholder')}">
      <input type="text" id="${idPrefix}-role" value="${escapeHtml(npc.role || '')}" placeholder="${t('npcRolePlaceholder')}">
      <textarea id="${idPrefix}-detail" rows="2" placeholder="${t('npcDetailPlaceholder')}">${escapeHtml(npc.detail || '')}</textarea>
      <input type="text" id="${idPrefix}-oneliner" value="${escapeHtml(npc.oneLiner || '')}" placeholder="${t('npcOneLinerPlaceholder')}">
      <input type="text" id="${idPrefix}-appearance" value="${escapeHtml(npc.appearance || '')}" placeholder="${t('npcAppearancePlaceholder')}">
      <input type="text" id="${idPrefix}-location" value="${escapeHtml(npc.location || '')}" placeholder="${t('npcLocationPlaceholder')}">
      <div class="character-edit-actions">
        <button class="text-btn npc-save-btn">${t('saveBtn')}</button>
        <button class="text-btn danger-text npc-delete-btn">${t('deleteCharacterBtn')}</button>
      </div>
    `;
    card.querySelector('.npc-save-btn').onclick = async () => {
      const body = {
        name: document.getElementById(`${idPrefix}-name`).value,
        role: document.getElementById(`${idPrefix}-role`).value,
        detail: document.getElementById(`${idPrefix}-detail`).value,
        oneLiner: document.getElementById(`${idPrefix}-oneliner`).value,
        appearance: document.getElementById(`${idPrefix}-appearance`).value,
        location: document.getElementById(`${idPrefix}-location`).value
      };
      const res = await fetch(`${API}/worlds/${currentWorldId}/npcs/${npc.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      const status = document.getElementById('characterEditStatus');
      status.textContent = res.ok ? t('characterSavedStatus') : t('errorSavingCharacter');
      setTimeout(() => { status.textContent = ''; }, 2000);
    };
    card.querySelector('.npc-delete-btn').onclick = async () => {
      if (!confirm(t('deleteCharacterConfirm')(npc.name))) return;
      await fetch(`${API}/worlds/${currentWorldId}/npcs/${npc.id}`, { method: 'DELETE' });
      card.remove();
    };
    list.appendChild(card);
  });
}

document.getElementById('addNpcBtn').onclick = async () => {
  const res = await fetch(`${API}/worlds/${currentWorldId}/npcs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: t('newNpcDefaultName') })
  });
  const data = await res.json();
  if (!res.ok) return alert(t('errorPrefix') + data.error);
  const npcs = await fetch(`${API}/worlds/${currentWorldId}/npcs`).then(r => r.json());
  renderNpcEditor(npcs);
};

document.getElementById('addCharacterBtn').onclick = async () => {
  const res = await fetch(`${API}/worlds/${currentWorldId}/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: t('addCharacterDefaultName'), description: '' })
  });
  const data = await res.json();
  if (!res.ok) return alert(t('errorPrefix') + data.error);
  const charData = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
  renderCharacterEditList(charData.playableCharacters);
};

document.getElementById('generateCharacterBtn').onclick = async () => {
  const input = document.getElementById('aiCharacterDescInput');
  const description = input.value.trim();
  if (!description) return;
  const btn = document.getElementById('generateCharacterBtn');
  btn.disabled = true;
  const status = document.getElementById('characterEditStatus');
  status.textContent = t('generatingStatus');
  try {
    const res = await fetch(`${API}/worlds/${currentWorldId}/characters/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    input.value = '';
    const charData = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
    renderCharacterEditList(charData.playableCharacters);
    status.textContent = t('charGeneratedStatus')(data.character.name);
  } catch (e) {
    status.textContent = t('errorPrefix') + e.message;
  } finally {
    btn.disabled = false;
    setTimeout(() => { status.textContent = ''; }, 2500);
  }
};

// ---------- Character selection ----------

async function startNewAdventure(worldId) {
  const res = await fetch(`${API}/worlds/${worldId}/saves`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return alert(t('cannotStartAdventure') + data.error);
  const worldData = await fetch(`${API}/worlds/${worldId}`).then(r => r.json());
  showCharacterSelect(worldData.world, worldData.playableCharacters, data.save.id);
}

function showCharacterSelect(world, playableCharacters, saveId) {
  currentSaveId = saveId;
  currentWorldId = world.id;
  showView('characterSelect');
  document.getElementById('charSelectTitle').textContent = t('chooseCharacterTitle')(world.title);
  const extraTextEl = document.getElementById('characterSelectText');
  if (world.characterSelectText) {
    extraTextEl.textContent = world.characterSelectText;
    extraTextEl.classList.remove('hidden');
  } else {
    extraTextEl.classList.add('hidden');
  }
  const warningEl = document.getElementById('matureWarning');
  if (world.mature) {
    const warnings = (world.contentWarnings || []).join(', ');
    warningEl.textContent = t('matureWarningPrefix')(warnings);
    warningEl.classList.remove('hidden');
  } else {
    warningEl.classList.add('hidden');
  }
  currentWorldSkills = world.skills || [];
  const list = document.getElementById('characterList');
  list.innerHTML = '';
  playableCharacters.forEach(c => {
    const card = document.createElement('div');
    card.className = 'character-card';
    renderCharacterSelectCard(card, c, world.id, saveId);
    list.appendChild(card);
  });
}

function renderCharacterSelectCard(card, c, worldId, saveId) {
  const skillsHtml = Object.entries(c.skills || {})
    .map(([skill, value]) => `<li>${escapeHtml(skill)}: ${value} <span class="skill-label">(${t('skillLabels')[value] || t('skillNotRated')})</span></li>`)
    .join('');
  const portraitHtml = c.portraitUrl
    ? `<div class="portrait-row"><img class="character-portrait-img" src="${c.portraitUrl}" alt=""></div>`
    : '';
  card.innerHTML = `
    ${portraitHtml}
    <h3>${escapeHtml(c.name)}</h3>
    <p>${escapeHtml(c.description)}</p>
    <ul class="skill-list">${skillsHtml}</ul>
    <div class="character-card-actions">
      <button class="primary-btn choose-character-btn">${t('chooseCharacterBtn')(escapeHtml(c.name))}</button>
      <button class="text-btn edit-character-btn">${t('editCharacterBtn')}</button>
    </div>
  `;
  card.querySelector('.choose-character-btn').onclick = () => chooseCharacter(saveId, c.id);
  card.querySelector('.edit-character-btn').onclick = () => showCharacterEditForm(card, c, worldId, saveId);
}

function showCharacterEditForm(card, c, worldId, saveId) {
  const idPrefix = `select-char-${c.id}`;
  card.innerHTML = `
    <input type="text" id="${idPrefix}-name" value="${escapeHtml(c.name)}">
    <textarea id="${idPrefix}-desc" rows="2">${escapeHtml(c.description || '')}</textarea>
    <div class="skill-inputs">${skillInputsHtml(c.skills, idPrefix)}</div>
    <div class="character-card-actions">
      <button class="primary-btn char-select-save-btn">${t('saveBtn')}</button>
      <button class="text-btn char-select-cancel-btn">${t('cancelBtn')}</button>
    </div>
  `;
  card.querySelector('.char-select-save-btn').onclick = async () => {
    const body = {
      name: document.getElementById(`${idPrefix}-name`).value,
      description: document.getElementById(`${idPrefix}-desc`).value,
      skills: readSkillInputs(idPrefix)
    };
    const res = await fetch(`${API}/worlds/${worldId}/characters/${c.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) return alert(t('errorPrefix') + data.error);
    renderCharacterSelectCard(card, data.character, worldId, saveId);
  };
  card.querySelector('.char-select-cancel-btn').onclick = () => renderCharacterSelectCard(card, c, worldId, saveId);
}

async function chooseCharacter(saveId, characterId) {
  const res = await fetch(`${API}/saves/${saveId}/select-character`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ characterId })
  });
  const data = await res.json();
  if (!res.ok) return alert(t('cannotChooseCharacter') + data.error);
  await openSave(saveId);
}

document.getElementById('backFromCharSelectBtn').onclick = () => {
  currentSaveId = null;
  showView('home');
  loadHome();
};

// ---------- Story (one page per turn, like Infinite Worlds) ----------

async function openSave(id) {
  currentSaveId = id;
  debugModeOn = false;
  await refreshSave(true);
}

async function fetchSaveData() {
  const res = await fetch(`${API}/saves/${currentSaveId}${debugModeOn ? '?debug=1' : ''}`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // A proxy/network hiccup can return a plain-text error body instead of
    // JSON — surface something readable instead of a raw parse error.
    throw new Error(t('illegibleResponse')(res.status));
  }
  if (!res.ok) throw new Error(data.error || 'Unknown error');
  return data;
}

// A long AI call can have its response dropped by a proxy/network hiccup
// even though the server finished the work and saved it — before showing
// an error, check whether save.updatedAt actually moved since the call
// started, and if so just show the real, successful result instead.
async function attemptRecovery(updatedAtBefore) {
  try {
    const data = await fetchSaveData();
    if (data.save.updatedAt !== updatedAtBefore) {
      applySaveData(data, true);
      return true;
    }
  } catch (e) {
    // Recovery check itself failed — fall through and report the original error.
  }
  return false;
}

// Re-fetches the save and re-renders. jumpToLatest=true snaps to the newest
// page (after playing/regenerating/rewinding); false keeps the current page
// position (after just toggling mode auteur).
async function refreshSave(jumpToLatest) {
  const data = await fetchSaveData();
  applySaveData(data, jumpToLatest);
}

function applySaveData(data, jumpToLatest) {
  if (!data.save.activeCharacterId) {
    showCharacterSelect(data.world, data.playableCharacters, currentSaveId);
    return;
  }
  currentWorldId = data.world.id;
  currentSave = data.save;
  currentTurns = data.turns;
  currentTimelineEvents = data.timelineEvents || [];

  showView('story');
  document.getElementById('storyTitle').textContent = data.world.title;
  const activeCharacter = (data.playableCharacters || []).find(c => c.id === data.save.activeCharacterId);
  const charEl = document.getElementById('storyCharacter');
  if (activeCharacter) {
    charEl.textContent = t('storyCharacterPrefix')(activeCharacter.name);
    charEl.classList.remove('hidden');
  } else {
    charEl.classList.add('hidden');
  }
  const objectiveEl = document.getElementById('storyObjective');
  if (data.world.objective) {
    objectiveEl.textContent = `🎯 ${data.world.objective}`;
    objectiveEl.classList.remove('hidden');
  } else {
    objectiveEl.classList.add('hidden');
  }
  document.getElementById('authorModeBtn').classList.toggle('active', debugModeOn);
  document.getElementById('regeneratePopover').classList.add('hidden');
  document.getElementById('timeSkipPopover').classList.add('hidden');

  // Worlds with a "background" popup generate their real first turn on
  // demand (world.firstAction) once a character is chosen — until that
  // first turn exists, show the popup and prefetch it behind the scenes
  // instead of trying to render a page that doesn't exist yet.
  if (currentTurns.length === 0 && data.world.background) {
    document.querySelector('.turn-nav').classList.add('hidden');
    document.getElementById('secretInfoBox').classList.add('hidden');
    document.getElementById('trackedItemsPanel').classList.add('hidden');
    document.getElementById('storyImage').classList.add('hidden');
    document.getElementById('pageContent').innerHTML = '';
    document.getElementById('gameOverBanner').classList.add('hidden');
    document.getElementById('pastPageActions').classList.add('hidden');
    document.getElementById('latestPageActions').classList.add('hidden');
    showBackgroundModal(data.world);
    return;
  }
  document.querySelector('.turn-nav').classList.remove('hidden');

  currentPageIndex = jumpToLatest ? currentTurns.length - 1 : Math.min(currentPageIndex, currentTurns.length - 1);
  renderPage();
  if (jumpToLatest) scrollStoryToTop();
}

function showBackgroundModal(world) {
  document.getElementById('backgroundModalText').innerHTML = formatChapterText(world.background);
  document.getElementById('backgroundModal').classList.remove('hidden');
  pendingFirstAction = world.firstAction || 'Begin.';
  if (!firstTurnPromise) firstTurnPromise = triggerFirstTurn(pendingFirstAction);
}

function hideBackgroundModal() {
  document.getElementById('backgroundModal').classList.add('hidden');
}

// Plays the world's fixed first action as an ordinary turn — this is what
// generates the real, AI-written opening chapter (replacing the old free
// static one for worlds with a background) while the player reads the popup.
async function triggerFirstTurn(action) {
  try {
    const providerOverride = resolveProviderOverride();
    const res = await fetch(`${API}/saves/${currentSaveId}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, authorMode: false, debug: debugModeOn, ...(providerOverride ? { providerOverride } : {}) })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(t('illegibleResponse')(res.status)); }
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    return true;
  } catch (e) {
    return false;
  }
}

document.getElementById('backgroundModalCloseBtn').onclick = async () => {
  const btn = document.getElementById('backgroundModalCloseBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('preparingFirstChapter');
  const ok = firstTurnPromise ? await firstTurnPromise : true;
  btn.disabled = false;
  btn.textContent = originalLabel;

  if (!ok) {
    // The prefetch call failed outright — check whether the server actually
    // succeeded anyway (a dropped response, same class of issue as
    // attemptRecovery elsewhere) before giving up and retrying.
    try {
      const data = await fetchSaveData();
      if (data.turns && data.turns.length > 0) {
        firstTurnPromise = null;
        hideBackgroundModal();
        applySaveData(data, true);
        return;
      }
    } catch (e) { /* fall through to retry */ }
    alert(t('firstTurnError'));
    firstTurnPromise = triggerFirstTurn(pendingFirstAction);
    return;
  }

  firstTurnPromise = null;
  hideBackgroundModal();
  await refreshSave(true);
};

function formatChapterText(text) {
  const paragraphs = (text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const list = paragraphs.length ? paragraphs : [(text || '').trim()];
  return list.map(p => `<p>${escapeHtml(p)}</p>`).join('');
}

function renderPage() {
  const turn = currentTurns[currentPageIndex];
  const total = currentTurns.length;
  const isLatest = currentPageIndex === total - 1;

  // Shown on every page regardless of latest/past/game-over -- where you are
  // in the story and whether you can move through it don't depend on that.
  document.getElementById('pageIndicator').textContent = t('turnIndicator')(currentPageIndex + 1, total);
  document.getElementById('prevPageBtn').disabled = currentPageIndex === 0;
  document.getElementById('nextPageBtn').disabled = isLatest;
  // The opening chapter (turn 0) can never be regenerated (see
  // regenerateTurn in gameEngine.js) -- everything else can be, whether
  // it's the latest turn or a past one.
  document.getElementById('regenerateBtn').classList.toggle('hidden', turn.turnNumber < 1);

  const secretBox = document.getElementById('secretInfoBox');
  if (debugModeOn) {
    secretBox.textContent = `🔍 ${turn.secretInfo || (currentLang === 'en' ? '(nothing hidden yet)' : "(rien de caché pour l'instant)")}`;
    secretBox.classList.remove('hidden');
  } else {
    secretBox.classList.add('hidden');
  }

  renderTrackedItems(turn.trackedItems || []);

  const wrap = document.getElementById('storyImage');
  const img = document.getElementById('storyImageEl');
  if (turn.imageUrl) {
    img.src = turn.imageUrl;
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }

  const content = document.getElementById('pageContent');
  const OUTCOME_LABELS = { success: t('outcomeSuccess'), partial_success: t('outcomePartial'), failure: t('outcomeFailure') };
  const outcomeLabel = debugModeOn ? OUTCOME_LABELS[turn.outcome] : null;
  const outcomeHtml = outcomeLabel ? ` <span class="outcome-badge outcome-${turn.outcome}">${outcomeLabel}</span>` : '';
  const actionLine = turn.turnNumber === 0 ? '' : `<div class="player-action">→ ${escapeHtml(turn.playerAction)}${outcomeHtml}</div>`;
  // The "frise chronologique" badge (see the time-skip mechanic): shown on
  // whichever turn a skip actually landed on, autonomous or player-requested
  // alike -- both paths write the same timelineEvents row (see
  // gameEngine.js's recordTimelineEvent).
  const timelineEvent = currentTimelineEvents.find(e => e.turnNumber === turn.turnNumber);
  const timeSkipBadge = timelineEvent ? `<div class="time-skip-badge">${escapeHtml(t('timeSkipBadge')(timelineEvent.elapsedDescription))}</div>` : '';
  content.innerHTML = `<div class="chapter">${actionLine}${timeSkipBadge}${formatChapterText(turn.chapterText)}</div>`;

  const gameOver = isLatest ? currentSave.gameOver : null;
  renderGameOver(gameOver);

  const pastActions = document.getElementById('pastPageActions');
  const latestActions = document.getElementById('latestPageActions');
  if (!isLatest) {
    pastActions.classList.remove('hidden');
    latestActions.classList.add('hidden');
  } else {
    pastActions.classList.add('hidden');
    latestActions.classList.toggle('hidden', Boolean(gameOver));
    if (!gameOver) {
      renderSuggestions(turn.suggestedActions || []);
    }
  }
}

function renderTrackedItems(items) {
  const panel = document.getElementById('trackedItemsPanel');
  if (!items.length) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  panel.innerHTML = items
    .map(i => `<div class="tracked-item${i.visibility === 'ai_only' ? ' tracked-item-hidden' : ''}"><span class="tracked-item-name">${escapeHtml(i.name)}</span><span class="tracked-item-value">${escapeHtml(String(i.value))}</span></div>`)
    .join('');
}

function renderGameOver(gameOver) {
  const banner = document.getElementById('gameOverBanner');
  if (!gameOver) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const label = gameOver.result === 'victory' ? t('gameOverVictoryLabel') : t('gameOverEndLabel');
  const continueHtml = gameOver.result === 'victory'
    ? `<button id="continuePlayingBtn" class="primary-btn">${t('continuePlayingBtn')}</button>`
    : '';
  banner.className = `game-over-banner game-over-${gameOver.result}`;
  banner.innerHTML = `<strong>${label}</strong><p>${escapeHtml(gameOver.text)}</p>${continueHtml}`;
  banner.classList.remove('hidden');
  if (gameOver.result === 'victory') {
    document.getElementById('continuePlayingBtn').onclick = continuePlaying;
  }
}

async function continuePlaying() {
  try {
    const res = await fetch(`${API}/saves/${currentSaveId}/continue`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await refreshSave(true);
  } catch (e) {
    alert(t('cannotContinue') + e.message);
  }
}

function renderSuggestions(actions) {
  const wrap = document.getElementById('suggestedActions');
  wrap.innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn';
    btn.textContent = a;
    // Used to call playAction() directly, submitting the suggestion as a
    // turn on a single click with no way to tweak it first. Now it only
    // pre-fills the action field, editable like anything the player types
    // themselves -- they still send it manually (Entrée / the send button).
    btn.onclick = () => {
      const actionEl = document.getElementById('actionInput');
      actionEl.value = a;
      resizeTextarea(actionEl);
      actionEl.focus();
    };
    wrap.appendChild(btn);
  });
}

// Decides whether to offer the fallback provider for this one turn, using
// only the already-known background-polled status (see pollOllamaStatus) --
// deliberately no network check here, so this never adds latency to
// submitting a turn. Returns a providerOverride object, or null to proceed
// with the primary provider as configured.
function resolveProviderOverride() {
  if (document.getElementById('textProvider').value !== 'ollama') return null;
  if (ollamaStatus.state === 'available') return null;

  const fallbackProvider = document.getElementById('fallbackProvider').value;
  if (!fallbackProvider) return null; // nothing configured to fall back to

  const reason = t(ollamaStatus.state === 'busy' ? 'fallbackConfirmBusyMsg' : 'fallbackConfirmOfflineMsg');
  const providerLabel = PROVIDER_LABELS[fallbackProvider] || fallbackProvider;
  const question = t('fallbackConfirmUseBtn').replace('{provider}', providerLabel);
  const useFallback = confirm(`${reason}\n\n${question}`);
  if (!useFallback) return null;

  return { provider: fallbackProvider, model: document.getElementById('fallbackModel').value.trim() };
}

// actionText and instructionText are the raw contents of the two always-
// visible fields (see the segmented-card markup in index.html). Which
// combination is present decides the turn's semantics: both -> a normal
// action with narrator guidance layered on top; only the instruction ->
// the old "author mode" case, a pure out-of-character instruction with
// nothing for the character to actually do; only the action -> an
// ordinary turn. At least one of the two must be non-empty (callers check
// this before calling in).
async function playAction({ actionText, instructionText }) {
  const actionEl = document.getElementById('actionInput');
  const instructionEl = document.getElementById('instructionInput');
  actionEl.value = '';
  instructionEl.value = '';
  resizeTextarea(actionEl);
  resizeTextarea(instructionEl);

  const authorMode = !actionText && Boolean(instructionText);
  const effectiveAction = actionText || instructionText;
  const authorNote = (actionText && instructionText) ? instructionText : undefined;

  const content = document.getElementById('pageContent');
  // Echo the action immediately rather than leaving the reader staring at
  // an emptied input box for the next several seconds -- it's the cheapest
  // possible signal that the click/submit actually registered.
  const echoedAction = document.createElement('div');
  echoedAction.className = 'player-action';
  echoedAction.textContent = `→ ${effectiveAction}`;
  content.appendChild(echoedAction);
  const pending = document.createElement('p');
  pending.className = 'loading';
  pending.textContent = authorMode ? t('narratorApplyingInstruction') : t('narratorThinking');
  content.appendChild(pending);
  document.getElementById('suggestedActions').innerHTML = '';

  const providerOverride = resolveProviderOverride();

  const updatedAtBefore = currentSave.updatedAt;
  // The chapter text streams in as it's written (see POST .../turn/stream
  // and playTurnStreaming server-side) -- this paragraph starts empty and
  // fills in live, replacing the "narrator thinking" placeholder the moment
  // the first words arrive, well before the full turn (including the
  // slower, invisible state/bookkeeping call) finishes.
  let streaming = null;
  try {
    const res = await fetch(`${API}/saves/${currentSaveId}/turn/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: effectiveAction, authorMode, authorNote, debug: debugModeOn, ...(providerOverride ? { providerOverride } : {}) })
    });
    if (!res.ok || !res.body) throw new Error(t('illegibleResponse')(res.status));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamedText = '';
    let doneEvent = null;
    let errorMessage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch (e) { continue; }
        if (event.type === 'chunk') {
          if (!streaming) {
            pending.remove();
            streaming = document.createElement('p');
            streaming.className = 'chapter-streaming';
            content.appendChild(streaming);
          }
          streamedText += event.text;
          streaming.textContent = streamedText;
        } else if (event.type === 'done') {
          doneEvent = event;
        } else if (event.type === 'error') {
          errorMessage = event.message;
        }
      }
    }

    if (errorMessage) throw new Error(errorMessage);
    if (!doneEvent) throw new Error(t('illegibleResponse')(res.status));
    await refreshSave(true);
  } catch (e) {
    if (!(await attemptRecovery(updatedAtBefore))) {
      // Nothing was actually persisted (attemptRecovery would have caught
      // it otherwise) -- remove the echoed action and any partial live text
      // rather than leaving them stacked permanently below the real last
      // page, which read as "pagination broke". Put the action back in the
      // input so retrying doesn't mean retyping it.
      echoedAction.remove();
      pending.remove();
      if (streaming) streaming.remove();
      actionEl.value = actionText;
      instructionEl.value = instructionText;
      resizeTextarea(actionEl);
      resizeTextarea(instructionEl);
      alert(t('errorPrefix') + e.message + t('retryHint'));
    }
  }
}

// The explicit half of the time-skip mechanic (see timeSkipPopover in
// index.html and PACING & TIME SKIPS in lib/promptBuilder.js for the
// autonomous half, which needs no client-side code at all -- the Writer
// can already decide to skip on its own within a normal playAction turn).
// Mirrors playAction's streaming logic closely -- same echo/pending/stream
// dance, same recovery path on failure -- against the dedicated
// time-skip/stream route instead.
async function playTimeSkip(hint) {
  const hintEl = document.getElementById('timeSkipHintInput');
  hintEl.value = '';
  resizeTextarea(hintEl);
  document.getElementById('timeSkipPopover').classList.add('hidden');

  const content = document.getElementById('pageContent');
  const echoedAction = document.createElement('div');
  echoedAction.className = 'player-action';
  echoedAction.textContent = t('timeSkipEcho')(hint);
  content.appendChild(echoedAction);
  const pending = document.createElement('p');
  pending.className = 'loading';
  pending.textContent = t('timeSkipThinking');
  content.appendChild(pending);
  document.getElementById('suggestedActions').innerHTML = '';

  const providerOverride = resolveProviderOverride();
  const updatedAtBefore = currentSave.updatedAt;
  let streaming = null;
  try {
    const res = await fetch(`${API}/saves/${currentSaveId}/time-skip/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hint, debug: debugModeOn, ...(providerOverride ? { providerOverride } : {}) })
    });
    if (!res.ok || !res.body) throw new Error(t('illegibleResponse')(res.status));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamedText = '';
    let doneEvent = null;
    let errorMessage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch (e) { continue; }
        if (event.type === 'chunk') {
          if (!streaming) {
            pending.remove();
            streaming = document.createElement('p');
            streaming.className = 'chapter-streaming';
            content.appendChild(streaming);
          }
          streamedText += event.text;
          streaming.textContent = streamedText;
        } else if (event.type === 'done') {
          doneEvent = event;
        } else if (event.type === 'error') {
          errorMessage = event.message;
        }
      }
    }

    if (errorMessage) throw new Error(errorMessage);
    if (!doneEvent) throw new Error(t('illegibleResponse')(res.status));
    await refreshSave(true);
  } catch (e) {
    if (!(await attemptRecovery(updatedAtBefore))) {
      echoedAction.remove();
      pending.remove();
      if (streaming) streaming.remove();
      hintEl.value = hint;
      resizeTextarea(hintEl);
      alert(t('errorPrefix') + e.message + t('retryHint'));
    }
  }
}

document.getElementById('actionForm').onsubmit = (e) => {
  e.preventDefault();
  const actionText = document.getElementById('actionInput').value.trim();
  const instructionText = document.getElementById('instructionInput').value.trim();
  if (actionText || instructionText) playAction({ actionText, instructionText });
};

autoGrowTextarea(document.getElementById('actionInput'), () => document.getElementById('actionForm').requestSubmit());
autoGrowTextarea(document.getElementById('instructionInput'), () => document.getElementById('actionForm').requestSubmit());
autoGrowTextarea(document.getElementById('regenerateActionInput'));
autoGrowTextarea(document.getElementById('regenerateNoteInput'));
autoGrowTextarea(document.getElementById('timeSkipHintInput'));

document.getElementById('prevPageBtn').onclick = () => {
  if (currentPageIndex > 0) { currentPageIndex--; renderPage(); }
};
document.getElementById('nextPageBtn').onclick = () => {
  if (currentPageIndex < currentTurns.length - 1) { currentPageIndex++; renderPage(); }
};

document.getElementById('resumeFromPageBtn').onclick = async () => {
  const turn = currentTurns[currentPageIndex];
  if (!confirm(t('rewindConfirm'))) return;
  try {
    const res = await fetch(`${API}/saves/${currentSaveId}/rewind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnNumber: turn.turnNumber })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await refreshSave(true);
  } catch (e) {
    alert(t('errorPrefix') + e.message);
  }
};

document.getElementById('regenerateBtn').onclick = () => {
  const turn = currentTurns[currentPageIndex];
  const actionField = document.getElementById('regenerateActionInput');
  const noteField = document.getElementById('regenerateNoteInput');
  actionField.value = turn.playerAction;
  noteField.value = '';
  resizeTextarea(actionField);
  resizeTextarea(noteField);

  // Regenerating rewinds to just before this turn and replays it, which
  // silently discards every turn after it (see rewindToTurn in
  // gameEngine.js) -- exactly like "Resume from here", so a turn that
  // isn't the latest gets the same explicit warning before it happens.
  const turnsAfter = currentTurns.length - 1 - currentPageIndex;
  const warning = document.getElementById('regenerateWarning');
  if (turnsAfter > 0) {
    warning.textContent = t('regeneratePastWarning')(turnsAfter);
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }

  document.getElementById('regeneratePopover').classList.remove('hidden');
};
document.getElementById('regenerateCancelBtn').onclick = () => {
  document.getElementById('regeneratePopover').classList.add('hidden');
};
document.getElementById('regenerateConfirmBtn').onclick = async () => {
  const turn = currentTurns[currentPageIndex];
  const turnsAfter = currentTurns.length - 1 - currentPageIndex;
  if (turnsAfter > 0 && !confirm(t('regeneratePastConfirm'))) return;
  const action = document.getElementById('regenerateActionInput').value.trim();
  const note = document.getElementById('regenerateNoteInput').value.trim();
  const updatedAtBefore = currentSave.updatedAt;

  document.getElementById('regeneratePopover').classList.add('hidden');
  // Regeneration replaces the page currently on screen, so it's cleared up
  // front (unlike playAction, which appends after the existing last page) --
  // same live-streaming treatment otherwise, and a plain renderPage() cheaply
  // restores the untouched original from memory if this fails, no refetch needed.
  const content = document.getElementById('pageContent');
  content.innerHTML = '';
  const echoedAction = document.createElement('div');
  echoedAction.className = 'player-action';
  echoedAction.textContent = `→ ${action || turn.playerAction}`;
  content.appendChild(echoedAction);
  const pending = document.createElement('p');
  pending.className = 'loading';
  pending.textContent = debugModeOn ? t('narratorApplyingInstruction') : t('narratorThinking');
  content.appendChild(pending);
  document.getElementById('suggestedActions').innerHTML = '';

  let streaming = null;
  try {
    const res = await fetch(`${API}/saves/${currentSaveId}/turns/${turn.turnNumber}/regenerate/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, note, debug: debugModeOn })
    });
    if (!res.ok || !res.body) throw new Error(t('illegibleResponse')(res.status));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamedText = '';
    let doneEvent = null;
    let errorMessage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch (e) { continue; }
        if (event.type === 'chunk') {
          if (!streaming) {
            pending.remove();
            streaming = document.createElement('p');
            streaming.className = 'chapter-streaming';
            content.appendChild(streaming);
          }
          streamedText += event.text;
          streaming.textContent = streamedText;
        } else if (event.type === 'done') {
          doneEvent = event;
        } else if (event.type === 'error') {
          errorMessage = event.message;
        }
      }
    }

    if (errorMessage) throw new Error(errorMessage);
    if (!doneEvent) throw new Error(t('illegibleResponse')(res.status));
    await refreshSave(true);
  } catch (e) {
    if (!(await attemptRecovery(updatedAtBefore))) {
      renderPage();
      alert(t('errorPrefix') + e.message + t('regenFailedHint'));
    }
  }
};

document.getElementById('authorModeBtn').onclick = async () => {
  debugModeOn = !debugModeOn;
  await refreshSave(false);
};

document.getElementById('backBtn').onclick = () => {
  currentSaveId = null;
  debugModeOn = false;
  showView('home');
  loadHome();
};

document.getElementById('editWorldBtn').onclick = () => openWorldEditor(currentWorldId);

document.getElementById('timeSkipBtn').onclick = () => {
  document.getElementById('timeSkipHintInput').value = '';
  document.getElementById('timeSkipPopover').classList.remove('hidden');
};
document.getElementById('timeSkipCancelBtn').onclick = () => {
  document.getElementById('timeSkipPopover').classList.add('hidden');
};
document.getElementById('timeSkipConfirmBtn').onclick = () => {
  const hint = document.getElementById('timeSkipHintInput').value.trim();
  playTimeSkip(hint);
};

document.getElementById('purgeImagesBtn').onclick = async () => {
  if (!confirm(t('purgeImagesConfirm'))) return;
  const status = document.getElementById('purgeImagesStatus');
  try {
    const res = await fetch(`${API}/saves/${currentSaveId}/purge-images`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await refreshSave(false);
    status.textContent = t('purgeImagesStatus');
    status.classList.remove('hidden');
  } catch (e) {
    status.textContent = t('errorPrefix') + e.message;
    status.classList.remove('hidden');
  } finally {
    setTimeout(() => { status.classList.add('hidden'); status.textContent = ''; }, 2500);
  }
};

// ---------- Settings ----------

document.getElementById('settingsBtn').onclick = async () => {
  previousView = currentSaveId ? 'story' : (currentWorldId && !views.worldEdit.classList.contains('hidden') ? 'worldEdit' : 'home');
  await loadSettings();
  await loadCostSummary();
  showView('settings');
};
document.getElementById('closeSettingsBtn').onclick = () => {
  showView(previousView);
  if (previousView === 'home') loadHome();
};

async function loadCostSummary() {
  const c = await fetch(`${API}/costs`).then(r => r.json());
  const el = document.getElementById('costSummary');
  const locale = currentLang === 'en' ? 'en-US' : 'fr-FR';
  const dollars = c.estimatedCostUsd != null ? `~$${c.estimatedCostUsd.toFixed(4)}` : t('costUnknown');
  el.innerHTML = `
    <div class="cost-row"><span>${t('costCallsLabel')}</span><strong>${c.calls}</strong></div>
    <div class="cost-row"><span>${t('costInputLabel')}</span><strong>${c.inputTokens.toLocaleString(locale)}</strong></div>
    <div class="cost-row"><span>${t('costOutputLabel')}</span><strong>${c.outputTokens.toLocaleString(locale)}</strong></div>
    <div class="cost-row"><span>${t('costEstimateLabel')}</span><strong>${dollars}</strong></div>
    ${c.hasUnknownCost ? `<p class="hint-inline">${t('costUnknownHint')}</p>` : ''}
  `;
}

function updateChapterLengthLabel() {
  const words = Number(document.getElementById('chapterLengthSlider').value);
  document.getElementById('chapterLengthLabel').textContent = t('chapterLengthWords')(words);
}
document.getElementById('chapterLengthSlider').oninput = updateChapterLengthLabel;

// Presets shown per-provider in #textModelPreset — convenience only. Picking
// one just fills #textModel, the actual field that gets saved, so any model
// id (including ones not listed here, or a self-hosted Ollama model name)
// still works by typing it directly. $/1M token figures are for display only
// (see lib/pricing.js, the source of truth used for real cost estimates).
const MODEL_PRESETS = {
  anthropic: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — $2/$10 per 1M' },
    { id: 'claude-opus-5', label: 'Claude Opus 5 — $5/$25 per 1M' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — $1/$5 per 1M' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 — écriture créative' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — $3/$15 per 1M' }
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o — $2.50/$10 per 1M' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini — $0.15/$0.60 per 1M' }
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (via OpenRouter)' },
    { id: 'openai/gpt-4o', label: 'GPT-4o (via OpenRouter)' },
    { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B (via OpenRouter)' }
  ],
  gemini: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash — $0.75/$3.75 per 1M' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite — économique, bon pour les tests' },
    { id: 'gemma-4-31b-it', label: 'Gemma 4 31B — quota gratuit généreux, format moins fiable' }
  ],
  ollama: [
    { id: 'llama3.1:8b', label: 'Llama 3.1 8B — rapide, ~5 Go VRAM' },
    { id: 'qwen3:14b', label: 'Qwen 3 14B — bon compromis prose/JSON, ~9 Go VRAM' },
    { id: 'mistral-small:22b', label: 'Mistral Small 22B — meilleure prose, ~13,5 Go VRAM' }
  ],
  mock: []
};

function renderModelPresets(provider) {
  const select = document.getElementById('textModelPreset');
  const customLabel = select.options[0]; // "(custom / manual)" — always kept as the first option
  select.innerHTML = '';
  select.appendChild(customLabel);
  (MODEL_PRESETS[provider] || []).forEach(({ id, label }) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    select.appendChild(opt);
  });
}

document.getElementById('textProvider').onchange = () => {
  renderModelPresets(document.getElementById('textProvider').value);
};

document.getElementById('textModelPreset').onchange = () => {
  const presetId = document.getElementById('textModelPreset').value;
  if (presetId) document.getElementById('textModel').value = presetId;
};

// ---------- Ollama bridge status (hors ligne / indisponible / disponible) ----------
//
// Polled continuously in the background (not just while Settings is open) so
// that submitting a turn (playAction) can make its fallback decision off the
// last-known value instantly, with zero added latency in that critical path.

const PROVIDER_LABELS = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', openrouter: 'OpenRouter', gemini: 'Google (Gemini)' };
let ollamaStatus = { state: 'offline' };

function renderOllamaStatusIndicator() {
  const dot = document.getElementById('ollamaStatusDot');
  const text = document.getElementById('ollamaStatusText');
  const state = ollamaStatus.state || 'offline';
  dot.className = 'status-dot status-dot-' + state;
  text.textContent = t(state === 'available' ? 'ollamaStatusAvailable' : state === 'busy' ? 'ollamaStatusBusy' : 'ollamaStatusOffline');
}

async function pollOllamaStatus() {
  try {
    ollamaStatus = await fetch(`${API}/ollama/status`).then(r => r.json());
  } catch (e) {
    ollamaStatus = { state: 'offline' };
  }
  renderOllamaStatusIndicator();
}

async function refreshOllamaModels() {
  try {
    const { models } = await fetch(`${API}/ollama/models`).then(r => r.json());
    if (models && models.length) {
      MODEL_PRESETS.ollama = models.map(id => ({ id, label: id }));
      if (document.getElementById('textProvider').value === 'ollama') renderModelPresets('ollama');
    }
  } catch (e) { /* keep the static placeholder list if the bridge isn't reachable */ }
}

document.getElementById('ollamaRefreshBtn').onclick = () => {
  pollOllamaStatus();
  refreshOllamaModels();
};

setInterval(pollOllamaStatus, 12000);
pollOllamaStatus();

// ---------- Local Stable Diffusion model detection ----------
//
// Feeds two selects from the same detected list: the global default in
// Settings (#imageModelPreset -> #imageModel, settings.imageModel) and the
// per-world override in the World editor (#worldImageModelPreset ->
// #worldImageModelInput, world.imageModel — wins over the global default
// when set, see gameEngine.js). Fetched on demand (Settings/World editor
// opening) rather than polled, since it's only relevant while one of those
// panels is visible. Silently falls back to manual typing if the bridge
// isn't reachable.

let localSdModels = [];

function renderImageModelPresetSelect(selectId) {
  const select = document.getElementById(selectId);
  const customLabel = select.options[0]; // "(custom / manual)" — always kept as the first option
  select.innerHTML = '';
  select.appendChild(customLabel);
  const categoryLabels = {
    illustration: t('imageModelCategoryIllustration'),
    photorealistic: t('imageModelCategoryPhotorealistic'),
    mature: t('imageModelCategoryMature'),
    other: t('imageModelCategoryOther')
  };
  localSdModels.forEach(({ value, name, category }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = `${categoryLabels[category] || categoryLabels.other} - ${name}`;
    select.appendChild(opt);
  });
}

function renderAllImageModelPresets() {
  renderImageModelPresetSelect('worldImageModelPreset');
  renderImageModelPresetSelect('imageModelPreset');
}

async function refreshLocalSdModels() {
  try {
    const { models } = await fetch(`${API}/localsd/models`).then(r => r.json());
    localSdModels = models || [];
  } catch (e) {
    localSdModels = [];
  }
  renderAllImageModelPresets();
}

document.getElementById('worldImageModelPreset').onchange = () => {
  const presetValue = document.getElementById('worldImageModelPreset').value;
  if (presetValue) document.getElementById('worldImageModelInput').value = presetValue;
};

document.getElementById('imageModelPreset').onchange = () => {
  const presetValue = document.getElementById('imageModelPreset').value;
  if (presetValue) document.getElementById('imageModel').value = presetValue;
};

document.getElementById('localsdRefreshBtn').onclick = () => refreshLocalSdModels();

async function loadSettings() {
  const s = await fetch(`${API}/settings`).then(r => r.json());
  document.getElementById('textProvider').value = s.textProvider;
  document.getElementById('textModel').value = s.textModel || '';
  renderModelPresets(s.textProvider);
  document.getElementById('ollamaBaseUrl').value = s.ollamaBaseUrl || '';
  document.getElementById('fallbackProvider').value = s.fallbackProvider || '';
  document.getElementById('fallbackModel').value = s.fallbackModel || '';
  refreshOllamaModels();
  document.getElementById('responseLanguage').value = s.language || 'fr';
  document.getElementById('chapterLengthSlider').value = Number(s.chapterLength) || 400;
  updateChapterLengthLabel();
  document.getElementById('imageProvider').value = s.imageProvider;
  document.getElementById('imagesEnabled').checked = s.imagesEnabled;
  document.getElementById('localImageBaseUrl').value = s.localImageBaseUrl || '';
  document.getElementById('imageModel').value = s.imageModel || '';
  refreshLocalSdModels();
  ['anthropic', 'openai', 'openrouter', 'gemini', 'ollama', 'stability', 'replicate', 'localsd'].forEach(p => {
    const field = document.getElementById(`key-${p}`);
    field.placeholder = s.apiKeys[p] ? t('keyAlreadySaved') : field.placeholder;
  });
}

document.getElementById('saveSettingsBtn').onclick = async () => {
  const apiKeys = {};
  ['anthropic', 'openai', 'openrouter', 'gemini', 'ollama', 'stability', 'replicate', 'localsd'].forEach(p => {
    const val = document.getElementById(`key-${p}`).value.trim();
    if (val) apiKeys[p] = val; // only overwrite if the user typed something new
  });
  const body = {
    textProvider: document.getElementById('textProvider').value,
    textModel: document.getElementById('textModel').value.trim(),
    ollamaBaseUrl: document.getElementById('ollamaBaseUrl').value.trim(),
    fallbackProvider: document.getElementById('fallbackProvider').value,
    fallbackModel: document.getElementById('fallbackModel').value.trim(),
    language: document.getElementById('responseLanguage').value,
    chapterLength: Number(document.getElementById('chapterLengthSlider').value),
    imageProvider: document.getElementById('imageProvider').value,
    imageModel: document.getElementById('imageModel').value.trim(),
    imagesEnabled: document.getElementById('imagesEnabled').checked,
    localImageBaseUrl: document.getElementById('localImageBaseUrl').value.trim(),
    apiKeys
  };
  await fetch(`${API}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  // settings.language drives both the app's own interface language and the
  // default proposed when creating a new world — apply it immediately
  // rather than waiting for a reload.
  currentLang = body.language || currentLang;
  applyUiLanguage();
  updateChapterLengthLabel();
  await loadCostSummary();
  document.getElementById('settingsStatus').textContent = t('savedStatus');
  ['anthropic', 'openai', 'openrouter', 'gemini', 'ollama', 'stability', 'replicate', 'localsd'].forEach(p => {
    document.getElementById(`key-${p}`).value = '';
  });
  await loadSettings();
  pollOllamaStatus(); // ollamaBaseUrl may have just changed
  setTimeout(() => { document.getElementById('settingsStatus').textContent = ''; }, 2000);
};

// ---------- Utils ----------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- Init ----------

(async () => {
  try {
    const s = await fetch(`${API}/settings`).then(r => r.json());
    currentLang = s.language || 'fr';
  } catch (e) {
    currentLang = 'fr';
  }
  applyUiLanguage();
  loadHome();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
