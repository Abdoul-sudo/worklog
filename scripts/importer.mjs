// Importe l'historique de Claude Code dans le journal du mod, rangé par jour et par session :
// - les tokens de chaque réponse, sous-agents compris, une seule fois chacune ;
// - le temps des tours lancés par une personne : son message, puis les réponses de Claude jusqu'au message suivant.
//   Un message automatique (notification, autre session, plugin) clôt le tour : un agent qui tourne seul ne compte pas.
// Le mod le lance en tâche de fond ; il ne relit que la partie nouvelle de chaque conversation.
//
//   node importer.mjs <dossier projects> <dossier de sortie> <motif des ID>
import fs from 'node:fs'
import path from 'node:path'

const [projets, sortie, motif] = process.argv.slice(2)
const VERSION = 3
const MINUTE = 60_000
const VERROU_MS = 15 * MINUTE
const JOUR = 24 * 60 * MINUTE
// Une réponse revue dans une conversation reprise est reconnue pendant 90 jours ; au-delà, son numéro est oublié.
const MEMOIRE_JOURS = 90

const fichierEtat = path.join(sortie, 'etat.json')
const fichierVerrou = path.join(sortie, 'verrou')
const fichierFait = path.join(sortie, 'fait.json')
fs.mkdirSync(sortie, { recursive: true })

// Une seule importation à la fois, même si plusieurs sessions la lancent.
try {
  if (Date.now() - fs.statSync(fichierVerrou).mtimeMs < VERROU_MS) process.exit(0)
} catch {}
fs.writeFileSync(fichierVerrou, String(process.pid))

const lireEtat = () => {
  try {
    const etat = JSON.parse(fs.readFileSync(fichierEtat, 'utf8'))
    if (etat.version === VERSION) return etat
  } catch {}
  return { version: VERSION, positions: {}, vus: {}, tours: {} }
}
const etat = lireEtat()
const vus = new Map(Object.entries(etat.vus))
const idDe = new RegExp(`(?<![A-Za-z0-9])(?:${motif})(?![A-Za-z0-9])`)

const deux = n => String(n).padStart(2, '0')
const jourDe = t => {
  const d = new Date(t)
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`
}

// Les sessions dont le tour en cours a été lancé par une personne.
const tours = new Set(Object.keys(etat.tours))

/** Le texte écrit d'un message : ses parties texte ; rien pour un résultat d'outil. */
function texteDe(contenu) {
  if (typeof contenu === 'string') return contenu
  if (!Array.isArray(contenu)) return ''
  return contenu.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n')
}

// Les événements à écrire, par fichier de sortie ; l'activité et les tokens sont réunis par session et par minute.
const sorties = new Map()
const minutes = new Map()
const ajouter = (t, s, ev) => {
  const fichier = path.join(sortie, jourDe(t), `${s}.jsonl`)
  if (!sorties.has(fichier)) sorties.set(fichier, [])
  sorties.get(fichier).push(JSON.stringify(ev))
}

/** Un message écrit par une personne : tapé, une commande slash, une interruption. */
function estHumain(ev, texte) {
  if (ev.origin !== undefined) return ev.origin?.kind === 'human'
  return ev.isMeta !== true && (texte.startsWith('<command-name>') || texte.startsWith('[Request interrupted by user'))
}

function lire(ligne, sousAgent) {
  if (!ligne.includes('"sessionId"')) return
  let ev
  try {
    ev = JSON.parse(ligne)
  } catch {
    return
  }
  const t = Date.parse(ev.timestamp)
  const s = ev.sessionId
  if (!(t > 0) || typeof s !== 'string') return
  const d = typeof ev.cwd === 'string' && ev.cwd !== '' ? path.basename(ev.cwd) : undefined
  const u = ev.message?.usage
  if (ev.type === 'assistant' && u) {
    const id = ev.message.id ?? ev.uuid
    if (id === undefined || vus.has(id)) return
    vus.set(id, Math.floor(t / JOUR))
    const n = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    const cle = `${s}|${Math.floor(t / MINUTE)}`
    const minute = minutes.get(cle) ?? { t, s, d, n: 0, actif: false }
    minute.n += n
    minute.actif ||= !sousAgent && tours.has(s)
    minutes.set(cle, minute)
    return
  }
  if (ev.type === 'user' && !sousAgent && ev.isSidechain !== true) {
    const contenu = ev.message?.content
    if (Array.isArray(contenu) && contenu.some(p => p?.type === 'tool_result')) return
    const texte = texteDe(contenu).trim()
    if (texte === '') return
    if (estHumain(ev, texte)) {
      tours.add(s)
      ajouter(t, s, { t, s, e: 'message', k: idDe.exec(texte)?.[0] ?? null, ...(d === undefined ? {} : { d }), i: 1 })
    } else if (ev.isMeta !== true) tours.delete(s)
  }
}

/** Lit un fichier à partir de `debut` et rend la position après la dernière ligne complète. */
async function lireDepuis(fichier, debut) {
  const sousAgent = fichier.split(path.sep).includes('subagents')
  let position = debut
  let reste = Buffer.alloc(0)
  for await (const morceau of fs.createReadStream(fichier, { start: debut })) {
    const tampon = reste.length > 0 ? Buffer.concat([reste, morceau]) : morceau
    let depart = 0
    for (let i = tampon.indexOf(10); i !== -1; i = tampon.indexOf(10, depart)) {
      lire(tampon.toString('utf8', depart, i), sousAgent)
      position += i + 1 - depart
      depart = i + 1
    }
    reste = tampon.subarray(depart)
  }
  return position
}

const fichiers = []
const parcourir = dossier => {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name)
    if (entree.isDirectory()) parcourir(chemin)
    else if (entree.name.endsWith('.jsonl')) fichiers.push(chemin)
  }
}

try {
  parcourir(projets)
  for (const fichier of fichiers) {
    const cle = path.relative(projets, fichier)
    const avant = etat.positions[cle] ?? 0
    const taille = fs.statSync(fichier).size
    // Un fichier plus court qu'avant a été réécrit : il est relu en entier, les réponses déjà vues restent comptées une fois.
    const debut = taille < avant ? 0 : avant
    if (taille === debut) continue
    etat.positions[cle] = await lireDepuis(fichier, debut)
  }
  for (const { t, s, d, n, actif } of minutes.values()) {
    const defaut = d === undefined ? {} : { d }
    if (actif) ajouter(t, s, { t, s, e: 'reponse', k: null, ...defaut, i: 1 })
    ajouter(t, s, { t, s, e: 'jetons', n, k: null, ...defaut, i: 1 })
  }
  for (const [fichier, lignes] of sorties) {
    fs.mkdirSync(path.dirname(fichier), { recursive: true })
    fs.appendFileSync(fichier, `${lignes.join('\n')}\n`)
  }
  const oubli = Math.floor(Date.now() / JOUR) - MEMOIRE_JOURS
  etat.vus = Object.fromEntries([...vus].filter(([, jour]) => jour >= oubli))
  etat.tours = Object.fromEntries([...tours].map(s => [s, 1]))
  fs.writeFileSync(`${fichierEtat}.tmp`, JSON.stringify(etat))
  fs.renameSync(`${fichierEtat}.tmp`, fichierEtat)
  // Le mod lit ce petit fichier : les tokens qu'il a notés lui-même avant cette heure sont déjà dans l'historique.
  fs.writeFileSync(fichierFait, JSON.stringify({ fin: Date.now() }))
} finally {
  fs.rmSync(fichierVerrou, { force: true })
}
