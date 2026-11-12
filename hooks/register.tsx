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
  ajouterRecent,
  barre,
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
type Site = Parameters<Moteur['ui']['resolve']>[0]

const PANNEAU = 'temps-ticket'
const TITRE = 'Temps par ticket'
const RAFRAICHISSEMENT_MS = 30_000
// Les tours qui partent seuls (tâche planifiée, observateur) ne comptent pas.
const AUTOMATIQUES = ['scheduled-trigger', 'observer', 'observer-activity']
// L'ID du ticket se cherche dans ce qu'une personne a écrit, ou dans le brief d'une session lancée par une autre.
const ECRITS = ['composer', 'bridge', 'sdk', 'slack-ping', 'coordinator', 'projects-relay']

const apercu = atom({ plugin: 'temps-ticket', key: 'apercu' } as const, null, { shape: 'apercu-2' })
const question = atom({ plugin: 'temps-ticket', key: 'question' } as const, null, { shape: 'question-1' })
const saisie = atom({ plugin: 'temps-ticket', key: 'saisie' } as const, false)
const deplie = atom({ plugin: 'temps-ticket', key: 'deplie' } as const, false)

let chemins: { reglages: string; journal: string } | null = null
let ecritures: Promise<unknown> = Promise.resolve()
let tourCompte = true
let ticketApresClear: string | null = null
let brancheVue: string | null = null
let erreurSignalee = false

/** Travail lancé sans l'attendre : une erreur (session fermée, module rechargé) ne casse rien. */
const enFond = (travail: Promise<unknown>) => void travail.catch(() => undefined)

const cleDossier = (cwd: string) => `dossier:${cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`

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

async function motifsIci($: Moteur): Promise<string[]> {
  return motifsDuProjet(await chargerReglages($), await $.session.cwd())
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

async function lireRecents($: Moteur): Promise<string[]> {
  const recents = await $.store.get('recents')
  return Array.isArray(recents) ? recents.filter((t): t is string => typeof t === 'string') : []
}

/** Fixe le ticket de la session et le retient pour les tickets récents et pour ce dossier. */
async function definirTicket($: Moteur, session: string, ticket: string, annonce?: string): Promise<void> {
  await $.store.set(`ticket:${session}`, ticket)
  await $.store.set('recents', ajouterRecent(await lireRecents($), ticket))
  await $.store.set(cleDossier(await $.session.cwd()), ticket)
  if (annonce !== undefined) $.ui.toast(annonce)
}

/** L'ID de la branche Git, seulement quand la branche a changé depuis la dernière lecture. */
async function ticketDeNouvelleBranche($: Moteur, motifs: readonly string[]): Promise<string | null> {
  const git = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5_000 }).catch(() => null)
  const branche = git?.exitCode === 0 ? git.stdout.trim() : ''
  if (branche === brancheVue) return null
  brancheVue = branche
  return detecterTicket(branche, motifs)
}

async function noterActivite($: Moteur, e: Activite): Promise<number> {
  const s = await $.session.id()
  const t = await $.clock.now()
  await noter($, { t, s, e, k: await ticketDe($, s) })
  return t
}

async function changerTicket($: Moteur, ticket: string): Promise<void> {
  await definirTicket($, await $.session.id(), ticket)
  await noterActivite($, 'ticket')
  await rafraichir($)
}

async function mettreEnPause($: Moteur): Promise<void> {
  await noterActivite($, 'pause')
  await rafraichir($)
}

async function classer($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  const t = await $.clock.now()
  await noter($, { t, s: await $.session.id(), e: 'classement', session: ecart.session, debut: ecart.debut, choix })
}

/** Recalcule la journée pour la puce, la carte et le panneau. */
async function rafraichir($: Moteur): Promise<Apercu> {
  const maintenant = await $.clock.now()
  const session = await $.session.id()
  const reglages = await chargerReglages($)
  const jour = debutJour(maintenant)
  await donnerSigneDeVie($)
  const { evenements, vivants } = await lireJournal($, decalerJours(jour, -1), jourSuivant(jour))
  const b = bilan(evenements, reglages, maintenant, jour, jourSuivant(jour), vivants)
  const ticket = await ticketDe($, session)
  const enPause = dernierEvenement(evenements, session)?.e === 'pause'
  const aujourdhui = b.jours[0]
  const lignes = aujourdhui?.lignes ?? []
  const vu: Apercu = {
    jour,
    lignes,
    total: aujourdhui?.total ?? 0,
    reel: aujourdhui?.reel ?? 0,
    ticket,
    enPause,
    ecarts: b.ecarts,
    recents: await lireRecents($),
  }
  await update($, apercu, () => vu)
  // La bande au-dessus de la saisie n'existe pas dans VS Code : la ligne de statut la remplace.
  const minutes = lignes.find(l => l.ticket === (ticket ?? SANS_TICKET))?.minutes ?? 0
  const dansVsCode = (await $.session.surfaces()).includes('vscode')
  $.ui.status(dansVsCode ? ligneStatut(reglages.format, ticket ?? SANS_TICKET, minutes, enPause) : undefined)
  return vu
}

