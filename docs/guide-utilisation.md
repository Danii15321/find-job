# Guide d’utilisation de find-job

find-job est un assistant de recherche d’emploi pour **Claude Code** ou **Codex**. Vous lui donnez l’adresse d’une offre ; il adapte votre CV LaTeX, écrit une lettre de motivation, compile les deux en PDF et suit vos candidatures dans un tableau de bord. Vous lui parlez en français, il s’occupe des commandes.

## 1. Avant de commencer

| Il vous faut | Pour vérifier |
|---|---|
| Claude Code ou Codex | `claude --version` ou `codex --version` |
| Node.js 20 ou plus | `node --version` |
| TeX Live avec `latexmk` | `latexmk -v` |
| Votre CV au format `.tex` qui compile | `pdflatex cv.tex` |

Sous Windows, utilisez Ubuntu (WSL). Si votre CV utilise des icônes (`fontawesome5`) ou des polices particulières, installez aussi `texlive-fonts-extra`.

## 2. Installer (une seule fois)

Le [README](../README.md#installer-sur-un-nouvel-ordinateur) détaille l’installation de Node.js, LaTeX et de l’agent pour Windows (WSL), macOS et Linux. find-job lui-même s’installe ainsi :

```bash
git clone https://github.com/Danii15321/find-job.git ~/find-job
cd ~/find-job
node bin/find-job.js setup
```

Le skill est ajouté à Claude Code et Codex, et la commande `find-job` est disponible dans le terminal. Si `find-job` est introuvable ensuite, ajoutez `export PATH="$HOME/.local/bin:$PATH"` à votre `~/.bashrc` et ouvrez un nouveau terminal.

## 3. Créer votre dossier de recherche

```bash
mkdir ~/recherche-emploi
cp ~/chemin/vers/mon_cv.tex ~/recherche-emploi/cv.tex
cd ~/recherche-emploi
claude        # ou : codex
```

Ce CV est votre **modèle** : il n’est jamais modifié. Facultatif : placez à côté votre photo (si le CV l’utilise) et votre propre modèle de lettre `lettre.tex`.

## 4. Adapter votre CV à une offre

Dans Claude Code, tapez :

```text
/find-job https://www.welcometothejungle.com/fr/companies/acme/jobs/data-engineer
```

Dans Codex, remplacez `/find-job` par `$find-job`. La première fois, l’agent prépare le dossier tout seul.

Vous recevez, dans `candidatures/<date>_<entreprise>_<poste>/` :

- `cv_<entreprise>.tex` et `cv_<entreprise>.pdf` : votre CV adapté, **sur une page** ;
- `lettre_<entreprise>.tex` et `lettre_<entreprise>.pdf` : la lettre de motivation, une page.

**À relire avant d’envoyer** : l’agent vise 100 % des mots-clés de l’offre. Il vous donne la liste des mots-clés **ajoutés qui n’étaient pas dans votre CV de base** : retirez ceux que vous ne maîtrisez pas (dans le `.tex`, puis demandez « recompile le CV Acme »). Il signale aussi tout chiffre ou date à vérifier.

**Plusieurs offres d’un coup** : collez plusieurs adresses dans le même message. Chaque offre a son propre dossier ; une offre déjà suivie est signalée au lieu d’être refaite. Vous recevez un tableau récapitulatif à la fin.

**LinkedIn, Indeed** : ces sites bloquent la lecture automatique. Collez le texte de l’annonce avec son adresse.

## 5. Suivre vos candidatures

Dites simplement ce qui se passe :

| Vous dites | find-job enregistre |
|---|---|
| « J’ai postulé chez Acme » | Postulée (avec la date) |
| « J’ai relancé Acme » | Relancée |
| « Entretien chez Acme jeudi 14 h » | Entretien, avec la note |
| « Acme m’a fait une offre » / « refus de Acme » | Offre reçue / Refusée |

Sans nouvelle depuis 7 jours, une relance vous est proposée.

## 6. Le tableau de bord

Demandez « ouvre le tableau de bord ». L’agent vous donne un lien (par exemple `http://127.0.0.1:4321`) qui ne fonctionne que sur votre ordinateur.

- **Tableau de bord** : candidatures envoyées, CV adaptés, entretiens et taux de réponse sur 24 h, 48 h, 7 jours, 30 jours ou 3 mois ; ce qu’il reste à faire aujourd’hui (dossiers à finir, prêts à envoyer, relances, dates limites).
- **Candidatures** : chaque offre avec son lien **Offre ↗**, son CV et sa lettre en un clic, son statut modifiable, son historique et vos notes.
- **Éditeur** (bouton ✎) : le `.tex` du CV et de la lettre à gauche, le PDF à droite. **Ctrl+S** enregistre, recompile, met l’aperçu à jour et relance les contrôles ; une erreur LaTeX s’affiche avec sa ligne, un clic vous y amène. Idéal pour les petites retouches, sans VS Code et sans dépenser de tokens.
- **Semaine** : vos objectifs et routines, cochés jour par jour, et votre progression face à ce qui était prévu.

La page se met à jour seule quand l’agent travaille.

## 7. Planifier votre semaine et faire le bilan

```text
/find-job planifie ma semaine : 8 candidatures, 3 relances, veille des offres 30 min chaque matin
```

Les candidatures et relances se comptent seules. Cochez les routines dans le tableau de bord, ou dites « j’ai fait ma veille ». La **semaine 1** est celle où vous démarrez votre recherche ; pour la changer : `find-job config startWeek 2026-10-26`.

En fin de semaine : « fais le bilan de ma semaine ». L’agent compare le prévu et le réalisé, vous pose une ou deux questions et retient deux à quatre leçons. Elles serviront à préparer la semaine suivante.

## 8. Reprendre plus tard

Dans une nouvelle conversation, depuis votre dossier : `/find-job reprends`. L’agent relit où vous en êtes (semaine en cours, dossiers à finir, relances, leçons) et propose la suite.

## 9. Si quelque chose bloque

| Problème | Solution |
|---|---|
| Le site refuse le fichier (« contenu actif ») | Dites « fais la version sans liens du CV Acme » : vous recevez `cv_acme_sans_liens.pdf` et `lettre_acme_sans_liens.pdf`, identiques mais sans liens cliquables |
| « File `….sty` not found » | Un paquet LaTeX manque : `sudo apt install texlive-latex-extra texlive-fonts-extra` |
| Le CV dépasse une page | L’agent condense jusqu’à une page ; s’il n’y arrive pas, raccourcissez votre CV de base |
| L’offre ne se lit pas | Collez le texte de l’annonce dans la conversation |
| « Cette offre est déjà suivie » | Normal : elle a déjà un dossier. Dites « prépare quand même un second dossier » si c’est voulu |
| Le tableau de bord ne s’ouvre pas | Utilisez le lien donné par l’agent ; le port change si 4321 est occupé |
| `find-job` introuvable | Voir l’étape 2 (PATH) |

## 10. Où sont vos fichiers

```text
recherche-emploi/
├── cv.tex                         votre modèle (jamais modifié)
├── candidatures/
│   └── 2026-10-26_acme_data_engineer/
│       ├── cv_acme.tex   cv_acme.pdf
│       ├── lettre_acme.tex   lettre_acme.pdf
│       └── offre.md                l’offre telle qu’elle a été lue
└── .find-job/                      l’historique de votre recherche
```

Tout reste sur votre ordinateur. Vous pouvez sauvegarder le dossier avec Git ou le copier ailleurs.
