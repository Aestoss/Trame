const fetch = require('node-fetch');

// Each provider function has the same signature: ({ system, user, apiKey, model })
// -> Promise<{ text, usage: { inputTokens, outputTokens } }>. `text` is expected
// to be raw JSON per the prompt's instructions. `usage` feeds the cost tracker
// (lib/costTracker.js) — zero counts when a provider genuinely has none to report.

// Attaches the HTTP status to the thrown error so generateText() can tell a
// transient overload (429/5xx — worth retrying) from a permanent failure
// (bad key, bad request — retrying would just fail the same way again).
async function throwApiError(providerName, res) {
  const err = new Error(`${providerName} API error ${res.status}: ${await res.text()}`);
  err.status = res.status;
  throw err;
}

// Yields each SSE "data:" payload (trimmed) from a Node.js readable stream —
// Anthropic, OpenAI, OpenRouter, Gemini (with alt=sse) and Ollama's
// OpenAI-compatible endpoint all frame their streaming responses this way,
// so every streamX() function below reuses this instead of its own parser.
// Buffers across chunk boundaries since a "data: ..." line can arrive split
// across two network packets.
async function* sseDataLines(nodeStream) {
  let buffer = '';
  for await (const chunk of nodeStream) {
    buffer += chunk.toString('utf8');
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

async function callAnthropic({ system, user, apiKey, model }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      // Anthropic requires max_tokens explicitly (unlike OpenAI/Gemini,
      // which default generously on their own). 1024 was too small once
      // the full turn JSON (chapter_text + outcome + tracked_item_updates +
      // secret_info + state_updates + image_prompt + suggested_actions) or
      // the world-creation schema (much bigger) is accounted for — Claude
      // would hit the cap mid-response and get cut off before the closing
      // brace, so parseModelJSON's JSON.parse failed on truncated input.
      // BUG FOUND ON A REAL RUN: 8192 turned out too small again, for a
      // different reason -- current-generation Claude models (Sonnet 5,
      // Opus 5, etc.) run extended "adaptive" thinking ON BY DEFAULT
      // whenever the `thinking` param is omitted, and thinking tokens count
      // against this same max_tokens ceiling. On a genuinely creative task
      // like world creation, thinking alone consumed the entire 8192-token
      // budget before any visible JSON text ever started, so the returned
      // text was 0 chars and parseModelJSON's "truncated" error fired even
      // though the request itself succeeded (confirmed in production logs).
      // Not fixed by tuning `thinking`/`output_config.effort` here: the
      // model field is free text (any Claude version, including older ones
      // with a different thinking API), so raising the ceiling is the one
      // fix that stays correct regardless of which model is configured.
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) await throwApiError('Anthropic', res);
  const data = await res.json();
  const text = data.content.map(b => b.text || '').join('');
  // Same real failure mode as streamAnthropic (see its comment): max_tokens
  // hit with zero visible text, almost certainly all spent on this model's
  // default-on extended thinking. Surfaced directly here instead of the
  // generic "truncated JSON" error parseModelJSON would throw on empty input.
  if (!text && data.stop_reason === 'max_tokens') {
    throw new Error('Anthropic hit max_tokens with no visible text generated -- likely spent the whole budget on extended thinking before writing any output. Try again, or raise max_tokens further if this keeps happening.');
  }
  return {
    text,
    usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 }
  };
}

