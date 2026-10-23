/**
 * A deterministic stand-in for an OpenAI-compatible model server (what the `local` provider talks to).
 * It recognises each AI role by its system prompt and answers with valid, predictable output, so the
 * end-to-end flow tests every feature without a GPU, an API key or flaky prose.
 * Every request is recorded in `calls` so tests can assert which roles ran.
 */
import http from 'node:http';

const DRAFT = [
  'The four-way stop sat where the port road met the coast road, a square of wet tarmac under one amber light. Mara waited slowly and carefully at the white line.',
  '"We should not be here," Jonah said quietly, glancing nervously over his shoulder at the gate.',
  '"I know," Mara said softly. "We will leave very soon." She looked at the the ledger on the seat and did not touch it.',
  'The van came across from the right, white and square-backed, its headlamps still on against the grey. It had the road. It did not need to slow.',
  'She stayed until the ambulance came, and the ledger was still on the seat when she got back to the car.',
].join('\n\n');

const ids = (text) => [...new Set(text.match(/\[(c_[a-z0-9]+)\]/g)?.map((m) => m.slice(1, -1)) ?? [])];
const lastUser = (messages) => [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

/** Returns the reply text for one chat-completions request. */
export function answer(system, messages) {
  const user = messages.map((m) => m.content).join('\n');
  const last = lastUser(messages);
  const json = (v) => JSON.stringify(v);
  // Order matters: more specific prompts first.
  if (system.startsWith('You are the studio agent')) {
    if (last.startsWith('RESULT of')) return json({ thought: 'done', actions: [], reply: 'The book has its cast and scenes; nothing needed changing.', done: true });
    return json({ thought: 'look at the book first', actions: [{ tool: 'bible', args: {} }], reply: 'Reading the book…', done: false });
  }
  if (system.startsWith('You compare AI drafts')) return json({ rules: [
    { text: 'Drop the dialogue tag when the speaker is clear', evidence: '"We should not be here," Jonah said quietly -> "We should not be here."' },
    { text: 'Open scenes on a noun fragment', evidence: 'The four-way stop sat where... -> Four-way stop.' },
  ] });
  if (system.startsWith('You study samples')) return 'Short declarative sentences. Fragments for setting. Dialogue mostly untagged. No adverbs.';
  if (system.startsWith('You are drafting one scene')) return DRAFT;
  if (system.startsWith('You are a line editor')) return `${last.split('PASSAGE:\n')[1] ?? last}`.replace(/slowly and carefully /, '').trim();
  if (system.startsWith('You ARE this person')) {
    if (/greyhaven/i.test(last)) return 'Greyhaven? I have heard the name. They say the harbour there never sleeps.';
    return 'Not yet. Ask me again when the boats are back.';
  }
  if (system.startsWith('You extract DURABLE facts')) return json({ facts: [
    { subject: 'mara', predicate: 'owns', object: 'the ledger', text: 'Mara keeps the ledger on the passenger seat', single: false },
    { subject: 'jonah', predicate: 'relationship to mara', object: 'brother', text: 'Jonah is Mara\'s brother', single: true },
  ] });
  if (system.startsWith('You summarise a scene')) return json({ summary: 'Stopped at the four-way stop and stayed with the injured driver.', learned: ['the van driver was trapped'], feeling: 'shaken but steady' });
  if (system.startsWith('You are a muse')) {
    const cs = ids(user);
    return json({ ideas: [
      { kind: 'complication', idea: 'The ledger goes missing while Mara is with the driver.', growsFrom: 'Mara\'s private ledger', characters: cs.slice(0, 1) },
      { kind: 'character-beat', idea: 'Jonah pretends not to recognise the van.', growsFrom: 'Jonah\'s secret', characters: cs.slice(1, 2) },
      { kind: 'dialogue', idea: '"You counted the boats again." "Someone has to."', growsFrom: 'Mara\'s habit of counting', characters: cs },
    ] });
  }
  if (system.startsWith('You are a proofreader')) return json({ issues: [{ original: 'the the', fix: 'the', reason: 'repeated word' }] });
  if (system.startsWith('You design original characters')) return json({
    name: 'Constance Harrow', role: 'lighthouse keeper', summary: 'Keeper of the Scarrow Point light; stopped every clock in 1987.', want: 'to see the Harbour Board answer for her brother', need: 'to let the light go out', wound: 'her brother drowned on a night she let the lamp fail', arc: 'from frozen grief to release',
    voiceSample: 'Sit where the lamp can see your face. I have never trusted a man in shadow.', secrets: ['she was paid to let the lamp fail'],
    traits: [{ key: 'habit', value: 'winds a stopped clock every evening' }, { key: 'fear', value: 'silence after a storm' }],
  });
  if (system.startsWith('You build a full psychological mirror')) return json({
    values: 'Order, then loyalty, then the truth.', fears: 'Being caught unprepared.', defenses: 'Counts things instead of feeling.', attachment: 'Avoidant; tests people before trusting them.', moralLines: 'Will not lie on an official record.',
    decisionStyle: 'Slow, head first, then gut.', selfImage: 'The one who keeps things straight.', blindSpot: 'Her brother.', breakingPoint: 'Proof she was used.', healing: 'Being believed without proof.',
  });
  if (system.startsWith('You are a fictional character deciding')) return json({ decision: 'She stops the car and goes to the van.', reasoning: 'The ledger can wait; he cannot.', rejected: ['Drive on to the shed'], emotion: 'resolve', cost: 'She misses the boat.' });
  if (system.startsWith('You help a novelist create or edit a character')) return json({
    reply: 'A harbour pilot who owes everyone money. What does he want from Mara?',
    edits: [{ op: 'set', field: 'name', value: 'Tobin Rake' }, { op: 'set', field: 'role', value: 'harbour pilot' }, { op: 'trait', key: 'habit', value: 'whistles when lying' }],
    ready: true,
  });
  if (system.startsWith('You read one scene of an existing novel')) {
    const cast = (/CAST: (.*)/.exec(user)?.[1] ?? '').split(', ').filter((n) => n && n !== '(none given)');
    const present = cast.filter((n) => user.includes(n.split(' ')[0]));
    return json({ title: /customs/i.test(user) ? 'The Customs Shed' : 'At the Pier', pov: present[0] ?? '', characters: present, location: /customs/i.test(user) ? 'Customs shed' : 'The pier', time: 'dawn', goal: 'find out what the manifest hides', conflict: 'her brother wants it signed unread', outcome: 'she keeps a copy', summary: 'Mara checks the manifest. Jonah pushes back.' });
  }
  if (system.startsWith('You read passages from an existing novel')) {
    const name = /CHARACTER: (.*)/.exec(user)?.[1] ?? 'Someone';
    return json({ role: name.startsWith('Mara') ? 'protagonist' : 'supporting', summary: `${name} as the passages show them.`, want: 'the truth on paper', need: 'to trust someone', wound: 'an old disgrace', arc: 'from records to people', voiceSample: '', secrets: [], traits: [{ key: 'habit', value: 'counts things' }] });
  }
  if (system.startsWith('You read the opening and the ending of an existing novel')) return json({ logline: 'A customs clerk finds her brother in the manifest.', dramaticQuestion: 'Will she sign?', theme: 'records and truth', ending: 'She publishes the ledger.', world: [{ kind: 'location', name: 'Greyhaven', summary: 'the harbour town' }, { kind: 'item', name: 'The Albatross', summary: 'a trawler' }] });
  if (system.startsWith('You are a story architect')) {
    const cs = ids(user);
    return json({ scenes: [{ chapter: 3, title: 'The Pilot\'s Debt', pov: cs[0] ?? 'c_x', location: 'the quay', time: 'dawn', goal: 'collect the debt', conflict: 'Jonah got there first', outcome: 'Mara learns the price', characters: cs.slice(0, 2), targetWords: 900 }] });
  }
  return 'OK';
}

export function startFakeModel(port = Number(process.env.FAKE_MODEL_PORT ?? 8799)) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/calls') { res.end(JSON.stringify(calls)); return; }
      // An Author Studio AI key asking for its own usage (OpenRouter's GET /key).
      if (req.url === '/v1/key') { res.end(JSON.stringify({ data: { usage: 1, limit: 4, auth: req.headers.authorization ?? '' } })); return; }
      const j = body ? JSON.parse(body) : { messages: [] };
      const system = j.messages.find((m) => m.role === 'system')?.content ?? '';
      const rest = j.messages.filter((m) => m.role !== 'system');
      const content = answer(system, rest);
      calls.push(system.slice(0, 40));
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${port}/v1` })));
}

/**
 * A stand-in for the Author Studio AI service (the Supabase function): device codes, a test hook that
 * plays the writer approving and paying in the browser, then a key pointed at the fake model.
 */
export function startFakeCloud(modelUrl, port = Number(process.env.FAKE_CLOUD_PORT ?? 8797)) {
  const links = new Map();
  const send = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = body ? JSON.parse(body) : {};
      const route = req.url.split('/').pop();
      if (route === 'config') return send(res, 200, { baseUrl: modelUrl, model: 'fake', cheapModel: 'fake', portalUrl: 'https://billing.example/portal' });
      if (route === 'start') { const code = `TEST-${String(links.size + 1).padStart(4, '0')}`; links.set(code, { secret: `s-${code}`, state: 'pending' }); return send(res, 200, { code, pollSecret: `s-${code}`, verifyUrl: `http://127.0.0.1:${port}/link.html?code=${code}`, interval: 1, expiresIn: 600 }); }
      if (route === 'approve-and-pay') { for (const l of links.values()) if (l.state === 'pending') l.state = 'paid'; return send(res, 200, { ok: true }); }
      if (route === 'poll') {
        const l = links.get(j.code);
        if (!l || l.secret !== j.pollSecret) return send(res, 404, { status: 'unknown' });
        if (l.state === 'consumed') return send(res, 410, { status: 'consumed' });
        if (l.state !== 'paid') return send(res, 200, { status: 'pending' });
        l.state = 'consumed';
        return send(res, 200, { status: 'ok', key: 'sk-or-test-key', email: 'ana@example.com', plan: 'writer', baseUrl: modelUrl, model: 'fake', cheapModel: 'fake', portalUrl: 'https://billing.example/portal' });
      }
      if (req.url.startsWith('/link.html')) { res.setHeader('content-type', 'text/html'); return res.end('<p>account page</p>'); }
      send(res, 404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${port}` })));
}
