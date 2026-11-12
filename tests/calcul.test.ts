import { describe, expect, test } from 'claude-code/testing'

import {
  type Activite,
  type Evenement,
  REGLAGES_PAR_DEFAUT,
  SANS_TICKET,
  bilan,
  calculer,
  debutJour,
  detecterTicket,
  estUnTicket,
  formatDuree,
  jourSuivant,
  ligneStatut,
  lireLignes,
  lireReglages,
  motifsDuProjet,
} from '../hooks/calcul'
import { recapJour, recapSemaine } from '../hooks/texte'

const R = REGLAGES_PAR_DEFAUT
/** Une heure du 12 novembre 2026 (ou d'un autre jour de novembre), à l'heure locale. */
const h = (heure: number, minute = 0, jour = 12) => new Date(2026, 10, jour, heure, minute).getTime()
const ev = (t: number, s: string, e: Activite, k: string | null = null): Evenement => ({ t, s, e, k })
const JOUR = debutJour(h(12))

function minutesDuJour(evenements: Evenement[], maintenant: number) {
  const b = bilan(evenements, R, maintenant, JOUR, jourSuivant(JOUR))
  return { b, parTicket: Object.fromEntries((b.jours[0]?.lignes ?? []).map(l => [l.ticket, l.minutes])) }
}

describe('écart court ou long', () => {
  const evenements = [
    ev(h(9), 'A', 'message', 'FLO-I1'),
    ev(h(9, 5), 'A', 'reponse', 'FLO-I1'),
    ev(h(9, 20), 'A', 'message', 'FLO-I1'), // 15 min après : compté
    ev(h(9, 30), 'A', 'reponse', 'FLO-I1'),
    ev(h(10, 30), 'A', 'message', 'FLO-I1'), // 60 min après : à confirmer
    ev(h(10, 40), 'A', 'reponse', 'FLO-I1'),
  ]

  test("l'écart court compte, l'écart long est à confirmer", async () => {
    const { b, parTicket } = minutesDuJour(evenements, h(11, 30))
    expect(parTicket).toEqual({ 'FLO-I1': 40 })
    expect(b.ecarts).toEqual([{ ticket: 'FLO-I1', debut: h(9, 30), fin: h(10, 30), session: 'A' }])
  })

  test("un écart classé en travail compte, en pause il disparaît", async () => {
    const classe = (choix: 'travail' | 'pause'): Evenement => ({
      t: h(11), s: 'B', e: 'classement', session: 'A', debut: h(9, 30), choix,
    })
    const travail = minutesDuJour([...evenements, classe('travail')], h(11, 30))
    expect(travail.parTicket).toEqual({ 'FLO-I1': 100 })
    expect(travail.b.ecarts).toEqual([])
    const pause = minutesDuJour([...evenements, classe('pause')], h(11, 30))
    expect(pause.parTicket).toEqual({ 'FLO-I1': 40 })
    expect(pause.b.ecarts).toEqual([])
  })

  test("un écart plus long que l'écart maximum n'est pas à confirmer", async () => {
    const { b, parTicket } = minutesDuJour(
      [ev(h(8), 'A', 'reponse', 'FLO-I1'), ev(h(13), 'A', 'message', 'FLO-I1'), ev(h(13, 10), 'A', 'reponse', 'FLO-I1')],
      h(13, 10),
    )
    expect(parTicket).toEqual({ 'FLO-I1': 10 })
    expect(b.ecarts).toEqual([])
  })

  test('pendant que Claude travaille, tout compte, même au-delà du seuil', async () => {
    const { parTicket } = minutesDuJour([ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(10), 'A', 'reponse', 'FLO-I1')], h(10))
    expect(parTicket).toEqual({ 'FLO-I1': 60 })
  })

  test('un message envoyé pendant le tour ne coupe pas le travail de Claude', async () => {
    const { b, parTicket } = minutesDuJour(
      [ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(9, 40), 'A', 'message', 'FLO-I1'), ev(h(10), 'A', 'reponse', 'FLO-I1')],
      h(10),
    )
    expect(parTicket).toEqual({ 'FLO-I1': 60 })
    expect(b.ecarts).toEqual([])
  })

  test("le compteur tourne jusqu'à maintenant tant que l'écart reste court", async () => {
    const evts = [ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(9, 5), 'A', 'reponse', 'FLO-I1')]
    expect(minutesDuJour(evts, h(9, 15)).parTicket).toEqual({ 'FLO-I1': 15 })
    expect(calculer(evts, R, h(9, 15)).actives.get('A')).toBe('FLO-I1')
    expect(minutesDuJour(evts, h(9, 40)).parTicket).toEqual({ 'FLO-I1': 5 })
    expect(calculer(evts, R, h(9, 40)).actives.size).toBe(0)
  })

  test('une session ouverte sans message ne compte rien', async () => {
    const evts = [ev(h(9), 'A', 'ouverture'), ev(h(9, 10), 'A', 'fermeture')]
    expect(minutesDuJour(evts, h(9, 10)).parTicket).toEqual({})
    expect(minutesDuJour([ev(h(9), 'A', 'ouverture')], h(9, 10)).parTicket).toEqual({})
  })

  test("après un redémarrage, le tour resté ouvert n'est plus compté", async () => {
    const { b, parTicket } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 40), 'A', 'ouverture', 'FLO-I1'),
        ev(h(9, 45), 'A', 'message', 'FLO-I1'),
        ev(h(9, 50), 'A', 'reponse', 'FLO-I1'),
      ],
      h(9, 50),
    )
    expect(parTicket).toEqual({ 'FLO-I1': 5 })
    expect(b.ecarts).toEqual([{ ticket: 'FLO-I1', debut: h(9), fin: h(9, 45), session: 'A' }])
  })

  test("une session fermée sans prévenir s'arrête à son dernier signe de vie", async () => {
    const evts = [ev(h(9), 'A', 'message', 'FLO-I1')]
    const vivants = new Map([['A', h(9, 10)]])
    const b = bilan(evts, R, h(11), JOUR, jourSuivant(JOUR), vivants)
    expect(b.jours[0]?.lignes).toEqual([{ ticket: 'FLO-I1', minutes: 12, enCours: false }])
    expect(calculer(evts, R, h(9, 11), vivants).actives.get('A')).toBe('FLO-I1')
  })

  test('la pause arrête le compteur, sans écart à confirmer', async () => {
    const { b, parTicket } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 5), 'A', 'reponse', 'FLO-I1'),
        ev(h(9, 10), 'A', 'pause', 'FLO-I1'),
        ev(h(9, 50), 'A', 'message', 'FLO-I1'),
        ev(h(9, 55), 'A', 'reponse', 'FLO-I1'),
      ],
      h(9, 55),
    )
    expect(parTicket).toEqual({ 'FLO-I1': 15 })
    expect(b.ecarts).toEqual([])
  })
})

