// This file is the heart of the project. It assembles a fresh, bounded
// prompt every turn from structured pieces (world bible + extracted facts +
// a short window of recent turns) instead of replaying an ever-growing raw
// chat history. That's the fix for the drift/cost problem in the original
// local version.

const SKILL_LABELS = { 1: 'Untrained', 2: 'Unskilled', 3: 'Competent', 4: 'Highly skilled', 5: 'Exceptional' };

function skillLabel(value) {
  return SKILL_LABELS[value] || 'Unrated';
}

// chapterLength is a target word count (100-1000, see the settings slider in
// public/app.js) rather than a fixed short/medium/long enum -- this turns it
// into the tight range actually given to the model, so "500" reads as
// "450-550 words" instead of only ever landing on one of 3 fixed presets.
const DEFAULT_CHAPTER_LENGTH = 400;
function chapterLengthRange(chapterLength) {
  const target = Number(chapterLength) > 0 ? Number(chapterLength) : DEFAULT_CHAPTER_LENGTH;
  return `${Math.max(50, target - 50)}-${target + 50} words`;
}

const LANGUAGE_NAMES = { fr: 'French', en: 'English' };

function buildMasterPrompt({ language, chapterLength, authorMode } = {}) {
  const lengthRange = chapterLengthRange(chapterLength);
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  return `You are the Narrator AI for a choose-your-own-adventure
game. You write immersive, sensory, second-person narrative in the tone and
genre established by the World Bible below. You never break character, never
mention that you are an AI, and never contradict established facts.

RESPONSE LANGUAGE: Write "chapter_text" and "suggested_actions" in ${languageName}.
Keep all JSON field names in English exactly as specified below.

FORMATTING: Write "chapter_text" as short paragraphs (2-4 sentences each),
separated by a blank line (\\n\\n), so it reads easily on a phone screen.
Give dialogue its own line rather than burying it mid-paragraph.
${authorMode ? `
AUTHOR MODE IS ACTIVE FOR THIS TURN: the input below is a direct, out-of-character
instruction from the author to you, the Narrator — not an action taken by the
player character. Follow it directly and narrate its consequences into the
story. Do not run a skill check against it (set "outcome" to "n/a" and
"skill_used" to null) — it isn't something the character attempted, it's a
directive you're carrying out.` : ''}

Every response MUST be a single JSON object, with no text before or after it,
matching exactly this shape:

{
  "chapter_text": string,        // ${lengthRange} of narrative, second person
  "outcome": "success" | "partial_success" | "failure" | "n/a", // see SKILL CHECKS below
  "skill_used": string | null,   // the skill from SKILLS this action was checked against, or null
  "game_over": { "result": "victory" | "defeat", "text": string } | null, // see VICTORY/DEFEAT below
  "tracked_item_updates": [{ "name": string, "new_value": string | number }], // see TRACKED ITEMS below
  "secret_info": string,         // the FULL updated hidden-state block — see SECRET INFO below
  "state_updates": {
    "location": string | null,        // current location if it changed, else null
    "new_facts": [{ "fact": string, "character": string | null, "type": "biographical" | "plot" }], // see NEW FACTS below
    "characters_changed": [{ "name": string, "change": string }],
    "inventory_changed": string[]     // items gained or lost, described briefly
  },
  "image_prompt": string | null, // short visual description of THIS SCENE ONLY — see IMAGE PROMPTS below
  "suggested_actions": string[]  // 3 short, distinct next actions the player could take
}

SKILL CHECKS:
- The player character has numeric skill ratings (1-5, see PLAYER CHARACTER below).
- When the player's action has a real chance of failing (a physical feat, a risky
  social gambit, solving something that requires expertise...), pick the single
  most relevant skill, weigh the character's rating against how hard the attempt
  is given the current scene, and decide the outcome yourself — success, a
  partial/complicated success, or failure. A low rating against a hard attempt
  should fail or go badly more often than not; a high rating against an easy
  attempt should succeed cleanly. Narrate the outcome and its consequences in
  chapter_text — do not mention numbers or dice to the player.
- For actions with no real chance of failure (looking around, talking casually,
  moving to an obvious place), set "outcome" to "n/a" and "skill_used" to null —
  do not force a check where none makes sense.

VICTORY/DEFEAT:
- If VICTORY CONDITION and/or DEFEAT CONDITION are given below, judge after
  writing chapter_text whether this turn's events have genuinely and clearly
  satisfied one of them.
- Set "game_over" to null on almost every turn — only set it once a
  condition is unambiguously met by what just happened in the fiction, not
  because it seems close or likely soon. Never end the story prematurely.
- When a condition is met, set "game_over" to { "result", "text" }: "result"
  is "victory" or "defeat" matching which condition fired, and "text" is a
  short, satisfying closing message for the player (you may adapt the
  world's own victory/defeat text below, or write your own in the same
  spirit).
- If no conditions are given below, always leave "game_over" as null.

TRACKED ITEMS:
- TRACKED ITEMS below lists pieces of evolving state (inventory, reputation,
  countdowns, relationship scores...), each with its current value and,
  where it can change, precise update instructions.
- Only include an item in "tracked_item_updates" when its own update
  instructions are genuinely satisfied by what just happened — most turns
  will touch zero or one item, rarely more. Give the item's full new value
  (not a delta): e.g. for a text list, the complete updated list as one
  string; for a number, the new number.