// BUG FOUND ON A REAL RUN (confirmed in production logs, world creation
// with claude-sonnet-5): this streamed path IS exercised for real — it's
// what createWorld uses for progress reporting — and it returned 0 chars
// of text, tripping parseModelJSON's "truncated" error even though the
// HTTP request itself succeeded. Cause: current-generation Claude models
// run extended "adaptive" thinking ON BY DEFAULT when `thinking` is
// omitted, and thinking tokens count against the same max_tokens ceiling
// — on a creative, schema-heavy task like world creation, thinking alone
// consumed the entire budget before any text_delta ever arrived. The
// model field here is free text (any Claude version a user types in,
// including older ones with a different thinking API), so raising the
// ceiling — rather than tuning `thinking`/`output_config.effort`, which
// aren't safe to send unconditionally across arbitrary model versions —
// is the fix that stays correct regardless of which model is configured.
async function streamAnthropic({ system, user, apiKey, model, onDelta }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: 32000, system, messages: [{ role: 'user', content: user }], stream: true })
  });
  if (!res.ok) await throwApiError('Anthropic', res);
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = null;
  for await (const payload of sseDataLines(res.body)) {
    let data;
    try { data = JSON.parse(payload); } catch (e) { continue; }
    if (data.type === 'content_block_delta' && data.delta?.text) {
      text += data.delta.text;
      onDelta(data.delta.text);
    } else if (data.type === 'message_start' && data.message?.usage) {
      usage.inputTokens = data.message.usage.input_tokens || 0;
    } else if (data.type === 'message_delta' && data.usage) {
      usage.outputTokens = data.usage.output_tokens || 0;
      if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
    }
  }
  // A real, previously-misdiagnosed failure mode (see the comment above
  // this function): max_tokens hit with genuinely zero text -- almost
  // certainly the whole budget spent on this model's default-on extended
  // thinking before any visible output started. Surfacing this here gives
  // a direct diagnosis instead of the generic "truncated JSON" error the
  // caller's parseModelJSON would otherwise throw on an empty string.
  if (!text && stopReason === 'max_tokens') {
    throw new Error('Anthropic hit max_tokens with no visible text generated -- likely spent the whole budget on extended thinking before writing any output. Try again, or raise max_tokens further if this keeps happening.');
  }
  return { text, usage };
}

async function callOpenAI({ system, user, apiKey, model }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) await throwApiError('OpenAI', res);
  const data = await res.json();
  return {
    text: data.choices[0].message.content,
    usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 }
  };
}

// NOTE: implemented from OpenAI's documented chat.completion.chunk streaming
// shape, but not exercised against a real OpenAI key in this session (only
// Gemini and the mock provider were) — same fallback caveat as streamAnthropic.
async function streamOpenAI({ system, user, apiKey, model, onDelta }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || 'gpt-4o', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: true, stream_options: { include_usage: true } })
  });
  if (!res.ok) await throwApiError('OpenAI', res);
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  for await (const payload of sseDataLines(res.body)) {
    if (payload === '[DONE]') break;
    let data;
    try { data = JSON.parse(payload); } catch (e) { continue; }
    const delta = data.choices?.[0]?.delta?.content;
    if (delta) { text += delta; onDelta(delta); }
    if (data.usage) {
      usage = { inputTokens: data.usage.prompt_tokens || 0, outputTokens: data.usage.completion_tokens || 0 };
    }
  }
  return { text, usage };
}

async function callOpenRouter({ system, user, apiKey, model }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'anthropic/claude-sonnet-4.6',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) await throwApiError('OpenRouter', res);
  const data = await res.json();
  return {
    text: data.choices[0].message.content,
    usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 }
  };
}

// OpenRouter proxies the OpenAI chat-completions shape, streaming included —
// same caveat as streamOpenAI/streamAnthropic, not exercised against a real
// OpenRouter key in this session.
async function streamOpenRouter({ system, user, apiKey, model, onDelta }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || 'anthropic/claude-sonnet-4.6', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: true })
  });
  if (!res.ok) await throwApiError('OpenRouter', res);
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  for await (const payload of sseDataLines(res.body)) {
    if (payload === '[DONE]') break;
    let data;
    try { data = JSON.parse(payload); } catch (e) { continue; }
    const delta = data.choices?.[0]?.delta?.content;
    if (delta) { text += delta; onDelta(delta); }
    if (data.usage) {
      usage = { inputTokens: data.usage.prompt_tokens || 0, outputTokens: data.usage.completion_tokens || 0 };
    }
  }
  return { text, usage };
}

async function callGemini({ system, user, apiKey, model }) {
  const m = model || 'gemini-3.6-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }]
      })
    }
  );
  if (!res.ok) await throwApiError('Gemini', res);
  const data = await res.json();
  return {
    text: (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''),
    usage: { inputTokens: data.usageMetadata?.promptTokenCount || 0, outputTokens: data.usageMetadata?.candidatesTokenCount || 0 }
  };
}