describe('sessions en parallèle', () => {
  const session = (s: string, ticket: string, debut: number) =>
    [0, 10, 20, 30, 40, 50, 60].map((m, i) =>
      ev(debut + m * 60_000, s, i % 2 === 1 || i === 6 ? 'reponse' : 'message', ticket),
    )

  test('deux sessions sur deux tickets : les deux compteurs tournent', async () => {
    const { b, parTicket } = minutesDuJour([...session('A', 'FLO-I1', h(9)), ...session('B', 'FSY-I2', h(9, 30))], h(11))
    expect(parTicket).toEqual({ 'FLO-I1': 60, 'FSY-I2': 60 })
    expect(b.jours[0]?.total).toBe(120)
    expect(b.jours[0]?.reel).toBe(90)
  })

  test('deux sessions sur le même ticket : le temps commun compte une fois', async () => {
    const { b, parTicket } = minutesDuJour([...session('A', 'FLO-I1', h(9)), ...session('B', 'FLO-I1', h(9, 30))], h(11))
    expect(parTicket).toEqual({ 'FLO-I1': 90 })
    expect(b.jours[0]?.total).toBe(90)
  })

  test("un écart déjà couvert par l'autre session du même ticket n'est pas à confirmer", async () => {
    const evts = [
      ev(h(9), 'A', 'reponse', 'FLO-I1'),
      ev(h(10), 'A', 'message', 'FLO-I1'),
      ev(h(10, 5), 'A', 'reponse', 'FLO-I1'),
      ...session('B', 'FLO-I1', h(9)),
    ]
    expect(minutesDuJour(evts, h(10, 5)).b.ecarts).toEqual([])
  })
})