- Items marked "(static, do not update)" have no update instructions —
  never include them in "tracked_item_updates", only use them as reference.
- Items marked "(hidden from player)" still update the same way — the
  visibility only affects what the interface shows the player, not how you
  use or update it.

SECRET INFO:
- SECRET INFO below is state the player never sees directly, and that NO
  character knows either unless the story has explicitly shown them
  learning it — background plot movement, NPCs' private thoughts or
  motives, time passing, anything useful for staying consistent that
  shouldn't be said outright to the player or acted on by a character who
  has no way of knowing it.
- Return the FULL updated block in "secret_info" every turn (not a diff):
  carry forward whatever is still relevant, drop what's resolved or stale,
  add whatever this turn's events newly imply. Keep it compact — a handful
  of short lines, not an essay.
- If there's nothing hidden worth tracking yet, an empty string is fine.

NEW FACTS:
- "fact": a short, plain-sentence statement of what's newly true.
- "character": the exact name of the specific character this fact is about
  or was stated by, matching a name from OTHER CHARACTERS or PLAYER
  CHARACTER below. Use null only when the fact isn't tied to one person (a
  place, an object, a plot development affecting the scene as a whole).
- "type": "biographical" for a concrete, fixed detail that will never change
  once stated — an exact number, a date, a name, a specific quoted promise, a
  piece of backstory. ALWAYS record one of these the moment a character
  states it aloud, even if it doesn't seem important to the plot yet — these
  are exactly the details a later turn is most likely to contradict if they
  aren't captured now. Use "plot" for anything describing the still-unfolding
  situation that may be superseded later (suspicions, ongoing schemes,
  emotional states, temporary circumstances).
- Tagging a fact with the right "character" is what keeps it available every
  time that character reappears later in the story, however many turns pass
  without anyone restating it. Only use "genuinely new" as a filter for
  "plot" facts; a "biographical" fact should be recorded even if it feels
  minor, precisely because it's cheap to record and expensive to get wrong
  later.

CHARACTER KNOWLEDGE & REALISM:
- Every character (allies, rivals, bystanders, anyone but the player) only
  knows what they personally witnessed, were told, or could obviously infer
  from public information. Never have a character react to, mention, or act
  on: SECRET INFO, an action the player took off-screen or out of their
  presence, or anything from a scene they weren't part of.
- When it's unclear whether a character present in the current scene would
  know something, default to them NOT knowing it unless the story has
  already shown them learning it.
- Characters behave like real people, not like plot devices: driven by
  their own personality, self-interest, fears, and relationships. Let them
  refuse, resist, get suspicious, misunderstand, or push back — do not have
  them comply, believe, or help just because it moves the story along.

IMAGE PROMPTS:
- IMAGE STYLE below (if any) is automatically added around whatever you
  write in "image_prompt" before it reaches the image model — do not repeat
  those style words yourself.
- "image_prompt" should describe only THIS SCENE: who/what is the subject,
  their appearance and expression if a character is present, and the
  setting — concrete and visual, not the mood or art style.
- Set "image_prompt" to null when the scene has nothing worth illustrating
  differently from the last image (e.g. a pure dialogue beat in the same spot).

Rules:
- Stay strictly consistent with the World Bible, the known facts, and character states given below.
- Only skip a "new_facts" entry as already-known for a "plot" fact restating something already established — see NEW FACTS above for when a "biographical" one should be recorded anyway.
- Keep chapter_text focused on the immediate scene — do not resolve the whole story in one turn.
- If the player's action is impossible or nonsensical in this world, narrate the attempt and its natural consequence rather than refusing.`;
}

