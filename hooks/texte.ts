// Textes de la commande /temps, faits pour être recopiés dans Zoho Sprints.
import type { Ecart, Ligne } from '../types'
import { type Bilan, dureeEcart, formatDuree, formatHeure, formatJour } from './calcul'

const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1)

function tableau(lignes: readonly Ligne[], total: number): string[] {
  const largeur = Math.max('Total'.length, ...lignes.map(l => l.item.length))
  const ligne = (nom: string, minutes: number, suite = '') =>
    `  ${nom.padEnd(largeur)}  ${formatDuree(minutes).padStart(7)}${suite}`
  return [...lignes.map(l => ligne(l.item, l.minutes, l.enCours ? '  (en cours)' : '')), ligne('Total', total)]
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

export function recapJour(jour: number, bilan: Bilan, ecarts: readonly Ecart[]): string {
  const lignes = [`Temps du ${formatJour(jour)}`, '']
  const j = bilan.jours[0]
  if (j === undefined) {
    lignes.push("  Aucun temps compté aujourd'hui.")
  } else {
    lignes.push(...tableau(j.lignes, j.total))
    if (j.total > j.reel) {
      lignes.push('', `Temps réel : ${formatDuree(j.reel)}. Le total est plus grand, car des sessions ont tourné en parallèle.`)
    }
  }
  if (ecarts.length > 0) lignes.push('', ...listeEcarts(ecarts))
  return lignes.join('\n')
}

export function recapSemaine(bilan: Bilan, ecarts: readonly Ecart[]): string {
  if (bilan.jours.length === 0) return 'Aucun temps compté sur les 7 derniers jours.'
  const lignes = ['Temps des 7 derniers jours']
  for (const j of bilan.jours) lignes.push('', majuscule(formatJour(j.debut)), ...tableau(j.lignes, j.total))
  lignes.push('', 'Total des 7 jours', ...tableau(bilan.lignes, bilan.total))
  if (ecarts.length > 0) {
    const s = ecarts.length > 1 ? 's' : ''
    lignes.push('', `${ecarts.length} écart${s} à confirmer : tapez /temps confirmer.`)
  }
  return lignes.join('\n')
}

export function aide(fichierReglages: string): string {
  return [
    'Commandes du temps par item :',
    "  /temps                      récapitulatif d'aujourd'hui",
    '  /temps semaine              récapitulatif des 7 derniers jours',
    "  /temps FLO-I165             change l'item de cette session",
    '  /temps stop                 met le compteur de cette session en pause',
    '  /temps confirmer            liste les écarts à classer',
    "  /temps confirmer 1 travail  classe l'écart 1 (numéros ou tout, puis travail ou pause)",
    '  /temps panneau              ouvre le panneau',
    '  /temps aide                 affiche cette aide',
    '',
    `Réglages : ${fichierReglages}`,
  ].join('\n')
}
