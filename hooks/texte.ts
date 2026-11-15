// Textes de la commande /temps, faits pour être recopiés dans Zoho Sprints.
import type { Ecart, Ligne } from '../types'
import { type Bilan, SANS_ITEM, dureeEcart, formatDuree, formatHeure, formatJetons, formatJour, majuscule } from './calcul'
import { t } from './langue'

function tableau(lignes: readonly Ligne[], total: number, jetons: number | null): string[] {
  const { recap } = t()
  const nom = (item: string) => (item === SANS_ITEM ? t().sansNom : item)
  const largeur = Math.max(recap.total.length, ...lignes.map(l => nom(l.item).length))
  const ligne = (texte: string, minutes: number, n: number, suite = '') =>
    `  ${texte.padEnd(largeur)}  ${formatDuree(minutes).padStart(7)}${jetons === null ? '' : `  ${formatJetons(n).padStart(7)} tokens`}${suite}`
  return [...lignes.map(l => ligne(nom(l.item), l.minutes, l.jetons, l.enCours ? recap.enCours : '')), ligne(recap.total, total, jetons ?? 0)]
}

export function listeEcarts(ecarts: readonly Ecart[]): string[] {
  const { recap } = t()
  if (ecarts.length === 0) return [recap.aucunEcart]
  return [
    recap.ecarts,
    ...ecarts.map((e, i) => recap.ecart(i + 1, formatJour(e.debut), e.item, formatHeure(e.debut), formatHeure(e.fin), dureeEcart(e))),
    recap.classer,
    recap.exemple,
  ]
}

/** Le récapitulatif d'une période : par jour si `parJour`, puis le total par item. */
export function recap(titre: string, bilan: Bilan, ecarts: readonly Ecart[], parJour: boolean): string {
  const textes = t().recap
  if (bilan.lignes.length === 0) return textes.aucun(titre)
  const lignes = [titre]
  if (parJour) {
    for (const j of bilan.jours) {
      lignes.push('', majuscule(formatJour(j.debut)), ...tableau(j.lignes, j.total, j.jetons))
    }
    lignes.push('', textes.total)
  } else {
    lignes.push('')
  }
  lignes.push(...tableau(bilan.lignes, bilan.total, bilan.jetons))
  if (bilan.total > bilan.reel) lignes.push('', textes.reel(formatDuree(bilan.reel)))
  if (ecarts.length > 0) lignes.push('', ...listeEcarts(ecarts))
  return lignes.join('\n')
}

export function aide(): string {
  return t().aide.join('\n')
}
