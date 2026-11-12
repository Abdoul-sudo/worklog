import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Apercu, Ecart, Ligne } from '../types'
import {
  type Activite,
  type Choix,
  type Evenement,
  REGLAGES_PAR_DEFAUT,
  type Reglages,
  SANS_ITEM,
  ajouterRecent,
  bilan,
  cleJour,
  debutJour,
  decalerJours,
  dernierEvenement,
  detecterItem,
  dureeEcart,
  estUnItem,
  formatDuree,
  formatHeure,
  jourSuivant,
  libellePuce,
  lireLignes,
  lireReglages,
  motifsDuProjet,
  nomDuGroupe,
} from './calcul'
import { aide, listeEcarts, recapJour, recapSemaine } from './texte'

type Moteur = EngineInterface
type Site = Parameters<Moteur['ui']['resolve']>[0]

const PANNEAU = 'temps-item'
const TITRE = 'Temps par item'
const RAFRAICHISSEMENT_MS = 30_000
// Les tours qui partent seuls (tâche planifiée, observateur) ne comptent pas.
const AUTOMATIQUES = ['scheduled-trigger', 'observer', 'observer-activity']
// L'ID de l'item se cherche dans ce qu'une personne a écrit, ou dans le brief d'une session lancée par une autre.
const ECRITS = ['composer', 'bridge', 'sdk', 'slack-ping', 'coordinator', 'projects-relay']

const apercu = atom({ plugin: 'temps-item', key: 'apercu' } as const, null, { shape: 'apercu-4' })
const question = atom({ plugin: 'temps-item', key: 'question' } as const, null, { shape: 'question-2' })
const deplie = atom({ plugin: 'temps-item', key: 'deplie' } as const, false)

let chemins: { reglages: string; journal: string } | null = null
let ecritures: Promise<unknown> = Promise.resolve()
let tourCompte = true
let heritageClear: { item: string; manuel: boolean } | null = null
let brancheVue: string | null = null
let nomParDefaut: string | null = null
let erreurSignalee = false

/** Travail lancé sans l'attendre : une erreur (session fermée, module rechargé) ne casse rien. */
const enFond = (travail: Promise<unknown>) => void travail.catch(() => undefined)

