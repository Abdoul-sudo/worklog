import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderNode } from 'claude-code'

import type { Ecart, Frise, Interface, Ligne, Onglet, Reglages, Session, Vue } from '../types'
import { type DessinTerminal, casesEntre, cellulesActivite, compterSerie, svgActivite } from './activite'
import {
  type Activite,
  type Choix,
  type Mesure,
  type Theme,
  MESURES,
  THEMES_IDS,
  type Corrections,
  type Detail,
  type Evenement,
  type Prix,
  type Retrait,
  MARGE_VIE,
  MOTIF_ID,
  SANS_ITEM,
  nomSaisi,
  SEUILS,
  choixDemande,
  demandeEffective,
  ajouterRecent,
  avecCouts,
  bilan,
  bornes,
  cleJour,
  debutJour,
  depuis,
  decalerJours,
  detecterItem,
  dureeEcart,
  formatCout,
  formatDuree,
  formatHeure,
  formatJetons,
  fusionner,
  jourSuivant,
  libellePuce,
  lireLignes,
  lireOptions,
  nommer,
  prixClaude,
} from './calcul'
import {
  CIEL,
  ENCRE,
  couleurs,
  APERCU,
  SANS_FOND,
  choisirTheme,
  svgApercu,
  svgChrono,
  svgCiel,
  svgEngrenage,
  svgFermer,
  svgInterrupteur,
  svgIcone,
  svgPastille,
  ICONES,
  TAILLE_ICONE,
} from './dessins'
import { LANGUES, choisirLangue, t } from './langue'

type Moteur = EngineInterface
// Un site de dessin : la surface, et l'instance (la bande ou le panneau) où donner le focus.
type Site = Parameters<Moteur['ui']['resolve']>[0] & { requestId: string }

const PANNEAU = 'worklog'
const DOSSIER_DONNEES = 'worklog'
const RAFRAICHISSEMENT_MS = 30_000
/** Les `n` premiers caractères de `texte`, sans couper un emoji ou un caractère en deux. */
const couper = (texte: string, n: number) => [...texte].slice(0, n).join('')

/** Après ce délai sans frappe, le champ se quitte seul : l'app ne signale pas un clic ailleurs. */
const CHAMP_INACTIF_MS = 3_000
/** Deux clics plus proches que ce délai font un double-clic. */
const DOUBLE_CLIC_MS = 450
// L'heure du dernier clic sur le nom de chaque item.
const dernierClic = new Map<string, number>()
// Ce qui est tapé dans le champ ouvert (renommer, autre item) : quitter le champ l'enregistre.
let texteEdition = ''
/** Ouvre un champ (renommer, autre item) et y met le focus, pour taper tout de suite. */
async function ouvrirEdition($: Moteur, edition: NonNullable<Interface['edition']>, site: string): Promise<void> {
  // Le champ de renommage s'ouvre avec le nom : il n'est pas vide.
  texteEdition = edition === 'autre' ? '' : edition.renommer
  await update($, ui, x => ({ ...x, edition }))
  surveillerChamp($)
  // Au mieux : une surface qui ne sait pas donner le focus laisse le champ ouvert, sans erreur.
  await $.ui.focus({ requestId: site, key: edition === 'autre' ? 'autre-item' : 'renommer' }).catch(() => undefined)
}
// Le numéro de la dernière frappe (ou ouverture) : seul son délai peut fermer le champ.
let derniereFrappe = 0
/** Note ce qui est tapé dans le champ, et relance le délai. */
function noterFrappe($: Moteur, texte: string): void {
  texteEdition = texte
  surveillerChamp($)
}
/** L'app ne signale pas un clic hors de la bande : CHAMP_INACTIF_MS après la dernière frappe, le champ se quitte seul. */
function surveillerChamp($: Moteur): void {
  const numero = ++derniereFrappe
  $.clock.after(CHAMP_INACTIF_MS, () => {
    if (numero === derniereFrappe) enFond(quitterChamp($))
  })
}
/** On quitte le champ (Entrée, ✓, le focus ailleurs, quelques secondes sans frappe) : un nom valide renomme l'item, ou
 * devient l'item de la session ; un nom inchangé, ou sans lettre ni chiffre, referme le champ. */
async function quitterChamp($: Moteur): Promise<void> {
  const { edition } = await read($, ui)
  if (edition === null) return
  const nom = nomSaisi(texteEdition)
  if (nom === null) await update($, ui, x => ({ ...x, edition: null }))
  else if (edition === 'autre') await choisirItem($, nom)
  else await renommer($, edition.renommer, nom)
}
/** L'historique de Claude Code est relu au plus toutes les cinq minutes. */
const IMPORT_MS = 5 * 60_000
/** La liste publique des prix de LiteLLM : le prix API de chaque modèle, tenu à jour par ses auteurs. */
const LITELLM = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
/** Les prix se téléchargent au plus une fois par jour. */
const PRIX_MS = 24 * 60 * 60_000
const ESSAI_PRIX_MS = 60 * 60_000
// Les tours qui partent seuls (tâche planifiée, observateur, notification d'une tâche de fond, message d'une autre
// session, avis sans origine) ne comptent pas : ils ne sont pas un retour de la personne.
const AUTOMATIQUES = ['scheduled-trigger', 'observer', 'observer-activity', 'task-notification', 'peer', 'peer-send-message', 'unclassified']
// L'ID de l'item se cherche dans ce qu'une personne a écrit, ou dans le brief d'une session lancée par une autre.
const ECRITS = ['composer', 'bridge', 'sdk', 'slack-ping', 'coordinator', 'projects-relay']
const ONGLETS = ['jour', 'semaine', 'mois', 'annee', 'tout'] as const
const INTERFACE_INITIALE: Interface = { onglet: 'jour', decalage: 0, edition: null, page: 0 }

const session = atom({ plugin: 'worklog', key: 'session' } as const, null, { shape: 'session-1' })
const question = atom({ plugin: 'worklog', key: 'question' } as const, null, { shape: 'question-2' })
const deplie = atom({ plugin: 'worklog', key: 'deplie' } as const, false)
const ui = atom({ plugin: 'worklog', key: 'ui' } as const, INTERFACE_INITIALE, { shape: 'ui-6' })
const vue = atom({ plugin: 'worklog', key: 'vue' } as const, null, { shape: 'vue-5' })
const frise = atom({ plugin: 'worklog', key: 'frise' } as const, null, { shape: 'frise-7' })
const reglages = atom({ plugin: 'worklog', key: 'reglages' } as const, null, { shape: 'reglages-2' })

let chemins: { journal: string; importe: string; projets: string; prix: string } | null = null
// Les prix API des modèles Claude (prix.json) ; null tant que le mod n'en a pas.
let prix: Prix | null = null
// Les prix gardés, en texte : de nouveaux prix se reconnaissent sans comparer chaque modèle.
let prixTexte = ''
// Le dernier essai de téléchargement des prix : après un échec, le suivant attend ESSAI_PRIX_MS.
let essaiPrix = -Infinity
let ecritures: Promise<unknown> = Promise.resolve()
let tourCompte = true
let heritageClear: { item: string; manuel: boolean } | null = null
// La session qu'un /clear vient de fermer : sa dernière pause se juge au premier message de la suivante.
let avantClear: string | null = null
// Les mods viennent d'être rechargés dans un processus vivant.
let rechargement = false
let brancheVue: string | null = null
let nomParDefaut: string | null = null
// Dernier état connu des sous-agents de la session : null tant qu'il n'est pas lu.
let agentsOccupes: boolean | null = null
// Le dernier signe d'un agent au travail : un tour, un outil. Les agents d'un workflow (Ultracode) n'ont que ces signes :
// la liste des agents ne les montre pas.
let derniereActiviteAgents = -Infinity
// Les agents dont un tour a commencé sans finir encore : un sous-agent, ou un agent d'un workflow.
const agentsEnTour = new Set<string>()
/** Sans signe d'un agent pendant ce délai, ses agents ont fini. Un appel au modèle peut durer quelques minutes. */
const SILENCE_AGENTS_MS = 5 * 60_000
/** Pendant un long travail des agents, leur début est noté de nouveau à cet intervalle : le calcul sait qu'ils travaillent
 * encore. */
const RAPPEL_AGENTS_MS = 60 * 60_000
// Le dernier `agents-debut` noté par cette session.
let dernierDebutAgents = -Infinity
// Les travaux de fond (une commande, un Monitor, un workflow) encore en cours à la fin du dernier tour : Claude les attend.
let tachesDeFond = new Set<string>()
// Minutes des jours passés pour la frise, recalculées une fois par jour ou après une correction.
let cacheFrise: { cle: string; minutes: Map<string, number>; jetons: Map<string, number>; couts: Map<string, number> } | null = null
// Le dernier lancement de l'importation de l'historique, dans cette session.
let importLance = -Infinity
/** Les lignes d'une page dans la bande : quatre sur deux colonnes de deux, deux sur une seule (la bande reste basse). Le panneau, lui, remplit sa hauteur : ses rangées, moins celles de l'en-tête, des stats, de la frise et du
 * pied. */
const LIGNES_BANDE = 4
const RANGEES_HORS_LISTE = 18
/** La colonne du nom dans le terminal, en caractères ; tokens et temps prennent la largeur de leur plus long texte. */
const TERMINAL = { nom: 24 }
/** La frise du terminal, à côté de la liste : l'écart entre elles, la hauteur de bande qu'il faut pour ses sept lignes
 * de cases (cadre, en-tête, mois compris), et sa largeur minimale, un trimestre. */
const FRISE_TERMINAL = { ecart: 3, hauteurCases: 11, semainesMin: 13 }
/** Les colonnes d'une ligne, en cellules : le nom, puis les tokens ; le temps juste à côté prend la largeur de son plus
 * long texte, environ une cellule par caractère. */
const COLONNES = { nom: 24, jetons: 11 }
/** Les paliers de largeur, en cellules. Dès MOYEN : la frise à côté des stats, la liste sur deux colonnes ; en dessous,
 * la frise sous les stats, la liste sur une. Dès LARGE : les réglages côte à côte, et une liste d'une seule colonne garde
 * un nom de largeur fixe. Partout, la frise rétrécit quand la place manque. */
const LARGE = 95
const MOYEN = 80
/** La largeur d'une cellule dans l'app desktop, en pixels CSS (mesurée) : pour donner à une boîte la largeur d'un dessin. */
const PX_CELLULE = 8.2
/** En dessous de cette largeur (en cellules), les onglets passent sous le titre. */
const ETROIT = 64
/** La hauteur demandée pour le panneau quand il s'ouvre au-dessus de la saisie, en rangées. */
const RANGEES_PANNEAU = 30
/** Sous MOYEN, la frise passe sous les stats : la bande lui laisse cette hauteur (en rangées) avant de la montrer. */
const RANGEES_FRISE_DESSOUS = 20
const TRANSPARENT = '#00000000'
/** Un espace qui ne disparaît pas en début de texte. */
const ESPACE = '\u00a0'