// Verified against the real Gemini API (streamGenerateContent?alt=sse) during
// development: parts occasionally carry a `thoughtSignature` with no `text`
// (an internal-reasoning artifact of "thinking" models) — skip those, only
// forward parts that actually have text. usageMetadata is cumulative on every
// chunk, so the last one seen wins rather than summing.
async function streamGemini({ system, user, apiKey, model, onDelta }) {
  const m = model || 'gemini-3.6-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }] })
    }
  );
  if (!res.ok) await throwApiError('Gemini', res);
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  for await (const payload of sseDataLines(res.body)) {
    let data;
    try { data = JSON.parse(payload); } catch (e) { continue; }
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.text) { text += part.text; onDelta(part.text); }
    }
    if (data.usageMetadata) {
      usage = { inputTokens: data.usageMetadata.promptTokenCount || 0, outputTokens: data.usageMetadata.candidatesTokenCount || 0 };
    }
  }
  return { text, usage };
}

// Neither num_ctx (context window) nor max_tokens/num_predict (output cap)
// were ever sent before -- left Ollama on whatever its own defaults are
// (historically a small context, e.g. 2048-4096 tokens depending on version/
// model, unless the Modelfile itself overrides it), silently truncating the
// model's response once the system+user prompt plus however much it had
// already written filled that window.
//
// BUG FOUND ON A REAL RUN: num_ctx was originally set to 8192 on the (wrong)
// assumption that a single Fogbound turn prompt "comfortably" fits under it.
// Confirmed false in production: a real, established world (deep WORLD LORE
// + memoryFacts + RECENT_TURNS_WINDOW of raw turn text) routinely pushes the
// prompt itself past 6-7k tokens, leaving too little of the 8192 total for
// the model to finish the chapter AND the JSON metadata trailer -- visible
// on the PC side as the model loading and running at 100% but never
// returning (it's still generating right up to the wall), and on the
// server as parseModelJSON's generic "truncated before valid JSON
// completed" a few thousand characters in. Same failure class as the
// Anthropic max_tokens incident (see callAnthropic) -- an unverified
// assumption about how much a turn needs, wrong once a save gets deep
// enough.
//
// First fix raised this to 32768, which stopped the truncation but traded
// it for a worse problem on a real run: the request never came back within
// the client's patience at all (mobile browser gave up after ~68s with no
// response). The likely cause is VRAM, not the app -- if a GPU can't hold
// the model's weights plus a KV cache this large, Ollama silently spills
// part of it to CPU RAM, and CPU-offloaded inference is dramatically
// slower. 16384 is a middle ground: comfortably above the ~7-7.7k-token
// prompt size the truncation sizes implied (1871-4364 chars generated
// before hitting the old 8192 ceiling), while needing much less KV-cache
// VRAM than 32768 -- likely enough to stay fully on GPU on the same
// hardware that ran fine at 8192.
const OLLAMA_GENERATION_OPTIONS = { max_tokens: 8192, options: { num_ctx: 16384 } };

// Ollama exposes an OpenAI-compatible endpoint (/v1/chat/completions) which is
// far more stable to target than its native API shape — same request/response
// contract as callOpenAI, just against a local (or tunneled) baseUrl instead
// of a fixed hostname, and with no key required by default.
async function callOllama({ system, user, apiKey, model, baseUrl }) {
  const url = `${(baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model: model || 'llama3.1',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      ...OLLAMA_GENERATION_OPTIONS
    })
  });
  if (!res.ok) await throwApiError('Ollama', res);
  const data = await res.json();
  if (data.choices[0].finish_reason === 'length') {
    throw new Error(`Ollama hit the context/output limit (num_ctx: ${OLLAMA_GENERATION_OPTIONS.options.num_ctx}) before finishing -- the response is incomplete. This save's prompt may have grown past what even a raised limit covers, or the model itself was built with a smaller max context than requested.`);
  }
  return {
    text: data.choices[0].message.content,
    usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 }
  };
}

