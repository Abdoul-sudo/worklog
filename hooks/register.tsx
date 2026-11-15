import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderNode } from 'claude-code'

import type { Ecart, Frise, Interface, Ligne, Onglet, Reglages, Session, Vue } from '../types'
import { casesEntre, cellulesActivite, serie, svgActivite } from './activite'
import {
  type Activite,
  type Choix,
  type Mesure,
  type Theme,
  MESURES,
  THEMES_IDS,
  type Corrections,
  type Evenement,
  type Periode,
  type Retrait,
  MOTIF_ID,
  SANS_ITEM,
  SEUILS,
  ajouterRecent,
  bilan,
  bornes,
  cleJour,
  debutJour,
  depuis,
  decalerJours,
  dernierEvenement,
  detecterItem,
  dureeEcart,
  estUnItem,
  formatDuree,
  formatHeure,
  formatJetons,
  fusionner,
  jourSuivant,
  libellePuce,
  lireLignes,
  lireOptions,
  nomDuGroupe,
  nommer,
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
  svgInterrupteur,
  svgIcone,
  svgPastille,
  ICONES,
  TAILLE_ICONE,
} from './dessins'
import { LANGUES, choisirLangue, t } from './langue'
import { aide, listeEcarts, recap } from './texte'

type Moteur = EngineInterface
// Un site de dessin : la surface, et l'instance (la bande ou le panneau) où donner le focus.
type Site = Parameters<Moteur['ui']['resolve']>[0] & { requestId: string }

const PANNEAU = 'temps-item'
const DOSSIER_DONNEES = 'temps'
const RAFRAICHISSEMENT_MS = 30_000
/** Un champ vide se ferme seul après ce délai sans frappe. */
const CHAMP_VIDE_MS = 6_000
/** Deux clics plus proches que ce délai font un double-clic. */
const DOUBLE_CLIC_MS = 450
// L'heure du dernier clic sur le nom de chaque item.
const dernierClic = new Map<string, number>()
// Ce qui est tapé dans le champ ouvert (renommer, autre item) : sans lettre ni chiffre, il se ferme quand le focus le
// quitte.
let texteEdition = ''
/** Ouvre un champ (renommer, autre item) et y met le focus, pour taper tout de suite. */
async function ouvrirEdition($: Moteur, edition: NonNullable<Interface['edition']>, site: string): Promise<void> {
  texteEdition = ''
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
/** L'app ne signale pas un clic hors de la bande : un champ resté vide se ferme seul, CHAMP_VIDE_MS après la dernière
 * frappe. Un champ qui tient des lettres reste ouvert. */
function surveillerChamp($: Moteur): void {
  const numero = ++derniereFrappe
  $.clock.after(CHAMP_VIDE_MS, () => {
    if (numero === derniereFrappe) enFond(fermerChampVide($))
  })
}
/** Ferme le champ ouvert s'il ne tient ni lettre ni chiffre. */
async function fermerChampVide($: Moteur): Promise<void> {
  if ((await read($, ui)).edition !== null && !/[\p{L}\p{N}]/u.test(texteEdition)) await update($, ui, x => ({ ...x, edition: null }))
}
/** L'historique de Claude Code est relu au plus toutes les cinq minutes. */
const IMPORT_MS = 5 * 60_000
// Les tours qui partent seuls (tâche planifiée, observateur) ne comptent pas.
const AUTOMATIQUES = ['scheduled-trigger', 'observer', 'observer-activity']
// L'ID de l'item se cherche dans ce qu'une personne a écrit, ou dans le brief d'une session lancée par une autre.
const ECRITS = ['composer', 'bridge', 'sdk', 'slack-ping', 'coordinator', 'projects-relay']
const ONGLETS = ['jour', 'semaine', 'mois', 'annee', 'tout'] as const
const INTERFACE_INITIALE: Interface = { onglet: 'jour', decalage: 0, edition: null, page: 0 }

const session = atom({ plugin: 'temps-item', key: 'session' } as const, null, { shape: 'session-1' })
const question = atom({ plugin: 'temps-item', key: 'question' } as const, null, { shape: 'question-2' })
const deplie = atom({ plugin: 'temps-item', key: 'deplie' } as const, false)
const ui = atom({ plugin: 'temps-item', key: 'ui' } as const, INTERFACE_INITIALE, { shape: 'ui-6' })
const vue = atom({ plugin: 'temps-item', key: 'vue' } as const, null, { shape: 'vue-4' })
const frise = atom({ plugin: 'temps-item', key: 'frise' } as const, null, { shape: 'frise-4' })
const reglages = atom({ plugin: 'temps-item', key: 'reglages' } as const, null, { shape: 'reglages-2' })

let chemins: { journal: string; importe: string; projets: string } | null = null
let ecritures: Promise<unknown> = Promise.resolve()
let tourCompte = true
let heritageClear: { item: string; manuel: boolean } | null = null
let brancheVue: string | null = null
let nomParDefaut: string | null = null
// Dernier état connu des sous-agents de la session : null tant qu'il n'est pas lu.
let agentsOccupes: boolean | null = null
// Minutes des jours passés pour la frise, recalculées une fois par jour ou après une correction.
let cacheFrise: { cle: string; minutes: Map<string, number>; jetons: Map<string, number> } | null = null
// Le dernier lancement de l'importation de l'historique, dans cette session.
let importLance = -Infinity
/** Les lignes d'une page dans la bande : six sur deux colonnes de trois, trois sur une seule (elle défile au-delà de sa
 * hauteur). Le panneau, lui, remplit sa hauteur : ses rangées, moins celles de l'en-tête, des stats, de la frise et du
 * pied. */
const LIGNES_BANDE = 6
const RANGEES_HORS_LISTE = 18
/** Les colonnes d'une ligne, en cellules : le nom, puis tokens et temps juste à côté, loin de la pagination. */
const COLONNES = { nom: 24, jetons: 11, temps: 7 }
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
    chemins = { journal: `${config}/${DOSSIER_DONNEES}/journal`, importe: `${config}/${DOSSIER_DONNEES}/import`, projets: `${config}/projects` }
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
  return { evenements: fusionner(evenements, await importeJusqua($, importe)), vivants }
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
  const { importe, projets } = await dossiers($)
  const fin = await $.process
    .run(['node', `${$.plugin.root}/scripts/importer.mjs`, projets, importe, MOTIF_ID], { timeoutMs: 10 * 60_000 })
    .catch(() => null)
  if (fin === null || fin.exitCode !== 0) return
  cacheFrise = null
  await rafraichir($)
}

