import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Apercu, Ecart } from '../types'
import {
  type Activite,
  type Choix,
  type Evenement,
  REGLAGES_PAR_DEFAUT,
  type Reglages,
  SANS_TICKET,
  bilan,
  cleJour,
  debutJour,
  decalerJours,
  dernierEvenement,
  detecterTicket,
  dureeEcart,
  estUnTicket,
  formatDuree,
  formatHeure,
  formatJour,
  jourSuivant,
  ligneStatut,
  lireLignes,
  lireReglages,
  motifsDuProjet,
} from './calcul'
import { aide, listeEcarts, recapJour, recapSemaine } from './texte'

type Moteur = EngineInterface

const PANNEAU = 'temps-ticket'
const TITRE = 'Temps par ticket'
const RAFRAICHISSEMENT_MS = 30_000
// Les tours qui partent seuls (tâche planifiée, observateur) ne comptent pas.
const AUTOMATIQUES = ['scheduled-trigger', 'observer', 'observer-activity']
// L'ID du ticket se cherche dans ce qu'une personne a écrit, ou dans le brief d'une session lancée par une autre.
const ECRITS = ['composer', 'bridge', 'sdk', 'slack-ping', 'coordinator', 'projects-relay']

const apercu = atom({ plugin: 'temps-ticket', key: 'apercu' } as const, null, { shape: 'apercu-1' })
const question = atom({ plugin: 'temps-ticket', key: 'question' } as const, null, { shape: 'question-1' })
const saisie = atom({ plugin: 'temps-ticket', key: 'saisie' } as const, false)

let chemins: { reglages: string; journal: string } | null = null
let ecritures: Promise<unknown> = Promise.resolve()
let tourCompte = true
let ticketApresClear: string | null = null
let panneauOuvert = false
let erreurSignalee = false

/** Travail lancé sans l'attendre : une erreur (session fermée, module rechargé) ne casse rien. */
const enFond = (travail: Promise<unknown>) => void travail.catch(() => undefined)