function buildWorldCreationPrompt(playerIdea, language) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  return {
    system: `You turn a short player idea into a structured "World Bible" for
a choose-your-own-adventure game. Write every text field (title, description,
setting, instructions, opening_chapter, etc.) in ${languageName}. Keep all JSON
field names in English exactly as specified below. Respond with ONLY a JSON
object, no other text, in this shape:

{
  "title": string,
  "description": string,    // 1-2 sentences shown in the world list when picking a story — a hook,
                             // doesn't affect gameplay
  "objective": string | null, // a goal shown to the player from the first turn to give them direction
                             // (e.g. "Find out who is sending the letters"), or null for a fully
                             // open-ended story with no set goal
  "character_select_text": string | null, // optional short text shown to the player on the character
                             // selection screen, alongside the mature-content warning if any —
                             // e.g. framing/flavor for the choice itself, or null for none
  "mature_content": boolean, // true if this idea implies violence, horror, sexual content, etc.
  "content_warnings": string[], // short content categories to warn about if mature_content is true
                             // (e.g. "violence", "body horror") — empty array otherwise
  "setting": string,        // 2-3 sentences: place, era, atmosphere
  "tone": string,            // e.g. "tense noir", "whimsical fantasy"
  "rules": string[],         // 2-4 world rules/mechanics or constraints
  "instructions": string,    // 150-400 words: the main guidance for the narrator AI — the setting in
                              // more depth, what this story is actually about, the player character's
                              // role, how events and NPCs should unfold and pace, and any mechanics or
                              // constraints specific to this world. Refer to the player character as "I"
                              // (e.g. "In this story I am trying to solve a murder."). This is the most
                              // important field — write it as if briefing a co-writer who will narrate
                              // every turn and must stay consistent with it throughout.
  "author_style": string,    // the prose voice to write in — e.g. "a bestselling thriller novelist",
                              // a specific author ("Neil Gaiman"), or a genre ("a writer of children's books")
  "skills": string[],        // 4-6 short skill/attribute names that fit this world and matter for
                              // deciding whether the player's actions succeed (e.g. a fantasy world
                              // might use "Magic" and "Combat"; a Regency drama might use "Wit" and "Standing")
  "playable_characters": [   // 3-4 distinct characters the player can choose to play as
    {
      "name": string,
      "description": string, // background, personality, why they're in this story — this shapes gameplay
      "skills": { [skillName: string]: number }, // one entry per skill above, each rated 1-5
      "initial_tracked_item_values": { [trackedItemName: string]: string | number } // optional —
                             // only include an entry when this character should start differently from
                             // the item's default initial_value below (e.g. a "wealthy" character
                             // starting with more gold than a "poor" one); matching the item names in
                             // tracked_items below; {} if every character starts the same
    }
  ],
  "starting_characters": [   // NPCs the player may encounter, not playable
    {
      "name": string,
      "role": string,
      "detail": string,       // full background, personality, and story role — shown to the narrator
                               // in depth when this NPC has appeared in the last few turns
      "one_liner": string,    // one short sentence reminder — shown instead of "detail" when this NPC
                               // hasn't appeared recently, to keep the prompt small
      "appearance": string,   // physical description
      "location": string      // where this NPC is normally found
    }
  ],
  "starting_scene": string,  // 2-3 sentences describing where the story begins
  "opening_chapter": string, // 200-350 words, second person, in short paragraphs separated by a blank
                              // line (\n\n) so it's easy to read on a phone — the actual first chapter
                              // of play, which should not assume any specific playable character yet,
                              // since the player hasn't chosen one at this point
  "background": string,      // 150-300 words, addressed directly to the player (not the narrator),
                              // shown once in a popup right when a new adventure starts, before the
                              // first real chapter — explains the situation, the stakes, and why the
                              // player character is here, so the story can open in medias res without
                              // spending the opening chapter on setup. Same text every time this world
                              // is played, regardless of which character is chosen.
  "first_action": string,    // a short, fixed first action (e.g. "Knock on the lighthouse door") used
                              // to kick off the real, AI-generated first chapter right after the player
                              // closes the background popup and has chosen a character — written
                              // generically enough to make sense for any of the playable characters above
  "victory_condition": string | null, // a concrete, checkable condition for winning this story
                              // (e.g. "The player character has escaped the maze"), or null if this
                              // kind of open-ended story has no natural win state — don't force one
  "victory_text": string | null,      // shown to the player when they win, matches victory_condition
  "defeat_condition": string | null,  // a concrete, checkable condition for losing, or null
  "defeat_text": string | null,       // shown to the player when they lose, matches defeat_condition
  "tracked_items": [         // 2-5 pieces of evolving state worth tracking beyond simple facts —
                              // inventory, reputation, a countdown, a relationship score, a resource...
                              // don't invent items that won't actually matter for this story
    {
      "name": string,
      "data_type": "text" | "number",
      "description": string,        // what this tracks and why it matters to the story
      "visibility": "player_and_ai" | "ai_only", // ai_only = hidden state the player never sees directly
      "update_automatically": boolean, // false = static reference info that should never change
                                        // (e.g. a character's fixed hidden motive) — true for anything
                                        // that evolves during play (inventory, health, reputation...)
      "update_instructions": string,   // only meaningful when update_automatically is true: a precise
                                        // rule for when/how to update this (e.g. "Add any item the player
                                        // character acquires; remove items used up, lost, or given away.")
      "initial_value": string | number // starting value, matching data_type (e.g. "" or [] as text, or 0)
    }
  ],
  "image_style": string,        // 1 sentence describing the overall visual style/mood for this world's
                                 // illustrations, matching its tone (e.g. "moody painterly illustration,
                                 // desaturated blues and greys, soft directional lighting")
  "image_style_prefix": string, // short comma-separated phrase prepended to every single image prompt
                                 // (e.g. "atmospheric fantasy illustration,") — keep it brief, it's added every time
  "image_style_suffix": string  // short comma-separated phrase appended to every single image prompt
                                 // (e.g. ", muted color palette, dramatic lighting, highly detailed")
}`,
    user: `Player's idea: ${playerIdea}`
  };
}

