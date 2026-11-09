# Référence de la mémoire et des commandes

Commandes à lancer depuis le dossier de recherche d’emploi (ou avec `--workspace DOSSIER`). Les commandes de travail écrivent du JSON sur stdout ; une erreur est un JSON `{"error": {"code", "message", "details"}}` sur stderr avec un code de sortie non nul. `check` et `build` sortent avec 2 quand le CV n’est pas livrable.

## Organisation d’un espace

```
mon-dossier/
├── cv.tex                      CV de base (modèle, jamais modifié)
├── lettre.tex                  facultatif : votre modèle de lettre (sinon celui de find-job)
├── candidatures/
│   └── 2026-10-24_societe_generale_data_engineer/
│       ├── cv_societe_generale.tex   ← livré
│       ├── cv_societe_generale.pdf   ← livré
│       ├── lettre_societe_generale.tex ← livré
│       ├── lettre_societe_generale.pdf ← livré
│       ├── offre.md / offre.json     offre telle que lue
│       ├── analyse.json              exigences et mots-clés (écrit par l’agent)
│       ├── qualite.json              dernier rapport de find-job check (CV + lettre)
│       └── .build/                   fichiers auxiliaires LaTeX (ignorés par Git)
└── .find-job/                  mémoire, à versionner avec le reste
    ├── config.json             CV de base, dossier de sortie, pages max, moteur
    ├── applications.json       candidatures et historique des statuts
    ├── plans.json              plans hebdomadaires, coches, bilans
    ├── profile.json            faits confirmés et préférences
    ├── journal.jsonl           journal de toutes les actions
    └── cache/                  fichiers de travail (offres lues, plans, bilans)
```

## Commandes

| Besoin | Commande |
|---|---|
| Créer l’espace | `find-job init [--cv cv.tex] [--name "Prénom Nom"]` |
| État / reprise | `find-job status` · `find-job resume [--json]` |
| Lire des offres | `find-job offer URL [URL…] [--out fichier.json]` (plusieurs URL → `offers[]`, lues en parallèle) |
| Préparer CV + lettre | `find-job prepare --offer offre.json` ou `--company X --title Y [--url U --location L --contract C --deadline AAAA-MM-JJ] [--force]` |
| Lettre manquante | `find-job letter ID` (crée `lettre_<entreprise>.tex` depuis le modèle) |
| Compiler | `find-job build ID|fichier.tex` (CV ou lettre) |
| Portail qui refuse le PDF | `find-job build ID --sans-liens` → `cv_…_sans_liens.pdf` et `lettre_…_sans_liens.pdf`, sans liens ni action d’ouverture |
| Contrôler | `find-job check ID|fichier.tex [--keywords a,b] [--must-have c] [--no-build]` : CV et lettre |
| Lister | `find-job list [--since 24h|48h|7j|30j|90j] [--status S]` · `find-job show ID` |
| Statut | `find-job set ID --status S [--note "…"] [--at AAAA-MM-JJ]` |
| Modifier | `find-job edit ID [--notes --location --contact --salary --url --title --company --contract]` |
| Retirer du suivi | `find-job remove ID` (le dossier reste sur le disque) |
| Chiffres | `find-job stats [--since 7j]` |
| Plan | `find-job plan show|set|done|progress|review` (voir planification.md) |
| Profil | `find-job profile` · `profile fact "…" [--tags a,b]` · `profile unfact ID` · `profile pref CLE VALEUR` |
| Réglages | `find-job config startWeek 2026-10-26` (semaine 1 de la recherche) · `config maxPages 1` (1 par défaut, à garder) · `config engine lualatex` · `config candidateName "…"` |
| Journal | `find-job log "texte" [--type networking]` |
| Interface | `find-job ui [--port 4321] [--no-open]` |
| Installation | `find-job setup [claude|codex] [--local] [--remove]` |

`ID` accepte l’identifiant (`c-1a2b3c4d`), le dossier de la candidature ou le slug de l’entreprise (la plus récente). Avec plusieurs offres de la même entreprise, utilise toujours l’identifiant.

Les URL sont enregistrées sans leurs paramètres de suivi (`utm_*`, `lever-*`, `trk`…). Une offre déjà suivie est refusée par `prepare` (`ALREADY_TRACKED`, avec l’identifiant existant) sauf `--force`. La date limite (`validThrough` de l’offre ou `--deadline`) s’affiche dans le tableau de bord.

## Semaines

La semaine 1 est `startWeek` (par défaut : la semaine de création de l’espace, ou la suivante s’il a été créé un week-end). Les commandes `plan` acceptent `--week S3`, `--week 3` ou `--week 2026-W46`. Les données restent stockées par semaine ISO.

## Statuts

`preparee` (CV prêt) → `postulee` → `relancee` → `entretien` → `offre`, ou `refusee` / `abandonnee`. Chaque changement ajoute une entrée datée à l’historique : c’est elle que comptent les périodes du tableau de bord et les objectifs. La première mise en `postulee` fixe `appliedAt`. Une relance est conseillée après 7 jours sans changement.

## Préférences utiles

Clés libres, par exemple : `roles`, `locations`, `remote`, `contracts`, `salary`, `exclusions`, `language`. Elles servent à signaler une offre hors cible et à orienter le titre et la lettre.

## Compilation

Le moteur est déduit du modèle : commentaire `% !TEX program = …`, `fontspec`/`unicode-math` → xelatex (ou lualatex), sinon pdflatex ; `find-job config engine …` l’impose. Les ressources du modèle (photo, classe `.cls`, polices) sont trouvées depuis le dossier du CV de base sans copie. Aucun moteur installé : `LATEX_MISSING` donne la commande d’installation.
