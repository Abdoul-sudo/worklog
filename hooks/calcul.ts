// Logique pure du comptage : aucun appel à `$`, testée par tests/calcul.test.ts.
import type { Ecart, Ligne, Plage } from '../types'

export const SANS_TICKET = 'ticket ?'
export const MINUTE = 60_000
// Un tour de Claude plus long, sans réponse notée, est tenu pour abandonné.
const DUREE_MAX_TOUR = 3 * 60 * MINUTE
// Chaque session vivante donne signe de vie toutes les 30 s ; au-delà de cette marge, elle est tenue pour morte
// (fenêtre fermée sans fin de session notée).
const MARGE_VIE = 2 * MINUTE

export type Reglages = {
  seuilPauseMinutes: number
  ecartMaxMinutes: number
  motifs: string[]
  projets: Record<string, string[]>
  format: string
}

export const REGLAGES_PAR_DEFAUT: Reglages = {
  seuilPauseMinutes: 20,
  ecartMaxMinutes: 240,
  motifs: ['FLO-I\\d+', 'FSY-I\\d+', '[A-Z]+-I?\\d+'],
  projets: {},
  format: "{ticket} · {duree} aujourd'hui",
}

export type Choix = 'travail' | 'pause'
export type Activite = 'ouverture' | 'message' | 'reponse' | 'ticket' | 'pause' | 'fermeture'
type EvenementActivite = { t: number; s: string; e: Activite; k: string | null }
type EvenementClassement = { t: number; s: string; e: 'classement'; session: string; debut: number; choix: Choix }
export type Evenement = EvenementActivite | EvenementClassement

export type Jour = { debut: number; lignes: Ligne[]; total: number; reel: number }
export type Bilan = { jours: Jour[]; lignes: Ligne[]; total: number; ecarts: Ecart[] }

export function lireReglages(texte: string | undefined): { reglages: Reglages; erreur?: string } {
  const defaut = REGLAGES_PAR_DEFAUT
  if (texte === undefined) return { reglages: defaut }
  let brut: unknown
  try {
    brut = JSON.parse(texte)
  } catch {
    return { reglages: defaut, erreur: "le fichier n'est pas du JSON valide" }
  }
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
    return { reglages: defaut, erreur: 'le fichier doit contenir un objet JSON' }
  }
  const r = brut as Record<string, unknown>
  const nombre = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
  const textes = (v: unknown) => (Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]) : null)
  const projets: Record<string, string[]> = {}
  if (typeof r.projets === 'object' && r.projets !== null) {
    for (const [dossier, motifs] of Object.entries(r.projets)) {
      const liste = textes(motifs)
      if (liste !== null) projets[dossier] = liste
    }
  }
  return {
    reglages: {
      seuilPauseMinutes: nombre(r.seuilPauseMinutes, defaut.seuilPauseMinutes),
      ecartMaxMinutes: nombre(r.ecartMaxMinutes, defaut.ecartMaxMinutes),
      motifs: textes(r.motifs) ?? defaut.motifs,
      projets,
      format: typeof r.format === 'string' ? r.format : defaut.format,
    },
  }
}

/** Les motifs du projet le plus précis qui contient `cwd`, sinon les motifs généraux. */
export function motifsDuProjet(reglages: Reglages, cwd: string): string[] {
  const norme = (chemin: string) => chemin.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const dossier = norme(cwd)
  let meilleur: string | null = null
  for (const cle of Object.keys(reglages.projets)) {
    const projet = norme(cle)
    const contient = dossier === projet || dossier.startsWith(`${projet}/`)
    if (contient && (meilleur === null || projet.length > norme(meilleur).length)) meilleur = cle
  }
  return meilleur === null ? reglages.motifs : (reglages.projets[meilleur] ?? reglages.motifs)
}

function expression(motif: string, entier: boolean): RegExp | null {
  try {
    return entier ? new RegExp(`^(?:${motif})$`) : new RegExp(`(?<![A-Za-z0-9])(?:${motif})(?![A-Za-z0-9])`)
  } catch {
    return null
  }
}

/** Le premier ID trouvé, en essayant les motifs dans l'ordre. */
export function detecterTicket(texte: string, motifs: readonly string[]): string | null {
  for (const motif of motifs) {
    const trouve = expression(motif, false)?.exec(texte)
    if (trouve) return trouve[0]
  }
  return null
}

