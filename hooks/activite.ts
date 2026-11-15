// La frise d'activité, comme celle de GitHub : une case par jour, une colonne par semaine.
// Logique pure, testée par tests/activite.test.ts.
import { cleJour, debutJour, debutSemaine, decalerJours, formatDuree, formatJetons, formatJour, majuscule } from './calcul'
import { ENCRE, aUnCiel } from './dessins'
import { t } from './langue'

export type Case = { t: number; minutes: number; jetons?: number }

/** Les jours de `debut` à `fin` (inclus), en semaines qui commencent le lundi. Les jours d'avant `debut` calent la grille
 * avec -1 minute : ils ne sont pas dessinés. Les jours après `aujourdhui` sont à venir : -2 minutes, une case à peine
 * visible. `jetonsParJour` donne aussi les tokens de chaque jour. */
export function casesEntre(
  debut: number,
  fin: number,
  minutesParJour: ReadonlyMap<string, number>,
  aujourdhui = Infinity,
  jetonsParJour: ReadonlyMap<string, number> = new Map(),
): Case[] {
  const premier = debutJour(debut)
  const dernier = debutJour(fin)
  const liste: Case[] = []
  for (let t = debutSemaine(debut); t <= dernier; t = decalerJours(t, 1)) {
    const minutes = t < premier ? -1 : t > aujourdhui ? -2 : (minutesParJour.get(cleJour(t)) ?? 0)
    liste.push(minutes < 0 ? { t, minutes } : { t, minutes, jetons: jetonsParJour.get(cleJour(t)) ?? 0 })
  }
  return liste
}

/** Les jours de travail d'affilée jusqu'à aujourd'hui. Un samedi ou un dimanche sans travail ne coupe pas la série,
 * ni aujourd'hui tant que rien n'y est compté. */
export function serie(liste: readonly Case[]): number {
  let jours = 0
  let aujourdhui = true
  for (let i = liste.length - 1; i >= 0; i--) {
    const c = liste[i]!
    if (c.minutes < 0) continue
    const semaine = new Date(c.t).getDay()
    if (c.minutes > 0) jours++
    else if (!aujourdhui && semaine !== 0 && semaine !== 6) break
    aujourdhui = false
  }
  return jours
}

/** 0 : rien ; 1 : moins d'une heure ; 2 : moins de 3 h ; 3 : moins de 5 h ; 4 : 5 h ou plus. */
export function niveau(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0
  if (minutes < 60) return 1
  if (minutes < 180) return 2
  if (minutes < 300) return 3
  return 4
}

const OPACITES = [0.1, 0.32, 0.55, 0.78, 1]

/** La frise en SVG, pour le fond sombre du popover (app desktop et VS Code). Une infobulle donne la date et le temps ;
 * la case d'aujourd'hui est cerclée. La `periode` de l'onglet est mise en avant : un jour par un cercle, une semaine ou
 * un mois par une bande claire derrière ses colonnes. Une année entière prend des cases plus petites, pour tenir à côté
 * des stats. */