async function dossiers($: Moteur) {
  if (chemins === null) {
    const maison = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    const config = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${maison}/.claude`).replace(/\\/g, '/')
    chemins = { reglages: `${config}/temps.json`, journal: `${config}/temps/journal` }
  }
  return chemins
}

async function chargerReglages($: Moteur): Promise<Reglages> {
  const { reglages: fichier } = await dossiers($)
  const texte = (await $.fs.exists(fichier)) ? await $.fs.read(fichier) : undefined
  const { reglages, erreur } = lireReglages(texte)
  if (erreur !== undefined && !erreurSignalee) {
    erreurSignalee = true
    $.ui.toast(`Temps par item : réglages ignorés, ${erreur} (${fichier}).`)
  }
  return reglages
}

async function motifsIci($: Moteur): Promise<string[]> {
  return motifsDuProjet(await chargerReglages($), await $.session.cwd())
}

/** Ajoute un événement au journal du jour de sa session. Les écritures passent une par une. */
function noter($: Moteur, ev: Evenement): Promise<void> {
  const ecriture = ecritures.then(async () => {
    const { journal } = await dossiers($)
    const fichier = `${journal}/${cleJour(ev.t)}/${ev.s}.jsonl`
    const avant = (await $.fs.exists(fichier)) ? await $.fs.read(fichier) : ''
    await $.fs.write(fichier, `${avant}${JSON.stringify(ev)}\n`)
  })
  ecritures = ecriture.catch(() => undefined)
  return ecriture
}

/** Signe de vie de la session : la date du fichier `.vivant`, réécrit à chaque rafraîchissement. */
async function donnerSigneDeVie($: Moteur): Promise<void> {
  const { journal } = await dossiers($)
  await $.fs.write(`${journal}/${cleJour(await $.clock.now())}/${await $.session.id()}.vivant`, '')
}

/** Les événements des jours [debut, fin[ et le dernier signe de vie de chaque session. */
async function lireJournal($: Moteur, debut: number, fin: number) {
  const { journal } = await dossiers($)
  const evenements: Evenement[] = []
  const vivants = new Map<string, number>()
  for (let jour = debut; jour < fin; jour = jourSuivant(jour)) {
    const dossier = `${journal}/${cleJour(jour)}`
    const fichiers = (await $.fs.exists(dossier)) ? await $.fs.list(dossier) : []
    for (const { name, mtimeMs } of fichiers) {
      if (name.endsWith('.jsonl')) evenements.push(...lireLignes(await $.fs.read(`${dossier}/${name}`)))
      if (name.endsWith('.vivant')) {
        const session = name.slice(0, -'.vivant'.length)
        vivants.set(session, Math.max(vivants.get(session) ?? 0, mtimeMs))
      }
    }
  }
  return { evenements, vivants }
}

async function itemDe($: Moteur, session: string): Promise<string | null> {
  const enregistre = await $.store.get(`item:${session}`)
  if (typeof enregistre === 'string') return enregistre
  if (heritageClear === null) return null
  // Après /clear, la nouvelle session garde l'item de l'ancienne.
  const { item, manuel } = heritageClear
  heritageClear = null
  await definirItem($, session, item, manuel)
  return item
}

/** Un item choisi à la main ne change plus tout seul. */
async function estManuel($: Moteur, session: string): Promise<boolean> {
  return (await $.store.get(`manuel:${session}`)) === true
}

async function lireRecents($: Moteur): Promise<string[]> {
  const recents = await $.store.get('recents')
  return Array.isArray(recents) ? recents.filter((t): t is string => typeof t === 'string') : []
}

/** Fixe l'item de la session et le garde dans les items récents. */
async function definirItem($: Moteur, session: string, item: string, manuel: boolean): Promise<void> {
  await $.store.set(`item:${session}`, item)
  await $.store.set(`manuel:${session}`, manuel)
  await $.store.set('recents', ajouterRecent(await lireRecents($), item))
}

/**
 * Le nom par défaut de la session : son groupe dans l'app desktop, sinon le nom du projet.
 * L'app desktop range les groupes dans sa config, à côté du dossier `claude-code` de son exécutable.
 */
async function calculerNomParDefaut($: Moteur): Promise<string | null> {
  const hote = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  const executable = (await $.env.get('CLAUDE_CODE_EXECPATH'))?.replace(/\\/g, '/')
  const dossierApp = executable?.includes('/claude-code/') ? executable.split('/claude-code/')[0] : undefined
  if (hote !== undefined && dossierApp !== undefined) {
    const config = await $.fs.read(`${dossierApp}/claude_desktop_config.json`).catch(() => '')
    const groupe = nomDuGroupe(config, hote)
    if (groupe !== null) return groupe
  }
  const racine = (await $.session.repo())?.root ?? (await $.session.cwd())
  return racine.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || null
}

/** L'ID de la branche Git, seulement quand la branche a changé depuis la dernière lecture. */
async function itemDeNouvelleBranche($: Moteur, motifs: readonly string[]): Promise<string | null> {
  const git = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5_000 }).catch(() => null)
  const branche = git?.exitCode === 0 ? git.stdout.trim() : ''
  if (branche === brancheVue) return null
  brancheVue = branche
  return detecterItem(branche, motifs)
}

async function noterActivite($: Moteur, e: Activite): Promise<number> {
  const s = await $.session.id()
  const t = await $.clock.now()
  nomParDefaut ??= await calculerNomParDefaut($)
  const d = nomParDefaut ?? undefined
  await noter($, { t, s, e, k: await itemDe($, s), ...(d === undefined ? {} : { d }) })
  return t
}

async function changerItem($: Moteur, item: string): Promise<void> {
  await definirItem($, await $.session.id(), item, true)
  await noterActivite($, 'item')
  await rafraichir($)
}

async function classer($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  const t = await $.clock.now()
  await noter($, { t, s: await $.session.id(), e: 'classement', session: ecart.session, debut: ecart.debut, choix })
}

/** Recalcule la journée pour la puce et la liste. */
async function rafraichir($: Moteur): Promise<Apercu> {
  const maintenant = await $.clock.now()
  const session = await $.session.id()
  const reglages = await chargerReglages($)
  const jour = debutJour(maintenant)
  nomParDefaut = await calculerNomParDefaut($)
  await donnerSigneDeVie($)
  const { evenements, vivants } = await lireJournal($, decalerJours(jour, -1), jourSuivant(jour))
  const b = bilan(evenements, reglages, maintenant, jour, jourSuivant(jour), vivants)
  const item = (await itemDe($, session)) ?? nomParDefaut
  const enPause = dernierEvenement(evenements, session)?.e === 'pause'
  const aujourdhui = b.jours[0]
  const lignes = aujourdhui?.lignes ?? []
  const vu: Apercu = {
    jour,
    lignes,
    total: aujourdhui?.total ?? 0,
    reel: aujourdhui?.reel ?? 0,
    item,
    enPause,
    ecarts: b.ecarts,
    recents: await lireRecents($),
    minutesSession: b.parSession.get(session) ?? 0,
  }
  await update($, apercu, () => vu)
  // VS Code n'affiche pas la zone au-dessus de la saisie : la ligne de statut la remplace.
  const dansVsCode = (await $.session.surfaces()).includes('vscode')
  $.ui.status(dansVsCode ? libellePuce(item, vu.minutesSession, enPause) : undefined)
  return vu
}

async function apresMessage($: Moteur, texte: string, chercherItem: boolean): Promise<void> {
  const session = await $.session.id()
  if (!(await estManuel($, session))) {
    const motifs = await motifsIci($)
    const deBranche = await itemDeNouvelleBranche($, motifs)
    const nouveau = (chercherItem ? detecterItem(texte, motifs) : null) ?? deBranche
    if (nouveau !== null && nouveau !== (await itemDe($, session))) {
      await definirItem($, session, nouveau, false)
      $.ui.toast(`Temps compté pour ${nouveau}`)
    }
  }
  const t = await noterActivite($, 'message')
  const vu = await rafraichir($)
  const ecart = vu.ecarts.find(x => x.session === session && x.fin === t) ?? null
  await update($, question, () => ecart)
}

async function repondre($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  await classer($, ecart, choix)
  await update($, question, () => null)
  await rafraichir($)
}

async function commande($: Moteur, args: string): Promise<string> {
  const mots = args.split(/\s+/).filter(Boolean)
  const reglages = await chargerReglages($)
  const maintenant = await $.clock.now()
  const jour = debutJour(maintenant)
  const semaine = decalerJours(jour, -6)
  const surSemaine = async () => {
    const { evenements, vivants } = await lireJournal($, decalerJours(semaine, -1), jourSuivant(jour))
    return bilan(evenements, reglages, maintenant, semaine, jourSuivant(jour), vivants)
  }

  switch (mots[0]?.toLowerCase()) {
    case undefined: {
      const b = await surSemaine()
      return recapJour(jour, { ...b, jours: b.jours.filter(j => j.debut === jour) }, b.ecarts)
    }
    case 'semaine': {
      const b = await surSemaine()
      return recapSemaine(b, b.ecarts)
    }
    case 'stop':
    case 'pause':
      await noterActivite($, 'pause')
      await rafraichir($)
      return 'Compteur en pause pour cette session. Il repart à votre prochain message.'
    case 'confirmer':
      return confirmer($, mots.slice(1), (await surSemaine()).ecarts)
    case 'panneau':
      await $.ui.open({ id: PANNEAU, title: TITRE })
      return 'Panneau ouvert.'
    case 'aide':
      return aide((await dossiers($)).reglages)
  }
  if (mots.length === 1 && estUnItem(mots[0]!, motifsDuProjet(reglages, await $.session.cwd()))) {
    await changerItem($, mots[0]!)
    return `Item de cette session : ${mots[0]}.`
  }
  return `« ${args} » n'est ni une commande ni un ID d'item.\n\n${aide((await dossiers($)).reglages)}`
}

async function confirmer($: Moteur, mots: string[], ecarts: Ecart[]): Promise<string> {
  if (mots.length === 0) return listeEcarts(ecarts).join('\n')
  const choix = mots.at(-1)?.toLowerCase()
  const cibles = mots.slice(0, -1)
  const numeros = cibles.map(Number)
  const valides = numeros.every(n => Number.isInteger(n) && n >= 1 && n <= ecarts.length)
  if ((choix !== 'travail' && choix !== 'pause') || cibles.length === 0 || (cibles[0] !== 'tout' && !valides)) {
    return ['Je ne comprends pas. Exemple : /temps confirmer 1 travail', '', ...listeEcarts(ecarts)].join('\n')
  }
  const choisis = cibles[0] === 'tout' ? ecarts : [...new Set(numeros)].map(n => ecarts[n - 1]!)
  for (const ecart of choisis) await classer($, ecart, choix)
  await update($, question, () => null)
  await rafraichir($)
  const s = choisis.length > 1 ? 's' : ''
  return `${choisis.length} écart${s} classé${s} comme ${choix}.`
}

/** Les items du jour, puis les items récents sans temps aujourd'hui : six lignes au plus. */
function lignesAAfficher(vu: Apercu): Ligne[] {
  const vus = new Set(vu.lignes.map(l => l.item))
  const recents = vu.recents.filter(t => !vus.has(t)).map(item => ({ item, minutes: 0, enCours: false }))
  return [...vu.lignes, ...recents].slice(0, 6)
}

/** La liste du jour : un clic sur une ligne la choisit pour cette session. Dans la bande et dans le panneau. */
function liste($: Moteur, e: Site, vu: Apercu) {
  const { Box, Button, Input, Text } = $.ui.resolve(e)
  const choisir = async (item: string) => {
    await update($, deplie, () => false)
    if (item !== vu.item) await changerItem($, item)
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>Aujourd'hui</Text>
        <Text bold>{formatDuree(vu.total)}</Text>
      </Box>
      {lignesAAfficher(vu).map(l => {
        const texte = l.minutes > 0 ? `${l.item} · ${formatDuree(l.minutes)}` : l.item
        if (l.item === vu.item) {
          return (
            <Text bold>
              <Text color="success">● </Text>
              {texte}
            </Text>
          )
        }
        if (l.item === SANS_ITEM) return <Text dimColor>{`  ${texte}`}</Text>
        return (
          <Box key={`ligne-${l.item}`}>
            <Button
              key={`choisir-${l.item}`}
              plain
              label={`  ${texte}`}
              hover={{ backgroundColor: 'subtle' }}
              onPress={() => choisir(l.item)}
            />
          </Box>
        )
      })}
      <Input
        key="autre-item"
        placeholder="Autre : ID ou nom, puis Entrée"
        onSubmit={async texte => {
          const item = texte.trim().slice(0, 60)
          if (item !== '') await choisir(item)
        }}
      />
    </Box>
  )
}

/** La puce : `⏱ FSY-I478 · 1 h 12`, discrète ; un clic ouvre ou ferme la liste. */
function puce($: Moteur, e: Site, vu: Apercu) {
  const { Box, Button } = $.ui.resolve(e)
  return (
    <Box key="zone-puce">
      <Button
        key="puce"
        plain
        dimColor
        label={libellePuce(vu.item, vu.minutesSession, vu.enPause)}
        hover={{ dimColor: false, backgroundColor: 'subtle' }}
        onPress={() => update($, deplie, v => !v)}
      />
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'temps',
      description: 'Temps par item : récapitulatif du jour, de la semaine, changement d’item',
      argumentHint: '[semaine | <item> | stop | confirmer | aide]',
      immediate: true,
    })
    const { reglages } = await dossiers($)
    if (!(await $.fs.exists(reglages))) await $.fs.write(reglages, `${JSON.stringify(REGLAGES_PAR_DEFAUT, null, 2)}\n`)
    const session = await $.session.id()
    const deBranche = await itemDeNouvelleBranche($, await motifsIci($))
    if (deBranche !== null && (await itemDe($, session)) === null) await definirItem($, session, deBranche, false)
    await noterActivite($, 'ouverture')
    enFond(rafraichir($))
    $.clock.every(RAFRAICHISSEMENT_MS, () => enFond(rafraichir($)))
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (e.command?.name === 'temps') return next(e)
    tourCompte = !AUTOMATIQUES.includes(e.origin.kind)
    if (tourCompte) enFond(apresMessage($, e.text, e.isMeta !== true && ECRITS.includes(e.origin.kind)))
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && tourCompte) enFond(noterActivite($, 'reponse').then(() => rafraichir($)))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const item = await itemDe($, e.sessionId)
    if (e.reason === 'clear' && item !== null) heritageClear = { item, manuel: await estManuel($, e.sessionId) }
    await noter($, { t: await $.clock.now(), s: e.sessionId, e: 'fermeture', k: item })
    return next(e)
  })

  on('command.run', { command: 'temps' }, async ($, e) => ({ text: await commande($, e.args.trim()) }))

  on('ui.render', { component: 'Pane', requestId: PANNEAU }, async ($, e) => {
    const vu = await read($, apercu)
    if (vu !== null) return liste($, e, vu)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>Calcul en cours…</Text>
  })

  // Terminal : la puce va sur la ligne sous la saisie. L'app desktop ne dessine pas cette ligne.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const vu = await read($, apercu)
    const ligne = await next(e)
    if (vu === null || e.surface !== 'terminal') return ligne
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={2}>
        {puce($, e, vu)}
        {ligne}
      </Box>
    )
  })

  // App desktop : la puce va en bas, devant le mode de la session (« Bypass permissions »).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const vu = await read($, apercu)
    const modes = await next(e)
    if (vu === null || e.surface === 'terminal') return modes
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={2} alignItems="center">
        {puce($, e, vu)}
        {modes}
      </Box>
    )
  })

  // Au-dessus de la saisie : la liste quand elle est ouverte, et la question après un long silence.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const vu = await read($, apercu)
    if (vu === null || e.props.hasSurvey) return next(e)
    const ecart = await read($, question)
    const ouvert = await read($, deplie)
    if (!ouvert && ecart === null) return next(e)
    const autres = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap={1}>
        {ouvert && liste($, e, vu)}
        {ecart !== null && (
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text>
              {dureeEcart(ecart)} sans message sur {ecart.item} ({formatHeure(ecart.debut)} → {formatHeure(ecart.fin)}). Du
              travail ?
            </Text>
            <Button key="ecart-oui" label="Oui" variant="primary" onPress={() => repondre($, ecart, 'travail')} />
            <Button key="ecart-non" label="Non" variant="secondary" onPress={() => repondre($, ecart, 'pause')} />
          </Box>
        )}
        {autres}
      </Box>
    )
  })
}
