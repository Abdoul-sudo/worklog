// La frise d'activité, comme celle de GitHub : une case par jour, une colonne par semaine.
// Logique pure, testée par tests/activite.test.ts.
import { cleJour, debutJour, debutSemaine, decalerJours, formatDuree, formatJetons, formatJour, majuscule } from './calcul'
import { ENCRE, aUnCiel } from './dessins'
import { t } from './langue'
import type { Reglages } from '../types'

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
  return compterSerie(liste).jours
}

/** La série, et `ouverte` quand elle remonte jusqu'à la première case de `liste` : elle peut continuer avant. */
export function compterSerie(liste: readonly Case[]): { jours: number; ouverte: boolean } {
  let jours = 0
  let aujourdhui = true
  for (let i = liste.length - 1; i >= 0; i--) {
    const c = liste[i]!
    if (c.minutes < 0) continue
    const semaine = new Date(c.t).getDay()
    if (c.minutes > 0) jours++
    else if (!aujourdhui && semaine !== 0 && semaine !== 6) return { jours, ouverte: false }
    aujourdhui = false
  }
  return { jours, ouverte: jours > 0 }
}

/** 0 : rien ; 1 : moins d'une heure ; 2 : moins de 3 h ; 3 : moins de 5 h ; 4 : 5 h ou plus. */
export function niveau(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0
  if (minutes < 60) return 1
  if (minutes < 180) return 2
  if (minutes < 300) return 3
  return 4
}

/** Le niveau de chaque case. Par tokens : quatre niveaux, du jour le plus dépensier de la frise au plus sobre. */
function niveaux(liste: readonly Case[], parJetons: boolean): (c: Case) => 0 | 1 | 2 | 3 | 4 {
  if (!parJetons) return c => niveau(c.minutes)
  const max = Math.max(1, ...liste.map(c => c.jetons ?? 0))
  return c => {
    const n = c.jetons ?? 0
    return n <= 0 ? 0 : (Math.min(4, Math.ceil((4 * n) / max)) as 1 | 2 | 3 | 4)
  }
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
  mesure: Reglages['mesure'] = 'tout',
): { source: string; largeur: number; hauteur: number } {
  const annuelle = liste.length > 27 * 7
  const cote = annuelle ? 7 : 10
  const pas = annuelle ? 8 : 12
  const haut = 14
  const colonnes = Math.ceil(liste.length / 7)
  const largeur = colonnes * pas - (pas - cote)
  const hauteur = haut + 7 * pas - (pas - cote)
  const parts: string[] = []
  // La période de l'onglet : un jour se cercle ; plus long, une bande claire couvre ses colonnes.
  const dansPeriode = (c: Case) => periode !== null && c.t >= periode.debut && c.t < periode.fin
  const unJour = periode !== null && periode.fin - periode.debut <= 25 * 3600_000
  const colonnesPeriode = liste.flatMap((c, i) => (dansPeriode(c) ? [Math.floor(i / 7)] : []))
  const de = Math.min(...colonnesPeriode)
  const a = Math.max(...colonnesPeriode)
  const bande = !unJour && colonnesPeriode.length > 0
  if (bande) {
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
  const niveauDe = niveaux(liste, mesure === 'jetons')
  // Sur un thème à trame, une case a sa couleur pleine, déjà mêlée au fond (ou à la bande de la période) : la trame ne
  // passe pas au travers, et les jours hors de la frise restent vides.
  const fondBande = melanger(ENCRE.vif, ENCRE.fond, 0.07)
  liste.forEach((c, i) => {
    const colonne = Math.floor(i / 7)
    const ligne = i % 7
    if (c.minutes === -1) return
    const avenir = c.minutes === -2
    const n = avenir ? 0 : niveauDe(c)
    const couleur = n === 0 ? ENCRE.vide : ENCRE.accent
    const estAujourdhui = aujourdhui !== null && c.t === aujourdhui
    const cercle = estAujourdhui || (unJour && dansPeriode(c)) ? ` stroke="${ENCRE.vif}" stroke-opacity=".6"` : ''
    // Aujourd'hui sans son temps : le dessin ne change ainsi qu'au changement de niveau, pas à chaque minute.
    const temps = c.minutes > 0 ? formatDuree(c.minutes) : t().rien
    const jetons = (c.jetons ?? 0) > 0 ? t().tokens(formatJetons(c.jetons!)) : null
    const valeur = mesure === 'temps' ? temps : mesure === 'jetons' ? (jetons ?? t().rien) : jetons === null ? temps : `${temps} · ${jetons}`
    const infobulle = estAujourdhui ? t().aujourdhui : `${majuscule(formatJour(c.t))} · ${valeur}`
    const opacite = avenir ? 0.035 : OPACITES[n]!
    // Un jour à venir reste presque transparent : la frise ne montre pas de cases sombres après aujourd'hui.
    const dessous = !aUnCiel() || avenir ? null : bande && colonne >= de && colonne <= a ? fondBande : ENCRE.fond
    const peinture = dessous === null ? `fill="${couleur}" fill-opacity="${opacite}"` : `fill="${melanger(couleur, dessous, opacite)}"`
    parts.push(
      `<rect x="${colonne * pas}" y="${haut + ligne * pas}" width="${cote}" height="${cote}" rx="${annuelle ? 1.5 : 2.5}" ${peinture}${cercle}>${avenir ? '' : `<title>${infobulle}</title>`}</rect>`,
    )
  })
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}" preserveAspectRatio="xMinYMin meet">${parts.join('')}</svg>`
  return { source, largeur, hauteur }
}

