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
  const etat = { session: 'S1', branche: 'main', agents: [] as { id: string; status: string }[], fonds: [] as (string | undefined)[] }
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
  on('process.run', (_, e) => ({
    value: { exitCode: e.argv[0] === 'node' ? 1 : 0, stdout: `${etat.branche}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('agent.list', () => ({ value: etat.agents.map(a => ({ ...a, description: 'agent', type: 'general-purpose' })) as never }))
  on('session.id', () => ({ value: etat.session }))
  on('session.cwd', () => ({ value: 'D:/WORK/FSY' }))
  on('session.repo', () => ({ value: null }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  // L'app n'accepte pour le fond d'un panneau qu'une couleur à six chiffres (ou un nom de thème) : on note ce qu'il reçoit.
  on('ui.open', (_, e) => {
    etat.fonds.push(e.backgroundColor)
    return { value: { isPlaced: true } }
  })
  // Sous le mod, le focus se pose sans rien dire.
  on('ui.focus', () => ({}))
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
  expect(statuts.at(-1)).toBe('⏱ FLO-I165 · 10 min · /temps')
  // /temps jour : le texte du jour.
  expect((await $.command.run({ ...COMMANDE, args: 'jour' })).text).toContain('  FLO-I165   10 min')

  for (const [surface, site] of [['terminal', LIGNE_AIDE], ['desktop', PIED]] as const) {
    const puce = await $.ui.mount({ ...site, surface })
    const bande = await $.ui.mount({ ...BANDE, surface })
    await puceAffiche(puce, 'FLO-I165', '10 min')
    expect(await bande.find({ key: 'onglet-jour' })).toBeUndefined()
    await puce.press({ key: 'puce' })
    expect(await bande.find({ key: 'onglet-jour' })).toBeDefined()
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

  // VS Code n'a ni bande ni puce à cliquer : /temps y ouvre le panneau.
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
  expect((await $.command.run({ ...COMMANDE, args: 'jour' })).text).toContain('FSY-I9')

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

test("sans item, le temps va au groupe de l'app desktop ; « Ajouter un item » accepte un nom libre", async ($, on) => {
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
  await puceAffiche(puce, 'Codepath', '15 min')

  await puce.press({ key: 'puce' })
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: 'Refonte menu' })
  // Un item choisi à la main compte à partir du choix : les 15 minutes restent au groupe.
  await puceAffiche(puce, 'Refonte menu', '0 min')
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
  await puceAffiche(puce, 'FLO-I1', '10 min')

  etat.session = 'S2'
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...COMMANDE, args: 'FLO-I1' })
  await travailler($, horloge, 'encore', 15)
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  await puceAffiche(puce, 'FLO-I1', '15 min')
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

  await bande.press({ key: 'crayon' })
  await bande.input({ key: 'renommer', text: 'FSY-I478' })
  await puceAffiche(puce, 'FSY-I478', '20 min')
  expect((await $.command.run({ ...COMMANDE, args: 'jour' })).text).toContain('  FSY-I478   20 min')
  // Ni masquer ni retirer : les lignes n'ont plus que ⇄ ou le crayon.
  expect(await bande.find({ key: 'retirer-FSY-I478' })).toBeUndefined()
  expect(await bande.find({ key: 'masquer-FSY-I478' })).toBeUndefined()
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
      expect((await bande.find({ key: 'seuil-30' }))?.text).toBe('● 30')
      expect((await bande.find({ key: 'seuil-45' }))?.text).toBe('○ 45')
      await bande.press({ key: 'seuil-45' })
    } else expect(await bande.find({ key: 'seuil' })).toBeDefined()
    // Les tokens s'affichent toujours : plus de réglage pour les cacher.
    expect(await bande.find({ key: 'reglage-jetons' })).toBeUndefined()
    // Les thèmes (là où la surface dessine) : un aperçu par thème ; un clic choisit le sien, en gras sous son aperçu.
    if (surface === 'desktop') {
      expect(await bande.find({ type: 'Text', text: /^Nuit$/ })).toMatchObject({ props: { weight: 'semibold' } })
      await bande.press({ key: 'theme-simple' })
      expect(await bande.find({ type: 'Text', text: /^Simple$/ })).toMatchObject({ props: { weight: 'semibold' } })
      expect(await bande.find({ type: 'Text', text: /^Nuit$/ })).toMatchObject({ props: { weight: 'regular' } })
      await bande.press({ key: 'theme-nuit' })
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

test('« Afficher : Tokens » : les stats restent groupées, et les tokens prennent la place du temps', async ($, on) => {
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
  // Deux stats sur trois : elles restent côte à côte, sans grand vide entre elles.
  const stats = parentDe((await bande.drawn()) as Noeud, 'stat-jetons')
  expect(stats?.props).toMatchObject({ flexDirection: 'row' })
  expect(stats?.props?.justifyContent).toBeUndefined()
  // Dans la ligne, les tokens ont la taille et l'encre du temps.
  expect(await bande.find({ type: 'Text', text: /^1 k tokens$/ })).toMatchObject({ props: { size: 'footnote' } })
  // La croix des réglages : grise, comme l'engrenage.
  await bande.press({ key: 'reglages' })
  expect(await bande.find({ type: 'Text', text: /^✕$/ })).toBeUndefined()
  await puce.unmount()
  await bande.unmount()
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
  // Large et haute : toute l'année en cases, sept lignes ; la liste en montre six, la hauteur de la frise.
  expect(await bande({})).toMatchObject({ raster: { rows: 7, columns: 53 }, pages: '1–6 sur 8' })
  // Basse : la frise serrée sur quatre lignes, trois lignes de liste.
  expect(await bande({ maxRows: 8 })).toMatchObject({ raster: { rows: 4 }, pages: '1–3 sur 8' })
  // Étroite : les semaines qui tiennent ; trop étroite : pas de frise, deux lignes de liste.
  expect(await bande({ bodyColumns: 80 })).toMatchObject({ raster: { columns: 22 } })
  expect(await bande({ bodyColumns: 60 })).toMatchObject({ raster: undefined, pages: '1–2 sur 8' })
  await puce.unmount()
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
  expect((await $.command.run({ ...COMMANDE, args: 'week' })).text).toContain('This week')
  expect((await $.command.run({ ...COMMANDE, args: 'nope' })).text).toStartWith('"nope" is neither a command nor an item ID.')
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

test('un champ vide ou sans lettre se ferme quand le focus le quitte ; un nom tapé le garde ouvert', async ($, on) => {
  const { horloge } = monde(on, ['desktop'])
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })
  await travailler($, horloge, 'FLO-I1', 10)
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await puce.press({ key: 'puce' })
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: '   ', kind: 'change' })
  await $.ui.focus({ component: 'AbovePrompt', requestId: BANDE.requestId, element: 'onglet-semaine', origin: { kind: 'person' } })
  expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
  await bande.press({ key: 'autre' })
  await bande.input({ key: 'autre-item', text: 'FLO-I2', kind: 'change' })
  await $.ui.focus({ component: 'AbovePrompt', requestId: BANDE.requestId, element: 'onglet-semaine', origin: { kind: 'person' } })
  expect(await bande.find({ key: 'autre-item' })).toBeDefined()
  // Resté vide, le champ se ferme seul quelques secondes après la dernière frappe ; avec un nom, il reste.
  await horloge.advance(7_000)
  expect(await bande.find({ key: 'autre-item' })).toBeDefined()
  await bande.input({ key: 'autre-item', text: '', kind: 'change' })
  await horloge.advance(7_000)
  expect(await bande.find({ key: 'autre-item' })).toBeUndefined()
  await bande.press({ key: 'autre' })
  // Un message envoyé dans le chat ferme le champ vide (l'app ne signale pas un clic hors de la bande).
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
  expect((await $.command.run({ ...COMMANDE, args: 'panneau' })).text).toBe('Panneau ouvert.')
  expect(etat.fonds.at(-1)).toBeUndefined()
  const puce = await $.ui.mount({ ...PIED, surface: 'desktop' })
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await bande.press({ key: 'reglages' })
  await bande.press({ key: 'theme-nuit' })
  expect((await $.command.run({ ...COMMANDE, args: 'panneau' })).text).toBe('Panneau ouvert.')
  expect(etat.fonds.at(-1)).toMatch(/^#[0-9A-F]{6}$/)
  await puce.unmount()
  await bande.unmount()
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
    expect(await bande.find({ type: 'Text', text: /50 min sans activité sur FLO-I165/ })).toBeDefined()
    await bande.unmount()
  }
  const bande = await $.ui.mount({ ...BANDE, surface: 'desktop' })
  await bande.press({ key: 'ecart-oui' })
  expect(await bande.find({ type: 'Text', text: /sans activité/ })).toBeUndefined()
  await bande.unmount()
  expect((await $.command.run({ ...COMMANDE, args: 'jour' })).text).toContain('  FLO-I165   55 min')
})

test('les sous-commandes : ouvrir, item, pause, silences, mois, erreur', async ($, on) => {
  const { horloge, fichiers } = monde(on)
  await $.session.start({ cwd: 'D:/WORK/FSY', surface: 'terminal', isInteractive: true })

  // /temps seul ouvre le popover au-dessus de la saisie ; relancé, il le laisse ouvert.
  for (let fois = 0; fois < 2; fois++) {
    expect((await $.command.run({ ...COMMANDE, args: '' })).text).toBe('Ouvert au-dessus de la saisie.')
    const bande = await $.ui.mount({ ...BANDE, surface: 'terminal' })
    expect(await bande.find({ key: 'onglet-jour' })).toBeDefined()
    await bande.unmount()
  }

  expect((await $.command.run({ ...COMMANDE, args: 'FSY-I478' })).text).toBe('Item de cette session : FSY-I478.')
  await horloge.advance(50 * 60_000)
  await $.prompt.submit({ ...PROMPT, text: 'suite' })
  await horloge.settle()
  expect((await $.command.run({ ...COMMANDE, args: 'jour' })).text).toContain('1 silence à classer : /temps silences')
  expect((await $.command.run({ ...COMMANDE, args: 'silences' })).text).toContain(
    '  1. jeudi 12 novembre, FSY-I478, de 9 h 00 à 9 h 50 (50 min)',
  )
  expect((await $.command.run({ ...COMMANDE, args: 'silences 1 pause' })).text).toBe('1 silence classé comme pause.')
  expect((await $.command.run({ ...COMMANDE, args: 'silences' })).text).toBe('Aucun silence à classer sur les 7 derniers jours.')

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
  expect(await bande.find({ type: 'Text', text: /sans activité/ })).toBeUndefined()
  await bande.unmount()
  expect((await $.command.run({ ...COMMANDE, args: 'jour' })).text).toContain('  FLO-I165   2 h 02')
})
