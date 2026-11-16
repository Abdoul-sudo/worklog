// Tests de scripts/importer.mjs, avec le lanceur de tests de Node : node --test tests/importer.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const IMPORTER = path.join(import.meta.dirname, '..', 'scripts', 'importer.mjs')
const T = Date.parse('2026-11-12T09:00:00Z')
const jour = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const ligne = (ev) => `${JSON.stringify(ev)}\n`
const humain = (minute, cwd) => ligne({ type: 'user', sessionId: 'abc', cwd, timestamp: new Date(T + minute * 60_000).toISOString(), origin: { kind: 'human' }, message: { content: 'on avance' } })
const reponse = (minute, cwd, id, model = 'claude-opus-5-5', usage = { input_tokens: 10, output_tokens: 5 }) =>
  ligne({ type: 'assistant', sessionId: 'abc', cwd, timestamp: new Date(T + minute * 60_000).toISOString(), message: { id, model, usage } })

function monde() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-importer-'))
  const projets = path.join(racine, 'projects')
  const sortie = path.join(racine, 'import')
  fs.mkdirSync(path.join(projets, 'D--proj', 'abc', 'subagents'), { recursive: true })
  return { racine, projets, sortie }
}
const importer = (projets, sortie) => execFileSync(process.execPath, [IMPORTER, projets, sortie, 'PROJ-\\d+'])
const lignes = (sortie) =>
  fs
    .readFileSync(path.join(sortie, jour(T), 'abc.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
const noms = (sortie) =>
  fs
    .readFileSync(path.join(sortie, jour(T), 'abc.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l).d)

test("une session garde le nom de son dossier de départ, même quand Claude ou ses agents vont dans un sous-dossier", () => {
  const { racine, projets, sortie } = monde()
  try {
    fs.writeFileSync(path.join(projets, 'D--proj', 'abc.jsonl'), humain(0, 'D:\\proj') + reponse(1, 'D:\\proj\\output\\skies', 'r1'))
    fs.writeFileSync(path.join(projets, 'D--proj', 'abc', 'subagents', 'agent-1.jsonl'), reponse(2, 'D:\\proj\\.claude\\worktrees\\victoire', 'r2'))
    importer(projets, sortie)
    assert.deepEqual([...new Set(noms(sortie))], ['proj'])
  } finally {
    fs.rmSync(racine, { recursive: true, force: true })
  }
})

test('une fois, les noms déjà importés prennent le dossier de départ de leur session', () => {
  const { racine, projets, sortie } = monde()
  try {
    const conversation = path.join(projets, 'D--proj', 'abc.jsonl')
    fs.writeFileSync(conversation, humain(0, 'D:\\proj') + reponse(1, 'D:\\proj\\output\\skies', 'r1'))
    // Un import d'une version passée : déjà lu jusqu'au bout, sous le nom du sous-dossier.
    fs.mkdirSync(path.join(sortie, jour(T)), { recursive: true })
    fs.writeFileSync(path.join(sortie, jour(T), 'abc.jsonl'), ligne({ t: T + 60_000, s: 'abc', e: 'jetons', n: 15, k: null, d: 'skies', i: 1 }))
    fs.writeFileSync(path.join(sortie, 'etat.json'), JSON.stringify({ version: 3, positions: { [path.join('D--proj', 'abc.jsonl')]: fs.statSync(conversation).size }, vus: { r1: 1 }, tours: {} }))
    importer(projets, sortie)
    assert.deepEqual(noms(sortie), ['proj'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(sortie, 'etat.json'), 'utf8')).nomsCorriges, true)
  } finally {
    fs.rmSync(racine, { recursive: true, force: true })
  }
})

test("chaque dépense de tokens importée garde le détail de ses réponses, par modèle, pour leur prix API", () => {
  const { racine, projets, sortie } = monde()
  try {
    const usage = {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 1_000,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
      server_tool_use: { web_search_requests: 2 },
      speed: 'fast',
      inference_geo: 'us',
    }
    fs.writeFileSync(path.join(projets, 'D--proj', 'abc.jsonl'), humain(0, 'D:\\proj') + reponse(1, 'D:\\proj', 'r1', 'claude-opus-5-5', usage))
    // Un sous-agent sur un autre modèle, dans la même minute, sans détail du cache.
    fs.writeFileSync(
      path.join(projets, 'D--proj', 'abc', 'subagents', 'agent-1.jsonl'),
      reponse(1, 'D:\\proj', 'r2', 'claude-haiku-5-5', { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 40 }),
    )
    importer(projets, sortie)
    const jetons = lignes(sortie).filter(ev => ev.e === 'jetons')
    assert.equal(jetons.length, 1)
    assert.equal(jetons[0].n, 1_358)
    assert.deepEqual(
      jetons[0].p.sort((a, b) => a.m.localeCompare(b.m)),
      [
        { m: 'claude-haiku-5-5', in: 1, out: 2, c5: 40, c1: 0, cr: 0 },
        { m: 'claude-opus-5-5', in: 10, out: 5, c5: 100, c1: 200, cr: 1_000, web: 2, rapide: 1, us: 1 },
      ],
    )
  } finally {
    fs.rmSync(racine, { recursive: true, force: true })
  }
})

test("une fois, les tokens déjà importés reçoivent le détail de leurs réponses, partagé quand une minute a plusieurs lignes", () => {
  const { racine, projets, sortie } = monde()
  try {
    const conversation = path.join(projets, 'D--proj', 'abc.jsonl')
    fs.writeFileSync(conversation, humain(0, 'D:\\proj') + reponse(1, 'D:\\proj', 'r1', 'claude-opus-5-5', { input_tokens: 30, output_tokens: 15 }))
    // Un import d'une version passée, sans détail : la minute 1 en deux lignes (deux imports au milieu de la minute).
    fs.mkdirSync(path.join(sortie, jour(T)), { recursive: true })
    fs.writeFileSync(
      path.join(sortie, jour(T), 'abc.jsonl'),
      ligne({ t: T + 60_000, s: 'abc', e: 'jetons', n: 30, k: null, d: 'proj', i: 1 }) + ligne({ t: T + 61_000, s: 'abc', e: 'jetons', n: 15, k: null, d: 'proj', i: 1 }),
    )
    fs.writeFileSync(
      path.join(sortie, 'etat.json'),
      JSON.stringify({ version: 3, positions: { [path.join('D--proj', 'abc.jsonl')]: fs.statSync(conversation).size }, vus: { r1: 1 }, tours: {}, dossiers: {}, nomsCorriges: true }),
    )
    importer(projets, sortie)
    const details = lignes(sortie).map(ev => ev.p)
    assert.deepEqual(details, [
      [{ m: 'claude-opus-5-5', in: 20, out: 10, c5: 0, c1: 0, cr: 0 }],
      [{ m: 'claude-opus-5-5', in: 10, out: 5, c5: 0, c1: 0, cr: 0 }],
    ])
    assert.equal(JSON.parse(fs.readFileSync(path.join(sortie, 'etat.json'), 'utf8')).details, 2)
    // La fois suivante, rien ne change.
    const avant = fs.readFileSync(path.join(sortie, jour(T), 'abc.jsonl'), 'utf8')
    importer(projets, sortie)
    assert.equal(fs.readFileSync(path.join(sortie, jour(T), 'abc.jsonl'), 'utf8'), avant)
  } finally {
    fs.rmSync(racine, { recursive: true, force: true })
  }
})

/** Tous les événements importés du jour, de toutes les sessions. */
const tousImportes = (sortie) =>
  fs
    .readdirSync(path.join(sortie, jour(T)))
    .filter(f => f.endsWith('.jsonl'))
    .flatMap(f => fs.readFileSync(path.join(sortie, jour(T), f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)))

test("un message recopié dans une conversation reprise ne compte qu'une fois, dans la session qui a sa réponse ; son ID nomme la reprise", () => {
  const { racine, projets, sortie } = monde()
  try {
    // La conversation, puis sa reprise par l'app : une autre session, qui recopie le même message (même uuid) et la même
    // réponse, à la même heure.
    const message = (s) => ligne({ type: 'user', sessionId: s, uuid: 'u1', cwd: 'D:\\proj', timestamp: new Date(T).toISOString(), origin: { kind: 'human' }, message: { content: 'PROJ-1 : on avance' } })
    fs.writeFileSync(path.join(projets, 'D--proj', 'abc.jsonl'), message('abc') + reponse(1, 'D:\\proj', 'r1'))
    fs.writeFileSync(path.join(projets, 'D--proj', 'aaa.jsonl'), message('aaa') + reponse(1, 'D:\\proj', 'r1').replace('"sessionId":"abc"', '"sessionId":"aaa"'))
    importer(projets, sortie)
    const evenements = tousImportes(sortie)
    const messages = evenements.filter(ev => ev.e === 'message')
    assert.equal(messages.length, 1)
    assert.deepEqual(evenements.filter(ev => ev.e === 'jetons').map(ev => ev.s), [messages[0].s])
    // L'autre session, la reprise, garde l'ID en repère, sans temps.
    assert.deepEqual(
      evenements.filter(ev => ev.e === 'repere').map(ev => [ev.k, ev.t === T, ev.s !== messages[0].s]),
      [['PROJ-1', true, true]],
    )
  } finally {
    fs.rmSync(racine, { recursive: true, force: true })
  }
})

test("une fois, les messages déjà importés en double dans une copie de la conversation sont retirés ; leur ID y reste en repère", () => {
  const { racine, projets, sortie } = monde()
  try {
    // Un import d'une version passée : la copie `aaa` a les messages sans leurs réponses ; `abc` a tout.
    fs.mkdirSync(path.join(sortie, jour(T)), { recursive: true })
    fs.writeFileSync(
      path.join(sortie, jour(T), 'abc.jsonl'),
      ligne({ t: T, s: 'abc', e: 'message', k: 'PROJ-1', d: 'proj', i: 1 }) +
        ligne({ t: T + 60_000, s: 'abc', e: 'message', k: null, d: 'proj', i: 1 }) +
        ligne({ t: T + 60_000, s: 'abc', e: 'jetons', n: 15, k: null, d: 'proj', i: 1 }),
    )
    fs.writeFileSync(
      path.join(sortie, jour(T), 'aaa.jsonl'),
      ligne({ t: T, s: 'aaa', e: 'message', k: 'PROJ-1', d: 'proj', i: 1 }) +
        ligne({ t: T + 60_000, s: 'aaa', e: 'message', k: null, d: 'proj', i: 1 }) +
        ligne({ t: T + 3_600_000, s: 'aaa', e: 'message', k: null, d: 'proj', i: 1 }),
    )
    fs.writeFileSync(path.join(sortie, 'etat.json'), JSON.stringify({ version: 3, positions: {}, vus: {}, tours: {}, dossiers: {}, nomsCorriges: true, details: 2 }))
    importer(projets, sortie)
    // Le message en double quitte la copie ; son message à elle reste.
    assert.deepEqual(
      tousImportes(sortie).filter(ev => ev.e === 'message').map(ev => `${ev.s}@${ev.t - T}`).sort(),
      ['aaa@3600000', 'abc@0', 'abc@60000'],
    )
    assert.deepEqual(tousImportes(sortie).filter(ev => ev.e === 'repere').map(ev => `${ev.s}@${ev.t - T}:${ev.k}`), ['aaa@0:PROJ-1'])
    // La fois suivante, rien ne change.
    const avant = fs.readFileSync(path.join(sortie, jour(T), 'aaa.jsonl'), 'utf8')
    importer(projets, sortie)
    assert.equal(fs.readFileSync(path.join(sortie, jour(T), 'aaa.jsonl'), 'utf8'), avant)
  } finally {
    fs.rmSync(racine, { recursive: true, force: true })
  }
})

test("une réponse recopiée dans une conversation reprise donne son détail à la minute où l'import l'a comptée", () => {
  const { racine, projets, sortie } = monde()
  try {
    const conversation = path.join(projets, 'D--proj', 'abc.jsonl')
    fs.writeFileSync(conversation, humain(0, 'D:\\proj') + reponse(1, 'D:\\proj', 'r1'))
    // La reprise, lue avant elle : la même réponse, sous l'id de la nouvelle conversation.
    const reprise = path.join(projets, 'D--proj', 'aaa.jsonl')
    fs.writeFileSync(reprise, reponse(1, 'D:\\proj', 'r1').replace('"sessionId":"abc"', '"sessionId":"aaa"'))
    fs.mkdirSync(path.join(sortie, jour(T)), { recursive: true })
    fs.writeFileSync(path.join(sortie, jour(T), 'abc.jsonl'), ligne({ t: T + 60_000, s: 'abc', e: 'jetons', n: 15, k: null, d: 'proj', i: 1 }))
    const positions = { [path.join('D--proj', 'abc.jsonl')]: fs.statSync(conversation).size, [path.join('D--proj', 'aaa.jsonl')]: fs.statSync(reprise).size }
    fs.writeFileSync(path.join(sortie, 'etat.json'), JSON.stringify({ version: 3, positions, vus: { r1: 1 }, tours: {}, dossiers: {}, nomsCorriges: true }))
    importer(projets, sortie)
    assert.deepEqual(lignes(sortie)[0].p, [{ m: 'claude-opus-5-5', in: 10, out: 5, c5: 0, c1: 0, cr: 0 }])
  } finally {
    fs.rmSync(racine, { recursive: true, force: true })
  }
})
