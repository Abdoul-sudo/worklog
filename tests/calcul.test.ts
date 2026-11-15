import { describe, expect, test } from 'claude-code/testing'

import {
  type Activite,
  type Evenement,
  OPTIONS_PAR_DEFAUT,
  bornes,
  depuis,
  formatJetons,
  fusionner,
  MOTIF_ID,
  lireOptions,
  SANS_ITEM,
  bilan,
  calculer,
  debutJour,
  detecterItem,
  formatDuree,
  jourSuivant,
  libellePuce,
  lireLignes,
  nomDuGroupe,
} from '../hooks/calcul'
import { casesEntre, cellulesActivite, serie, svgActivite } from '../hooks/activite'
import { couleurs } from '../hooks/dessins'
import { choisirLangue } from '../hooks/langue'

// Ces tests lisent les textes en français ; ceux en anglais choisissent leur langue.
choisirLangue('fr')
const R = { ...OPTIONS_PAR_DEFAUT, seuilPause: 20 }
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
    expect(minutesDuJour(evts, h(9, 40)).parItem).toEqual({ 'FLO-I1': 5 })
    // « En cours » est plus strict que le temps compté : deux minutes après la réponse, l'item ne l'est plus.
    expect(calculer(evts, R, h(9, 6)).actives.get('A')).toBe('FLO-I1')
    expect(calculer(evts, R, h(9, 15)).actives.size).toBe(0)
    // Passer sur un autre item sans rien envoyer ne le met pas en cours.
    expect(calculer([...evts, ev(h(9, 6), 'A', 'item', 'FSY-I2')], R, h(9, 6, 12) + 30_000).actives.size).toBe(0)
    // Une session fermée n'est plus en cours, et son temps s'arrête.
    const fermee = [...evts, ev(h(9, 6), 'A', 'fermeture', 'FLO-I1')]
    expect(calculer(fermee, R, h(9, 6, 12) + 30_000).actives.size).toBe(0)
    expect(minutesDuJour(fermee, h(9, 15)).parItem).toEqual({ 'FLO-I1': 6 })
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
    expect(b.jours[0]?.lignes).toEqual([{ item: 'FLO-I1', minutes: 12, enCours: false, jetons: 0 }])
    expect(calculer(evts, R, h(9, 11), vivants).actives.get('A')).toBe('FLO-I1')
  })

  test('quand des sous-agents travaillent deux heures, ce temps compte, sans question', async () => {
    const { b, parItem } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 1), 'A', 'reponse', 'FLO-I1'),
        ev(h(9, 2), 'A', 'agents-debut', 'FLO-I1'),
        ev(h(11, 2), 'A', 'agents-fin', 'FLO-I1'),
        ev(h(11, 5), 'A', 'message', 'FLO-I1'),
        ev(h(11, 10), 'A', 'reponse', 'FLO-I1'),
      ],
      h(11, 10),
    )
    expect(parItem).toEqual({ 'FLO-I1': 130 })
    expect(b.ecarts).toEqual([])
  })

  test("des tokens dépensés pendant un silence (Ultracode, workflows) prouvent que Claude travaille : pas de question", async () => {
    const jet = (t: number, n: number): Evenement => ({ t, s: 'A', e: 'jetons', n, k: null, i: 1 })
    const { b, parItem } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 5), 'A', 'reponse', 'FLO-I1'),
        ...[20, 35, 50, 65, 80, 95, 110].map(m => jet(h(9) + m * 60_000, 5000)),
        ev(h(11), 'A', 'message', 'FLO-I1'),
        ev(h(11, 5), 'A', 'reponse', 'FLO-I1'),
      ],
      h(11, 5),
    )
    expect(parItem).toEqual({ 'FLO-I1': 125 })
    expect(b.ecarts).toEqual([])
  })

  test("un trou sans tokens au milieu d'un long silence reste un écart", async () => {
    const jet = (t: number): Evenement => ({ t, s: 'A', e: 'jetons', n: 100, k: null, i: 1 })
    const { b } = minutesDuJour(
      [ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(9, 5), 'A', 'reponse', 'FLO-I1'), jet(h(9, 20)), ev(h(11), 'A', 'message', 'FLO-I1')],
      h(11),
    )
    expect(b.ecarts.length).toBe(1)
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
    expect(b.parSession).toEqual(new Map([['A', new Map([['FLO-I1', 60]])], ['B', new Map([['FLO-I1', 60]])]]))
  })

  test("une session passée d'un item à l'autre : la puce ne compte que l'item affiché", async () => {
    const { b, parItem } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(10), 'A', 'reponse', 'FLO-I1'),
        ev(h(10), 'A', 'message', 'FSY-I2'),
        ev(h(10, 30), 'A', 'reponse', 'FSY-I2'),
      ],
      h(11),
    )
    expect(parItem).toEqual({ 'FLO-I1': 60, 'FSY-I2': 30 })
    expect(b.parSession.get('A')).toEqual(new Map([['FLO-I1', 60], ['FSY-I2', 30]]))
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
    expect(b.lignes).toEqual([{ item: 'FLO-I1', minutes: 70, enCours: false, jetons: 0 }])
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
    expect(detecterItem('corrige le bug du formulaire', MOTIF_ID)).toBe(null)
    const { parItem } = minutesDuJour([ev(h(9), 'A', 'message'), ev(h(9, 10), 'A', 'reponse')], h(9, 10))
    expect(parItem).toEqual({ [SANS_ITEM]: 10 })
  })

  test('la détection prend le premier ID de ticket du texte et respecte les bords de mot', async () => {
    expect(detecterItem('voir FLO-I165.', MOTIF_ID)).toBe('FLO-I165')
    expect(detecterItem('FSY-I478 puis FLO-I165', MOTIF_ID)).toBe('FSY-I478')
    expect(detecterItem('fix PROJ-142 today', MOTIF_ID)).toBe('PROJ-142')
    expect(detecterItem('see ENG-42', MOTIF_ID)).toBe('ENG-42')
    expect(detecterItem('FLO-I165a', MOTIF_ID)).toBe(null)
    expect(detecterItem('un motif cassé', '([')).toBe(null)
    expect(detecterItem('FSY-I478 puis FLO-I165', 'FLO-I\\d+|FSY-I\\d+')).toBe('FSY-I478')
  })

  test('des sigles techniques ne sont pas des tickets', async () => {
    for (const texte of ['fichier UTF-8 et norme ISO-8601', 'SHA-256, AES-256 et RSA-2048', 'GPT-4 puis GPT-5', 'RFC-7231 et CVE-2024', 'PROJ-1'])
      expect(detecterItem(texte, MOTIF_ID)).toBe(null)
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

  test("un item choisi à la main compte à partir du choix : le temps d'avant reste au nom par défaut", async () => {
    const d = (t: number, e: Activite, k: string | null): Evenement => ({ t, s: 'A', e, k, d: 'FSY' })
    const { parItem } = minutesDuJour(
      [
        d(h(9), 'message', null),
        d(h(11), 'reponse', null),
        d(h(11), 'item', 'codepath'),
        d(h(11, 1), 'item', 'FSY-I478'),
        d(h(11, 2), 'message', 'FSY-I478'),
        d(h(11, 12), 'reponse', 'FSY-I478'),
      ],
      h(11, 12),
    )
    expect(parItem).toEqual({ FSY: 120, codepath: 1, 'FSY-I478': 11 })
  })
})

