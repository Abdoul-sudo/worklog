import type { On, RenderSurface } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

const h = (heure: number, minute = 0) => new Date(2026, 10, 12, heure, minute).getTime()
const JOURNAL = 'C:/Users/test/.claude/temps/journal/2026-11-12/S1.jsonl'
const PROMPT = { wait: false, origin: { kind: 'composer' } } as const
const COMMANDE = { command: 'temps', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const FIN_DE_TOUR = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

const PANNEAU = {
  plugin: 'temps-item',
  component: 'Pane',
  requestId: 'temps-item',
  props: { title: 'Temps par item', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const LIGNE_AIDE = {
  plugin: 'temps-item',
  component: 'PromptHint',
  requestId: 'prompt-hint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const PIED = {
  plugin: 'temps-item',
  component: 'SessionMode',
  requestId: 'session-mode',
  props: { modes: ['Bypass permissions'] },
} as const

const BANDE = {
  plugin: 'temps-item',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** Ce qui se trouve sous le mod pendant le test : horloge, store, disque en mémoire, session et branche Git. */
function monde(on: On, surfaces: readonly RenderSurface[] = ['terminal'], env: Record<string, string> = {}) {
  const horloge = mock.clock(on, { now: h(9) })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\test', ...env })
  const etat = { session: 'S1', branche: 'main', agents: [] as { id: string; status: string }[] }
  const fichiers = new Map<string, string>()
  const toasts: string[] = []
  const statuts: (string | undefined)[] = []
  // Le moteur passe les chemins sous la forme du système (barres obliques inverses sous Windows).
  const norme = (chemin: string) => chemin.replace(/\\/g, '/')
  const sous = (dossier: string) => [...fichiers.keys()].filter(f => f.startsWith(`${norme(dossier)}/`))
  on('fs.exists', (_, e) => ({ value: fichiers.has(norme(e.path)) || sous(e.path).length > 0 }))
  on('fs.read', (_, e) => {
    const texte = fichiers.get(norme(e.path))
    if (texte === undefined) throw new Error(`absent : ${e.path}`)
    return { value: texte }
  })
  on('fs.write', (_, e) => {
    fichiers.set(norme(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', (_, e) => ({
    value: [...new Set(sous(e.path).map(f => f.slice(norme(e.path).length + 1).split('/')[0]!))].map(name => ({
      name, kind: 'file' as const, size: 0, mtimeMs: horloge.now(), isLink: false,
    })),
  }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: `${etat.branche}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('agent.list', () => ({ value: etat.agents.map(a => ({ ...a, description: 'agent', type: 'general-purpose' })) as never }))
  on('session.id', () => ({ value: etat.session }))
  on('session.cwd', () => ({ value: 'D:/WORK/FSY' }))
  on('session.repo', () => ({ value: null }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { horloge, fichiers, toasts, statuts, etat }
}

/** Ouvre une session et y passe `minutes` sur un message qui cite `texte`. */
async function travailler($: Engine, horloge: MockClock, texte: string, minutes: number) {
  await $.prompt.submit({ ...PROMPT, text: texte })
  await horloge.advance(minutes * 60_000)
  await $.turn.complete(FIN_DE_TOUR)
  await horloge.settle()
}

test('un message avec un ID compte pour cet item ; la puce est sous la saisie et ouvre le popover', async ($, on) => {
  const { horloge, fichiers, toasts, statuts } = monde(on, ['vscode'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'Corrige le bug FLO-I165 stp', 10)
  expect(toasts).toContain('Temps compté pour FLO-I165')

  const lignes = fichiers.get(JOURNAL)!.trim().split('\n').map(l => JSON.parse(l) as { e: string; k: string | null })
  expect(lignes.map(l => `${l.e}:${l.k}`)).toEqual(['ouverture:null', 'message:FLO-I165', 'reponse:FLO-I165'])
  expect(statuts.at(-1)).toBe('⏱ FLO-I165 · 10 min')
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toContain('  FLO-I165   10 min')

  for (const [surface, site] of [['terminal', LIGNE_AIDE], ['desktop', PIED]] as const) {
    const puce = await $.ui.mount({ ...site, surface })
    const bande = await $.ui.mount({ ...BANDE, surface })
    expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ FLO-I165 · 10 min')
    expect(await bande.find({ key: 'onglet-jour' })).toBeUndefined()
    await puce.press({ key: 'puce' })
    expect(await bande.find({ key: 'onglet-jour' })).toBeDefined()
    expect((await bande.find({ key: 'choisir-FLO-I165' }))?.text).toBe('FLO-I165')
    expect(await bande.find({ key: 'crayon' })).toBeDefined()
    await puce.press({ key: 'puce' })
    expect(await bande.find({ key: 'onglet-jour' })).toBeUndefined()
    await puce.unmount()
    await bande.unmount()
  }

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const panneau = await $.ui.mount({ ...PANNEAU, surface })
    expect(await panneau.find({ key: 'autre' })).toBeDefined()
    await panneau.unmount()
  }
})

test("l'item vient de la branche Git ; un clic dans la liste passe sur un autre", async ($, on) => {
  const { horloge, toasts, etat } = monde(on)
  etat.branche = 'feature/FSY-I9-export'
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'on commence', 5)
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toContain('FSY-I9')

  etat.branche = 'feature/FLO-I7-fix'
  await travailler($, horloge, 'je continue', 1)
  expect(toasts).toContain('Temps compté pour FLO-I7')

  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  await bande.press({ key: 'choisir-FSY-I9' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('FSY-I9 ·')
  await puce.unmount()
  await bande.unmount()
})

test("sans item, le temps va au groupe de l'app desktop ; « Autre item » accepte un nom libre", async ($, on) => {
  const { horloge, fichiers } = monde(on, ['desktop'], {
    CLAUDE_CODE_HOST_SESSION_ID: 'local_abc',
    CLAUDE_CODE_EXECPATH: 'C:\\App\\Claude-Data\\claude-code\\2.1.322\\claude.exe',
  })
  const groupes = { groups: [{ id: 'cg-1', name: 'Codepath' }], assignments: { 'code:local_abc': 'cg-1' } }
  fichiers.set('C:/App/Claude-Data/claude_desktop_config.json', JSON.stringify({ preferences: { epitaxyPrefs: { 'dframe-group-scopes': { 'u/o': groupes } } } }))

  await $.session.start({ cwd: 'D:/PROJECTS/jeu', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'ajoute le menu', 15)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ Codepath · 15 min')

  await puce.press({ key: 'puce' })
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: 'Refonte menu' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ Refonte menu · 15 min')
  await puce.unmount()
  await bande.unmount()
})

test("un item choisi à la main ne change plus tout seul ; deux sessions sur un même ID sont regroupées", async ($, on) => {
  const { horloge, etat } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...COMMANDE, args: 'FLO-I1' })
  await travailler($, horloge, 'regarde aussi FSY-I2', 5)
  etat.branche = 'feature/LBA-I3'
  await travailler($, horloge, 'suite', 5)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ FLO-I1 · 10 min')

  etat.session = 'S2'
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...COMMANDE, args: 'FLO-I1' })
  await travailler($, horloge, 'encore', 15)
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ FLO-I1 · 15 min')
  expect(await bande.find({ type: 'Text', text: /^25 min$/ })).toBeDefined()
  await puce.unmount()
  await bande.unmount()
})

test('renommer, retirer puis annuler depuis le popover', async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FSY-I47 : on commence', 20)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })

  await bande.press({ key: 'crayon' })
  await bande.input({ key: 'renommer', text: 'FSY-I478' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ FSY-I478 · 20 min')
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toContain('  FSY-I478   20 min')

  await bande.press({ key: 'retirer-FSY-I478' })
  expect(await bande.find({ key: 'annuler' })).toBeDefined()
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toContain('aucun temps compté')
  await bande.press({ key: 'annuler' })
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toContain('  FSY-I478   20 min')
  await puce.unmount()
  await bande.unmount()
})

test('les tokens, les onglets, les réglages et la frise', async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'FSY-I478' })
  await horloge.advance(30 * 60_000)
  const usage = { model: 'm', input_tokens: 1_000, output_tokens: 500, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 8_500 }
  await $.turn.complete({ ...FIN_DE_TOUR, usage })
  await horloge.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const bande = await $.ui.mount({ ...BANDE, surface })
    const puce = await $.ui.mount({ ...(surface === 'terminal' ? LIGNE_AIDE : PIED), surface })
    await puce.press({ key: 'puce' })
    expect(await bande.find({ type: 'Text', text: /12 k tokens/ })).toBeDefined()
    if (surface === 'terminal') expect(await bande.find({ key: 'frise' })).toBeDefined()

    await bande.press({ key: 'onglet-semaine' })
    expect(await bande.find({ type: 'Text', text: /Cette semaine/ })).toBeDefined()
    await bande.press({ key: 'precedent' })
    expect(await bande.find({ type: 'Text', text: /La semaine dernière/ })).toBeDefined()
    expect(await bande.find({ type: 'Text', text: /Rien sur cette période/ })).toBeDefined()
    await bande.press({ key: 'onglet-mois' })
    expect(await bande.find({ type: 'Text', text: /Novembre/ })).toBeDefined()

    await bande.press({ key: 'reglages' })
    expect(await bande.find({ key: 'seuil' })).toBeDefined()
    await bande.press({ key: 'reglage-jetons' })
    await bande.press({ key: 'reglages' })
    expect(await bande.find({ type: 'Text', text: /tokens/ })).toBeUndefined()
    await bande.press({ key: 'reglages' })
    await bande.press({ key: 'reglage-jetons' })
    await puce.press({ key: 'puce' })
    await puce.unmount()
    await bande.unmount()
  }
})

test('un long silence demande « Du travail ? », et la réponse compte', async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I165 : on commence', 5)
  await horloge.advance(50 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'je reviens' })
  await horloge.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const bande = await $.ui.mount({ ...BANDE, surface })
    expect(await bande.find({ type: 'Text', text: /50 min sans message sur FLO-I165/ })).toBeDefined()
    await bande.unmount()
  }
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await bande.press({ key: 'ecart-oui' })
  expect(await bande.find({ type: 'Text', text: /sans message/ })).toBeUndefined()
  await bande.unmount()
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toContain('  FLO-I165   55 min')
})

test('les sous-commandes : item, pause, confirmer, mois, erreur', async ($, on) => {
  const { horloge, fichiers } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ ...COMMANDE, args: 'FSY-I478' })).text).toBe('Item de cette session : FSY-I478.')
  await horloge.advance(50 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'suite' })
  await horloge.settle()
  expect((await $.command.run({ ...COMMANDE, args: 'confirmer' })).text).toContain(
    '  1. jeudi 12 novembre, FSY-I478, de 9 h 00 à 9 h 50 (50 min)',
  )
  expect((await $.command.run({ ...COMMANDE, args: 'confirmer 1 pause' })).text).toBe('1 écart classé comme pause.')
  expect((await $.command.run({ ...COMMANDE, args: 'confirmer' })).text).toBe('Aucun écart à confirmer sur les 7 derniers jours.')

  await horloge.advance(5 * 60_000)
  expect((await $.command.run({ ...COMMANDE, args: 'stop' })).text).toContain('Compteur en pause')
  expect(fichiers.get(JOURNAL)!.trim().split('\n').at(-1)).toContain('"e":"pause"')
  expect((await $.command.run({ ...COMMANDE, args: 'semaien' })).text).toStartWith("« semaien » n'est ni une commande ni un ID d'item.")
  expect((await $.command.run({ ...COMMANDE, args: 'semaine' })).text).toContain('Cette semaine')
  expect((await $.command.run({ ...COMMANDE, args: 'mois' })).text).toContain('Novembre')
})

test('quand des sous-agents travaillent deux heures, le temps compte et aucune question ne vient', async ($, on) => {
  const { horloge, etat } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I165 : lance le workflow', 1)
  etat.agents = [{ id: 'a1', status: 'running' }]
  await horloge.advance(120 * 60_000)
  etat.agents = [{ id: 'a1', status: 'completed' }]
  await horloge.advance(60_000)
  await $.prompt.submit({ ...PROMPT, text: 'je regarde le résultat' })
  await horloge.settle()

  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  expect(await bande.find({ type: 'Text', text: /sans message/ })).toBeUndefined()
  await bande.unmount()
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toContain('  FLO-I165   2 h 02')
})
