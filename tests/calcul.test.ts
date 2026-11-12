import { describe, expect, test } from 'claude-code/testing'

import {
  type Activite,
  type Evenement,
  REGLAGES_PAR_DEFAUT,
  SANS_ITEM,
  bilan,
  calculer,
  debutJour,
  detecterItem,
  estUnItem,
  formatDuree,
  jourSuivant,
  libellePuce,
  lireLignes,
  lireReglages,
  motifsDuProjet,
  nomDuGroupe,
} from '../hooks/calcul'
import { recapJour, recapSemaine } from '../hooks/texte'

const R = REGLAGES_PAR_DEFAUT
/** Une heure du 12 novembre 2026 (ou d'un autre jour de novembre), à l'heure locale. */
const h = (heure: number, minute = 0, jour = 12) => new Date(2026, 10, jour, heure, minute).getTime()
const ev = (t: number, s: string, e: Activite, k: string | null = null): Evenement => ({ t, s, e, k })
const JOUR = debutJour(h(12))

function minutesDuJour(evenements: Evenement[], maintenant: number) {
  const b = bilan(evenements, R, maintenant, JOUR, jourSuivant(JOUR))
  return { b, parItem: Object.fromEntries((b.jours[0]?.lignes ?? []).map(l => [l.item, l.minutes])) }
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
    const { b, parItem } = minutesDuJour(evenements, h(11, 30))
    expect(parItem).toEqual({ 'FLO-I1': 40 })
    expect(b.ecarts).toEqual([{ item: 'FLO-I1', debut: h(9, 30), fin: h(10, 30), session: 'A' }])
  })

  test("un écart classé en travail compte, en pause il disparaît", async () => {
    const classe = (choix: 'travail' | 'pause'): Evenement => ({
      t: h(11), s: 'B', e: 'classement', session: 'A', debut: h(9, 30), choix,
    })
    const travail = minutesDuJour([...evenements, classe('travail')], h(11, 30))
    expect(travail.parItem).toEqual({ 'FLO-I1': 100 })
    expect(travail.b.ecarts).toEqual([])
    const pause = minutesDuJour([...evenements, classe('pause')], h(11, 30))
    expect(pause.parItem).toEqual({ 'FLO-I1': 40 })
    expect(pause.b.ecarts).toEqual([])
  })

  test("un écart plus long que l'écart maximum n'est pas à confirmer", async () => {
    const { b, parItem } = minutesDuJour(
      [ev(h(8), 'A', 'reponse', 'FLO-I1'), ev(h(13), 'A', 'message', 'FLO-I1'), ev(h(13, 10), 'A', 'reponse', 'FLO-I1')],
      h(13, 10),
    )
    expect(parItem).toEqual({ 'FLO-I1': 10 })
    expect(b.ecarts).toEqual([])
  })

  test('pendant que Claude travaille, tout compte, même au-delà du seuil', async () => {
    const { parItem } = minutesDuJour([ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(10), 'A', 'reponse', 'FLO-I1')], h(10))
    expect(parItem).toEqual({ 'FLO-I1': 60 })
  })

  test('un message envoyé pendant le tour ne coupe pas le travail de Claude', async () => {
    const { b, parItem } = minutesDuJour(
      [ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(9, 40), 'A', 'message', 'FLO-I1'), ev(h(10), 'A', 'reponse', 'FLO-I1')],
      h(10),
    )
    expect(parItem).toEqual({ 'FLO-I1': 60 })
    expect(b.ecarts).toEqual([])
  })

  test("le compteur tourne jusqu'à maintenant tant que l'écart reste court", async () => {
    const evts = [ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(9, 5), 'A', 'reponse', 'FLO-I1')]
    expect(minutesDuJour(evts, h(9, 15)).parItem).toEqual({ 'FLO-I1': 15 })
    expect(calculer(evts, R, h(9, 15)).actives.get('A')).toBe('FLO-I1')
    expect(minutesDuJour(evts, h(9, 40)).parItem).toEqual({ 'FLO-I1': 5 })
    expect(calculer(evts, R, h(9, 40)).actives.size).toBe(0)
  })

  test('une session ouverte sans message ne compte rien', async () => {
    const evts = [ev(h(9), 'A', 'ouverture'), ev(h(9, 10), 'A', 'fermeture')]
    expect(minutesDuJour(evts, h(9, 10)).parItem).toEqual({})
    expect(minutesDuJour([ev(h(9), 'A', 'ouverture')], h(9, 10)).parItem).toEqual({})
  })

  test("après un redémarrage, le tour resté ouvert n'est plus compté", async () => {
    const { b, parItem } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 40), 'A', 'ouverture', 'FLO-I1'),
        ev(h(9, 45), 'A', 'message', 'FLO-I1'),
        ev(h(9, 50), 'A', 'reponse', 'FLO-I1'),
      ],
      h(9, 50),
    )
    expect(parItem).toEqual({ 'FLO-I1': 5 })
    expect(b.ecarts).toEqual([{ item: 'FLO-I1', debut: h(9), fin: h(9, 45), session: 'A' }])
  })

  test("une session fermée sans prévenir s'arrête à son dernier signe de vie", async () => {
    const evts = [ev(h(9), 'A', 'message', 'FLO-I1')]
    const vivants = new Map([['A', h(9, 10)]])
    const b = bilan(evts, R, h(11), JOUR, jourSuivant(JOUR), vivants)
    expect(b.jours[0]?.lignes).toEqual([{ item: 'FLO-I1', minutes: 12, enCours: false }])
    expect(calculer(evts, R, h(9, 11), vivants).actives.get('A')).toBe('FLO-I1')
  })

  test('la pause arrête le compteur, sans écart à confirmer', async () => {
    const { b, parItem } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 5), 'A', 'reponse', 'FLO-I1'),
        ev(h(9, 10), 'A', 'pause', 'FLO-I1'),
        ev(h(9, 50), 'A', 'message', 'FLO-I1'),
        ev(h(9, 55), 'A', 'reponse', 'FLO-I1'),
      ],
      h(9, 55),
    )
    expect(parItem).toEqual({ 'FLO-I1': 15 })
    expect(b.ecarts).toEqual([])
  })
})

