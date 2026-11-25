// Les dessins du popover : ses thèmes (encres et fonds animés), chrono, pastilles, engrenage, interrupteur, icônes.
// Logique pure.
import { type Theme, SANS_ITEM } from './calcul'

/** Les encres d'un thème : le fond et le cadre du popover, ses textes, son accent, les cases vides de la frise. */
type Encres = {
  fond: string
  bord: string
  /** Le fond et le cadre des cartes au survol (tokens, cache, aides ⓘ, jours de la frise) : la teinte du thème, plus
   * claire que son fond pour se détacher du popover. Les textes gris, texte et vif y gardent un contraste de 4,5:1. */
  carte: string
  bordCarte: string
  texte: string
  vif: string
  gris: string
  faible: string
  legende: string
  accent: string
  vide: string
  survol: string
  filet: string
  choisi: string
  rail: string
}

const BLANCS = { survol: '#FFFFFF0A', filet: '#FFFFFF12', choisi: '#FFFFFF17', rail: '#FFFFFF08' }
/** Pas de fond propre : le popover laisse voir celui de l'app (thème Simple). */
export const SANS_FOND = '#00000000'
const ARGILE = '#E0835F'

/** Le fond de chaque thème : 1600 × 1200, ancré en haut à gauche, que le popover coupe. Ses mouvements sont lents et
 * discrets ; ils s'arrêtent quand le système demande moins d'animations. */
export const CIEL = { largeur: 1600, hauteur: 1200 }
const ouvrirCiel = (style: string, defs: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CIEL.largeur} ${CIEL.hauteur}" width="${CIEL.largeur}" height="${CIEL.hauteur}" preserveAspectRatio="xMinYMin slice">` +
  `<style>${style}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style><defs>${defs}</defs>`
const trame = (couleur: string, opacite: number) =>
  `<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r=".8" fill="${couleur}" fill-opacity="${opacite}"/></pattern>`
const lueur = (id: string, couleur: string, opacite: number) =>
  `<radialGradient id="${id}"><stop offset="0" stop-color="${couleur}" stop-opacity="${opacite}"/><stop offset="1" stop-color="${couleur}" stop-opacity="0"/></radialGradient>`

/** Un tirage au hasard qui revient toujours le même pour une même graine (mulberry32) : le ciel ne change pas d'un dessin
 * à l'autre. */
