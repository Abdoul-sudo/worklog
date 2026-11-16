// Importe l'historique de Claude Code dans le journal du mod, rangé par jour et par session :
// - les tokens de chaque réponse, sous-agents compris, une seule fois chacune, avec leur détail par modèle (lus, écrits
//   en cache, relus du cache, générés) : le mod en tire leur prix API ;
// - le temps des tours lancés par une personne : son message, puis les réponses de Claude jusqu'au message suivant.
//   Un message automatique (notification, autre session, plugin) clôt le tour : un agent qui tourne seul ne compte pas.
// Le mod le lance en tâche de fond ; il ne relit que la partie nouvelle de chaque conversation.
//
//   node importer.mjs <dossier projects> <dossier de sortie> <motif des ID>
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const [projets, sortie, motif] = process.argv.slice(2)
const VERSION = 3
const MINUTE = 60_000
const VERROU_MS = 15 * MINUTE
const JOUR = 24 * 60 * MINUTE
// Une réponse revue dans une conversation reprise est reconnue pendant 90 jours ; au-delà, son numéro est oublié.
// La version du rattrapage des détails (ajouterDetails) : la monter le relance une fois. Il ne touche qu'aux lignes encore
// sans détail.
const DETAILS = 3
const MEMOIRE_JOURS = 90

const fichierEtat = path.join(sortie, 'etat.json')
const fichierVerrou = path.join(sortie, 'verrou')
const fichierFait = path.join(sortie, 'fait.json')
fs.mkdirSync(sortie, { recursive: true })

// Une seule importation à la fois, même si plusieurs sessions la lancent au même instant : le verrou se crée d'un seul
// geste, et un verrou trop vieux (une importation morte) se remplace.
const creerVerrou = () => {
  try {
    fs.writeFileSync(fichierVerrou, String(process.pid), { flag: 'wx' })
    return true
  } catch (erreur) {
    if (erreur.code !== 'EEXIST') throw erreur
    return false
  }
}
if (!creerVerrou()) {
  let vieux = false
  try {
    vieux = Date.now() - fs.statSync(fichierVerrou).mtimeMs >= VERROU_MS
  } catch {}
  if (!vieux) process.exit(0)
  fs.rmSync(fichierVerrou, { force: true })
  if (!creerVerrou()) process.exit(0)
}

const lireEtat = () => {
  try {
    const etat = JSON.parse(fs.readFileSync(fichierEtat, 'utf8'))
    if (etat.version === VERSION) return etat
  } catch {}
  return { version: VERSION, positions: {}, vus: {}, tours: {}, dossiers: {}, nomsCorriges: true, details: DETAILS, copiesRetirees: true }
}
const etat = lireEtat()
// Le nom de chaque session : le dossier où elle a démarré. Claude se déplace parfois dans un sous-dossier du projet
// (un `cd`), et ses agents aussi : ce sous-dossier ne nomme pas la session.
etat.dossiers ??= {}
const vus = new Map(Object.entries(etat.vus))
const idDe = new RegExp(`(?<![A-Za-z0-9])(?:${motif})(?![A-Za-z0-9])`)

