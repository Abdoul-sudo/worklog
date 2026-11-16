// Logique pure du comptage : aucun appel à `$`, testée par tests/calcul.test.ts.
import type { Ecart, Ligne, Plage } from '../types'
import { type Langue, LANGUES, t as texte } from './langue'

export const SANS_ITEM = 'sans nom'
export const MINUTE = 60_000
// Un tour de Claude, ou des sous-agents, actifs plus longtemps sans fin notée sont tenus pour abandonnés.
const DUREE_MAX_TOUR = 12 * 60 * MINUTE
// Chaque session vivante donne signe de vie toutes les 30 s ; au-delà de cette marge, elle est tenue pour morte
// (fenêtre fermée sans fin de session notée).
export const MARGE_VIE = 2 * MINUTE
// Pendant une longue pause, des agents travaillent tant que leurs tokens ne cessent pas plus longtemps que ceci. Des
// dépenses plus espacées (une boucle planifiée toutes les 30 min) laissent Claude inactif entre elles.
const SILENCE_TRAVAIL = 15 * MINUTE

/** Les réglages, modifiables dans la vue Réglages du popover. */
export type Options = {
  /** En minutes : une pause plus courte compte comme du travail, au retour. */
  seuilPause: number
  /** En minutes : une pause plus longue que le seuil, et pas plus que ceci, devient une question ; au-delà, elle ne
   * compte pas. 0 : jamais de question. */
  pauseMax: number
  activite: boolean
  langue: Langue
  /** Ce que le popover montre : le temps et les tokens, ou l'un des deux. */
  mesure: Mesure
  theme: Theme
}

export type Mesure = 'tout' | 'temps' | 'jetons'
export const MESURES: readonly Mesure[] = ['tout', 'temps', 'jetons']
/** Les thèmes du popover ; leurs couleurs et leurs fonds sont dans dessins.ts. */
export type Theme = 'nuit' | 'simple' | 'aurore' | 'braise' | 'foret' | 'ocean' | 'crepuscule' | 'sakura'
// Dans les réglages, dans cet ordre : le plus sobre d'abord.
export const THEMES_IDS: readonly Theme[] = ['simple', 'nuit', 'aurore', 'braise', 'foret', 'ocean', 'crepuscule', 'sakura']

export const OPTIONS_PAR_DEFAUT: Options = {
  seuilPause: 60,
  pauseMax: 240,
  activite: true,
  langue: 'en',
  mesure: 'tout',
  theme: 'nuit',
}

/** Les choix des réglages des pauses, en minutes : « Rester actif pendant » et « Puis demander » (0 : jamais). */
export const SEUILS = [15, 30, 60, 120]
export const PAUSES_MAX = [0, 60, 120, 240, 480]

/** Les choix de « Puis demander » : jamais, ou une durée plus longue que « Rester actif pendant ». */
export const choixDemande = (o: Options): number[] => PAUSES_MAX.filter(m => m === 0 || m > o.seuilPause)
/** « Puis demander » tel qu'il agit : une durée pas plus longue que « Rester actif pendant » ne pose jamais de question. */
export const demandeEffective = (o: Options): number => (o.pauseMax > o.seuilPause ? o.pauseMax : 0)

/** Le format des ID de tickets : une clé en majuscules, un tiret, puis un numéro, comme PROJ-142, ENG-42 ou FSY-I478.
 * Un numéro d'un seul chiffre ne suffit pas (UTF-8, GPT-4), et des sigles techniques courants sont écartés (ISO-8601,
 * SHA-256, RFC-7231) : ce ne sont pas des tickets. */
export const MOTIF_ID = '(?!(?:UTF|ISO|SHA|RFC|CVE|ES|AES|RSA|IEEE|ECMA|PEP|SQL|GPT|HTTP|TLS|SSL|COVID)-)[A-Z][A-Z0-9]{1,9}-(?:I\\d+|\\d{2,})'