function hasard(graine: number): () => number {
  return () => {
    graine = (graine + 0x6d2b79f5) | 0
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Nuit : un ciel étoilé sur le bleu nuit, que traverse lentement une lueur bleue. Une Voie lactée penchée le traverse :
 * de petites étoiles s'y serrent. Des étoiles moyennes scintillent, et quatre brillantes, à quatre branches, se posent
 * dans les coins vides du popover de la bande : entre les totaux et la frise, sous les totaux, en bas. Sur le texte, les
 * étoiles se font rares, et celles sans branches restent petites : elles se prendraient pour des points du texte. */
function cielNuit(): string {
  const h = hasard(11)
  // La Voie lactée : une droite qui monte de (0, 470) à (1600, -50), autour de laquelle les étoiles sont plus serrées.
  const angle = (-18 * Math.PI) / 180
  const pres = (x: number, y: number) => Math.exp(-((((y - 210) * Math.cos(angle) - (x - 800) * Math.sin(angle)) / 150) ** 2))
  const brillantes = [[582, 120, 5.5], [270, 252, 4.5], [846, 432, 5], [1430, 442, 5.5]] as const
  // Le texte de la vue Aujourd'hui dans la bande, en pixels du ciel : l'en-tête, les totaux, la frise, la liste, l'ajout.
  const texte = [[60, 50, 310, 105], [820, 50, 1620, 105], [60, 115, 470, 210], [670, 60, 1620, 262], [70, 300, 1590, 378], [60, 400, 230, 432]]
  const surTexte = (x: number, y: number) => texte.some(([a, b, c, d]) => x > a! && x < c! && y > b! && y < d!)
  const places: [number, number][] = brillantes.map(([x, y]) => [x, y])
  // `surLeTexte` : la part des étoiles gardée sur le texte.
  const placer = (n: number, ecart: number, voieLactee: boolean, surLeTexte: number): [number, number][] => {
    const prises: [number, number][] = []
    for (let essai = 0; prises.length < n && essai < 20_000; essai++) {
      // Les trois quarts dans les 500 px du haut, où se tient le popover de la bande ; les autres pour un panneau plus haut.
      const x = h() * CIEL.largeur
      const y = h() < 0.75 ? h() * 500 : 500 + h() * (CIEL.hauteur - 500)
      if (voieLactee && h() > 0.18 + 0.82 * pres(x, y)) continue
      if (surTexte(x, y) && h() > surLeTexte) continue
      if (places.some(([u, v]) => (u - x) ** 2 + (v - y) ** 2 < ecart ** 2)) continue
      places.push([x, y])
      prises.push([x, y])
    }
    return prises
  }
  // Surtout blanc bleuté, quelques-unes chaudes ou plus bleues, comme de vraies étoiles.
  const teinte = () => {
    const t = h()
    return t < 0.12 ? '#FFE8C2' : t < 0.25 ? '#B9CBFF' : '#E3E9FF'
  }
  const n = (v: number) => v.toFixed(1)
  const scintille = (duree: number) => `animation:e ${n(duree)}s ease-in-out ${n(-h() * duree)}s infinite alternate`
  const moyennes = placer(16, 110, false, 0.1)
    .map(([x, y]) => `<g style="${scintille(3 + h() * 4)}"><circle cx="${n(x)}" cy="${n(y)}" r="5" fill="url(#a)"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(0.9 + h() * 0.2)}" fill="${teinte()}"/></g>`)
    .join('')
  const petites = placer(170, 16, true, 0.3)
    .map(([x, y]) => {
      const anime = h() < 0.3 ? ` style="${scintille(2.5 + h() * 4)}"` : ` opacity="${n(0.25 + h() * 0.4)}"`
      return `<circle cx="${n(x)}" cy="${n(y)}" r="${(0.45 + h() * 0.45).toFixed(2)}" fill="${teinte()}"${anime}/>`
    })
    .join('')
  // Quatre branches fines, plus longues à la verticale, un cœur blanc et un halo ; l'étoile respire en grandissant un peu.
  const brille = brillantes
    .map(([x, y, b]) => {
      const c = b * 0.12
      const branches = `M0 ${-b * 1.25}L${c} ${-c}L${b} 0L${c} ${c}L0 ${b * 1.25}L${-c} ${c}L${-b} 0L${-c} ${-c}Z`
      return (
        `<g transform="translate(${x} ${y})"><g class="b" style="animation:b ${n(4 + b)}s ease-in-out ${n(-h() * 8)}s infinite alternate">` +
        `<circle r="${n(b * 2.2)}" fill="url(#a)"/><path d="${branches}" fill="#EEF2FF"/><circle r="${n(b * 0.22)}" fill="#FFFFFF"/></g></g>`
      )
    })
    .join('')
  return (
    ouvrirCiel(
      '.g{animation:g 46s ease-in-out infinite alternate}@keyframes g{from{transform:translate(0,0)}to{transform:translate(520px,40px)}}' +
        '@keyframes e{from{opacity:.2}to{opacity:.8}}' +
        '.b{transform-box:fill-box;transform-origin:center}@keyframes b{from{opacity:.55;transform:scale(.82)}to{opacity:1;transform:scale(1.08)}}',
      lueur('h', '#6E8BFF', 0.08) + lueur('a', '#C9D4FF', 0.3) + lueur('v', '#A9B8FF', 0.055),
    ) +
    `<ellipse class="g" cx="260" cy="90" rx="460" ry="190" fill="url(#h)"/>` +
    `<ellipse cx="800" cy="210" rx="1050" ry="150" transform="rotate(-18 800 210)" fill="url(#v)"/>${petites}${moyennes}${brille}</svg>`
  )
}

/** Aurore : un voile sarcelle, fixe, en haut à gauche ; il ne bouge ni ne change de couleur. */
function cielAurore(): string {
  return (
    ouvrirCiel('', lueur('t', '#2DD4BF', 0.13) + trame('#BFEFF0', 0.04)) +
    `<rect width="${CIEL.largeur}" height="${CIEL.hauteur}" fill="url(#p)"/>` +
    '<ellipse cx="240" cy="40" rx="520" ry="150" fill="url(#t)"/></svg>'
  )
}

/** Braise : une lueur chaude respire en bas ; de petites braises montent et s'éteignent. */
function cielBraise(): string {
  const braises = [60, 190, 320, 470, 600, 730, 880, 1010, 1150, 1280].map((x, i) => {
    const duree = 9 + ((i * 5) % 7)
    return (
      `<circle cx="${x}" cy="300" r="${1.4 + (i % 3) * 0.35}" fill="#FFC29E" opacity="0" ` +
      `style="animation:m ${duree}s linear ${-((i * 2.3) % duree).toFixed(1)}s infinite"/>`
    )
  }).join('')
  return (
    ouvrirCiel(
      '@keyframes m{0%{transform:translate(0,0);opacity:0}15%{opacity:.9}100%{transform:translate(24px,-280px);opacity:0}}' +
        '.r{animation:r 9s ease-in-out infinite alternate}@keyframes r{from{opacity:.55}to{opacity:1}}',
      lueur('f', ARGILE, 0.14),
    ) +
    `<ellipse class="r" cx="320" cy="300" rx="620" ry="210" fill="url(#f)"/>${braises}</svg>`
  )
}

/** Forêt : deux rangées de sapins en ombres, fixes, en bas ; ils s'effacent vers le haut comme dans la brume, et leurs
 * cimes restent pâles sous le texte. Une brume verte passe derrière eux ; des lucioles s'allument et s'éteignent,
 * chacune à son rythme. Sous les sapins, le sol garde leur couleur jusqu'en bas. */
function cielForet(): string {
  // Une rangée de sapins à trois étages, de hauteurs variées, qui se touchent. Sa couleur monte d'un fondu : transparente
  // au-dessus de `haut`, pleine à sa base.
  const rangee = (id: string, graine: number, base: number, hMin: number, hMax: number, couleur: string, haut: number) => {
    let d = ''
    for (let x = -60, i = 0; x < CIEL.largeur + 60; i++) {
      const h = hMin + (((i * graine) % 7) / 6) * (hMax - hMin)
      const l = h * 0.42
      const n = (v: number) => v.toFixed(1)
      d +=
        `M${n(x)} ${n(base - h)}l${n(-l * 0.35)} ${n(h * 0.4)}h${n(l * 0.12)}l${n(-l * 0.2)} ${n(h * 0.3)}h${n(l * 0.1)}` +
        `l${n(-l * 0.25)} ${n(h * 0.3)}h${n(l * 1.16)}l${n(-l * 0.25)} ${n(-h * 0.3)}h${n(l * 0.1)}l${n(-l * 0.2)} ${n(-h * 0.3)}h${n(l * 0.12)}z`
      x += l * 0.9 + ((i * 3) % 5) * 4
    }
    return (
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${haut}" x2="0" y2="${base}">` +
      `<stop offset="0" stop-color="${couleur}" stop-opacity="0"/><stop offset="1" stop-color="${couleur}"/></linearGradient>` +
      `<path d="${d}M-60 ${base}H${CIEL.largeur + 60}V${CIEL.hauteur}H-60z" fill="url(#${id})"/>`
    )
  }
  const lucioles = [[90, 150], [210, 60], [340, 120], [480, 95], [610, 40], [760, 140], [900, 80], [1040, 160], [1180, 70], [1330, 125]]
    .map(([x, y], i) => {
      const duree = 4 + ((i * 3) % 5)
      return (
        `<g opacity="0" style="animation:l ${duree}s ease-in-out ${-((i * 1.7) % duree).toFixed(1)}s infinite">` +
        `<circle cx="${x}" cy="${y}" r="5" fill="#D9F99D" fill-opacity=".18"/><circle cx="${x}" cy="${y}" r="1.6" fill="#ECFCCB"/></g>`
      )
    })
    .join('')
  return (
    ouvrirCiel(
      '@keyframes l{0%,100%{opacity:0;transform:translate(0,0)}50%{opacity:.9;transform:translate(6px,-10px)}}' +
        '.m{animation:m 46s ease-in-out infinite alternate}@keyframes m{from{transform:translateX(-160px)}to{transform:translateX(160px)}}',
      lueur('v', '#3FA66B', 0.12) + lueur('b', '#A7F3D0', 0.08),
    ) +
    '<ellipse cx="300" cy="230" rx="700" ry="150" fill="url(#v)"/>' +
    '<ellipse class="m" cx="800" cy="168" rx="900" ry="46" fill="url(#b)"/>' +
    rangee('loin', 5, 212, 30, 54, '#0F2A1C', 150) +
    rangee('pres', 3, 234, 40, 70, '#050E09', 170) +
    `${lucioles}</svg>`
  )
}

/** Océan : trois vagues dans le bas de la carte, même courte. Chacune a sa crête claire et une eau qui pâlit sous
 * elle ; elles glissent à des vitesses différentes, la deuxième en sens inverse, et se soulèvent doucement, comme une
 * houle. Une lueur bleue en haut. */
function cielOcean(): string {
  // Une crête : une onde de 400 unités de période, plus large que le ciel ; glisser d'une période la ramène à son départ.
  const crete = (y: number, amplitude: number) => `M-400 ${y}q100 ${-amplitude} 200 0${' t200 0'.repeat(11)}`
  const vague = (i: number, y: number, amplitude: number, force: number, glisse: number, sens: 'd' | 'g', houle: number) =>
    `<linearGradient id="e${i}" gradientUnits="userSpaceOnUse" x1="0" y1="${y - amplitude}" x2="0" y2="${y + 46}">` +
    `<stop offset="0" stop-color="#38BDF8" stop-opacity="${force}"/><stop offset="1" stop-color="#38BDF8" stop-opacity="0"/></linearGradient>` +
    `<g style="animation:${sens} ${glisse}s linear infinite"><g style="animation:s ${houle}s ease-in-out infinite alternate">` +
    `<path d="${crete(y, amplitude)}V${CIEL.hauteur}H-400z" fill="url(#e${i})"/>` +
    `<path d="${crete(y, amplitude)}" fill="none" stroke="#A5E1FD" stroke-opacity="${(force * 2).toFixed(2)}" stroke-width="1.2"/>` +
    '</g></g>'
  return (
    ouvrirCiel(
      '@keyframes d{from{transform:translateX(0)}to{transform:translateX(400px)}}' +
        '@keyframes g{from{transform:translateX(0)}to{transform:translateX(-400px)}}' +
        '@keyframes s{from{transform:translateY(-4px)}to{transform:translateY(4px)}}',
      lueur('b', '#38BDF8', 0.1),
    ) +
    '<ellipse cx="300" cy="20" rx="560" ry="160" fill="url(#b)"/>' +
    vague(0, 150, 9, 0.07, 34, 'd', 7) +
    vague(1, 172, 12, 0.06, 46, 'g', 9) +
    vague(2, 196, 8, 0.06, 58, 'd', 11) +
    '</svg>'
  )
}

/** Crépuscule : en bas, l'horizon rose et orangé, et le soleil qui se couche et respire ; en haut, des étoiles
 * scintillent, et une étoile filante passe de temps en temps. */
function cielCrepuscule(): string {
  const etoiles = [[90, 30], [240, 70], [380, 22], [520, 58], [660, 34], [800, 84], [930, 18], [1080, 62], [1210, 28], [1340, 76], [1470, 40], [170, 112], [610, 118], [1150, 120]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${(0.8 + (i % 3) * 0.25).toFixed(2)}" fill="#F3EDFF" style="animation:e ${4 + (i % 5)}s ease-in-out ${-i * 0.7}s infinite alternate"/>`)
    .join('')
  // Une étoile filante : la tête claire, la queue qui s'efface ; elle traverse en une seconde, toutes les quatorze.
  const filante =
    '<g style="animation:f 14s linear 3s infinite;opacity:0"><line x1="0" y1="0" x2="96" y2="32" stroke="url(#q)" stroke-width="1.6" stroke-linecap="round"/></g>'
  return (
    ouvrirCiel(
      '@keyframes e{from{opacity:.12}to{opacity:.75}}' +
        '@keyframes f{0%{transform:translate(260px,6px);opacity:0}1%{opacity:1}7%{transform:translate(680px,146px);opacity:0}100%{transform:translate(680px,146px);opacity:0}}' +
        '.s{animation:s 10s ease-in-out infinite alternate}@keyframes s{from{opacity:.7}to{opacity:1}}',
      lueur('h', '#EC4899', 0.15) +
        lueur('o', '#FB923C', 0.13) +
        lueur('u', '#FDBA74', 0.24) +
        '<linearGradient id="q"><stop offset="0" stop-color="#F3EDFF" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>',
    ) +
    '<ellipse cx="760" cy="235" rx="1000" ry="130" fill="url(#h)"/>' +
    '<ellipse class="s" cx="1120" cy="215" rx="420" ry="95" fill="url(#o)"/>' +
    `<circle class="s" cx="1120" cy="205" r="62" fill="url(#u)"/>${etoiles}${filante}</svg>`
  )
}

/** Sakura : des pétales tombent lentement en tournant ; une lueur rose en haut à gauche. */
function cielSakura(): string {
  const petales = [70, 230, 390, 560, 720, 880, 1040, 1200, 1360, 1500]
    .map((x, i) => {
      const duree = 14 + ((i * 5) % 9)
      return (
        `<ellipse cx="${x}" cy="-10" rx="3.2" ry="1.9" fill="#F9C6DA" opacity="0" ` +
        `style="transform-box:fill-box;transform-origin:center;animation:f ${duree}s linear ${-((i * 3.1) % duree).toFixed(1)}s infinite"/>`
      )
    })
    .join('')
  return (
    ouvrirCiel(
      '@keyframes f{0%{transform:translate(0,0) rotate(0deg);opacity:0}10%{opacity:.7}85%{opacity:.5}100%{transform:translate(-70px,360px) rotate(300deg);opacity:0}}',
      lueur('k', '#F472B6', 0.1),
    ) +
    `<ellipse cx="220" cy="30" rx="540" ry="170" fill="url(#k)"/>${petales}</svg>`
  )
}

/** Les thèmes du popover. Simple n'a ni fond propre ni mouvement : le gris de l'app et un cadre fin. */
export const THEMES: Record<Theme, { encres: Encres; ciel: (() => string) | null }> = {
  nuit: {
    encres: { fond: '#070A14', bord: '#1C243D', carte: '#151B30', bordCarte: '#2C3453', texte: '#E6E9F2', vif: '#F7F8FC', gris: '#8A93B2', faible: '#707B9D', legende: '#727C9A', accent: '#4CCFE0', vide: '#C9D4FF', ...BLANCS },
    ciel: cielNuit,
  },
  simple: {
    encres: { fond: SANS_FOND, bord: '#FFFFFF2E', carte: '#2A2A2A', bordCarte: '#3D3D3D', texte: '#E4E4E4', vif: '#F5F5F5', gris: '#A3A3A3', faible: '#8C8C8C', legende: '#8C8C8C', accent: ARGILE, vide: '#FFFFFF', ...BLANCS },
    ciel: null,
  },
  aurore: {
    encres: { fond: '#040C12', bord: '#173241', carte: '#132D32', bordCarte: '#294F57', texte: '#E2F1F2', vif: '#F4FBFB', gris: '#88A8B0', faible: '#678C95', legende: '#6A8C94', accent: '#4FD1C5', vide: '#BFEFF0', ...BLANCS },
    ciel: cielAurore,
  },
  braise: {
    encres: { fond: '#140F0C', bord: '#3D2B21', carte: '#2D1F18', bordCarte: '#4F3B30', texte: '#F2E8E1', vif: '#FBF6F2', gris: '#B39B8D', faible: '#957B6A', legende: '#937C6E', accent: ARGILE, vide: '#FFD9C2', ...BLANCS },
    ciel: cielBraise,
  },
  foret: {
    encres: { fond: '#07110C', bord: '#1E3A2B', carte: '#182D22', bordCarte: '#304F40', texte: '#E3F0E8', vif: '#F5FBF7', gris: '#8FAE9C', faible: '#6E937F', legende: '#739181', accent: '#6FCF97', vide: '#CDEFD9', ...BLANCS },
    ciel: cielForet,
  },
  ocean: {
    encres: { fond: '#06101C', bord: '#1B3550', carte: '#132232', bordCarte: '#293F57', texte: '#E3EEF7', vif: '#F5FAFD', gris: '#8BA6BF', faible: '#6D88A4', legende: '#6E88A3', accent: '#5AB4F5', vide: '#CFE6FA', ...BLANCS },
    ciel: cielOcean,
  },
  crepuscule: {
    encres: { fond: '#0E0A18', bord: '#2E2547', carte: '#231834', bordCarte: '#3D2F55', texte: '#ECE8F5', vif: '#FAF8FD', gris: '#A398BD', faible: '#8F86A7', legende: '#8F86A6', accent: '#B794F6', vide: '#DCCFFB', ...BLANCS },
    ciel: cielCrepuscule,
  },
  sakura: {
    encres: { fond: '#140B10', bord: '#3D2333', carte: '#2C1922', bordCarte: '#4E3140', texte: '#F5E9EF', vif: '#FDF7FA', gris: '#B898A8', faible: '#977A8A', legende: '#977A88', accent: '#F49AC1', vide: '#FBD3E4', ...BLANCS },
    ciel: cielSakura,
  },
}

/** Les encres du thème choisi : tout le popover les lit au moment de se dessiner. */
export const ENCRE: Encres = { ...THEMES.nuit.encres }
let themeChoisi: Theme = 'nuit'
export function choisirTheme(theme: Theme): void {
  themeChoisi = theme
  Object.assign(ENCRE, THEMES[theme].encres)
}

/** Le thème choisi a-t-il un fond (une trame, des lueurs) ? */
export const aUnCiel = (): boolean => THEMES[themeChoisi].ciel !== null

/** Cale chaque animation du fond sur l'heure (`secondes`) : son retard devient la phase qu'elle aurait si elle tournait
 * depuis toujours. Quand l'app redessine le fond, et relance ses animations, il reprend ainsi là où il en était, sans
 * sauter à son début. */
function caler(svg: string, secondes: number): string {
  return svg.replace(/animation:(\w+) ([\d.]+)s ([\w-]+) (?:(-?[\d.]+)s )?infinite( alternate)?/g, (_, nom, duree, courbe, retard, alterne) => {
    const periode = Number(duree) * (alterne === undefined ? 1 : 2)
    const phase = (((secondes - Number(retard ?? 0)) % periode) + periode) % periode
    return `animation:${nom} ${duree}s ${courbe} ${(-phase).toFixed(2)}s infinite${alterne ?? ''}`
  })
}

/** Le fond du thème choisi à l'instant `maintenant` (en millisecondes), ou null s'il n'en a pas. */
export function svgCiel(maintenant: number): string | null {
  const ciel = THEMES[themeChoisi].ciel?.()
  return ciel === undefined ? null : caler(ciel, maintenant / 1000)
}

/** L'aperçu d'un thème dans les réglages : son fond, un titre, deux lignes, quatre cases de frise ; cerclé d'accent quand
 * il est choisi. */
export const APERCU = { largeur: 64, hauteur: 40 }
export function svgApercu(theme: Theme, choisi: boolean): string {
  const e = THEMES[theme].encres
  const fond = theme === 'simple' ? '#262626' : e.fond
  const decor = {
    nuit: `<ellipse cx="20" cy="10" rx="28" ry="12" fill="#6E8BFF" fill-opacity=".1"/>` +
      [[40, 6, 0.5, 0.4], [58, 23, 0.5, 0.35], [36, 16, 0.4, 0.3], [5, 31, 0.5, 0.35], [26, 35, 0.6, 0.5], [47, 36, 0.4, 0.3], [4, 5, 0.4, 0.3], [56, 5, 0.6, 0.6]]
        .map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#E8EDFF" fill-opacity="${o}"/>`)
        .join('') +
      `<path transform="translate(49 15)" d="M0-3.6L.4-.4L3 0L.4 .4L0 3.6L-.4 .4L-3 0L-.4-.4Z" fill="#E8EDFF"/><circle cx="49" cy="15" r=".8" fill="#FFFFFF"/>`,
    simple: '',
    aurore: `<ellipse cx="18" cy="8" rx="30" ry="12" fill="#2DD4BF" fill-opacity=".15"/>`,
    braise: `<ellipse cx="22" cy="40" rx="40" ry="16" fill="${ARGILE}" fill-opacity=".18"/><circle cx="14" cy="22" r=".9" fill="#FFB38A"/><circle cx="34" cy="16" r=".7" fill="#FFB38A"/><circle cx="52" cy="26" r=".8" fill="#FFB38A"/>`,
    foret: `<ellipse cx="24" cy="36" rx="40" ry="10" fill="#3FA66B" fill-opacity=".22"/><path d="M6 40l5-13 5 13zM14 40l6-16 6 16zM24 40l4-10 4 10zM38 40l6-15 6 15zM48 40l5-12 5 12zM56 40l5-14 5 14z" fill="#12301F"/><circle cx="12" cy="18" r=".9" fill="#D9F99D"/><circle cx="33" cy="22" r=".8" fill="#D9F99D"/><circle cx="54" cy="16" r=".9" fill="#D9F99D"/>`,
    ocean: `<ellipse cx="20" cy="4" rx="34" ry="12" fill="#38BDF8" fill-opacity=".12"/><path d="M0 35q8-3 16 0t16 0 16 0 16 0" fill="none" stroke="#7DD3FC" stroke-opacity=".35"/>`,
    crepuscule: `<ellipse cx="32" cy="42" rx="44" ry="13" fill="#EC4899" fill-opacity=".22"/><circle cx="48" cy="40" r="8" fill="#FDBA74" fill-opacity=".45"/><circle cx="10" cy="7" r=".7" fill="#F3EDFF"/><circle cx="27" cy="13" r=".6" fill="#F3EDFF"/><circle cx="58" cy="6" r=".7" fill="#F3EDFF"/>`,
    sakura: `<ellipse cx="18" cy="6" rx="30" ry="12" fill="#F472B6" fill-opacity=".12"/><ellipse cx="13" cy="31" rx="1.8" ry="1.1" fill="#F9C6DA" transform="rotate(30 13 31)"/><ellipse cx="34" cy="19" rx="1.8" ry="1.1" fill="#F9C6DA" transform="rotate(-20 34 19)"/><ellipse cx="55" cy="33" rx="1.8" ry="1.1" fill="#F9C6DA" transform="rotate(50 55 33)"/>`,
  }[theme]
  const cases = [0, 1, 2, 3].map(i => `<rect x="${37 + i * 6}" y="27" width="4.5" height="4.5" rx="1" fill="${i === 2 ? e.accent : e.vide}" fill-opacity="${i === 2 ? 1 : 0.18}"/>`).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${APERCU.largeur} ${APERCU.hauteur}" width="${APERCU.largeur}" height="${APERCU.hauteur}">` +
    `<clipPath id="c"><rect x=".75" y=".75" width="62.5" height="38.5" rx="7"/></clipPath>` +
    `<g clip-path="url(#c)"><rect width="64" height="40" fill="${fond}"/>${decor}</g>` +
    `<rect x="8" y="9" width="18" height="3" rx="1.5" fill="${e.vif}"/><rect x="8" y="17" width="24" height="2.5" rx="1.25" fill="${e.texte}" fill-opacity=".45"/>` +
    `<rect x="8" y="24" width="16" height="2.5" rx="1.25" fill="${e.texte}" fill-opacity=".45"/>${cases}` +
    `<rect x=".75" y=".75" width="62.5" height="38.5" rx="7" fill="none" stroke="${choisi ? e.accent : theme === 'simple' ? '#FFFFFF33' : e.bord}" stroke-width="${choisi ? 1.5 : 1}"/></svg>`
  )
}

/** Six couleurs bien distinctes sur le fond sombre, l'accent du thème d'abord. */
const PALETTE = ['#7EA6F2', '#8CC7A1', '#C3A4EE', '#E8BE6A', '#6CC9C0']
const GRIS_AUTRES = '#6C7083'

/** Les couleurs des lignes : un item compté en ce moment a la sienne, distincte des autres ; le reste est gris. */
export function couleurs(lignes: readonly { item: string; enCours: boolean }[]): string[] {
  const teintes = [ENCRE.accent, ...PALETTE]
  let i = 0
  return lignes.map(l => (l.enCours && l.item !== SANS_ITEM && i < teintes.length ? teintes[i++]! : GRIS_AUTRES))
}

/** La marque : un chronomètre au trait, dans l'accent. */
export function svgChrono(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="${ENCRE.accent}" stroke-width="1.4" stroke-linecap="round">` +
    '<circle cx="8" cy="9" r="5.6"/><path d="M6.4 1.6h3.2M8 1.6v1.8M8 9 10.4 6.6M12.6 4.2l.9-.9"/></svg>'
  )
}

/** Une pastille ; celle d'un item compté en ce moment bat : un anneau de sa couleur part du point et s'élargit, une
 * fois par seconde et demie, et le point s'allume au même rythme. */
export function svgPastille(couleur: string, vivante: boolean): string {
  if (!vivante) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="3.2" fill="${couleur}"/></svg>`
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18">' +
    '<style>.o{transform-box:fill-box;transform-origin:center;animation:o 1.5s cubic-bezier(.2,.6,.3,1) infinite}' +
    '@keyframes o{0%{transform:scale(.35);opacity:.95}100%{transform:scale(1);opacity:0}}' +
    '.c{transform-box:fill-box;transform-origin:center;animation:c 1.5s ease-in-out infinite}' +
    '@keyframes c{0%,100%{transform:scale(1)}15%{transform:scale(1.25)}40%{transform:scale(1)}}' +
    '@media (prefers-reduced-motion:reduce){.o,.c{animation:none}.o{transform:scale(.8);opacity:.35}}</style>' +
    `<circle class="o" cx="9" cy="9" r="8.4" fill="none" stroke="${couleur}" stroke-width="1.6"/>` +
    `<circle cx="9" cy="9" r="5.6" fill="${couleur}" fill-opacity=".18"/>` +
    `<circle class="c" cx="9" cy="9" r="3.2" fill="${couleur}"/></svg>`
  )
}

/** Un engrenage au trait fin, comme les icônes de l'app : huit dents autour d'un moyeu. */
export function svgEngrenage(couleur: string): string {
  const points: string[] = []
  for (let dent = 0; dent < 8; dent++) {
    const angle = (dent * Math.PI) / 4
    for (const [decalage, rayon] of [[-0.3, 7.6], [-0.17, 10], [0.17, 10], [0.3, 7.6]] as const) {
      const a = angle + decalage
      points.push(`${(12 + rayon * Math.cos(a)).toFixed(2)},${(12 + rayon * Math.sin(a)).toFixed(2)}`)
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${couleur}" stroke-width="1.6" stroke-linejoin="round">` +
    `<polygon points="${points.join(' ')}"/><circle cx="12" cy="12" r="3.2"/></svg>`
  )
}

/** Un interrupteur, comme « Enable fast mode » dans le menu des modèles. */
export function svgInterrupteur(actif: boolean): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 16" width="28" height="16">' +
    `<rect width="28" height="16" rx="8" fill="${actif ? ENCRE.accent : '#fff'}" fill-opacity="${actif ? 1 : 0.14}"/>` +
    `<circle cx="${actif ? 20 : 8}" cy="8" r="6" fill="${actif ? '#fff' : ENCRE.texte}"/></svg>`
  )
}

