// Logique pure du comptage : aucun appel à `$`, testée par tests/calcul.test.ts.
import type { Ecart, Ligne, Plage } from '../types'

export const SANS_ITEM = 'sans nom'
export const MINUTE = 60_000
// Un tour de Claude plus long, sans réponse notée, est tenu pour abandonné.
const DUREE_MAX_TOUR = 3 * 60 * MINUTE
// Chaque session vivante donne signe de vie toutes les 30 s ; au-delà de cette marge, elle est tenue pour morte
// (fenêtre fermée sans fin de session notée).
const MARGE_VIE = 2 * MINUTE
// Un silence plus long est un arrêt (la nuit, le week-end) : il n'est pas proposé à confirmer.
const ECART_MAX = 4 * 60 * MINUTE

/** Les réglages, modifiables dans la vue Réglages du popover. */
export type Options = {
  seuilPause: number
  motif: string
  jetons: boolean
  activite: boolean
  question: boolean
}

export const OPTIONS_PAR_DEFAUT: Options = {
  seuilPause: 20,
  // Les ID des items Zoho Sprints : FLO-I165, FSY-I478, LBA-I12...
  motif: '[A-Z]+-I\\d+',
  jetons: true,
  activite: true,
  question: true,
}

export const SEUILS = [10, 15, 20, 30, 45, 60]

/** Les réglages enregistrés, chaque valeur invalide remplacée par sa valeur par défaut. */
export function lireOptions(brut: unknown): Options {
  const r = typeof brut === 'object' && brut !== null ? (brut as Record<string, unknown>) : {}
  const d = OPTIONS_PAR_DEFAUT
  const oui = (v: unknown, defaut: boolean) => (typeof v === 'boolean' ? v : defaut)
  return {
    seuilPause: typeof r.seuilPause === 'number' && r.seuilPause > 0 ? r.seuilPause : d.seuilPause,
    motif: typeof r.motif === 'string' && expression(r.motif, false) !== null ? r.motif : d.motif,
    jetons: oui(r.jetons, d.jetons),
    activite: oui(r.activite, d.activite),
    question: oui(r.question, d.question),
  }
}

export type Choix = 'travail' | 'pause'
export type Activite = 'ouverture' | 'message' | 'reponse' | 'item' | 'pause' | 'fermeture'
// `k` : l'item choisi ou trouvé (ID cité, branche Git, choix dans la liste).
// `d` : le nom par défaut de la session (groupe de l'app desktop, sinon projet).
type EvenementActivite = { t: number; s: string; e: Activite; k: string | null; d?: string }
type EvenementClassement = { t: number; s: string; e: 'classement'; session: string; debut: number; choix: Choix }
type EvenementJetons = { t: number; s: string; e: 'jetons'; n: number; k: string | null; d?: string }
export type Evenement = EvenementActivite | EvenementClassement | EvenementJetons

/** Un temps retiré à la main : celui de `item` entre `debut` et `fin`. */
export type Retrait = { item: string; debut: number; fin: number }
/** Les corrections faites à la main : noms changés, temps retirés. */
export type Corrections = { renommages: Readonly<Record<string, string>>; retraits: readonly Retrait[] }
export const SANS_CORRECTION: Corrections = { renommages: {}, retraits: [] }