describe("l'historique importé", () => {
  const imp = (t: number, s: string, e: 'message' | 'reponse', k: string | null = null): Evenement => ({ t, s, e, k, d: 'projet', i: 1 })
  const jet = (t: number, s: string, n: number, importe: boolean, k: string | null = null): Evenement =>
    importe ? { t, s, e: 'jetons', n, k, d: 'projet', i: 1 } : { t, s, e: 'jetons', n, k, d: 'FSY' }

  test("une session que le mod n'a pas suivie vient tout entière de l'historique", async () => {
    const evenements = [imp(h(9), 'A', 'message', 'FLO-I1'), imp(h(9, 20), 'A', 'reponse'), jet(h(9, 20), 'A', 500, true)]
    expect(fusionner(evenements, 0)).toEqual([...evenements, { t: h(9, 20), s: 'A', e: 'fermeture', k: null, i: 1 }])
    const { parItem } = minutesDuJour(fusionner(evenements, 0), h(10))
    expect(parItem).toEqual({ 'FLO-I1': 20 })
  })

  test("une session de l'historique n'est jamais en cours : un message resté sans réponse ne court pas jusqu'à maintenant", async () => {
    const { parItem } = minutesDuJour(fusionner([imp(h(9), 'A', 'message', 'FLO-I1'), imp(h(9, 30), 'B', 'message', 'FLO-I2'), imp(h(9, 40), 'B', 'reponse')], 0), h(18))
    expect(parItem).toEqual({ 'FLO-I2': 10 })
  })

  test("une session suivie garde son journal ; l'historique ne comble que l'avant, sous le même nom", async () => {
    const evenements = [
      imp(h(8), 'A', 'message'),
      imp(h(8, 30), 'A', 'reponse'),
      { t: h(9), s: 'A', e: 'ouverture', k: null, d: 'FSY' } as Evenement,
      imp(h(9, 5), 'A', 'message'),
      { t: h(9, 5), s: 'A', e: 'message', k: null, d: 'FSY' } as Evenement,
      { t: h(9, 20), s: 'A', e: 'reponse', k: null, d: 'FSY' } as Evenement,
    ]
    const fusion = fusionner(evenements, 0)
    expect(fusion.filter(e => 'i' in e).map(e => [e.t, 'd' in e ? e.d : null])).toEqual([[h(8), 'FSY'], [h(8, 30), 'FSY']])
    expect(minutesDuJour(fusion, h(10)).parItem).toEqual({ FSY: 45 })
  })

  test("les tokens viennent de l'historique, à l'item que la session avait à ce moment ; ceux du journal ne comptent qu'après l'import", async () => {
    const evenements = [
      { t: h(9), s: 'A', e: 'message', k: 'FSY-I1', d: 'FSY' } as Evenement,
      { t: h(9, 30), s: 'A', e: 'item', k: 'FSY-I2', d: 'FSY' } as Evenement,
      jet(h(9, 10), 'A', 100, true),
      jet(h(9, 40), 'A', 200, true),
      jet(h(9, 41), 'A', 200, false, 'FSY-I2'),
      jet(h(10, 5), 'A', 50, false, 'FSY-I2'),
    ]
    const fusion = fusionner(evenements, h(10))
    expect(fusion.filter(e => e.e === 'jetons').map(e => [e.t, e.e === 'jetons' ? e.k : null, e.e === 'jetons' ? e.n : 0])).toEqual([
      [h(9, 10), 'FSY-I1', 100],
      [h(9, 40), 'FSY-I2', 200],
      [h(10, 5), 'FSY-I2', 50],
    ])
  })
})