// Shared context blocks used by buildTurnPrompt (the original single-call
// shape, still used by nothing critical to change) and by the narration/state
// prompt pair below (see buildNarrationPrompt/buildStatePrompt) — factored
// out so both stay in sync instead of drifting copies of the same text.
function buildTurnContextBlocks({ world, memoryFacts, worldLoreFacts, characters, recentTurns, activeCharacter, trackedItems, secretInfo }) {
  const worldBible = `WORLD BIBLE
Title: ${world.title}
Setting: ${world.setting}
Tone: ${world.tone}
Rules: ${(world.rules || []).join('; ')}
SKILLS: ${(world.skills || []).join(', ') || '(none defined)'}
OBJECTIVE: ${world.objective || '(none set — this is an open-ended story)'}`;

  const authorBlock = `AUTHOR INSTRUCTIONS (the most important guidance below — follow it closely)
${world.instructions || '(none given — use the World Bible above as your guide)'}

AUTHOR STYLE: ${world.authorStyle || '(no specific style requested)'}`;

  const characterBlock = activeCharacter
    ? `PLAYER CHARACTER
Name: ${activeCharacter.name}
Description: ${activeCharacter.description}
Skills: ${Object.entries(activeCharacter.skills || {})
        .map(([skill, value]) => `${skill} ${value} (${skillLabel(value)})`)
        .join(', ')}`
    : 'PLAYER CHARACTER\n(none chosen)';

  const conditionLines = [];
  if (world.victoryCondition) conditionLines.push(`VICTORY CONDITION: ${world.victoryCondition}`);
  if (world.defeatCondition) conditionLines.push(`DEFEAT CONDITION: ${world.defeatCondition}`);
  const conditionsBlock = conditionLines.length ? conditionLines.join('\n') : 'VICTORY/DEFEAT CONDITIONS\n(none defined for this world)';

  const itemsBlock = (trackedItems && trackedItems.length)
    ? `TRACKED ITEMS\n${trackedItems.map(i => {
        const flags = [!i.updateAutomatically ? '(static, do not update)' : null, i.visibility === 'ai_only' ? '(hidden from player)' : null]
          .filter(Boolean).join(' ');
        const rule = i.updateAutomatically ? ` | Update rule: ${i.updateInstructions}` : '';
        return `- ${i.name} (${i.dataType}) = ${JSON.stringify(i.value)} ${flags}\n  ${i.description}${rule}`;
      }).join('\n')}`
    : 'TRACKED ITEMS\n(none defined for this world)';

  const factsBlock = memoryFacts.length
    ? `KNOWN FACTS\n${memoryFacts.map(f => `- ${f.fact}`).join('\n')}`
    : 'KNOWN FACTS\n(none yet)';

  // Fixed, never-changing details (a character's exact age, a date, a name)
  // extracted with "type": "biographical" and no specific character — kept
  // separate from KNOWN FACTS above (which is capped to the most recent
  // RELEVANT_FACTS_LIMIT entries, oldest dropped first) precisely so a fixed
  // detail can never be silently evicted by a pile of newer plot
  // developments. See buildStateMasterPrompt's NEW FACTS section.
  const worldLoreBlock = (worldLoreFacts && worldLoreFacts.length)
    ? `WORLD LORE (fixed, never changes — always stay consistent with these)\n${worldLoreFacts.map(f => `- ${f.fact}`).join('\n')}`
    : null;

  // Characters seen in the last few turns get their full sheet; others get
  // only a one-line reminder, to keep the prompt from growing unbounded as
  // the cast of a long story accumulates. A character's own attributed facts
  // (c.facts, set by gameEngine's gatherTurnContext from memoryFacts tagged
  // with this character's name) are appended either way, uncapped and
  // independent of both the recent-turns window and RELEVANT_FACTS_LIMIT —
  // this is what keeps a fact like "Edgar has served 30 years" correct no
  // matter how many turns pass without anyone restating it.
  const recentText = recentTurns.map(t => `${t.playerAction} ${t.chapterText}`).join(' ');
  const charactersBlock = characters.length
    ? `OTHER CHARACTERS\n${characters.map(c => {
        const seenRecently = recentText.includes(c.name);
        const factLines = (c.facts && c.facts.length) ? c.facts.map(f => `  * ${f}`).join('\n') : '';
        if (seenRecently) {
          const details = [c.status, c.appearance ? `Appearance: ${c.appearance}` : null, c.location ? `Usually at: ${c.location}` : null]
            .filter(Boolean).join(' | ');
          return `- ${c.name} (${c.role || 'unknown role'}): ${details}${factLines ? `\n${factLines}` : ''}`;
        }
        return `- ${c.name}: ${c.oneLiner || c.status}${factLines ? `\n${factLines}` : ''}`;
      }).join('\n')}`
    : 'OTHER CHARACTERS\n(none introduced yet)';

  const secretInfoBlock = `SECRET INFO (hidden from the player)\n${secretInfo || '(none tracked yet)'}`;

  const imageStyleBlock = `IMAGE STYLE\n${world.imageStyle || '(none defined — write image_prompt as a plain scene description)'}`;

  const recentBlock = recentTurns.length
    ? `RECENT SCENES (most recent last)\n${recentTurns
        .map(t => `Player: ${t.playerAction}\nNarrator: ${t.chapterText}`)
        .join('\n\n')}`
    : 'RECENT SCENES\n(this is the first turn)';

  return {
    worldBible, authorBlock, characterBlock, conditionsBlock, itemsBlock,
    factsBlock, worldLoreBlock, charactersBlock, secretInfoBlock, imageStyleBlock, recentBlock
  };
}

// ---------------------------------------------------------------------------
// Narration + state split (see TODO.md / CHANGELOG.md "streaming" entry):
// one fast, streamable call that produces just what the player needs to
// start reading (chapter_text + a small META trailer), and a second call —
// using the just-written chapter_text as its input — that computes the
// bookkeeping the player never sees synchronously (tracked items, secret
// info, world-state facts). Kept alongside buildTurnPrompt (unchanged, still
// used by nothing here) rather than replacing it, so the original single-call
// path keeps working exactly as before.
// ---------------------------------------------------------------------------

const NARRATION_END_MARKER = '===META===';