// Ollama's OpenAI-compatible endpoint mirrors OpenAI's own streaming chunk
// shape when stream:true is set — same pattern as streamOpenAI. Not
// exercised against a real Ollama instance in this session (no such
// environment available here), only Gemini and the mock provider were.
async function streamOllama({ system, user, apiKey, model, baseUrl, onDelta }) {
  const url = `${(baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model: model || 'llama3.1',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: true,
      ...OLLAMA_GENERATION_OPTIONS
    })
  });
  if (!res.ok) await throwApiError('Ollama', res);
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  let finishReason = null;
  for await (const payload of sseDataLines(res.body)) {
    if (payload === '[DONE]') break;
    let data;
    try { data = JSON.parse(payload); } catch (e) { continue; }
    const delta = data.choices?.[0]?.delta?.content;
    if (delta) { text += delta; onDelta(delta); }
    if (data.choices?.[0]?.finish_reason) finishReason = data.choices[0].finish_reason;
    if (data.usage) {
      usage = { inputTokens: data.usage.prompt_tokens || 0, outputTokens: data.usage.completion_tokens || 0 };
    }
  }
  if (finishReason === 'length') {
    throw new Error(`Ollama hit the context/output limit (num_ctx: ${OLLAMA_GENERATION_OPTIONS.options.num_ctx}) before finishing -- the response is incomplete. This save's prompt may have grown past what even a raised limit covers, or the model itself was built with a smaller max context than requested.`);
  }
  return { text, usage };
}

// Lists models already pulled on the Ollama instance, via the same
// OpenAI-compatible surface as callOllama — feeds the Settings model
// dropdown so it reflects what's actually installed instead of a fixed list.
async function listOllamaModels({ apiKey, baseUrl }) {
  const url = `${(baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/v1/models`;
  const res = await fetch(url, {
    headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    timeout: 5000
  });
  if (!res.ok) await throwApiError('Ollama', res);
  const data = await res.json();
  return (data.data || []).map(m => m.id);
}

// Reads the bridge's own /bridge/status route (served by the watcher script
// on the PC, not by Ollama itself — see scripts/windows) to tell apart
// "offline" (nothing answers) from "busy" (GPU under heavy load — another
// game, or a generation already in flight) from "available". Deliberately
// short-timeout and never throws: this backs a status indicator that's
// polled every few seconds, not a request that should ever hang the caller.
async function getOllamaBridgeStatus({ apiKey, baseUrl }) {
  const url = `${(baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/bridge/status`;
  try {
    const res = await fetch(url, {
      headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      timeout: 3000
    });
    if (!res.ok) return { state: 'offline' };
    const data = await res.json();
    // `state` is derived from `busy` here rather than trusted from the
    // watcher's own payload, so this stays correct even if that shape drifts.
    return { ...data, state: data.busy ? 'busy' : 'available' };
  } catch (e) {
    return { state: 'offline' };
  }
}

