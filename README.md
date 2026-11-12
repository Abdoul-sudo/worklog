# ⏱ Temps par item

Le temps passé sur chaque item, compté tout seul dans Claude Code.

Vous travaillez normalement. Le soir, tapez `/temps` et recopiez les durées dans Zoho Sprints.

```
⏱ FSY-I478 · 1 h 12                    ← en bas de l'écran, un clic pour ouvrir

╭──────────────────────────────────╮
│ Aujourd'hui               3 h 19 │
│ ● FSY-I478 · 2 h 14              │  ← cette session
│   FLO-I165 · 1 h 05              │  ← un clic pour passer dessus
│   Autre : ID ou nom, puis Entrée │
╰──────────────────────────────────╯
```

## Points forts

- **Rien à lancer.** Chaque message compte. Pas de minuteur à démarrer ou à arrêter.
- **Trouve l'item tout seul.** Il cherche dans vos messages (`FSY-I478`), puis dans la branche Git (`feature/FSY-I478-export`). Sans ID, il prend le groupe de la session dans l'app desktop, ou le nom du projet.
- **Sessions en parallèle.** Chaque session compte. Deux sessions sur le même item sont regroupées dans la liste.
- **Pauses.** Un silence de moins de 20 min compte. Un silence plus long vous est proposé : « Du travail ? Oui / Non ».
- **Projets perso aussi.** Sans ID, le temps va au nom du groupe ou du projet. Vous pouvez aussi taper un nom libre.

## Installation

```sh
claude plugin marketplace add Abdoul-sudo/claude-temps-item
claude plugin install temps-item@temps-item
```

C'est tout. Le mod tourne dans le terminal, dans l'app desktop et dans VS Code.

> [!NOTE]
> Le dépôt est privé. Il faut un accès au dépôt, et Git doit pouvoir lire GitHub sur votre ordinateur (`gh auth login`, puis `gh auth setup-git`).

<details>
<summary>Sans terminal</summary>

- **App desktop :** **+** à côté de la saisie, puis **Plugins**. Ajoutez la marketplace `Abdoul-sudo/claude-temps-item`, puis le plugin `temps-item`.
- **VS Code :** tapez `/plugins`, onglet **Marketplaces**. Ajoutez `Abdoul-sudo/claude-temps-item`, puis installez `temps-item`.

</details>

## Utilisation

**Au quotidien, vous ne faites rien.** La puce `⏱`, en bas de l'écran, montre l'item de la session et son temps du jour dans cette session.

Cliquez sur la puce : la liste du jour s'ouvre au-dessus de la saisie.

- cliquez sur une ligne pour passer cette session sur cet item ;
- tapez un ID ou un nom dans le champ, puis Entrée.

Un item choisi à la main reste en place : ni un message ni la branche Git ne le changent.

### Commandes

| Commande | Effet |
| --- | --- |
| `/temps` | Le temps du jour, par item. |
| `/temps semaine` | Les 7 derniers jours : par jour, puis le total. |
| `/temps FSY-I478` | Passe cette session sur cet item. |
| `/temps stop` | Met cette session en pause jusqu'au prochain message. |
| `/temps confirmer` | Liste les silences à classer. |
| `/temps confirmer 1 travail` | Classe le silence 1 (numéros ou `tout`, puis `travail` ou `pause`). |

```
Temps du jeudi 12 novembre

  FSY-I478   2 h 14  (en cours)
  FLO-I165   1 h 05
  Total      3 h 19
```

## Comment le temps est compté

<details>
<summary>Les règles</summary>

- Le temps part du premier message de la session. Ouvrir une session ne compte pas.
- Pendant que Claude travaille, tout compte.
- Un silence de moins de 20 min compte. Un silence plus long ne compte pas, sauf si vous répondez « Oui ».
- Le premier ID trouvé dans une session reçoit aussi le temps passé avant lui.
- L'item reste celui de la session, même le lendemain.
- Chaque session compte. Le total du jour peut donc dépasser le temps réel. `/temps` donne aussi le temps réel.
- Si vous fermez une fenêtre sans quitter Claude Code, le compteur s'arrête au plus 2 min après.

</details>

## Réglages

Le fichier `~/.claude/temps.json` se crée au premier lancement.

```json
{
  "seuilPauseMinutes": 20,
  "ecartMaxMinutes": 240,
  "motifs": ["[A-Z]+-I\\d+"],
  "projets": { "D:/code/mon-projet": ["PROJ-\\d+"] }
}
```

| Réglage | Rôle | Défaut |
| --- | --- | --- |
| `seuilPauseMinutes` | Un silence plus court compte. | `20` |
| `ecartMaxMinutes` | Un silence plus long est un arrêt (la nuit), sans question. | `240` |
| `motifs` | Les formes d'ID, en expressions régulières. | ID Zoho : `FSY-I478` |
| `projets` | D'autres formes d'ID pour un dossier. | aucun |

Les données restent sur votre ordinateur, dans `~/.claude/temps/journal/`.

## Limites

- Le mod compte l'activité dans Claude Code seulement. Une réunion ou un appel ne compte pas.
- Les ID doivent être en majuscules : `fsy-i478` n'est pas reconnu.
- VS Code n'affiche pas la puce : vous y voyez une ligne de statut, et `/temps panneau` ouvre la liste.
- Dans le terminal, les clics demandent le mode plein écran (`/tui fullscreen`).
- Le nom du groupe vient de la config de l'app desktop. Si l'app change ce format, le mod prend le nom du projet.
- Demande Claude Code 2.1.290 ou plus, et l'extension VS Code 2.1.299 ou plus.

## Développement

```sh
claude plugin test .
claude plugin validate .
```

| Fichier | Rôle |
| --- | --- |
| `hooks/calcul.ts` | Le calcul du temps, sans effet de bord. |
| `hooks/texte.ts` | Les textes de `/temps`. |
| `hooks/register.tsx` | Les hooks, la commande, la puce et la liste. |
| `tests/` | Les tests. |