function buildNarrationMasterPrompt({ language, chapterLength, authorMode }) {
  const lengthRange = chapterLengthRange(chapterLength);
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  return `You are the Narrator AI for a choose-your-own-adventure
game. You write immersive, sensory, second-person narrative in the tone and
genre established by the World Bible below. You never break character, never
mention that you are an AI, and never contradict established facts.

RESPONSE LANGUAGE: Write the chapter and "suggested_actions" in ${languageName}.
Keep the META JSON field names in English exactly as specified below.

FORMATTING: Write the chapter as short paragraphs (2-4 sentences each),
separated by a blank line, so it reads easily on a phone screen. Give
dialogue its own line rather than burying it mid-paragraph.
${authorMode ? `
AUTHOR MODE IS ACTIVE FOR THIS TURN: the input below is a direct, out-of-character
instruction from the author to you, the Narrator — not an action taken by the
player character. Follow it directly and narrate its consequences into the
story. Do not run a skill check against it (set "outcome" to "n/a" and
"skill_used" to null) — it isn't something the character attempted, it's a
directive you're carrying out.` : ''}

Respond in EXACTLY this plain-text shape, no other text before or after —
this is not JSON, do not wrap it in one:

===CHAPTER===
<${lengthRange} of narrative, second person, formatted as above>
${NARRATION_END_MARKER}
{
  "outcome": "success" | "partial_success" | "failure" | "n/a", // see SKILL CHECKS below
  "skill_used": string | null,   // the skill from SKILLS this action was checked against, or null
  "game_over": { "result": "victory" | "defeat", "text": string } | null, // see VICTORY/DEFEAT below
  "suggested_actions": string[]  // 3 short, distinct next actions the player could take
}

SKILL CHECKS:
- The player character has numeric skill ratings (1-5, see PLAYER CHARACTER below).
- When the player's action has a real chance of failing (a physical feat, a risky
  social gambit, solving something that requires expertise...), pick the single
  most relevant skill, weigh the character's rating against how hard the attempt
  is given the current scene, and decide the outcome yourself — success, a
  partial/complicated success, or failure. A low rating against a hard attempt
  should fail or go badly more often than not; a high rating against an easy
  attempt should succeed cleanly. Narrate the outcome and its consequences in
  the chapter — do not mention numbers or dice to the player.
- For actions with no real chance of failure (looking around, talking casually,
  moving to an obvious place), set "outcome" to "n/a" and "skill_used" to null —
  do not force a check where none makes sense.

VICTORY/DEFEAT:
- If VICTORY CONDITION and/or DEFEAT CONDITION are given below, judge after
  writing the chapter whether this turn's events have genuinely and clearly
  satisfied one of them.
- Set "game_over" to null on almost every turn — only set it once a
  condition is unambiguously met by what just happened in the fiction, not
  because it seems close or likely soon. Never end the story prematurely.
- When a condition is met, set "game_over" to { "result", "text" }: "result"
  is "victory" or "defeat" matching which condition fired, and "text" is a
  short, satisfying closing message for the player (you may adapt the
  world's own victory/defeat text below, or write your own in the same
  spirit).
- If no conditions are given below, always leave "game_over" as null.

CHARACTER KNOWLEDGE & REALISM:
- Every character (allies, rivals, bystanders, anyone but the player) only
  knows what they personally witnessed, were told, or could obviously infer
  from public information. Never have a character react to, mention, or act
  on: SECRET INFO given below, an action the player took off-screen or out
  of their presence, or anything from a scene they weren't part of.
- When it's unclear whether a character present in the current scene would
  know something, default to them NOT knowing it unless the story has
  already shown them learning it.
- Characters behave like real people, not like plot devices: driven by
  their own personality, self-interest, fears, and relationships. Let them
  refuse, resist, get suspicious, misunderstand, or push back — do not have
  them comply, believe, or help just because it moves the story along.

Rules:
- Stay strictly consistent with the World Bible, the known facts, and character states given below.
- Keep the chapter focused on the immediate scene — do not resolve the whole story in one turn.
- If the player's action is impossible or nonsensical in this world, narrate the attempt and its natural consequence rather than refusing.`;
}