// Deterministic fake provider — no network, no key required. Used for local
// testing and as a safe default so the app never fails with "no key set".
async function callMock({ system, user }) {
  const noUsage = { inputTokens: 0, outputTokens: 0 };
  const isSummary = /Summarize the following story turns/.test(system || '');
  if (isSummary) {
    return {
      usage: noUsage,
      text: JSON.stringify({
        summary: 'The traveler arrived at the lighthouse and began exploring its fog-wrapped steps, with the Keeper watching cautiously from the doorway.',
        missed_facts: []
      })
    };
  }
  const isCharacterGen = /Generate a single playable character/.test(system || '');
  if (isCharacterGen) {
    return {
      text: JSON.stringify({
        name: 'Mira Fenwick',
        description: 'A quietly stubborn ex-sailor who talks to gulls more than people.',
        skills: { Intuition: 3, Nerve: 4, Charm: 2, Lore: 3 }
      }),
      usage: noUsage
    };
  }
  const isWorldAiEdit = /Apply the requested change to this world/.test(system || '');
  if (isWorldAiEdit) {
    const currentMatch = user.match(/CURRENT WORLD\n([\s\S]*?)\n\nREQUESTED CHANGE/);
    const current = currentMatch ? JSON.parse(currentMatch[1]) : {};
    return { text: JSON.stringify({ ...current, tone: `${current.tone || ''} (retouché)`.trim() }), usage: noUsage };
  }
  const isWorldCreation = /Player's idea:/.test(user);
  if (isWorldCreation) {
    return {
      usage: noUsage,
      text: JSON.stringify({
        title: 'The Glass Lighthouse',
        description: 'A shipwrecked stranger arrives at a lighthouse city built from sea-glass, where the fog hides more than weather.',
        objective: 'Find out what Keeper Oduya is hiding, and why the fog answers to her.',
        character_select_text: 'Two strangers washed up on the same shore. Only one story gets told.',
        mature_content: false,
        content_warnings: [],
        setting: 'A lighthouse city built from sea-glass, perched above a fogbound coast.',
        tone: 'quiet mystery',
        rules: ['The fog hides more than weather', 'Glass remembers what it reflects'],
        instructions: 'This story takes place in a lighthouse city built from sea-glass. I have just arrived, unannounced but expected by the reclusive Keeper Oduya. The fog surrounding the city is not ordinary weather — things glimpsed in it are sometimes true and sometimes not, and the city\'s glass architecture seems to remember what has happened near it. Pace the story slowly at first, letting me explore the lighthouse and earn or lose the Keeper\'s trust before revealing what the fog actually is.',
        author_style: 'a literary novelist writing quiet, atmospheric mystery — spare prose, precise sensory detail, understatement over spectacle',
        skills: ['Intuition', 'Nerve', 'Charm', 'Lore'],
        playable_characters: [
          {
            name: 'Wren Ashby',
            description: 'A shipwrecked cartographer with a sharp eye for detail and a fear of deep water.',
            skills: { Intuition: 4, Nerve: 2, Charm: 3, Lore: 3 },
            initial_tracked_item_values: {}
          },
          {
            name: 'Corvin Blackwell',
            description: 'A disgraced glass-smith who insists the fog once spoke to him.',
            skills: { Intuition: 3, Nerve: 3, Charm: 2, Lore: 5 },
            initial_tracked_item_values: { 'Keeper Trust': 7 }
          }
        ],
        starting_characters: [{
          name: 'Keeper Oduya',
          role: 'lighthouse keeper',
          detail: 'Guarded, watchful, knows more than she says. Has tended the lighthouse for eleven years and has never once let the lens go dark.',
          one_liner: 'The wary keeper of the lighthouse, who knows more about the fog than she lets on.',
          appearance: 'Tall, weathered, silver-streaked hair kept in a tight braid, a long oilskin coat.',
          location: 'The lighthouse doorway, most evenings'
        }],
        starting_scene: 'You arrive at the lighthouse steps as the evening fog rolls in.',
        opening_chapter: 'The fog reaches the steps before you do, curling around your ankles like something curious. Keeper Oduya watches from the doorway, lantern unlit. "You\'re early," she says, though you were told nothing about a schedule.',
        background: 'You were not meant to find this coastline. A storm took your ship two nights ago, and the only lights you have seen since belong to a lighthouse city built from sea-glass, wrapped in a fog that never quite lifts. You do not know Keeper Oduya, but somehow she was expecting you — and the fog itself seems to lean toward you, as if listening for something you have not said yet. Whatever brought you here, it is not finished with you.',
        first_action: 'Approach the lighthouse and knock.',
        victory_condition: 'The player character has found the source of the fog and chosen what to do with it.',
        victory_text: 'You understand the fog now — and it understands you. Whatever you choose next, the lighthouse will remember.',
        defeat_condition: 'The player character is lost in the fog with no way back to the lighthouse.',
        defeat_text: 'The fog closes in, and this time it does not let go. Your story ends here, somewhere in the grey.',
        image_style: 'Moody painterly illustration, desaturated blues and greys, soft directional lighting.',
        image_style_prefix: 'atmospheric painterly illustration,',
        image_style_suffix: ', desaturated cold palette, soft lighting, fog, highly detailed',
        tracked_items: [
          {
            name: 'Inventory', data_type: 'text', visibility: 'player_and_ai', update_automatically: true,
            description: 'Items currently carried.', update_instructions: 'Add any item gained; remove items lost or used.',
            initial_value: '(empty-handed)'
          },
          {
            name: 'Keeper Trust', data_type: 'number', visibility: 'player_and_ai', update_automatically: true,
            description: "How much Keeper Oduya trusts the player, 0-10.", update_instructions: 'Increase for honest, helpful actions; decrease for deception or threats.',
            initial_value: 5
          },
          {
            name: "Keeper's Secret", data_type: 'text', visibility: 'ai_only', update_automatically: false,
            description: 'What the Keeper is actually hiding — for narrator reference only, never revealed directly.',
            update_instructions: '', initial_value: 'She lit the lantern to warn smugglers, not travelers.'
          }
        ]
      })
    };
  }

  // Test hooks so the win/loss wiring can be exercised end-to-end without a
  // real API key: a real model would judge this from context, but the mock
  // is deterministic and doesn't read the story, so it keys off the action text.
  const actionMatch = user.match(/(?:PLAYER ACTION THIS TURN|AUTHOR INSTRUCTION THIS TURN[^:]*): (.*)/);
  const action = (actionMatch && actionMatch[1]) || '';

  // Narration/state split (see lib/promptBuilder.js buildNarrationPrompt/
  // buildStatePrompt) — detected by their distinctive system-prompt markers
  // so the mock produces the matching shape instead of falling into the
  // single-call hooks below, which would return the old, incompatible shape.
  const isNarration = /===CHAPTER===/.test(system || '');
  const isState = /You maintain the hidden bookkeeping/.test(system || '');

  if (isNarration) {
    if (/\bwin\b/i.test(action)) {
      return { usage: noUsage, text: '===CHAPTER===\nThe fog parts at last, and you see clearly what it was hiding — and what to do about it.\n===META===\n' + JSON.stringify({ outcome: 'success', skill_used: null, game_over: { result: 'victory', text: null }, suggested_actions: [] }) };
    }
    if (/\blose\b/i.test(action)) {
      return { usage: noUsage, text: '===CHAPTER===\nThe fog thickens until you can no longer tell which way leads back to the light.\n===META===\n' + JSON.stringify({ outcome: 'failure', skill_used: null, game_over: { result: 'defeat', text: null }, suggested_actions: [] }) };
    }
    if (/\btake the lantern\b/i.test(action)) {
      return { usage: noUsage, text: '===CHAPTER===\nYou lift the lantern from its hook. Keeper Oduya says nothing, but her eyes follow it.\n===META===\n' + JSON.stringify({ outcome: 'success', skill_used: null, game_over: null, suggested_actions: ['Ask why she\'s watching you', 'Light the lantern', 'Put it back'] }) };
    }
    return {
      usage: noUsage,
      text: '===CHAPTER===\nYou step forward, and the fog seems to lean in around you, as if listening. Somewhere above, the lighthouse lens turns without a keeper\'s hand.\n===META===\n' +
        JSON.stringify({ outcome: 'n/a', skill_used: null, game_over: null, suggested_actions: ['Call out to the Keeper', 'Climb the steps', 'Look for another way in'] })
    };
  }

  if (isState) {
    const tookLantern = /take the lantern/i.test(user);
    return {
      usage: noUsage,
      text: JSON.stringify({
        tracked_item_updates: tookLantern ? [{ name: 'Inventory', new_value: 'a small brass lantern' }, { name: 'Keeper Trust', new_value: 4 }] : [],
        secret_info: tookLantern ? 'Keeper Oduya left the lantern out on purpose, to see who would take it.' : '',
        state_updates: {
          location: 'Lighthouse steps',
          // Exercises the { fact, character, type } shape (see
          // buildStateMasterPrompt's NEW FACTS section) rather than only ever
          // sending an empty array — otherwise the mock provider would never
          // catch a regression in how gameEngine.js stores/renders these.
          new_facts: tookLantern ? [{ fact: 'Keeper Oduya has tended the lighthouse for eleven years.', character: 'Keeper Oduya', type: 'biographical' }] : [],
          characters_changed: [],
          inventory_changed: tookLantern ? ['+ brass lantern'] : []
        },
        image_prompt: 'A foggy lighthouse at dusk, glass architecture, a lone figure on stone steps'
      })
    };
  }
  if (/\bwin\b/i.test(action)) {
    return {
      usage: noUsage,
      text: JSON.stringify({
        chapter_text: 'The fog parts at last, and you see clearly what it was hiding — and what to do about it.',
        outcome: 'success',
        skill_used: null,
        game_over: { result: 'victory', text: null },
        tracked_item_updates: [],
        secret_info: '',
        state_updates: { location: null, new_facts: [], characters_changed: [], inventory_changed: [] },
        image_prompt: null,
        suggested_actions: []
      })
    };
  }
  if (/\blose\b/i.test(action)) {
    return {
      usage: noUsage,
      text: JSON.stringify({
        chapter_text: 'The fog thickens until you can no longer tell which way leads back to the light.',
        outcome: 'failure',
        skill_used: null,
        game_over: { result: 'defeat', text: null },
        tracked_item_updates: [],
        secret_info: '',
        state_updates: { location: null, new_facts: [], characters_changed: [], inventory_changed: [] },
        image_prompt: null,
        suggested_actions: []
      })
    };
  }
  if (/\btake the lantern\b/i.test(action)) {
    return {
      usage: noUsage,
      text: JSON.stringify({
        chapter_text: 'You lift the lantern from its hook. Keeper Oduya says nothing, but her eyes follow it.',
        outcome: 'success',
        skill_used: null,
        game_over: null,
        tracked_item_updates: [{ name: 'Inventory', new_value: 'a small brass lantern' }, { name: 'Keeper Trust', new_value: 4 }],
        secret_info: 'Keeper Oduya left the lantern out on purpose, to see who would take it.',
        state_updates: { location: null, new_facts: [], characters_changed: [], inventory_changed: ['+ brass lantern'] },
        image_prompt: null,
        suggested_actions: ['Ask why she\'s watching you', 'Light the lantern', 'Put it back']
      })
    };
  }

  return {
    usage: noUsage,
    text: JSON.stringify({
      chapter_text: 'You step forward, and the fog seems to lean in around you, as if listening. Somewhere above, the lighthouse lens turns without a keeper\'s hand.',
      outcome: 'n/a',
      skill_used: null,
      game_over: null,
      tracked_item_updates: [],
      secret_info: '',
      state_updates: { location: 'Lighthouse steps', new_facts: [], characters_changed: [], inventory_changed: [] },
      image_prompt: 'A foggy lighthouse at dusk, glass architecture, a lone figure on stone steps',
      suggested_actions: ['Call out to the Keeper', 'Climb the steps', 'Look for another way in']
    })
  };
}