async function apresMessage($: Moteur, texte: string, chercherTicket: boolean): Promise<void> {
  const session = await $.session.id()
  const motifs = await motifsIci($)
  const deBranche = await ticketDeNouvelleBranche($, motifs)
  const duMessage = chercherTicket ? detecterTicket(texte, motifs) : null
  const nouveau = duMessage ?? deBranche
  if (nouveau !== null && nouveau !== (await ticketDe($, session))) {
    const source = duMessage !== null ? 'cité dans votre message' : 'pris dans la branche Git'
    await definirTicket($, session, nouveau, `Temps compté pour ${nouveau}, ${source}`)
  }
  const t = await noterActivite($, 'message')
  const vu = await rafraichir($)
  const ecart = vu.ecarts.find(x => x.session === session && x.fin === t) ?? null
  await update($, question, () => ecart)
  if (ecart !== null) $.ui.toast(`${dureeEcart(ecart)} sans message sur ${ecart.ticket} : pause ou travail ?`)
}

/** Une nouvelle session prend le ticket de sa branche Git, sinon celui de la dernière session du dossier. */
async function choisirTicketAuDepart($: Moteur): Promise<void> {
  const session = await $.session.id()
  const deBranche = await ticketDeNouvelleBranche($, await motifsIci($))
  if ((await ticketDe($, session)) !== null) return
  if (deBranche !== null) {
    await definirTicket($, session, deBranche, `Temps compté pour ${deBranche}, pris dans la branche Git`)
    return
  }
  const duDossier = await $.store.get(cleDossier(await $.session.cwd()))
  if (typeof duDossier === 'string') {
    await definirTicket($, session, duDossier, `Temps compté pour ${duDossier}, comme la dernière session de ce dossier`)
  }
}