function buildNarrationPrompt({
  world, memoryFacts, worldLoreFacts, characters, recentTurns, playerAction, activeCharacter, trackedItems, secretInfo,
  language, chapterLength, authorMode, authorNote
}) {
  const b = buildTurnContextBlocks({ world, memoryFacts, worldLoreFacts, characters, recentTurns, activeCharacter, trackedItems, secretInfo });

  const user = `${b.worldBible}

${b.authorBlock}

${b.conditionsBlock}

${b.characterBlock}

${b.itemsBlock}

${b.factsBlock}
${b.worldLoreBlock ? `\n${b.worldLoreBlock}\n` : ''}
${b.charactersBlock}

${b.secretInfoBlock}

${b.recentBlock}

${authorNote ? `NARRATOR GUIDANCE FOR THIS TURN (from the author, not visible to the player character — steer the outcome accordingly while still treating the line below as the player's actual action): ${authorNote}\n\n` : ''}${authorMode ? 'AUTHOR INSTRUCTION THIS TURN (out-of-character, follow directly)' : 'PLAYER ACTION THIS TURN'}: ${playerAction}`;

  return { system: buildNarrationMasterPrompt({ language, chapterLength, authorMode }), user };
}

function buildStateMasterPrompt({ language }) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  return `You maintain the hidden bookkeeping for a choose-your-own-adventure
game, from a chapter the Narrator AI already wrote and the player already
read. You do not write narrative — you only extract state changes implied by
what just happened. Respond with ONLY a JSON object, no other text, matching
exactly this shape:

{
  "tracked_item_updates": [{ "name": string, "new_value": string | number }], // see TRACKED ITEMS below
  "secret_info": string,         // the FULL updated hidden-state block — see SECRET INFO below, in ${languageName}
  "state_updates": {
    "location": string | null,        // current location if it changed, else null
    "new_facts": [{ "fact": string, "character": string | null, "type": "biographical" | "plot" }], // see NEW FACTS below
    "characters_changed": [{ "name": string, "change": string }],
    "inventory_changed": string[]     // items gained or lost, described briefly
  },
  "image_prompt": string | null  // short visual description of THIS SCENE ONLY — see IMAGE PROMPTS below
}

NEW FACTS:
- "fact": a short, plain-sentence statement of what's newly true — same as before.
- "character": the exact name of the specific character this fact is about or
  was stated by, matching a name from OTHER CHARACTERS or PLAYER CHARACTER
  below. Use null only when the fact isn't tied to one person (a place, an
  object, a plot development affecting the scene as a whole).
- "type": "biographical" for a concrete, fixed detail that will never change
  once stated — an exact number, a date, a name, a specific quoted promise, a
  piece of backstory. ALWAYS record one of these the moment a character
  states it aloud, even if it doesn't seem important to the plot yet — these
  are exactly the details a later turn is most likely to contradict if they
  aren't captured now (e.g. a character stating how many years they've done
  something, their age, an exact date). Use "plot" for anything describing
  the still-unfolding situation that may be superseded later (suspicions,
  ongoing schemes, emotional states, temporary circumstances).
- Tagging a fact with the right "character" is what keeps it available every
  time that character reappears later in the story, however many turns pass
  without anyone restating it — getting this right matters more than keeping
  the list short. Only use "genuinely new, not already established" as a
  filter for "plot" facts; a "biographical" fact should be recorded even if
  it feels minor, precisely because it's cheap to record and expensive to
  get wrong later.

TRACKED ITEMS:
- TRACKED ITEMS below lists pieces of evolving state (inventory, reputation,
  countdowns, relationship scores...), each with its current value and,
  where it can change, precise update instructions.
- Only include an item in "tracked_item_updates" when its own update
  instructions are genuinely satisfied by what just happened in the chapter —
  most turns will touch zero or one item, rarely more. Give the item's full
  new value (not a delta): e.g. for a text list, the complete updated list as
  one string; for a number, the new number.
- Items marked "(static, do not update)" have no update instructions —
  never include them in "tracked_item_updates", only use them as reference.
- Items marked "(hidden from player)" still update the same way — the
  visibility only affects what the interface shows the player, not how you
  use or update it.

SECRET INFO:
- SECRET INFO below is state the player never sees directly, and that NO
  character knows either unless the chapter has explicitly shown them
  learning it — background plot movement, NPCs' private thoughts or
  motives, time passing, anything useful for staying consistent that
  shouldn't be said outright to the player or attributed to a character
  who has no way of knowing it.
- Return the FULL updated block in "secret_info" every turn (not a diff):
  carry forward whatever is still relevant, drop what's resolved or stale,
  add whatever this chapter's events newly imply. Keep it compact — a
  handful of short lines, not an essay.
- If there's nothing hidden worth tracking yet, an empty string is fine.

IMAGE PROMPTS:
- IMAGE STYLE below (if any) is automatically added around whatever you
  write in "image_prompt" before it reaches the image model — do not repeat
  those style words yourself.
- "image_prompt" should describe only THIS SCENE: who/what is the subject,
  their appearance and expression if a character is present, and the
  setting — concrete and visual, not the mood or art style.
- Set "image_prompt" to null when the scene has nothing worth illustrating
  differently from the last image (e.g. a pure dialogue beat in the same spot).

Rules:
- Only skip a "new_facts" entry as already-known for a "plot" fact restating something already established — see NEW FACTS above for when a "biographical" one should be recorded anyway.
- Base every field only on what the chapter below actually says happened — don't invent state changes it doesn't support.
- In "characters_changed", only attribute a change in knowledge, mood, or motive to a character if the chapter actually shows them witnessing or being told about it — never because the player or the reader now knows it.`;
}

function buildStatePrompt({
  world, characters, worldLoreFacts, activeCharacter, trackedItems, secretInfo, playerAction, chapterText, language
}) {
  const b = buildTurnContextBlocks({
    world, memoryFacts: [], worldLoreFacts, characters, recentTurns: [], activeCharacter, trackedItems, secretInfo
  });

  const user = `${b.worldBible}

${b.characterBlock}

${b.itemsBlock}
${b.worldLoreBlock ? `\n${b.worldLoreBlock}\n` : ''}
${b.charactersBlock}

${b.secretInfoBlock}

${b.imageStyleBlock}

PLAYER ACTION THIS TURN: ${playerAction}

CHAPTER JUST NARRATED (already shown to the player — extract state changes from this)
${chapterText}`;

  return { system: buildStateMasterPrompt({ language }), user };
}

