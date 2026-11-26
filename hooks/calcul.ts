// Logique pure du comptage : aucun appel à `$`, testée par tests/calcul.test.ts.
import type { Cache, Ecart, Ligne, Part, Plage, Repartition } from '../types'
import { type Langue, LANGUES, t as texte } from './langue'

export const SANS_ITEM = 'sans nom'
export const MINUTE = 60_000
// Un tour de Claude actif plus longtemps sans fin notée, ou des sous-agents sans nouveau signe pendant ce temps, sont
// tenus pour abandonnés : leur fin n'a pas été vue.
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
  /** Ce que le popover montre à côté des tokens : le temps, ou leur prix API. */
  mesure: Mesure
  theme: Theme
  /** La puce du cache de prompt. */
  cache: boolean
}

// `tout` : le temps et les tokens ; `jetons` : les tokens et leur prix API, sans le temps.
export type Mesure = 'tout' | 'jetons'
export const MESURES: readonly Mesure[] = ['tout', 'jetons']
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
  cache: true,
}

/** Les choix des réglages des pauses, en minutes : « Rester actif pendant » et « Puis demander » (0 : jamais). */
export const SEUILS = [5, 10, 15, 30, 45, 60, 90, 120, 180]
export const PAUSES_MAX = [0, 30, 60, 120, 180, 240, 360, 480, 720]

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
    cache: oui(r.cache, d.cache),
  }
}

export type Choix = 'travail' | 'pause'
// `agents-debut` et `agents-fin` : des sous-agents (workflows, Ultracode) travaillent, puis s'arrêtent. Pendant un long
// travail, `agents-debut` revient chaque heure : les agents travaillent encore.
// `fond-debut` et `fond-fin` : Claude attend un travail de fond (une commande, un Monitor), puis l'un d'eux finit.
export type Activite =
  | 'ouverture'
  | 'message'
  | 'reponse'
  | 'item'
  | 'pause'
  | 'fermeture'
  | 'agents-debut'
  | 'agents-fin'
  | 'fond-debut'
  | 'fond-fin'
// `k` : l'item choisi ou trouvé (ID cité, branche Git, choix dans la liste).
// `d` : le nom par défaut de la session (le dossier du projet).
// `i` : l'événement vient de l'historique de Claude Code (scripts/importer.mjs), pas du journal tenu par le mod.
type EvenementActivite = { t: number; s: string; e: Activite; k: string | null; d?: string; i?: 1 }
type EvenementClassement = { t: number; s: string; e: 'classement'; session: string; debut: number; choix: Choix }
// `p` : le détail des réponses, par modèle, pour leur prix API ; `c` : ce prix, en dollars, ajouté à la lecture (avecCouts).
// `r` : ces tokens et leur prix par type et par modèle, ajoutés à la lecture (avecCouts).
type EvenementJetons = { t: number; s: string; e: 'jetons'; n: number; k: string | null; d?: string; i?: 1; p?: Detail[]; c?: number; r?: Repartition }
// Un ID cité dans un message qu'une conversation reprise par l'app a recopié (scripts/importer.mjs) : il nomme la session
// reprise, sans temps.
type EvenementRepere = { t: number; s: string; e: 'repere'; k: string; d?: string; i: 1 }
export type Evenement = EvenementActivite | EvenementClassement | EvenementJetons | EvenementRepere

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
    if (ev.e === 'classement' || ev.e === 'jetons' || ev.e === 'repere' || ev.i === 1) continue
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
  for (const ev of evenements) if (ev.e !== 'classement' && ev.e !== 'repere' && ev.i === 1 && !suivis.has(ev.s)) fins.set(ev.s, Math.max(fins.get(ev.s) ?? 0, ev.t))
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