describe('items sans tokens', () => {
  test("sans un token sur la période, un item n'a ni ligne ni temps compté ; le temps de sa session n'en change pas", async () => {
    const evenements = [
      ev(h(9), 'A', 'message', 'FLO-I1'),
      ev(h(10), 'A', 'reponse', 'FLO-I1'),
      ev(h(9, 30), 'B', 'message', 'FSY-I2'),
      ev(h(10, 30), 'B', 'reponse', 'FSY-I2'),
      { t: h(9, 40), s: 'A', e: 'jetons', n: 700, k: 'FLO-I1' } as Evenement,
      // Une dépense notée à zéro (historique importé) n'est pas une dépense.
      { t: h(9, 50), s: 'B', e: 'jetons', n: 0, k: 'FSY-I2' } as Evenement,
    ]
    const b = bilan(evenements, R, h(11), JOUR, jourSuivant(JOUR), new Map(), undefined, true)
    expect(b.lignes.map(l => l.item)).toEqual(['FLO-I1'])
    expect([b.total, b.reel, b.jetons]).toEqual([60, 60, 700])
    expect(b.parSession.get('B')).toEqual(new Map([['FSY-I2', 60]]))
    expect(b.derniere.get('FLO-I1')).toBe(h(10))
    // En cours, un item sans token garde sa ligne.
    const enCours = bilan(evenements, R, h(10, 31), JOUR, jourSuivant(JOUR), new Map(), undefined, true)
    expect(enCours.lignes.map(l => l.item).sort()).toEqual(['FLO-I1', 'FSY-I2'])
  })
})