/** La couleur pleine de `dessus` posée à `opacite` sur `dessous` (deux couleurs #RRGGBB). */
function melanger(dessus: string, dessous: string, opacite: number): string {
  const canal = (couleur: string, i: number) => parseInt(couleur.slice(i, i + 2), 16)
  return `#${[1, 3, 5].map(i => Math.round(canal(dessus, i) * opacite + canal(dessous, i) * (1 - opacite)).toString(16).padStart(2, '0')).join('')}`
}

const COULEURS_TERMINAL = [0x3a3a3a, 0x7a4a3a, 0xa85a42, 0xc8684b, 0xe07a5a]
const DEFAUT = 0x01000000

/** Le dessin de la frise dans le terminal. En cases : un ■ par jour, sept lignes, comme sur GitHub ; une colonne par
 * semaine, ou deux quand la place le permet (un ■ puis un blanc : des cases carrées et espacées). Serré, pour une bande
 * trop basse : deux jours par caractère, l'un au-dessus de l'autre (▀ et sa couleur de fond), sur quatre lignes. */
export type DessinTerminal = 'cases' | 'serre'

/** La frise pour le terminal, en base64 pour un Raster, et `mois`, la ligne des mois à écrire au-dessus. Au plus
 * `semainesMax` semaines : quand l'année ne tient pas, les semaines jusqu'à celle du dernier jour passé. `pas` : les
 * colonnes de chaque semaine, en cases. */
export function cellulesActivite(
  toutes: readonly Case[],
  mesure: Reglages['mesure'] = 'tout',
  dessin: DessinTerminal = 'cases',
  semainesMax = Infinity,
  pas: 1 | 2 = 1,
): { cellules: string; colonnes: number; lignes: number; mois: string } {
  let liste = toutes
  if (Math.ceil(toutes.length / 7) > semainesMax) {
    let dernier = toutes.length - 1
    while (dernier > 0 && toutes[dernier]!.minutes < 0) dernier--
    const fin = Math.floor(dernier / 7) + 1
    liste = toutes.slice(Math.max(0, fin - semainesMax) * 7, fin * 7)
  }
  const semaines = Math.ceil(liste.length / 7)
  const largeur = dessin === 'cases' ? pas : 1
  const colonnes = semaines * largeur
  const lignes = dessin === 'cases' ? 7 : 4
  const niveauDe = niveaux(liste, mesure === 'jetons')
  // Les jours hors de l'année et ceux à venir restent vides.
  const couleur = (c: Case | undefined) => (c === undefined || c.minutes < 0 ? null : COULEURS_TERMINAL[niveauDe(c)]!)
  const mots = new Uint32Array(colonnes * lignes * 3)
  for (let ligne = 0; ligne < lignes; ligne++) {
    for (let semaine = 0; semaine < semaines; semaine++) {
      const i = (ligne * colonnes + semaine * largeur) * 3
      if (dessin === 'cases') {
        const jour = couleur(liste[semaine * 7 + ligne])
        mots[i] = jour === null ? 0x20 : 0x25a0
        mots[i + 1] = jour ?? DEFAUT
        mots[i + 2] = DEFAUT
        // Le blanc qui suit la case, quand une semaine a deux colonnes.
        if (largeur === 2) mots.set([0x20, DEFAUT, DEFAUT], i + 3)
        continue
      }
      const haut = couleur(liste[semaine * 7 + ligne * 2])
      const bas = ligne * 2 + 1 > 6 ? null : couleur(liste[semaine * 7 + ligne * 2 + 1])
      // ▀ peint le jour du haut, le fond celui du bas ; ▄ seul quand il n'y a que celui du bas.
      mots[i] = haut !== null ? 0x2580 : bas !== null ? 0x2584 : 0x20
      mots[i + 1] = haut ?? bas ?? DEFAUT
      mots[i + 2] = haut !== null && bas !== null ? bas : DEFAUT
    }
  }
  return { cellules: base64(new Uint8Array(mots.buffer)), colonnes, lignes, mois: ligneMois(liste, semaines, largeur) }
}

/** Le nom de chaque mois au-dessus de la semaine où il commence, un espace au moins entre deux noms ; avec deux colonnes
 * par semaine, le nom court du mois a la place. Le premier mois, souvent tronqué, cède sa place au suivant s'ils se
 * touchent ; le dernier, trop près du bord droit, s'aligne sur ce bord s'il y a la place. */
function ligneMois(liste: readonly Case[], semaines: number, pas: number): string {
  const ECART = 1
  const noms = pas === 2 ? t().moisCourts : t().moisTerminal
  const etiquettes: { x: number; nom: string }[] = []
  for (let semaine = 0; semaine < semaines; semaine++) {
    const mois = new Date(liste[semaine * 7]!.t).getMonth()
    if (semaine === 0 || mois !== new Date(liste[(semaine - 1) * 7]!.t).getMonth()) etiquettes.push({ x: semaine * pas, nom: noms[mois]! })
  }
  if (etiquettes.length > 1 && etiquettes[1]!.x - etiquettes[0]!.x < etiquettes[0]!.nom.length + ECART) etiquettes.shift()
  let ligne = ''
  for (const etiquette of etiquettes) {
    const x = Math.min(etiquette.x, semaines * pas - etiquette.nom.length)
    if (ligne !== '' && x < ligne.length + ECART) continue
    ligne = ligne.padEnd(x) + etiquette.nom
  }
  return ligne
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
