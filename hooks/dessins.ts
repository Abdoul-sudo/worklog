// Les dessins du popover : ses thèmes (encres et fonds animés), chrono, pastilles, engrenage, interrupteur, icônes.
// Logique pure.
import { type Theme, SANS_ITEM } from './calcul'

/** Les encres d'un thème : le fond et le cadre du popover, ses textes, son accent, les cases vides de la frise. */
type Encres = {
  fond: string
  bord: string
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

/** Nuit : la trame de points sur le bleu nuit ; une lueur bleue glisse lentement. */
function cielNuit(): string {
  return (
    ouvrirCiel(
      '.g{animation:g 46s ease-in-out infinite alternate}@keyframes g{from{transform:translate(0,0)}to{transform:translate(520px,40px)}}',
      trame('#C9D4FF', 0.09) + lueur('h', '#6E8BFF', 0.1),
    ) +
    `<rect width="${CIEL.largeur}" height="${CIEL.hauteur}" fill="url(#p)"/>` +
    '<ellipse class="g" cx="260" cy="90" rx="460" ry="190" fill="url(#h)"/></svg>'
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

/** Forêt : une lueur verte respire en bas ; des lucioles s'allument et s'éteignent, chacune à son rythme. */
function cielForet(): string {
  const lucioles = [[90, 170], [210, 60], [340, 190], [480, 120], [610, 40], [760, 160], [900, 90], [1040, 200], [1180, 70], [1330, 140]]
    .map(([x, y], i) => {
      const duree = 4 + ((i * 3) % 5)
      return `<circle cx="${x}" cy="${y}" r="1.5" fill="#D9F99D" opacity="0" style="animation:l ${duree}s ease-in-out ${-((i * 1.7) % duree).toFixed(1)}s infinite"/>`
    })
    .join('')
  return (
    ouvrirCiel(
      '@keyframes l{0%,100%{opacity:0;transform:translate(0,0)}50%{opacity:.8;transform:translate(6px,-10px)}}' +
        '.r{animation:r 12s ease-in-out infinite alternate}@keyframes r{from{opacity:.6}to{opacity:1}}',
      lueur('v', '#3FA66B', 0.14) + trame('#CDEFD9', 0.04),
    ) +
    `<rect width="${CIEL.largeur}" height="${CIEL.hauteur}" fill="url(#p)"/>` +
    `<ellipse class="r" cx="260" cy="320" rx="640" ry="220" fill="url(#v)"/>${lucioles}</svg>`
  )
}

/** Océan : trois houles glissent lentement dans le bas de la carte, même courte ; une lueur bleue en haut. */
function cielOcean(): string {
  // Une houle : une onde de 400 unités de période, plus large que le ciel ; glisser d'une période la ramène à son départ.
  const houle = (y: number, amplitude: number, opacite: number, duree: number) =>
    `<path d="M-400 ${y}q100 ${-amplitude} 200 0${' t200 0'.repeat(11)}" fill="none" stroke="#7DD3FC" stroke-opacity="${opacite}" ` +
    `stroke-width="1.5" style="animation:h ${duree}s linear infinite"/>`
  return (
    ouvrirCiel('@keyframes h{from{transform:translateX(0)}to{transform:translateX(400px)}}', lueur('b', '#38BDF8', 0.1)) +
    '<ellipse cx="300" cy="20" rx="560" ry="160" fill="url(#b)"/>' +
    houle(150, 10, 0.13, 38) +
    houle(175, 14, 0.1, 52) +
    houle(200, 8, 0.07, 66) +
    '</svg>'
  )
}

/** Crépuscule : un voile violet en haut à droite, un voile rose en bas à gauche, qui se balancent lentement ; quelques
 * étoiles scintillent. */
function cielCrepuscule(): string {
  const etoiles = [[120, 40], [330, 75], [520, 30], [700, 95], [880, 55], [1060, 25], [1250, 80], [1420, 45]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1" fill="#EDE4FF" style="animation:e ${5 + (i % 4)}s ease-in-out ${-i}s infinite alternate"/>`)
    .join('')
  return (
    ouvrirCiel(
      '@keyframes e{from{opacity:.15}to{opacity:.7}}' +
        '.v{animation:v 40s ease-in-out infinite alternate}@keyframes v{from{transform:translate(0,0)}to{transform:translate(-260px,30px)}}',
      lueur('u', '#8B5CF6', 0.14) + lueur('o', '#EC4899', 0.08),
    ) +
    '<ellipse class="v" cx="900" cy="30" rx="560" ry="170" fill="url(#u)"/>' +
    `<ellipse cx="160" cy="330" rx="520" ry="170" fill="url(#o)"/>${etoiles}</svg>`
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
    encres: { fond: '#090D1A', bord: '#242E4D', texte: '#E6E9F2', vif: '#F7F8FC', gris: '#8A93B2', faible: '#5B6585', legende: '#6E7897', accent: ARGILE, vide: '#C9D4FF', ...BLANCS },
    ciel: cielNuit,
  },
  simple: {
    encres: { fond: SANS_FOND, bord: '#FFFFFF2E', texte: '#E4E4E4', vif: '#F5F5F5', gris: '#A3A3A3', faible: '#767676', legende: '#8C8C8C', accent: ARGILE, vide: '#FFFFFF', ...BLANCS },
    ciel: null,
  },
  aurore: {
    encres: { fond: '#040C12', bord: '#173241', texte: '#E2F1F2', vif: '#F4FBFB', gris: '#88A8B0', faible: '#587880', legende: '#6A8C94', accent: '#4FD1C5', vide: '#BFEFF0', ...BLANCS },
    ciel: cielAurore,
  },
  braise: {
    encres: { fond: '#140F0C', bord: '#3D2B21', texte: '#F2E8E1', vif: '#FBF6F2', gris: '#B39B8D', faible: '#7D6759', legende: '#8F786A', accent: ARGILE, vide: '#FFD9C2', ...BLANCS },
    ciel: cielBraise,
  },
  foret: {
    encres: { fond: '#07110C', bord: '#1E3A2B', texte: '#E3F0E8', vif: '#F5FBF7', gris: '#8FAE9C', faible: '#5C7A69', legende: '#6E8C7B', accent: '#6FCF97', vide: '#CDEFD9', ...BLANCS },
    ciel: cielForet,
  },
  ocean: {
    encres: { fond: '#06101C', bord: '#1B3550', texte: '#E3EEF7', vif: '#F5FAFD', gris: '#8BA6BF', faible: '#5A7590', legende: '#6C87A2', accent: '#5AB4F5', vide: '#CFE6FA', ...BLANCS },
    ciel: cielOcean,
  },
  crepuscule: {
    encres: { fond: '#0E0A18', bord: '#2E2547', texte: '#ECE8F5', vif: '#FAF8FD', gris: '#A398BD', faible: '#6C6287', legende: '#7F7499', accent: '#B794F6', vide: '#DCCFFB', ...BLANCS },
    ciel: cielCrepuscule,
  },
  sakura: {
    encres: { fond: '#140B10', bord: '#3D2333', texte: '#F5E9EF', vif: '#FDF7FA', gris: '#B898A8', faible: '#7D6170', legende: '#937483', accent: '#F49AC1', vide: '#FBD3E4', ...BLANCS },
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

/** Le fond du thème choisi, ou null s'il n'en a pas. */
export function svgCiel(): string | null {
  return THEMES[themeChoisi].ciel?.() ?? null
}

/** L'aperçu d'un thème dans les réglages : son fond, un titre, deux lignes, quatre cases de frise ; cerclé d'accent quand
 * il est choisi. */
export const APERCU = { largeur: 64, hauteur: 40 }
export function svgApercu(theme: Theme, choisi: boolean): string {
  const e = THEMES[theme].encres
  const fond = theme === 'simple' ? '#262626' : e.fond
  const decor = {
    nuit: [8, 20, 32, 44, 56].flatMap(x => [8, 20, 32].map(y => `<circle cx="${x}" cy="${y}" r=".6" fill="${e.vide}" fill-opacity=".35"/>`)).join('') +
      `<ellipse cx="20" cy="10" rx="28" ry="12" fill="#6E8BFF" fill-opacity=".1"/>`,
    simple: '',
    aurore: `<ellipse cx="18" cy="8" rx="30" ry="12" fill="#2DD4BF" fill-opacity=".15"/>`,
    braise: `<ellipse cx="22" cy="40" rx="40" ry="16" fill="${ARGILE}" fill-opacity=".18"/><circle cx="14" cy="22" r=".9" fill="#FFB38A"/><circle cx="34" cy="16" r=".7" fill="#FFB38A"/><circle cx="52" cy="26" r=".8" fill="#FFB38A"/>`,
    foret: `<ellipse cx="20" cy="40" rx="40" ry="16" fill="#3FA66B" fill-opacity=".2"/><circle cx="12" cy="30" r=".9" fill="#D9F99D"/><circle cx="33" cy="20" r=".8" fill="#D9F99D"/><circle cx="54" cy="34" r=".9" fill="#D9F99D"/>`,
    ocean: `<ellipse cx="20" cy="4" rx="34" ry="12" fill="#38BDF8" fill-opacity=".12"/><path d="M0 35q8-3 16 0t16 0 16 0 16 0" fill="none" stroke="#7DD3FC" stroke-opacity=".35"/>`,
    crepuscule: `<ellipse cx="50" cy="4" rx="30" ry="12" fill="#8B5CF6" fill-opacity=".2"/><ellipse cx="10" cy="40" rx="28" ry="12" fill="#EC4899" fill-opacity=".12"/>`,
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
