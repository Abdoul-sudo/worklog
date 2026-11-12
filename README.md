# Temps par ticket

Un mod pour Claude Code. Il compte le temps passé sur chaque ticket, tout seul, à partir de vos messages dans Claude Code.

Vous n'avez rien à lancer ni à arrêter. Le soir, tapez `/temps` et recopiez les durées dans Zoho Sprints.

## Comment il compte

- Chaque message que vous envoyez à Claude marque une activité.
- Le mod cherche un ID de ticket dans le message, par exemple `FLO-I165` ou `FSY-I478`. Le premier ID trouvé devient le ticket de la session.
- Le ticket reste celui de la session, même le lendemain, jusqu'à ce qu'un message cite un autre ID.
- Sans ID, le temps va dans « ticket ? ».
- Pendant que Claude travaille (entre votre message et sa réponse), le temps compte.
- Un silence de moins de 20 minutes compte comme du travail.
- Un silence plus long ne compte pas. Il passe dans la liste « à confirmer ». Vous le classez ensuite en travail ou en pause.
- Deux sessions sur deux tickets en même temps : les deux compteurs tournent.
- Deux sessions sur le même ticket en même temps : le temps commun compte une seule fois.
- Ouvrir une session ne compte pas. Le temps part du premier message.

## Installation

Le dépôt est privé. Pour l'installer, il faut avoir accès au dépôt sur GitHub. Il faut aussi que Git puisse lire GitHub sur votre ordinateur, par exemple avec `gh auth login` puis `gh auth setup-git`.

Installez le mod une seule fois. Il marche ensuite dans le terminal, dans l'app desktop et dans VS Code.

### Dans un terminal

Lancez ces deux commandes dans votre shell :

```sh
claude plugin marketplace add Abdoul-sudo/claude-temps-ticket
claude plugin install temps-ticket@temps-ticket
```

Ou, dans une session Claude Code, tapez :

```
/plugin install temps-ticket --marketplace Abdoul-sudo/claude-temps-ticket
```

Répondez `y`, puis choisissez la portée « user ».

### Dans l'app desktop

Les commandes du terminal suffisent : l'app desktop lit les mêmes plugins.

Sans terminal : cliquez sur **+** à côté de la zone de saisie, puis **Plugins**. Ajoutez la marketplace `Abdoul-sudo/claude-temps-ticket`, puis ajoutez le plugin `temps-ticket`.

### Dans VS Code

Les commandes du terminal suffisent : l'extension lit les mêmes plugins.

Sans terminal : tapez `/plugins` dans la zone de saisie de l'extension. Ouvrez l'onglet **Marketplaces**, ajoutez `Abdoul-sudo/claude-temps-ticket`, puis installez `temps-ticket`.

L'extension doit être en version 2.1.299 ou plus. Avant cette version, les mods ne tournent pas dans l'extension. Mettez-la à jour, ou utilisez `claude` dans le terminal intégré de VS Code.

## Ce que vous voyez

| Où | Ce qui s'affiche |
| --- | --- |
| Terminal | Une ligne de statut sous la zone de saisie, par exemple `FLO-I165 · 2 h 14 aujourd'hui`. Le terminal la préfixe par `⚠ temps-ticket:`. |
| App desktop | Un panneau à côté de la conversation : les tickets du jour, leur temps en direct, un bouton **Pause** et un bouton **Changer de ticket**. |
| VS Code | Le même panneau, et la ligne de statut au-dessus de la zone de saisie. |
| Terminal et app desktop | Après un long silence, une bande au-dessus de la zone de saisie demande « pause ou travail ? », avec deux boutons. |

Le panneau s'ouvre tout seul dans l'app desktop et dans VS Code. Dans le terminal, tapez `/temps panneau` pour l'ouvrminal, les boutons se cliquent seulement en mode plein écran. Pour l'activer, tapez `/tui fullscreen` une fois. Sans ce mode, utilisez les commandes `/temps`.