// Chunks the mock's own (deterministic) output word by word so local/offline
// testing exercises the same progressive-rendering code path a real
// streaming provider would, without needing any network access or key.
async function streamMock({ system, user, onDelta }) {
  const { text, usage } = await callMock({ system, user });
  const words = text.split(/(?<=\s)/); // keep each word's trailing whitespace attached
  for (const w of words) {
    onDelta(w);
    await sleep(15);
  }
  return { text, usage };
}

const providers = { anthropic: callAnthropic, openai: callOpenAI, openrouter: callOpenRouter, gemini: callGemini, ollama: callOllama, mock: callMock };
const streamProviders = { anthropic: streamAnthropic, openai: streamOpenAI, openrouter: streamOpenRouter, gemini: streamGemini, ollama: streamOllama, mock: streamMock };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 429 (rate limited) and 5xx (server-side/overload, e.g. the "high demand"
// 503 Gemini returns) are worth a short automatic retry — the same request
// often succeeds moments later. A handful of specific network-level error
// codes (connection reset/refused/timed out, DNS hiccup) are the same kind
// of transient condition. Anything else — a bad key, a bad request, or a
// bug in our own code throwing mid-call — would just fail identically
// again (or isn't network-related at all), so it's deliberately NOT
// retried: silently retrying an arbitrary error for ~25s (3 attempts) would
// only hide what actually broke behind a long, unexplained delay.
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE']);
function isRetryable(err) {
  if (typeof err.status === 'number') return err.status === 429 || (err.status >= 500 && err.status < 600);
  return RETRYABLE_NETWORK_CODES.has(err.code);
}

const RETRY_DELAYS_MS = [1000, 2500]; // up to 2 retries (3 attempts total)

async function generateText({ provider, system, user, apiKey, model, baseUrl }) {
  const fn = providers[provider] || providers.mock;
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn({ system, user, apiKey, model, baseUrl });
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || attempt === RETRY_DELAYS_MS.length) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError; // unreachable, but keeps the return type honest
}

// Same retry policy as generateText, but only up to the first delta actually
// delivered to the caller — once streaming has started, retrying would mean
// either duplicating or discarding text the reader may already be seeing, so
// a mid-stream failure is simply propagated instead.
async function streamText({ provider, system, user, apiKey, model, baseUrl, onDelta }) {
  const fn = streamProviders[provider] || streamMock;
  let firstChunkReceived = false;
  const wrappedOnDelta = (chunk) => { firstChunkReceived = true; onDelta(chunk); };
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn({ system, user, apiKey, model, baseUrl, onDelta: wrappedOnDelta });
    } catch (e) {
      lastError = e;
      if (firstChunkReceived || !isRetryable(e) || attempt === RETRY_DELAYS_MS.length) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError; // unreachable, but keeps the return type honest
}

module.exports = { generateText, streamText, listOllamaModels, getOllamaBridgeStatus };
