import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ecart, Frise, Interface, Ligne, Onglet, Reglages, Session, Vue } from '../types'
import { SEMAINES, cases, cellulesActivite, svgActivite } from './activite'
import {
  type Activite,
  type Choix,
  type Corrections,
  type Evenement,
  type Periode,
  type Retrait,
  SANS_ITEM,
  SEUILS,
  ajouterRecent,
  bilan,
  bornes,
  cleJour,
  debutJour,
  debutSemaine,
  decalerJours,
  dernierEvenement,
  detecterItem,
  dureeEcart,
  estUnItem,
  formatDuree,
  formatHeure,
  formatJetons,
  jourSuivant,
  libellePuce,
  lireLignes,
  lireOptions,
  motifValide,
  nomDuGroupe,
  nommer,
} from './calcul'
import { aide, listeEcarts, recap } from './texte'

type Moteur = EngineInterface
type Site = Parameters<Moteur['ui']['resolve']>[0]

const PANNEAU = 'temps-item'
const TITRE = 'Temps par item'
const DOSSIER_DONNEES = 'temps'
const RAFRAICHISSEMENT_MS = 30_000
// Les tours qui partent seuls (tâche planifiée, observateur) ne comptent pas.
const AUTOMATIQUES = ['scheduled-trigger', 'observer', 'observer-activity']
// L'ID de l'item se cherche dans ce qu'une personne a écrit, ou dans le brief d'une session lancée par une autre.
const ECRITS = ['composer', 'bridge', 'sdk', 'slack-ping', 'coordinator', 'projects-relay']
const ONGLETS: { id: Onglet; libelle: string }[] = [
  { id: 'jour', libelle: 'Jour' },
  { id: 'semaine', libelle: 'Semaine' },
  { id: 'mois', libelle: 'Mois' },
]
const INTERFACE_INITIALE: Interface = { onglet: 'jour', decalage: 0, edition: null, annulation: null }

const session = atom({ plugin: 'temps-item', key: 'session' } as const, null, { shape: 'session-1' })
const question = atom({ plugin: 'temps-item', key: 'question' } as const, null, { shape: 'question-2' })
const deplie = atom({ plugin: 'temps-item', key: 'deplie' } as const, false)
const ui = atom({ plugin: 'temps-item', key: 'ui' } as const, INTERFACE_INITIALE, { shape: 'ui-2' })
const vue = atom({ plugin: 'temps-item', key: 'vue' } as const, null, { shape: 'vue-1' })
const frise = atom({ plugin: 'temps-item', key: 'frise' } as const, null, { shape: 'frise-1' })
const reglages = atom({ plugin: 'temps-item', key: 'reglages' } as const, null, { shape: 'reglages-1' })

let chemins: { journal: string } | null = null
let ecritures: Promise<unknown> = Promise.resolve()
let tourCompte = true
let heritageClear: { item: string; manuel: boolean } | null = null
let brancheVue: string | null = null
let nomParDefaut: string | null = null
// Dernier état connu des sous-agents de la session : null tant qu'il n'est pas lu.
let agentsOccupes: boolean | null = null
// Minutes des jours passés pour la frise, recalculées une fois par jour ou après une correction.
let friseCalculeeLe: string | null = null
const minutesPassees = new Map<string, number>()

/** Travail lancé sans l'attendre : une erreur (session fermée, module rechargé) ne casse rien. */
const enFond = (travail: Promise<unknown>) => void travail.catch(() => undefined)