describe('sessions en parallèle', () => {
  const session = (s: string, item: string, debut: number) =>
    [0, 10, 20, 30, 40, 50, 60].map((m, i) =>
      ev(debut + m * 60_000, s, i % 2 === 1 || i === 6 ? 'reponse' : 'message', item),
    )

  test('deux sessions sur deux items : les deux compteurs tournent', async () => {
    const { b, parItem } = minutesDuJour([...session('A', 'FLO-I1', h(9)), ...session('B', 'FSY-I2', h(9, 30))], h(11))
    expect(parItem).toEqual({ 'FLO-I1': 60, 'FSY-I2': 60 })
    expect(b.jours[0]?.total).toBe(120)
    expect(b.jours[0]?.reel).toBe(90)
  })

  test('deux sessions sur le même item : le temps commun compte une fois', async () => {
    const { b, parItem } = minutesDuJour([...session('A', 'FLO-I1', h(9)), ...session('B', 'FLO-I1', h(9, 30))], h(11))
    expect(parItem).toEqual({ 'FLO-I1': 90 })
    expect(b.jours[0]?.total).toBe(90)
    expect(b.parSession).toEqual(new Map([['A', 60], ['B', 60]]))
  })

  test("un écart déjà couvert par l'autre session du même item n'est pas à confirmer", async () => {
    const evts = [
      ev(h(9), 'A', 'reponse', 'FLO-I1'),
      ev(h(10), 'A', 'message', 'FLO-I1'),
      ev(h(10, 5), 'A', 'reponse', 'FLO-I1'),
      ...session('B', 'FLO-I1', h(9)),
    ]
    expect(minutesDuJour(evts, h(10, 5)).b.ecarts).toEqual([])
  })
})