async function repondre($: Moteur, ecart: Ecart, choix: Choix): Promise<void> {
  await classer($, ecart, choix)
  await update($, question, x => (x?.session === ecart.session && x.debut === ecart.debut ? null : x))
  await rafraichir($)
  $.ui.toast(`${dureeEcart(ecart)} comptées comme ${choix}.`)
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
      await mettreEnPause($)
      return 'Compteur en pause pour cette session. Il repart à votre prochain message.'
    case 'confirmer':
      return confirmer($, mots.slice(1), (await surSemaine()).ecarts)
    case 'panneau':
      await $.ui.open({ id: PANNEAU, title: TITRE })
      return 'Panneau ouvert.'
    case 'aide':
      return aide((await dossiers($)).reglages)
  }
  if (mots.length === 1 && estUnTicket(mots[0]!, motifsDuProjet(reglages, await $.session.cwd()))) {
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

/** La carte du jour : temps par ticket, écarts à confirmer, choix du ticket. Dans la bande et dans le panneau. */
async function carte($: Moteur, e: Site, vu: Apercu, colonnes: number) {
  const { Box, Button, Input, Text } = $.ui.resolve(e)
  const enSaisie = await read($, saisie)
  const largeurNom = Math.max(8, ...vu.lignes.map(l => l.ticket.length))
  const largeurBarre = Math.max(6, Math.min(24, colonnes - largeurNom - 16))
  const max = Math.max(...vu.lignes.map(l => l.minutes), 1)
  const choix = (vu.ticket === null ? vu.recents : ajouterRecent(vu.recents, vu.ticket)).slice(0, 5)

  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor="inactive" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>Aujourd'hui, {formatJour(vu.jour)}</Text>
        <Text bold color="claude">
          {formatDuree(vu.total)}
        </Text>
      </Box>

      <Box flexDirection="column">
        {vu.lignes.length === 0 && <Text dimColor>Rien de compté pour l'instant. Le temps part de votre prochain message.</Text>}
        {vu.lignes.map(l => {
          const [plein, vide] = barre(l.minutes, max, largeurBarre)
          return (
            <Box flexDirection="row">
              <Text color={l.enCours ? 'success' : 'inactive'}>{l.enCours ? '● ' : '○ '}</Text>
              <Text bold={l.ticket === vu.ticket}>{`${l.ticket.padEnd(largeurNom)} `}</Text>
              <Text color="claude">{plein}</Text>
              <Text dimColor>{vide}</Text>
              <Text>{` ${formatDuree(l.minutes).padStart(7)}`}</Text>
            </Box>
          )
        })}
        {vu.total > vu.reel && (
          <Text dimColor>Temps réel {formatDuree(vu.reel)} : des sessions ont tourné en parallèle.</Text>
        )}
      </Box>

      {vu.ecarts.length > 0 && (
        <Box flexDirection="column">
          <Text bold color="warning">
            À confirmer (non compté)
          </Text>
          {vu.ecarts.map(x => (
            <Box flexDirection="row" gap={1}>
              <Text>
                {formatHeure(x.debut)} → {formatHeure(x.fin)} · {x.ticket} · {dureeEcart(x)}
              </Text>
              <Button key={`travail-${x.session}-${x.debut}`} label="Travail" variant="secondary" onPress={() => repondre($, x, 'travail')} />
              <Button key={`pause-${x.session}-${x.debut}`} label="Pause" variant="secondary" onPress={() => repondre($, x, 'pause')} />
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="column">
        <Text dimColor>Ticket de cette session</Text>
        <Box flexDirection="row" gap={1}>
          {choix.map(t => (
            <Button
              key={`ticket-${t}`}
              label={t}
              variant={t === vu.ticket ? 'primary' : 'secondary'}
              onPress={async () => {
                if (t !== vu.ticket) await changerTicket($, t)
                await update($, deplie, () => false)
              }}
            />
          ))}
          <Button key="autre" label="Autre…" variant="secondary" onPress={() => update($, saisie, ouvert => !ouvert)} />
        </Box>
        {enSaisie && (
          <Input
            key="ticket"
            label="ID du ticket"
            placeholder="FLO-I165"
            submitLabel="Valider"
            onSubmit={async texte => {
              const ticket = texte.trim()
              if (!estUnTicket(ticket, await motifsIci($))) {
                $.ui.toast(`« ${ticket} » n'est pas un ID de ticket reconnu.`)
                return
              }
              await update($, saisie, () => false)
              await changerTicket($, ticket)
            }}
          />
        )}
      </Box>

      <Box flexDirection="row" gap={1}>
        {vu.enPause ? (
          <Text dimColor>En pause : le compteur repart à votre prochain message.</Text>
        ) : (
          <Button key="pause" label="Mettre en pause" variant="secondary" onPress={() => mettreEnPause($)} />
        )}
        <Button
          key="semaine"
          label="Récap de la semaine"
          variant="secondary"
          onPress={() => enFond($.command.run({ command: 'temps', args: 'semaine' }))}
        />
      </Box>
    </Box>
  )
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
    await choisirTicketAuDepart($)
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
    const vu = await read($, apercu)
    if (vu !== null) return carte($, e, vu, e.props.bodyColumns)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>Calcul en cours…</Text>
  })

  // La bande au-dessus de la saisie : une puce qui s'ouvre en carte, et la question après un long silence.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const vu = await read($, apercu)
    if (vu === null || e.props.hasSurvey) return next(e)
    const ecart = await read($, question)
    const ouvert = await read($, deplie)
    const autres = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const minutes = vu.lignes.find(l => l.ticket === (vu.ticket ?? SANS_TICKET))?.minutes ?? 0
    const nom = vu.ticket ?? 'Choisir un ticket'
    const libelle = vu.enPause ? `⏸ ${nom} · en pause` : `⏱ ${nom} · ${formatDuree(minutes)}`

    return (
      <Box flexDirection="column" gap={1}>
        {ouvert && (await carte($, e, vu, e.props.bodyColumns))}
        {ecart !== null && (
          <Box flexDirection="row" gap={1}>
            <Text color="warning">
              {dureeEcart(ecart)} sans message sur {ecart.ticket} ({formatHeure(ecart.debut)} → {formatHeure(ecart.fin)}). C'était :
            </Text>
            <Button key="ecart-travail" label="Du travail" variant="primary" onPress={() => repondre($, ecart, 'travail')} />
            <Button key="ecart-pause" label="Une pause" variant="secondary" onPress={() => repondre($, ecart, 'pause')} />
          </Box>
        )}
        <Box flexDirection="row" justifyContent="space-between">
          <Button key="puce" label={libelle} variant="secondary" onPress={() => update($, deplie, v => !v)} />
          {autres}
        </Box>
      </Box>
    )
  })
}
