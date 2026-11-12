# ⏱ Temps par item

Le temps passé sur chaque item, compté tout seul dans Claude Code.

Vous travaillez normalement. Le soir, ouvrez la puce `⏱` ou tapez `/temps`, et recopiez les durées dans Zoho Sprints.

## Points forts

- **Rien à lancer.** Chaque message compte. Pas de minuteur à démarrer ou à arrêter.
- **Trouve l'item tout seul.** Dans vos messages (`FSY-I478`), puis dans la branche Git (`feature/FSY-I478-export`). Sans ID : le groupe de la session dans l'app desktop, ou le nom du projet.
- **Jour, semaine, mois.** Le total et le détail par item, avec les périodes passées.
- **Tokens par item.** Ce que chaque item a consommé.
- **Frise d'activité.** Vos 26 dernières semaines, comme sur GitHub.
- **Sessions en parallèle.** Chaque session compte. Deux sessions sur le même item sont regroupées.
- **Projets perso aussi.** Sans ID, le temps va au groupe ou au projet. Vous pouvez aussi taper un nom libre.

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

**Au quotidien, vous ne faites rien.** La puce `⏱ FSY-I478 · 1 h 12`, en bas de l'écran, donne l'item de la session et son temps du jour.

Cliquez sur la puce pour ouvrir le popover. Cliquez à nouveau pour le fermer.

| Pour… | Faites… |
| --- | --- |
| Passer cette session sur un autre item | Cliquez sur son nom dans la liste. |
| Un item absent de la liste | **+ Autre item**, tapez l'ID ou un nom, puis Entrée. |
| Renommer l'item de la session | Cliquez sur ✎ à côté de son nom. Le nouveau nom s'applique partout, passé compris. |
| Retirer un temps qui ne compte pas | Cliquez sur × au bout de la ligne. **Annuler** le remet. |
| Voir la semaine ou le mois | Onglets **Semaine** et **Mois**. Les flèches ‹ › changent de période. |
| Cacher ce qui ne vous sert pas | Cliquez sur ⚙. |

Un item choisi à la main reste en place : ni un message ni la branche Git ne le changent.

Après un long silence, une ligne demande « Du travail ? ». **Oui** compte ce temps, **Non** le laisse de côté.

### Réglages

Cliquez sur ⚙ dans le popover.

| Réglage | Par défaut |
| --- | --- |
| Tokens par item | affichés |
| Frise d'activité | affichée |
| « Du travail ? » après un long silence | activé |
| Silence compté comme travail | jusqu'à 20 min |
| Format des ID (expression régulière) | `[A-Z]+-I\d+`, les ID Zoho comme `FSY-I478` |

### Commandes

| Commande | Effet |
| --- | --- |
| `/temps` | Le temps du jour, par item. |
| `/temps semaine` | La semaine en cours, jour par jour. |
| `/temps mois` | Le mois en cours. |
| `/temps FSY-I478` | Passe cette session sur cet item. |
| `/temps stop` | Met cette session en pause jusqu'au prochain message. |
| `/temps confirmer` | Liste les silences à classer. |
| `/temps panneau` | Ouvre le popover dans un panneau (utile dans VS Code). |

```
Aujourd'hui

  FSY-I478   2 h 14    3,1 M tokens  (en cours)
  FLO-I165   1 h 05    1,1 M tokens
  Total      3 h 19    4,2 M tokens
```

## Comment le temps est compté

<details>
<summary>Les règles</summary>

- Le temps part du premier message de la session. Ouvrir une session ne compte pas.
- Pendant que Claude travaille, tout compte.
- Un silence de moins de 20 min compte. Un silence plus long ne compte pas, sauf si vous répondez « Oui ».
- Le premier ID trouvé dans une session reçoit aussi le temps passé avant lui.
- L'item reste celui de la session, même le lendemain.
- La puce donne le temps de la session. La liste donne le temps par item, toutes sessions confondues.
- Deux sessions sur deux items comptent chacune : le total du jour peut dépasser le temps réel. Le popover le signale (« dont 40 min en parallèle »).
- Les tokens sont ceux des réponses de Claude, sous-agents compris, lecture du cache comprise.
- Si vous fermez une fenêtre sans quitter Claude Code, le compteur s'arrête au plus 2 min après.

</details>

Les données restent sur votre ordinateur, dans `~/.claude/temps/journal/`.

## Limites

- Le mod compte l'activité dans Claude Code seulement. Une réunion ou un appel ne compte pas.
- Les ID doivent être en majuscules : `fsy-i478` n'est pas reconnu.
- Dans l'app desktop, la puce est en bas à droite, devant le mode de la session : c'est le seul endroit du bas qu'un mod peut utiliser.
- Dans le terminal, les clics demandent le mode plein écran (`/tui fullscreen`).
- VS Code n'affiche pas la puce : vous y voyez une ligne de statut, et `/temps panneau` ouvre le popover.
- Le nom du groupe vient de la config de l'app desktop. Si l'app change ce format, le mod prend le nom du projet.
- Demande Claude Code 2.1.290 ou plus, et l'extension VS Code 2.1.299 ou plus.

## Développement

```sh
claude plugin test .
claude plugin validate .
```

| Fichier | Rôle |
| --- | --- |
| `hooks/calcul.ts` | Le calcul du temps et des tokens, sans effet de bord. |
| `hooks/activite.ts` | La frise d'activité (SVG et terminal). |
| `hooks/texte.ts` | Les textes de `/temps`. |
| `hooks/register.tsx` | Les hooks, la commande, la puce, le popover et les réglages. |
| `tests/` | Les tests. |
