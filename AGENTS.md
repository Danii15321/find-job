# Travailler dans find-job

## Organisation

- `skills/find-job/` : le skill installé dans Claude Code et Codex (`SKILL.md` + `references/`). C'est le produit : toute évolution de comportement s'y décrit.
- `src/core/` : domaine indépendant de l'interface (espace, candidatures, plans, statistiques, stockage atomique sous verrou).
- `src/cv/` : lecture d'offre, compilation LaTeX, contrôle qualité.
- `src/cli/` : la commande `find-job` (JSON sur stdout, erreurs structurées sur stderr).
- `src/server/` + `ui/` : tableau de bord local, sans dépendance ni build (HTML/CSS/JS natifs). `ui/editor.js` est l’éditeur LaTeX (Ctrl+S → `src/cv/source.js` : enregistrer sans écraser une modification faite ailleurs, compiler, contrôler).
- `exemple/` : espace de démonstration avec un CV fictif.

## Règles

- Zéro dépendance npm, Node ≥ 20. Une dépendance se justifie par écrit avant d'être ajoutée.
- La mémoire d'un espace (`.find-job/`) ne s'écrit que par `src/core` : la CLI et le serveur appellent les mêmes fonctions. Pas d'écriture directe des JSON ailleurs.
- Un statut de candidature change toujours avec une entrée d'historique datée : les périodes et objectifs en dépendent.
- Le contrôle qualité distingue bloquant / avertissement / info. Un nouveau contrôle bloquant doit être certain (pas de faux positif sur un CV correct).
- L'interface explique les changements par l'animation et respecte `prefers-reduced-motion`. Les données utilisateur passent toujours par `esc()`.
- Le serveur n'écoute que sur la boucle locale ; les écritures exigent le jeton de session de la page.
- Textes visibles en français.

## Vérifier

```bash
npm test                     # tests unitaires, CLI de bout en bout (pdflatex requis), API
npm run ui                   # tableau de bord sur l'espace exemple
node bin/find-job.js setup   # réinstaller le skill après modification de skills/
```

Après une modification de `skills/find-job/`, relancer `setup` : la copie installée n'est pas un lien.