export type Jour = { debut: number; lignes: Ligne[]; total: number; reel: number; jetons: number; cout: number }
export type Bilan = {
  jours: Jour[]
  lignes: Ligne[]
  total: number
  reel: number
  jetons: number
  /** Le prix API des tokens, en dollars : ceux dont le détail est connu. */
  cout: number
  /** Les tokens de la période et leur prix, par type et par modèle : ceux dont le détail est connu. */
  repartition: Repartition
  ecarts: Ecart[]
  /** Les minutes de chaque item sur la période, toutes sessions comprises : le temps commun ne compte qu'une fois. Les
   * items sans token gardent leur temps. */
  parItem: Map<string, number>
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

/** La longueur maximale d'un nom tapé, en caractères. */
export const NOM_MAX = 60

/** Un nom tapé (renommage, autre item, /worklog <nom>), nettoyé : sans caractère de contrôle ni marque invisible de sens
 * d'écriture, les espaces réduits, coupé à NOM_MAX caractères. null sans lettre ni chiffre, ou pour le nom réservé aux
 * sessions sans nom. */
export function nomSaisi(texte: string): string | null {
  const propre = texte
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[​‎‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const nom = [...propre].slice(0, NOM_MAX).join('').trim()
  return /[\p{L}\p{N}]/u.test(nom) && nom !== SANS_ITEM ? nom : null
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
    // Un repère ne fait que nommer sa session (premiers, plus bas) : il n'ouvre ni ne ferme aucun temps.
    else if (ev.e === 'repere') continue
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
  /** Les moments de travail de [debut, fin] : là où les dépenses de tokens de la session se suivent à moins de
   * SILENCE_TRAVAIL. Un moment de moins d'une minute (les tokens d'une seule réponse) n'en est pas un. */
  const travauxDans = (session: string, debut: number, fin: number) => {
    const points = [debut, ...(depenses.get(session) ?? []).filter(x => x > debut && x < fin), fin]
    const travaux: Array<{ debut: number; fin: number }> = []
    let depart = debut
    for (let i = 1; i <= points.length; i++) {
      if (i < points.length && points[i]! - points[i - 1]! <= SILENCE_TRAVAIL) continue
      if (points[i - 1]! - depart >= MINUTE) travaux.push({ debut: depart, fin: points[i - 1]! })
      if (i < points.length) depart = points[i]!
    }
    return travaux
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
    // Dernier signe des sous-agents (leur début, noté de nouveau chaque heure) : tant qu'ils tournent, Claude travaille
    // aussi, même sans message.
    let debutAgents: number | null = null
    // Claude attend un travail de fond (une commande, un Monitor).
    let attenteFond = false
    // Après une pause notée au journal (versions passées), jusqu'au prochain message : seul le travail de Claude compte encore, jusqu'à sa fin.
    let arrete = false
    for (let i = 0; i < liste.length; i++) {
      const a = liste[i]!
      const b = liste[i + 1]
      if (a.relance) {
        debutTour = null
        debutAgents = null
        attenteFond = false
      }
      if (a.e === 'message') {
        debutTour = debutTour !== null && a.t - debutTour <= DUREE_MAX_TOUR ? debutTour : a.t
        arrete = false
      } else if (!['item', 'pause', 'agents-debut', 'agents-fin', 'fond-debut', 'fond-fin'].includes(a.e)) {
        debutTour = null
      }
      if (a.e === 'agents-debut') debutAgents = a.t
      if (a.e === 'agents-fin') debutAgents = null
      if (a.e === 'fond-debut') attenteFond = true
      if (a.e === 'fond-fin') attenteFond = false
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
      // Claude attend un travail de fond : l'attente compte pendant qu'elle dure, et au bout si elle finit avec ce travail.
      // Si la personne revient avant (un serveur qui ne finit jamais, par exemple), c'est une pause comme une autre.
      const attente = attenteFond && (ouverte || b?.e === 'fond-fin')
      if (claudeTravaille || attente || (!ouverte && travailAgents)) {
        plages.push(plage)
        if (ouverte) actives.set(session, plage.item)
      } else {
        // Une longue pause se juge en entier : une question si elle n'est pas trop longue, et la réponse vaut pour toute
        // la pause. Sans réponse « travail », les moments où les tokens partaient encore comptent quand même : Claude ou
        // ses agents travaillaient (un Ultracode lancé avant de partir, par exemple).
        const aJuger = b !== undefined && fin - a.t <= pauseMax
        const classe = aJuger ? choix.get(`${session}@${a.t}`) : undefined
        if (classe === 'travail') plages.push(plage)
        else {
          if (aJuger && classe === undefined) ecarts.push(plage)
          if (!ouverte) for (const travail of travauxDans(session, a.t, fin)) plages.push({ ...plage, ...travail })
        }
      }
    }
    if (arrete && !actives.has(session)) enPause.add(session)
  }
  const jetons = consos.map(ev => ({ item: itemDe(ev), t: ev.t, n: ev.n, c: ev.c ?? 0, r: ev.r, session: ev.s }))
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
  // Le temps de chaque item (la puce) garde tout ; les lignes et les totaux laissent les items sans token.
  const avecJetons = new Set(tousJetons.filter(j => j.n > 0 && j.t >= debut && j.t < fin).map(j => j.item))
  const garde = (item: string) => !avecJetonsSeulement || avecJetons.has(item) || enCours.has(item)
  const plages = toutes.filter(p => garde(p.item))
  const jetons = tousJetons.filter(j => garde(j.item))

  const items = new Map<string, Segment[]>()
  for (const item of new Set([...plages.map(p => p.item), ...jetons.map(j => j.item)])) {
    items.set(item, unir(plages.filter(p => p.item === item)))
  }
  const tous = unir(plages)
  const jetonsParJour = new Map<string, { n: number; c: number }>()
  for (const j of jetons) {
    const cle = `${debutJour(j.t)}|${j.item}`
    const cumul = jetonsParJour.get(cle) ?? { n: 0, c: 0 }
    jetonsParJour.set(cle, { n: cumul.n + j.n, c: cumul.c + j.c })
  }

  const jours: Jour[] = []
  const totaux = new Map<string, { minutes: number; jetons: number; cout: number }>()
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
      const { n, c } = jetonsParJour.get(`${jour}|${item}`) ?? { n: 0, c: 0 }
      if (minutes === 0 && n === 0) continue
      lignes.push({ item, minutes, enCours: enCours.has(item), jetons: n, cout: c })
      const cumul = totaux.get(item) ?? { minutes: 0, jetons: 0, cout: 0 }
      totaux.set(item, { minutes: cumul.minutes + minutes, jetons: cumul.jetons + n, cout: cumul.cout + c })
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
      cout: lignes.reduce((s, l) => s + l.cout, 0),
    })
  }

  // Le détail des tokens de la période, item par item et en tout.
  const repartition = repartitionVide()
  const repartitions = new Map<string, Repartition>()
  for (const j of jetons) {
    if (j.r === undefined || j.t < debut || j.t >= fin) continue
    cumuler(repartition, j.r)
    if (!repartitions.has(j.item)) repartitions.set(j.item, repartitionVide())
    cumuler(repartitions.get(j.item)!, j.r)
  }
  const lignes = [...totaux].map(([item, t]) => ({
    item,
    minutes: t.minutes,
    enCours: enCours.has(item),
    jetons: t.jetons,
    cout: t.cout,
    ...(repartitions.has(item) ? { repartition: repartitions.get(item)! } : {}),
  }))
  // Un écart déjà couvert par une autre session sur le même item n'a rien à confirmer.
  const aConfirmer = calcul.ecarts
    .map(e => ({ ...e, item: nom(e.item) }))
    .filter(e => e.debut >= debut && e.debut < fin && !retire(e.item, e.debut))
    .filter(e => e.fin - e.debut - recouvrement(items.get(e.item) ?? [], e.debut, e.fin) >= MINUTE)
    .sort((a, b) => a.debut - b.debut)
  const parItem = new Map<string, number>()
  for (const item of new Set(toutes.map(p => p.item))) {
    parItem.set(item, Math.round(recouvrement(unir(toutes.filter(p => p.item === item)), debut, fin) / MINUTE))
  }
  const derniere = new Map<string, number>()
  const noterDerniere = (item: string, t: number) => derniere.set(item, Math.max(derniere.get(item) ?? -Infinity, t))
  for (const p of plages) if (p.fin > debut && p.debut < fin) noterDerniere(p.item, Math.min(p.fin, fin))
  for (const j of jetons) if (j.t >= debut && j.t < fin) noterDerniere(j.item, j.t)
  return {
    parItem,
    jours,
    lignes: lignes.sort(parTemps),
    total: Math.round(totalBrut / MINUTE),
    reel: Math.round(reelBrut / MINUTE),
    jetons: lignes.reduce((s, l) => s + l.jetons, 0),
    cout: lignes.reduce((s, l) => s + l.cout, 0),
    repartition,
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

/** Ce que des réponses d'un modèle ont lu et écrit, en tokens : `in` hors cache, `c5` et `c1` écrits en cache pour 5 min
 * et pour 1 h, `cr` relus du cache, `out` générés ; `web` : les recherches web ; `rapide` : le mode rapide ; `us` :
 * l'inférence gardée aux États-Unis. */
export type Detail = { m: string; in: number; out: number; c5: number; c1: number; cr: number; web?: number; rapide?: 1; us?: 1; ctx?: number }
/** Les prix de LiteLLM des modèles Claude, en dollars par token, tels que le mod les garde (prix.json). */
export type Prix = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/** De la liste de LiteLLM (tous les fournisseurs, tous les modèles), les modèles Claude vendus par Anthropic et leurs
 * prix ; sans les prix des lots (Batch API), que Claude Code n'utilise pas. */
export function prixClaude(liste: unknown): Prix {
  const garde: Record<string, Record<string, unknown>> = {}
  if (typeof liste !== 'object' || liste === null) return garde
  for (const [modele, entree] of Object.entries(liste)) {
    if (!modele.startsWith('claude-') || typeof entree !== 'object' || entree === null) continue
    const champs = entree as Record<string, unknown>
    if (champs.litellm_provider !== 'anthropic') continue
    garde[modele] = Object.fromEntries(
      Object.entries(champs).filter(([cle]) => (cle.includes('cost') && !cle.endsWith('_batches')) || cle === 'provider_specific_entry'),
    )
  }
  return garde
}

export const repartitionVide = (): Repartition => ({
  entree: { n: 0, c: 0 },
  sortie: { n: 0, c: 0 },
  ecriture: { n: 0, c: 0 },
  lecture: { n: 0, c: 0 },
  web: 0,
  modeles: {},
})

const ajouter = (a: Part, n: number, c: number) => {
  a.n += n
  a.c += c
}

/** Ajoute `r` à `total`. */
export function cumuler(total: Repartition, r: Readonly<Repartition>): void {
  for (const type of ['entree', 'sortie', 'ecriture', 'lecture'] as const) ajouter(total[type], r[type].n, r[type].c)
  total.web += r.web
  for (const [modele, p] of Object.entries(r.modeles)) ajouter((total.modeles[modele] ??= { n: 0, c: 0 }), p.n, p.c)
}

/** Le nom court d'un modèle : `claude-opus-5-5` donne `Opus 5.5`, `claude-3-5-sonnet-20241022` donne `Sonnet 3.5`. */
export function nomModele(id: string): string {
  const morceaux = id.replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-')
  const mots = morceaux.filter(m => !/^\d+$/.test(m))
  const version = morceaux.filter(m => /^\d+$/.test(m)).join('.')
  if (mots.length === 0) return id
  return [mots.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' '), version].filter(Boolean).join(' ')
}

