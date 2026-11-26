import type { On, RenderSurface, TurnUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

const h = (heure: number, minute = 0) => new Date(2026, 10, 12, heure, minute).getTime()
const JOURNAL = 'C:/Users/test/.claude/worklog/journal/2026-11-12/S1.jsonl'
const PROMPT = { wait: false, origin: { kind: 'composer' } } as const
const COMMANDE = { command: 'worklog', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const FIN_DE_TOUR = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

const PANNEAU = {
  plugin: 'worklog',
  component: 'Pane',
  requestId: 'worklog',
  props: { title: 'Temps par item', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const LIGNE_AIDE = {
  plugin: 'worklog',
  component: 'PromptHint',
  requestId: 'prompt-hint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const PIED = {
  plugin: 'worklog',
  component: 'SessionMode',
  requestId: 'session-mode',
  props: { modes: ['Bypass permissions'] },
} as const

const BANDE = {
  plugin: 'worklog',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** Ce qui se trouve sous le mod pendant le test : horloge, store, disque en mémoire, session et branche Git. */
function monde(
  on: On,
  surfaces: readonly RenderSurface[] = ['terminal'],
  env: Record<string, string> = {},
  langue: 'fr' | 'en' = 'fr',
  magasin: Record<string, unknown> = {},
) {
  const horloge = mock.clock(on, { now: h(9) })
  // Ces tests lisent les textes en français ; celui en anglais garde la langue par défaut.
  mock.store(on, { ...(langue === 'fr' ? { options: { langue: 'fr' } } : {}), ...magasin })
  mock.env(on, { USERPROFILE: 'C:\\Users\\test', ...env })
  const etat = {
    session: 'S1',
    branche: 'main',
    dossier: 'D:/WORK/FSY',
    agents: [] as { id: string; status: string }[],
    fonds: [] as (string | undefined)[],
    focus: [] as (string | undefined)[],
    // Le contexte que le prochain message renverra, et les réponses des prochains appels au modèle.
    contexte: undefined as number | undefined,
    reponses: [] as (TurnUsage | null)[],
    // Les commandes lancées par le mod.
    commandes: [] as (readonly string[])[],
  }
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
  // Git répond la branche ; Node est absent : l'historique de Claude Code n'est pas importé dans les tests.
  on('process.run', (_, e) => {
    etat.commandes.push(e.argv)
    return { value: { exitCode: e.argv[0] === 'node' ? 1 : 0, stdout: `${etat.branche}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.list', () => ({ value: etat.agents.map(a => ({ ...a, description: 'agent', type: 'general-purpose' })) as never }))
  on('session.id', () => ({ value: etat.session }))
  on('session.cwd', () => ({ value: etat.dossier }))
  on('session.repo', () => ({ value: null }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  // L'app n'accepte pour le fond d'un panneau qu'une couleur à six chiffres (ou un nom de thème) : on note ce qu'il reçoit.
  on('ui.open', (_, e) => {
    etat.fonds.push(e.backgroundColor)
    return { value: { isPlaced: true } }
  })
  // Sous le mod, le focus se pose sans rien dire ; on note où.
  on('ui.focus', (_, e) => {
    etat.focus.push(e.element)
    return {}
  })
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
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('classic.Stop', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('session.compact', (_, e) => ({ messages: e.messages }))
  on('session.usage', () => ({ value: { startedAt: h(9), context: { window: 1_000_000, tokens: etat.contexte }, rateLimits: [] } }))
  on('turn.step', async function* (_, e) {
    const usage = etat.reponses.shift() ?? null
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  return { horloge, fichiers, toasts, statuts, etat }
}

type Dessin = {
  surface: RenderSurface
  find(cible: { key?: string; type?: string; text?: RegExp }): Promise<{ text?: string } | undefined>
}

/** La puce affiche ce nom et ce temps. */
async function puceAffiche(ui: Dessin, nom: string, temps: string) {
  // Le terminal dessine ⏱ sur deux colonnes sans les compter : il y prend ◷, d'une seule colonne.
  const signe = ui.surface === 'terminal' ? '◷' : '⏱'
  expect((await ui.find({ key: 'puce' }))?.text?.trim()).toBe(`${signe} ${nom} · ${temps}`)
}

/** La ligne d'un item dans le popover du terminal (pastille, nom, tokens, temps), qu'on ouvre puis referme au besoin ;
 * undefined sans ligne. */
async function ligneDe($: Engine, item: string): Promise<string | undefined> {
  const avant = await $.ui.mount({ ...BANDE, surface: 'terminal' })
  const ouvert = (await avant.find({ key: 'onglet-jour' })) !== undefined
  await avant.unmount()
  if (!ouvert) await $.command.run({ ...COMMANDE, args: '' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'terminal' })
  const texte = (await bande.find({ key: `ligne-${item}` }))?.text
  await bande.unmount()
  // Le popover revient comme il était.
  if (!ouvert) await $.command.run({ ...COMMANDE, args: '' })
  return texte
}

/** Ouvre une session et y passe `minutes` sur un message qui cite `texte`. */
async function travailler($: Engine, horloge: MockClock, texte: string, minutes: number) {
  await $.prompt.submit({ ...PROMPT, text: texte })
  await horloge.advance(minutes * 60_000)
  // Une vraie réponse dépense des tokens : sans eux, un item ne serait pas compté.
  await $.turn.complete({ ...FIN_DE_TOUR, usage: { model: 'm', input_tokens: 1_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
  await horloge.settle()
}

test('un message avec un ID compte pour cet item ; la puce est sous la saisie et ouvre le popover', async ($, on) => {
  const { horloge, fichiers, toasts, statuts } = monde(on, ['vscode'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'Corrige le bug FLO-I165 stp', 10)
  expect(toasts).toContain('Temps compté pour FLO-I165')

  const lignes = fichiers.get(JOURNAL)!.trim().split('\n').map(l => JSON.parse(l) as { e: string; k: string | null })
  expect(lignes.map(l => `${l.e}:${l.k}`)).toEqual(['ouverture:null', 'message:FLO-I165', 'reponse:FLO-I165', 'jetons:FLO-I165'])
  expect(statuts.at(-1)).toBe('⏱ FLO-I165 · 10 min · /worklog')

  for (const [surface, site] of [['terminal', LIGNE_AIDE], ['desktop', PIED]] as const) {
    const puce = await $.ui.mount({ ...site, surface })
    const bande = await $.ui.mount({ ...BANDE, surface })
    await puceAffiche(puce, 'FLO-I165', '10 min')
    expect(await bande.find({ key: 'onglet-jour' })).toBeUndefined()
    await puce.press({ key: 'puce' })
    expect(await bande.find({ key: 'onglet-jour' })).toBeDefined()
    expect((await bande.find({ key: 'ligne-FLO-I165' }))?.text).toContain('10 min')
    // Le nom : le libellé du bouton dans le terminal, un texte sous un bouton vide dans l'app desktop.
    const nom = await bande.find(surface === 'terminal' ? { key: 'choisir-FLO-I165' } : { type: 'Text', text: /^FLO-I165$/ })
    expect(nom?.text?.trim()).toBe('FLO-I165')
    // Le crayon vient au survol dans l'app desktop ; le terminal n'a pas de survol : le nom y est le bouton.
    expect(await bande.find({ key: 'crayon' })).toEqual(surface === 'desktop' ? expect.anything() : undefined)
    await puce.press({ key: 'puce' })
    expect(await bande.find({ key: 'onglet-jour' })).toBeUndefined()
    await puce.unmount()
    await bande.unmount()
  }

  // VS Code n'a ni bande ni puce à cliquer : /worklog y ouvre le panneau.
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toBe('Panneau ouvert.')
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
  expect(await ligneDe($, 'FSY-I9')).toBeDefined()

  etat.branche = 'feature/FLO-I7-fix'
  await travailler($, horloge, 'je continue', 1)
  expect(toasts).toContain('Temps compté pour FLO-I7')

  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  await bande.press({ key: 'choisir-FSY-I9' })
  await puceAffiche(puce, 'FSY-I9', '5 min')
  await puce.unmount()
  await bande.unmount()
})

test("sans item, le temps va au dossier du projet, même dans un groupe de l'app desktop ; « Ajouter un item » accepte un nom libre", async ($, on) => {
  const { horloge, fichiers } = monde(on, ['desktop'], {
    CLAUDE_CODE_HOST_SESSION_ID: 'local_abc',
    CLAUDE_CODE_EXECPATH: 'C:\\App\\Claude-Data\\claude-code\\2.1.322\\claude.exe',
  })
  const groupes = { groups: [{ id: 'cg-1', name: 'Codepath' }], assignments: { 'code:local_abc': 'cg-1' } }
  fichiers.set('C:/App/Claude-Data/claude_desktop_config.json', JSON.stringify({ preferences: { epitaxyPrefs: { 'dframe-group-scopes': { 'u/o': groupes } } } }))

  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'ajoute le menu', 15)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  // Le groupe de l'app desktop ne nomme plus la session : son nom vient du dossier du projet.
  await puceAffiche(puce, 'FSY', '15 min')

  await puce.press({ key: 'puce' })
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: 'Refonte menu' })
  // Un item choisi à la main compte à partir du choix : les 15 minutes restent au dossier.
  await puceAffiche(puce, 'Refonte menu', '0 min')
  await puce.unmount()
  await bande.unmount()
})

test("une session lancée dans un dossier d'attente prend le nom de son vrai dossier dès son premier message", async ($, on) => {
  const { horloge, etat } = monde(on)
  // L'app desktop démarre la session dans un dossier d'attente, puis lui donne son dossier.
  etat.dossier = 'C:/Users/moi/AppData/Local/Temp/spare-jvM1jf'
  await $.session.start({ cwd: etat.dossier, surface: 'terminal', isInteractive: true })
  await horloge.settle()
  etat.dossier = 'D:/WORK/FSY'
  await travailler($, horloge, 'nettoie les fichiers', 10)
  expect(await ligneDe($, 'FSY')).toContain('10 min')
  expect(await ligneDe($, 'spare-jvM1jf')).toBeUndefined()
})

test("une conversation de l'app desktop reprise sous un autre id garde le nom choisi", async ($, on) => {
  const { horloge, etat } = monde(on, ['desktop'], { CLAUDE_CODE_HOST_SESSION_ID: 'local_conv' })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...COMMANDE, args: 'claude mod' })
  await travailler($, horloge, 'une tâche', 10)
  // L'app relance la conversation : le processus repart sous un autre id.
  etat.session = 'S2'
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'la suite', 5)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  // Le temps du nom garde les 10 minutes d'avant la relance.
  await puceAffiche(puce, 'claude mod', '15 min')
  await puce.unmount()
})

test("une notification ou un message d'une autre session n'est pas un retour : la pause continue", async ($, on) => {
  const { horloge, fichiers } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1 : une tâche', 10)
  const messages = () => fichiers.get(JOURNAL)!.trim().split('\n').filter(l => l.includes('"e":"message"')).length
  const avant = messages()
  for (const kind of ['task-notification', 'peer', 'peer-send-message', 'unclassified'] as const) {
    await horloge.advance(10 * 60_000)
    await $.prompt.submit({ ...PROMPT, origin: { kind } as never, text: 'tâche finie' })
    await horloge.settle()
  }
  expect(messages()).toBe(avant)
})

test("une pause qui passe minuit pose sa question au retour, et ne compte pas d'avance la veille", { timeoutMs: 15_000 }, async ($, on) => {
  const { horloge } = monde(on)
  // Le 12 novembre, 23 h : la session s'ouvre.
  await horloge.advance(14 * 60 * 60_000)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1 : une tâche', 10)
  // Retour à 1 h, le 13 : 1 h 50 de pause, une question.
  await horloge.advance(110 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'je reviens' })
  await horloge.settle()
  await $.command.run({ ...COMMANDE, args: '' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'terminal' })
  expect(await bande.find({ type: 'Text', text: /Pause de 1 h 50 sur FLO-I1/ })).toBeDefined()
  // La veille, seuls les 10 min de travail comptent : la pause attend sa réponse.
  await bande.press({ key: 'precedent' })
  expect((await bande.find({ key: 'ligne-FLO-I1' }))?.text).toContain('10 min')
  await bande.unmount()
})

test("après /clear, la pause d'avant pose sa question au premier message", { timeoutMs: 15_000 }, async ($, on) => {
  const { horloge, etat } = monde(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1 : une tâche', 10)
  await horloge.advance(2 * 60 * 60_000)
  await $.session.end({ reason: 'clear', sessionId: 'S1', resume: { id: 'S1' } } as never)
  etat.session = 'S2'
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'la suite' })
  await horloge.settle()
  await $.command.run({ ...COMMANDE, args: '' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'terminal' })
  expect(await bande.find({ type: 'Text', text: /Pause de 2 h 00 sur FLO-I1/ })).toBeDefined()
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
  await puceAffiche(puce, 'FLO-I1', '10 min')

  etat.session = 'S2'
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...COMMANDE, args: 'FLO-I1' })
  await travailler($, horloge, 'encore', 15)
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  // La puce montre le temps du nom aujourd'hui, les deux sessions comprises : le même que sa ligne.
  await puceAffiche(puce, 'FLO-I1', '25 min')
  expect(await bande.find({ type: 'Text', text: /^25 min$/ })).toBeDefined()
  await puce.unmount()
  await bande.unmount()
})

test('renommer depuis le popover : le crayon, ou un double-clic sur le nom', async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FSY-I47 : on commence', 20)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })

  // Un clic sur le nom de l'item en cours ne fait rien ; un double-clic ouvre le champ pour le renommer.
  await bande.press({ key: 'choisir-FSY-I47' })
  expect(await bande.find({ key: 'renommer' })).toBeUndefined()
  await horloge.advance(2_000)
  await bande.press({ key: 'choisir-FSY-I47' })
  expect(await bande.find({ key: 'renommer' })).toBeUndefined()
  await bande.press({ key: 'choisir-FSY-I47' })
  expect(await bande.find({ key: 'renommer' })).toBeDefined()
  await bande.input({ key: 'renommer', text: 'FSY-I47' })
  expect(await bande.find({ key: 'renommer' })).toBeUndefined()

  // L'app ne signale pas un clic hors de la bande : trois secondes sans frappe, le champ se quitte seul. Un nom inchangé
  // le referme ; un nouveau nom s'enregistre.
  await bande.press({ key: 'crayon' })
  await horloge.advance(2_000)
  expect(await bande.find({ key: 'renommer' })).toBeDefined()
  await horloge.advance(1_500)
  await horloge.settle()
  expect(await bande.find({ key: 'renommer' })).toBeUndefined()
  await puceAffiche(puce, 'FSY-I47', '20 min')
  // ✓ enregistre tout de suite.
  await bande.press({ key: 'crayon' })
  await bande.input({ key: 'renommer', text: 'FSY-I476', kind: 'change' })
  await bande.press({ key: 'valider-renommage' })
  await horloge.settle()
  expect(await bande.find({ key: 'renommer' })).toBeUndefined()
  await puceAffiche(puce, 'FSY-I476', '20 min')
  await bande.press({ key: 'crayon' })
  await bande.input({ key: 'renommer', text: 'FSY-I477', kind: 'change' })
  await horloge.advance(3_500)
  await horloge.settle()
  expect(await bande.find({ key: 'renommer' })).toBeUndefined()
  await puceAffiche(puce, 'FSY-I477', '20 min')
  await bande.press({ key: 'crayon' })
  await bande.input({ key: 'renommer', text: 'FSY-I478' })
  await puceAffiche(puce, 'FSY-I478', '20 min')
  expect(await ligneDe($, 'FSY-I478')).toContain('20 min')

  // Quitter le champ sans rien changer le referme ; avec un nouveau nom, il l'enregistre, comme Entrée.
  const quitter = () => $.ui.focus({ component: 'AbovePrompt', requestId: BANDE.requestId, element: 'onglet-semaine', origin: { kind: 'person' } })
  await bande.press({ key: 'crayon' })
  await quitter()
  expect(await bande.find({ key: 'renommer' })).toBeUndefined()
  await puceAffiche(puce, 'FSY-I478', '20 min')
  await bande.press({ key: 'crayon' })
  await bande.input({ key: 'renommer', text: 'FSY-I479', kind: 'change' })
  await quitter()
  await horloge.settle()
  expect(await bande.find({ key: 'renommer' })).toBeUndefined()
  await puceAffiche(puce, 'FSY-I479', '20 min')
  // Ni masquer ni retirer : les lignes n'ont plus que ⇄ ou le crayon.
  expect(await bande.find({ key: 'retirer-FSY-I478' })).toBeUndefined()
  expect(await bande.find({ key: 'masquer-FSY-I478' })).toBeUndefined()
  await puce.unmount()
  await bande.unmount()
})

test('les tokens, les onglets, les réglages et la frise', async ($, on) => {
  const { horloge, etat } = monde(on)
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
    await bande.press({ key: 'onglet-annee' })
    expect(await bande.find({ type: 'Text', text: /^2026$/ })).toBeDefined()
    await bande.press({ key: 'precedent' })
    expect(await bande.find({ type: 'Text', text: /^2025$/ })).toBeDefined()
    await bande.press({ key: 'onglet-tout' })
    expect(await bande.find({ type: 'Text', text: /^Depuis le 12 novembre$/ })).toBeDefined()
    expect(await bande.find({ key: 'precedent' })).toBeUndefined()

    await bande.press({ key: 'reglages' })
    // Dans le terminal, une liste déroulante ne s'ouvre qu'au clavier : chaque choix y est un bouton.
    if (surface === 'terminal') {
      await bande.press({ key: 'seuil-30' })
      expect((await bande.find({ key: 'seuil-30' }))?.text).toBe('● 30 min')
      expect((await bande.find({ key: 'seuil-60' }))?.text).toBe('○ 1 h')
      // Une durée qui n'est pas un nombre entier d'heures se lit en minutes.
      expect((await bande.find({ key: 'seuil-90' }))?.text).toBe('○ 90 min')
      // Les noms des langues suivent la langue de l'interface.
      expect([(await bande.find({ key: 'langue-fr' }))?.text, (await bande.find({ key: 'langue-en' }))?.text]).toEqual(['● Français', '○ Anglais'])
      await bande.press({ key: 'seuil-60' })
      await bande.press({ key: 'pause-max-480' })
      expect((await bande.find({ key: 'pause-max-480' }))?.text).toBe('● 8 h')
      await bande.press({ key: 'pause-max-240' })
      // « Puis demander » ne propose que « Jamais » et des durées plus longues que « Rester actif pendant ».
      await bande.press({ key: 'seuil-120' })
      expect([await bande.find({ key: 'pause-max-60' }), await bande.find({ key: 'pause-max-120' })]).toEqual([undefined, undefined])
      expect([(await bande.find({ key: 'pause-max-0' }))?.text, (await bande.find({ key: 'pause-max-240' }))?.text]).toEqual(['○ Jamais', '● 4 h'])
      await bande.press({ key: 'seuil-60' })
    } else expect([await bande.find({ key: 'seuil' }), await bande.find({ key: 'pause-max' })]).not.toContain(undefined)
    // Les tokens s'affichent toujours : plus de réglage pour les cacher.
    expect(await bande.find({ key: 'reglage-jetons' })).toBeUndefined()
    // Les thèmes (là où la surface dessine) : un aperçu par thème ; un clic choisit le sien, en gras sous son aperçu.
    if (surface === 'desktop') {
      expect(await bande.find({ type: 'Text', text: /^Nuit$/ })).toMatchObject({ props: { weight: 'semibold' } })
      await bande.press({ key: 'theme-simple' })
      expect(await bande.find({ type: 'Text', text: /^Par défaut$/ })).toMatchObject({ props: { weight: 'semibold' } })
      expect(await bande.find({ type: 'Text', text: /^Nuit$/ })).toMatchObject({ props: { weight: 'regular' } })
      // Toute la carte se clique : des bandes empilées la couvrent, le haut de l'aperçu comme le nom.
      await bande.press({ key: 'theme-sakura#0' })
      expect(await bande.find({ type: 'Text', text: /^Sakura$/ })).toMatchObject({ props: { weight: 'semibold' } })
      for (const cle of ['theme-sakura#0', 'theme-sakura#1', 'theme-sakura#2', 'theme-sakura#3', 'theme-sakura']) expect(await bande.find({ key: cle })).toBeDefined()
      // Au clavier, une carte n'est qu'un arrêt : le focus qui tombe sur une bande en trop va à la carte ; en arrière, à la
      // carte d'avant, ou au réglage au-dessus des thèmes.
      const focus = async (element: string) => {
        await $.ui.focus({ component: 'AbovePrompt', requestId: BANDE.requestId, element, origin: { kind: 'person' } })
        return etat.focus.at(-1)
      }
      expect(await focus('pause-max')).toBe('pause-max')
      expect(await focus('theme-simple#0')).toBe('theme-simple')
      expect(await focus('theme-nuit#0')).toBe('theme-nuit')
      expect(await focus('theme-nuit#3')).toBe('theme-simple')
      expect(await focus('theme-simple#3')).toBe('pause-max')
      await bande.press({ key: 'theme-nuit' })
      expect(await bande.find({ type: 'Text', text: /^Nuit$/ })).toMatchObject({ props: { weight: 'semibold' } })
    } else expect(await bande.find({ key: 'theme-nuit' })).toBeUndefined()
    // La croix ramène à l'onglet d'avant : Tout.
    await bande.press({ key: 'reglages' })
    expect(await bande.find({ type: 'Text', text: /^Depuis le 12 novembre$/ })).toBeDefined()
    await puce.press({ key: 'puce' })
    await puce.unmount()
    await bande.unmount()
  }
})

type Noeud = { type?: string; props?: Record<string, unknown>; children?: Noeud[] }
/** La boîte qui contient directement l'élément de clé `cle`. */
function parentDe(n: Noeud, cle: string): Noeud | undefined {
  for (const enfant of n.children ?? []) {
    if (enfant.props?.key === cle) return n
    const trouve = parentDe(enfant, cle)
    if (trouve !== undefined) return trouve
  }
  return undefined
}

test('« Afficher : Tokens et prix » : le prix prend la place du temps, et les stats restent groupées', async ($, on) => {
  const { horloge } = monde(on, ['desktop'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1', 10)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  await bande.press({ key: 'reglages' })
  await bande.select({ key: 'mesure', value: 'jetons' })
  await bande.press({ key: 'reglages' })
  expect(await bande.find({ type: 'Text', text: /^Temps$/ })).toBeUndefined()
  expect(await bande.find({ type: 'Text', text: /^Prix API$/ })).toBeDefined()
  // Les stats restent côte à côte, sans grand vide entre elles.
  const stats = parentDe((await bande.drawn()) as Noeud, 'stat-jetons')
  expect(stats?.props).toMatchObject({ flexDirection: 'row' })
  expect(stats?.props?.justifyContent).toBeUndefined()
  // Dans la ligne, les tokens gardent leur place et leur taille ; le prix prend celle du temps.
  expect(await bande.find({ type: 'Text', text: /^1 k tokens$/ })).toMatchObject({ props: { size: 'caption' } })
  expect(await bande.find({ type: 'Text', text: /^10 min$/ })).toBeUndefined()
  // La croix des réglages : grise, comme l'engrenage.
  await bande.press({ key: 'reglages' })
  expect(await bande.find({ type: 'Text', text: /^✕$/ })).toBeUndefined()
  await puce.unmount()
  await bande.unmount()
})

const PRIX_FICHIER = 'C:/Users/test/.claude/worklog/prix.json'
const LITELLM = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

test("le prix API est toujours calculé ; « Tokens et prix » l'affiche à la place du temps, dans la ligne et dans les stats", async ($, on) => {
  const { horloge, fichiers } = monde(on, ['desktop'])
  // Des prix gardés ce matin : le mod ne les télécharge pas de nouveau.
  fichiers.set(PRIX_FICHIER, JSON.stringify({ maj: h(8), modeles: { 'claude-opus-5-5': { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5 } } }))
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'FLO-I1 : une tâche' })
  await horloge.advance(10 * 60_000)
  await $.turn.complete({
    ...FIN_DE_TOUR,
    usage: { model: 'claude-opus-5-5', input_tokens: 1_000, output_tokens: 100_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  })
  await horloge.settle()
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  // Par défaut, « Temps et tokens » : le prix n'est pas affiché.
  expect(await bande.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  await bande.press({ key: 'reglages' })
  await bande.select({ key: 'mesure', value: 'jetons' })
  await bande.press({ key: 'reglages' })
  // 1 000 tokens lus à 4 $ le million, 100 000 écrits à 20 $ le million.
  expect(await bande.find({ type: 'Text', text: /^101 k tokens$/ })).toBeDefined()
  // Le prix de la ligne et celui des stats ; puis, dans les trois bulles du détail (tokens et prix des stats, tokens de la
  // ligne), celui de la sortie et celui d'Opus.
  expect((await bande.findAll({ type: 'Text', text: /^2,00 \$$/ })).length).toBe(2 + 3 * 2)
  // Pas de note sous le prix : le détail suffit.
  expect(await bande.find({ type: 'Text', text: /facture/ })).toBeUndefined()
  // Le détail, au survol : chaque type de token et chaque modèle, avec ses tokens et son prix.
  expect((await bande.findAll({ type: 'Text', text: /^Sortie$/ })).length).toBe(3)
  expect((await bande.findAll({ type: 'Text', text: /^Opus 5\.5$/ })).length).toBe(3)
  expect((await bande.findAll({ type: 'Text', text: /^100 k$/ })).length).toBe(3)
  await puce.unmount()
  await bande.unmount()
})

test("sans prix gardés, le mod télécharge la liste de LiteLLM et n'en garde que les modèles Claude d'Anthropic", async ($, on) => {
  const { horloge, fichiers } = monde(on)
  const demandes: string[] = []
  const liste = {
    'claude-opus-5-5': {
      litellm_provider: 'anthropic',
      input_cost_per_token: 4e-6,
      output_cost_per_token: 2e-5,
      input_cost_per_token_batches: 2e-6,
      max_output_tokens: 128_000,
      provider_specific_entry: { us: 1.1, fast: 2 },
    },
    'claude-opus-5-5-sur-bedrock': { litellm_provider: 'bedrock', input_cost_per_token: 1 },
    'gpt-x': { litellm_provider: 'openai', input_cost_per_token: 1 },
  }
  on('http.fetch', (_, e) => {
    demandes.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(liste) } }
  })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await horloge.settle()
  expect(demandes).toEqual([LITELLM])
  expect(JSON.parse(fichiers.get(PRIX_FICHIER) ?? 'null')).toEqual({
    maj: h(9),
    modeles: { 'claude-opus-5-5': { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5, provider_specific_entry: { us: 1.1, fast: 2 } } },
  })
})

test("un téléchargement des prix raté ne se retente pas à chaque import", async ($, on) => {
  const { horloge } = monde(on)
  let demandes = 0
  on('http.fetch', () => {
    demandes++
    return { value: { status: 503, ok: false, headers: {}, text: '' } }
  })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await horloge.settle()
  expect(demandes).toBe(1)
  // L'import suivant, cinq minutes plus tard, ne retente pas encore : il attend une heure.
  await horloge.advance(6 * 60_000)
  await horloge.settle()
  expect(demandes).toBe(1)
})

test('des prix arrivés pendant que Worklog est ouvert redessinent la frise, jours passés compris', async ($, on) => {
  const { horloge, fichiers } = monde(on, ['desktop'])
  // Le téléchargement est retenu jusqu'à ce que le test le libère.
  let liberer = () => {}
  const attente = new Promise<void>(r => {
    liberer = r
  })
  const liste = { 'claude-opus-5-5': { litellm_provider: 'anthropic', input_cost_per_token: 4e-6, output_cost_per_token: 2e-5 } }
  on('http.fetch', async () => {
    await attente
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(liste) } }
  })
  // Hier, des tokens détaillés : 1 000 lus et 100 000 écrits sur Opus 5.5, soit 2 $ au tarif de l'API.
  fichiers.set(
    'C:/Users/test/.claude/worklog/journal/2026-11-11/S0.jsonl',
    `${JSON.stringify({ t: new Date(2026, 10, 11, 10).getTime(), s: 'S0', e: 'jetons', n: 101_000, k: 'FLO-I1', p: [{ m: 'claude-opus-5-5', in: 1_000, out: 100_000, c5: 0, c1: 0, cr: 0 }] })}\n`,
  )
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await horloge.settle()
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  await bande.press({ key: 'reglages' })
  await bande.select({ key: 'mesure', value: 'jetons' })
  await bande.press({ key: 'reglages' })
  const caseDHier = async () => {
    const svgs = await bande.findAll({ type: 'Svg' })
    const source = svgs.map(x => String((x.props as { source?: unknown })?.source ?? '')).find(x => /<rect class="c\d+ k"/.test(x)) ?? ''
    const valeurs = /Mercredi 11 novembre<\/tspan>((?:<tspan[^>]*>[^<]*<\/tspan>)*)<\/text>/.exec(source)?.[1] ?? ''
    return [...valeurs.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(x => x[1]).join(' · ')
  }
  expect(await caseDHier()).toBe('101 k · — · FLO-I1')
  liberer()
  await horloge.settle()
  expect(await caseDHier()).toBe('101 k · 2,00 $ · FLO-I1')
  await puce.unmount()
  await bande.unmount()
})

test('avec WORKLOG_PRICES=off, le mod ne télécharge pas les prix', async ($, on) => {
  const { horloge, fichiers } = monde(on, ['terminal'], { WORKLOG_PRICES: 'off' })
  const demandes: string[] = []
  on('http.fetch', (_, e) => {
    demandes.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await horloge.settle()
  expect(demandes).toEqual([])
  expect(fichiers.has(PRIX_FICHIER)).toBe(false)
})

test("une liste dont un prix change de plus de deux fois est refusée ; les réglages disent de quel jour sont les prix", async ($, on) => {
  const { horloge, fichiers } = monde(on)
  // Des prix gardés hier : le mod en télécharge de nouveaux, dix fois plus chers.
  const garde = JSON.stringify({ maj: new Date(2026, 10, 11, 8).getTime(), modeles: { 'claude-opus-5-5': { input_cost_per_token: 4e-6 } } })
  fichiers.set(PRIX_FICHIER, garde)
  let demandes = 0
  const liste = { 'claude-opus-5-5': { litellm_provider: 'anthropic', input_cost_per_token: 4e-5 } }
  on('http.fetch', () => {
    demandes++
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(liste) } }
  })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1', 1)
  expect(demandes).toBe(1)
  expect(fichiers.get(PRIX_FICHIER)).toBe(garde)

  for (const surface of ['terminal', 'desktop'] as const) {
    const bande = await $.ui.mount({ ...BANDE, surface })
    const puce = await $.ui.mount({ ...(surface === 'terminal' ? LIGNE_AIDE : PIED), surface })
    await puce.press({ key: 'puce' })
    await bande.press({ key: 'reglages' })
    // Dans le terminal, une ligne sous « Afficher » ; dans l'app desktop, l'aide de « Afficher ».
    expect(await bande.find({ type: 'Text', text: /^Prix API : liste LiteLLM du mercredi 11 novembre\.$/ })).toBeDefined()
    await bande.press({ key: 'reglages' })
    await puce.press({ key: 'puce' })
    await puce.unmount()
    await bande.unmount()
  }
})

test("avec WORKLOG_MESSAGES=off, le mod ne cherche pas d'ID dans les messages, ni dans l'historique", async ($, on) => {
  const { horloge, fichiers, toasts, etat } = monde(on, ['terminal'], { WORKLOG_MESSAGES: 'off' })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'Corrige le bug FLO-I165 stp', 10)
  expect(toasts).toEqual([])
  const lignes = fichiers.get(JOURNAL)!.trim().split('\n').map(l => JSON.parse(l) as { e: string; k: string | null })
  expect(lignes.map(l => `${l.e}:${l.k}`)).toEqual(['ouverture:null', 'message:null', 'reponse:null', 'jetons:null'])
  // L'importeur reçoit les deux dossiers, sans motif.
  const importeur = etat.commandes.find(c => c[0] === 'node')
  expect(importeur?.length).toBe(4)
})

test("le moteur sépare l'écrit pour 5 min de l'écrit pour 1 h : chacun garde son prix", async ($, on) => {
  const { horloge, fichiers } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'FLO-I1' })
  await horloge.advance(60_000)
  // Ces deux champs viennent du moteur, sans être dans ses types.
  const usage = { model: 'm', input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 3_000, cache_read_input_tokens: 40, ephemeral_5m_input_tokens: 2_000, ephemeral_1h_input_tokens: 1_000 }
  await $.turn.complete({ ...FIN_DE_TOUR, usage })
  // Sans ce détail, tout l'écrit compte pour 1 h.
  await $.turn.complete({ ...FIN_DE_TOUR, usage: { model: 'm', input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 500, cache_read_input_tokens: 0 } })
  await horloge.settle()
  const details = fichiers.get(JOURNAL)!.trim().split('\n').map(l => JSON.parse(l) as { e: string; p?: { c5: number; c1: number }[] }).filter(l => l.e === 'jetons')
  expect(details.map(l => l.p?.map(p => `${p.c5}/${p.c1}`))).toEqual([['2000/1000'], ['0/500']])
})

test("dans une bande étroite et basse de l'app desktop, la frise laisse la place à la liste et au pied", async ($, on) => {
  const { horloge } = monde(on, ['desktop'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1', 10)
  await travailler($, horloge, 'FLO-I2', 5)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  const dessin = async (props: { maxRows: number; bodyColumns: number }) => {
    const bande = await $.ui.mount({ ...BANDE, props: { ...BANDE.props, ...props }, surface: 'desktop' })
    const svgs = await bande.findAll({ type: 'Svg' })
    const frise = svgs.some(x => /<rect class="c\d+ k"/.test(String((x.props as { source?: unknown })?.source ?? '')))
    const ajouter = (await bande.find({ key: 'autre' })) !== undefined
    await bande.unmount()
    return { frise, ajouter }
  }
  // Étroite, la frise irait sous les stats : dans 12 rangées, elle couperait la liste et le pied.
  expect(await dessin({ maxRows: 12, bodyColumns: 70 })).toEqual({ frise: false, ajouter: true })
  // Avec la hauteur qu'il faut, ou assez large pour la mettre à côté des stats, elle revient.
  expect(await dessin({ maxRows: 30, bodyColumns: 70 })).toEqual({ frise: true, ajouter: true })
  expect(await dessin({ maxRows: 12, bodyColumns: 120 })).toEqual({ frise: true, ajouter: true })
  await puce.unmount()
})

test("dans le terminal, la frise prend la place qu'il y a, et la liste remplit sa hauteur", async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  for (let i = 1; i <= 8; i++) await travailler($, horloge, `FLO-I${i}`, 9 - i)
  const puce = await $.ui.mount({ ...LIGNE_AIDE, surface: 'terminal' })
  await puce.press({ key: 'puce' })
  const bande = async (props: { maxRows?: number; bodyColumns?: number }) => {
    const dessin = await $.ui.mount({ ...BANDE, props: { ...BANDE.props, ...props }, surface: 'terminal' })
    const raster = (await dessin.find({ key: 'frise-cases' }))?.props
    const pages = (await dessin.find({ type: 'Text', text: /sur 8$/ }))?.text
    await dessin.unmount()
    return { raster, pages }
  }
  // Large et haute : toute l'année en cases, sept lignes ; la liste en montre cinq, la hauteur de la frise.
  expect(await bande({})).toMatchObject({ raster: { rows: 7, columns: 53 }, pages: '1–5 sur 8' })
  // Basse : la frise serrée sur quatre lignes, deux lignes de liste.
  expect(await bande({ maxRows: 8 })).toMatchObject({ raster: { rows: 4 }, pages: '1–2 sur 8' })
  // Étroite : les semaines qui tiennent à côté de la liste (pastille, nom, « 1 k tokens », « 8 min ») ; trop étroite :
  // pas de frise, deux lignes de liste.
  expect(await bande({ bodyColumns: 80 })).toMatchObject({ raster: { columns: 27 } })
  expect(await bande({ bodyColumns: 60 })).toMatchObject({ raster: undefined, pages: '1–2 sur 8' })
  // Très large : deux colonnes par semaine, des cases carrées. Moins large : deux colonnes par semaine dès que les
  // semaines passées tiennent ; les semaines à venir, vides, ne sont pas montrées.
  expect(await bande({ bodyColumns: 200 })).toMatchObject({ raster: { rows: 7, columns: 106 } })
  expect(await bande({ bodyColumns: 158 })).toMatchObject({ raster: { rows: 7, columns: 92 } })
  await puce.unmount()
})

test("taper /worklog n'est pas une activité : le journal n'en garde aucun message", async ($, on) => {
  const { fichiers } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: '/worklog', command: { name: 'worklog', args: '' } })
  expect(fichiers.get(JOURNAL)!.trim().split('\n').filter(l => l.includes('"e":"message"'))).toEqual([])
})

test('la liste va par pages : chaque item reste joignable', async ($, on) => {
  const { horloge } = monde(on, ['desktop'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  for (let i = 1; i <= 8; i++) await travailler($, horloge, `FLO-I${i}`, 9 - i)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const panneau = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  // Rien d'autre dans la bande : la pile espacée ne tient que la carte, sans écart dessous.
  const pile = (await panneau.drawn()) as { children: { children?: unknown[] }[] }
  expect(pile.children[0]!.children).toHaveLength(1)
  expect(await panneau.find({ type: 'Text', text: /^1–4 sur 8$/ })).toBeDefined()
  await panneau.press({ key: 'page-suivante' })
  expect(await panneau.find({ type: 'Text', text: /^5–8 sur 8$/ })).toBeDefined()
  expect(await panneau.find({ type: 'Text', text: /^FLO-I1$/ })).toBeDefined()
  await panneau.press({ key: 'page-precedente' })
  expect(await panneau.find({ type: 'Text', text: /^1–4 sur 8$/ })).toBeDefined()
  await puce.unmount()
  await panneau.unmount()
})

test('en anglais par défaut : la puce, le popover et la commande', async ($, on) => {
  const { horloge, toasts } = monde(on, ['terminal'], {}, 'en')
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'Fix FLO-I165 please', 10)
  expect(toasts).toContain('Counting time for FLO-I165')
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  expect(await bande.find({ type: 'Text', text: /^Today$/ })).toBeDefined()
  expect(await bande.find({ type: 'Text', text: /^Week$/ })).toBeDefined()
  expect(await bande.find({ type: 'Text', text: /^Time$/ })).toBeDefined()
  await puce.unmount()
  await bande.unmount()
  expect((await $.command.run({ ...COMMANDE, args: 'checkout-api' })).text).toBe('This session now counts for checkout-api.')
})

test("un item sans temps ni tokens n'a pas de ligne ; seul l'item de la session en garde une", async ($, on) => {
  // FLO-I9 est un item récent d'un autre jour : rien dans le journal d'aujourd'hui.
  const { horloge } = monde(on, ['desktop'], {}, 'fr', { recents: ['FLO-I9'] })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1', 10)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  expect(await bande.find({ type: 'Text', text: /^FLO-I1$/ })).toBeDefined()
  expect(await bande.find({ type: 'Text', text: /^FLO-I9$/ })).toBeUndefined()
  await puce.unmount()
  await bande.unmount()
})

test("« Ajouter un item » : quitter le champ, ✓ ou trois secondes sans frappe passent sur le nom tapé ; un champ vide ou sans lettre se ferme", async ($, on) => {
  const { horloge } = monde(on, ['desktop'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1', 10)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  const nomPuce = async () => (await puce.find({ key: 'puce' }))?.text ?? ''
  const quitter = () => $.ui.focus({ component: 'AbovePrompt', requestId: BANDE.requestId, element: 'onglet-semaine', origin: { kind: 'person' } })
  // Vide, ou sans lettre ni chiffre : le champ se ferme, la session garde son item.
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: '   ', kind: 'change' })
  await quitter()
  expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: '---', kind: 'change' })
  await bande.press({ key: 'valider-autre' })
  await horloge.settle()
  expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
  expect(await nomPuce()).toContain('FLO-I1')
  // Un nom tapé : quitter le champ, ✓, ou trois secondes sans frappe passent dessus.
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: 'FLO-I2', kind: 'change' })
  await quitter()
  await horloge.settle()
  expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
  expect(await nomPuce()).toContain('FLO-I2')
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: 'FLO-I3', kind: 'change' })
  await bande.press({ key: 'valider-autre' })
  await horloge.settle()
  expect(await nomPuce()).toContain('FLO-I3')
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: 'FLO-I4', kind: 'change' })
  await horloge.advance(2_000)
  expect(await bande.find({ key: 'autre-item' })).toBeDefined()
  await horloge.advance(1_500)
  await horloge.settle()
  expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
  expect(await nomPuce()).toContain('FLO-I4')
  // Un message envoyé dans le chat ferme le champ vide (l'app ne signale pas un clic hors de la bande).
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: ' ', kind: 'change' })
  await $.prompt.submit({ ...PROMPT, text: 'on continue' })
  await horloge.settle()
  expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
  await puce.unmount()
  await bande.unmount()
})

test("l'item de la session est toujours en tête : un nouvel item, ou celui sur lequel on passe, monte en haut", async ($, on) => {
  const { horloge } = monde(on, ['desktop'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1', 30)
  await travailler($, horloge, 'FLO-I2', 10)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  const premier = async () => (await bande.findAll({ type: 'Text', text: /^FLO-I\d$/ })).map(x => x.text)[0]
  expect(await premier()).toBe('FLO-I2')
  // Un item créé par « Ajouter un item » devient celui de la session, et monte en tête.
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: 'FLO-I9' })
  expect(await premier()).toBe('FLO-I9')
  // Passer sur FLO-I1 le met en haut ; FLO-I9, sans temps ni tokens, n'a plus de ligne.
  await bande.press({ key: 'choisir-FLO-I1' })
  expect((await bande.findAll({ type: 'Text', text: /^FLO-I\d$/ })).map(x => x.text)).toEqual(['FLO-I1', 'FLO-I2'])
  await puce.unmount()
  await bande.unmount()
})

test('dans VS Code, le panneau s\'ouvre avec le fond du thème ; Simple, sans fond propre, garde celui de l\'app', async ($, on) => {
  const { horloge, etat } = monde(on, ['vscode'], {}, 'fr', { options: { langue: 'fr', theme: 'simple' } })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1', 10)
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toBe('Panneau ouvert.')
  expect(etat.fonds.at(-1)).toBeUndefined()
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await bande.press({ key: 'reglages' })
  await bande.press({ key: 'theme-nuit' })
  expect((await $.command.run({ ...COMMANDE, args: '' })).text).toBe('Panneau ouvert.')
  expect(etat.fonds.at(-1)).toMatch(/^#[0-9A-F]{6}$/)
  await puce.unmount()
  await bande.unmount()
})

test('un long silence demande « Du travail ? », et la réponse compte', async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I165 : on commence', 5)
  await horloge.advance(70 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'je reviens' })
  await horloge.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const bande = await $.ui.mount({ ...BANDE, surface })
    expect(await bande.find({ type: 'Text', text: /Pause de 1 h 10 sur FLO-I165/ })).toBeDefined()
    await bande.unmount()
  }
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await bande.press({ key: 'ecart-oui' })
  expect(await bande.find({ type: 'Text', text: /Pause de/ })).toBeUndefined()
  await bande.unmount()
  expect(await ligneDe($, 'FLO-I165')).toContain('1 h 15')
})

test('/worklog ouvre et ferme, ou nomme la session', async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })

  // Seul, il ouvre Worklog au-dessus de la saisie, puis le ferme.
  for (const [texte, ouvert] of [['Ouvert au-dessus de la saisie.', true], ['Fermé.', false]] as const) {
    expect((await $.command.run({ ...COMMANDE, args: '' })).text).toBe(texte)
    const bande = await $.ui.mount({ ...BANDE, surface: 'terminal' })
    expect((await bande.find({ key: 'onglet-jour' })) !== undefined).toBe(ouvert)
    await bande.unmount()
  }

  // Tout autre texte devient le nom de la session : un ticket, ou un nom libre.
  expect((await $.command.run({ ...COMMANDE, args: 'FSY-I478' })).text).toBe('Cette session compte maintenant pour FSY-I478.')
  expect((await $.command.run({ ...COMMANDE, args: 'site client' })).text).toBe('Cette session compte maintenant pour site client.')
  await horloge.advance(5 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'suite' })
  await horloge.settle()
  expect(await ligneDe($, 'site client')).toBeDefined()
  // « stop » ou « pause » n'arrêtent rien et ne deviennent pas le nom de la session.
  expect((await $.command.run({ ...COMMANDE, args: 'Stop' })).text).toContain('Rien à arrêter')
  expect((await $.command.run({ ...COMMANDE, args: 'pause' })).text).toContain('Rien à arrêter')
  expect(await ligneDe($, 'stop')).toBeUndefined()
  // Un nom sans lettre ni chiffre est refusé.
  expect((await $.command.run({ ...COMMANDE, args: '---' })).text).toContain('Ce nom ne convient pas')
  expect(await ligneDe($, '---')).toBeUndefined()
})

test("une pause ne compte qu'au retour : courte, elle s'ajoute ; plus longue, une question ; trop longue, rien", { timeoutMs: 15_000 }, async ($, on) => {
  // Des réglages courts, pour un test rapide : compter jusqu'à 15 min, demander jusqu'à 1 h.
  const { horloge } = monde(on, ['terminal'], {}, 'fr', { options: { langue: 'fr', seuilPause: 15, pauseMax: 60 } })
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  const question = async () => {
    const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
    const texte = (await bande.find({ type: 'Text', text: /Pause de/ }))?.text
    await bande.unmount()
    return texte
  }
  await travailler($, horloge, 'FLO-I165 : une tâche', 10)
  // Claude a fini : le temps attend, la session n'est pas en cours.
  await horloge.advance(10 * 60_000)
  await horloge.settle()
  expect(await ligneDe($, 'FLO-I165')).toStartWith('○')
  expect(await ligneDe($, 'FLO-I165')).toContain('10 min')

  // Le retour, 10 minutes après : la pause s'ajoute, sans question.
  await travailler($, horloge, 'suite', 5)
  expect(await ligneDe($, 'FLO-I165')).toContain('25 min')
  expect(await question()).toBeUndefined()

  // 30 minutes de pause : une question au retour.
  await horloge.advance(30 * 60_000)
  await travailler($, horloge, 'je reviens', 1)
  expect(await question()).toContain('Pause de 30 min')

  // 1 h 30 : rien ne compte, pas de question. Avec « Puis demander : jusqu'à 2 h », la même pause pose la question.
  await horloge.advance(90 * 60_000)
  await travailler($, horloge, 'plus tard', 1)
  expect(await question()).toBeUndefined()
  await $.command.run({ ...COMMANDE, args: '' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'terminal' })
  await bande.press({ key: 'reglages' })
  await bande.press({ key: 'pause-max-120' })
  await bande.unmount()
  await horloge.advance(90 * 60_000)
  await travailler($, horloge, 'encore', 1)
  expect(await question()).toContain('Pause de 1 h 30')
})

test("les agents d'un workflow (Ultracode), absents de la liste des agents, font compter le temps", { timeoutMs: 15_000 }, async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I165 : lance le workflow', 1)
  // Deux heures sans message : seuls les tours des agents du workflow montrent qu'il travaille.
  for (let i = 0; i < 30; i++) {
    await horloge.advance(4 * 60_000)
    await $.turn.start({ text: '', turnId: `w${i}`, agentId: 'workflow-1' })
  }
  await horloge.settle()
  // Le workflow travaille encore : la ligne est active, et ses deux heures comptent.
  const ligne = await ligneDe($, 'FLO-I165')
  expect(ligne).toContain('●')
  expect(ligne).toContain('2 h 01')
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  expect(await bande.find({ type: 'Text', text: /Pause de/ })).toBeUndefined()
  await bande.unmount()
})

test('quand des sous-agents travaillent deux heures, le temps compte et aucune question ne vient', { timeoutMs: 15_000 }, async ($, on) => {
  const { horloge, etat, fichiers } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I165 : lance le workflow', 1)
  etat.agents = [{ id: 'a1', status: 'running' }]
  await horloge.advance(120 * 60_000)
  // Pendant ce long travail, leur début est noté de nouveau au bout d'une heure : le signe qu'ils travaillent encore.
  expect((fichiers.get(JOURNAL) ?? '').split('\n').filter(l => l.includes('"agents-debut"')).length).toBe(2)
  etat.agents = [{ id: 'a1', status: 'completed' }]
  await horloge.advance(60_000)
  await $.prompt.submit({ ...PROMPT, text: 'je regarde le résultat' })
  await horloge.settle()

  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  expect(await bande.find({ type: 'Text', text: /Pause de/ })).toBeUndefined()
  await bande.unmount()
  expect(await ligneDe($, 'FLO-I165')).toContain('2 h 02')
})

test("quand un sous-agent a fini, la session n'est plus en cours et son temps s'arrête tout de suite", async ($, on) => {
  const { horloge, etat } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I165 : lance un agent', 1)
  etat.agents = [{ id: 'a1', status: 'running' }]
  await $.turn.start({ text: 'le brief', turnId: 'a1-t', agentId: 'a1' })
  await horloge.advance(20 * 60_000)
  await $.turn.complete({ ...FIN_DE_TOUR, turnId: 'a1-t', agentId: 'a1' })
  etat.agents = [{ id: 'a1', status: 'completed' }]
  await horloge.advance(2 * 60_000)
  await horloge.settle()
  const ligne = await ligneDe($, 'FLO-I165')
  expect(ligne).toStartWith('○')
  expect(ligne).toContain('21 min')
})

test("une commande de fond que Claude attend garde la session en cours ; sa fin arrête le temps", async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I165 : lance les extractions', 1)
  // Le tour finit, mais une commande tourne encore en fond : Claude attend sa fin.
  const extraction = { id: 'b1', type: 'shell', status: 'running', description: 'extractions', command: 'node extraire.mjs' }
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [extraction] })
  await horloge.advance(40 * 60_000)
  await horloge.settle()
  const pendant = await ligneDe($, 'FLO-I165')
  expect(pendant).toStartWith('●')
  expect(pendant).toContain('41 min')
  // La commande finit : sa notification réveille Claude, qui conclut ; plus rien ne tourne en fond.
  await $.prompt.submit({ ...PROMPT, text: 'extractions finies', origin: { kind: 'task-notification' } } as never)
  await horloge.advance(2 * 60_000)
  await $.turn.complete({ ...FIN_DE_TOUR, usage: { model: 'm', input_tokens: 1_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await horloge.advance(10 * 60_000)
  await horloge.settle()
  const apres = await ligneDe($, 'FLO-I165')
  expect(apres).toStartWith('○')
  expect(apres).toContain('43 min')
})

test("après une longue pause, la question vient aussi quand on nomme la session avant d'écrire", async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I165 : une tâche', 10)
  await horloge.advance(2 * 60 * 60_000)
  await $.command.run({ ...COMMANDE, args: 'FSY-I478' })
  await horloge.advance(60_000)
  await $.prompt.submit({ ...PROMPT, text: 'suite' })
  await horloge.settle()
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  expect((await bande.find({ type: 'Text', text: /Pause de/ }))?.text).toContain('Pause de 2 h 00 sur FLO-I165')
  await bande.unmount()
})

test("recharger les mods pendant une longue réponse ne coupe pas son temps", { timeoutMs: 15_000 }, async ($, on) => {
  const { horloge } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ ...PROMPT, text: 'FLO-I165 : une longue tâche' })
  await horloge.advance(30 * 60_000)
  await horloge.settle()
  // /reload-plugins : le moteur relance session.start dans le même processus, encore vivant.
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await horloge.advance(60 * 60_000)
  await $.turn.complete({ ...FIN_DE_TOUR, usage: { model: 'm', input_tokens: 1_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
  await horloge.settle()
  expect(await ligneDe($, 'FLO-I165')).toContain('1 h 30')
})

/** Ce qu'une réponse d'Opus 5.5 a relu et écrit dans le cache. */
const reponseOpus = (lu: number, ecrit = 0): TurnUsage => ({
  model: 'claude-opus-5-5',
  input_tokens: 10,
  output_tokens: 200,
  cache_creation_input_tokens: ecrit,
  cache_read_input_tokens: lu,
})

/** Un appel au modèle, de la conversation principale ou d'un sous-agent, et sa réponse. */
async function appel($: Engine, etat: { reponses: (TurnUsage | null)[] }, reponse: TurnUsage | null, agentId?: string) {
  etat.reponses.push(reponse)
  for await (const c of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 3, ...(agentId === undefined ? {} : { agentId }) })) void c
}

type Trouve = { text?: string; props?: Record<string, unknown> }

test("la puce du cache, dans l'en-tête : pleine après un appel, ambre ses dix dernières minutes, puis froide ; sa carte attend le survol", { timeoutMs: 15_000 }, async ($, on) => {
  const { horloge, fichiers, etat, statuts } = monde(on, ['desktop', 'vscode'])
  fichiers.set(PRIX_FICHIER, JSON.stringify({ maj: h(8), modeles: { 'claude-opus-5-5': { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5 } } }))
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await horloge.settle()
  const pied = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await pied.press({ key: 'puce' })
  const puce = async () => (await bande.find({ key: 'puce-cache' })) as Trouve | undefined
  // Avant le premier appel, rien à dire du cache.
  expect(await puce()).toBeUndefined()
  expect(await bande.find({ key: 'carte-cache' })).toBeUndefined()

  etat.contexte = 150_000
  await appel($, etat, reponseOpus(150_000))
  await horloge.settle()
  expect((await puce())?.text).toBe('Cache 1 h 00')
  expect(statuts.at(-1)).toContain('Cache 1 h 00')
  // La carte est dans le popover, cachée jusqu'au survol de la puce.
  const carte = (await bande.find({ key: 'carte-cache' })) as Trouve | undefined
  expect(carte?.props?.display).toBe('none')
  // Prix Anthropic : 150 k tokens relus à 0,40 $ le million, ou réécrits pour 1 h à 8 $.
  for (const morceau of ['Cache chaud', 'encore 1 h 00 sur 1 h', 'Expire à', '10 h 00', 'Dernier appel', '9 h 00', '150 k tokens', '≈ 0,06 $', '≈ 1,20 $']) {
    expect(carte?.text).toContain(morceau)
  }

  // Dix minutes avant le froid, la puce passe à l'ambre.
  await horloge.advance(50 * 60_000 + 1)
  const ambre = (await bande.find({ type: 'Text', text: /^Cache 10 min$/ })) as Trouve | undefined
  expect(ambre?.props?.color).toBe('#E6D06A')

  await horloge.advance(10 * 60_000)
  expect((await puce())?.text).toBe('Cache froid')
  expect(statuts.at(-1)).toContain('Cache froid')
  const froide = (await bande.find({ key: 'carte-cache' }))?.text ?? ''
  for (const morceau of ['Cache froid', 'Expiré à', '10 h 00', 'réécrit tout le contexte']) expect(froide).toContain(morceau)
  // Froid, le prochain message coûte la réécriture ; chaud, il aurait coûté la relecture.
  expect(froide.indexOf('≈ 1,20 $')).toBeLessThan(froide.indexOf('≈ 0,06 $'))

  // Chaque réglage a son aide, cachée jusqu'au survol de son icône ⓘ.
  await bande.press({ key: 'reglages' })
  const aide = (await bande.find({ key: 'bulle-aide-cache' })) as Trouve | undefined
  expect(aide?.props?.display).toBe('none')
  expect(aide?.text).toContain('le cache reste chaud')
  // Sa carte a la couleur des cartes au survol du thème (Nuit).
  expect(((await bande.find({ key: 'carte-aide-cache' })) as Trouve | undefined)?.props).toMatchObject({ backgroundColor: '#151B30', borderColor: '#2C3453' })
  expect(await bande.find({ key: 'info-pauseMax' })).toBeDefined()
  expect(await bande.find({ key: 'info-seuil' })).toBeUndefined()
  expect(await bande.find({ key: 'info-activite' })).toBeUndefined()
  // Le réglage cache la puce et sa carte.
  await bande.press({ key: 'interrupteur-cache' })
  expect(await puce()).toBeUndefined()
  expect(await bande.find({ key: 'carte-cache' })).toBeUndefined()
  await pied.unmount()
  await bande.unmount()
})

test("dans le terminal, la puce du cache est dans l'en-tête, sans carte", async ($, on) => {
  const { horloge, etat } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  etat.contexte = 40_000
  await appel($, etat, reponseOpus(40_000))
  await horloge.settle()
  const ligne = await $.ui.mount({ ...LIGNE_AIDE, surface: 'terminal' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'terminal' })
  await ligne.press({ key: 'puce' })
  expect((await bande.find({ key: 'puce-cache' }))?.text?.trim()).toBe('Cache 1 h 00')
  expect(await bande.find({ key: 'carte-cache' })).toBeUndefined()
  await ligne.unmount()
  await bande.unmount()
})

test("le cache suit la reprise d'une session, le changement de modèle et le résumé ; les sous-agents n'y touchent pas", async ($, on) => {
  const { horloge, etat } = monde(on, ['desktop'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  const pied = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await pied.press({ key: 'puce' })
  const puce = async () => (await bande.find({ key: 'puce-cache' }))?.text

  // Reprise deux heures après le dernier appel : froid.
  await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 7_200, context_tokens: 80_000, prompt_cache_likely_expired: true, model: 'claude-opus-5-5' })
  await horloge.settle()
  expect(await puce()).toBe('Cache froid')
  expect((await bande.find({ key: 'carte-cache' }))?.text).toContain('80 k tokens')
  // Reprise dix minutes après, froid selon le moteur : ce cache vivait 5 min.
  await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 600, context_tokens: 80_000, prompt_cache_likely_expired: true, model: 'claude-opus-5-5' })
  await horloge.settle()
  expect(await puce()).toBe('Cache froid')

  // Un sous-agent a son propre cache : celui de la conversation reste froid.
  await appel($, etat, reponseOpus(50_000), 'agent-1')
  await horloge.settle()
  expect(await puce()).toBe('Cache froid')
  // Le premier appel réécrit le contexte, pour 5 min.
  await appel($, etat, reponseOpus(0, 80_000))
  await horloge.settle()
  expect(await puce()).toBe('Cache 5 min')
  expect((await bande.find({ key: 'carte-cache' }))?.text).toContain('encore 5 min sur 5 min')
  // Un appel sans réponse ne touche pas le cache.
  await horloge.advance(3 * 60_000)
  await appel($, etat, null)
  await horloge.settle()
  expect(await puce()).toBe('Cache 2 min')

  // Un autre modèle n'a pas ce cache.
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-sonnet-5-5',
    requested_model: 'sonnet',
    source: 'command',
    context_tokens: 80_000,
    prompt_cache_warm: true,
    cache_ttl: '1h',
    estimated_cache_write_usd: 0.5,
    pricing: 'catalog',
  })
  await horloge.settle()
  expect(await puce()).toBe('Cache froid')
  expect((await bande.find({ key: 'carte-cache' }))?.text).toContain('nouveau modèle : Sonnet 5.5')

  // Un résumé remplace la conversation : la puce attend le prochain appel.
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'résumé', toolUses: [] }] })
  await horloge.settle()
  expect(await bande.find({ key: 'puce-cache' })).toBeUndefined()
  await pied.unmount()
  await bande.unmount()
})

test("un prix sous le centime garde son « < » sans « ≈ » devant", async ($, on) => {
  const { horloge, fichiers, etat } = monde(on, ['desktop'])
  fichiers.set(PRIX_FICHIER, JSON.stringify({ maj: h(8), modeles: { 'claude-opus-5-5': { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5 } } }))
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  etat.contexte = 1_000
  await appel($, etat, reponseOpus(1_000))
  await horloge.settle()
  const pied = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await pied.press({ key: 'puce' })
  const carte = (await bande.find({ key: 'carte-cache' }))?.text ?? ''
  expect(carte).toContain('< 0,01 $')
  expect(carte).not.toContain('≈ <')
  await pied.unmount()
  await bande.unmount()
})
