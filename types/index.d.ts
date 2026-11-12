/** Une plage de temps comptée pour un ticket, en millisecondes depuis l'époque. */
export type Plage = { ticket: string; debut: number; fin: number }

/** Un écart long entre deux messages d'une session, ni compté ni classé. */
export type Ecart = Plage & { session: string }

/** Le temps d'un ticket sur une période, et s'il compte en ce moment. */
export type Ligne = { ticket: string; minutes: number; enCours: boolean }

/** Ce que la puce, la carte et le panneau affichent. */
export type Apercu = {
  jour: number
  lignes: Ligne[]
  total: number
  reel: number
  /** Le ticket de cette session, ou null s'il n'est pas encore connu. */
  ticket: string | null
  enPause: boolean
  ecarts: Ecart[]
  /** Les derniers tickets utilisés, le plus récent en premier. */
  recents: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'temps-ticket': {
      apercu: Shaped<Apercu | null>
      question: Shaped<Ecart | null>
      saisie: boolean
      deplie: boolean
    }
  }
}
