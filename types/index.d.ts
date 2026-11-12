/** Une plage de temps comptée pour un item, en millisecondes depuis l'époque. */
export type Plage = { item: string; debut: number; fin: number }

/** Une plage d'une session ; sert aussi pour un écart long, ni compté ni classé. */
export type Ecart = Plage & { session: string }

/** Le temps et les tokens d'un item sur une période, et s'il compte en ce moment. */
export type Ligne = { item: string; minutes: number; enCours: boolean; jetons: number }

/** Ce que la puce affiche : le nom de la session et son temps du jour. */
export type Session = { item: string | null; minutes: number; enPause: boolean }

export type Onglet = 'jour' | 'semaine' | 'mois' | 'reglages'

/** L'état du popover : onglet, période affichée, champ ouvert, dernier retrait annulable. */
export type Interface = {
  onglet: Onglet
  decalage: number
  edition: 'renommer' | 'autre' | null
  annulation: { item: string; debut: number; fin: number } | { recent: string } | null
}

/** Le contenu d'un onglet : titre, totaux et lignes de la période. */
export type Vue = {
  cle: string
  titre: string
  debut: number
  fin: number
  total: number
  reel: number
  jetons: number
  lignes: Ligne[]
}

/** La frise d'activité : une case par jour. */
export type Frise = { cases: { t: number; minutes: number }[]; total: number }

/** Les réglages du popover. */
export type Reglages = { seuilPause: number; motif: string; jetons: boolean; activite: boolean; question: boolean }

declare module 'claude-code' {
  interface PluginState {
    'temps-item': {
      session: Shaped<Session | null>
      question: Shaped<Ecart | null>
      deplie: boolean
      ui: Shaped<Interface>
      vue: Shaped<Vue | null>
      frise: Shaped<Frise | null>
      reglages: Shaped<Reglages | null>
    }
  }
}