/** Les réglages enregistrés, chaque valeur invalide remplacée par sa valeur par défaut. */
export function lireOptions(brut: unknown): Options {
  const r = typeof brut === 'object' && brut !== null ? (brut as Record<string, unknown>) : {}
  const d = OPTIONS_PAR_DEFAUT
  const oui = (v: unknown, defaut: boolean) => (typeof v === 'boolean' ? v : defaut)
  return {
    seuilPause: SEUILS.find(m => m === r.seuilPause) ?? d.seuilPause,
    pauseMax: PAUSES_MAX.find(m => m === r.pauseMax) ?? d.pauseMax,
    activite: oui(r.activite, d.activite),
    langue: LANGUES.find(l => l === r.langue) ?? d.langue,
    mesure: MESURES.find(m => m === r.mesure) ?? d.mesure,
    theme: THEMES_IDS.find(x => x === r.theme) ?? d.theme,
  }
}

export type Choix = 'travail' | 'pause'
// `agents-debut` et `agents-fin` : des sous-agents (workflows, Ultracode) travaillent, puis s'arrêtent.
export type Activite = 'ouverture' | 'message' | 'reponse' | 'item' | 'pause' | 'fermeture' | 'agents-debut' | 'agents-fin'
// `k` : l'item choisi ou trouvé (ID cité, branche Git, choix dans la liste).
// `d` : le nom par défaut de la session (le dossier du projet).
// `i` : l'événement vient de l'historique de Claude Code (scripts/importer.mjs), pas du journal tenu par le mod.
type EvenementActivite = { t: number; s: string; e: Activite; k: string | null; d?: string; i?: 1 }
type EvenementClassement = { t: number; s: string; e: 'classement'; session: string; debut: number; choix: Choix }
type EvenementJetons = { t: number; s: string; e: 'jetons'; n: number; k: string | null; d?: string; i?: 1 }
export type Evenement = EvenementActivite | EvenementClassement | EvenementJetons

/**
 * Réunit le journal du mod et l'historique importé de Claude Code.
 * - Une session que le mod n'a pas suivie vient tout entière de l'historique ; elle n'est jamais en cours.
 * - Une session suivie garde son journal ; l'historique ne comble que le temps d'avant, sous le nom de la session.
 * - Les tokens viennent de l'historique (toutes les réponses, sous-agents compris, une fois chacune), comptés à l'item
 *   que la session avait à ce moment. Ceux du journal ne comptent qu'après la dernière importation (`importeJusqua`).
 */
export function fusionner(evenements: readonly Evenement[], importeJusqua: number): Evenement[] {
  const suivis = new Map<string, EvenementActivite[]>()
  for (const ev of [...evenements].sort((a, b) => a.t - b.t)) {
    if (ev.e === 'classement' || ev.e === 'jetons' || ev.i === 1) continue
    const liste = suivis.get(ev.s)
    if (liste === undefined) suivis.set(ev.s, [ev])
    else liste.push(ev)
  }
  const aCeMoment = (s: string, t: number): EvenementActivite | undefined => {
    const liste = suivis.get(s)
    return liste === undefined ? undefined : (liste.filter(ev => ev.t <= t).at(-1) ?? liste[0])
  }
  // Une session venue de l'historique seul n'est jamais en cours : elle se ferme à son dernier moment.
  const fins = new Map<string, number>()
  for (const ev of evenements) if (ev.e !== 'classement' && ev.i === 1 && !suivis.has(ev.s)) fins.set(ev.s, Math.max(fins.get(ev.s) ?? 0, ev.t))
  const fermetures = [...fins].map(([s, t]): Evenement => ({ t, s, e: 'fermeture', k: null, i: 1 }))
  return [...evenements.flatMap((ev): Evenement[] => {
    if (ev.e === 'classement') return [ev]
    if (ev.i !== 1) return ev.e === 'jetons' && ev.t <= importeJusqua ? [] : [ev]
    const liste = suivis.get(ev.s)
    if (liste === undefined) return [ev]
    const premier = liste[0]!
    if (ev.e === 'jetons') {
      const moment = ev.t < premier.t ? undefined : aCeMoment(ev.s, ev.t)
      // Le nom par défaut de ce moment-là : il change quand l'app desktop donne son dossier à une session lancée en attente.
      const defaut = (moment ?? premier).d
      return [{ ...ev, ...(moment === undefined ? {} : { k: moment.k }), ...(defaut === undefined ? {} : { d: defaut }) }]
    }
    return ev.t < premier.t ? [{ ...ev, ...(premier.d === undefined ? {} : { d: premier.d }) }] : []
  }), ...fermetures]
}