export type Jour = { debut: number; lignes: Ligne[]; total: number; reel: number; jetons: number }
/** `parSession` : les minutes de chaque session sur la période. */
export type Bilan = {
  jours: Jour[]
  lignes: Ligne[]
  total: number
  reel: number
  jetons: number
  ecarts: Ecart[]
  parSession: Map<string, number>
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

export function estUnItem(texte: string, motif: string): boolean {
  return expression(motif, true)?.test(texte) === true
}

export function motifValide(motif: string): boolean {
  return motif.trim() !== '' && expression(motif, false) !== null
}

/** Le nom à afficher : suit les renommages, sans boucler. */
export function nommer(item: string, renommages: Readonly<Record<string, string>>): string {
  let nom = item
  for (let i = 0; i < 20; i++) {
    const suivant = renommages[nom]
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
  const d = new Date(debut)
  d.setDate(d.getDate() + jours)
  return d.getTime()
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

/** Le dernier événement d'activité d'une session, s'il y en a un. */
export function dernierEvenement(evenements: readonly Evenement[], session: string): EvenementActivite | null {
  let dernier: EvenementActivite | null = null
  for (const ev of evenements) {
    if (ev.e !== 'classement' && ev.e !== 'jetons' && ev.s === session && (dernier === null || ev.t >= dernier.t)) {
      dernier = ev
    }
  }
  return dernier
}

/**
 * Découpe l'activité de chaque session en plages comptées et en écarts à confirmer.
 * `vivants` donne le dernier signe de vie connu de chaque session.
 * `actives` donne, pour chaque session qui compte en ce moment, son item.
 */
export function calculer(
  evenements: readonly Evenement[],
  options: Options,
  maintenant: number,
  vivants: ReadonlyMap<string, number> = new Map(),
) {
  const seuil = options.seuilPause * MINUTE
  const choix = new Map<string, Choix>()
  const sessions = new Map<string, EvenementActivite[]>()
  const consos: EvenementJetons[] = []
  for (const ev of [...evenements].sort((a, b) => a.t - b.t)) {
    if (ev.e === 'classement') choix.set(`${ev.session}@${ev.debut}`, ev.choix)
    else if (ev.e === 'jetons') consos.push(ev)
    else if (sessions.has(ev.s)) sessions.get(ev.s)!.push(ev)
    else sessions.set(ev.s, [ev])
  }

  // Le premier item trouvé dans la session reçoit aussi le temps passé avant lui ;
  // sans item, le temps va au nom par défaut.
  const premiers = new Map<string, string>()
  for (const ev of [...evenements].sort((a, b) => a.t - b.t)) {
    if (ev.e !== 'classement' && ev.k !== null && !premiers.has(ev.s)) premiers.set(ev.s, ev.k)
  }
  const itemDe = (ev: EvenementActivite | EvenementJetons) => ev.k ?? premiers.get(ev.s) ?? ev.d ?? SANS_ITEM

  const plages: Ecart[] = []
  const ecarts: Ecart[] = []
  const actives = new Map<string, string>()
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
    for (let i = 0; i < liste.length; i++) {
      const a = liste[i]!
      const b = liste[i + 1]
      if (a.relance) debutTour = null
      if (a.e === 'message') {
        debutTour = debutTour !== null && a.t - debutTour <= DUREE_MAX_TOUR ? debutTour : a.t
      } else if (a.e !== 'item') {
        debutTour = null
      }
      if (a.e === 'pause' || a.e === 'fermeture') continue

      const finDeVie = (vivants.get(session) ?? maintenant) + MARGE_VIE
      const fin = b?.t ?? Math.max(a.t, Math.min(maintenant, finDeVie))
      const plage: Ecart = { item: itemDe(a), debut: a.t, fin, session }
      const claudeTravaille = debutTour !== null && b?.relance !== true && fin - debutTour <= DUREE_MAX_TOUR
      if (claudeTravaille || fin - a.t <= seuil) {
        plages.push(plage)
        if (b === undefined && finDeVie >= maintenant) actives.set(session, plage.item)
      } else if (b !== undefined && fin - a.t <= ECART_MAX) {
        const classe = choix.get(`${session}@${a.t}`)
        if (classe === 'travail') plages.push(plage)
        else if (classe === undefined) ecarts.push(plage)
      }
    }
  }
  const jetons = consos.map(ev => ({ item: itemDe(ev), t: ev.t, n: ev.n, session: ev.s }))
  return { plages, ecarts, actives, jetons }
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

/** Temps et tokens par item et par jour sur [debut, fin[, bornes au début d'un jour. */
export function bilan(
  evenements: readonly Evenement[],
  options: Options,
  maintenant: number,
  debut: number,
  fin: number,
  vivants: ReadonlyMap<string, number> = new Map(),
  corrections: Corrections = SANS_CORRECTION,
): Bilan {
  const calcul = calculer(evenements, options, maintenant, vivants)
  const nom = (item: string) => nommer(item, corrections.renommages)
  const retire = (item: string, t: number) => corrections.retraits.some(r => r.item === item && t >= r.debut && t < r.fin)
  const plages = calcul.plages.flatMap(p => sansRetraits({ ...p, item: nom(p.item) }, corrections.retraits))
  const jetons = calcul.jetons.map(j => ({ ...j, item: nom(j.item) })).filter(j => !retire(j.item, j.t))
  const enCours = new Set([...calcul.actives.values()].map(nom))

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
  for (let jour = debut; jour < fin; jour = jourSuivant(jour)) {
    const lendemain = jourSuivant(jour)
    const lignes: Ligne[] = []
    for (const [item, segments] of items) {
      const minutes = Math.round(recouvrement(segments, jour, lendemain) / MINUTE)
      const n = jetonsParJour.get(`${jour}|${item}`) ?? 0
      if (minutes === 0 && n === 0) continue
      lignes.push({ item, minutes, enCours: enCours.has(item), jetons: n })
      const cumul = totaux.get(item) ?? { minutes: 0, jetons: 0 }
      totaux.set(item, { minutes: cumul.minutes + minutes, jetons: cumul.jetons + n })
    }
    if (lignes.length === 0) continue
    jours.push({
      debut: jour,
      lignes: lignes.sort(parTemps),
      total: lignes.reduce((s, l) => s + l.minutes, 0),
      reel: Math.round(recouvrement(tous, jour, lendemain) / MINUTE),
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
  const parSession = new Map<string, number>()
  for (const session of new Set(plages.map(p => p.session))) {
    const segments = unir(plages.filter(p => p.session === session))
    parSession.set(session, Math.round(recouvrement(segments, debut, fin) / MINUTE))
  }
  return {
    parSession,
    jours,
    lignes: lignes.sort(parTemps),
    total: lignes.reduce((s, l) => s + l.minutes, 0),
    reel: jours.reduce((s, j) => s + j.reel, 0),
    jetons: lignes.reduce((s, l) => s + l.jetons, 0),
    ecarts: aConfirmer,
  }
}

export function formatDuree(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${deuxChiffres(minutes % 60)}`
}

/** `850`, `12,4 k`, `245 k`, `1,2 M`. */
export function formatJetons(n: number): string {
  const virgule = (x: number) => x.toFixed(1).replace('.', ',').replace(/,0$/, '')
  if (n < 1_000) return String(n)
  if (n < 100_000) return `${virgule(n / 1_000)} k`
  if (n < 1_000_000) return `${Math.round(n / 1_000)} k`
  return `${virgule(n / 1_000_000)} M`
}

export function dureeEcart(ecart: Plage): string {
  return formatDuree(Math.round((ecart.fin - ecart.debut) / MINUTE))
}

export function formatHeure(t: number): string {
  const d = new Date(t)
  return `${d.getHours()} h ${deuxChiffres(d.getMinutes())}`
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
export const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1)

export function formatJour(t: number): string {
  const d = new Date(t)
  const quantieme = d.getDate() === 1 ? '1er' : String(d.getDate())
  return `${JOURS[d.getDay()]} ${quantieme} ${MOIS[d.getMonth()]}`
}

export type Periode = 'jour' | 'semaine' | 'mois'

/** Les bornes et le titre d'une période, `decalage` périodes avant celle de `maintenant`. */
export function bornes(periode: Periode, decalage: number, maintenant: number): { debut: number; fin: number; titre: string } {
  if (periode === 'jour') {
    const debut = decalerJours(debutJour(maintenant), decalage)
    const titre = decalage === 0 ? "Aujourd'hui" : decalage === -1 ? 'Hier' : majuscule(formatJour(debut))
    return { debut, fin: jourSuivant(debut), titre }
  }
  if (periode === 'semaine') {
    const debut = decalerJours(debutSemaine(maintenant), 7 * decalage)
    const d = new Date(debut)
    const titre =
      decalage === 0 ? 'Cette semaine' : decalage === -1 ? 'La semaine dernière' : `Semaine du ${d.getDate()} ${MOIS[d.getMonth()]}`
    return { debut, fin: decalerJours(debut, 7), titre }
  }
  const d = new Date(maintenant)
  const debut = new Date(d.getFullYear(), d.getMonth() + decalage, 1).getTime()
  const m = new Date(debut)
  const annee = m.getFullYear() === d.getFullYear() ? '' : ` ${m.getFullYear()}`
  return { debut, fin: new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime(), titre: `${majuscule(MOIS[m.getMonth()]!)}${annee}` }
}

/** Met `item` en tête des items récents, sans doublon, six au plus. */
export function ajouterRecent(recents: readonly string[], item: string): string[] {
  return [item, ...recents.filter(t => t !== item)].slice(0, 6)
}

/** Le texte de la puce : `⏱ FSY-I478 · 2 h 14`, ou `⏱ 2 h 14` sans nom. */
export function libellePuce(item: string | null, minutes: number, enPause: boolean): string {
  const nom = item === null ? '' : `${item} · `
  return `${enPause ? '⏸' : '⏱'} ${nom}${formatDuree(minutes)}`
}

/** Le nom du groupe de l'app desktop où se trouve la session `hote`, lu dans la config de l'app. */
export function nomDuGroupe(config: string, hote: string): string | null {
  type Portee = { groups?: { id?: unknown; name?: unknown }[]; assignments?: Record<string, unknown> }
  try {
    const portees = JSON.parse(config)?.preferences?.epitaxyPrefs?.['dframe-group-scopes'] as Record<string, Portee> | undefined
    for (const portee of Object.values(portees ?? {})) {
      const id = portee.assignments?.[`code:${hote}`]
      const nom = portee.groups?.find(g => g.id === id)?.name
      if (id !== undefined && typeof nom === 'string' && nom.trim() !== '') return nom.trim()
    }
  } catch {
    // Config illisible : pas de groupe.
  }
  return null
}