describe('items', () => {
  test('un item sur deux jours : temps par jour et total', async () => {
    const evts = [
      ev(h(23, 40, 12), 'A', 'message', 'FLO-I1'),
      ev(h(0, 20, 13), 'A', 'reponse', 'FLO-I1'),
      ev(h(9, 0, 13), 'A', 'message', 'FLO-I1'),
      ev(h(9, 30, 13), 'A', 'reponse', 'FLO-I1'),
    ]
    const b = bilan(evts, R, h(10, 30, 13), JOUR, jourSuivant(jourSuivant(JOUR)))
    expect(b.jours.map(j => [j.debut, j.total])).toEqual([[JOUR, 20], [jourSuivant(JOUR), 50]])
    expect(b.lignes).toEqual([{ item: 'FLO-I1', minutes: 70, enCours: false }])
    expect(recapSemaine(b, [])).toContain('Total des 7 jours\n  FLO-I1   1 h 10')
  })

  test('un changement de item dans la session coupe le temps au bon moment', async () => {
    const { parItem } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 10), 'A', 'reponse', 'FLO-I1'),
        ev(h(9, 15), 'A', 'message', 'FSY-I2'),
        ev(h(9, 30), 'A', 'reponse', 'FSY-I2'),
      ],
      h(9, 30),
    )
    expect(parItem).toEqual({ 'FLO-I1': 15, 'FSY-I2': 15 })
  })

  test('un message sans ID compte pour « item ? »', async () => {
    expect(detecterItem('corrige le bug du formulaire', R.motifs)).toBe(null)
    const { parItem } = minutesDuJour([ev(h(9), 'A', 'message'), ev(h(9, 10), 'A', 'reponse')], h(9, 10))
    expect(parItem).toEqual({ [SANS_ITEM]: 10 })
  })

  test('la détection prend le premier ID Zoho du texte et respecte les bords de mot', async () => {
    expect(detecterItem('voir FLO-I165.', R.motifs)).toBe('FLO-I165')
    expect(detecterItem('FSY-I478 puis FLO-I165', R.motifs)).toBe('FSY-I478')
    expect(detecterItem('fichier UTF-8 et norme ISO-8601', R.motifs)).toBe(null)
    expect(detecterItem('FLO-I165a', R.motifs)).toBe(null)
    expect(detecterItem('un motif cassé', ['([', 'XYZ-I\\d+'])).toBe(null)
    expect(detecterItem('FSY-I478 puis FLO-I165', ['FLO-I\\d+', 'FSY-I\\d+'])).toBe('FLO-I165')
    expect(estUnItem('FLO-I165', R.motifs)).toBe(true)
    expect(estUnItem('semaine', R.motifs)).toBe(false)
  })

  test("sans item, le temps va au nom par défaut de la session, puis au premier item trouvé", async () => {
    const d = (t: number, s: string, e: Activite, k: string | null, nom: string): Evenement => ({ t, s, e, k, d: nom })
    const { parItem } = minutesDuJour(
      [
        d(h(9), 'A', 'message', null, 'Codepath'),
        d(h(9, 10), 'A', 'reponse', null, 'Codepath'),
        d(h(9), 'B', 'message', null, 'FSY'),
        d(h(9, 10), 'B', 'reponse', null, 'FSY'),
        d(h(9, 12), 'B', 'message', 'FSY-I478', 'FSY'),
        d(h(9, 20), 'B', 'reponse', 'FSY-I478', 'FSY'),
      ],
      h(9, 20),
    )
    expect(parItem).toEqual({ Codepath: 20, 'FSY-I478': 20 })
  })

  test("le premier item trouvé reçoit aussi le temps d'avant, pas les suivants", async () => {
    const { parItem } = minutesDuJour(
      [
        ev(h(9), 'A', 'message'),
        ev(h(9, 20), 'A', 'reponse'),
        ev(h(9, 28), 'A', 'message', 'FSY-I478'),
        ev(h(9, 40), 'A', 'reponse', 'FSY-I478'),
        ev(h(9, 45), 'A', 'message', 'FLO-I165'),
        ev(h(9, 50), 'A', 'reponse', 'FLO-I165'),
      ],
      h(9, 50),
    )
    expect(parItem).toEqual({ 'FSY-I478': 45, 'FLO-I165': 5 })
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

  test('les durées et le texte de la puce', async () => {
    expect(formatDuree(45)).toBe('45 min')
    expect(formatDuree(60)).toBe('1 h 00')
    expect(formatDuree(134)).toBe('2 h 14')
    expect(libellePuce('FLO-I165', 134, false)).toBe('⏱ FLO-I165 · 2 h 14')
    expect(libellePuce(null, 20, false)).toBe('⏱ 20 min')
    expect(libellePuce('FLO-I165', 134, true)).toBe('⏸ FLO-I165 · 2 h 14')
  })

  test("le nom du groupe de l'app desktop", async () => {
    const config = JSON.stringify({
      preferences: { epitaxyPrefs: { 'dframe-group-scopes': { 'u/o': {
        groups: [{ id: 'cg-1', name: 'FSY' }, { id: 'cg-2', name: 'Codepath' }],
        assignments: { 'code:local_a': 'cg-2' },
      } } } },
    })
    expect(nomDuGroupe(config, 'local_a')).toBe('Codepath')
    expect(nomDuGroupe(config, 'local_b')).toBe(null)
    expect(nomDuGroupe('pas du json', 'local_a')).toBe(null)
  })

  test('le récapitulatif du jour', async () => {
    const evts = [ev(h(9), 'A', 'message', 'FLO-I165'), ev(h(10), 'A', 'reponse', 'FLO-I165')]
    const b = bilan(evts, R, h(11), JOUR, jourSuivant(JOUR))
    const ecart = { item: 'FLO-I165', debut: h(14), fin: h(14, 45), session: 'A' }
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