/** Un temps retiré à la main : celui de `item` entre `debut` et `fin`. */
export type Retrait = { item: string; debut: number; fin: number }
/** Les corrections faites à la main : noms changés, temps retirés. */
export type Corrections = { renommages: Readonly<Record<string, string>>; retraits: readonly Retrait[] }
export const SANS_CORRECTION: Corrections = { renommages: {}, retraits: [] }

export type Jour = { debut: number; lignes: Ligne[]; total: number; reel: number; jetons: number }
/** `parSession` : les minutes de chaque session sur la période, item par item. */
export type Bilan = {
  jours: Jour[]
  lignes: Ligne[]
  total: number
  reel: number
  jetons: number
  ecarts: Ecart[]
  parSession: Map<string, Map<string, number>>
  /** La dernière activité de chaque item sur la période : la fin de son dernier temps, ou sa dernière dépense de tokens. */
  derniere: Map<string, number>
  /** Les sessions en pause (une pause notée au journal par une version passée), une fois que Claude a fini son travail. */
  enPause: Set<string>
}

function expression(motif: string, entier: boolean): RegExp | null {
  try {
    return entier ? new RegExp(`^(?:${motif})$`) : new RegExp(`(?<![A-Za-z0-9])(?:${motif})(?![A-Za-z0-9])`)
  } catch {
    return null
  }
}

/** Le premier ID du texte, ou null. */
export function detecterItem(texte: string, motif: string): string | null {
  return expression(motif, false)?.exec(texte)?.[0] ?? null
}

/** Le nom à afficher : suit les renommages, sans boucler. */
export function nommer(item: string, renommages: Readonly<Record<string, string>>): string {
  let nom = item
  for (let i = 0; i < 20; i++) {
    const suivant = Object.hasOwn(renommages, nom) ? renommages[nom] : undefined
    if (suivant === undefined || suivant === nom) break
    nom = suivant
  }
  return nom
}

/** Lit un journal JSONL ; une ligne abîmée (écriture en cours) est ignorée. */
export function lireLignes(texte: string): Evenement[] {
  const evenements: Evenement[] = []
  for (const ligne of texte.split('\n')) {
    if (ligne.trim() === '') continue
    try {
      const ev = JSON.parse(ligne) as Evenement
      if (typeof ev.t === 'number' && typeof ev.s === 'string') evenements.push(ev)
    } catch {
      // Ligne incomplète : l'autre session est en train d'écrire.
    }
  }
  return evenements
}

export function debutJour(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function decalerJours(debut: number, jours: number): number {
  // Depuis midi : un jour où minuit n'existe pas (l'heure d'été à minuit) garde le même début que debutJour.
  const d = new Date(debut)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + jours)
  return debutJour(d.getTime())
}

export function jourSuivant(debut: number): number {
  return decalerJours(debut, 1)
}

/** Le lundi de la semaine de `t`, à minuit. */
export function debutSemaine(t: number): number {
  const jour = debutJour(t)
  return decalerJours(jour, -((new Date(jour).getDay() + 6) % 7))
}

const deuxChiffres = (n: number) => String(n).padStart(2, '0')