async function dossiers($: Moteur) {
  if (chemins === null) {
    const maison = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    const config = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${maison}/.claude`).replace(/\\/g, '/')
    chemins = { journal: `${config}/${DOSSIER_DONNEES}/journal` }
  }
  return chemins
}

async function lireReglages($: Moteur): Promise<Reglages> {
  return lireOptions(await $.store.get('options'))
}

async function lireCorrections($: Moteur): Promise<Corrections> {
  const renommages = await $.store.get('renommages')
  const retraits = await $.store.get('retraits')
  const estRetrait = (r: unknown): r is Retrait =>
    typeof r === 'object' && r !== null && typeof (r as Retrait).item === 'string' && typeof (r as Retrait).debut === 'number'
  return {
    renommages: typeof renommages === 'object' && renommages !== null ? (renommages as Record<string, string>) : {},
    retraits: Array.isArray(retraits) ? retraits.filter(estRetrait) : [],
  }
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
        const s = name.slice(0, -'.vivant'.length)
        vivants.set(s, Math.max(vivants.get(s) ?? 0, mtimeMs))
      }
    }
  }
  return { evenements, vivants }
}

/** Le bilan de [debut, fin[, avec le jour d'avant pour les plages qui passent minuit. */
async function bilanDe($: Moteur, debut: number, fin: number) {
  const maintenant = await $.clock.now()
  const options = await lireReglages($)
  const corrections = await lireCorrections($)
  const lecture = await lireJournal($, decalerJours(debut, -1), Math.min(fin, jourSuivant(debutJour(maintenant))))
  return {
    b: bilan(lecture.evenements, options, maintenant, debut, fin, lecture.vivants, corrections),
    evenements: lecture.evenements,
    options,
    corrections,
  }
}

async function itemDe($: Moteur, s: string): Promise<string | null> {
  const enregistre = await $.store.get(`item:${s}`)
  if (typeof enregistre === 'string') return enregistre
  if (heritageClear === null) return null
  // Après /clear, la nouvelle session garde l'item de l'ancienne.
  const { item, manuel } = heritageClear
  heritageClear = null
  await definirItem($, s, item, manuel)
  return item
}

/** Un item choisi à la main ne change plus tout seul. */
async function estManuel($: Moteur, s: string): Promise<boolean> {
  return (await $.store.get(`manuel:${s}`)) === true
}

async function lireRecents($: Moteur): Promise<string[]> {
  const recents = await $.store.get('recents')
  return Array.isArray(recents) ? recents.filter((t): t is string => typeof t === 'string') : []
}

/** Fixe l'item de la session et le garde dans les items récents. */
async function definirItem($: Moteur, s: string, item: string, manuel: boolean): Promise<void> {
  await $.store.set(`item:${s}`, item)
  await $.store.set(`manuel:${s}`, manuel)
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
async function itemDeNouvelleBranche($: Moteur, motif: string): Promise<string | null> {
  const git = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5_000 }).catch(() => null)
  const branche = git?.exitCode === 0 ? git.stdout.trim() : ''
  if (branche === brancheVue) return null
  brancheVue = branche
  return detecterItem(branche, motif)
}

async function noterActivite($: Moteur, e: Activite): Promise<number> {
  const s = await $.session.id()
  const t = await $.clock.now()
  nomParDefaut ??= await calculerNomParDefaut($)
  const d = nomParDefaut ?? undefined
  await noter($, { t, s, e, k: await itemDe($, s), ...(d === undefined ? {} : { d }) })
  return t
}

async function noterJetons($: Moteur, n: number): Promise<void> {
  const s = await $.session.id()
  nomParDefaut ??= await calculerNomParDefaut($)
  const d = nomParDefaut ?? undefined
  await noter($, { t: await $.clock.now(), s, e: 'jetons', n, k: await itemDe($, s), ...(d === undefined ? {} : { d }) })
}

/** Note quand des sous-agents (workflows, Ultracode) commencent ou cessent de travailler : ce temps compte. */
async function suivreAgents($: Moteur): Promise<void> {
  const occupes = (await $.agent.list()).some(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
  if (occupes === agentsOccupes || (agentsOccupes === null && !occupes)) {
    agentsOccupes = occupes
    return
  }
  agentsOccupes = occupes
  await noterActivite($, occupes ? 'agents-debut' : 'agents-fin')
}

/** Passe cette session sur un item, choisi à la main. */
async function changerItem($: Moteur, item: string): Promise<void> {
  await definirItem($, await $.session.id(), item, true)
  await noterActivite($, 'item')
  await rafraichir($)
}

async function classer($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  const t = await $.clock.now()
  await noter($, { t, s: await $.session.id(), e: 'classement', session: ecart.session, debut: ecart.debut, choix })
  friseCalculeeLe = null
}

/** Recalcule la puce, la ligne de statut et, si le popover est ouvert, son contenu. */
async function rafraichir($: Moteur): Promise<void> {
  const s = await $.session.id()
  const maintenant = await $.clock.now()
  nomParDefaut = await calculerNomParDefaut($)
  await donnerSigneDeVie($)
  await suivreAgents($).catch(() => undefined)
  const jour = debutJour(maintenant)
  const { b, evenements, options, corrections } = await bilanDe($, jour, jourSuivant(jour))
  const brut = (await itemDe($, s)) ?? nomParDefaut
  const item = brut === null ? null : nommer(brut, corrections.renommages)
  const enPause = dernierEvenement(evenements, s)?.e === 'pause'
  const etat: Session = { item, minutes: b.parSession.get(s) ?? 0, enPause }
  await update($, session, () => etat)
  await update($, reglages, () => options)
  // VS Code n'affiche ni la puce ni la bande : la ligne de statut les remplace.
  const dansVsCode = (await $.session.surfaces()).includes('vscode')
  $.ui.status(dansVsCode ? libellePuce(item, etat.minutes, enPause) : undefined)
  if (await read($, deplie)) {
    await calculerVue($)
    await calculerFrise($, b.jours[0]?.total ?? 0)
  }
}

/** Le contenu de l'onglet ouvert : la période choisie, avec les items récents en plus pour aujourd'hui. */
async function calculerVue($: Moteur): Promise<void> {
  const etat = await read($, ui)
  if (etat.onglet === 'reglages') return
  const periode: Periode = etat.onglet
  const { debut, fin, titre } = bornes(periode, etat.decalage, await $.clock.now())
  const { b } = await bilanDe($, debut, fin)
  const lignes: Ligne[] = [...b.lignes]
  if (periode === 'jour' && etat.decalage === 0) {
    const presents = new Set(lignes.map(l => l.item))
    for (const item of await lireRecents($)) {
      if (!presents.has(item) && lignes.length < 8) lignes.push({ item, minutes: 0, enCours: false, jetons: 0 })
    }
  }
  const contenu: Vue = { cle: `${periode}:${etat.decalage}`, titre, debut, fin, total: b.total, reel: b.reel, jetons: b.jetons, lignes }
  await update($, vue, () => contenu)
}

/** La frise des SEMAINES dernières semaines ; les jours passés sont gardés en mémoire jusqu'au lendemain. */
async function calculerFrise($: Moteur, minutesDuJour: number): Promise<void> {
  if (!(await lireReglages($)).activite) return
  const maintenant = await $.clock.now()
  const aujourdhui = cleJour(maintenant)
  if (friseCalculeeLe !== aujourdhui) {
    const debut = decalerJours(debutSemaine(maintenant), -7 * (SEMAINES - 1))
    const { b } = await bilanDe($, debut, debutJour(maintenant))
    minutesPassees.clear()
    for (const j of b.jours) minutesPassees.set(cleJour(j.debut), j.total)
    friseCalculeeLe = aujourdhui
  }
  const parJour = new Map(minutesPassees).set(aujourdhui, minutesDuJour)
  const liste = cases(maintenant, parJour)
  await update($, frise, () => ({ cases: liste, total: liste.reduce((s, c) => s + c.minutes, 0) }))
}

async function apresMessage($: Moteur, texte: string, chercherItem: boolean): Promise<void> {
  const s = await $.session.id()
  const options = await lireReglages($)
  if (!(await estManuel($, s))) {
    const deBranche = await itemDeNouvelleBranche($, options.motif)
    const nouveau = (chercherItem ? detecterItem(texte, options.motif) : null) ?? deBranche
    if (nouveau !== null && nouveau !== (await itemDe($, s))) {
      await definirItem($, s, nouveau, false)
      $.ui.toast(`Temps compté pour ${nouveau}`)
    }
  }
  const t = await noterActivite($, 'message')
  await rafraichir($)
  if (!options.question) return
  const jour = debutJour(await $.clock.now())
  const { b } = await bilanDe($, jour, jourSuivant(jour))
  await update($, question, () => b.ecarts.find(x => x.session === s && x.fin === t) ?? null)
}

async function repondre($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  await classer($, ecart, choix)
  await update($, question, () => null)
  await rafraichir($)
}

async function ouvrirOuFermer($: Moteur): Promise<void> {
  const ouvert = !(await read($, deplie))
  await update($, deplie, () => ouvert)
  await update($, ui, etat => ({ ...etat, onglet: ouvert ? 'jour' : etat.onglet, decalage: 0, edition: null, annulation: null }))
  if (ouvert) await rafraichir($)
}

async function choisirOnglet($: Moteur, onglet: Onglet, decalage: number): Promise<void> {
  await update($, ui, etat => ({ ...etat, onglet, decalage: Math.min(0, decalage), edition: null, annulation: null }))
  await calculerVue($)
}

async function choisirItem($: Moteur, item: string): Promise<void> {
  await update($, ui, etat => ({ ...etat, edition: null, annulation: null }))
  await changerItem($, item)
}

/** Renomme un item partout : dans les journaux passés, les items récents et les sessions qui l'utilisent. */
async function renommer($: Moteur, ancien: string, nouveau: string): Promise<void> {
  await update($, ui, etat => ({ ...etat, edition: null }))
  if (nouveau === '' || nouveau === ancien) return
  const { renommages } = await lireCorrections($)
  const suite: Record<string, string> = { ...renommages, [ancien]: nouveau }
  delete suite[nouveau]
  await $.store.set('renommages', suite)
  await $.store.set('recents', (await lireRecents($)).map(t => (t === ancien ? nouveau : t)))
  const s = await $.session.id()
  const actuel = (await itemDe($, s)) ?? nomParDefaut
  if (actuel !== null && nommer(actuel, suite) === nouveau) await definirItem($, s, nouveau, true)
  friseCalculeeLe = null
  await rafraichir($)
}

/** Retire le temps d'un item sur la période affichée, jusqu'à maintenant ; un item sans temps quitte les récents. */
async function retirer($: Moteur, ligne: Ligne, periode: Vue): Promise<void> {
  if (ligne.minutes === 0 && ligne.jetons === 0) {
    await $.store.set('recents', (await lireRecents($)).filter(t => t !== ligne.item))
    await update($, ui, etat => ({ ...etat, annulation: { recent: ligne.item } }))
  } else {
    const r: Retrait = { item: ligne.item, debut: periode.debut, fin: Math.min(periode.fin, await $.clock.now()) }
    await $.store.set('retraits', [...(await lireCorrections($)).retraits, r])
    await update($, ui, etat => ({ ...etat, annulation: r }))
  }
  friseCalculeeLe = null
  await rafraichir($)
}

async function annuler($: Moteur): Promise<void> {
  const { annulation } = await read($, ui)
  if (annulation === null) return
  if ('recent' in annulation) {
    await $.store.set('recents', ajouterRecent(await lireRecents($), annulation.recent))
  } else {
    const { retraits } = await lireCorrections($)
    const meme = (r: Retrait) => r.item === annulation.item && r.debut === annulation.debut && r.fin === annulation.fin
    await $.store.set('retraits', retraits.filter(r => !meme(r)))
  }
  await update($, ui, etat => ({ ...etat, annulation: null }))
  friseCalculeeLe = null
  await rafraichir($)
}

async function changerReglage($: Moteur, changement: Partial<Reglages>): Promise<void> {
  const suite = { ...(await lireReglages($)), ...changement }
  await $.store.set('options', suite)
  await update($, reglages, () => suite)
  friseCalculeeLe = null
  await rafraichir($)
}

async function commande($: Moteur, args: string): Promise<string> {
  const mots = args.split(/\s+/).filter(Boolean)
  const maintenant = await $.clock.now()
  const options = await lireReglages($)
  const aujourdhui = debutJour(maintenant)
  const septJours = async () => (await bilanDe($, decalerJours(aujourdhui, -6), jourSuivant(aujourdhui))).b.ecarts
  const resume = async (periode: Periode, parJour: boolean) => {
    const { debut, fin, titre } = bornes(periode, 0, maintenant)
    return recap(titre, (await bilanDe($, debut, fin)).b, await septJours(), options.jetons, parJour)
  }

  switch (mots[0]?.toLowerCase()) {
    case undefined:
      return resume('jour', false)
    case 'semaine':
      return resume('semaine', true)
    case 'mois':
      return resume('mois', false)
    case 'stop':
    case 'pause':
      await noterActivite($, 'pause')
      await rafraichir($)
      return 'Compteur en pause pour cette session. Il repart à votre prochain message.'
    case 'confirmer':
      return confirmer($, mots.slice(1), await septJours())
    case 'panneau':
      await $.ui.open({ id: PANNEAU, title: TITRE })
      await update($, deplie, () => true)
      await rafraichir($)
      return 'Panneau ouvert.'
    case 'aide':
      return aide()
  }
  if (mots.length === 1 && estUnItem(mots[0]!, options.motif)) {
    await changerItem($, mots[0]!)
    return `Item de cette session : ${mots[0]}.`
  }
  return `« ${args} » n'est ni une commande ni un ID d'item.\n\n${aide()}`
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

/** La puce : `⏱ FSY-I478 · 1 h 12`, discrète ; un clic ouvre ou ferme le popover. */
function puce($: Moteur, e: Site, etat: Session) {
  const { Box, Button } = $.ui.resolve(e)
  return (
    <Box key="zone-puce">
      <Button
        key="puce"
        plain
        label={libellePuce(etat.item, etat.minutes, etat.enPause)}
        onPress={() => ouvrirOuFermer($)}
      />
    </Box>
  )
}

/** Les onglets à gauche ; la période (‹ titre ›) et les réglages à droite. */
function enTete($: Moteur, e: Site, etat: Interface, titre: string) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const enReglages = etat.onglet === 'reglages'
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Box flexDirection="row" gap={2}>
        {ONGLETS.map(o => (
          <Button
            key={`onglet-${o.id}`}
            plain
            dimColor={etat.onglet !== o.id}
            label={o.libelle}
            onPress={() => choisirOnglet($, o.id, 0)}
          />
        ))}
      </Box>
      <Box flexDirection="row" gap={1} alignItems="center">
        {!enReglages && (
          <Button key="precedent" plain dimColor label="‹" onPress={() => choisirOnglet($, etat.onglet, etat.decalage - 1)} />
        )}
        {!enReglages && (
          <Text dimColor size="footnote">
            {titre}
          </Text>
        )}
        {!enReglages &&
          (etat.decalage < 0 ? (
            <Button key="suivant" plain dimColor label="›" onPress={() => choisirOnglet($, etat.onglet, etat.decalage + 1)} />
          ) : (
            <Text dimColor> </Text>
          ))}
        <Box marginLeft={2}>
          <Button
            key="reglages"
            plain
            dimColor={!enReglages}
            label={enReglages ? '✕' : '⚙️'}
            onPress={() => choisirOnglet($, enReglages ? 'jour' : 'reglages', 0)}
          />
        </Box>
      </Box>
    </Box>
  )
}

/** Une ligne : pastille, nom (clic : passer dessus, ou renommer l'item de la session), tokens, temps, × pour retirer. */
function ligne($: Moteur, e: Site, l: Ligne, actuel: string | null, etat: Interface, periode: Vue, options: Reglages) {
  const { Box, Button, Input, Text } = $.ui.resolve(e)
  const estActuel = l.item === actuel
  const sansNom = l.item === SANS_ITEM
  const couleur = estActuel ? 'claude' : l.enCours ? 'success' : 'inactive'
  const enRenommage = etat.edition !== null && etat.edition !== 'autre' && etat.edition.renommer === l.item
  const ouvrirRenommage = () => update($, ui, x => ({ ...x, edition: { renommer: l.item } }))
  const croix = <Button key={`retirer-${l.item}`} plain dimColor label="×" onPress={() => retirer($, l, periode)} />
  return (
    <Box key={`ligne-${l.item}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
      <Box flexDirection="row" gap={1} alignItems="center" flexGrow={1}>
        <Text color={couleur}>●</Text>
        {enRenommage ? (
          <Input
            key="renommer"
            value={sansNom ? '' : l.item}
            placeholder="Nouveau nom, puis Entrée"
            onSubmit={texte => renommer($, l.item, texte.trim().slice(0, 60))}
          />
        ) : (
          <Button
            key={`choisir-${l.item}`}
            plain
            dimColor={sansNom}
            label={l.item}
            onPress={() => (estActuel || sansNom ? ouvrirRenommage() : choisirItem($, l.item))}
          />
        )}
        {estActuel && !enRenommage && <Button key="crayon" plain dimColor label="✎" onPress={ouvrirRenommage} />}
      </Box>
      <Box flexDirection="row" gap={2} alignItems="center">
        {options.jetons && l.jetons > 0 && (
          <Text dimColor size="footnote" tabular>
            {formatJetons(l.jetons)}
          </Text>
        )}
        {l.minutes > 0 && <Text tabular>{formatDuree(l.minutes)}</Text>}
        {e.surface === 'desktop' ? (
          // Dans l'app desktop, × n'apparaît qu'au survol de la ligne, sans décaler les colonnes.
          <Box width={2}>
            <Box display="none" hover={{ display: 'flex' }}>
              {croix}
            </Box>
          </Box>
        ) : (
          croix
        )}
      </Box>
    </Box>
  )
}