describe('tickets', () => {
  test('un ticket sur deux jours : temps par jour et total', async () => {
    const evts = [
      ev(h(23, 40, 12), 'A', 'message', 'FLO-I1'),
      ev(h(0, 20, 13), 'A', 'reponse', 'FLO-I1'),
      ev(h(9, 0, 13), 'A', 'message', 'FLO-I1'),
      ev(h(9, 30, 13), 'A', 'reponse', 'FLO-I1'),
    ]
    const b = bilan(evts, R, h(10, 30, 13), JOUR, jourSuivant(jourSuivant(JOUR)))
    expect(b.jours.map(j => [j.debut, j.total])).toEqual([[JOUR, 20], [jourSuivant(JOUR), 50]])
    expect(b.lignes).toEqual([{ ticket: 'FLO-I1', minutes: 70, enCours: false }])
    expect(recapSemaine(b, [])).toContain('Total des 7 jours\n  FLO-I1   1 h 10')
  })

  test('un changement de ticket dans la session coupe le temps au bon moment', async () => {
    const { parTicket } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 10), 'A', 'reponse', 'FLO-I1'),
        ev(h(9, 15), 'A', 'message', 'FSY-I2'),
        ev(h(9, 30), 'A', 'reponse', 'FSY-I2'),
      ],
      h(9, 30),
    )
    expect(parTicket).toEqual({ 'FLO-I1': 15, 'FSY-I2': 15 })
  })

  test('un message sans ID compte pour « ticket ? »', async () => {
    expect(detecterTicket('corrige le bug du formulaire', R.motifs)).toBe(null)
    const { parTicket } = minutesDuJour([ev(h(9), 'A', 'message'), ev(h(9, 10), 'A', 'reponse')], h(9, 10))
    expect(parTicket).toEqual({ [SANS_TICKET]: 10 })
  })

  test("la détection suit l'ordre des motifs et respecte les bords de mot", async () => {
    expect(detecterTicket('voir FLO-I165.', R.motifs)).toBe('FLO-I165')
    expect(detecterTicket('FSY-I478 puis FLO-I165', R.motifs)).toBe('FLO-I165')
    expect(detecterTicket('ticket LBA-42 urgent', R.motifs)).toBe('LBA-42')
    expect(detecterTicket('FLO-I165a', R.motifs)).toBe(null)
    expect(detecterTicket('un motif cassé', ['([', 'FLO-I\\d+'])).toBe(null)
    expect(estUnTicket('FLO-I165', R.motifs)).toBe(true)
    expect(estUnTicket('semaine', R.motifs)).toBe(false)
  })

  test('les motifs du projet le plus précis passent avant les motifs généraux', async () => {
    const reglages = { ...R, projets: { 'D:/WORK/FSY': ['FSY-I\\d+'], 'D:/WORK/FSY/fsy.api': ['API-\\d+'] } }
    expect(motifsDuProjet(reglages, 'D:\\WORK\\FSY\\fsy.front\\src')).toEqual(['FSY-I\\d+'])
    expect(motifsDuProjet(reglages, 'd:/work/fsy/fsy.api')).toEqual(['API-\\d+'])
    expect(motifsDuProjet(reglages, 'D:/WORK/FSY2')).toEqual(R.motifs)
  })
})

describe('fichiers et textes', () => {
  test('les réglages manquants prennent la valeur par défaut', async () => {
    expect(lireReglages(undefined).reglages).toEqual(R)
    expect(lireReglages('{ pas du json').erreur).toBe("le fichier n'est pas du JSON valide")
    const { reglages } = lireReglages('{ "seuilPauseMinutes": 30, "motifs": "FLO" }')
    expect(reglages.seuilPauseMinutes).toBe(30)
    expect(reglages.motifs).toEqual(R.motifs)
  })

  test('une ligne de journal abîmée est ignorée', async () => {
    const texte = `${JSON.stringify(ev(h(9), 'A', 'message'))}\n{"t":12`
    expect(lireLignes(texte)).toHaveLength(1)
  })

  test('les durées et la ligne de statut', async () => {
    expect(formatDuree(45)).toBe('45 min')
    expect(formatDuree(60)).toBe('1 h 00')
    expect(formatDuree(134)).toBe('2 h 14')
    expect(ligneStatut(R.format, 'FLO-I165', 134, false)).toBe("FLO-I165 · 2 h 14 aujourd'hui")
    expect(ligneStatut(R.format, 'FLO-I165', 134, true)).toBe("FLO-I165 · 2 h 14 aujourd'hui · en pause")
  })

  test('le récapitulatif du jour', async () => {
    const evts = [ev(h(9), 'A', 'message', 'FLO-I165'), ev(h(10), 'A', 'reponse', 'FLO-I165')]
    const b = bilan(evts, R, h(11), JOUR, jourSuivant(JOUR))
    const ecart = { ticket: 'FLO-I165', debut: h(14), fin: h(14, 45), session: 'A' }
    expect(recapJour(JOUR, b, [ecart])).toBe(
      [
        'Temps du jeudi 12 novembre',
        '',
        '  FLO-I165   1 h 00',
        '  Total      1 h 00',
        '',
        'Écarts à confirmer, non comptés (7 derniers jours) :',
        '  1. jeudi 12 novembre, FLO-I165, de 14 h 00 à 14 h 45 (45 min)',
        'Pour les classer : /temps confirmer <numéros ou tout> <travail ou pause>',
        'Exemple : /temps confirmer 1 travail',
      ].join('\n'),
    )
  })
})