export function cleJour(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`
}

/**
 * Découpe l'activité de chaque session en plages comptées et en écarts à confirmer.
 * `vivants` donne le dernier signe de vie connu de chaque session.
 * `actives` donne, pour chaque session où Claude travaille en ce moment, son item.
 * Une pause encore ouverte (la session vit, Claude a fini, rien depuis) ne compte pas encore : elle est jugée au retour,
 * au prochain message, ou quand la session se ferme.
 * `enPause` donne les sessions en pause (une pause notée au journal par une version passée), une fois que Claude a fini son travail.
 */
export function calculer(
  evenements: readonly Evenement[],
  options: Options,
  maintenant: number,
  vivants: ReadonlyMap<string, number> = new Map(),
) {
  const seuil = options.seuilPause * MINUTE
  const pauseMax = options.pauseMax * MINUTE
  const choix = new Map<string, Choix>()
  const sessions = new Map<string, EvenementActivite[]>()
  const consos: EvenementJetons[] = []
  for (const ev of [...evenements].sort((a, b) => a.t - b.t)) {
    if (ev.e === 'classement') choix.set(`${ev.session}@${ev.debut}`, ev.choix)
    else if (ev.e === 'jetons') consos.push(ev)
    else if (sessions.has(ev.s)) sessions.get(ev.s)!.push(ev)
    else sessions.set(ev.s, [ev])
  }

  // Le premier item trouvé dans la session (message, branche Git) reçoit aussi le temps passé avant lui ;
  // sans item, le temps va au nom par défaut. Un item choisi à la main ne compte qu'à partir du choix.
  const premiers = new Map<string, string>()
  const choisis = new Set<string>()
  for (const ev of [...evenements].sort((a, b) => a.t - b.t)) {
    if (ev.e === 'item') choisis.add(ev.s)
    else if (ev.e !== 'classement' && ev.k !== null && !premiers.has(ev.s) && !choisis.has(ev.s)) premiers.set(ev.s, ev.k)
  }
  const itemDe = (ev: EvenementActivite | EvenementJetons) => ev.k ?? premiers.get(ev.s) ?? ev.d ?? SANS_ITEM

  // Les instants où chaque session a dépensé des tokens : Claude ou ses sous-agents (workflows, Ultracode) travaillaient.
  const depenses = new Map<string, number[]>()
  for (const ev of consos) {
    const liste = depenses.get(ev.s)
    if (liste === undefined) depenses.set(ev.s, [ev.t])
    else liste.push(ev.t)
  }
  /** Le plus long silence de [debut, fin] une fois comptées les dépenses de tokens de la session. */
  const plusLongSilence = (session: string, debut: number, fin: number) => {
    const points = [debut, ...(depenses.get(session) ?? []).filter(x => x > debut && x < fin), fin]
    return Math.max(...points.slice(1).map((x, i) => x - points[i]!))
  }

  const plages: Ecart[] = []
  const ecarts: Ecart[] = []
  const actives = new Map<string, string>()
  const enPause = new Set<string>()
  for (const [session, brute] of sessions) {
    // Ouvrir une session n'est pas travailler : l'ouverture ne compte pas, elle marque
    // seulement que le processus a redémarré (un tour resté ouvert avant est mort).
    const liste: Array<EvenementActivite & { relance: boolean }> = []
    let relance = false
    for (const ev of brute) {
      if (ev.e === 'ouverture') relance = true
      else liste.push({ ...ev, relance })
      if (ev.e !== 'ouverture') relance = false
    }

    // Début du tour de Claude en cours : entre un message et sa réponse, Claude travaille.
    let debutTour: number | null = null
    // Début du travail des sous-agents : tant qu'ils tournent, Claude travaille aussi, même sans message.
    let debutAgents: number | null = null
    // Après une pause notée au journal (versions passées), jusqu'au prochain message : seul le travail de Claude compte encore, jusqu'à sa fin.
    let arrete = false
    for (let i = 0; i < liste.length; i++) {
      const a = liste[i]!
      const b = liste[i + 1]
      if (a.relance) {
        debutTour = null
        debutAgents = null
      }
      if (a.e === 'message') {
        debutTour = debutTour !== null && a.t - debutTour <= DUREE_MAX_TOUR ? debutTour : a.t
        arrete = false
      } else if (a.e !== 'item' && a.e !== 'agents-debut' && a.e !== 'agents-fin' && a.e !== 'pause') {
        debutTour = null
      }
      if (a.e === 'agents-debut') debutAgents ??= a.t
      if (a.e === 'agents-fin') debutAgents = null
      if (a.e === 'pause') arrete = true
      if (a.e === 'fermeture') continue

      const finDeVie = (vivants.get(session) ?? maintenant) + MARGE_VIE
      const fin = b?.t ?? Math.max(a.t, Math.min(maintenant, finDeVie))
      const plage: Ecart = { item: itemDe(a), debut: a.t, fin, session }
      const enCoursDepuis = (debut: number | null) => debut !== null && b?.relance !== true && fin - debut <= DUREE_MAX_TOUR
      const claudeTravaille = enCoursDepuis(debutTour) || enCoursDepuis(debutAgents)
      if (arrete && !claudeTravaille) continue
      const ouverte = b === undefined && finDeVie >= maintenant
      // Une pause courte compte au retour. Plus longue, elle compte si les tokens n'ont pas cessé de partir : des agents
      // travaillaient.
      const travailAgents = fin - a.t <= seuil || plusLongSilence(session, a.t, fin) <= SILENCE_TRAVAIL
      if (claudeTravaille || (!ouverte && travailAgents)) {
        plages.push(plage)
        if (ouverte) actives.set(session, plage.item)
      } else if (b !== undefined && fin - a.t <= pauseMax) {
        const classe = choix.get(`${session}@${a.t}`)
        if (classe === 'travail') plages.push(plage)
        else if (classe === undefined) ecarts.push(plage)
      }
    }
    if (arrete && !actives.has(session)) enPause.add(session)
  }
  const jetons = consos.map(ev => ({ item: itemDe(ev), t: ev.t, n: ev.n, session: ev.s }))
  return { plages, ecarts, actives, jetons, enPause }
}

type Segment = [number, number]

/** Union des plages : un même instant ne compte qu'une fois. */
function unir(plages: readonly Plage[]): Segment[] {
  const segments: Segment[] = []
  for (const { debut, fin } of [...plages].sort((a, b) => a.debut - b.debut)) {
    const dernier = segments.at(-1)
    if (dernier !== undefined && debut <= dernier[1]) dernier[1] = Math.max(dernier[1], fin)
    else segments.push([debut, fin])
  }
  return segments
}

function recouvrement(segments: readonly Segment[], debut: number, fin: number): number {
  let total = 0
  for (const [a, b] of segments) total += Math.max(0, Math.min(b, fin) - Math.max(a, debut))
  return total
}

/** Ce qui reste d'une plage une fois les temps retirés de son item enlevés. */
function sansRetraits(plage: Ecart, retraits: readonly Retrait[]): Ecart[] {
  let morceaux = [plage]
  for (const r of retraits) {
    if (r.item !== plage.item) continue
    morceaux = morceaux.flatMap(m => {
      if (r.fin <= m.debut || r.debut >= m.fin) return [m]
      const restes: Ecart[] = []
      if (m.debut < r.debut) restes.push({ ...m, fin: r.debut })
      if (r.fin < m.fin) restes.push({ ...m, debut: r.fin })
      return restes
    })
  }
  return morceaux
}

const parTemps = (a: Ligne, b: Ligne) => b.minutes - a.minutes || b.jetons - a.jetons || a.item.localeCompare(b.item)

/** Temps et tokens par item et par jour sur [debut, fin[, bornes au début d'un jour. `avecJetonsSeulement` : un item qui
 * n'a dépensé aucun token sur la période n'a ni ligne ni temps compté (rien n'a été fait), sauf s'il est en cours. */
export function bilan(
  evenements: readonly Evenement[],
  options: Options,
  maintenant: number,
  debut: number,
  fin: number,
  vivants: ReadonlyMap<string, number> = new Map(),
  corrections: Corrections = SANS_CORRECTION,
  avecJetonsSeulement = false,
): Bilan {
  const calcul = calculer(evenements, options, maintenant, vivants)
  const nom = (item: string) => nommer(item, corrections.renommages)
  const retire = (item: string, t: number) => corrections.retraits.some(r => r.item === item && t >= r.debut && t < r.fin)
  const toutes = calcul.plages.flatMap(p => sansRetraits({ ...p, item: nom(p.item) }, corrections.retraits))
  const tousJetons = calcul.jetons.map(j => ({ ...j, item: nom(j.item) })).filter(j => !retire(j.item, j.t))
  const enCours = new Set([...calcul.actives.values()].map(nom))
  // Le temps de chaque session (la puce) garde tout ; les lignes et les totaux laissent les items sans token.
  const avecJetons = new Set(tousJetons.filter(j => j.n > 0 && j.t >= debut && j.t < fin).map(j => j.item))
  const garde = (item: string) => !avecJetonsSeulement || avecJetons.has(item) || enCours.has(item)
  const plages = toutes.filter(p => garde(p.item))
  const jetons = tousJetons.filter(j => garde(j.item))

  const items = new Map<string, Segment[]>()
  for (const item of new Set([...plages.map(p => p.item), ...jetons.map(j => j.item)])) {
    items.set(item, unir(plages.filter(p => p.item === item)))
  }
  const tous = unir(plages)
  const jetonsParJour = new Map<string, number>()
  for (const j of jetons) {
    const cle = `${debutJour(j.t)}|${j.item}`
    jetonsParJour.set(cle, (jetonsParJour.get(cle) ?? 0) + j.n)
  }

  const jours: Jour[] = []
  const totaux = new Map<string, { minutes: number; jetons: number }>()
  // Le total et le temps réel de la période, en millisecondes : arrondis une seule fois, ils ne diffèrent que d'un vrai
  // temps en parallèle.
  let totalBrut = 0
  let reelBrut = 0
  for (let jour = debut; jour < fin; jour = jourSuivant(jour)) {
    const lendemain = jourSuivant(jour)
    const lignes: Ligne[] = []
    let brut = 0
    for (const [item, segments] of items) {
      const duree = recouvrement(segments, jour, lendemain)
      brut += duree
      const minutes = Math.round(duree / MINUTE)
      const n = jetonsParJour.get(`${jour}|${item}`) ?? 0
      if (minutes === 0 && n === 0) continue
      lignes.push({ item, minutes, enCours: enCours.has(item), jetons: n })
      const cumul = totaux.get(item) ?? { minutes: 0, jetons: 0 }
      totaux.set(item, { minutes: cumul.minutes + minutes, jetons: cumul.jetons + n })
    }
    if (lignes.length === 0) continue
    const reel = recouvrement(tous, jour, lendemain)
    totalBrut += brut
    reelBrut += reel
    jours.push({
      debut: jour,
      lignes: lignes.sort(parTemps),
      total: Math.round(brut / MINUTE),
      reel: Math.round(reel / MINUTE),
      jetons: lignes.reduce((s, l) => s + l.jetons, 0),
    })
  }

  const lignes = [...totaux].map(([item, t]) => ({ item, minutes: t.minutes, enCours: enCours.has(item), jetons: t.jetons }))
  // Un écart déjà couvert par une autre session sur le même item n'a rien à confirmer.
  const aConfirmer = calcul.ecarts
    .map(e => ({ ...e, item: nom(e.item) }))
    .filter(e => e.debut >= debut && e.debut < fin && !retire(e.item, e.debut))
    .filter(e => e.fin - e.debut - recouvrement(items.get(e.item) ?? [], e.debut, e.fin) >= MINUTE)
    .sort((a, b) => a.debut - b.debut)
  const parSession = new Map<string, Map<string, number>>()
  for (const p of toutes) {
    const items = parSession.get(p.session) ?? new Map<string, number>()
    if (!items.has(p.item)) {
      const segments = unir(toutes.filter(q => q.session === p.session && q.item === p.item))
      items.set(p.item, Math.round(recouvrement(segments, debut, fin) / MINUTE))
    }
    parSession.set(p.session, items)
  }
  const derniere = new Map<string, number>()
  const noterDerniere = (item: string, t: number) => derniere.set(item, Math.max(derniere.get(item) ?? -Infinity, t))
  for (const p of plages) if (p.fin > debut && p.debut < fin) noterDerniere(p.item, Math.min(p.fin, fin))
  for (const j of jetons) if (j.t >= debut && j.t < fin) noterDerniere(j.item, j.t)
  return {
    parSession,
    jours,
    lignes: lignes.sort(parTemps),
    total: Math.round(totalBrut / MINUTE),
    reel: Math.round(reelBrut / MINUTE),
    jetons: lignes.reduce((s, l) => s + l.jetons, 0),
    ecarts: aConfirmer,
    derniere,
    enPause: calcul.enPause,
  }
}

export function formatDuree(minutes: number): string {
  return texte().duree(Math.floor(minutes / 60), minutes % 60)
}

/** `850`, `12,4 k`, `245 k`, `1,2 M`, `4,9 Md` ; en anglais `12.4k`, `4.9B`. */
export function formatJetons(n: number): string {
  const { nombre, unites } = texte()
  if (n < 1_000) return String(n)
  if (n < 100_000) return `${nombre(n / 1_000)}${unites.mille}`
  if (n < 999_500) return `${Math.round(n / 1_000)}${unites.mille}`
  if (n < 100_000_000) return `${nombre(n / 1_000_000)}${unites.million}`
  if (n < 999_500_000) return `${Math.round(n / 1_000_000)}${unites.million}`
  return `${nombre(n / 1_000_000_000)}${unites.milliard}`
}

export function dureeEcart(ecart: Plage): string {
  return formatDuree(Math.round((ecart.fin - ecart.debut) / MINUTE))
}

export function formatHeure(t: number): string {
  const d = new Date(t)
  return texte().heure(d.getHours(), d.getMinutes())
}

export const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1)

export function formatJour(t: number): string {
  const d = new Date(t)
  const { jours, mois, date } = texte()
  return date(jours[d.getDay()]!, d.getDate(), mois[d.getMonth()]!)
}

/** Le titre de l'onglet Tout : « Depuis le 12 novembre », « Since Nov 12 » ; avec l'année quand ce n'est pas celle de
 * `maintenant`. */
export function depuis(t: number, maintenant = t): string {
  const d = new Date(t)
  return avecAnnee(texte().depuis(d.getDate(), texte().mois[d.getMonth()]!), t, maintenant)
}

/** Ajoute l'année au titre quand `t` n'est pas dans l'année de `maintenant`. */
function avecAnnee(titre: string, t: number, maintenant: number): string {
  const annee = new Date(t).getFullYear()
  return annee === new Date(maintenant).getFullYear() ? titre : texte().annee(titre, annee)
}

export type Periode = 'jour' | 'semaine' | 'mois' | 'annee'

/** Les bornes et le titre d'une période, `decalage` périodes avant celle de `maintenant`. */
export function bornes(periode: Periode, decalage: number, maintenant: number): { debut: number; fin: number; titre: string } {
  if (periode === 'jour') {
    const debut = decalerJours(debutJour(maintenant), decalage)
    const titre = decalage === 0 ? texte().aujourdhui : decalage === -1 ? texte().hier : avecAnnee(majuscule(formatJour(debut)), debut, maintenant)
    return { debut, fin: jourSuivant(debut), titre }
  }
  if (periode === 'semaine') {
    const debut = decalerJours(debutSemaine(maintenant), 7 * decalage)
    const d = new Date(debut)
    const titre =
      decalage === 0
        ? texte().cetteSemaine
        : decalage === -1
          ? texte().semaineDerniere
          : avecAnnee(texte().semaineDu(d.getDate(), texte().mois[d.getMonth()]!), debut, maintenant)
    return { debut, fin: decalerJours(debut, 7), titre }
  }
  const d = new Date(maintenant)
  if (periode === 'annee') {
    const annee = d.getFullYear() + decalage
    return { debut: new Date(annee, 0, 1).getTime(), fin: new Date(annee + 1, 0, 1).getTime(), titre: String(annee) }
  }
  const debut = new Date(d.getFullYear(), d.getMonth() + decalage, 1).getTime()
  const m = new Date(debut)
  const annee = m.getFullYear() === d.getFullYear() ? '' : ` ${m.getFullYear()}`
  return { debut, fin: new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime(), titre: `${majuscule(texte().mois[m.getMonth()]!)}${annee}` }
}

/** Met `item` en tête des items récents, sans doublon, six au plus. */
export function ajouterRecent(recents: readonly string[], item: string): string[] {
  return [item, ...recents.filter(t => t !== item)].slice(0, 6)
}

/** Le texte de la puce : `⏱ FSY-I478 · 2 h 14`, ou `⏱ 2 h 14` sans nom. */
export function libellePuce(item: string | null, minutes: number, enPause: boolean, terminal = false): string {
  const nom = item === null ? '' : `${item} · `
  // Le terminal dessine ⏱ et ⏸ sur deux colonnes sans les compter : ils mordraient sur le nom.
  const signe = terminal ? (enPause ? '‖' : '◷') : enPause ? '⏸' : '⏱'
  return `${signe} ${nom}${formatDuree(minutes)}`
}