/** Le dessin de la frise, selon ce que la surface sait dessiner. */
function dessinFrise($: Moteur, e: Site, activite: Frise) {
  if (e.surface === 'terminal') {
    const { Raster } = $.ui.resolve(e)
    return <Raster key="frise" {...rasterDe(activite)} />
  }
  if (e.surface === 'desktop' || e.surface === 'vscode') {
    const { Svg } = $.ui.resolve(e)
    return <Svg isInteractive alt={`Activité des ${SEMAINES} dernières semaines`} {...svgDe(activite)} />
  }
  return null
}

function rasterDe(activite: Frise) {
  const { cellules, colonnes, lignes } = cellulesActivite(activite.cases)
  return { cells: cellules, columns: colonnes, rows: lignes }
}

function svgDe(activite: Frise) {
  const { source, largeur, hauteur } = svgActivite(activite.cases)
  return { source, width: largeur, height: hauteur }
}

/** La frise d'activité : SVG avec infobulles dans l'app desktop et VS Code, grille de caractères dans le terminal. */
function vueFrise($: Moteur, e: Site, activite: Frise) {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" flexShrink={0} gap={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Text dimColor size="footnote">
          Activité, {SEMAINES} semaines
        </Text>
        <Text dimColor size="footnote" tabular>
          {formatDuree(activite.total)}
        </Text>
      </Box>
      {dessinFrise($, e, activite)}
    </Box>
  )
}

