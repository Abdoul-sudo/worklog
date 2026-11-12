import type { On, RenderSurface } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const h = (heure: number, minute = 0) => new Date(2026, 10, 12, heure, minute).getTime()
const JOURNAL = 'C:/Users/test/.claude/temps/journal/2026-11-12/S1.jsonl'
const SURFACES = ['terminal', 'desktop', 'vscode'] as const
const PROMPT = { wait: false, origin: { kind: 'composer' } } as const
const COMMANDE = { command: 'temps', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const PANNEAU = {
  plugin: 'temps-item',
  component: 'Pane',
  requestId: 'temps-item',
  props: {
    title: 'Temps par item',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const PUCE = {
  plugin: 'temps-item',
  component: 'PromptHint',
  requestId: 'prompt-hint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const BANDEAU = {
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
  const etat = { session: 'S1', branche: 'main' }
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
  on('session.id', () => ({ value: etat.session }))
  on('session.cwd', () => ({ value: 'D:/WORK/FSY' }))
  on('session.repo', () => ({ value: null }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: '' }))
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

test('un message avec un ID compte pour cet item, partout', async ($, on) => {
  const { horloge, fichiers, toasts, statuts } = monde(on, ['vscode'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  expect(fichiers.has('C:/Users/test/.claude/temps.json')).toBe(true)

  await $.prompt.submit({ ...PROMPT, text: 'Corrige le bug FLO-I165 stp' })
  await horloge.settle()
  expect(toasts).toContain('Temps compté pour FLO-I165')
  await horloge.advance(10 * 60_000)
  await $.turn.complete({ answer: 'fait', durationMs: 600_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await horloge.settle()

  const lignes = fichiers.get(JOURNAL)!.trim().split('\n').map(l => JSON.parse(l) as { e: string; k: string | null })
  expect(lignes.map(l => `${l.e}:${l.k}`)).toEqual(['ouverture:null', 'message:FLO-I165', 'reponse:FLO-I165'])
  expect(statuts.at(-1)).toBe('⏱ FLO-I165 · 10 min')

  const { text } = await $.command.run({ ...COMMANDE, args: '' })
  expect(text).toContain('Temps du jeudi 12 novembre')
  expect(text).toContain('  FLO-I165   10 min  (en cours)')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANNEAU, surface })
    expect(await ui.find({ type: 'Text', text: /FLO-I165 · 10 min/ })).toBeDefined()
    expect(await ui.find({ key: 'autre-item' })).toBeDefined()
    await ui.unmount()
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    const bande = await $.ui.mount({ ...BANDEAU, surface })
    const puce = surface === 'terminal' ? await $.ui.mount({ ...PUCE, surface }) : bande
    expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ FLO-I165 · 10 min')
    expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
    await puce.press({ key: 'puce' })
    expect(await bande.find({ key: 'autre-item' })).toBeDefined()
    await puce.press({ key: 'puce' })
    expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
    if (puce !== bande) await puce.unmount()
    await bande.unmount()
  }
})

test("l'item vient de la branche Git, et la liste permet d'en choisir un autre", async ($, on) => {
  const { horloge, toasts, etat } = monde(on)
  etat.branche = 'feature/FSY-I9-export'
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'on commence' })
  await horloge.settle()
  await horloge.advance(5 * 60_000)
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toContain('FSY-I9')

  etat.branche = 'feature/FLO-I7-fix'
  await horloge.advance(60_000)
  await $.prompt.submit({ ...PROMPT, text: 'je continue' })
  await horloge.settle()
  expect(toasts).toContain('Temps compté pour FLO-I7')

  // Dans l'app desktop, la puce et la liste sont dans la même zone, au-dessus de la saisie.
  const puce = await $.ui.mount({ ...BANDEAU, surface: 'desktop' })
  const bande = puce
  await puce.press({ key: 'puce' })
  await bande.press({ key: 'choisir-FSY-I9' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('FSY-I9 ·')
  await puce.unmount()
})

test("sans item, le temps va au groupe de l'app desktop ; on peut taper un nom libre", async ($, on) => {
  const { horloge, fichiers } = monde(on, ['desktop'], {
    CLAUDE_CODE_HOST_SESSION_ID: 'local_abc',
    CLAUDE_CODE_EXECPATH: 'C:\\App\\Claude-Data\\claude-code\\2.1.322\\claude.exe',
  })
  const groupes = { groups: [{ id: 'cg-1', name: 'Codepath' }], assignments: { 'code:local_abc': 'cg-1' } }
  fichiers.set('C:/App/Claude-Data/claude_desktop_config.json', JSON.stringify({ preferences: { epitaxyPrefs: { 'dframe-group-scopes': { 'u/o': groupes } } } }))

  await $.session.start({ cwd: 'D:/PROJECTS/jeu', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'ajoute le menu' })
  await horloge.advance(15 * 60_000)
  await horloge.settle()
  // Dans l'app desktop, la puce et la liste sont dans la même zone, au-dessus de la saisie.
  const puce = await $.ui.mount({ ...BANDEAU, surface: 'desktop' })
  const bande = puce
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ Codepath · 15 min')

  await puce.press({ key: 'puce' })
  await bande.input({ key: 'autre-item', text: 'Refonte menu' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ Refonte menu · 15 min')
  await puce.unmount()
})

test("un item choisi à la main ne change plus tout seul ; la puce donne le temps de la session", async ($, on) => {
  const { horloge, etat } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  // Dans l'app desktop, la puce et la liste sont dans la même zone, au-dessus de la saisie.
  const puce = await $.ui.mount({ ...BANDEAU, surface: 'desktop' })
  const bande = puce
  await puce.press({ key: 'puce' })
  await bande.input({ key: 'autre-item', text: 'FLO-I1' })

  await $.prompt.submit({ ...PROMPT, text: 'regarde aussi FSY-I2' })
  etat.branche = 'feature/LBA-I3'
  await horloge.advance(10 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'suite' })
  await horloge.settle()
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ FLO-I1 · 10 min')

  // Une autre session sur le même ID : la liste les regroupe, la puce garde le temps de sa session.
  etat.session = 'S2'
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...COMMANDE, args: 'FLO-I1' })
  await horloge.advance(5 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'encore' })
  await horloge.advance(10 * 60_000)
  await horloge.settle()
  await puce.press({ key: 'puce' })
  expect((await puce.find({ key: 'puce' }))?.text).toContain('⏱ FLO-I1 · 15 min')
  expect(await bande.find({ type: 'Text', text: /FLO-I1 · 25 min/ })).toBeDefined()
  await puce.unmount()
})

test('un long écart demande pause ou travail, et la réponse compte', async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'FLO-I165 : on commence' })
  await horloge.advance(5 * 60_000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await horloge.advance(45 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'je reviens' })
  await horloge.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BANDEAU, surface })
    expect(await ui.find({ type: 'Text', text: /Du travail/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BANDEAU, surface: 'desktop' })
  await ui.press({ key: 'ecart-oui' })
  expect(await ui.find({ type: 'Text', text: /Du travail/ })).toBeUndefined()
  await ui.unmount()

  const { text } = await $.command.run({ ...COMMANDE, args: '' })
  expect(text).toContain('  FLO-I165   50 min  (en cours)')
  expect(text).not.toContain('Écarts à confirmer')
})

