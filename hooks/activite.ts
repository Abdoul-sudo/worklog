// La frise d'activité, comme celle de GitHub : une case par jour, une colonne par semaine.
// Logique pure, testée par tests/activite.test.ts.
import { cleJour, debutJour, debutSemaine, decalerJours, formatDuree, formatJour, majuscule } from './calcul'

export const SEMAINES = 26

export type Case = { t: number; minutes: number }

/** Les jours des SEMAINES dernières semaines, du lundi au dimanche, jusqu'à aujourd'hui. */
export function cases(maintenant: number, minutesParJour: ReadonlyMap<string, number>): Case[] {
  const aujourdhui = debutJour(maintenant)
  const liste: Case[] = []
  for (let t = decalerJours(debutSemaine(maintenant), -7 * (SEMAINES - 1)); t <= aujourdhui; t = decalerJours(t, 1)) {
    liste.push({ t, minutes: minutesParJour.get(cleJour(t)) ?? 0 })
  }
  return liste
}

/** 0 : rien ; 1 : moins d'une heure ; 2 : moins de 3 h ; 3 : moins de 5 h ; 4 : 5 h ou plus. */
export function niveau(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0
  if (minutes < 60) return 1
  if (minutes < 180) return 2
  if (minutes < 300) return 3
  return 4
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const OPACITES = [0.14, 0.35, 0.55, 0.78, 1]
const ORANGE = '#D97757'
const GRIS = '#8A8A8A'

/** La frise en SVG, pour l'app desktop et VS Code. Une infobulle donne la date et le temps. */
export function svgActivite(liste: readonly Case[]): { source: string; largeur: number; hauteur: number } {
  const cote = 9
  const pas = 11
  const haut = 13
  const colonnes = Math.ceil(liste.length / 7)
  const largeur = colonnes * pas - (pas - cote)
  const hauteur = haut + 7 * pas - (pas - cote)
  const parts: string[] = []
  let moisPrecedent = -1
  liste.forEach((c, i) => {
    const colonne = Math.floor(i / 7)
    const ligne = i % 7
    const mois = new Date(c.t).getMonth()
    if (ligne === 0 && mois !== moisPrecedent) {
      moisPrecedent = mois
      if (colonne < colonnes - 2) {
        parts.push(`<text x="${colonne * pas}" y="9" font-size="9" fill="${GRIS}" font-family="system-ui,sans-serif">${MOIS_COURTS[mois]}</text>`)
      }
    }
    const n = niveau(c.minutes)
    const couleur = n === 0 ? GRIS : ORANGE
    const infobulle = `${majuscule(formatJour(c.t))} · ${c.minutes > 0 ? formatDuree(c.minutes) : 'rien'}`
    parts.push(
      `<rect x="${colonne * pas}" y="${haut + ligne * pas}" width="${cote}" height="${cote}" rx="2.5" fill="${couleur}" fill-opacity="${OPACITES[n]}"><title>${infobulle}</title></rect>`,
    )
  })
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}">${parts.join('')}</svg>`
  return { source, largeur, hauteur }
}

const COULEURS_TERMINAL = [0x4a4a4a, 0x7a4a3a, 0xa85a42, 0xc8684b, 0xe07a5a]
const DEFAUT = 0x01000000

/** La frise pour le terminal : 7 lignes de `■`, une colonne de caractère sur deux, en base64 pour un Raster. */
export function cellulesActivite(liste: readonly Case[]): { cellules: string; colonnes: number; lignes: number } {
  const semaines = Math.ceil(liste.length / 7)
  const colonnes = semaines * 2 - 1
  const mots = new Uint32Array(colonnes * 7 * 3)
  for (let ligne = 0; ligne < 7; ligne++) {
    for (let colonne = 0; colonne < colonnes; colonne++) {
      const i = (ligne * colonnes + colonne) * 3
      const c = colonne % 2 === 0 ? liste[(colonne / 2) * 7 + ligne] : undefined
      mots[i] = c === undefined ? 0x20 : 0x25a0
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