/** Le résumé d'une période : total et lignes à gauche, frise à droite (dessous dans un terminal étroit). */
function resume(
  $: Moteur,
  e: Site,
  d: { etat: Interface; contenu: Vue; actuel: string | null; options: Reglages; activite: Frise | null; colonnes: number; rangees: number },
) {
  const { Box, Button, Input, Text } = $.ui.resolve(e)
  const { etat, contenu, options, activite } = d
  const enParallele = contenu.total - contenu.reel
  const details = [
    options.jetons && contenu.jetons > 0 ? `${formatJetons(contenu.jetons)} tokens` : '',
    enParallele > 0 ? `dont ${formatDuree(enParallele)} en parallèle` : '',
  ].filter(Boolean)
  const annulation = etat.annulation
  const nomAnnule = annulation === null ? '' : 'recent' in annulation ? annulation.recent : annulation.item
  const serre = e.surface === 'terminal'
  const gauche = (
    <Box flexDirection="column" flexGrow={1} gap={serre ? 0 : 1}>
      <Box flexDirection="column">
        <Text size="title" weight="semibold" tabular>
          {formatDuree(contenu.total)}
        </Text>
        {details.length > 0 && (
          <Text dimColor size="footnote" tabular>
            {details.join(' · ')}
          </Text>
        )}
      </Box>
      <Box flexDirection="column">
        {contenu.lignes.length === 0 && <Text dimColor>Rien sur cette période.</Text>}
        {contenu.lignes.map(l => ligne($, e, l, d.actuel, etat, contenu, options))}
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text dimColor>+</Text>
          {etat.edition === 'autre' ? (
            <Input
              key="autre-item"
              placeholder="ID ou nom, puis Entrée"
              onSubmit={texte => {
                const item = texte.trim().slice(0, 60)
                return item === '' ? update($, ui, x => ({ ...x, edition: null })) : choisirItem($, item)
              }}
            />
          ) : (
            <Button key="autre" plain dimColor label="Autre item" onPress={() => update($, ui, x => ({ ...x, edition: 'autre' as const }))} />
          )}
        </Box>
      </Box>
      {annulation !== null && (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text dimColor>{nomAnnule} retiré.</Text>
          <Button key="annuler" plain label="Annuler" onPress={() => annuler($)} />
        </Box>
      )}
    </Box>
  )
  // Dans le terminal, la frise (9 rangées) ne s'affiche que si elle tient sans faire défiler.
  if (!options.activite || activite === null || (serre && d.rangees < 14)) return gauche
  const aCote = !serre || d.colonnes >= 110
  return (
    <Box flexDirection={aCote ? 'row' : 'column'} gap={aCote ? 4 : 1}>
      {gauche}
      {vueFrise($, e, activite)}
    </Box>
  )
}

