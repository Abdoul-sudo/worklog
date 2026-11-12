/** Une plage de temps comptée pour un item, en millisecondes depuis l'époque. */
export type Plage = { item: string; debut: number; fin: number }

/** Une plage d'une session ; sert aussi pour un écart long, ni compté ni classé. */
export type Ecart = Plage & { session: string }

/** Le temps d'un item sur une période, et s'il compte en ce moment. */
export type Ligne = { item: string; minutes: number; enCours: boolean }

/** Ce que la puce et la liste affichent. */
export type Apercu = {
  jour: number
  lignes: Ligne[]
  total: number
  reel: number
  /** Le nom affiché pour cette session : son item, sinon son nom par défaut. */
  item: string | null
  enPause: boolean
  ecarts: Ecart[]
  /** Les derniers items utilisés, le plus récent en premier. */
  recents: string[]
  /** Le temps du jour de cette session seule. */
  minutesSession: number
}

declare module 'claude-code' {
  interface PluginState {
    'temps-item': {
      apercu: Shaped<Apercu | null>
      question: Shaped<Ecart | null>
      deplie: boolean
    }
  }
}