/** La croix qui ferme les réglages : à la place de l'engrenage, au trait du même poids. */
export function svgFermer(couleur: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${couleur}" stroke-width="1.6" stroke-linecap="round">` +
    '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
  )
}

/** Les icônes du popover, au même trait que l'engrenage. */
export const ICONES = {
  precedent: 'M7.5 2.5 4 6l3.5 3.5',
  suivant: 'M4.5 2.5 8 6l-3.5 3.5',
  crayon: 'M2 10l.6-2.4 5.8-5.8a1.1 1.1 0 0 1 1.6 1.6L4.2 9.2z',
  changer: 'M2 4h8M8 2l2 2-2 2M10 8H2M4 6 2 8l2 2',
  valider: 'M2.5 6.5 5 9l4.5-6',
} as const
/** Une icône du popover, sur 16 unités avec une marge ; au survol, un rond clair derrière elle. */
export const TAILLE_ICONE = 18
export function svgIcone(trace: string, couleur: string, survol = false): string {
  const rond = survol ? '<circle cx="6" cy="6" r="7.6" fill="#FFFFFF" fill-opacity=".1"/>' : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 16 16" width="${TAILLE_ICONE}" height="${TAILLE_ICONE}">${rond}` +
    `<path d="${trace}" fill="none" stroke="${couleur}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  )
}

/** La jauge du cache, dans sa puce : un anneau plein quand le cache vient de servir, qui se vide jusqu'au froid. */
export function svgJaugeCache(part: number, couleur: string): string {
  const tour = 2 * Math.PI * 5
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="${couleur}" stroke-width="2">` +
    '<circle cx="7" cy="7" r="5" stroke-opacity=".25"/>' +
    `<circle cx="7" cy="7" r="5" stroke-linecap="round" stroke-dasharray="${(Math.min(1, part) * tour).toFixed(2)} ${tour.toFixed(2)}" transform="rotate(-90 7 7)"/></svg>`
  )
}

