/** Une plage de temps comptée pour un item, en millisecondes depuis l'époque. */
export type Plage = { item: string; debut: number; fin: number }

/** Une plage d'une session ; sert aussi pour un écart long, ni compté ni classé. */
export type Ecart = Plage & { session: string }

/** Des tokens et leur prix API, en dollars. */
export type Part = { n: number; c: number }
/** Des tokens et leur prix : par type (`ecriture` : écrits en cache, pour 5 min ou 1 h ; `lecture` : relus du cache), par
 * modèle (son ID), et le prix des recherches web (`web`). */
export type Repartition = { entree: Part; sortie: Part; ecriture: Part; lecture: Part; web: number; modeles: Record<string, Part> }

/** Le temps, les tokens et leur prix API (en dollars) d'un item sur une période, et s'il compte en ce moment ;
 * `repartition` : le détail de ses tokens, quand il est connu. */
export type Ligne = { item: string; minutes: number; enCours: boolean; jetons: number; cout: number; repartition?: Repartition }

/** Ce que la puce affiche : le nom de la session et le temps de ce nom aujourd'hui, toutes sessions comprises. */
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
  cout: number
  /** Le détail des tokens de la période, par type et par modèle. */
  repartition?: Repartition
  lignes: Ligne[]
  /** La dernière activité de chaque item sur la période : la liste va du plus récent au plus ancien. */
  derniere: Record<string, number>
}

/** La frise d'activité : une case par jour ; `aujourdhui` quand elle contient aujourd'hui ; `periode`, la période que
 * montre l'onglet, mise en avant dans la frise. */
export type Frise = {
  cases: { t: number; minutes: number; jetons?: number; cout?: number; principal?: string }[]
  aujourdhui: boolean
  periode: { debut: number; fin: number } | null
  /** Le réglage « Afficher » : avec « Tokens et prix », les cases suivent les tokens, et non le temps ; l'infobulle d'une
   * case ne donne que ce qui est affiché. */
  mesure: Reglages['mesure']
  /** La série de jours travaillés jusqu'à aujourd'hui, celle de l'année d'avant comprise ; null sans aujourd'hui. */
  serie: number | null
}

/** Les réglages du popover. */
export type Reglages = {
  seuilPause: number
  pauseMax: number
  activite: boolean
  langue: 'en' | 'fr'
  /** Ce que le popover montre à côté des tokens : le temps (`tout`), ou leur prix API (`jetons`). */
  mesure: 'tout' | 'jetons'
  /** Le thème du popover : ses couleurs et son fond animé. */
  theme: 'nuit' | 'simple' | 'aurore' | 'braise' | 'foret' | 'ocean' | 'crepuscule' | 'sakura'
  /** La puce du cache de prompt, à côté de celle du temps. */
  cache: boolean
}

/** Le cache de prompt de la conversation principale, d'après ses derniers appels au modèle. */
export type Cache = {
  /** La conversation de ces chiffres : après /clear, ils ne valent plus. */
  session: string
  /** L'envoi du dernier appel qui a eu une réponse : il a relu ou écrit le cache, et l'a gardé en vie. */
  appel: number
  /** Combien de temps le cache vit sans appel. */
  ttl: '5m' | '1h'
  /** Les tokens que le prochain message envoie : relus du cache s'il est chaud, réécrits s'il est froid. */
  contexte: number
  /** Le modèle du dernier appel : chaque modèle a son propre cache. */
  modele: string
  /** Froid avant l'heure : un autre modèle a pris la suite, et son cache est à refaire. */
  froid: boolean
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
      cache: Shaped<Cache | null>
      /** Ce que montre la puce du cache : les minutes qui lui restent, 0 quand il est froid ; null sans appel connu. */
      minutesCache: number | null
    }
  }
}