/** Le bilan de [debut, fin[, avec le jour d'avant pour les plages qui passent minuit. Un item sans aucun token sur la
 * période n'y compte pas (rien n'a été fait), sauf s'il est en cours. */
async function bilanDe($: Moteur, debut: number, fin: number) {
  const maintenant = await $.clock.now()
  const options = await lireReglages($)
  const corrections = await lireCorrections($)
  const lecture = await lireJournal($, decalerJours(debut, -1), Math.min(fin, jourSuivant(debutJour(maintenant))))
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
  const { b, evenements, options, corrections } = await bilanDe($, jour, jourSuivant(jour))
  const brut = (await itemDe($, s)) ?? nomParDefaut
  const item = brut === null ? null : nommer(brut, corrections.renommages)
  const enPause = dernierEvenement(evenements, s)?.e === 'pause'
  const etat: Session = { item, minutes: b.parSession.get(s)?.get(item ?? SANS_ITEM) ?? 0, enPause }
  await update($, session, () => etat)
  await update($, reglages, () => options)
  // VS Code n'affiche ni la puce ni la bande : la ligne de statut les remplace.
  const dansVsCode = (await $.session.surfaces()).includes('vscode')
  $.ui.status(dansVsCode ? libellePuce(item, etat.minutes, enPause) : undefined)
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
    lignes.unshift({ item: actuel, minutes: 0, enCours: false, jetons: 0 })
  }
  const contenu: Vue = {
    cle: `${etat.onglet}:${etat.decalage}`,
    titre,
    debut,
    fin,
    total: b.total,
    reel: b.reel,
    jetons: b.jetons,
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
  return { debut: premier, fin: jourSuivant(debutJour(maintenant)), titre: depuis(premier) }
}