/** Le prix API d'une réponse en dollars, par type de token, d'après les prix de LiteLLM ; null pour un modèle sans prix
 * connu. Les facteurs (mode rapide, inférence aux États-Unis) s'appliquent aux tokens, pas aux recherches web. */
function coutsReponse(d: Detail, prix: Prix) {
  const entree = prix[d.m] ?? prix[d.m.replace(/-\d{8}$/, '')]
  if (entree === undefined) return null
  const valeur = (cle: string) => (typeof entree[cle] === 'number' ? (entree[cle] as number) : undefined)
  // Au-delà d'un seuil de contexte (100 k pour Haiku 5.5, 200 k pour d'anciens Sonnet), tous les tokens d'une réponse ont
  // d'autres prix. Le palier vient de chaque réponse (`ctx`, en milliers) : une somme de réponses n'en dit rien.
  const seuil = Math.max(
    0,
    ...Object.keys(entree)
      .map(cle => Number(/^input_cost_per_token_above_(\d+)k_tokens$/.exec(cle)?.[1] ?? 0))
      .filter(k => k > 0 && (d.ctx ?? 0) >= k),
  )
  const prixDe = (cle: string) => (seuil > 0 ? valeur(`${cle}_above_${seuil}k_tokens`) : undefined) ?? valeur(cle)
  const lecture = prixDe('input_cost_per_token')
  const ecriture = prixDe('output_cost_per_token')
  if (lecture === undefined || ecriture === undefined) return null
  // Sans prix de cache, ceux d'Anthropic : écrire coûte 1,25 fois la lecture pour 5 min, 2 fois pour 1 h ; relire, 0,1 fois.
  const facteurs = (entree.provider_specific_entry ?? {}) as Readonly<Record<string, unknown>>
  const facteur = (cle: string) => (typeof facteurs[cle] === 'number' ? (facteurs[cle] as number) : 1)
  const recherche = entree.search_context_cost_per_query as Readonly<Record<string, unknown>> | undefined
  const parRecherche = typeof recherche?.search_context_size_medium === 'number' ? recherche.search_context_size_medium : 0.01
  return {
    entree: d.in * lecture,
    sortie: d.out * ecriture,
    ecriture:
      d.c5 * (prixDe('cache_creation_input_token_cost') ?? lecture * 1.25) +
      d.c1 * (prixDe('cache_creation_input_token_cost_above_1hr') ?? lecture * 2),
    lecture: d.cr * (prixDe('cache_read_input_token_cost') ?? lecture * 0.1),
    facteur: (d.rapide === 1 ? facteur('fast') : 1) * (d.us === 1 ? facteur('us') : 1),
    web: (d.web ?? 0) * parRecherche,
  }
}

