import { describe, expect, test } from 'claude-code/testing'

import {
  type Activite,
  type Evenement,
  type Prix,
  OPTIONS_PAR_DEFAUT,
  bornes,
  depuis,
  formatCout,
  formatJetons,
  fusionner,
  MINUTE,
  MOTIF_ID,
  lireOptions,
  SANS_ITEM,
  avecCouts,
  bilan,
  calculer,
  coutReponse,
  choixDemande,
  debutJour,
  demandeEffective,
  detecterItem,
  formatDuree,
  jourSuivant,
  libellePuce,
  lireLignes,
  nomSaisi,
  nommer,
} from '../hooks/calcul'
import { casesEntre, cellulesActivite, compterSerie, serie, svgActivite } from '../hooks/activite'
import { choisirTheme, couleurs, svgCiel } from '../hooks/dessins'
import { choisirLangue, t } from '../hooks/langue'

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

  test("« Puis demander : jamais » : une pause plus longue que « Rester actif pendant » ne compte pas, sans question", async () => {
    const evts = [ev(h(9), 'A', 'message', 'X'), ev(h(9, 5), 'A', 'reponse', 'X'), ev(h(11, 5), 'A', 'message', 'X')]
    expect(calculer(evts, { ...R, pauseMax: 0 }, h(11, 6)).ecarts).toEqual([])
    expect(calculer(evts, R, h(11, 6)).ecarts).toHaveLength(1)
  })

  test("des tokens espacés ne font pas compter une longue pause ; des tokens serrés, si", async () => {
    const options = { ...OPTIONS_PAR_DEFAUT }
    const base = [ev(h(9), 'A', 'message', 'X'), ev(h(9, 10), 'A', 'reponse', 'X'), ev(h(14), 'A', 'message', 'X')]
    const jetons = (pas: number) =>
      Array.from({ length: Math.floor((h(14) - h(9, 10)) / (pas * MINUTE)) }, (_, i) => ({ t: h(9, 10) + (i + 1) * pas * MINUTE - 1, s: 'A', e: 'jetons', n: 100, k: 'X' }) as Evenement)
    // Une boucle qui tourne toutes les 30 min : entre deux tours, Claude ne fait rien. La pause de 4 h 50 ne compte pas.
    const espaces = bilan([...base, ...jetons(30)], options, h(14, 1), JOUR, jourSuivant(JOUR))
    expect(espaces.jours[0]?.lignes.map(l => l.minutes)).toEqual([11])
    // Des agents qui dépensent des tokens toutes les 10 min travaillent : le temps compte.
    const serres = bilan([...base, ...jetons(10)], options, h(14, 1), JOUR, jourSuivant(JOUR))
    expect(serres.jours[0]?.lignes.map(l => l.minutes)).toEqual([301])
  })

  test("une pause encore ouverte ne compte pas : elle compte au retour, ou à la fermeture, si elle reste courte", async () => {
    const evts = [ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(9, 5), 'A', 'reponse', 'FLO-I1')]
    // Claude a fini à 9 h 05 : le compteur attend, la pause ne compte pas encore.
    expect(minutesDuJour(evts, h(9, 15)).parItem).toEqual({ 'FLO-I1': 5 })
    expect(minutesDuJour(evts, h(9, 40)).parItem).toEqual({ 'FLO-I1': 5 })
    // Le retour à 9 h 15 : les 10 minutes de pause s'ajoutent, et le nouveau tour compte.
    expect(minutesDuJour([...evts, ev(h(9, 15), 'A', 'message', 'FLO-I1')], h(9, 16)).parItem).toEqual({ 'FLO-I1': 16 })
    // La fenêtre fermée à 9 h 10 (dernier signe de vie à 9 h 08) : la pause jusque-là compte.
    const fenetreFermee = bilan(evts, R, h(9, 30), JOUR, jourSuivant(JOUR), new Map([['A', h(9, 8)]]))
    expect(fenetreFermee.jours[0]?.lignes.map(l => l.minutes)).toEqual([10])
    // « En cours » : seulement pendant que Claude travaille.
    expect(calculer(evts.slice(0, 1), R, h(9, 3)).actives.get('A')).toBe('FLO-I1')
    expect(calculer(evts, R, h(9, 6)).actives.size).toBe(0)
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
    expect(b.jours[0]?.lignes).toEqual([{ item: 'FLO-I1', minutes: 12, enCours: false, jetons: 0, cout: 0 }])
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

  test("un travail d'agents de 24 h (Ultracode) compte en entier tant que leur début revient chaque heure, et reste en cours", async () => {
    const jet = (t: number): Evenement => ({ t, s: 'A', e: 'jetons', n: 100, k: null, i: 1 })
    // Les agents travaillent d'hier 20 h à aujourd'hui 20 h ; leur début est noté de nouveau chaque heure, et leurs tokens
    // partent toutes les deux heures seulement.
    const debut = h(20, 0, 11)
    const evts = [
      ev(h(19, 58, 11), 'A', 'message', 'FLO-I1'),
      ev(debut, 'A', 'reponse', 'FLO-I1'),
      ...Array.from({ length: 24 }, (_, i) => ev(debut + i * 60 * MINUTE, 'A', 'agents-debut', 'FLO-I1')),
      ...Array.from({ length: 12 }, (_, i) => jet(debut + (i + 1) * 120 * MINUTE - MINUTE)),
    ]
    // Fini à 20 h : toute la journée jusque-là compte, sans question.
    const { b, parItem } = minutesDuJour([...evts, ev(h(20), 'A', 'agents-fin', 'FLO-I1')], h(21))
    expect(parItem).toEqual({ 'FLO-I1': 20 * 60 })
    expect(b.ecarts).toEqual([])
    // Encore au travail à 14 h : le compteur suit, et la session est en cours.
    const avant = evts.filter(e => e.t <= h(14))
    const vivants = new Map([['A', h(14)]])
    expect(bilan(avant, R, h(14), JOUR, jourSuivant(JOUR), vivants).jours[0]?.lignes.map(l => l.minutes)).toEqual([14 * 60])
    expect(calculer(avant, R, h(14), vivants).actives.get('A')).toBe('FLO-I1')
  })

  test("des agents sans nouveau signe depuis plus de 12 h ne comptent plus : leur fin n'a pas été vue", async () => {
    const evts = [ev(h(19, 58, 11), 'A', 'message', 'FLO-I1'), ev(h(20, 0, 11), 'A', 'reponse', 'FLO-I1'), ev(h(20, 0, 11), 'A', 'agents-debut', 'FLO-I1')]
    // La session vit encore à 9 h, mais leur début n'est plus revenu depuis 13 h.
    const c = calculer(evts, R, h(9), new Map([['A', h(9)]]))
    expect(c.plages.filter(p => p.fin > JOUR)).toEqual([])
    expect(c.actives.size).toBe(0)
  })

  test("une attente de travail de fond compte quand elle finit avec ce travail ; revenu avant, c'est une pause", async () => {
    const jet = (t: number, s: string): Evenement => ({ t, s, e: 'jetons', n: 100, k: null })
    // A : Claude lance une commande en fond et l'attend 1 h 30 ; la commande finit et le réveille.
    const attendue = [
      ev(h(9), 'A', 'message', 'FLO-I1'),
      jet(h(9, 1), 'A'),
      ev(h(9, 1), 'A', 'reponse', 'FLO-I1'),
      ev(h(9, 1), 'A', 'fond-debut', 'FLO-I1'),
    ]
    // Pendant l'attente, la session est en cours et le temps court.
    const vivants = new Map([['A', h(10)]])
    expect(bilan(attendue, R, h(10), JOUR, jourSuivant(JOUR), vivants).jours[0]?.lignes.map(l => l.minutes)).toEqual([60])
    expect(calculer(attendue, R, h(10), vivants).actives.get('A')).toBe('FLO-I1')
    // La commande a fini : toute l'attente compte, sans question.
    const finie = minutesDuJour([...attendue, ev(h(10, 31), 'A', 'fond-fin', 'FLO-I1')], h(11))
    expect(finie.parItem).toEqual({ 'FLO-I1': 91 })
    expect(finie.b.ecarts).toEqual([])
    // B : un serveur lancé en fond ne finit jamais ; la personne revient 2 h plus tard : c'est une pause, avec sa question.
    const serveur = minutesDuJour(
      [
        ev(h(9), 'B', 'message', 'FSY-I2'),
        jet(h(9, 1), 'B'),
        ev(h(9, 1), 'B', 'reponse', 'FSY-I2'),
        ev(h(9, 1), 'B', 'fond-debut', 'FSY-I2'),
        ev(h(11, 1), 'B', 'message', 'FSY-I2'),
        ev(h(11, 2), 'B', 'reponse', 'FSY-I2'),
      ],
      h(11, 2),
    )
    expect(serveur.parItem).toEqual({ 'FSY-I2': 2 })
    expect(serveur.b.ecarts).toEqual([{ item: 'FSY-I2', debut: h(9, 1), fin: h(11, 1), session: 'B' }])
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

  test("dans une longue pause, les moments où les tokens partent encore comptent : un Ultracode lancé avant de partir", async () => {
    const jet = (t: number, s: string): Evenement => ({ t, s, e: 'jetons', n: 100, k: null, i: 1 })
    const toutesLes10Min = (s: string, debut: number, fin: number) =>
      Array.from({ length: (fin - debut) / (10 * MINUTE) + 1 }, (_, i) => jet(debut + i * 10 * MINUTE, s))
    // A : un Ultracode tourne de 9 h 05 à 13 h 05, puis plus rien jusqu'au retour à 20 h (pause de 15 h, trop longue
    // pour une question) : ses 4 h comptent quand même.
    // B : un travail de 9 h 05 à 10 h 05, puis le retour à 12 h : la pause pose sa question, et l'heure de travail compte
    // déjà.
    const { b, parItem } = minutesDuJour(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        ev(h(9, 5), 'A', 'reponse', 'FLO-I1'),
        ...toutesLes10Min('A', h(9, 15), h(13, 5)),
        ev(h(20), 'A', 'message', 'FLO-I1'),
        ev(h(20, 5), 'A', 'reponse', 'FLO-I1'),
        ev(h(9), 'B', 'message', 'FSY-I2'),
        ev(h(9, 5), 'B', 'reponse', 'FSY-I2'),
        ...toutesLes10Min('B', h(9, 15), h(10, 5)),
        ev(h(12), 'B', 'message', 'FSY-I2'),
        ev(h(12, 5), 'B', 'reponse', 'FSY-I2'),
      ],
      h(20, 5),
    )
    expect(parItem).toEqual({ 'FLO-I1': 5 + 240 + 5, 'FSY-I2': 5 + 60 + 5 })
    expect(b.ecarts).toEqual([{ item: 'FSY-I2', debut: h(9, 5), fin: h(12), session: 'B' }])
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

  test("après la pause, le travail de Claude compte encore jusqu'à sa fin, puis plus rien jusqu'au message suivant", async () => {
    // La pause tombe pendant la réponse de Claude : la réponse compte jusqu'à 9 h 20, puis le compteur s'arrête.
    const tour = [ev(h(9), 'A', 'message', 'FLO-I1'), ev(h(9, 10), 'A', 'pause', 'FLO-I1'), ev(h(9, 20), 'A', 'reponse', 'FLO-I1')]
    const pendant = calculer(tour.slice(0, 2), R, h(9, 15))
    expect(pendant.actives.get('A')).toBe('FLO-I1')
    expect(pendant.enPause.has('A')).toBe(false)
    const apres = minutesDuJour(tour, h(10, 30))
    expect(apres.parItem).toEqual({ 'FLO-I1': 20 })
    expect(apres.b.ecarts).toEqual([])
    expect(apres.b.enPause.has('A')).toBe(true)

    // La pause tombe pendant le travail des sous-agents (Ultracode) : leur temps compte jusqu'à leur fin.
    const agents = [
      ev(h(9), 'A', 'message', 'FLO-I1'),
      ev(h(9, 1), 'A', 'reponse', 'FLO-I1'),
      ev(h(9, 2), 'A', 'agents-debut', 'FLO-I1'),
      ev(h(9, 30), 'A', 'pause', 'FLO-I1'),
      ev(h(10, 30), 'A', 'agents-fin', 'FLO-I1'),
    ]
    const { b, parItem } = minutesDuJour(agents, h(11, 30))
    expect(parItem).toEqual({ 'FLO-I1': 90 })
    expect(b.ecarts).toEqual([])
    expect(b.enPause.has('A')).toBe(true)

    // Le message suivant relance le compteur.
    expect(minutesDuJour([...agents, ev(h(11, 30), 'A', 'message', 'FLO-I1')], h(11, 40)).b.enPause.has('A')).toBe(false)
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
    expect(b.lignes).toEqual([{ item: 'FLO-I1', minutes: 70, enCours: false, jetons: 0, cout: 0 }])
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
    expect(parItem).toEqual({ Codepath: 10, 'FSY-I478': 20 })
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

  test("un repère (ID d'un message recopié dans une conversation reprise) nomme la session, sans compter de temps", async () => {
    // La reprise B : le repère FLO-I168 à l'heure du message d'origine, puis son propre travail, sans ID.
    const evenements = [
      { t: h(9, 50), s: 'B', e: 'repere', k: 'FLO-I168', d: 'projet', i: 1 } as Evenement,
      imp(h(10), 'B', 'message'),
      imp(h(10, 30), 'B', 'reponse'),
      jet(h(10, 30), 'B', 500, true),
    ]
    const { parItem } = minutesDuJour(fusionner(evenements, 0), h(12))
    expect(parItem).toEqual({ 'FLO-I168': 30 })
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

  test("les tokens importés prennent le nom par défaut que la session avait à ce moment, pas son premier", async () => {
    // L'app desktop lance la session dans un dossier d'attente, puis lui donne le sien.
    const evenements = [
      { t: h(9), s: 'A', e: 'ouverture', k: null, d: 'spare-x' } as Evenement,
      { t: h(9, 1), s: 'A', e: 'message', k: null, d: 'spare-x' } as Evenement,
      { t: h(9, 5), s: 'A', e: 'reponse', k: null, d: '.claude' } as Evenement,
      { t: h(9, 6), s: 'A', e: 'message', k: null, d: '.claude' } as Evenement,
      jet(h(9, 10), 'A', 300, true),
    ]
    const fusion = fusionner(evenements, h(10))
    expect(fusion.filter(e => e.e === 'jetons').map(e => ('d' in e ? e.d : null))).toEqual(['.claude'])
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
    // En cours (Claude y travaille), un item sans token garde sa ligne.
    const enCours = bilan(evenements.filter(e => e.t <= h(10, 20)), R, h(10, 20), JOUR, jourSuivant(JOUR), new Map(), undefined, true)
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
    expect(OPTIONS_PAR_DEFAUT.seuilPause).toBe(60)
    expect([OPTIONS_PAR_DEFAUT.pauseMax, lireOptions({ pauseMax: 480 }).pauseMax, lireOptions({ pauseMax: 300 }).pauseMax]).toEqual([240, 480, 240])
    expect(lireOptions({ pauseMax: 0 }).pauseMax).toBe(0)
    // « Puis demander » : jamais, ou plus long que « Rester actif pendant ». Plus court ou égal, il ne demande jamais.
    expect(choixDemande(OPTIONS_PAR_DEFAUT)).toEqual([0, 120, 240, 480])
    expect([demandeEffective(OPTIONS_PAR_DEFAUT), demandeEffective({ ...OPTIONS_PAR_DEFAUT, pauseMax: 60 }), demandeEffective({ ...OPTIONS_PAR_DEFAUT, seuilPause: 120, pauseMax: 60 })]).toEqual([240, 0, 0])
    // Une durée qui n'est plus un choix du réglage reprend la valeur par défaut.
    expect(lireOptions({ seuilPause: 45 }).seuilPause).toBe(60)
    expect([OPTIONS_PAR_DEFAUT.theme, lireOptions({ theme: 'sakura' }).theme, lireOptions({ theme: 'rose' }).theme]).toEqual(['nuit', 'sakura', 'nuit'])
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

  test('les tokens du jour vont à leur item', async () => {
    const evts: Evenement[] = [
      ev(h(9), 'A', 'message', 'FLO-I165'),
      ev(h(10), 'A', 'reponse', 'FLO-I165'),
      { t: h(10), s: 'A', e: 'jetons', n: 245_000, k: 'FLO-I165' },
    ]
    const b = bilan(evts, R, h(11), JOUR, jourSuivant(JOUR))
    expect(b.lignes).toEqual([{ item: 'FLO-I165', minutes: 60, enCours: false, jetons: 245_000, cout: 0 }])
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
    expect(b.lignes.map(l => [l.item, l.minutes, l.jetons])).toEqual([['FSY', 30, 1000], ['FLO-I1', 20, 500]])
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
    expect(b.lignes.map(l => [l.item, l.minutes, l.jetons])).toEqual([['FLO-I1', 20, 500], ['FSY', 15, 1000]])
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

  test("au survol, une case donne aussi les tokens du jour ; en mode Tokens et prix, sa couleur les suit et son infobulle a le prix", async () => {
    const debut = new Date(2026, 0, 5).getTime() // un lundi
    const fin = new Date(2026, 0, 6).getTime()
    const liste = casesEntre(
      debut,
      fin,
      new Map([['2026-01-05', 30], ['2026-01-06', 30]]),
      Infinity,
      new Map([['2026-01-05', 1_500_000], ['2026-01-06', 15_000]]),
      new Map([['2026-01-05', 3.4]]),
    )
    expect(liste.map(c => c.jetons)).toEqual([1_500_000, 15_000])
    const { source } = svgActivite(liste, null, null)
    expect(source).toContain('30 min · 1,5 M tokens')
    // L'infobulle ne donne que ce que montre le réglage « Afficher ».
    expect(svgActivite(liste, null, null, 'jetons').source).toContain('<title>Lundi 5 janvier · 1,5 M tokens · 3,40 $</title>')
    expect(svgActivite(liste, null, null, 'jetons').source).toContain('<title>Mardi 6 janvier · 15 k tokens</title>')
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

  test("le fond animé est calé sur l'heure : relancé, il reprend là où il en était", async () => {
    choisirTheme('ocean')
    try {
      const retards = (t: number) => [...svgCiel(t)!.matchAll(/animation:(\w+) ([\d.]+)s [\w-]+ (-?[\d.]+)s infinite( alternate)?/g)].map(m => [m[1], Number(m[3]) + 0])
      // La première vague fait le tour en 34 s ; sa houle va et vient en 7 s (une période de 14 s).
      expect(retards(0).slice(0, 2)).toEqual([['d', 0], ['s', 0]])
      expect(retards(10_000).slice(0, 2)).toEqual([['d', -10], ['s', -10]])
      expect(retards(40_000).slice(0, 2)).toEqual([['d', -6], ['s', -12]])
    } finally {
      choisirTheme('nuit')
    }
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
    // Large : deux colonnes par semaine, une case puis un blanc ; les noms courts des mois.
    const large = cellulesActivite(liste, 'tout', 'cases', Infinity, 2)
    expect(large.colonnes).toBe(106)
    const motsLarges = new Uint32Array(Uint8Array.from(atob(large.cellules), c => c.charCodeAt(0)).buffer)
    expect([motsLarges[(3 * 106) * 3], motsLarges[(3 * 106 + 1) * 3]]).toEqual([0x25a0, 0x20])
    expect(large.mois.trim().split(/\s+/).slice(0, 3)).toEqual(['janv.', 'févr.', 'mars'])
    expect(large.mois.length).toBeLessThanOrEqual(106)
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

describe("l'affichage", () => {
  test('un nom tapé est nettoyé et coupé ; sans lettre ni chiffre, ou réservé, il est refusé', async () => {
    expect(nomSaisi('  FSY-I47  ')).toBe('FSY-I47')
    expect(nomSaisi('mon\tprojet\n   web')).toBe('mon projet web')
    // Les marques invisibles de sens d'écriture partent ; le liant d'un emoji composé reste.
    expect(nomSaisi('a‮b​c')).toBe('abc')
    expect(nomSaisi('👨‍👩‍👧 équipe')).toBe('👨‍👩‍👧 équipe')
    expect([...nomSaisi('é'.repeat(80))!].length).toBe(60)
    expect([nomSaisi('---'), nomSaisi('   '), nomSaisi(''), nomSaisi(SANS_ITEM)]).toEqual([null, null, null, null])
  })

  test("un nom comme « constructor » ou « toString » reste lui-même", async () => {
    expect([nommer('constructor', {}), nommer('toString', {}), nommer('__proto__', {})]).toEqual(['constructor', 'toString', '__proto__'])
  })

  test('les tokens passent à l\'unité suivante quand ils arrondissent à 1000', async () => {
    expect([999_400, 999_600, 999_600_000].map(formatJetons)).toEqual(['999 k', '1 M', '1 Md'])
  })

  test("les titres d'une autre année donnent l'année ; « 1er » partout en français ; « 0 days » en anglais", async () => {
    expect(bornes('jour', -400, h(12)).titre).toContain('2025')
    expect(bornes('semaine', -60, h(12)).titre).toContain('2025')
    expect(depuis(new Date(2024, 10, 12).getTime(), h(12))).toBe('Depuis le 12 novembre 2024')
    expect(t().semaineDu(1, 'juin')).toBe('Semaine du 1er juin')
    choisirLangue('en')
    try {
      expect(t().joursSerie(0)).toBe('0 days')
      expect(depuis(new Date(2024, 10, 12).getTime(), h(12))).toBe('Since Nov 12, 2024')
    } finally {
      choisirLangue('fr')
    }
  })

  test('deux sessions qui se suivent sans se chevaucher ne montrent pas de temps en parallèle', async () => {
    const s = (debut: number, session: string, k: string) => [
      { t: debut, s: session, e: 'message', k } as Evenement,
      { t: debut + 10 * MINUTE + 31_000, s: session, e: 'reponse', k } as Evenement,
      { t: debut + 10 * MINUTE + 31_000, s: session, e: 'jetons', n: 10, k } as Evenement,
      { t: debut + 10 * MINUTE + 32_000, s: session, e: 'fermeture', k } as Evenement,
    ]
    const b = bilan([...s(h(9), 'A', 'X'), ...s(h(9) + 10 * MINUTE + 32_000, 'B', 'Y')], R, h(12), JOUR, jourSuivant(JOUR))
    expect(b.total).toBe(b.reel)
  })

  test("la série continue avant le 1er janvier", async () => {
    // Tous les jours travaillés du 1er décembre 2025 au 3 janvier 2026.
    const aujourdhui = new Date(2026, 0, 3).getTime()
    const jours = (debut: Date, fin: Date) => {
      const m = new Map<string, number>()
      for (let d = new Date(debut); d <= fin; d.setDate(d.getDate() + 1)) m.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 30)
      return m
    }
    const avant = casesEntre(new Date(2025, 0, 1).getTime(), new Date(2025, 11, 31).getTime(), jours(new Date(2025, 11, 1), new Date(2025, 11, 31)), aujourdhui)
    const annee = casesEntre(new Date(2026, 0, 1).getTime(), new Date(2026, 11, 31).getTime(), jours(new Date(2026, 0, 1), new Date(2026, 0, 3)), aujourdhui)
    expect(compterSerie(annee)).toEqual({ jours: 3, ouverte: true })
    expect(compterSerie([...avant, ...annee]).jours).toBe(34)
  })
})


// Les prix de LiteLLM, en dollars par token, tels que le mod les garde.
const PRIX: Prix = {
  'claude-opus-5-5': {
    input_cost_per_token: 4e-6,
    output_cost_per_token: 2e-5,
    cache_creation_input_token_cost: 5e-6,
    cache_creation_input_token_cost_above_1hr: 8e-6,
    cache_read_input_token_cost: 2e-7,
    provider_specific_entry: { us: 1.1, fast: 2 },
    search_context_cost_per_query: { search_context_size_low: 0.01, search_context_size_medium: 0.01, search_context_size_high: 0.01 },
  },
  'claude-haiku-5-5': {
    input_cost_per_token: 1e-7,
    output_cost_per_token: 5e-7,
    cache_creation_input_token_cost: 1.25e-7,
    cache_creation_input_token_cost_above_1hr: 2e-7,
    cache_read_input_token_cost: 1e-8,
    input_cost_per_token_above_100k_tokens: 5e-7,
    output_cost_per_token_above_100k_tokens: 2.5e-6,
    cache_creation_input_token_cost_above_100k_tokens: 6.25e-7,
    cache_creation_input_token_cost_above_1hr_above_100k_tokens: 1e-6,
    cache_read_input_token_cost_above_100k_tokens: 5e-8,
  },
  'claude-sans-cache': { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
}

/** Un prix arrondi au milliardième de dollar : les calculs en virgule flottante laissent des restes minuscules. */
const arrondi = (x: number | null) => (x === null ? null : Math.round(x * 1e9) / 1e9)

describe('le prix API', () => {
  test('chaque sorte de token a son prix ; le mode rapide, les États-Unis et les recherches web aussi', async () => {
    const d = { m: 'claude-opus-5-5', in: 1_000, out: 2_000, c5: 1_000, c1: 10_000, cr: 100_000 }
    expect(arrondi(coutReponse(d, PRIX))).toBe(0.149)
    expect(arrondi(coutReponse({ ...d, rapide: 1 }, PRIX))).toBe(0.298)
    expect(arrondi(coutReponse({ ...d, us: 1 }, PRIX))).toBe(0.1639)
    expect(arrondi(coutReponse({ ...d, web: 3 }, PRIX))).toBe(0.179)
    // Un identifiant daté prend le prix de son modèle.
    expect(arrondi(coutReponse({ ...d, m: 'claude-opus-5-5-20260101' }, PRIX))).toBe(0.149)
  })

  test('au-delà de 100 k tokens de contexte dans une réponse, Haiku 5.5 prend ses autres prix ; une somme de réponses, non', async () => {
    expect(arrondi(coutReponse({ m: 'claude-haiku-5-5', in: 50_000, out: 1_000, c5: 0, c1: 0, cr: 40_000 }, PRIX))).toBe(0.0059)
    expect(arrondi(coutReponse({ m: 'claude-haiku-5-5', in: 50_000, out: 1_000, c5: 0, c1: 0, cr: 60_000, ctx: 100 }, PRIX))).toBe(0.0305)
    // 110 k en tout, mais en plusieurs réponses (sans palier) : les prix de base.
    expect(arrondi(coutReponse({ m: 'claude-haiku-5-5', in: 50_000, out: 1_000, c5: 0, c1: 0, cr: 60_000 }, PRIX))).toBe(0.0061)
  })


  test("sans prix de cache, ceux d'Anthropic ; un modèle inconnu n'a pas de prix", async () => {
    expect(arrondi(coutReponse({ m: 'claude-sans-cache', in: 0, out: 0, c5: 1_000, c1: 1_000, cr: 1_000 }, PRIX))).toBe(0.00335)
    expect(coutReponse({ m: 'claude-inconnu', in: 1_000, out: 0, c5: 0, c1: 0, cr: 0 }, PRIX)).toBeNull()
  })

  test('le prix suit la langue', async () => {
    const montants = [0.004, 0.42, 3.4, 31.4, 312.6]
    expect(montants.map(formatCout)).toEqual(['< 0,01 $', '0,42 $', '3,40 $', '31 $', '313 $'])
    choisirLangue('en')
    try {
      expect(montants.map(formatCout)).toEqual(['< $0.01', '$0.42', '$3.40', '$31', '$313'])
    } finally {
      choisirLangue('fr')
    }
  })

  test('le prix des tokens se calcule à la lecture, et s\'additionne par item, par jour et au total', async () => {
    const detail = (out: number) => [{ m: 'claude-opus-5-5', in: 0, out, c5: 0, c1: 0, cr: 0 }]
    const evenements = avecCouts(
      [
        ev(h(9), 'A', 'message', 'FLO-I1'),
        { t: h(9, 5), s: 'A', e: 'jetons', n: 1_000, k: 'FLO-I1', p: detail(1_000) } as Evenement,
        { t: h(9, 6), s: 'A', e: 'jetons', n: 500, k: 'FLO-I1', p: detail(500) } as Evenement,
        // Des tokens sans détail (un historique que Claude Code a effacé) restent sans prix.
        { t: h(9, 7), s: 'A', e: 'jetons', n: 300, k: 'FLO-I1' } as Evenement,
        ev(h(9, 10), 'A', 'reponse', 'FLO-I1'),
      ],
      PRIX,
    )
    const b = bilan(evenements, R, h(12), JOUR, jourSuivant(JOUR))
    expect(b.lignes[0]!.jetons).toBe(1_800)
    expect(arrondi(b.lignes[0]!.cout)).toBe(0.03)
    expect(arrondi(b.jours[0]!.cout)).toBe(0.03)
    expect(arrondi(b.cout)).toBe(0.03)
    // Sans prix connus, les tokens restent sans prix.
    expect(bilan(avecCouts(evenements.map(e => ({ ...e, c: undefined }) as Evenement), null), R, h(12), JOUR, jourSuivant(JOUR)).cout).toBe(0)
  })
})