/** La période de la frise : de janvier à décembre. L'onglet Année montre son année ; Tout, l'année en cours ; les autres,
 * l'année de la période regardée. `fin` est le dernier jour montré. */
function bornesFrise(etat: Interface, maintenant: number, contenu: Vue | null): { debut: number; fin: number } {
  const courante = new Date(maintenant).getFullYear()
  const annee =
    etat.onglet === 'annee' ? courante + etat.decalage : etat.onglet === 'tout' || contenu === null ? courante : new Date(contenu.debut).getFullYear()
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
    }
  }
  const parJour = new Map(cacheFrise.minutes)
  const jetonsParJour = new Map(cacheFrise.jetons)
  const contientAujourdhui = debut <= aujourdhui && aujourdhui <= fin
  // Aujourd'hui est la seule case qui bouge : elle est recalculée à chaque fois.
  if (contientAujourdhui) {
    const duJour = (await bilanDe($, aujourdhui, jourSuivant(aujourdhui))).b.jours[0]
    parJour.set(cleJour(aujourdhui), duJour?.total ?? 0)
    jetonsParJour.set(cleJour(aujourdhui), duJour?.jetons ?? 0)
  }
  const liste = casesEntre(debut, fin, parJour, aujourdhui, jetonsParJour)
  const total = liste.reduce((somme, c) => somme + Math.max(0, c.minutes), 0)
  // La période de l'onglet est mise en avant dans la frise ; l'année et Tout la couvrent déjà entière.
  const enAvant = etat.onglet === 'jour' || etat.onglet === 'semaine' || etat.onglet === 'mois'
  const periode = enAvant && regardee !== null ? { debut: regardee.debut, fin: regardee.fin } : null
  await update($, frise, () => ({ cases: liste, total, aujourdhui: contientAujourdhui, periode, parJetons: options.mesure === 'jetons' }))
}

async function apresMessage($: Moteur, texte: string, chercherItem: boolean): Promise<void> {
  const s = await $.session.id()
  const options = await lireReglages($)
  if (!(await estManuel($, s))) {
    const deBranche = await itemDeNouvelleBranche($, MOTIF_ID)
    const nouveau = (chercherItem ? detecterItem(texte, MOTIF_ID) : null) ?? deBranche
    if (nouveau !== null && nouveau !== (await itemDe($, s))) {
      await definirItem($, s, nouveau, false)
      $.ui.toast(t().toastItem(nouveau))
    }
  }
  const instant = await noterActivite($, 'message')
  await rafraichir($)
  if (!options.question) return
  const jour = debutJour(await $.clock.now())
  const { b } = await bilanDe($, jour, jourSuivant(jour))
  await update($, question, () => b.ecarts.find(x => x.session === s && x.fin === instant) ?? null)
}

async function repondre($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  await classer($, ecart, choix)
  await update($, question, () => null)
  await rafraichir($)
}