export function svgActivite(
  liste: readonly Case[],
  aujourdhui: number | null,
  periode: { debut: number; fin: number } | null,
  parJetons = false,
): { source: string; largeur: number; hauteur: number } {
  const annuelle = liste.length > 27 * 7
  const cote = annuelle ? 7 : 10
  const pas = annuelle ? 8 : 12
  const haut = 14
  const colonnes = Math.ceil(liste.length / 7)
  const largeur = colonnes * pas - (pas - cote)
  const hauteur = haut + 7 * pas - (pas - cote)
  // Un fond plein sous les cases quand le thème a une trame : elle ne se voit pas au travers.
  const parts: string[] = aUnCiel() ? [`<rect x="0" y="${haut}" width="${largeur}" height="${hauteur - haut}" fill="${ENCRE.fond}"/>`] : []
  // La période de l'onglet : un jour se cercle ; plus long, une bande claire couvre ses colonnes.
  const dansPeriode = (c: Case) => periode !== null && c.t >= periode.debut && c.t < periode.fin
  const unJour = periode !== null && periode.fin - periode.debut <= 25 * 3600_000
  const colonnesPeriode = liste.flatMap((c, i) => (dansPeriode(c) ? [Math.floor(i / 7)] : []))
  if (!unJour && colonnesPeriode.length > 0) {
    const de = Math.min(...colonnesPeriode)
    const a = Math.max(...colonnesPeriode)
    parts.push(
      `<rect x="${de * pas - 2}" y="${haut - 2}" width="${(a - de + 1) * pas + 2}" height="${7 * pas + 2}" rx="3" fill="${ENCRE.vif}" fill-opacity=".07"/>`,
    )
  }
  let moisPrecedent = -1
  const etiquettes: { colonne: number; mois: number }[] = []
  liste.forEach((c, i) => {
    const mois = new Date(c.t).getMonth()
    if (i % 7 === 0 && mois !== moisPrecedent) {
      moisPrecedent = mois
      etiquettes.push({ colonne: Math.floor(i / 7), mois })
    }
  })
  // Un libellé prend environ trois colonnes : le premier mois, souvent tronqué, cède sa place au suivant, et un libellé
  // qui déborderait à droite n'est pas écrit.
  if (etiquettes.length > 1 && etiquettes[1]!.colonne - etiquettes[0]!.colonne < 3) etiquettes.shift()
  // Le dernier mois, trop près du bord droit pour commencer à sa colonne, est aligné sur ce bord s'il y a la place.
  let finPrecedente = -Infinity
  for (const { colonne, mois } of etiquettes) {
    const x = colonne * pas
    const auBord = x + 24 > largeur
    if (auBord && largeur - 24 < finPrecedente + 4) continue
    finPrecedente = auBord ? largeur : x + 24
    const ancre = auBord ? ` x="${largeur}" text-anchor="end"` : ` x="${x}"`
    parts.push(`<text${ancre} y="10" font-size="10.5" fill="${ENCRE.legende}" font-family="system-ui,sans-serif">${t().moisCourts[mois]}</text>`)
  }
  const maxJetons = Math.max(1, ...liste.map(c => c.jetons ?? 0))
  const niveauJetons = (n: number) => (n <= 0 ? 0 : (Math.min(4, Math.ceil((4 * n) / maxJetons)) as 1 | 2 | 3 | 4))
  liste.forEach((c, i) => {
    const colonne = Math.floor(i / 7)
    const ligne = i % 7
    if (c.minutes === -1) return
    const avenir = c.minutes === -2
    // Par tokens : quatre niveaux, du jour le plus dépensier de la frise au plus sobre.
    const n = avenir ? 0 : parJetons ? niveauJetons(c.jetons ?? 0) : niveau(c.minutes)
    const couleur = n === 0 ? ENCRE.vide : ENCRE.accent
    const estAujourdhui = aujourdhui !== null && c.t === aujourdhui
    const cercle = estAujourdhui || (unJour && dansPeriode(c)) ? ' stroke="${ENCRE.vif}" stroke-opacity=".6"' : ''
    // Aujourd'hui sans son temps : le dessin ne change ainsi qu'au changement de niveau, pas à chaque minute.
    const jetons = (c.jetons ?? 0) > 0 ? ` · ${t().tokens(formatJetons(c.jetons!))}` : ''
    const infobulle = estAujourdhui ? t().aujourdhui : `${majuscule(formatJour(c.t))} · ${c.minutes > 0 ? formatDuree(c.minutes) : t().rien}${jetons}`
    parts.push(
      `<rect x="${colonne * pas}" y="${haut + ligne * pas}" width="${cote}" height="${cote}" rx="${annuelle ? 1.5 : 2.5}" fill="${couleur}" fill-opacity="${avenir ? 0.035 : OPACITES[n]}"${cercle}>${avenir ? '' : `<title>${infobulle}</title>`}</rect>`,
    )
  })
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}" preserveAspectRatio="xMinYMin meet">${parts.join('')}</svg>`
  return { source, largeur, hauteur }
}

const COULEURS_TERMINAL = [0x4a4a4a, 0x7a4a3a, 0xa85a42, 0xc8684b, 0xe07a5a]
const DEFAUT = 0x01000000

/** La frise pour le terminal : 7 lignes de `■`, une colonne de caractère sur deux, en base64 pour un Raster. */
export function cellulesActivite(toutes: readonly Case[]): { cellules: string; colonnes: number; lignes: number } {
  // Le terminal garde les 26 dernières semaines : une année ne tient pas à côté de la liste.
  const liste = toutes.slice(-26 * 7)
  const semaines = Math.ceil(liste.length / 7)
  const colonnes = semaines * 2 - 1
  const mots = new Uint32Array(colonnes * 7 * 3)
  for (let ligne = 0; ligne < 7; ligne++) {
    for (let colonne = 0; colonne < colonnes; colonne++) {
      const i = (ligne * colonnes + colonne) * 3
      const c = colonne % 2 === 0 ? liste[(colonne / 2) * 7 + ligne] : undefined
      mots[i] = c === undefined || c.minutes < 0 ? 0x20 : 0x25a0
      mots[i + 1] = c === undefined ? DEFAUT : COULEURS_TERMINAL[niveau(c.minutes)]!
      mots[i + 2] = DEFAUT
    }
  }
  return { cellules: base64(new Uint8Array(mots.buffer)), colonnes, lignes: 7 }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(octets: Uint8Array): string {
  let texte = ''
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i]!
    const b = octets[i + 1]
    const c = octets[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    texte += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    texte += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!
    texte += c === undefined ? '=' : ALPHABET[n & 63]!
  }
  return texte
}