/** Travail lancé sans l'attendre : une erreur (session fermée, module rechargé) ne casse rien. */
const enFond = (travail: Promise<unknown>) => void travail.catch(() => undefined)
/** Ce que dessine un autre mod : ni l'élément du moteur (vide sans questionnaire), ni des boîtes vides. */
const dessinDAutreMod = (n: RenderNode): boolean =>
  typeof n === 'string' ? n.trim() !== '' : n.type === 'Box' ? (n.children ?? []).some(dessinDAutreMod) : n.type !== 'engine'

async function dossiers($: Moteur) {
  if (chemins === null) {
    const maison = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    const config = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${maison}/.claude`).replace(/\\/g, '/')
    // Le dossier des données se règle (un dossier synchronisé, des données de démonstration) ; par défaut, ~/.claude/worklog.
    const donnees = ((await $.env.get('WORKLOG_DATA_DIR')) ?? `${config}/${DOSSIER_DONNEES}`).replace(/\\/g, '/')
    chemins = { journal: `${donnees}/journal`, importe: `${donnees}/import`, projets: `${config}/projects`, prix: `${donnees}/prix.json` }
  }
  return chemins
}

/** La langue et le thème des réglages, pour les textes et les dessins qui suivent. */
function appliquer(options: Reglages): void {
  choisirLangue(options.langue)
  choisirTheme(options.theme)
}

async function lireReglages($: Moteur): Promise<Reglages> {
  const options = lireOptions(await $.store.get('options'))
  appliquer(options)
  return options
}

/** Le nom affiché d'un item : « sans nom » suit la langue. */
const affichage = (item: string) => (item === SANS_ITEM ? t().sansNom : item)

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
/** Vrai si cette session a donné signe de vie il y a peu : ses mods se rechargent, son processus n'a pas redémarré. */
async function vivaitDeja($: Moteur): Promise<boolean> {
  const { journal } = await dossiers($)
  const maintenant = await $.clock.now()
  const dossier = `${journal}/${cleJour(maintenant)}`
  if (!(await $.fs.exists(dossier))) return false
  const nom = `${await $.session.id()}.vivant`
  const signe = (await $.fs.list(dossier)).find(f => f.name === nom)
  return signe !== undefined && maintenant - signe.mtimeMs < MARGE_VIE
}

async function donnerSigneDeVie($: Moteur): Promise<void> {
  const { journal } = await dossiers($)
  await $.fs.write(`${journal}/${cleJour(await $.clock.now())}/${await $.session.id()}.vivant`, '')
}

/** Les événements des jours [debut, fin[ et le dernier signe de vie de chaque session. */
async function lireJournal($: Moteur, debut: number, fin: number) {
  const { journal, importe } = await dossiers($)
  const evenements: Evenement[] = []
  const vivants = new Map<string, number>()
  // Les jours qui ont un dossier, lus une fois par racine : une frise d'un an n'interroge pas 365 dossiers absents.
  const presents = new Map<string, Set<string>>()
  for (const racine of [journal, importe]) {
    presents.set(racine, new Set((await $.fs.exists(racine)) ? (await $.fs.list(racine)).map(f => f.name) : []))
  }
  for (let jour = debut; jour < fin; jour = jourSuivant(jour)) {
    for (const racine of [journal, importe]) {
      if (!presents.get(racine)!.has(cleJour(jour))) continue
      const dossier = `${racine}/${cleJour(jour)}`
      const fichiers = await $.fs.list(dossier)
      for (const { name, mtimeMs } of fichiers) {
        if (name.endsWith('.jsonl')) evenements.push(...lireLignes(await $.fs.read(`${dossier}/${name}`)))
        if (name.endsWith('.vivant')) {
          const s = name.slice(0, -'.vivant'.length)
          vivants.set(s, Math.max(vivants.get(s) ?? 0, mtimeMs))
        }
      }
    }
  }
  return { evenements: avecCouts(fusionner(evenements, await importeJusqua($, importe)), prix), vivants }
}

/** L'heure de fin de la dernière importation de l'historique ; 0 sans importation. */
async function importeJusqua($: Moteur, importe: string): Promise<number> {
  const fichier = `${importe}/fait.json`
  if (!(await $.fs.exists(fichier))) return 0
  try {
    const { fin } = JSON.parse(await $.fs.read(fichier)) as { fin?: unknown }
    return typeof fin === 'number' ? fin : 0
  } catch {
    return 0
  }
}

/**
 * Relit l'historique de Claude Code (scripts/importer.mjs, avec Node) : les tokens de toutes les réponses, sous-agents
 * compris, et le temps des sessions que le mod n'a pas suivies. Au plus toutes les cinq minutes ; sans Node, le mod
 * garde ce qu'il a noté lui-même.
 */
async function importerHistorique($: Moteur): Promise<void> {
  const maintenant = await $.clock.now()
  if (maintenant - importLance < IMPORT_MS) return
  importLance = maintenant
  await mettreAJourPrix($).catch(() => undefined)
  const { importe, projets } = await dossiers($)
  const fin = await $.process
    .run(['node', `${$.plugin.root}/scripts/importer.mjs`, projets, importe, MOTIF_ID], { timeoutMs: 10 * 60_000 })
    .catch(() => null)
  if (fin === null || fin.exitCode !== 0) return
  cacheFrise = null
  await rafraichir($)
}

/** Lit les prix gardés (prix.json). Une fois par jour, sauf avec WORKLOG_PRICES=off, les télécharge de LiteLLM : un
 * fichier public, sans rien envoyer de la personne. Sans réseau, les derniers prix gardés restent. */
async function mettreAJourPrix($: Moteur): Promise<void> {
  const { prix: fichier } = await dossiers($)
  let maj = -Infinity
  if (await $.fs.exists(fichier)) {
    try {
      const garde = JSON.parse(await $.fs.read(fichier)) as { maj?: unknown; modeles?: unknown }
      if (typeof garde.maj === 'number') maj = garde.maj
      if (typeof garde.modeles === 'object' && garde.modeles !== null) garderPrix(garde.modeles as Prix)
    } catch {}
  }
  const maintenant = await $.clock.now()
  if (maintenant - maj < PRIX_MS || maintenant - essaiPrix < ESSAI_PRIX_MS || (await $.env.get('WORKLOG_PRICES')) === 'off') return
  essaiPrix = maintenant
  // Un gros fichier, sans délai maximal possible : il se télécharge à côté, sans retarder l'import.
  enFond(
    (async () => {
      const reponse = await $.http.fetch(LITELLM).catch(() => null)
      if (reponse === null || !reponse.ok) return
      const modeles = prixClaude(JSON.parse(reponse.text))
      if (Object.keys(modeles).length === 0) return
      await $.fs.write(fichier, JSON.stringify({ maj: maintenant, modeles }))
      garderPrix(modeles)
      await rafraichir($)
    })(),
  )
}

/** Garde de nouveaux prix : la frise, qui garde les jours passés en cache, se recalcule avec eux. */
function garderPrix(modeles: Prix): void {
  const texte = JSON.stringify(modeles)
  if (texte === prixTexte) return
  prixTexte = texte
  prix = modeles
  cacheFrise = null
}

/** Le bilan de [debut, fin[, avec le jour d'avant pour les plages qui passent minuit. Un item sans aucun token sur la
 * période n'y compte pas (rien n'a été fait), sauf s'il est en cours. */
async function bilanDe($: Moteur, debut: number, fin: number) {
  const maintenant = await $.clock.now()
  const options = await lireReglages($)
  const corrections = await lireCorrections($)
  // Avec la veille et le lendemain : les plages qui passent minuit ont leur début et leur fin.
  const lecture = await lireJournal($, decalerJours(debut, -1), Math.min(jourSuivant(fin), jourSuivant(debutJour(maintenant))))
  return {
    b: bilan(lecture.evenements, options, maintenant, debut, fin, lecture.vivants, corrections, true),
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
/** La clé de la conversation dans l'app desktop : elle reste la même quand la session reprend sous un autre id. */
async function cleConversation($: Moteur): Promise<string | null> {
  const hote = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  return hote === undefined ? null : `conversation:${hote}`
}

async function definirItem($: Moteur, s: string, item: string, manuel: boolean): Promise<void> {
  await $.store.set(`item:${s}`, item)
  await $.store.set(`manuel:${s}`, manuel)
  const conversation = await cleConversation($)
  if (conversation !== null) await $.store.set(conversation, { item, manuel })
  await $.store.set('recents', ajouterRecent(await lireRecents($), item))
}

/** Le nom par défaut de la session : le dossier du projet, la racine du dépôt Git (celle du dépôt principal, même depuis
 * un worktree), sinon le dossier de la session. Le même dans le terminal et dans l'app desktop. */
async function calculerNomParDefaut($: Moteur): Promise<string | null> {
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

async function noterActivite($: Moteur, e: Activite, instant?: number): Promise<number> {
  const s = await $.session.id()
  const t = instant ?? (await $.clock.now())
  // Relu à chaque événement : l'app desktop lance une session dans un dossier d'attente avant de lui donner le sien.
  nomParDefaut = await calculerNomParDefaut($)
  const d = nomParDefaut ?? undefined
  await noter($, { t, s, e, k: await itemDe($, s), ...(d === undefined ? {} : { d }) })
  return t
}

async function noterJetons($: Moteur, n: number, detail: Detail): Promise<void> {
  const s = await $.session.id()
  // Relu à chaque événement : l'app desktop lance une session dans un dossier d'attente avant de lui donner le sien.
  nomParDefaut = await calculerNomParDefaut($)
  const d = nomParDefaut ?? undefined
  await noter($, { t: await $.clock.now(), s, e: 'jetons', n, p: [detail], k: await itemDe($, s), ...(d === undefined ? {} : { d }) })
}

/** Note quand des sous-agents (workflows, Ultracode) commencent ou cessent de travailler : ce temps compte. */
async function suivreAgents($: Moteur): Promise<void> {
  const maintenant = await $.clock.now()
  const listes = (await $.agent.list()).some(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
  // Un tour d'agent sans fin notée ni signe depuis SILENCE_AGENTS_MS est tenu pour fini (un workflow arrêté, par exemple).
  const occupes = listes || (agentsEnTour.size > 0 && maintenant - derniereActiviteAgents < SILENCE_AGENTS_MS)
  if (agentsOccupes === null && !occupes) {
    agentsOccupes = false
    // Après un rechargement des mods, des agents notés au travail avant lui ont pu finir sans que leur fin soit vue.
    if (rechargement && (await dernierEtatAgents($)) === 'agents-debut') await noterActivite($, 'agents-fin')
    return
  }
  if (occupes === agentsOccupes) {
    if (occupes && maintenant - dernierDebutAgents >= RAPPEL_AGENTS_MS) dernierDebutAgents = await noterActivite($, 'agents-debut')
    return
  }
  agentsOccupes = occupes
  // Les agents d'un workflow ont fini à leur dernier signe, pas quand ce silence est remarqué.
  const fin = !occupes && !listes && derniereActiviteAgents > -Infinity ? derniereActiviteAgents : undefined
  const t = await noterActivite($, occupes ? 'agents-debut' : 'agents-fin', fin)
  if (occupes) dernierDebutAgents = t
}

/** Le dernier état des agents noté aujourd'hui dans le journal de la session : `agents-debut`, `agents-fin`, ou null. */
async function dernierEtatAgents($: Moteur): Promise<string | null> {
  const { journal } = await dossiers($)
  const fichier = `${journal}/${cleJour(await $.clock.now())}/${await $.session.id()}.jsonl`
  if (!(await $.fs.exists(fichier))) return null
  const etats = lireLignes(await $.fs.read(fichier)).filter(ev => ev.e === 'agents-debut' || ev.e === 'agents-fin')
  return etats.at(-1)?.e ?? null
}

/** Un agent travaille : un sous-agent, ou un agent d'un workflow. Le premier signe ouvre son temps tout de suite. */
async function marquerAgents($: Moteur): Promise<void> {
  derniereActiviteAgents = await $.clock.now()
  if (agentsOccupes !== true) await suivreAgents($)
}

/** Un agent est en plein tour : un tour commence, ou un outil part. */
function marquerAgentEnTour($: Moteur, agent: string): void {
  agentsEnTour.add(agent)
  enFond(marquerAgents($))
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
  cacheFrise = null
}

/** Recalcule la puce, la ligne de statut et, si le popover est ouvert, son contenu. */
async function rafraichir($: Moteur): Promise<void> {
  const s = await $.session.id()
  const maintenant = await $.clock.now()
  nomParDefaut = await calculerNomParDefaut($)
  await donnerSigneDeVie($)
  await suivreAgents($).catch(() => undefined)
  const jour = debutJour(maintenant)
  const { b, options, corrections } = await bilanDe($, jour, jourSuivant(jour))
  const brut = (await itemDe($, s)) ?? nomParDefaut
  const item = brut === null ? null : nommer(brut, corrections.renommages)
  const enPause = b.enPause.has(s)
  const etat: Session = { item, minutes: b.parSession.get(s)?.get(item ?? SANS_ITEM) ?? 0, enPause }
  await update($, session, () => etat)
  await update($, reglages, () => options)
  // VS Code n'affiche ni la puce ni la bande : la ligne de statut les remplace.
  const dansVsCode = (await $.session.surfaces()).includes('vscode')
  // VS Code : la ligne de statut, qui ne se clique pas, dit comment ouvrir le popover.
  $.ui.status(dansVsCode ? `${libellePuce(item, etat.minutes, enPause)} · /worklog` : undefined)
  if (await read($, deplie)) {
    await calculerVue($)
    await calculerFrise($)
  }
}

/** Le contenu de l'onglet ouvert : la période choisie. */
async function calculerVue($: Moteur): Promise<void> {
  const etat = await read($, ui)
  if (etat.onglet === 'reglages') return
  const maintenant = await $.clock.now()
  const { debut, fin, titre } = etat.onglet === 'tout' ? await toutLeJournal($, maintenant) : bornes(etat.onglet, etat.decalage, maintenant)
  const { b } = await bilanDe($, debut, fin)
  // L'item de la session a toujours sa ligne : on le voit dès qu'on passe dessus, même sans minute ni token.
  const actuel = (await read($, session))?.item ?? null
  const lignes: Ligne[] = [...b.lignes]
  if (actuel !== null && debut <= maintenant && maintenant < fin && !lignes.some(l => l.item === actuel)) {
    lignes.unshift({ item: actuel, minutes: 0, enCours: false, jetons: 0, cout: 0 })
  }
  // Pendant le calcul, un autre onglet ou une autre période a pu être choisi : ce résultat n'est plus le bon.
  const apres = await read($, ui)
  if (apres.onglet !== etat.onglet || apres.decalage !== etat.decalage) return
  const contenu: Vue = {
    cle: `${etat.onglet}:${etat.decalage}`,
    titre,
    debut,
    fin,
    total: b.total,
    reel: b.reel,
    jetons: b.jetons,
    cout: b.cout,
    lignes,
    derniere: Object.fromEntries(b.derniere),
  }
  await update($, vue, () => contenu)
}

/** Les bornes de l'onglet Tout : du premier jour du journal ou de l'historique importé à la fin d'aujourd'hui. */
async function toutLeJournal($: Moteur, maintenant: number) {
  const { journal, importe } = await dossiers($)
  const jours: string[] = []
  for (const dossier of [journal, importe]) {
    if (await $.fs.exists(dossier)) jours.push(...(await $.fs.list(dossier)).map(f => f.name).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)))
  }
  jours.sort()
  const premier = jours[0] === undefined ? debutJour(maintenant) : debutJour(new Date(`${jours[0]}T12:00`).getTime())
  return { debut: premier, fin: jourSuivant(debutJour(maintenant)), titre: depuis(premier, maintenant) }
}

/** La période de la frise : de janvier à décembre. L'onglet Année montre son année ; Tout, l'année en cours ; les autres,
 * l'année de la période regardée. `fin` est le dernier jour montré. */
function bornesFrise(etat: Interface, maintenant: number, contenu: Vue | null): { debut: number; fin: number } {
  const courante = new Date(maintenant).getFullYear()
  const annee =
    etat.onglet === 'annee'
      ? courante + etat.decalage
      : etat.onglet === 'tout' || contenu === null || (contenu.debut <= maintenant && maintenant < contenu.fin)
        ? courante
        : new Date(contenu.debut).getFullYear()
  return { debut: new Date(annee, 0, 1).getTime(), fin: new Date(annee, 11, 31).getTime() }
}

/** La frise d'activité ; les minutes des jours passés sont gardées jusqu'au lendemain ou jusqu'à une correction. */
async function calculerFrise($: Moteur): Promise<void> {
  const options = await lireReglages($)
  if (!options.activite) return
  const maintenant = await $.clock.now()
  const aujourdhui = debutJour(maintenant)
  const etat = await read($, ui)
  const regardee = await read($, vue)
  const { debut, fin } = bornesFrise(etat, maintenant, regardee)
  const cle = `${cleJour(debut)}|${cleJour(fin)}|${cleJour(aujourdhui)}`
  if (cacheFrise?.cle !== cle) {
    const { b } = await bilanDe($, debut, Math.min(jourSuivant(fin), aujourdhui))
    cacheFrise = {
      cle,
      minutes: new Map(b.jours.map(j => [cleJour(j.debut), j.total])),
      jetons: new Map(b.jours.map(j => [cleJour(j.debut), j.jetons])),
      couts: new Map(b.jours.map(j => [cleJour(j.debut), j.cout])),
    }
  }
  const parJour = new Map(cacheFrise.minutes)
  const jetonsParJour = new Map(cacheFrise.jetons)
  const coutsParJour = new Map(cacheFrise.couts)
  const contientAujourdhui = debut <= aujourdhui && aujourdhui <= fin
  // Aujourd'hui est la seule case qui bouge : elle est recalculée à chaque fois.
  if (contientAujourdhui) {
    const duJour = (await bilanDe($, aujourdhui, jourSuivant(aujourdhui))).b.jours[0]
    parJour.set(cleJour(aujourdhui), duJour?.total ?? 0)
    jetonsParJour.set(cleJour(aujourdhui), duJour?.jetons ?? 0)
    coutsParJour.set(cleJour(aujourdhui), duJour?.cout ?? 0)
  }
  const liste = casesEntre(debut, fin, parJour, aujourdhui, jetonsParJour, coutsParJour)
  // La période de l'onglet est mise en avant dans la frise ; l'année et Tout la couvrent déjà entière.
  const enAvant = etat.onglet === 'jour' || etat.onglet === 'semaine' || etat.onglet === 'mois'
  const periode = enAvant && regardee !== null ? { debut: regardee.debut, fin: regardee.fin } : null
  // La série compte jusqu'à aujourd'hui. Quand elle remonte au 1er janvier, elle continue dans l'année d'avant.
  let suite: number | null = null
  if (contientAujourdhui) {
    const { jours, ouverte } = compterSerie(liste)
    suite = jours
    if (ouverte) {
      const veille = decalerJours(debut, -1)
      const debutAvant = new Date(new Date(veille).getFullYear(), 0, 1).getTime()
      const { b } = await bilanDe($, debutAvant, debut)
      const avant = casesEntre(debutAvant, veille, new Map(b.jours.map(j => [cleJour(j.debut), j.total])), aujourdhui)
      suite = compterSerie([...avant, ...liste]).jours
    }
  }
  await update($, frise, () => ({ cases: liste, aujourdhui: contientAujourdhui, periode, mesure: options.mesure, serie: suite }))
}

async function apresMessage($: Moteur, texte: string, chercherItem: boolean, instant: number): Promise<void> {
  const s = await $.session.id()
  await lireReglages($)
  if (!(await estManuel($, s))) {
    const deBranche = await itemDeNouvelleBranche($, MOTIF_ID)
    const nouveau = (chercherItem ? detecterItem(texte, MOTIF_ID) : null) ?? deBranche
    if (nouveau !== null && nouveau !== (await itemDe($, s))) {
      await definirItem($, s, nouveau, false)
      $.ui.toast(t().toastItem(nouveau))
    }
  }
  await noterActivite($, 'message', instant)
  await rafraichir($)
  // Depuis la veille : une pause qui passe minuit pose aussi sa question.
  const jour = debutJour(await $.clock.now())
  const { b, evenements } = await bilanDe($, decalerJours(jour, -1), jourSuivant(jour))
  // La pause qui finit à ce message, ou juste avant lui quand on a d'abord nommé la session ou changé d'item, ou la
  // dernière de la session qu'un /clear vient de fermer. Une pause laissée sans réponse avant un message précédent ne
  // revient pas.
  const miennes = new Set([s, ...(avantClear === null ? [] : [avantClear])])
  avantClear = null
  const ecart = b.ecarts.filter(x => miennes.has(x.session) && x.fin <= instant).at(-1)
  const repondue = ecart !== undefined && evenements.some(ev => miennes.has(ev.s) && ev.e === 'message' && ev.t >= ecart.fin && ev.t < instant)
  await update($, question, () => (ecart === undefined || repondue ? null : ecart))
}

async function repondre($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  await classer($, ecart, choix)
  await update($, question, () => null)
  await rafraichir($)
}

async function ouvrirOuFermer($: Moteur): Promise<void> {
  const ouvert = !(await read($, deplie))
  await update($, ui, etat => ({ ...etat, onglet: ouvert ? 'jour' : etat.onglet, decalage: 0, edition: null, page: 0 }))
  // Le contenu est prêt avant que le popover n'apparaisse : il ne se dessine pas d'abord sans la frise, plus étroit.
  if (ouvert) {
    // La session d'abord (son item garde une ligne), puis la période et la frise.
    await rafraichir($)
    await calculerVue($)
    await calculerFrise($)
  }
  await update($, deplie, () => ouvert)
}

/** Le panneau latéral : son propre fond, et la hauteur qu'il demande. */
async function ouvrirPanneau($: Moteur): Promise<void> {
  // L'app refuse une couleur transparente à huit chiffres : sans fond propre, le panneau garde celui de l'app.
  await $.ui.open({ id: PANNEAU, title: t().titre, rows: RANGEES_PANNEAU, ...(ENCRE.fond === SANS_FOND ? {} : { backgroundColor: ENCRE.fond }) })
}

async function choisirOnglet($: Moteur, onglet: Onglet, decalage: number): Promise<void> {
  await update($, ui, etat => ({ ...etat, onglet, decalage: Math.min(0, decalage), edition: null, page: 0 }))
  await calculerVue($)
  await calculerFrise($)
}

async function choisirItem($: Moteur, item: string): Promise<void> {
  await update($, ui, etat => ({ ...etat, edition: null }))
  await changerItem($, item)
}

/** Renomme un item partout : dans les journaux passés, les items récents et les sessions qui l'utilisent. */
async function renommer($: Moteur, ancien: string, nouveau: string): Promise<void> {
  await update($, ui, etat => ({ ...etat, edition: null }))
  if (nouveau === '' || nouveau === ancien) return
  const { renommages } = await lireCorrections($)
  const suite: Record<string, string> = { ...renommages, [ancien]: nouveau }
  // Revenir à un ancien nom de cet item défait son renommage ; un renommage d'un autre item reste.
  if (nommer(nouveau, renommages) === ancien) delete suite[nouveau]
  await $.store.set('renommages', suite)
  await $.store.set('recents', (await lireRecents($)).map(t => (t === ancien ? nouveau : t)))
  const s = await $.session.id()
  const actuel = (await itemDe($, s)) ?? nomParDefaut
  if (actuel !== null && nommer(actuel, suite) === nouveau) await definirItem($, s, nouveau, true)
  cacheFrise = null
  await rafraichir($)
}

async function changerReglage($: Moteur, changement: Partial<Reglages>): Promise<void> {
  const suite = { ...(await lireReglages($)), ...changement }
  // Avant de redessiner : le popover se redessine dans la nouvelle langue et le nouveau thème.
  appliquer(suite)
  await $.store.set('options', suite)
  await update($, reglages, () => suite)
  cacheFrise = null
  await rafraichir($)
}

/** /worklog : seul, ouvre ou ferme Worklog ; tout autre texte devient le nom de la session. */
async function commande($: Moteur, args: string): Promise<string> {
  // Les textes suivent la langue des réglages.
  await lireReglages($)
  const textes = t().commande
  const texte = args.trim()
  if (texte === '') {
    // VS Code n'a ni bande ni puce à cliquer : Worklog y ouvre un panneau.
    if ((await $.session.surfaces()).includes('vscode')) {
      if (!(await read($, deplie))) await ouvrirOuFermer($)
      await ouvrirPanneau($)
      return textes.panneau
    }
    await ouvrirOuFermer($)
    return (await read($, deplie)) ? textes.bande : textes.ferme
  }
  // Ces mots demandent d'arrêter ou de reprendre le temps, ce qui n'existe pas : ils ne deviennent pas le nom.
  if (MOTS_SANS_ARRET.includes(texte.toLowerCase())) return textes.sansArret
  const nom = nomSaisi(texte)
  if (nom === null) return textes.nomRefuse
  await changerItem($, nom)
  return textes.item(nom)
}

const MOTS_SANS_ARRET = ['stop', 'pause', 'start', 'resume', 'arreter', 'arrêter', 'reprendre']

/** Dans l'app desktop, le bouton du pied est dessiné par l'app : des espaces insécables autour du libellé lui donnent de
 * l'air, comme une marge intérieure. */
const MARGE_PUCE = '  '

/** La puce : `⏱ FSY-I478 · 1 h 12` ; un clic ouvre ou ferme le popover. */
function puce($: Moteur, e: Site, etat: Session) {
  const { Box, Button } = $.ui.resolve(e)
  const libelle = libellePuce(etat.item, etat.minutes, etat.enPause, e.surface === 'terminal')
  return (
    <Box key="zone-puce">
      <Button key="puce" plain label={riche(e) ? `${MARGE_PUCE}${libelle}${MARGE_PUCE}` : libelle} onPress={() => ouvrirOuFermer($)} />
    </Box>
  )
}

/** Les surfaces qui savent dessiner : le popover y peint son propre fond sombre. */
const riche = (e: Site) => e.surface === 'desktop' || e.surface === 'vscode'

type Ton = 'texte' | 'vif' | 'gris' | 'faible'

/** La couleur d'un texte : l'encre du fond sombre là où le popover le peint, celle du thème ailleurs. */
function encre(e: Site, ton: Ton): { color?: string; dimColor?: boolean } {
  if (riche(e)) return { color: ENCRE[ton] }
  return ton === 'gris' || ton === 'faible' ? { dimColor: true } : {}
}

/** Un contenu cliquable : l'app desktop dessine un bouton avec son propre libellé et ses couleurs ; le contenu est donc
 * dessiné tel quel, et un bouton vide posé dessus prend le clic. Ce bouton est sous le pointeur : c'est lui qui allume le
 * survol de son `groupe` (le sien par défaut), et le contenu suit ce groupe. */
function cliquable($: Moteur, e: Site, cle: string, contenu: RenderChildren, presser: () => unknown, groupe = cle, retrecit = false) {
  const { Box, Button } = $.ui.resolve(e)
  return (
    <Box key={`zone-${cle}`} position="relative" flexDirection="row" alignItems="center" {...(retrecit ? { minWidth: 0, flexShrink: 1 } : {})}>
      {contenu}
      <Box position="absolute" top={0} bottom={0} left={0} right={0} overflow="hidden" alignItems="center" justifyContent="center">
        <Box flexShrink={0}>
          <Button key={cle} plain label={ESPACE.repeat(200)} hover={{ scope: groupe, backgroundColor: TRANSPARENT }} onPress={presser} />
        </Box>
      </Box>
    </Box>
  )
}

/** Un texte cliquable, dans une encre du popover ; il s'éclaire au survol de son `groupe` (le sien par défaut). Un
 * simple bouton dans le terminal. `tronque` : trop long, il finit par « … » au lieu de passer à la ligne. */
function bouton(
  $: Moteur,
  e: Site,
  cle: string,
  libelle: string,
  ton: Ton,
  presser: () => unknown,
  options: { gras?: boolean; groupe?: string; tronque?: boolean; eclaire?: boolean } = {},
) {
  const { Button, Text } = $.ui.resolve(e)
  if (!riche(e)) return <Button key={cle} plain dimColor={ton === 'gris' || ton === 'faible'} label={libelle} onPress={presser} />
  const groupe = options.groupe ?? cle
  const tronque = options.tronque === true
  const texte = (
    <Text
      size="footnote"
      weight={options.gras === true ? 'semibold' : 'regular'}
      color={ENCRE[ton]}
      {...(options.eclaire === false ? {} : { hover: { scope: groupe, color: ENCRE.vif } })}
      {...(tronque ? { wrap: 'truncate' as const } : {})}
    >
      {libelle}
    </Text>
  )
  return cliquable($, e, cle, texte, presser, groupe, tronque)
}

/** Une icône cliquable, grise. Sous le pointeur, elle blanchit sur un rond clair. Un caractère dans le terminal. */
function icone($: Moteur, e: Site, cle: string, trace: keyof typeof ICONES, secours: string, presser: () => unknown) {
  // Dans le terminal, le survol inverse le bouton : une marge de chaque côté en fait une pastille, pas un seul caractère.
  if (!riche(e)) return bouton($, e, cle, ` ${secours} `, 'gris', presser)
  const { Box, Svg } = $.ui.resolve(e)
  const nom = t().icones[trace]
  const dessin = [
    <Svg alt={nom} source={svgIcone(ICONES[trace], ENCRE.gris)} width={TAILLE_ICONE} height={TAILLE_ICONE} />,
    <Box position="absolute" top={0} left={0} display="none" hover={{ scope: cle, display: 'flex' }}>
      <Svg alt={nom} source={svgIcone(ICONES[trace], ENCRE.vif, true)} width={TAILLE_ICONE} height={TAILLE_ICONE} />
    </Box>,
  ]
  return cliquable($, e, cle, dessin, presser)
}

/** Le bouton des réglages : un engrenage gris qui s'éclaire au survol ; une croix pour revenir. */
// L'onglet et la période ouverts avant les réglages : leur croix y ramène.
let avantReglages: { onglet: Onglet; decalage: number } = { onglet: 'jour', decalage: 0 }

function boutonReglages($: Moteur, e: Site, etat: Interface) {
  const enReglages = etat.onglet === 'reglages'
  const basculer = () => {
    if (enReglages) return choisirOnglet($, avantReglages.onglet, avantReglages.decalage)
    avantReglages = { onglet: etat.onglet, decalage: etat.decalage }
    return choisirOnglet($, 'reglages', 0)
  }
  // Dans le terminal, le survol inverse le bouton : une marge de chaque côté en fait une pastille, comme les flèches.
  // ≡ et × tiennent dans une case de la police du terminal ; ⚙ et ✕, pris dans une autre police, débordent et se
  // décalent quand le survol les inverse.
  if (!riche(e)) return bouton($, e, 'reglages', enReglages ? ' × ' : ' ≡ ', 'gris', basculer)
  // L'engrenage, ou la croix dans les réglages : gris comme les onglets, blanc au survol.
  const { Box, Svg } = $.ui.resolve(e)
  const dessin = enReglages ? svgFermer : svgEngrenage
  const alt = enReglages ? t().alt.fermerReglages : t().alt.reglages
  const trace = [
    <Svg alt={alt} source={dessin(ENCRE.gris)} width={15} height={15} />,
    <Box position="absolute" top={0} left={0} display="none" hover={{ scope: 'reglages', display: 'flex' }}>
      <Svg alt={alt} source={dessin(ENCRE.vif)} width={15} height={15} />
    </Box>,
  ]
  return cliquable($, e, 'reglages', trace, basculer)
}

/** Deux flèches côte à côte, ‹ et › ; la seconde, grisée, ne fait rien quand il n'y a pas de suite. */
function fleches($: Moteur, e: Site, cle: string, aSuite: boolean, reculer: () => unknown, avancer: () => unknown) {
  const { Box } = $.ui.resolve(e)
  return (
    <Box key={`fleches-${cle}`} flexDirection="row" alignItems="center" gap={riche(e) ? 'xs' : 0}>
      {icone($, e, cle === 'periode' ? 'precedent' : `${cle}-precedente`, 'precedent', '‹', reculer)}
      {aSuite ? icone($, e, cle === 'periode' ? 'suivant' : `${cle}-suivante`, 'suivant', '›', avancer) : flecheInerte($, e)}
    </Box>
  )
}

/** La flèche › grisée, quand il n'y a pas de suite. */
function flecheInerte($: Moteur, e: Site) {
  if (riche(e)) {
    const { Svg } = $.ui.resolve(e)
    return <Svg alt={t().alt.pasDeSuite} source={svgIcone(ICONES.suivant, ENCRE.faible)} width={12} height={12} />
  }
  const { Text } = $.ui.resolve(e)
  return <Text dimColor> › </Text>
}

/** La marque de l'en-tête : un chronomètre, là où la surface sait dessiner. */
function marque($: Moteur, e: Site) {
  if (!riche(e)) {
    const { Text } = $.ui.resolve(e)
    return <Text color={ENCRE.accent}>◷</Text>
  }
  const { Svg } = $.ui.resolve(e)
  return <Svg alt={t().titre} source={svgChrono()} width={14} height={14} />
}

/** L'en-tête : la période et ses flèches, les onglets, l'engrenage. Étroit (un panneau), les onglets passent sur une
 * ligne à eux, sous le titre. */
function enTete($: Moteur, e: Site, etat: Interface, titre: string, etroit: boolean) {
  const { Box, Text } = $.ui.resolve(e)
  const enReglages = etat.onglet === 'reglages'
  const periode = (
    <Box flexDirection="row" alignItems="center" gap={1}>
      {marque($, e)}
      <Text size="footnote" weight="semibold" {...encre(e, 'vif')}>
        {enReglages ? t().reglages : titre}
      </Text>
      {!enReglages &&
        etat.onglet !== 'tout' &&
        fleches(
          $,
          e,
          'periode',
          etat.decalage < 0,
          () => choisirOnglet($, etat.onglet, etat.decalage - 1),
          () => choisirOnglet($, etat.onglet, etat.decalage + 1),
        )}
    </Box>
  )
  const onglets = ONGLETS.map(o =>
    bouton($, e, `onglet-${o}`, t().onglets[o], etat.onglet === o ? 'vif' : 'gris', () => choisirOnglet($, o, 0), { gras: etat.onglet === o }),
  )
  if (etroit && riche(e)) {
    return (
      <Box key="entete" flexDirection="column" alignItems="stretch" gap="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
          {periode}
          {boutonReglages($, e, etat)}
        </Box>
        <Box flexDirection="row" alignItems="center" gap={3}>
          {onglets}
        </Box>
      </Box>
    )
  }
  return (
    <Box key="entete" flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
      {periode}
      <Box flexDirection="row" alignItems="center" gap={2}>
        {onglets}
        {boutonReglages($, e, etat)}
      </Box>
    </Box>
  )
}

/** La pastille d'une ligne : dessinée là où la surface sait dessiner, un caractère dans le terminal. */
function pastille($: Moteur, e: Site, couleur: string, vivante: boolean) {
  if (riche(e)) {
    const { Svg } = $.ui.resolve(e)
    return <Svg alt={vivante ? t().alt.enCours : t().alt.item} source={svgPastille(couleur, vivante)} width={18} height={18} />
  }
  const { Text } = $.ui.resolve(e)
  return <Text color={couleur}>{vivante ? '●' : '○'}</Text>
}

/** L'ordre de la liste : l'item de la session en tête (passer sur un item le met en haut), puis les items en cours
 * ailleurs, puis du plus récemment actif au plus ancien : ceux sur lesquels on revient sont en haut. */
function ordonner(toutes: Ligne[], actuel: string | null, derniere: Readonly<Record<string, number>>): Ligne[] {
  const rang = (l: Ligne) => (l.item === actuel ? 0 : l.enCours ? 1 : 2)
  return [...toutes].sort((a, b) => rang(a) - rang(b) || (derniere[b.item] ?? 0) - (derniere[a.item] ?? 0))
}

/** Une ligne : pastille (qui bat si l'item est en cours), nom, tokens, puis le temps ou le prix API (selon le réglage
 * « Afficher »). Au survol,
 * juste après le nom : ⇄ pour passer sur l'item (exprès, pour qu'un clic distrait ne déplace pas le temps), ou le crayon
 * pour renommer l'item de la session (un double-clic sur son nom aussi). */
/** Les textes des chiffres d'une ligne, un tiret quand il n'y a rien : leur longueur fait la largeur des colonnes. */
const texteJetons = (l: Ligne) => (l.jetons > 0 ? t().tokens(formatJetons(l.jetons)) : '—')
/** La colonne de droite : le temps, ou avec « Tokens et prix », le prix API des tokens. */
const texteValeur = (l: Ligne, mesure: Mesure) =>
  mesure === 'jetons' ? (l.cout > 0 ? formatCout(l.cout) : '—') : l.minutes > 0 ? formatDuree(l.minutes) : '—'

function ligne(
  $: Moteur,
  e: Site,
  l: Ligne,
  couleur: string,
  actuel: string | null,
  etat: Interface,
  nomFixe: boolean,
  mesure: Mesure,
  largeurs: { jetons: number; valeur: number },
) {
  const { Box, Input, Text } = $.ui.resolve(e)
  const estActuel = l.item === actuel
  const sansNom = l.item === SANS_ITEM
  const enRenommage = etat.edition !== null && etat.edition !== 'autre' && etat.edition.renommer === l.item
  const ouvrirRenommage = () => ouvrirEdition($, { renommer: l.item }, e.requestId)
  // Le moteur ne signale pas le double-clic : deux clics sur le nom, à moins de DOUBLE_CLIC_MS, en font un.
  const doubleClic = async () => {
    const maintenant = await $.clock.now()
    const double = maintenant - (dernierClic.get(l.item) ?? -Infinity) <= DOUBLE_CLIC_MS
    dernierClic.set(l.item, double ? -Infinity : maintenant)
    if (double) await ouvrirRenommage()
  }
  const groupe = `ligne-${l.item}`
  const ton: Ton = sansNom ? 'gris' : l.enCours ? 'vif' : 'texte'
  const nom = enRenommage ? (
    <Input
      key="renommer"
      value={sansNom ? '' : l.item}
      placeholder={t().renommerPlaceholder}
      onInput={texte => noterFrappe($, texte)}
      onSubmit={texte => {
        texteEdition = texte
        return quitterChamp($)
      }}
    />
  ) : sansNom || estActuel ? (
    // L'item en cours se renomme par le crayon, ou d'un double-clic sur son nom là où la surface dessine.
    bouton($, e, `choisir-${l.item}`, affichage(l.item), ton, riche(e) && !sansNom ? doubleClic : ouvrirRenommage, { groupe, tronque: true })
  ) : (
    <Text size="footnote" wrap="truncate" {...encre(e, ton)} {...(riche(e) ? { hover: { color: ENCRE.vif } } : {})}>
      {l.item}
    </Text>
  )
  const changer = !estActuel && !sansNom && icone($, e, `choisir-${l.item}`, 'changer', '⇄', () => choisirItem($, l.item))
  const crayon = estActuel && !enRenommage && icone($, e, 'crayon', 'crayon', '✎', ouvrirRenommage)
  // Pendant le renommage, ✓ l'enregistre tout de suite : l'app ne signale pas un clic hors du champ.
  const valider = enRenommage && icone($, e, 'valider-renommage', 'valider', '✓', () => quitterChamp($))
  // Sans temps (ou sans prix) sur la période : un tiret discret, pour que la colonne ne paraisse pas vide par erreur.
  const texte = texteValeur(l, mesure)
  const valeur =
    texte !== '—' ? (
      <Text size="footnote" tabular {...encre(e, l.enCours ? 'vif' : 'texte')}>
        {texte}
      </Text>
    ) : (
      <Text size="footnote" {...encre(e, 'faible')}>
        —
      </Text>
    )
  const jetons = l.jetons > 0 && (
    <Text size="caption" tabular {...encre(e, 'faible')}>
      {texteJetons(l)}
    </Text>
  )
  if (!riche(e)) {
    // Pas de survol dans le terminal : pas d'icône ; le nom est le bouton, en colonnes fixes avec les chiffres.
    const libelle = affichage(l.item)
    const court = [...libelle].length > TERMINAL.nom ? `${couper(libelle, TERMINAL.nom - 1)}…` : libelle
    const presser = estActuel || sansNom ? ouvrirRenommage : () => choisirItem($, l.item)
    return (
      <Box key={groupe} flexDirection="row" alignItems="center" gap={1}>
        {pastille($, e, couleur, l.enCours)}
        <Box width={TERMINAL.nom}>{enRenommage ? nom : bouton($, e, `choisir-${l.item}`, court, ton, presser)}</Box>
        <Box flexDirection="row" gap={2}>
          <Box width={largeurs.jetons} justifyContent="flex-end">
            {jetons}
          </Box>
          <Box width={largeurs.valeur}>{valeur}</Box>
        </Box>
      </Box>
    )
  }
  // Au survol de la ligne (sa boîte, la plus proche avec une clé), l'icône vient juste après le nom ; les chiffres restent.
  return (
    <Box key={groupe} flexDirection="row" alignItems="center" gap={2} paddingX="sm" hover={{ scope: groupe, backgroundColor: TRANSPARENT }}>
      <Box flexDirection="row" gap={1} alignItems="center" minWidth={0} {...(nomFixe ? { width: COLONNES.nom } : { flexGrow: 1, flexShrink: 1 })}>
        {pastille($, e, couleur, l.enCours)}
        {nom}
        {valider}
        {(crayon !== false || changer !== false) && (
          <Box display="none" hover={{ display: 'flex' }} flexShrink={0}>
            {crayon}
            {changer}
          </Box>
        )}
      </Box>
      <Box flexDirection="row" gap="xs" alignItems="center" flexShrink={0}>
        <Box width={Math.max(COLONNES.jetons, largeurs.jetons)} flexDirection="row" justifyContent="flex-end">
          {jetons}
        </Box>
        <Box width={largeurs.valeur} flexDirection="row">
          {valeur}
        </Box>
      </Box>
    </Box>
  )
}

/** Le dessin de la frise, selon ce que la surface sait dessiner. */
function dessinFrise($: Moteur, e: Site, activite: Frise, place: PlaceFrise | null = null) {
  if (e.surface === 'terminal') {
    if (place === null) return null
    const { Box, Raster, Text } = $.ui.resolve(e)
    const { cellules, colonnes, lignes, mois } = cellulesActivite(activite.cases, activite.mesure, place.dessin, place.semaines, place.pas)
    return (
      <Box key="frise" flexDirection="column">
        <Text dimColor>{mois}</Text>
        <Raster key="frise-cases" cells={cellules} columns={colonnes} rows={lignes} />
      </Box>
    )
  }
  if (riche(e)) {
    const { Svg } = $.ui.resolve(e)
    return <Svg isInteractive alt={t().alt.activite(Math.ceil(activite.cases.length / 7))} {...svgDe(activite)} />
  }
  return null
}

/** Le dessin de la frise, à sa taille : sans largeur ni hauteur données, l'app ne sait pas quelle hauteur lui réserver,
 * et laisse un grand vide sous elle. */
function svgDe(activite: Frise) {
  const aujourdhui = activite.aujourdhui ? (activite.cases.filter(c => c.minutes >= 0).at(-1)?.t ?? null) : null
  const { source, largeur, hauteur } = svgActivite(activite.cases, aujourdhui, activite.periode, activite.mesure)
  return { source, width: largeur, height: hauteur }
}

/** La frise d'activité : SVG avec infobulles dans l'app desktop et VS Code, cases de couleur dans le terminal. Sans
 * titre : il la rendrait trop haute pour la bande. */
function vueFrise($: Moteur, e: Site, activite: Frise, place: PlaceFrise | null) {
  const { Box } = $.ui.resolve(e)
  if (riche(e))
    return (
      <Box flexShrink={1} minWidth={0}>
        {dessinFrise($, e, activite)}
      </Box>
    )
  return <Box flexShrink={0}>{dessinFrise($, e, activite, place)}</Box>
}

/** La place de la frise dans le terminal, à côté de la liste (`liste`, sa largeur) : toute l'année quand elle tient,
 * sinon les semaines les plus récentes ; en cases quand la bande a la hauteur, serrée sinon ; deux colonnes par semaine
 * quand toutes les semaines passées tiennent ainsi. Null sous un trimestre. */
type PlaceFrise = { dessin: DessinTerminal; pas: 1 | 2; semaines: number; liste: number }
function placeFriseTerminal(colonnes: number, rangees: number, liste: number, activite: Frise): PlaceFrise | null {
  // Le cadre et ses marges prennent six colonnes.
  const place = colonnes - 6 - liste - FRISE_TERMINAL.ecart
  if (place < FRISE_TERMINAL.semainesMin) return null
  const annee = Math.ceil(activite.cases.length / 7)
  // Les semaines jusqu'à celle du dernier jour passé : celles d'après, à venir, sont vides.
  let dernier = activite.cases.length - 1
  while (dernier > 0 && activite.cases[dernier]!.minutes < 0) dernier--
  const passees = Math.floor(dernier / 7) + 1
  const dessin: DessinTerminal = rangees >= FRISE_TERMINAL.hauteurCases ? 'cases' : 'serre'
  const pas = dessin === 'cases' && place >= 2 * passees ? 2 : 1
  return { dessin, pas, semaines: Math.min(annee, Math.floor(place / pas)), liste }
}

/** Le résumé d'une période. Là où la surface sait dessiner : l'anneau et le total en haut, la frise d'activité à côté,
 * puis la liste sur toute la largeur, par pages. Dans le terminal : le total, la liste, la frise à droite s'il y a la
 * place. */
function resume(
  $: Moteur,
  e: Site,
  d: {
    etat: Interface
    contenu: Vue
    actuel: string | null
    options: Reglages
    activite: Frise | null
    colonnes: number
    rangees: number
    parPage: number
    enPanneau: boolean
  },
) {
  const { Box, Input, Text } = $.ui.resolve(e)
  const { etat, contenu, options, activite } = d
  const serre = e.surface === 'terminal'
  // Les colonnes des tokens et du temps (ou du prix) prennent la largeur de leur plus long texte, sur toutes les pages.
  // Les tokens sont alignés à droite, le temps à gauche : l'écart entre eux est le même sur chaque ligne, et petit.
  const largeurs = {
    jetons: Math.max(1, ...contenu.lignes.map(l => texteJetons(l).length)),
    valeur: Math.max(1, ...contenu.lignes.map(l => texteValeur(l, options.mesure).length)),
  }
  // Dans le terminal, la largeur de la liste : une ligne (pastille, nom, chiffres), ou les stats si elles sont plus longues.
  const largeurLigne = 3 + TERMINAL.nom + largeurs.jetons + largeurs.valeur + 2
  // La série compte jusqu'à aujourd'hui : une année passée n'en a pas.
  const jours = activite === null || !activite.aujourdhui ? null : activite.serie
  const valeurJetons = contenu.jetons > 0 ? formatJetons(contenu.jetons) : '—'
  const valeurPrix = contenu.cout > 0 ? formatCout(contenu.cout) : '—'
  const avecPrix = options.mesure === 'jetons'
  // Les stats du terminal sur une ligne (« Temps 2 h 29 · Tokens 203 M · Série 5 jours ») : la bande y est basse. Avec
  // « Tokens et prix », le prix prend la place du temps, après les tokens.
  const statsLigne = [
    !avecPrix && [t().stats.temps, formatDuree(contenu.total)],
    [t().stats.jetons, valeurJetons],
    avecPrix && [t().stats.prix, valeurPrix],
    jours !== null && options.activite && [t().stats.serie, t().joursSerie(jours)],
  ].filter((s): s is string[] => s !== false)
  const largeurStats = statsLigne.map(([nom, valeur]) => `${nom} ${valeur}`).join(' · ').length
  const placeFrise =
    serre && options.activite && activite !== null ? placeFriseTerminal(d.colonnes, d.rangees, Math.max(largeurLigne, largeurStats), activite) : null
  // Dans la bande du terminal, la liste prend la hauteur de la frise d'à côté : ses lignes et celle des mois, moins les
  // stats, la ligne vide sous elles et le pied.
  const parPage = placeFrise !== null && !d.enPanneau ? (placeFrise.dessin === 'cases' ? 7 : 4) - 2 : d.parPage
  const enParallele = contenu.total - contenu.reel
  const teintes = couleurs(contenu.lignes)
  const ordre = ordonner(contenu.lignes, d.actuel, contenu.derniere)
  const pages = Math.max(1, Math.ceil(ordre.length / parPage))
  const page = Math.min(etat.page, pages - 1)
  const visibles = ordre.slice(page * parPage, (page + 1) * parPage)
  // La bande est basse et large : deux colonnes de lignes. Le panneau est haut et étroit : une seule.
  const deuxColonnes = riche(e) && !d.enPanneau && d.colonnes >= MOYEN
  const colonnesListe = deuxColonnes ? [visibles.slice(0, Math.ceil(parPage / 2)), visibles.slice(Math.ceil(parPage / 2))] : [visibles]
  const rang = (l: Ligne) =>
    // Une seule colonne sur une grande largeur : le nom a une largeur fixe, pour garder les chiffres près de lui.
    ligne($, e, l, teintes[contenu.lignes.indexOf(l)]!, d.actuel, etat, !deuxColonnes && d.colonnes >= LARGE, options.mesure, largeurs)
  const retrait = serre ? 0 : ('sm' as const)
  const parallele = enParallele > 0 ? t().parallele(formatDuree(enParallele)) : ''
  // Une stat du terminal : son nom en gris, sa valeur en gras.
  const statTerminal = (nom: string, valeur: string) => (
    <Box key={nom} flexDirection="row" gap={1}>
      <Text dimColor>{nom}</Text>
      <Text bold tabular>
        {valeur}
      </Text>
    </Box>
  )
  // Empilées au-dessus de la frise, les stats tiennent chacune sur une ligne (le nom, puis la valeur) : la bande ne défile
  // pas.
  const empilees = riche(e) && d.colonnes < MOYEN
  /** Une stat : son nom en petit, sa valeur dessous (ou à côté, empilée). */
  const stat = (cle: string, nom: string, valeur: string, dessous?: RenderChildren) => (
    <Box
      key={`stat-${cle}`}
      position="relative"
      flexDirection={empilees ? 'row' : 'column'}
      {...(empilees ? { gap: 1, alignItems: 'center' as const } : {})}
      hover={{ scope: `stat-${cle}`, backgroundColor: TRANSPARENT }}
    >
      <Text size="caption" {...encre(e, 'faible')}>
        {nom}
      </Text>
      <Text size="body" weight="semibold" tabular {...encre(e, 'vif')}>
        {valeur}
      </Text>
      {dessous}
    </Box>
  )
  const cartes = [
    !avecPrix &&
    stat(
      'temps',
      t().stats.temps,
      formatDuree(contenu.total),
      // Posé sous la valeur, en absolu : au survol, il apparaît sans déplacer les stats.
      parallele !== '' && (
        <Box position="absolute" top={empilees ? 1 : 2} left={0} width={32} display="none" hover={{ scope: 'stat-temps', display: 'flex' }}>
          <Text size="caption" tabular {...encre(e, 'gris')}>
            {parallele}
          </Text>
        </Box>
      ),
    ),
    stat('jetons', t().stats.jetons, valeurJetons),
    avecPrix &&
      stat(
        'prix',
        t().stats.prix,
        valeurPrix,
        // Au survol, sous la valeur : ce prix est celui de l'API, pas ce que la personne paie avec son abonnement.
        contenu.cout > 0 && (
          <Box position="absolute" top={empilees ? 1 : 2} left={0} width={32} display="none" hover={{ scope: 'stat-prix', display: 'flex' }}>
            <Text size="caption" {...encre(e, 'gris')}>
              {t().prixApi}
            </Text>
          </Box>
        ),
      ),
    jours !== null && options.activite && stat('serie', t().stats.serie, t().joursSerie(jours)),
  ].filter(c => c !== false)
  // Dans le terminal, la frise ne va qu'à côté de la liste, quand la largeur le permet : dessous, la bande défilerait. Dans
  // une bande étroite de l'app, elle irait sous les stats : elle n'y va que si la bande a la hauteur pour elle, la liste
  // et le pied.
  const friseCoupe = !serre && !d.enPanneau && d.colonnes < MOYEN && d.rangees < RANGEES_FRISE_DESSOUS
  const avecFrise = options.activite && activite !== null && (!serre || placeFrise !== null) && !friseCoupe
  // Trois stats au plus, sur une ligne, groupées à gauche : une ou deux stats ne laissent pas de grand vide entre elles.
  // À côté de la frise, le groupe prend la place libre, et pousse la frise au bord droit.
  const stats = (
    <Box flexDirection="row" alignItems="flex-start" gap={3} flexShrink={0} {...(avecFrise ? { flexGrow: 1 } : {})}>
      {cartes}
    </Box>
  )
  const changerPage = (n: number) => update($, ui, x => ({ ...x, page: n }))
  const pied = (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} paddingX={retrait} marginTop={serre ? 0 : 'xs'}>
      {etat.edition === 'autre' ? (
        <Box flexDirection="row" alignItems="center" gap={1} flexGrow={1} minWidth={0}>
          <Input
            key="autre-item"
            placeholder={t().autrePlaceholder}
            onInput={texte => noterFrappe($, texte)}
            onSubmit={texte => {
              texteEdition = texte
              return quitterChamp($)
            }}
          />
          {riche(e) && icone($, e, 'valider-autre', 'valider', '✓', () => quitterChamp($))}
        </Box>
      ) : (
        bouton($, e, 'autre', t().autreItem, 'gris', () => ouvrirEdition($, 'autre', e.requestId))
      )}
      <Box flexDirection="row" gap={2} alignItems="center">
      {pages > 1 && (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text size="caption" tabular {...encre(e, 'gris')}>
            {t().pages(page * parPage + 1, page * parPage + visibles.length, ordre.length)}
          </Text>
          {page > 0 || page < pages - 1
            ? fleches($, e, 'page', page < pages - 1, () => changerPage(Math.max(0, page - 1)), () => changerPage(page + 1))
            : null}
        </Box>
      )}
      </Box>
    </Box>
  )
  const liste = (
    <Box flexDirection="column" alignItems="stretch" {...(serre ? { flexGrow: 1 } : {})}>
      {contenu.lignes.length === 0 && (
        <Box paddingX={retrait}>
          <Text size="footnote" {...encre(e, 'gris')}>
            {t().rienSurPeriode}
          </Text>
        </Box>
      )}
      {colonnesListe.length === 1 ? (
        colonnesListe[0]!.map(rang)
      ) : (
        <Box flexDirection="row" alignItems="flex-start" gap={4}>
          {colonnesListe.map((colonne, i) => (
            <Box key={`colonne-${i}`} flexDirection="column" alignItems="stretch" flexGrow={1} width={0}>
              {colonne.map(rang)}
            </Box>
          ))}
        </Box>
      )}
      {/* Dans le terminal, à côté de la frise plus haute, le pied descend en bas de la carte. */}
      {serre && <Box flexGrow={1} />}
      {pied}
    </Box>
  )
  const frise = avecFrise ? vueFrise($, e, activite, placeFrise) : null
  if (!serre) {
    return (
      <Box flexDirection="column" alignItems="stretch" gap="sm">
        {d.colonnes >= MOYEN ? (
          // Les stats en haut, à la hauteur des mois de la frise.
          <Box flexDirection="row" alignItems="flex-start" gap={4} paddingX={retrait}>
            {stats}
            {frise}
          </Box>
        ) : (
          // Empilées, les stats et la frise forment un bloc de la largeur de la frise.
          <Box flexDirection="column" alignItems="flex-start" paddingX={retrait}>
            <Box
              flexDirection="column"
              alignItems="stretch"
              gap="sm"
              {...(frise !== null && activite !== null ? { width: Math.min(Math.ceil(svgDe(activite).width / PX_CELLULE), d.colonnes - 4) } : {})}
            >
              {stats}
              {frise}
            </Box>
          </Box>
        )}
        {liste}
      </Box>
    )
  }
  const enLigne = statsLigne.map(([nom, valeur]) => statTerminal(nom!, valeur!))
  const gauche = (
    // À côté de la frise, la liste a sa largeur fixe : la frise sait la place qui lui reste.
    <Box flexDirection="column" alignItems="stretch" {...(placeFrise !== null ? { width: placeFrise.liste } : {})}>
      <Box flexDirection="row" gap={1} marginBottom={1}>
        {enLigne.flatMap((s, i) => (i === 0 ? [s] : [<Text key={`point-${i}`} dimColor>·</Text>, s]))}
      </Box>
      {liste}
    </Box>
  )
  if (frise === null) return gauche
  // La carte prend toute la largeur : la frise va au bord droit, sous les onglets.
  return (
    <Box flexDirection="row" alignItems="stretch" justifyContent="space-between" gap={FRISE_TERMINAL.ecart}>
      {gauche}
      {frise}
    </Box>
  )
}

/** Le choix du thème : un aperçu par thème, son nom dessous, sur autant de rangs qu'il faut ; le thème choisi est
 * cerclé d'accent. */
function choixTheme($: Moteur, e: Site, options: Reglages) {
  if (!riche(e)) return null
  const { Box, Svg, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap="sm" paddingX="sm">
      {THEMES_IDS.map((theme: Theme) => {
        const choisi = options.theme === theme
        // Seul l'aperçu se clique : l'app cadre un bouton cliqué sur 44 px de haut. Plus haut que l'aperçu, ce cadre est
        // coupé, comme celui des icônes ; sur toute la carte (aperçu et nom), il en resterait deux traits.
        return (
          <Box key={`carte-${theme}`} flexDirection="column" alignItems="center" gap="xs">
            {cliquable(
              $,
              e,
              `theme-${theme}`,
              <Svg alt={t().themes[theme]} source={svgApercu(theme, choisi)} width={APERCU.largeur} height={APERCU.hauteur} />,
              () => changerReglage($, { theme }),
            )}
            <Text size="caption" weight={choisi ? 'semibold' : 'regular'} color={choisi ? ENCRE.vif : ENCRE.gris} hover={{ scope: `theme-${theme}`, color: ENCRE.vif }}>
              {t().themes[theme]}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** Les réglages là où la surface dessine : une ligne par réglage, la commande à droite, puis les thèmes ; côte à côte
 * quand la place le permet, l'un sous l'autre sinon. Pas de titres de section : la carte au-dessus de la saisie a une
 * hauteur limitée, et chaque libellé dit seul ce qu'il règle. */
function vueReglages($: Moteur, e: Site, options: Reglages, aCote: boolean) {
  if (!riche(e)) return null
  const { Box, Select, Text } = $.ui.resolve(e)
  const bascules: { cle: 'activite'; libelle: string }[] = [{ cle: 'activite', libelle: t().bascules.activite }]
  const ligneReglage = (cle: string, contenu: RenderChildren, aDroite: RenderChildren) => (
    <Box key={`ligne-reglage-${cle}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={2} paddingX="sm">
      {contenu}
      {aDroite}
    </Box>
  )
  // Côte à côte, chaque colonne prend la moitié de la largeur.
  const colonne = (lignes: RenderChildren) => (
    <Box flexDirection="column" alignItems="stretch" gap="xs" {...(aCote ? { flexGrow: 1, width: 0 } : {})}>
      {lignes}
    </Box>
  )
  const affichageLignes = bascules.map(b => {
    const basculer = () => changerReglage($, { [b.cle]: !options[b.cle] })
    const { Svg } = $.ui.resolve(e)
    const interrupteur = <Svg alt={options[b.cle] ? t().alt.active : t().alt.desactive} source={svgInterrupteur(options[b.cle])} width={28} height={16} />
    return ligneReglage(b.cle, bouton($, e, `reglage-${b.cle}`, b.libelle, 'texte', basculer), cliquable($, e, `interrupteur-${b.cle}`, interrupteur, basculer))
  })
  const duree = (cle: string, libelle: string, valeurs: readonly number[], actuelle: number, nommer: (m: number) => string, choisir: (m: number) => unknown) =>
    ligneReglage(
      cle,
      <Text size="footnote" {...encre(e, 'texte')}>
        {libelle}
      </Text>,
      <Select
        key={cle}
        value={String(actuelle)}
        options={valeurs.map(m => ({ value: String(m), label: nommer(m) }))}
        onSelect={valeur => choisir(Number(valeur))}
      />,
    )
  const jusqua = (m: number) => t().jusqua(t().seuilChoix(m))
  const pauses = [
    duree('seuil', t().seuil, SEUILS, options.seuilPause, jusqua, seuilPause => changerReglage($, { seuilPause })),
    duree('pause-max', t().pauseMax, choixDemande(options), demandeEffective(options), m => (m === 0 ? t().jamais : jusqua(m)), pauseMax => changerReglage($, { pauseMax })),
  ]
  return (
    <Box flexDirection={aCote ? 'row' : 'column'} alignItems="stretch" gap={aCote ? 4 : 'md'}>
      {colonne([
        ...affichageLignes,
        ligneReglage(
          'mesure',
          <Text size="footnote" {...encre(e, 'texte')}>
            {t().mesure}
          </Text>,
          <Select
            key="mesure"
            value={options.mesure}
            options={MESURES.map(m => ({ value: m, label: t().mesures[m] }))}
            onSelect={valeur => changerReglage($, { mesure: MESURES.find(m => m === valeur) ?? 'tout' })}
          />,
        ),
        ligneReglage(
          'langue',
          <Text size="footnote" {...encre(e, 'texte')}>
            {t().langue}
          </Text>,
          <Select
            key="langue"
            value={options.langue}
            options={LANGUES.map(l => ({ value: l, label: t().langues[l] }))}
            onSelect={valeur => changerReglage($, { langue: valeur === 'fr' ? 'fr' : 'en' })}
          />,
        ),
        ...pauses,
      ])}
      {colonne(choixTheme($, e, options))}
    </Box>
  )
}