async function ouvrirOuFermer($: Moteur): Promise<void> {
  const ouvert = !(await read($, deplie))
  await update($, deplie, () => ouvert)
  await update($, ui, etat => ({ ...etat, onglet: ouvert ? 'jour' : etat.onglet, decalage: 0, edition: null, page: 0 }))
  if (ouvert) await rafraichir($)
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
  delete suite[nouveau]
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

async function commande($: Moteur, args: string): Promise<string> {
  const mots = args.split(/\s+/).filter(Boolean)
  const maintenant = await $.clock.now()
  // Les textes suivent la langue des réglages.
  await lireReglages($)
  const aujourdhui = debutJour(maintenant)
  const septJours = async () => (await bilanDe($, decalerJours(aujourdhui, -6), jourSuivant(aujourdhui))).b.ecarts
  const resume = async (periode: Periode, parJour: boolean) => {
    const { debut, fin, titre } = bornes(periode, 0, maintenant)
    return recap(titre, (await bilanDe($, debut, fin)).b, await septJours(), parJour)
  }

  const textes = t().commande
  switch (mots[0]?.toLowerCase()) {
    case undefined:
      return resume('jour', false)
    case 'semaine':
    case 'week':
      return resume('semaine', true)
    case 'mois':
    case 'month':
      return resume('mois', false)
    case 'stop':
    case 'pause':
      await noterActivite($, 'pause')
      await rafraichir($)
      return textes.pause
    case 'confirmer':
    case 'confirm':
      return confirmer($, mots.slice(1), await septJours())
    case 'panneau':
    case 'pane':
      await ouvrirPanneau($)
      await update($, deplie, () => true)
      await rafraichir($)
      return textes.panneau
    case 'aide':
    case 'help':
      return aide()
  }
  if (mots.length === 1 && estUnItem(mots[0]!, MOTIF_ID)) {
    await changerItem($, mots[0]!)
    return textes.item(mots[0]!)
  }
  return `${textes.inconnu(args)}\n\n${aide()}`
}

async function confirmer($: Moteur, mots: string[], ecarts: Ecart[]): Promise<string> {
  if (mots.length === 0) return listeEcarts(ecarts).join('\n')
  const mot = mots.at(-1)?.toLowerCase()
  const choix: Choix | null = mot === 'travail' || mot === 'work' ? 'travail' : mot === 'pause' || mot === 'break' ? 'pause' : null
  const cibles = mots.slice(0, -1)
  const tout = cibles[0] === 'tout' || cibles[0] === 'all'
  const numeros = cibles.map(Number)
  const valides = numeros.every(n => Number.isInteger(n) && n >= 1 && n <= ecarts.length)
  if (choix === null || cibles.length === 0 || (!tout && !valides)) {
    return [t().commande.confirmerAide, '', ...listeEcarts(ecarts)].join('\n')
  }
  const choisis = tout ? ecarts : [...new Set(numeros)].map(n => ecarts[n - 1]!)
  for (const ecart of choisis) await classer($, ecart, choix)
  await update($, question, () => null)
  await rafraichir($)
  return t().commande.classes(choisis.length, t().commande.choix[choix])
}

/** Dans l'app desktop, le bouton du pied est dessiné par l'app : des espaces insécables autour du libellé lui donnent de
 * l'air, comme une marge intérieure. */
const MARGE_PUCE = '  '

/** La puce : `⏱ FSY-I478 · 1 h 12` ; un clic ouvre ou ferme le popover. */
function puce($: Moteur, e: Site, etat: Session) {
  const { Box, Button } = $.ui.resolve(e)
  const libelle = libellePuce(etat.item, etat.minutes, etat.enPause)
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
  if (!riche(e)) return bouton($, e, cle, secours, 'gris', presser)
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
  if (enReglages || !riche(e)) return bouton($, e, 'reglages', enReglages ? '✕' : '⚙\uFE0E', enReglages ? 'texte' : 'gris', basculer)
  const { Box, Svg } = $.ui.resolve(e)
  const engrenage = [
    <Svg alt={t().alt.reglages} source={svgEngrenage(ENCRE.gris)} width={15} height={15} />,
    <Box position="absolute" top={0} left={0} display="none" hover={{ scope: 'reglages', display: 'flex' }}>
      <Svg alt={t().alt.reglages} source={svgEngrenage(ENCRE.vif)} width={15} height={15} />
    </Box>,
  ]
  return cliquable($, e, 'reglages', engrenage, basculer)
}

/** Deux flèches côte à côte, ‹ et › ; la seconde, grisée, ne fait rien quand il n'y a pas de suite. */
function fleches($: Moteur, e: Site, cle: string, aSuite: boolean, reculer: () => unknown, avancer: () => unknown) {
  const { Box } = $.ui.resolve(e)
  return (
    <Box key={`fleches-${cle}`} flexDirection="row" alignItems="center" gap={riche(e) ? 'xs' : 1}>
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
  return <Text dimColor>›</Text>
}

/** La marque de l'en-tête : un chronomètre, là où la surface sait dessiner. */
function marque($: Moteur, e: Site) {
  if (!riche(e)) return null
  const { Svg } = $.ui.resolve(e)
  return <Svg alt={t().titre} source={svgChrono()} width={14} height={14} />
}

/** La période (‹ › autour du titre) à gauche ; les onglets et les réglages à droite. */
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

/** Une ligne : pastille (qui bat si l'item est en cours), nom, tokens et temps (selon le réglage « Afficher »). Au survol,
 * juste après le nom : ⇄ pour passer sur l'item (exprès, pour qu'un clic distrait ne déplace pas le temps), ou le crayon
 * pour renommer l'item de la session (un double-clic sur son nom aussi). */
function ligne($: Moteur, e: Site, l: Ligne, couleur: string, actuel: string | null, etat: Interface, nomFixe: boolean, mesure: Mesure) {
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
      onSubmit={texte => renommer($, l.item, texte.trim().slice(0, 60))}
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
  // Pas de temps sur la période : un tiret discret, pour que la colonne ne paraisse pas vide par erreur.
  const temps =
    l.minutes > 0 ? (
      <Text size="footnote" tabular {...encre(e, l.enCours ? 'vif' : 'texte')}>
        {formatDuree(l.minutes)}
      </Text>
    ) : (
      <Text size="footnote" {...encre(e, 'faible')}>
        —
      </Text>
    )
  const jetons = l.jetons > 0 && (
    <Text size="caption" tabular {...encre(e, 'faible')}>
      {t().tokens(formatJetons(l.jetons))}
    </Text>
  )
  if (!riche(e)) {
    return (
      <Box key={groupe} flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
        <Box flexDirection="row" gap={1} alignItems="center" flexGrow={1}>
          {pastille($, e, couleur, l.enCours)}
          {nom}
          {crayon}
          {changer}
        </Box>
        <Box flexDirection="row" gap={2} alignItems="center">
          {mesure !== 'temps' && jetons}
          {mesure !== 'jetons' && temps}
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
        {(crayon !== false || changer !== false) && (
          <Box display="none" hover={{ display: 'flex' }} flexShrink={0}>
            {crayon}
            {changer}
          </Box>
        )}
      </Box>
      <Box flexDirection="row" gap="xs" alignItems="center" flexShrink={0}>
        {mesure !== 'temps' && (
          <Box width={COLONNES.jetons} flexDirection="row" justifyContent="flex-end">
            {jetons}
          </Box>
        )}
        {mesure !== 'jetons' && (
          <Box width={COLONNES.temps} flexDirection="row" justifyContent="flex-end">
            {temps}
          </Box>
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
  if (riche(e)) {
    const { Svg } = $.ui.resolve(e)
    return <Svg isInteractive alt={t().alt.activite(Math.ceil(activite.cases.length / 7))} {...svgDe(activite)} />
  }
  return null
}

function rasterDe(activite: Frise) {
  const { cellules, colonnes, lignes } = cellulesActivite(activite.cases)
  return { cells: cellules, columns: colonnes, rows: lignes }
}

/** Le dessin de la frise, à sa taille : sans largeur ni hauteur données, l'app ne sait pas quelle hauteur lui réserver,
 * et laisse un grand vide sous elle. */
function svgDe(activite: Frise) {
  const aujourdhui = activite.aujourdhui ? (activite.cases.filter(c => c.minutes >= 0).at(-1)?.t ?? null) : null
  const { source, largeur, hauteur } = svgActivite(activite.cases, aujourdhui, activite.periode, activite.parJetons)
  return { source, width: largeur, height: hauteur }
}

/** La frise d'activité : SVG avec infobulles dans l'app desktop et VS Code, grille de caractères sous un titre dans le
 * terminal. Là où elle se dessine, ses mois suffisent : un titre la rendrait trop haute pour la bande. */
function vueFrise($: Moteur, e: Site, activite: Frise) {
  const { Box, Text } = $.ui.resolve(e)
  if (riche(e))
    return (
      <Box flexShrink={1} minWidth={0}>
        {dessinFrise($, e, activite)}
      </Box>
    )
  return (
    <Box flexDirection="column" flexShrink={0} gap="xs">
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Text size="caption" {...encre(e, 'gris')}>
          {t().semaines(Math.min(26, Math.ceil(activite.cases.length / 7)))}
        </Text>
        <Text size="caption" tabular {...encre(e, 'gris')}>
          {formatDuree(activite.total)}
        </Text>
      </Box>
      {dessinFrise($, e, activite)}
    </Box>
  )
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
  const enParallele = contenu.total - contenu.reel
  const details = [
    contenu.jetons > 0 ? t().tokens(formatJetons(contenu.jetons)) : '',
    enParallele > 0 ? t().parallele(formatDuree(enParallele)) : '',
  ].filter(Boolean)
  const teintes = couleurs(contenu.lignes)
  const ordre = ordonner(contenu.lignes, d.actuel, contenu.derniere)
  const pages = Math.max(1, Math.ceil(ordre.length / d.parPage))
  const page = Math.min(etat.page, pages - 1)
  const visibles = ordre.slice(page * d.parPage, (page + 1) * d.parPage)
  // La bande est basse et large : deux colonnes de lignes. Le panneau est haut et étroit : une seule.
  const deuxColonnes = riche(e) && !d.enPanneau && d.colonnes >= MOYEN
  const colonnesListe = deuxColonnes ? [visibles.slice(0, Math.ceil(d.parPage / 2)), visibles.slice(Math.ceil(d.parPage / 2))] : [visibles]
  const rang = (l: Ligne) =>
    // Une seule colonne sur une grande largeur : le nom a une largeur fixe, pour garder les chiffres près de lui.
    ligne($, e, l, teintes[contenu.lignes.indexOf(l)]!, d.actuel, etat, !deuxColonnes && d.colonnes >= LARGE, options.mesure)
  const retrait = serre ? 0 : ('sm' as const)
  const parallele = enParallele > 0 ? t().parallele(formatDuree(enParallele)) : ''
  // Le total du terminal : le temps, puis les tokens et le temps compté en parallèle.
  const totaux = (
    <Box flexDirection="column">
      <Text weight="semibold" tabular>
        {formatDuree(contenu.total)}
      </Text>
      {details.length > 0 && (
        <Text dimColor tabular>
          {details.join(' · ')}
        </Text>
      )}
    </Box>
  )
  // La série compte jusqu'à aujourd'hui : une année passée n'en a pas.
  const jours = activite === null || !activite.aujourdhui ? null : serie(activite.cases)
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
    options.mesure !== 'jetons' &&
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
    options.mesure !== 'temps' && stat('jetons', t().stats.jetons, contenu.jetons > 0 ? formatJetons(contenu.jetons) : '—'),
    jours !== null && options.activite && stat('serie', t().stats.serie, t().joursSerie(jours)),
  ].filter(c => c !== false)
  const avecFrise = options.activite && activite !== null && (!serre || d.rangees >= 14)
  // Trois stats au plus, sur une ligne. À côté de la frise, elles s'étalent sur la place à sa gauche (la première au bord
  // gauche, alignée sur la liste, la dernière juste avant la frise) ; sans frise, elles restent groupées à gauche.
  const stats = (
    <Box flexDirection="row" alignItems="flex-start" gap={3} flexShrink={0} {...(avecFrise ? { flexGrow: 1, justifyContent: 'space-between' as const } : {})}>
      {cartes}
    </Box>
  )
  const changerPage = (n: number) => update($, ui, x => ({ ...x, page: n }))
  const pied = (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} paddingX={retrait} marginTop={serre ? 0 : 'xs'}>
      {etat.edition === 'autre' ? (
        <Input
          key="autre-item"
          placeholder={t().autrePlaceholder}
          onInput={texte => noterFrappe($, texte)}
          onSubmit={texte => {
            const item = texte.trim().slice(0, 60)
            return item === '' ? update($, ui, x => ({ ...x, edition: null })) : choisirItem($, item)
          }}
        />
      ) : (
        bouton($, e, 'autre', t().autreItem, 'gris', () => ouvrirEdition($, 'autre', e.requestId))
      )}
      <Box flexDirection="row" gap={2} alignItems="center">
      {pages > 1 && (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text size="caption" tabular {...encre(e, 'gris')}>
            {t().pages(page * d.parPage + 1, page * d.parPage + visibles.length, ordre.length)}
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
    <Box flexDirection="column" alignItems="stretch">
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
      {pied}
    </Box>
  )
  const frise = avecFrise ? vueFrise($, e, activite) : null
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
          // Empilés, les stats prennent la largeur de la frise : la première sur son bord gauche, la dernière sur son bord
          // droit, un seul bloc aligné.
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
  const gauche = (
    <Box flexDirection="column" alignItems="stretch" flexGrow={1}>
      {totaux}
      {liste}
    </Box>
  )
  if (frise === null) return gauche
  const aCote = d.colonnes >= 110
  return (
    <Box flexDirection={aCote ? 'row' : 'column'} gap={aCote ? 4 : 1}>
      {gauche}
      {frise}
    </Box>
  )
}

/** Les réglages : deux sections (l'affichage, le comptage), côte à côte quand la place le permet, l'une sous l'autre
 * sinon ; une ligne par réglage, la commande à droite. */
/** Le choix du thème : un aperçu par thème, son nom dessous ; le thème choisi est cerclé d'accent. */
function choixTheme($: Moteur, e: Site, options: Reglages) {
  if (!riche(e)) return null
  const { Box, Svg, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" gap={2} paddingX="sm">
      {THEMES_IDS.map((theme: Theme) => {
        const choisi = options.theme === theme
        return cliquable(
          $,
          e,
          `theme-${theme}`,
          <Box flexDirection="column" alignItems="center" gap="xs">
            <Svg alt={t().themes[theme]} source={svgApercu(theme, choisi)} width={APERCU.largeur} height={APERCU.hauteur} />
            <Text size="caption" weight={choisi ? 'semibold' : 'regular'} color={choisi ? ENCRE.vif : ENCRE.gris} hover={{ scope: `theme-${theme}`, color: ENCRE.vif }}>
              {t().themes[theme]}
            </Text>
          </Box>,
          () => changerReglage($, { theme }),
        )
      })}
    </Box>
  )
}

function vueReglages($: Moteur, e: Site, options: Reglages, aCote: boolean) {
  const { Box, Select, Text } = $.ui.resolve(e)
  const bascules: { cle: 'activite' | 'question'; libelle: string }[] = [
    { cle: 'activite', libelle: t().bascules.activite },
    { cle: 'question', libelle: t().bascules.question },
  ]
  // Une liste déroulante sur le fond plein du popover : la trame de points ne se voit pas au travers.
  const surFond = (commande: RenderChildren) => (riche(e) ? <Box backgroundColor={ENCRE.fond}>{commande}</Box> : commande)
  const ligneReglage = (cle: string, contenu: RenderChildren, aDroite: RenderChildren) => (
    <Box key={`ligne-reglage-${cle}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={2} paddingX={riche(e) ? 'sm' : 0}>
      {contenu}
      {aDroite}
    </Box>
  )
  // Côte à côte, chaque colonne prend la moitié de la largeur ; une section rangée dans une colonne en prend toute la largeur.
  const section = (titre: string, lignes: RenderChildren, colonne = aCote) => (
    <Box flexDirection="column" alignItems="stretch" gap={riche(e) ? 'xs' : 0} {...(colonne ? { flexGrow: 1, width: 0 } : {})}>
      <Box paddingX={riche(e) ? 'sm' : 0}>
        <Text size="caption" {...encre(e, 'faible')}>
          {titre}
        </Text>
      </Box>
      {lignes}
    </Box>
  )
  const affichageLignes = bascules.map(b => {
    const basculer = () => changerReglage($, { [b.cle]: !options[b.cle] })
    if (!riche(e)) return ligneReglage(b.cle, bouton($, e, `reglage-${b.cle}`, `${options[b.cle] ? '☑' : '☐'} ${b.libelle}`, 'texte', basculer), null)
    const { Svg } = $.ui.resolve(e)
    const interrupteur = <Svg alt={options[b.cle] ? t().alt.active : t().alt.desactive} source={svgInterrupteur(options[b.cle])} width={28} height={16} />
    return ligneReglage(b.cle, bouton($, e, `reglage-${b.cle}`, b.libelle, 'texte', basculer), cliquable($, e, `interrupteur-${b.cle}`, interrupteur, basculer))
  })
  const comptage = ligneReglage(
    'seuil',
    <Text size="footnote" {...encre(e, 'texte')}>
      {t().seuil}
    </Text>,
    surFond(
      <Select
        key="seuil"
        value={String(options.seuilPause)}
        options={SEUILS.map(m => ({ value: String(m), label: `${m} min` }))}
        onSelect={valeur => changerReglage($, { seuilPause: Number(valeur) })}
      />,
    ),
  )
  return (
    <Box flexDirection={aCote ? 'row' : 'column'} alignItems="stretch" gap={aCote ? 4 : riche(e) ? 'md' : 0}>
      {section(t().sections.affichage, [
        ...affichageLignes,
        ligneReglage(
          'mesure',
          <Text size="footnote" {...encre(e, 'texte')}>
            {t().mesure}
          </Text>,
          surFond(
            <Select
              key="mesure"
              value={options.mesure}
              options={MESURES.map(m => ({ value: m, label: t().mesures[m] }))}
              onSelect={valeur => changerReglage($, { mesure: MESURES.find(m => m === valeur) ?? 'tout' })}
            />,
          ),
        ),
        ligneReglage(
          'langue',
          <Text size="footnote" {...encre(e, 'texte')}>
            {t().langue}
          </Text>,
          surFond(
            <Select
              key="langue"
              value={options.langue}
              options={LANGUES.map(l => ({ value: l.id, label: l.nom }))}
              onSelect={valeur => changerReglage($, { langue: valeur === 'fr' ? 'fr' : 'en' })}
            />,
          ),
        ),
      ])}
      {riche(e) ? (
        // Le thème en haut de la colonne de droite, qui n'a qu'une ligne : les réglages ne grandissent pas.
        <Box flexDirection="column" alignItems="stretch" gap="md" {...(aCote ? { flexGrow: 1, width: 0 } : {})}>
          {section(t().sections.theme, choixTheme($, e, options), false)}
          {section(t().sections.comptage, comptage, false)}
        </Box>
      ) : (
        section(t().sections.comptage, comptage)
      )}
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
      vueReglages($, e, options, riche(e) && colonnes >= LARGE)
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
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={2}>
        {entete}
        {corps}
      </Box>
    )
  }
  const { Svg } = $.ui.resolve(e)
  // Le fond est fait de couches posées sous le contenu ; une couche vide fait du contenu une couche posée au-dessus.
  // Le fond animé du thème ; Simple n'en a pas.
  const motif = svgCiel()
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
    await $.command.register({ name: 'temps', description: t().commande.description, argumentHint: t().commande.indice, immediate: true })
    const s = await $.session.id()
    const deBranche = await itemDeNouvelleBranche($, MOTIF_ID)
    if (deBranche !== null && (await itemDe($, s)) === null) await definirItem($, s, deBranche, false)
    await noterActivite($, 'ouverture')
    enFond(rafraichir($))
    enFond(importerHistorique($))
    $.clock.every(RAFRAICHISSEMENT_MS, () => {
      enFond(rafraichir($))
      enFond(importerHistorique($))
    })
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (e.command?.name === 'temps') return next(e)
    tourCompte = !AUTOMATIQUES.includes(e.origin.kind)
    if (tourCompte) enFond(apresMessage($, e.text, e.isMeta !== true && ECRITS.includes(e.origin.kind)))
    if (e.origin.kind === 'composer') enFond(fermerChampVide($))
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

  // App desktop (clic sur la puce) et VS Code (/temps panneau) : le popover est un panneau.
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

  // Le focus quitte le champ ouvert pour un autre élément de la bande : sans lettre ni chiffre tapé, le champ se ferme.
  // L'app ne signale pas un clic hors de la bande ; un message envoyé dans le chat ferme aussi le champ vide.
  on('ui.focus', async ($, e, next) => {
    const { edition } = await read($, ui)
    const champ = edition === null ? null : edition === 'autre' ? 'autre-item' : 'renommer'
    if (e.element !== champ) await fermerChampVide($)
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
