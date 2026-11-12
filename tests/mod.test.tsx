import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const h = (heure: number, minute = 0) => new Date(2026, 10, 12, heure, minute).getTime()
const JOURNAL = 'C:/Users/test/.claude/temps/journal/2026-11-12/S1.jsonl'
const SURFACES = ['terminal', 'desktop', 'vscode'] as const
const PROMPT = { wait: false, origin: { kind: 'composer' } } as const
const COMMANDE = { command: 'temps', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const PANNEAU = {
  plugin: 'temps-ticket',
  component: 'Pane',
  requestId: 'temps-ticket',
  props: {
    title: 'Temps par ticket',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BANDEAU = {
  plugin: 'temps-ticket',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

/** Ce qui se trouve sous le mod pendant le test : horloge, store, disque en mémoire, session S1. */
function monde(on: On) {
  const horloge = mock.clock(on, { now: h(9) })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\test' })
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
  on('session.id', () => ({ value: 'S1' }))
  on('session.cwd', () => ({ value: 'D:/WORK/FSY' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
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
  return { horloge, fichiers, toasts, statuts }
}

test('un message avec un ID compte pour ce ticket, partout', async ($, on) => {
  const { horloge, fichiers, toasts, statuts } = monde(on)
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
  expect(statuts.at(-1)).toBe("FLO-I165 · 10 min aujourd'hui")

  const { text } = await $.command.run({ ...COMMANDE, args: '' })
  expect(text).toContain('Temps du jeudi 12 novembre')
  expect(text).toContain('  FLO-I165   10 min  (en cours)')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANNEAU, surface })
    expect((await ui.find({ type: 'Text', text: /FLO-I165 : 10 min/ }))?.text).toBe('● FLO-I165 : 10 min')
    expect(await ui.find({ key: 'pause' })).toBeDefined()
    await ui.unmount()
  }
})

test('un long écart demande pause ou travail, et la réponse compte', async ($, on) => {
  const { horloge, toasts } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'FLO-I165 : on commence' })
  await horloge.advance(5 * 60_000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await horloge.advance(45 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'je reviens' })
  await horloge.settle()
  expect(toasts).toContain('Écart de 45 min sur FLO-I165 : pause ou travail ?')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BANDEAU, surface })
    expect(await ui.find({ type: 'Text', text: /pause ou travail/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BANDEAU, surface: 'desktop' })
  await ui.press({ key: 'ecart-travail' })
  expect(await ui.find({ type: 'Text', text: /pause ou travail/ })).toBeUndefined()
  await ui.unmount()

  const { text } = await $.command.run({ ...COMMANDE, args: '' })
  expect(text).toContain('  FLO-I165   50 min  (en cours)')
  expect(text).not.toContain('Écarts à confirmer')
})

test('les sous-commandes : ticket, pause, confirmer, erreur', async ($, on) => {
  const { horloge, fichiers } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ ...COMMANDE, args: 'FSY-I478' })).text).toBe(
    'Ticket de cette session : FSY-I478. Le temps compte pour ce ticket à partir de maintenant.',
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
    "« semaien » n'est ni une commande ni un ID de ticket reconnu.",
  )
  expect((await $.command.run({ ...COMMANDE, args: 'semaine' })).text).toContain('Temps des 7 derniers jours')
})