test('les sous-commandes : item, pause, confirmer, erreur', async ($, on) => {
  const { horloge, fichiers } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ ...COMMANDE, args: 'FSY-I478' })).text).toBe(
    'Item de cette session : FSY-I478.',
  )
  await horloge.advance(30 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'suite' })
  await horloge.settle()
  const liste = (await $.command.run({ ...COMMANDE, args: 'confirmer' })).text
  expect(liste).toContain('  1. jeudi 12 novembre, FSY-I478, de 9 h 00 à 9 h 30 (30 min)')
  expect((await $.command.run({ ...COMMANDE, args: 'confirmer 1 pause' })).text).toBe('1 écart classé comme pause.')
  expect((await $.command.run({ ...COMMANDE, args: 'confirmer' })).text).toBe(
    'Aucun écart à confirmer sur les 7 derniers jours.',
  )

  await horloge.advance(5 * 60_000)
  expect((await $.command.run({ ...COMMANDE, args: 'stop' })).text).toContain('Compteur en pause')
  expect(fichiers.get(JOURNAL)!.trim().split('\n').at(-1)).toContain('"e":"pause"')
  expect((await $.command.run({ ...COMMANDE, args: 'semaien' })).text).toStartWith(
    "« semaien » n'est ni une commande ni un ID d'item.",
  )
  expect((await $.command.run({ ...COMMANDE, args: 'semaine' })).text).toContain('Temps des 7 derniers jours')
})