/** Le prix API de réponses en dollars, d'après les prix de LiteLLM ; null pour un modèle sans prix connu. */
export function coutReponse(d: Detail, prix: Prix): number | null {
  const c = coutsReponse(d, prix)
  return c === null ? null : (c.entree + c.sortie + c.ecriture + c.lecture) * c.facteur + c.web
}

/** Les tokens de réponses et leur prix, par type et par modèle ; un modèle sans prix connu a ses tokens, sans prix. */
function repartir(details: readonly Detail[], prix: Prix | null): Repartition {
  const r = repartitionVide()
  for (const d of details) {
    const c = prix === null ? null : coutsReponse(d, prix)
    const f = c?.facteur ?? 0
    ajouter(r.entree, d.in, (c?.entree ?? 0) * f)
    ajouter(r.sortie, d.out, (c?.sortie ?? 0) * f)
    ajouter(r.ecriture, d.c5 + d.c1, (c?.ecriture ?? 0) * f)
    ajouter(r.lecture, d.cr, (c?.lecture ?? 0) * f)
    r.web += c?.web ?? 0
    const n = d.in + d.out + d.c5 + d.c1 + d.cr
    if (n > 0) ajouter((r.modeles[d.m] ??= { n: 0, c: 0 }), n, prix === null ? 0 : (coutReponse(d, prix) ?? 0))
  }
  return r
}