async function dossiers($: Moteur) {
  if (chemins === null) {
    const maison = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    const config = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${maison}/.claude`).replace(/\\/g, '/')
    chemins = { reglages: `${config}/temps.json`, journal: `${config}/temps/journal` }
  }
  return chemins
}

async function chargerReglages($: Moteur): Promise<Reglages> {
  const { reglages: fichier } = await dossiers($)
  const texte = (await $.fs.exists(fichier)) ? await $.fs.read(fichier) : undefined
  const { reglages, erreur } = lireReglages(texte)
  if (erreur !== undefined && !erreurSignalee) {
    erreurSignalee = true
    $.ui.toast(`Temps par ticket : réglages ignorés, ${erreur} (${fichier}).`)
  }
  return reglages
}

/** Ajoute un événement au journal du jour de sa session. Les écritures passent une par une. */
function noter($: Moteur, ev: Evenement): Promise<void> {
  const ecriture = ecritures.then(async () => {
    const { journal } = await dossiers($)
    const fichier = `${journal}/${cleJour(ev.t)}/${ev.s}.jsonl`
    const avant = (await $.fs.exists(fichier)) ? await $.fs.read(fichier) : ''
    await $.fs.write(fichier, `${avant}${JSON.stringify(ev)}\n`)
  })
  ecritures = ecriture.catch(() => undefined)
  return ecriture
}

/** Signe de vie de la session : la date du fichier `.vivant`, réécrit à chaque rafraîchissement. */
async function donnerSigneDeVie($: Moteur): Promise<void> {
  const { journal } = await dossiers($)
  await $.fs.write(`${journal}/${cleJour(await $.clock.now())}/${await $.session.id()}.vivant`, '')
}

/** Les événements des jours [debut, fin[ et le dernier signe de vie de chaque session. */
async function lireJournal($: Moteur, debut: number, fin: number) {
  const { journal } = await dossiers($)
  const evenements: Evenement[] = []
  const vivants = new Map<string, number>()
  for (let jour = debut; jour < fin; jour = jourSuivant(jour)) {
    const dossier = `${journal}/${cleJour(jour)}`
    const fichiers = (await $.fs.exists(dossier)) ? await $.fs.list(dossier) : []
    for (const { name, mtimeMs } of fichiers) {
      if (name.endsWith('.jsonl')) evenements.push(...lireLignes(await $.fs.read(`${dossier}/${name}`)))
      if (name.endsWith('.vivant')) {
        const session = name.slice(0, -'.vivant'.length)
        vivants.set(session, Math.max(vivants.get(session) ?? 0, mtimeMs))
      }
    }
  }
  return { evenements, vivants }
}

async function ticketDe($: Moteur, session: string): Promise<string | null> {
  const enregistre = await $.store.get(`ticket:${session}`)
  if (typeof enregistre === 'string') return enregistre
  if (ticketApresClear === null) return null
  // Après /clear, la nouvelle session garde le ticket de l'ancienne.
  const herite = ticketApresClear
  ticketApresClear = null
  await $.store.set(`ticket:${session}`, herite)
  return herite
}

async function noterActivite($: Moteur, e: Activite): Promise<number> {
  const s = await $.session.id()
  const t = await $.clock.now()
  await noter($, { t, s, e, k: await ticketDe($, s) })
  return t
}

async function changerTicket($: Moteur, ticket: string): Promise<void> {
  await $.store.set(`ticket:${await $.session.id()}`, ticket)
  await noterActivite($, 'ticket')
  await rafraichir($)
}

async function classer($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  const t = await $.clock.now()
  await noter($, { t, s: await $.session.id(), e: 'classement', session: ecart.session, debut: ecart.debut, choix })
}

/** Recalcule la journée : ligne de statut, panneau et bandeau. */
async function rafraichir($: Moteur): Promise<Apercu> {
  const maintenant = await $.clock.now()
  const session = await $.session.id()
  const reglages = await chargerReglages($)
  const jour = debutJour(maintenant)
  await donnerSigneDeVie($)
  const { evenements, vivants } = await lireJournal($, decalerJours(jour, -1), jourSuivant(jour))
  const b = bilan(evenements, reglages, maintenant, jour, jourSuivant(jour), vivants)
  const ticket = (await ticketDe($, session)) ?? SANS_TICKET
  const enPause = dernierEvenement(evenements, session)?.e === 'pause'
  const lignes = b.jours[0]?.lignes ?? []
  const vu: Apercu = { jour, lignes, total: b.jours[0]?.total ?? 0, ticket, enPause, ecarts: b.ecarts }
  $.ui.status(ligneStatut(reglages.format, ticket, lignes.find(l => l.ticket === ticket)?.minutes ?? 0, enPause))
  await update($, apercu, () => vu)

  if (!panneauOuvert && (await $.session.surfaces()).some(s => s === 'desktop' || s === 'vscode')) {
    panneauOuvert = true
    enFond($.ui.open({ id: PANNEAU, title: TITRE }))
  }
  return vu
}

async function apresMessage($: Moteur, texte: string, chercherTicket: boolean): Promise<void> {
  const session = await $.session.id()
  if (chercherTicket) {
    const motifs = motifsDuProjet(await chargerReglages($), await $.session.cwd())
    const trouve = detecterTicket(texte, motifs)
    if (trouve !== null && trouve !== (await ticketDe($, session))) {
      await $.store.set(`ticket:${session}`, trouve)
      $.ui.toast(`Temps compté pour ${trouve}`)
    }
  }
  const t = await noterActivite($, 'message')
  const vu = await rafraichir($)
  const ecart = vu.ecarts.find(x => x.session === session && x.fin === t) ?? null
  await update($, question, () => ecart)
  if (ecart !== null) $.ui.toast(`Écart de ${dureeEcart(ecart)} sur ${ecart.ticket} : pause ou travail ?`)
}

async function repondre($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  await classer($, ecart, choix)
  await update($, question, x => (x?.session === ecart.session && x.debut === ecart.debut ? null : x))
  await rafraichir($)
  $.ui.toast(`Écart de ${dureeEcart(ecart)} compté comme ${choix}.`)
}

async function commande($: Moteur, args: string): Promise<string> {
  const mots = args.split(/\s+/).filter(Boolean)
  const reglages = await chargerReglages($)
  const maintenant = await $.clock.now()
  const jour = debutJour(maintenant)
  const semaine = decalerJours(jour, -6)
  const surSemaine = async () => {
    const { evenements, vivants } = await lireJournal($, decalerJours(semaine, -1), jourSuivant(jour))
    return bilan(evenements, reglages, maintenant, semaine, jourSuivant(jour), vivants)
  }

  switch (mots[0]?.toLowerCase()) {
    case undefined: {
      const b = await surSemaine()
      return recapJour(jour, { ...b, jours: b.jours.filter(j => j.debut === jour) }, b.ecarts)
    }
    case 'semaine': {
      const b = await surSemaine()
      return recapSemaine(b, b.ecarts)
    }
    case 'stop':
    case 'pause':
      await noterActivite($, 'pause')
      await rafraichir($)
      return 'Compteur en pause pour cette session. Il repart à votre prochain message.'
    case 'confirmer':
      return confirmer($, mots.slice(1), (await surSemaine()).ecarts)
    case 'panneau':
      await $.ui.open({ id: PANNEAU, title: TITRE })
      return 'Panneau ouvert.'
    case 'aide':
      return aide((await dossiers($)).reglages)
  }
  const motifs = motifsDuProjet(reglages, await $.session.cwd())
  if (mots.length === 1 && estUnTicket(mots[0]!, motifs)) {
    await changerTicket($, mots[0]!)
    return `Ticket de cette session : ${mots[0]}. Le temps compte pour ce ticket à partir de maintenant.`
  }
  return `« ${args} » n'est ni une commande ni un ID de ticket reconnu.\n\n${aide((await dossiers($)).reglages)}`
}

async function confirmer($: Moteur, mots: string[], ecarts: Ecart[]): Promise<string> {
  if (mots.length === 0) return listeEcarts(ecarts).join('\n')
  const choix = mots.at(-1)?.toLowerCase()
  const cibles = mots.slice(0, -1)
  const numeros = cibles.map(Number)
  const valides = numeros.every(n => Number.isInteger(n) && n >= 1 && n <= ecarts.length)
  if ((choix !== 'travail' && choix !== 'pause') || cibles.length === 0 || (cibles[0] !== 'tout' && !valides)) {
    return ['Je ne comprends pas. Exemple : /temps confirmer 1 travail', '', ...listeEcarts(ecarts)].join('\n')
  }
  const choisis = cibles[0] === 'tout' ? ecarts : [...new Set(numeros)].map(n => ecarts[n - 1]!)
  for (const ecart of choisis) await classer($, ecart, choix)
  await update($, question, () => null)
  await rafraichir($)
  const s = choisis.length > 1 ? 's' : ''
  return `${choisis.length} écart${s} classé${s} comme ${choix}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'temps',
      description: 'Temps par ticket : récapitulatif, ticket, pause, écarts à confirmer',
      argumentHint: '[semaine | <ticket> | stop | confirmer | panneau | aide]',
      immediate: true,
    })
    const { reglages } = await dossiers($)
    if (!(await $.fs.exists(reglages))) await $.fs.write(reglages, `${JSON.stringify(REGLAGES_PAR_DEFAUT, null, 2)}\n`)
    await noterActivite($, 'ouverture')
    enFond(rafraichir($))
    $.clock.every(RAFRAICHISSEMENT_MS, () => enFond(rafraichir($)))
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (e.command?.name === 'temps') return next(e)
    tourCompte = !AUTOMATIQUES.includes(e.origin.kind)
    if (tourCompte) enFond(apresMessage($, e.text, e.isMeta !== true && ECRITS.includes(e.origin.kind)))
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && tourCompte) enFond(noterActivite($, 'reponse').then(() => rafraichir($)))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const ticket = await ticketDe($, e.sessionId)
    if (e.reason === 'clear') ticketApresClear = ticket
    await noter($, { t: await $.clock.now(), s: e.sessionId, e: 'fermeture', k: ticket })
    return next(e)
  })

  on('command.run', { command: 'temps' }, async ($, e) => ({ text: await commande($, e.args.trim()) }))

  on('ui.render', { component: 'Pane', requestId: PANNEAU }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const vu = await read($, apercu)
    if (vu === null) return <Text dimColor>Calcul en cours…</Text>
    const enSaisie = await read($, saisie)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Aujourd'hui, {formatJour(vu.jour)}</Text>
          {vu.lignes.length === 0 && <Text dimColor>Aucun temps compté.</Text>}
          {vu.lignes.map(l => (
            <Text>
              {l.enCours ? '● ' : '   '}
              {l.ticket} : {formatDuree(l.minutes)}
            </Text>
          ))}
          {vu.lignes.length > 0 && <Text bold>Total : {formatDuree(vu.total)}</Text>}
        </Box>
        <Box flexDirection="column">
          <Text>
            Cette session : {vu.ticket}
            {vu.enPause ? ' (en pause)' : ''}
          </Text>
          <Box flexDirection="row" gap={1}>
            {!vu.enPause && (
              <Button
                key="pause"
                label="Pause"
                onPress={async () => {
                  await noterActivite($, 'pause')
                  await rafraichir($)
                }}
              />
            )}
            <Button key="changer" label="Changer de ticket" onPress={() => update($, saisie, ouvert => !ouvert)} />
          </Box>
          {enSaisie && (
            <Input
              key="ticket"
              label="ID du ticket"
              placeholder="FLO-I165"
              submitLabel="Valider"
              onSubmit={async texte => {
                const ticket = texte.trim()
                const motifs = motifsDuProjet(await chargerReglages($), await $.session.cwd())
                if (!estUnTicket(ticket, motifs)) {
                  $.ui.toast(`« ${ticket} » n'est pas un ID de ticket reconnu.`)
                  return
                }
                await update($, saisie, () => false)
                await changerTicket($, ticket)
              }}
            />
          )}
        </Box>
        {vu.ecarts.length > 0 && (
          <Box flexDirection="column">
            <Text bold>À confirmer (non compté)</Text>
            {vu.ecarts.map(x => (
              <Box flexDirection="column">
                <Text>
                  {formatHeure(x.debut)} à {formatHeure(x.fin)}, {x.ticket} ({dureeEcart(x)})
                </Text>
                <Box flexDirection="row" gap={1}>
                  <Button key={`travail-${x.session}-${x.debut}`} label="Travail" onPress={() => repondre($, x, 'travail')} />
                  <Button key={`pause-${x.session}-${x.debut}`} label="Pause" onPress={() => repondre($, x, 'pause')} />
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ecart = await read($, question)
    if (ecart === null || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text>
            Écart de {dureeEcart(ecart)} sur {ecart.ticket} ({formatHeure(ecart.debut)} à {formatHeure(ecart.fin)}) : pause
            ou travail ?
          </Text>
          <Button key="ecart-travail" label="Travail" variant="primary" onPress={() => repondre($, ecart, 'travail')} />
          <Button key="ecart-pause" label="Pause" onPress={() => repondre($, ecart, 'pause')} />
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
