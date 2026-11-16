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
const reponse = (minute, cwd, id) =>
  ligne({ type: 'assistant', sessionId: 'abc', cwd, timestamp: new Date(T + minute * 60_000).toISOString(), message: { id, usage: { input_tokens: 10, output_tokens: 5 } } })

function monde() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-importer-'))
  const projets = path.join(racine, 'projects')
  const sortie = path.join(racine, 'import')
  fs.mkdirSync(path.join(projets, 'D--proj', 'abc', 'subagents'), { recursive: true })
  return { racine, projets, sortie }
}
const importer = (projets, sortie) => execFileSync(process.execPath, [IMPORTER, projets, sortie, 'PROJ-\\d+'])
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