## Commandes

| Commande | Ce qu'elle fait |
| --- | --- |
| `/temps` | Donne le temps du jour par ticket, et les silences à confirmer. |
| `/temps semaine` | Donne le temps des 7 derniers jours : par jour, puis le total par ticket. |
| `/temps FLO-I165` | Change le ticket de cette session. Le temps compte pour ce ticket à partir de maintenant. |
| `/temps stop` | Met le compteur de cette session en pause. Votre prochain message le relance. |
| `/temps confirmer` | Liste les silences à classer, avec un numéro chacun. |
| `/temps confirmer 1 travail` | Classe le silence 1 en travail. Mettez plusieurs numéros, ou `tout`. Terminez par `travail` ou `pause`. |
| `/temps panneau` | Ouvre le panneau. |
| `/temps aide` | Affiche l'aide. |

`/temps` répond tout de suite, sans lancer Claude.

Exemple de récapitulatif :

```
Temps du jeudi 12 novembre

  FLO-I165   2 h 14  (en cours)
  FSY-I478   1 h 05
  Total      3 h 19
```

## Réglages

Le mod crée le fichier `~/.claude/temps.json` au premier lancement. Modifiez-le à la main. Le mod relit le fichier toutes les 30 secondes.

```json
{
  "seuilPauseMinutes": 20,
  "ecartMaxMinutes": 240,
  "motifs": ["FLO-I\\d+", "FSY-I\\d+", "[A-Z]+-I?\\d+"],
  "projets": {
    "D:/code/projet-fsy": ["FSY-I\\d+"]
  },
  "format": "{ticket} · {duree} aujourd'hui"
}
```

| Réglage | Rôle |
| --- | --- |
| `seuilPauseMinutes` | Un silence plus court compte comme du travail. Par défaut : 20. |
| `ecartMaxMinutes` | Un silence plus long n'est pas à confirmer : c'est un arrêt, par exemple la nuit. Par défaut : 240. |
| `motifs` | Les expressions régulières des ID de ticket. Le mod les essaie dans l'ordre. |
| `projets` | Des motifs propres à un dossier. Le dossier le plus précis qui contient la session gagne. |
| `format` | Le texte de la ligne de statut. `{ticket}` et `{duree}` sont remplacés. |

Les données restent sur votre ordinateur, dans `~/.claude/temps/journal/`. Il y a un dossier par jour et un fichier par session.

## Limites connues

- Le mod compte seulement l'activité dans Claude Code. Le travail hors de Claude (réunion, lecture, appel) ne compte pas.
- Le total du jour peut dépasser le temps réel, car des sessions en parallèle comptent chacune. `/temps` donne alors aussi le temps réel.
- Le motif générique `[A-Z]+-I?\d+` peut prendre `UTF-8` ou `ISO-8601` pour un ticket. Si cela vous gêne, retirez-le de `motifs`, ou forcez le ticket avec `/temps FLO-I165`.
- Les ID doivent être en majuscules : `flo-i165` n'est pas reconnu.
- Si vous fermez une fenêtre sans quitter Claude Code, le compteur s'arrête au dernier signe de vie de la session, au plus 2 minutes après.
- Les données ne passent pas d'un ordinateur à l'autre.
- Le mod ne remplit pas Zoho Sprints. Il donne les durées à recopier.
- Les mods demandent Claude Code 2.1.290 ou plus (terminal et app desktop) et l'extension VS Code 2.1.299 ou plus. Le mod a été testé avec Claude Code 2.1.322.

## Développement

Les tests tournent sans dépendance :

```sh
claude plugin test .
claude plugin validate .
```

- `hooks/calcul.ts` : le calcul du temps, sans effet de bord.
- `hooks/texte.ts` : les textes de `/temps`.
- `hooks/register.tsx` : les hooks, la commande, le panneau et la bande.
- `tests/` : les tests du calcul et du mod.