// Splits a narration response ("===CHAPTER===\n<text>\n===META===\n{...}")
// into { chapterText, meta }. Used both to parse the final accumulated text
// and, incrementally, to know when streaming deltas have crossed into the
// META section and should stop being forwarded to the reader.
// outcome/skill_used/game_over/suggested_actions are all things the player
// can live without for a single turn (the badge is debug-only, and losing
// suggested_actions just means they type their next action instead of
// tapping one) — nowhere near as costly as the chapter they were already
// reading live going up in a hard error. So a broken META trailer here
// degrades to these defaults instead of throwing; only a genuinely empty
// chapter (nothing at all to show the player) still throws.
const DEFAULT_NARRATION_META = { outcome: 'n/a', skill_used: null, game_over: null, suggested_actions: [] };

// Finds the first balanced {...} object in text, ignoring braces inside
// string literals. Models asked for "plain text, then a JSON object" often
// still add a trailing pleasantry or note after the closing brace despite
// instructions not to -- a bare JSON.parse on the whole trailing string
// fails on that alone, even though the JSON itself is perfectly well-formed.
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function splitNarrationResponse(raw) {
  const cleaned = raw.trim();
  const markerIndex = cleaned.indexOf(NARRATION_END_MARKER);
  const chapterPart = (markerIndex === -1 ? cleaned : cleaned.slice(0, markerIndex))
    .replace(/^===CHAPTER===\s*/, '')
    .trim();
  if (!chapterPart) {
    throw new Error(`Narration response had no chapter text — got ${cleaned.length} chars total: ...${cleaned.slice(-160)}`);
  }
  if (markerIndex === -1) {
    // The META marker never showed up at all (dropped connection, a model
    // that didn't follow the format, whatever) — the chapter is intact and
    // already what the player has been reading live, so don't lose it.
    return { chapterText: chapterPart, meta: DEFAULT_NARRATION_META };
  }
  const metaRaw = cleaned.slice(markerIndex + NARRATION_END_MARKER.length).trim()
    .replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  let meta = null;
  try {
    meta = JSON.parse(metaRaw);
  } catch (e) {
    const extracted = extractJsonObject(metaRaw);
    if (extracted) {
      try { meta = JSON.parse(extracted); } catch (e2) { meta = null; }
    }
  }
  if (!meta) {
    console.warn(`splitNarrationResponse: META JSON could not be parsed, falling back to defaults (no suggested actions). Raw META: ${metaRaw.slice(0, 300)}`);
    meta = {};
  }
  return { chapterText: chapterPart, meta: { ...DEFAULT_NARRATION_META, ...meta } };
}