const deux = n => String(n).padStart(2, '0')
const jourDe = t => {
  const d = new Date(t)
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`
}

// Les sessions dont le tour en cours a été lancé par une personne.
const tours = new Set(Object.keys(etat.tours))

/** Le dossier du projet d'un chemin : celui d'avant `.claude/worktrees/` pour un worktree de Claude Code. */
function dossierDuProjet(cwd) {
  const parties = cwd.split(/[\\/]+/).filter(p => p !== '')
  const i = parties.findIndex((p, j) => p === '.claude' && parties[j + 1] === 'worktrees')
  return i > 0 ? parties[i - 1] : parties.at(-1)
}

/** Le nom de la session `s` : son dossier de départ, sinon le dossier de l'événement lu. */
const nomDe = (s, cwd) => etat.dossiers[s] ?? (typeof cwd === 'string' && cwd !== '' ? dossierDuProjet(cwd) : undefined)

/** Le texte écrit d'un message : ses parties texte ; rien pour un résultat d'outil. */
function texteDe(contenu) {
  if (typeof contenu === 'string') return contenu
  if (!Array.isArray(contenu)) return ''
  return contenu.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n')
}

// Les événements à écrire, par fichier de sortie ; l'activité et les tokens sont réunis par session et par minute.
const sorties = new Map()
const minutes = new Map()
// Les messages lus : leur nom se décide à la fin, quand le dossier de départ de chaque session est connu.
const messages = []
// Les ID des messages qu'une conversation reprise a recopiés : ils nomment la reprise, sans temps.
const reperes = []
const ajouter = (t, s, ev) => {
  const fichier = path.join(sortie, jourDe(t), `${s}.jsonl`)
  if (!sorties.has(fichier)) sorties.set(fichier, [])
  sorties.get(fichier).push(JSON.stringify(ev))
}

/** Tous les tokens d'une réponse. */
const jetonsDe = u => (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)

/** Ajoute une réponse au détail de sa minute, par modèle : de quoi calculer son prix API. Sans le partage du cache entre
 * 5 min et 1 h, tout le cache écrit compte pour 5 min. */
function ajouterDetail(details, message) {
  const u = message.usage
  const rapide = u.speed === 'fast'
  const us = u.inference_geo === 'us'
  const cle = `${message.model}|${rapide}|${us}`
  const d = details.get(cle) ?? { m: message.model ?? '', in: 0, out: 0, c5: 0, c1: 0, cr: 0, web: 0, rapide, us }
  d.in += u.input_tokens ?? 0
  d.out += u.output_tokens ?? 0
  d.c5 += u.cache_creation === undefined ? (u.cache_creation_input_tokens ?? 0) : (u.cache_creation.ephemeral_5m_input_tokens ?? 0)
  d.c1 += u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  d.cr += u.cache_read_input_tokens ?? 0
  d.web += u.server_tool_use?.web_search_requests ?? 0
  details.set(cle, d)
}

/** Le détail d'une minute, tel que le journal le garde (`p`) ; `part` le partage entre plusieurs lignes de la minute. */
const detailsEcrits = (details, part = 1) =>
  [...details.values()].map(({ m, web, rapide, us, ...tokens }) => ({
    m,
    ...Object.fromEntries(Object.entries(tokens).map(([cle, n]) => [cle, n * part])),
    ...(web > 0 ? { web: web * part } : {}),
    ...(rapide ? { rapide: 1 } : {}),
    ...(us ? { us: 1 } : {}),
  }))

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
  // Le dossier de départ vient de la conversation elle-même : ses agents tournent souvent dans un sous-dossier.
  if (!sousAgent && etat.dossiers[s] === undefined && typeof ev.cwd === 'string' && ev.cwd !== '') etat.dossiers[s] = dossierDuProjet(ev.cwd)
  const cwd = ev.cwd
  const u = ev.message?.usage
  if (ev.type === 'assistant' && u) {
    const id = ev.message.id ?? ev.uuid
    if (id === undefined || vus.has(id)) return
    vus.set(id, Math.floor(t / JOUR))
    const cle = `${s}|${Math.floor(t / MINUTE)}`
    const minute = minutes.get(cle) ?? { t, s, cwd, n: 0, details: new Map(), actif: false }
    minute.n += jetonsDe(u)
    ajouterDetail(minute.details, ev.message)
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
      const k = idDe.exec(texte)?.[0] ?? null
      // Une conversation reprise par l'app recopie les messages déjà vus, sous le même uuid : chacun ne compte qu'une fois,
      // dans la conversation qui a aussi ses réponses. Recopié sans elles, il ouvrirait un tour sans fin. L'ID qu'il cite
      // reste à la reprise, en repère : elle garde son nom.
      if (ev.uuid !== undefined && vus.has(ev.uuid)) {
        if (k !== null) reperes.push({ t, s, cwd, k })
        return
      }
      if (ev.uuid !== undefined) vus.set(ev.uuid, Math.floor(t / JOUR))
      tours.add(s)
      messages.push({ t, s, cwd, k })
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

/** Le dossier de départ de chaque conversation encore là : la première ligne qui en donne un. */
async function connaitreDossiers() {
  for (const fichier of fichiers) {
    if (fichier.split(path.sep).includes('subagents')) continue
    for await (const ligne of readline.createInterface({ input: fs.createReadStream(fichier) })) {
      if (!ligne.includes('"cwd"') || !ligne.includes('"sessionId"')) continue
      try {
        const ev = JSON.parse(ligne)
        if (typeof ev.sessionId === 'string' && typeof ev.cwd === 'string' && ev.cwd !== '') etat.dossiers[ev.sessionId] ??= dossierDuProjet(ev.cwd)
      } catch {}
      break
    }
  }
}

/** Réécrit le nom (`d`) des événements déjà importés selon le dossier de départ de leur session. */
function corrigerNoms() {
  for (const jour of fs.readdirSync(sortie, { withFileTypes: true })) {
    if (!jour.isDirectory()) continue
    for (const nom of fs.readdirSync(path.join(sortie, jour.name))) {
      if (!nom.endsWith('.jsonl')) continue
      const fichier = path.join(sortie, jour.name, nom)
      let change = false
      const lignes = fs.readFileSync(fichier, 'utf8').split('\n').map(ligne => {
        try {
          const ev = JSON.parse(ligne)
          const d = etat.dossiers[ev.s]
          if (d === undefined || ev.d === d) return ligne
          change = true
          return JSON.stringify({ ...ev, d })
        } catch {
          return ligne
        }
      })
      if (change) fs.writeFileSync(fichier, lignes.join('\n'))
    }
  }
}

/** Une fois : les tokens importés par une version passée reçoivent le détail de leurs réponses, relu dans les
 * conversations encore là. Rien n'est effacé : les tokens d'une conversation que Claude Code a supprimée restent, sans
 * prix. Quand une minute a plusieurs lignes, chacune reçoit sa part du détail. */
async function ajouterDetails() {
  const jsonl = []
  for (const jour of fs.readdirSync(sortie, { withFileTypes: true })) {
    if (!jour.isDirectory()) continue
    for (const nom of fs.readdirSync(path.join(sortie, jour.name))) if (nom.endsWith('.jsonl')) jsonl.push(path.join(sortie, jour.name, nom))
  }
  const minuteDe = ev => `${ev.s}|${Math.floor(ev.t / MINUTE)}`
  const importees = new Set()
  for (const fichier of jsonl) {
    for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
      try {
        const ev = JSON.parse(ligne)
        if (ev.e === 'jetons') importees.add(minuteDe(ev))
      } catch {}
    }
  }
  // Une conversation reprise recopie des réponses déjà vues : chacune va à la minute où l'import l'a comptée.
  const reponses = new Map()
  for (const fichier of fichiers) {
    for await (const texte of readline.createInterface({ input: fs.createReadStream(fichier) })) {
      if (!texte.includes('"usage"') || !texte.includes('"sessionId"')) continue
      let ev
      try {
        ev = JSON.parse(texte)
      } catch {
        continue
      }
      const t = Date.parse(ev.timestamp)
      const id = ev.message?.id ?? ev.uuid
      if (ev.type !== 'assistant' || !ev.message?.usage || !(t > 0) || typeof ev.sessionId !== 'string' || id === undefined) continue
      const cle = minuteDe({ s: ev.sessionId, t })
      const vue = reponses.get(id)
      if (vue === undefined || (!importees.has(vue.cle) && importees.has(cle))) reponses.set(id, { cle, message: { model: ev.message.model, usage: ev.message.usage } })
    }
  }
  const parMinute = new Map()
  for (const { cle, message } of reponses.values()) {
    const minute = parMinute.get(cle) ?? { n: 0, details: new Map() }
    minute.n += jetonsDe(message.usage)
    ajouterDetail(minute.details, message)
    parMinute.set(cle, minute)
  }
  for (const fichier of jsonl) {
    let change = false
    const lignes = fs.readFileSync(fichier, 'utf8').split('\n').map(ligne => {
      try {
        const ev = JSON.parse(ligne)
        const minute = ev.e === 'jetons' && ev.p === undefined ? parMinute.get(minuteDe(ev)) : undefined
        if (minute === undefined || minute.n === 0) return ligne
        change = true
        return JSON.stringify({ ...ev, p: detailsEcrits(minute.details, ev.n / minute.n) })
      } catch {
        return ligne
      }
    })
    if (change) fs.writeFileSync(fichier, lignes.join('\n'))
  }
}

/** Une fois : les messages qu'une version passée importait en double dans une copie de la conversation (reprise par
 * l'app), sans leurs réponses, sont retirés ; l'ID qu'ils citent y reste en repère. Un message présent dans plusieurs
 * sessions à la même milliseconde reste dans celle qui a les tokens de sa réponse, sinon dans celle qui a le plus de
 * tokens. */
function retirerCopies() {
  const lus = []
  for (const jour of fs.readdirSync(sortie, { withFileTypes: true })) {
    if (!jour.isDirectory()) continue
    for (const nom of fs.readdirSync(path.join(sortie, jour.name))) {
      if (!nom.endsWith('.jsonl')) continue
      const fichier = path.join(sortie, jour.name, nom)
      lus.push({ fichier, lignes: fs.readFileSync(fichier, 'utf8').split('\n') })
    }
  }
  const analyser = ligne => {
    try {
      return JSON.parse(ligne)
    } catch {
      return null
    }
  }
  const sessionsParT = new Map()
  const jetonsParSession = new Map()
  for (const { lignes } of lus) {
    for (const ev of lignes.map(analyser)) {
      if (ev?.e === 'message' && ev.i === 1) sessionsParT.set(ev.t, new Set([...(sessionsParT.get(ev.t) ?? []), ev.s]))
      if (ev?.e === 'jetons') jetonsParSession.set(ev.s, [...(jetonsParSession.get(ev.s) ?? []), ev.t])
    }
  }
  const garder = new Map()
  for (const [t, sessions] of sessionsParT) {
    if (sessions.size < 2) continue
    const liste = [...sessions].sort()
    const avecReponse = liste.find(s => (jetonsParSession.get(s) ?? []).some(x => x >= t && x <= t + 10 * MINUTE))
    garder.set(t, avecReponse ?? liste.reduce((a, b) => ((jetonsParSession.get(b)?.length ?? 0) > (jetonsParSession.get(a)?.length ?? 0) ? b : a)))
  }
  for (const { fichier, lignes } of lus) {
    let change = false
    // Un message en double quitte la copie ; l'ID qu'il cite y reste en repère : la reprise garde son nom.
    const restent = lignes.flatMap(ligne => {
      const ev = analyser(ligne)
      if (!(ev?.e === 'message' && ev.i === 1 && garder.has(ev.t) && garder.get(ev.t) !== ev.s)) return [ligne]
      change = true
      return ev.k === null ? [] : [JSON.stringify({ ...ev, e: 'repere' })]
    })
    if (change) fs.writeFileSync(fichier, restent.join('\n'))
  }
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
  for (const { t, s, cwd, k } of messages) {
    const d = nomDe(s, cwd)
    ajouter(t, s, { t, s, e: 'message', k, ...(d === undefined ? {} : { d }), i: 1 })
  }
  for (const { t, s, cwd, k } of reperes) {
    const d = nomDe(s, cwd)
    ajouter(t, s, { t, s, e: 'repere', k, ...(d === undefined ? {} : { d }), i: 1 })
  }
  for (const { t, s, cwd, n, details, actif } of minutes.values()) {
    const d = nomDe(s, cwd)
    const defaut = d === undefined ? {} : { d }
    if (actif) ajouter(t, s, { t, s, e: 'reponse', k: null, ...defaut, i: 1 })
    ajouter(t, s, { t, s, e: 'jetons', n, k: null, ...defaut, i: 1, p: detailsEcrits(details) })
  }
  for (const [fichier, lignes] of sorties) {
    fs.mkdirSync(path.dirname(fichier), { recursive: true })
    fs.appendFileSync(fichier, `${lignes.join('\n')}\n`)
  }
  // Une fois : les noms déjà importés prennent le dossier de départ de leur session, quand sa conversation existe encore.
  if (etat.nomsCorriges !== true) {
    await connaitreDossiers()
    corrigerNoms()
    etat.nomsCorriges = true
  }
  // Une fois : les tokens déjà importés reçoivent le détail de leurs réponses, pour leur prix API.
  if (etat.details !== DETAILS) {
    await ajouterDetails()
    etat.details = DETAILS
  }
  // Une fois : les messages importés en double dans une copie de la conversation sont retirés.
  if (etat.copiesRetirees !== true) {
    retirerCopies()
    etat.copiesRetirees = true
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