/** Les réglages dans le terminal, où une liste déroulante ne s'ouvre qu'au clavier : chaque réglage montre ses choix,
 * à cliquer ; le choix actuel est plein (●) et clair. L'affichage et le comptage côte à côte quand la place le permet. */
function vueReglagesTerminal($: Moteur, e: Site, options: Reglages, aCote: boolean) {
  const { Box, Text } = $.ui.resolve(e)
  const choix = <T extends string | number>(cle: string, valeurs: readonly T[], actuelle: T, libelle: (v: T) => string, choisir: (v: T) => unknown) => (
    <Box key={`choix-${cle}`} flexDirection="row" gap={2}>
      {valeurs.map(v => bouton($, e, `${cle}-${v}`, `${v === actuelle ? '●' : '○'} ${libelle(v)}`, v === actuelle ? 'vif' : 'gris', () => choisir(v)))}
    </Box>
  )
  const caseACocher = (cle: 'activite', libelle: string) =>
    bouton($, e, `reglage-${cle}`, `${options[cle] ? '☑' : '☐'} ${libelle}`, 'texte', () => changerReglage($, { [cle]: !options[cle] }))
  // Les noms des réglages à choix, sur une colonne de la largeur du plus long : leurs choix s'alignent.
  const largeurNom = Math.max(t().mesure.length, t().langue.length) + 2
  const reglage = (cle: string, nom: string, commande: RenderChildren) => (
    <Box key={`ligne-reglage-${cle}`} flexDirection="row">
      <Box width={largeurNom}>
        <Text dimColor>{nom}</Text>
      </Box>
      {commande}
    </Box>
  )
  const titre = (texte: string) => <Text {...encre(e, 'faible')}>{texte}</Text>
  return (
    <Box flexDirection={aCote ? 'row' : 'column'} gap={aCote ? 4 : 0}>
      {/* L'affichage prend la place libre : les pauses vont au bord droit de la carte, sous les onglets. */}
      <Box flexDirection="column" {...(aCote ? { flexGrow: 1 } : {})}>
        {titre(t().sections.affichage)}
        {caseACocher('activite', t().bascules.activite)}
        {reglage('mesure', t().mesure, choix('mesure', MESURES, options.mesure, m => t().mesures[m], mesure => changerReglage($, { mesure })))}
        {reglage(
          'langue',
          t().langue,
          choix('langue', LANGUES, options.langue, l => t().langues[l], langue => changerReglage($, { langue })),
        )}
      </Box>
      <Box flexDirection="column">
        {titre(t().sections.comptage)}
        <Text>{t().seuil}</Text>
        {choix('seuil', SEUILS, options.seuilPause, t().seuilChoix, seuilPause => changerReglage($, { seuilPause }))}
        <Text>{t().pauseMax}</Text>
        {choix('pause-max', choixDemande(options), demandeEffective(options), m => (m === 0 ? t().jamais : t().seuilChoix(m)), pauseMax => changerReglage($, { pauseMax }))}
      </Box>
    </Box>
  )
}