/** Le prix API de chaque dépense de tokens (`c`), et son détail par type et par modèle (`r`), d'après ses réponses ; sans
 * prix connu, `c` manque et le détail n'a que des tokens. */
export function avecCouts(evenements: readonly Evenement[], prix: Prix | null): Evenement[] {
  return evenements.map(ev => {
    if (ev.e !== 'jetons' || ev.p === undefined) return ev
    const r = repartir(ev.p, prix)
    const couts = prix === null ? [] : ev.p.map(d => coutReponse(d, prix)).filter((c): c is number => c !== null)
    return couts.length === 0 ? { ...ev, r } : { ...ev, c: couts.reduce((a, b) => a + b, 0), r }
  })
}

/** `3,40 $`, `31 $`, `3 162 $`, `< 0,01 $` ; en anglais `$3.40`, `$31`, `$3,162`, `< $0.01`. */
export function formatCout(usd: number): string {
  const { cout, centimes, milliers } = texte()
  // Arrondi au centime d'abord : 9,996 $ s'écrit 10 $, comme 10,40 $.
  const montant = Math.round(usd * 100) / 100
  if (montant < 0.01) return `< ${cout(centimes(0.01))}`
  return cout(montant < 10 ? centimes(montant) : String(Math.round(montant)).replace(/\B(?=(\d{3})+$)/g, milliers))
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

/** Combien de temps le cache de prompt vit sans appel au modèle. */
export const DUREES_CACHE = { '5m': 5 * MINUTE, '1h': 60 * MINUTE } as const

/** Les minutes qui restent au cache à `maintenant`, arrondies vers le haut (« 1 min » jusqu'à la dernière seconde) ;
 * 0 quand il est froid. */
export function restantCache(cache: Cache, maintenant: number): number {
  const fin = cache.appel + DUREES_CACHE[cache.ttl]
  return cache.froid || maintenant >= fin ? 0 : Math.ceil((fin - maintenant) / MINUTE)
}

/** Les tokens d'une réponse comme le moteur les donne aux mods. Quand l'API les sépare, il ajoute l'écrit pour 5 min et
 * l'écrit pour 1 h, à plat ; ses types ne déclarent pas ces deux champs. */
export type UsageCache = {
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  ephemeral_5m_input_tokens?: number
  ephemeral_1h_input_tokens?: number
}

/** La durée du cache après une réponse arrivée `depuis` ms après l'appel d'avant. Claude Code écrit en général pour 1 h :
 * c'est la durée par défaut. Un écrit pour 1 h la confirme ; un cache encore relu plus de cinq minutes après l'appel
 * d'avant vit aussi 1 h. Seul un contexte surtout écrit, et pour 5 min, donne 5 min : de petits écrits pour 5 min
 * suivent parfois un cache d'une heure. */
export function dureeCache(avant: Cache['ttl'], u: UsageCache, depuis: number): Cache['ttl'] {
  const relu = u.cache_read_input_tokens > u.cache_creation_input_tokens
  if ((u.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
  if (relu && depuis > DUREES_CACHE['5m']) return '1h'
  if ((u.ephemeral_5m_input_tokens ?? 0) > 0 && !relu) return '5m'
  return avant
}

/** Le prix API estimé du contexte au prochain message, en dollars : relu du cache s'il est chaud, réécrit s'il est
 * froid. Null pour un modèle sans prix connu. */
export function prixCache(cache: Cache, prix: Prix): { relu: number; reecrit: number } | null {
  const base: Detail = { m: cache.modele, in: 0, out: 0, c5: 0, c1: 0, cr: 0, ctx: Math.floor(cache.contexte / 1_000) }
  const relu = coutReponse({ ...base, cr: cache.contexte }, prix)
  const reecrit = coutReponse(cache.ttl === '1h' ? { ...base, c1: cache.contexte } : { ...base, c5: cache.contexte }, prix)
  return relu === null || reecrit === null ? null : { relu, reecrit }
}
