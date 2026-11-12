// Textes de la commande /temps, faits pour être recopiés dans Zoho Sprints.
import type { Ecart, Ligne } from '../types'
import { type Bilan, dureeEcart, formatDuree, formatHeure, formatJetons, formatJour, majuscule } from './calcul'

function tableau(lignes: readonly Ligne[], total: number, jetons: number | null): string[] {
  const largeur = Math.max('Total'.length, ...lignes.map(l => l.item.length))
  const ligne = (nom: string, minutes: number, n: number, suite = '') =>
    `  ${nom.padEnd(largeur)}  ${formatDuree(minutes).padStart(7)}${jetons === null ? '' : `  ${formatJetons(n).padStart(7)} tokens`}${suite}`
  return [
    ...lignes.map(l => ligne(l.item, l.minutes, l.jetons, l.enCours ? '  (en cours)' : '')),
    ligne('Total', total, jetons ?? 0),
  ]
}

export function listeEcarts(ecarts: readonly Ecart[]): string[] {
  if (ecarts.length === 0) return ['Aucun écart à confirmer sur les 7 derniers jours.']
  return [
    'Écarts à confirmer, non comptés (7 derniers jours) :',
    ...ecarts.map(
      (e, i) => `  ${i + 1}. ${formatJour(e.debut)}, ${e.item}, de ${formatHeure(e.debut)} à ${formatHeure(e.fin)} (${dureeEcart(e)})`,
    ),
    'Pour les classer : /temps confirmer <numéros ou tout> <travail ou pause>',
    'Exemple : /temps confirmer 1 travail',
  ]
}

/** Le récapitulatif d'une période : par jour si `parJour`, puis le total par item. */
export function recap(titre: string, bilan: Bilan, ecarts: readonly Ecart[], avecJetons: boolean, parJour: boolean): string {
  if (bilan.lignes.length === 0) return `${titre} : aucun temps compté.`
  const lignes = [titre]
  if (parJour) {
    for (const j of bilan.jours) {
      lignes.push('', majuscule(formatJour(j.debut)), ...tableau(j.lignes, j.total, avecJetons ? j.jetons : null))
    }
    lignes.push('', 'Total')
  } else {
    lignes.push('')
  }
  lignes.push(...tableau(bilan.lignes, bilan.total, avecJetons ? bilan.jetons : null))
  if (bilan.total > bilan.reel) {
    lignes.push('', `Temps réel : ${formatDuree(bilan.reel)}. Le total est plus grand, car des sessions ont tourné en parallèle.`)
  }
  if (ecarts.length > 0) lignes.push('', ...listeEcarts(ecarts))
  return lignes.join('\n')
}

export function aide(): string {
  return [
    'Commandes du temps par item :',
    "  /temps                      le temps d'aujourd'hui",
    '  /temps semaine              la semaine en cours, jour par jour',
    '  /temps mois                 le mois en cours',
    "  /temps FLO-I165             passe cette session sur l'item FLO-I165",
    '  /temps stop                 met cette session en pause',
    '  /temps confirmer            liste les silences à classer',
    '  /temps confirmer 1 travail  classe le silence 1 (numéros ou tout, puis travail ou pause)',
    '  /temps panneau              ouvre le panneau (utile dans VS Code)',
    '',
    'Réglages : cliquez sur la puce ⏱, puis sur ⚙.',
  ].join('\n')
}