/** Les réglages : des cases à cocher, le seuil de pause et le format des ID. */
function vueReglages($: Moteur, e: Site, options: Reglages) {
  const { Box, Button, Input, Select, Text } = $.ui.resolve(e)
  const bascules: { cle: 'jetons' | 'activite' | 'question'; libelle: string }[] = [
    { cle: 'jetons', libelle: 'Tokens par item' },
    { cle: 'activite', libelle: "Frise d'activité" },
    { cle: 'question', libelle: '« Du travail ? » après un long silence' },
  ]
  return (
    <Box flexDirection="column" gap={1}>
      <Text weight="semibold">Réglages</Text>
      <Box flexDirection="column">
        {bascules.map(b => (
          <Button
            key={`reglage-${b.cle}`}
            plain
            label={`${options[b.cle] ? '☑' : '☐'}  ${b.libelle}`}
            onPress={() => changerReglage($, { [b.cle]: !options[b.cle] })}
          />
        ))}
      </Box>
      <Select
        key="seuil"
        label="Silence compté comme travail"
        value={String(options.seuilPause)}
        options={SEUILS.map(m => ({ value: String(m), label: `jusqu'à ${m} min` }))}
        onSelect={valeur => changerReglage($, { seuilPause: Number(valeur) })}
      />
      <Input
        key="motif"
        label="Format des ID"
        value={options.motif}
        placeholder="[A-Z]+-I\d+"
        onSubmit={texte => {
          if (motifValide(texte)) return changerReglage($, { motif: texte.trim() })
          $.ui.toast(`« ${texte} » n'est pas une expression régulière valide.`)
          return undefined
        }}
      />
    </Box>
  )
}