/** Le popover : l'en-tête (période, onglets, réglages), un filet, puis le résumé de la période ou les réglages. Là où
 * la surface sait dessiner, il peint son propre fond : un dégradé presque noir et un ciel de points. */
async function popover($: Moteur, e: Site, colonnes: number, rangees: number, enPanneau: boolean) {
  const { Box, Text } = $.ui.resolve(e)
  const etat = await read($, ui)
  const options = (await read($, reglages)) ?? lireOptions(undefined)
  appliquer(options)
  const contenu = await read($, vue)
  const actuel = (await read($, session))?.item ?? null
  const activite = await read($, frise)
  const entete = enTete($, e, etat, contenu?.titre ?? '', colonnes < ETROIT)
  const corps =
    etat.onglet === 'reglages' ? (
      riche(e) ? vueReglages($, e, options, colonnes >= LARGE) : vueReglagesTerminal($, e, options, colonnes >= LARGE)
    ) : contenu === null ? (
      <Text size="footnote" {...encre(e, 'gris')}>
        {t().calcul}
      </Text>
    ) : (
      resume($, e, {
        etat,
        contenu,
        actuel,
        options,
        activite,
        colonnes,
        rangees,
        parPage: enPanneau ? Math.max(LIGNES_BANDE, rangees - RANGEES_HORS_LISTE) : riche(e) && colonnes >= MOYEN ? LIGNES_BANDE : LIGNES_BANDE / 2,
        enPanneau,
      })
    )
  if (!riche(e)) {
    return (
      // Le cadre prend toute la largeur de la bande, comme la saisie sous lui.
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={2}>
        {entete}
        {corps}
      </Box>
    )
  }
  const { Svg } = $.ui.resolve(e)
  // Le fond est fait de couches posées sous le contenu ; une couche vide fait du contenu une couche posée au-dessus.
  // Le fond animé du thème ; Simple n'en a pas.
  const motif = svgCiel(await $.clock.now())
  const ciel = motif !== null && (
    <Box key="ciel" position="absolute" top={-1} left={-1}>
      <Svg alt={t().alt.fond} source={motif} width={CIEL.largeur} height={CIEL.hauteur} />
    </Box>
  )
  // Dans la bande, le popover garde la marge de l'app (elle l'écarte des autres mods) et son propre cadre ; dans un
  // panneau, le cadre est celui de l'app.
  return (
    <Box
      key="popover"
      position="relative"
      flexDirection="column"
      alignItems="stretch"
      overflow="hidden"
      backgroundColor={ENCRE.fond}
      {...(enPanneau ? {} : { borderStyle: 'round', borderColor: ENCRE.bord })}
    >
      {ciel}
      <Box key="contenu" flexDirection="column" alignItems="stretch" gap="sm">
        <Box position="absolute" top={0} left={0} />
        <Box key="zone-entete" flexDirection="column" alignItems="stretch" paddingX="md">
          {entete}
        </Box>
        <Box key="corps" flexDirection="column" alignItems="stretch" paddingX="sm">
          {corps}
        </Box>
      </Box>
    </Box>
  )
}