// BUG FOUND WHILE ADDING WORLD LORE/per-character facts below: this function
// used to carry its own full copy of every block-building line already in
// buildTurnContextBlocks (word for word identical) instead of calling it --
// real, live duplication, not dead code: playTurn (POST /api/saves/:id/turn,
// the non-streaming path) calls this, so the two prompt paths could silently
// drift, which is exactly what had already started happening (this copy
// never got the CHARACTER KNOWLEDGE & REALISM wording added to the shared
// helper's caller). Refactored to call the shared helper like
// buildNarrationPrompt/buildStatePrompt do, so a future change only needs
// to happen once.
function buildTurnPrompt({
  world, memoryFacts, worldLoreFacts, characters, recentTurns, playerAction, activeCharacter, trackedItems, secretInfo,
  language, chapterLength, authorMode, authorNote
}) {
  const b = buildTurnContextBlocks({ world, memoryFacts, worldLoreFacts, characters, recentTurns, activeCharacter, trackedItems, secretInfo });

  const user = `${b.worldBible}

${b.authorBlock}

${b.conditionsBlock}

${b.characterBlock}

${b.itemsBlock}

${b.factsBlock}
${b.worldLoreBlock ? `\n${b.worldLoreBlock}\n` : ''}
${b.charactersBlock}

${b.secretInfoBlock}

${b.imageStyleBlock}

${b.recentBlock}

${authorNote ? `NARRATOR GUIDANCE FOR THIS TURN (from the author, not visible to the player character — steer the outcome accordingly while still treating the line below as the player's actual action): ${authorNote}\n\n` : ''}${authorMode ? 'AUTHOR INSTRUCTION THIS TURN (out-of-character, follow directly)' : 'PLAYER ACTION THIS TURN'}: ${playerAction}`;

  return { system: buildMasterPrompt({ language, chapterLength, authorMode }), user };
}

// Frames a scene prompt from the narrator with the world's own visual style,
// so illustrations stay coherent turn to turn instead of drifting with
// whatever the narrator happens to write each time.
function buildImagePrompt(world, scenePrompt) {
  if (!scenePrompt) return null;
  // Strip any leading/trailing commas the author (or the world-creation AI)
  // already typed, so joining with ", " never produces doubled punctuation
  // regardless of how prefix/suffix happen to be formatted.
  const clean = s => (s || '').trim().replace(/^,+\s*/, '').replace(/,+\s*$/, '');
  const parts = [clean(world.imageStylePrefix), scenePrompt.trim(), clean(world.imageStyleSuffix)].filter(Boolean);
  return parts.join(', ');
}

// Generates one new playable character to add to an existing world, from a
// short free-text description — used by the "Générer un personnage par IA"
// button in the world editor.
function buildCharacterGenerationPrompt(world, description) {
  return {
    system: `Generate a single playable character for an existing choose-your-own-adventure
world. Respond with ONLY a JSON object, no other text, in this shape:

{
  "name": string,
  "description": string, // background, personality, why they're in this story — this shapes gameplay
  "skills": { [skillName: string]: number } // exactly one entry per skill listed below, each rated 1-5
}`,
    user: `WORLD: ${world.title}
Setting: ${world.setting}
Tone: ${world.tone}
SKILLS: ${(world.skills || []).join(', ')}

Player's description of the character to create: ${description}`
  };
}

// A light-touch edit to an existing world's core fields, driven by a natural
// language request — used by the "Retoucher avec l'IA" button. Deliberately
// scoped to the fields below only: it never touches playable characters,
// tracked items, or the opening chapter, since saves already reference those
// and silently invalidating them would be worse than not editing them here.
function buildWorldAiEditPrompt(world, instruction) {
  const languageName = LANGUAGE_NAMES[world.language] || LANGUAGE_NAMES.fr;
  const editable = {
    title: world.title,
    description: world.description,
    objective: world.objective,
    background: world.background,
    first_action: world.firstAction,
    mature_content: world.mature,
    content_warnings: world.contentWarnings,
    setting: world.setting,
    tone: world.tone,
    rules: world.rules,
    instructions: world.instructions,
    author_style: world.authorStyle,
    skills: world.skills,
    victory_condition: world.victoryCondition,
    victory_text: world.victoryText,
    defeat_condition: world.defeatCondition,
    defeat_text: world.defeatText,
    image_style: world.imageStyle,
    image_style_prefix: world.imageStylePrefix,
    image_style_suffix: world.imageStyleSuffix
  };
  return {
    system: `Apply the requested change to this world. Respond with ONLY a JSON
object, no other text, containing every field from CURRENT WORLD below (unchanged
fields included verbatim) with the requested change applied. Keep the same shape
and field names. Only change what the request actually asks for — leave everything
else exactly as it was. Avoid changing "skills" unless the request specifically
asks to add, remove, or rename a skill, since existing characters are rated
against the current list. Write any changed text fields in ${languageName}, matching
this world's existing language.`,
    user: `CURRENT WORLD\n${JSON.stringify(editable, null, 2)}\n\nREQUESTED CHANGE: ${instruction}`
  };
}

// Runs when a batch of turns is about to age out of the raw recent-turns
// window (see maybeSummarize in gameEngine.js). Beyond the existing prose
// summary, this does a SECOND, deliberately more careful extraction pass
// over the same turns specifically hunting for concrete details the
// per-turn extraction may have missed the first time -- confirmed for real
// that this gap exists: a character stating an exact number in one turn
// went unrecorded, and by the time that turn was several turns back the
// model reconstructed a different, wrong number instead of the one
// actually stated. This pass is the safety net for exactly that: it only
// fires every SUMMARIZE_EVERY turns rather than every turn, so it doesn't
// add per-turn cost, but it gives every batch of turns a second chance
// before the raw text is gone for good.
// BUG FOUND ON A REAL RUN: this prompt never specified a response language
// at all (unlike buildNarrationMasterPrompt/buildStateMasterPrompt, which
// both do), so the summary/missed_facts came back in English even for a
// French story -- confirmed with real Gemini output during a 30-turn test.
// Harmless to the player directly (memoryFacts are never shown to them),
// but it feeds straight back into every later KNOWN FACTS block, so a
// French narration prompt would end up reading an English fact alongside
// its French-language instruction. See CHANGELOG.md.
function buildSummaryPrompt(oldTurns, { characterNames, alreadyKnownFacts, language } = {}) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  const namesHint = (characterNames && characterNames.length)
    ? `\n\nCharacter names in this story so far, for the "character" field below: ${characterNames.join(', ')}.`
    : '';
  const knownHint = (alreadyKnownFacts && alreadyKnownFacts.length)
    ? `\n\nALREADY RECORDED (do not repeat any of these in "missed_facts" — only report what's genuinely missing):\n${alreadyKnownFacts.map(f => `- ${f}`).join('\n')}`
    : '';
  return {
    system: `Summarize the following story turns, then do a careful second
pass over the SAME turns specifically to catch any concrete, checkable
detail a character stated that isn't already recorded — a number, a date,
an exact name, a specific quoted promise, a piece of backstory. This is a
deliberate second read for exactly the kind of detail a first pass tends to
skip because it didn't seem important at the time.${namesHint}

RESPONSE LANGUAGE: Write "summary" and every "fact" string in ${languageName},
matching the language the story itself is written in. Keep the JSON field
names in English exactly as specified below.

Respond with ONLY a JSON object, no other text, in this shape:
{
  "summary": string, // 60-100 words, dense, capturing only what future turns need to stay consistent: key events, decisions, and their consequences
  "missed_facts": [{ "fact": string, "character": string | null, "type": "biographical" | "plot" }]
  // "character": who this fact is about (an exact name from the list above), or null if it isn't tied to one person.
  // "type": "biographical" for a fixed detail that will never change, "plot" for still-evolving state.
  // Empty array if this batch of turns has nothing worth adding beyond what's already recorded.
}`,
    user: `${oldTurns.map(t => `Player: ${t.playerAction}\nNarrator: ${t.chapterText}`).join('\n\n')}${knownHint}`
  };
}

module.exports = {
  buildWorldCreationPrompt, buildTurnPrompt, buildSummaryPrompt, buildImagePrompt,
  buildCharacterGenerationPrompt, buildWorldAiEditPrompt, buildMasterPrompt, skillLabel,
  buildNarrationPrompt, buildStatePrompt, splitNarrationResponse, NARRATION_END_MARKER
};