export function estUnTicket(texte: string, motifs: readonly string[]): boolean {
  return motifs.some(motif => expression(motif, true)?.test(texte) === true)
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

const deuxChiffres = (n: number) => String(n).padStart(2, '0')

export function cleJour(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`
}

/** Le dernier événement d'activité d'une session, s'il y en a un. */
export function dernierEvenement(evenements: readonly Evenement[], session: string): EvenementActivite | null {
  let dernier: EvenementActivite | null = null
  for (const ev of evenements) {
    if (ev.e !== 'classement' && ev.s === session && (dernier === null || ev.t >= dernier.t)) dernier = ev
  }
  return dernier
}

/**
 * Découpe l'activité de chaque session en plages comptées et en écarts à confirmer.
 * `vivants` donne le dernier signe de vie connu de chaque session.
 * `actives` donne, pour chaque session qui compte en ce moment, son ticket.
 */
export function calculer(
  evenements: readonly Evenement[],
  reglages: Reglages,
  maintenant: number,
  vivants: ReadonlyMap<string, number> = new Map(),
) {
  const seuil = reglages.seuilPauseMinutes * MINUTE
  const ecartMax = reglages.ecartMaxMinutes * MINUTE
  const choix = new Map<string, Choix>()
  const sessions = new Map<string, EvenementActivite[]>()
  for (const ev of [...evenements].sort((a, b) => a.t - b.t)) {
    if (ev.e === 'classement') choix.set(`${ev.session}@${ev.debut}`, ev.choix)
    else if (sessions.has(ev.s)) sessions.get(ev.s)!.push(ev)
    else sessions.set(ev.s, [ev])
  }

  const plages: Plage[] = []
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
      } else if (a.e !== 'ticket') {
        debutTour = null
      }
      if (a.e === 'pause' || a.e === 'fermeture') continue

      const finDeVie = (vivants.get(session) ?? maintenant) + MARGE_VIE
      const fin = b?.t ?? Math.max(a.t, Math.min(maintenant, finDeVie))
      const plage: Plage = { ticket: a.k ?? SANS_TICKET, debut: a.t, fin }
      const claudeTravaille = debutTour !== null && b?.relance !== true && fin - debutTour <= DUREE_MAX_TOUR
      if (claudeTravaille || fin - a.t <= seuil) {
        plages.push(plage)
        if (b === undefined && finDeVie >= maintenant) actives.set(session, plage.ticket)
      } else if (b !== undefined && fin - a.t <= ecartMax) {
        const classe = choix.get(`${session}@${a.t}`)
        if (classe === 'travail') plages.push(plage)
        else if (classe === undefined) ecarts.push({ ...plage, session })
      }
    }
  }
  return { plages, ecarts, actives }
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

const parTemps = (a: Ligne, b: Ligne) => b.minutes - a.minutes || a.ticket.localeCompare(b.ticket)

/** Temps par ticket et par jour sur [debut, fin[, bornes au début d'un jour. */
export function bilan(
  evenements: readonly Evenement[],
  reglages: Reglages,
  maintenant: number,
  debut: number,
  fin: number,
  vivants: ReadonlyMap<string, number> = new Map(),
): Bilan {
  const { plages, ecarts, actives } = calculer(evenements, reglages, maintenant, vivants)
  const tickets = new Map<string, Segment[]>()
  for (const ticket of new Set(plages.map(p => p.ticket))) {
    tickets.set(ticket, unir(plages.filter(p => p.ticket === ticket)))
  }
  const tous = unir(plages)
  const enCours = new Set(actives.values())

  const jours: Jour[] = []
  const totaux = new Map<string, number>()
  for (let jour = debut; jour < fin; jour = jourSuivant(jour)) {
    const lendemain = jourSuivant(jour)
    const lignes: Ligne[] = []
    for (const [ticket, segments] of tickets) {
      const minutes = Math.round(recouvrement(segments, jour, lendemain) / MINUTE)
      if (minutes === 0) continue
      lignes.push({ ticket, minutes, enCours: enCours.has(ticket) })
      totaux.set(ticket, (totaux.get(ticket) ?? 0) + minutes)
    }
    if (lignes.length === 0) continue
    const total = lignes.reduce((somme, l) => somme + l.minutes, 0)
    const reel = Math.round(recouvrement(tous, jour, lendemain) / MINUTE)
    jours.push({ debut: jour, lignes: lignes.sort(parTemps), total, reel })
  }

  const lignes = [...totaux].map(([ticket, minutes]) => ({ ticket, minutes, enCours: enCours.has(ticket) }))
  // Un écart déjà couvert par une autre session sur le même ticket n'a rien à confirmer.
  const aConfirmer = ecarts
    .filter(e => e.debut >= debut && e.debut < fin)
    .filter(e => e.fin - e.debut - recouvrement(tickets.get(e.ticket) ?? [], e.debut, e.fin) >= MINUTE)
    .sort((a, b) => a.debut - b.debut)
  return {
    jours,
    lignes: lignes.sort(parTemps),
    total: lignes.reduce((somme, l) => somme + l.minutes, 0),
    ecarts: aConfirmer,
  }
}

export function formatDuree(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${deuxChiffres(minutes % 60)}`
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

export function formatJour(t: number): string {
  const d = new Date(t)
  const quantieme = d.getDate() === 1 ? '1er' : String(d.getDate())
  return `${JOURS[d.getDay()]} ${quantieme} ${MOIS[d.getMonth()]}`
}

/** Met `ticket` en tête des tickets récents, sans doublon, six au plus. */
export function ajouterRecent(recents: readonly string[], ticket: string): string[] {
  return [ticket, ...recents.filter(t => t !== ticket)].slice(0, 6)
}

/** Une barre de `largeur` cases : la part pleine et la part vide, proportionnelles à `minutes / max`. */
export function barre(minutes: number, max: number, largeur: number): [string, string] {
  const plein = max > 0 ? Math.max(minutes > 0 ? 1 : 0, Math.round((minutes / max) * largeur)) : 0
  return ['━'.repeat(plein), '─'.repeat(largeur - plein)]
}

export function ligneStatut(format: string, ticket: string, minutes: number, enPause: boolean): string {
  const texte = format.replaceAll('{ticket}', ticket).replaceAll('{duree}', formatDuree(minutes))
  return enPause ? `${texte} · en pause` : texte
}