/** Après un long silence : combien, sur quel item, quand, et deux choix clairs. */
function questionSilence($: Moteur, e: Site, ecart: Ecart) {
  const { Box, Button, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2} paddingX={e.surface === 'terminal' ? 0 : 'sm'}>
      <Box flexDirection="column">
        <Text>{t().silence(dureeEcart(ecart), affichage(ecart.item))}</Text>
        <Text dimColor size="footnote">
          {t().silenceDetail(formatHeure(ecart.debut), formatHeure(ecart.fin))}
        </Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Button key="ecart-oui" label={t().compter} variant="primary" onPress={() => repondre($, ecart, 'travail')} />
        <Button key="ecart-non" label={t().ignorer} variant="secondary" onPress={() => repondre($, ecart, 'pause')} />
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await lireReglages($)
    await $.command.register({ name: 'worklog', description: t().commande.description, argumentHint: t().commande.indice, immediate: true })
    const s = await $.session.id()
    // Une conversation de l'app desktop reprise (après un redémarrage de l'app, par exemple) continue sous un autre id :
    // elle garde le nom qu'elle avait.
    const conversation = await cleConversation($)
    const reprise = conversation === null ? undefined : await $.store.get(conversation)
    if (typeof reprise === 'object' && reprise !== null && typeof (reprise as { item?: unknown }).item === 'string' && (await itemDe($, s)) === null) {
      const { item, manuel } = reprise as { item: string; manuel?: unknown }
      await definirItem($, s, item, manuel === true)
    }
    const deBranche = await itemDeNouvelleBranche($, MOTIF_ID)
    if (deBranche !== null && (await itemDe($, s)) === null) await definirItem($, s, deBranche, false)
    // Après /reload-plugins, ce hook revient dans un processus vivant : ce n'est pas une ouverture.
    rechargement = await vivaitDeja($).catch(() => false)
    if (!rechargement) await noterActivite($, 'ouverture')
    enFond(rafraichir($))
    enFond(importerHistorique($))
    $.clock.every(RAFRAICHISSEMENT_MS, () => {
      enFond(rafraichir($))
      enFond(importerHistorique($))
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Ouvrir le popover n'est pas travailler : la commande ne compte pas comme un message.
    if (e.command?.name === 'worklog') return next(e)
    tourCompte = !AUTOMATIQUES.includes(e.origin.kind)
    // L'heure du message se lit d'abord : une réponse très rapide (Échap, une limite atteinte) ne passe pas devant lui.
    if (tourCompte) {
      const instant = await $.clock.now()
      enFond(apresMessage($, e.text, e.isMeta !== true && ECRITS.includes(e.origin.kind), instant))
    }
    if (e.origin.kind === 'composer') enFond(quitterChamp($))
    return next(e)
  })

  // Les signes d'un agent au travail, ceux d'un workflow compris : ses tours et ses outils. Un outil compte aussi comme
  // un tour ouvert : après un rechargement des mods, le début du tour n'a pas été vu.
  on('turn.start', ($, e, next) => {
    if (e.agentId !== undefined) marquerAgentEnTour($, e.agentId)
    return next(e)
  })
  on('tool.call', ($, e, next) => {
    if (e.agentId !== undefined) marquerAgentEnTour($, e.agentId)
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId !== undefined) {
      agentsEnTour.delete(e.agentId)
      enFond(marquerAgents($).then(() => suivreAgents($)))
    }
    if (e.agentId === undefined && tourCompte) enFond(noterActivite($, 'reponse').then(() => rafraichir($)))
    const u = e.usage
    if (u !== undefined) {
      const n = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
      // Claude Code écrit son cache pour une heure. L'import suivant remplace ces chiffres par ceux de l'historique.
      const detail: Detail = { m: u.model, in: u.input_tokens, out: u.output_tokens, c5: 0, c1: u.cache_creation_input_tokens, cr: u.cache_read_input_tokens }
      if (n > 0) enFond(noterJetons($, n, detail))
    }
    return next(e)
  })

  // À la fin de chaque tour, le moteur dit quels travaux de fond tournent encore : Claude les attend. L'attente compte quand
  // l'un d'eux finit ; si la personne revient avant (un serveur qui ne finit jamais), c'est une pause.
  on('classic.Stop', ($, e, next) => {
    const ids = new Set((e.background_tasks ?? []).map(x => x.id))
    const fini = [...tachesDeFond].some(id => !ids.has(id))
    const nouvelleAttente = ids.size > 0 && (tachesDeFond.size === 0 || fini)
    tachesDeFond = ids
    enFond(
      (async () => {
        if (fini) await noterActivite($, 'fond-fin')
        if (nouvelleAttente) await noterActivite($, 'fond-debut')
        await rafraichir($)
      })(),
    )
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const item = await itemDe($, e.sessionId)
    if (e.reason === 'clear') avantClear = e.sessionId
    if (e.reason === 'clear' && item !== null) heritageClear = { item, manuel: await estManuel($, e.sessionId) }
    await noter($, { t: await $.clock.now(), s: e.sessionId, e: 'fermeture', k: item })
    return next(e)
  })

  on('command.run', { command: 'worklog' }, async ($, e) => ({ text: await commande($, e.args.trim()) }))

  // App desktop (clic sur la puce) et VS Code (/worklog panneau) : le popover est un panneau.
  on('ui.render', { component: 'Pane', requestId: PANNEAU }, async ($, e) => popover($, e, e.props.bodyColumns, e.props.scroll.bodyRows, true))

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

  // Le focus quitte le champ ouvert pour un autre élément de la bande : on quitte le champ, son nom s'enregistre. L'app
  // ne signale pas un clic hors de la bande ; un message envoyé dans le chat quitte aussi le champ.
  on('ui.focus', async ($, e, next) => {
    const { edition } = await read($, ui)
    const champ = edition === null ? null : edition === 'autre' ? 'autre-item' : 'renommer'
    if (e.element !== champ) await quitterChamp($)
    return next(e)
  })

  // Au-dessus de la saisie : le popover quand il est ouvert, et la question après un long silence.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ouvert = await read($, deplie)
    const ecart = await read($, question)
    if (e.props.hasSurvey || (!ouvert && ecart === null)) return next(e)
    const autres = await next(e)
    const dessin = ouvert ? await popover($, e, e.props.bodyColumns, e.props.maxRows, false) : null
    const { Box } = $.ui.resolve(e)
    // Un écart sépare la carte de ce que dessine un autre mod. L'élément du moteur reste, hors de la pile espacée : vide, il
    // ajouterait sinon un écart sous la carte.
    const autreMod = dessinDAutreMod(autres)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" gap={1}>
          {dessin}
          {ecart !== null && questionSilence($, e, ecart)}
          {autreMod && autres}
        </Box>
        {!autreMod && autres}
      </Box>
    )
  })
}
