/** Une plage de temps comptée pour un item, en millisecondes depuis l'époque. */
export type Plage = { item: string; debut: number; fin: number }

/** Une plage d'une session ; sert aussi pour un écart long, ni compté ni classé. */
export type Ecart = Plage & { session: string }

/** Le temps et les tokens d'un item sur une période, et s'il compte en ce moment. */
export type Ligne = { item: string; minutes: number; enCours: boolean; jetons: number }

/** Ce que la puce affiche : le nom de la session et son temps du jour. */
export type Session = { item: string | null; minutes: number; enPause: boolean }

export type Onglet = 'jour' | 'semaine' | 'mois' | 'annee' | 'tout' | 'reglages'

/** L'état du popover : onglet, période affichée, champ ouvert, page de la liste. */
export type Interface = {
  onglet: Onglet
  decalage: number
  /** Le champ ouvert : « Ajouter un item », ou le renommage d'une ligne. */
  edition: 'autre' | { renommer: string } | null
  /** La page de la liste des items, à partir de 0. */
  page: number
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
  /** La dernière activité de chaque item sur la période : la liste va du plus récent au plus ancien. */
  derniere: Record<string, number>
}

/** La frise d'activité : une case par jour ; `aujourdhui` quand elle contient aujourd'hui ; `periode`, la période que
 * montre l'onglet, mise en avant dans la frise. */
export type Frise = {
  cases: { t: number; minutes: number; jetons?: number }[]
  aujourdhui: boolean
  periode: { debut: number; fin: number } | null
  /** Le réglage « Afficher » : avec « Tokens », les cases suivent les tokens, et non le temps ; l'infobulle d'une case ne
   * donne que ce qui est affiché. */
  mesure: Reglages['mesure']
}

/** Les réglages du popover. */
export type Reglages = {
  seuilPause: number
  activite: boolean
  langue: 'en' | 'fr'
  /** Ce que le popover montre : le temps et les tokens, ou l'un des deux. */
  mesure: 'tout' | 'temps' | 'jetons'
  /** Le thème du popover : ses couleurs et son fond animé. */
  theme: 'nuit' | 'simple' | 'aurore' | 'braise'
}

declare module 'claude-code' {
  interface PluginState {
    worklog: {
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