/** Le popover : en-tête, puis le résumé de la période ou les réglages. */
async function popover($: Moteur, e: Site, colonnes: number, rangees: number) {
  const { Box, Text } = $.ui.resolve(e)
  const etat = await read($, ui)
  const options = (await read($, reglages)) ?? lireOptions(undefined)
  const contenu = await read($, vue)
  const actuel = (await read($, session))?.item ?? null
  const activite = await read($, frise)
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="inactive"
      paddingX={2}
      paddingY={e.surface === 'terminal' ? 0 : 1}
      gap={e.surface === 'terminal' ? 0 : 1}
    >
      {enTete($, e, etat, contenu?.titre ?? '')}
      {etat.onglet === 'reglages' ? (
        vueReglages($, e, options)
      ) : contenu === null ? (
        <Text dimColor>Calcul en cours…</Text>
      ) : (
        resume($, e, { etat, contenu, actuel, options, activite, colonnes, rangees })
      )}
    </Box>
  )
}

/** Après un long silence : « Du travail ? » avec Oui et Non. */
function questionSilence($: Moteur, e: Site, ecart: Ecart) {
  const { Box, Button, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text>
        {dureeEcart(ecart)} sans message sur {ecart.item} ({formatHeure(ecart.debut)} → {formatHeure(ecart.fin)}). Du
        travail ?
      </Text>
      <Button key="ecart-oui" label="Oui" variant="primary" onPress={() => repondre($, ecart, 'travail')} />
      <Button key="ecart-non" label="Non" variant="secondary" onPress={() => repondre($, ecart, 'pause')} />
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'temps',
      description: 'Temps par item : jour, semaine, mois, changement d’item',
      argumentHint: '[semaine | mois | <item> | stop | confirmer | aide]',
      immediate: true,
    })
    const s = await $.session.id()
    const deBranche = await itemDeNouvelleBranche($, (await lireReglages($)).motif)
    if (deBranche !== null && (await itemDe($, s)) === null) await definirItem($, s, deBranche, false)
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
    const u = e.usage
    if (u !== undefined) {
      const n = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
      if (n > 0) enFond(noterJetons($, n))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const item = await itemDe($, e.sessionId)
    if (e.reason === 'clear' && item !== null) heritageClear = { item, manuel: await estManuel($, e.sessionId) }
    await noter($, { t: await $.clock.now(), s: e.sessionId, e: 'fermeture', k: item })
    return next(e)
  })

  on('command.run', { command: 'temps' }, async ($, e) => ({ text: await commande($, e.args.trim()) }))

  // VS Code : le popover s'ouvre en panneau avec /temps panneau.
  on('ui.render', { component: 'Pane', requestId: PANNEAU }, async ($, e) => popover($, e, e.props.bodyColumns, e.props.scroll.bodyRows))

  // Terminal : la puce va sur la ligne sous la saisie. L'app desktop ne dessine pas cette ligne.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const etat = await read($, session)
    const ligneMoteur = await next(e)
    if (etat === null || e.surface !== 'terminal') return ligneMoteur
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={2}>
        {puce($, e, etat)}
        {ligneMoteur}
      </Box>
    )
  })

  // App desktop : la puce va en bas, devant le mode de la session (« Bypass permissions »).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const etat = await read($, session)
    const modes = await next(e)
    if (etat === null || e.surface === 'terminal') return modes
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={2} alignItems="center">
        {puce($, e, etat)}
        {modes}
      </Box>
    )
  })

  // Au-dessus de la saisie : le popover quand il est ouvert, et la question après un long silence.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ouvert = await read($, deplie)
    const ecart = await read($, question)
    if (e.props.hasSurvey || (!ouvert && ecart === null)) return next(e)
    const autres = await next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        {ouvert && (await popover($, e, e.props.bodyColumns, e.props.maxRows))}
        {ecart !== null && questionSilence($, e, ecart)}
        {autres}
      </Box>
    )
  })
}