describe('en anglais', () => {
  test('les durées, les tokens, les jours et les titres', async () => {
    choisirLangue('en')
    try {
      expect([45, 134, 8833].map(formatDuree)).toEqual(['45 min', '2h 14', '147h 13'])
      expect([12_400, 1_200_000, 4_898_300_000].map(formatJetons)).toEqual(['12.4k', '1.2M', '4.9B'])
      expect(bornes('jour', 0, h(12)).titre).toBe('Today')
      expect(bornes('jour', -2, h(12)).titre).toBe('Tuesday, Nov 10')
      expect(bornes('semaine', -2, h(12)).titre).toBe('Week of Oct 26')
      expect(bornes('mois', -11, h(12)).titre).toBe('December 2025')
      expect(depuis(h(9, 0, 1))).toBe('Since Nov 1')
    } finally {
      choisirLangue('fr')
    }
  })
})

describe('fichiers et textes', () => {
  test('les réglages invalides prennent la valeur par défaut', async () => {
    expect(lireOptions(undefined)).toEqual(OPTIONS_PAR_DEFAUT)
    expect(OPTIONS_PAR_DEFAUT.langue).toBe('en')
    expect(lireOptions({ langue: 'fr' }).langue).toBe('fr')
    expect(lireOptions({ langue: 'de' }).langue).toBe('en')
    expect(OPTIONS_PAR_DEFAUT.seuilPause).toBe(45)
    expect([OPTIONS_PAR_DEFAUT.theme, lireOptions({ theme: 'braise' }).theme, lireOptions({ theme: 'rose' }).theme]).toEqual(['nuit', 'braise', 'nuit'])
    expect(lireOptions({ seuilPause: 30, motif: '([', jetons: false, activite: 'oui' })).toEqual({ ...OPTIONS_PAR_DEFAUT, seuilPause: 30 })
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

  test('les tokens du jour vont à leur item', async () => {
    const evts: Evenement[] = [
      ev(h(9), 'A', 'message', 'FLO-I165'),
      ev(h(10), 'A', 'reponse', 'FLO-I165'),
      { t: h(10), s: 'A', e: 'jetons', n: 245_000, k: 'FLO-I165' },
    ]
    const b = bilan(evts, R, h(11), JOUR, jourSuivant(JOUR))
    expect(b.lignes).toEqual([{ item: 'FLO-I165', minutes: 60, enCours: false, jetons: 245_000 }])
    expect(b.jetons).toBe(245_000)
  })
})

describe('corrections, tokens et périodes', () => {
  const evts: Evenement[] = [
    ev(h(9), 'A', 'message', 'FSY'),
    ev(h(9, 30), 'A', 'reponse', 'FSY'),
    { t: h(9, 30), s: 'A', e: 'jetons', n: 1_000, k: 'FSY' },
    ev(h(9), 'B', 'message', 'FLO-I1'),
    ev(h(9, 20), 'B', 'reponse', 'FLO-I1'),
    { t: h(9, 20), s: 'B', e: 'jetons', n: 500, k: 'FLO-I1' },
  ]

  test('les tokens sont comptés par item et au total', async () => {
    const b = bilan(evts, R, h(9, 30), JOUR, jourSuivant(JOUR))
    expect(b.lignes.map(l => [l.item, l.minutes, l.jetons])).toEqual([['FSY', 30, 1000], ['FLO-I1', 30, 500]])
    expect(b.jetons).toBe(1500)
  })

  test('un renommage change le nom partout, même en chaîne', async () => {
    const corrections = { renommages: { FSY: 'FSY-I9', 'FSY-I9': 'FSY-I10' }, retraits: [] }
    const b = bilan(evts, R, h(9, 30), JOUR, jourSuivant(JOUR), new Map(), corrections)
    expect(b.lignes.map(l => l.item)).toEqual(['FSY-I10', 'FLO-I1'])
  })

  test('un retrait enlève le temps et les tokens de cet item sur la période seulement', async () => {
    const corrections = { renommages: {}, retraits: [{ item: 'FSY', debut: h(9), fin: h(9, 15) }] }
    const b = bilan(evts, R, h(9, 30), JOUR, jourSuivant(JOUR), new Map(), corrections)
    expect(b.lignes.map(l => [l.item, l.minutes, l.jetons])).toEqual([['FLO-I1', 30, 500], ['FSY', 15, 1000]])
  })

  test("la série compte les jours de travail d'affilée ; un week-end sans travail ne la coupe pas", async () => {
    const jour = (j: number, minutes: number) => ({ t: new Date(2026, 10, j).getTime(), minutes })
    // Du lundi 2 au jeudi 12 novembre : travail tous les jours ouvrés sauf le mardi 3, rien le week-end.
    const liste = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(j => jour(j, j === 3 || j === 7 || j === 8 ? 0 : 60))
    expect(serie(liste)).toBe(7)
    // Aujourd'hui sans travail encore : la série d'hier tient toujours.
    expect(serie([...liste.slice(0, -1), jour(12, 0)])).toBe(6)
    expect(serie([jour(12, 0)])).toBe(0)
    // Les jours à venir de la semaine ne comptent pas : la série part d'aujourd'hui.
    expect(serie([...liste, { t: new Date(2026, 10, 13).getTime(), minutes: -2 }])).toBe(7)
  })

  test("seuls les items comptés en ce moment ont une couleur, chacune différente", async () => {
    const l = (item: string, enCours: boolean) => ({ item, enCours })
    const teintes = couleurs([l('A', false), l('B', true), l('sans nom', true), l('C', true), l('D', false)])
    expect(teintes[0]).toBe(teintes[4])
    expect(new Set([teintes[1], teintes[3], teintes[0]]).size).toBe(3)
    expect(teintes[2]).toBe(teintes[0])
  })

  test("l'année : du 1er janvier au 1er janvier suivant, titrée par son numéro", async () => {
    expect(bornes('annee', 0, h(12))).toEqual({ debut: new Date(2026, 0, 1).getTime(), fin: new Date(2027, 0, 1).getTime(), titre: '2026' })
    expect(bornes('annee', -1, h(12)).titre).toBe('2025')
  })

  test("la frise d'une année part du lundi de sa première semaine ; les jours d'avant ne sont pas dessinés", async () => {
    const debut = new Date(2026, 0, 1).getTime() // un jeudi
    const liste = casesEntre(debut, new Date(2026, 0, 11).getTime(), new Map([['2026-01-02', 30]]))
    expect(liste.length).toBe(14)
    expect(new Date(liste[0]!.t).getDay()).toBe(1)
    expect(liste.slice(0, 3).map(c => c.minutes)).toEqual([-1, -1, -1])
    expect(liste[4]!.minutes).toBe(30)
    // Les jours après aujourd'hui (une année en cours) sont à venir : -2.
    const avenir = casesEntre(debut, new Date(2026, 0, 11).getTime(), new Map(), new Date(2026, 0, 5).getTime())
    expect(avenir.slice(-6).map(c => c.minutes)).toEqual([-2, -2, -2, -2, -2, -2])
    expect(avenir[7]!.minutes).toBe(0)
  })

  test("au survol, une case donne aussi les tokens du jour ; en mode Tokens, sa couleur les suit", async () => {
    const debut = new Date(2026, 0, 5).getTime() // un lundi
    const fin = new Date(2026, 0, 6).getTime()
    const liste = casesEntre(debut, fin, new Map([['2026-01-05', 30], ['2026-01-06', 30]]), Infinity, new Map([['2026-01-05', 1_500_000], ['2026-01-06', 15_000]]))
    expect(liste.map(c => c.jetons)).toEqual([1_500_000, 15_000])
    const { source } = svgActivite(liste, null, null)
    expect(source).toContain('30 min · 1,5 M tokens')
    // L'infobulle ne donne que ce que montre le réglage « Afficher ».
    expect(svgActivite(liste, null, null, 'temps').source).toContain('<title>Lundi 5 janvier · 30 min</title>')
    expect(svgActivite(liste, null, null, 'jetons').source).toContain('<title>Lundi 5 janvier · 1,5 M tokens</title>')
    // Même temps, tokens très différents : par temps, les deux cases ont la même intensité ; par tokens, non.
    const peintures = (svg: string) => [...svg.matchAll(/ rx="[\d.]+" ([^>]*)><title>/g)].map(m => m[1])
    expect(new Set(peintures(source)).size).toBe(1)
    expect(new Set(peintures(svgActivite(liste, null, null, 'jetons').source)).size).toBe(2)
  })

  test("les jours hors de l'année restent vides ; aujourd'hui est cerclé", async () => {
    const aujourdhui = new Date(2026, 10, 15).getTime()
    const liste = casesEntre(new Date(2026, 0, 1).getTime(), new Date(2026, 11, 31).getTime(), new Map(), aujourdhui)
    const { source } = svgActivite(liste, aujourdhui, null)
    // Une case par jour de l'année, rien sous les jours d'avant le 1er janvier : pas de fond plein sous toute la frise.
    expect([...source.matchAll(/<rect /g)].length).toBe(liste.filter(c => c.minutes !== -1).length)
    expect(source).toMatch(/stroke="#[0-9A-F]{6}" stroke-opacity=".6"><title>Aujourd'hui<\/title>/)
  })

  test("dans le terminal, la frise montre toute l'année en cases, les mois au-dessus", async () => {
    const aujourdhui = new Date(2026, 10, 15).getTime() // un dimanche
    const liste = casesEntre(new Date(2026, 0, 1).getTime(), new Date(2026, 11, 31).getTime(), new Map([['2026-01-01', 90]]), aujourdhui)
    const annee = cellulesActivite(liste)
    expect([annee.colonnes, annee.lignes]).toEqual([53, 7])
    // Une lettre par mois en français : un mois ne fait que quatre ou cinq colonnes.
    expect(annee.mois.trim().split(/\s+/)).toEqual(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'])
    const mots = new Uint32Array(Uint8Array.from(atob(annee.cellules), c => c.charCodeAt(0)).buffer)
    const cellule = (ligne: number, semaine: number) => [...mots.slice((ligne * 53 + semaine) * 3, (ligne * 53 + semaine) * 3 + 2)]
    // Le lundi 29 décembre 2025, avant l'année : vide. Le jeudi 1er janvier, 1 h 30 : une case du deuxième niveau. Le
    // lundi 16 novembre, à venir : vide.
    expect(cellule(0, 0)[0]).toBe(0x20)
    expect(cellule(3, 0)).toEqual([0x25a0, 0xa85a42])
    expect(cellule(0, 46)[0]).toBe(0x20)
    // Serrée pour une bande basse : quatre lignes. Étroite : les semaines jusqu'à celle d'aujourd'hui.
    expect(cellulesActivite(liste, 'tout', 'serre').lignes).toBe(4)
    const etroite = cellulesActivite(liste, 'tout', 'cases', 20)
    expect(etroite.colonnes).toBe(20)
    expect(etroite.mois.length).toBeLessThanOrEqual(20)
  })

  test("le titre de l'onglet Tout part du premier jour du journal", async () => {
    expect(depuis(h(9, 0, 12))).toBe('Depuis le 12 novembre')
    expect(depuis(new Date(2026, 11, 1).getTime())).toBe('Depuis le 1er décembre')
  })

  test('les bornes et les titres des périodes', async () => {
    expect(bornes('jour', 0, h(15))).toEqual({ debut: JOUR, fin: jourSuivant(JOUR), titre: "Aujourd'hui" })
    expect(bornes('jour', -1, h(15)).titre).toBe('Hier')
    expect(bornes('jour', -2, h(15)).titre).toBe('Mardi 10 novembre')
    const semaine = bornes('semaine', 0, h(15))
    expect([new Date(semaine.debut).getDate(), new Date(semaine.fin).getDate(), semaine.titre]).toEqual([9, 16, 'Cette semaine'])
    expect(bornes('semaine', -2, h(15)).titre).toBe('Semaine du 26 octobre')
    expect(bornes('mois', 0, h(15)).titre).toBe('Novembre')
    expect(bornes('mois', -11, h(15)).titre).toBe('Décembre 2025')
  })

  test('le format des tokens', async () => {
    expect([850, 12_400, 245_000, 1_200_000, 3_000_000, 245_000_000, 4_898_300_000].map(formatJetons)).toEqual(['850', '12,4 k', '245 k', '1,2 M', '3 M', '245 M', '4,9 Md'])
  })
})