/** Le cache froid : un flocon au trait, six branches et leurs pointes. */
export function svgFlocon(couleur: string): string {
  const point = (angle: number, rayon: number) => `${(7 + rayon * Math.sin(angle)).toFixed(2)} ${(7 - rayon * Math.cos(angle)).toFixed(2)}`
  const branches = [0, 1, 2, 3, 4, 5].map(i => {
    const a = (i * Math.PI) / 3
    return `M7 7L${point(a, 6)}M${point(a - 0.5, 4.6)}L${point(a, 3.6)}L${point(a + 0.5, 4.6)}`
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="${couleur}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${branches.join('')}"/></svg>`
  )
}

/** La barre de la carte du cache : la part de sa durée qui lui reste, sur un rail discret. */
export function svgBarreCache(part: number, couleur: string, largeur: number): string {
  const plein = Math.max(0, Math.min(1, part)) * largeur
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} 4" width="${largeur}" height="4">` +
    `<rect width="${largeur}" height="4" rx="2" fill="${ENCRE.vide}" fill-opacity=".12"/>` +
    (plein > 0 ? `<rect width="${Math.max(4, plein).toFixed(1)}" height="4" rx="2" fill="${couleur}"/>` : '') +
    '</svg>'
  )
}

/** L'icône d'aide des réglages : un i dans un cercle, au trait fin. */
export function svgInfo(couleur: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="${couleur}" stroke-width="1.3" stroke-linecap="round">` +
    `<circle cx="8" cy="8" r="6.3"/><path d="M8 7.3v3.9"/><circle cx="8" cy="4.9" r=".3" fill="${couleur}"/></svg>`
  )
}
