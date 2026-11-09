# find-job

Skill de recherche d’emploi pour **Claude Code** et **Codex**. Donnez l’adresse d’une offre : l’agent adapte votre CV LaTeX à cette offre, écrit une lettre de motivation courte et naturelle, compile et contrôle le tout, puis vous livre `cv_<entreprise>.tex/.pdf` et `lettre_<entreprise>.tex/.pdf`. Chaque candidature rejoint un tableau de bord local, avec un éditeur LaTeX intégré ; vous planifiez votre semaine en une phrase et le bilan du vendredi alimente le plan suivant. Tout reste sur votre ordinateur.

```text
/find-job https://www.welcometothejungle.com/fr/companies/acme/jobs/data-engineer
/find-job j’ai postulé chez Acme
/find-job planifie ma semaine : 8 candidatures, 3 relances, veille 30 min chaque matin
/find-job ouvre le tableau de bord
/find-job fais le bilan de ma semaine
```

- [Installer sur un nouvel ordinateur](#installer-sur-un-nouvel-ordinateur)
- [Premier usage](#premier-usage)
- [Mettre à jour, désinstaller, changer d’ordinateur](#mettre-à-jour)
- [Dépannage](#dépannage)
- [Ce que fait find-job](#ce-que-fait-find-job)
- [Guide d’utilisation détaillé](docs/guide-utilisation.md)

## Installer sur un nouvel ordinateur

Comptez 15 à 30 minutes, surtout pour télécharger LaTeX. find-job n’a aucune dépendance npm : il lui faut seulement Node.js, LaTeX et un agent (Claude Code ou Codex).

| Il vous faut | Version | Pour vérifier |
|---|---|---|
| Linux, macOS, ou Windows avec WSL (Ubuntu) | – | – |
| Git | toute version récente | `git --version` |
| Node.js | 20 ou plus | `node --version` |
| TeX Live avec `latexmk` | 2021 ou plus | `latexmk -v` |
| Claude Code ou Codex | dernière version | `claude --version` ou `codex --version` |

### 1. Windows : installer Ubuntu (WSL)

Sous Windows, find-job s’utilise dans Ubuntu (WSL). Dans **PowerShell ouvert en administrateur** :

```powershell
wsl --install -d Ubuntu
```

Redémarrez, ouvrez l’application **Ubuntu**, choisissez un nom d’utilisateur et un mot de passe. **Toutes les commandes suivantes se tapent dans ce terminal Ubuntu.** Le tableau de bord s’ouvrira quand même dans votre navigateur Windows.

Sur Linux ou macOS, passez directement à l’étape 2.

### 2. Installer les outils de base

**Ubuntu / Debian / WSL**

```bash
sudo apt update
sudo apt install -y git curl
```

**macOS** : installez [Homebrew](https://brew.sh) si vous ne l’avez pas, puis :

```bash
brew install git
```

### 3. Installer Node.js (20 ou plus)

**Ubuntu / Debian / WSL** : le plus simple est [nvm](https://github.com/nvm-sh/nvm), qui installe Node sans `sudo`.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
node --version
```

**macOS**

```bash
brew install node
node --version
```

### 4. Installer LaTeX

find-job compile avec `pdflatex` et `latexmk`. Les paquets ci-dessous couvrent la plupart des CV, dont les icônes `fontawesome5` et la typographie française.

**Ubuntu / Debian / WSL** (environ 1 à 2 Go) :

```bash
sudo apt install -y latexmk texlive-latex-recommended texlive-latex-extra \
  texlive-fonts-recommended texlive-fonts-extra texlive-lang-french
```

Si votre CV utilise `fontspec` (polices système), ajoutez `texlive-xetex texlive-luatex`.

**macOS** :

```bash
brew install --cask mactex-no-gui
```

Puis ouvrez un nouveau terminal. Pour vérifier, quelle que soit la plateforme :

```bash
pdflatex --version
latexmk -v
```

### 5. Installer Claude Code (ou Codex)

Il suffit d’un des deux.

**Claude Code** : suivez la [documentation officielle](https://code.claude.com/docs), par exemple :

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Au premier lancement, connectez-vous à votre compte Claude.

**Codex** :

```bash
npm install -g @openai/codex
codex
```

### 6. Récupérer find-job et l’installer

```bash
git clone https://github.com/Danii15321/find-job.git ~/find-job
cd ~/find-job
node bin/find-job.js setup
```

`setup` fait deux choses :

- il copie le skill dans `~/.claude/skills/find-job` et `~/.codex/skills/find-job` (selon l’agent détecté) ; un dossier du même nom que find-job n’a pas installé n’est jamais remplacé ;
- il crée la commande `find-job` dans `~/.local/bin`.

### 7. Vérifier l’installation

Ouvrez un **nouveau terminal**, puis :

```bash
find-job --version
```

Si la commande est introuvable, `~/.local/bin` n’est pas dans votre PATH :

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

(sur macOS avec zsh, remplacez `~/.bashrc` par `~/.zshrc`).

Pour vérifier aussi LaTeX de bout en bout, lancez les tests (une trentaine de secondes) :

```bash
cd ~/find-job && npm test
```

## Premier usage

1. Créez un dossier pour votre recherche et copiez-y votre CV LaTeX. Ce fichier devient votre **modèle** : il ne sera jamais modifié.

   ```bash
   mkdir ~/recherche-emploi
   cp /chemin/vers/mon_cv.tex ~/recherche-emploi/cv.tex
   cd ~/recherche-emploi
   ```

   Si votre CV utilise une photo ou des images, copiez-les à côté. Sous WSL, vos fichiers Windows sont dans `/mnt/c/Users/<vous>/…`.

2. Vérifiez que le CV compile tel quel :

   ```bash
   latexmk -pdf cv.tex
   ```

   Si un paquet manque (`File 'xxx.sty' not found`), installez-le (étape 4) avant d’aller plus loin.

3. Lancez votre agent dans ce dossier et donnez-lui une offre :

   ```bash
   claude
   ```

   ```text
   /find-job https://adresse-de-l-offre
   ```

   Avec Codex, lancez `codex` et tapez `$find-job https://…`. La première fois, l’agent crée l’espace de travail (`.find-job/`) tout seul.

4. Ouvrez le tableau de bord, en le demandant à l’agent (« ouvre le tableau de bord ») ou directement :

   ```bash
   find-job ui
   ```

   L’adresse s’affiche (`http://127.0.0.1:4321`, ou le port suivant s’il est pris) ; elle ne fonctionne que sur votre ordinateur.

Le [guide d’utilisation](docs/guide-utilisation.md) détaille la suite : relire un CV adapté, suivre ses candidatures, planifier sa semaine.

## Mettre à jour

```bash
cd ~/find-job
git pull
node bin/find-job.js setup
```

`setup` doit être relancé après chaque mise à jour : le skill installé est une copie. Arrêtez aussi un tableau de bord déjà ouvert (`Ctrl+C` dans son terminal) et relancez `find-job ui`. Une page ouverte sur un serveur trop ancien affiche le bandeau « Tableau de bord à relancer ».

## Désinstaller

```bash
cd ~/find-job
node bin/find-job.js setup --remove
rm -rf ~/find-job
```

Vos dossiers de recherche (`~/recherche-emploi`…) ne sont pas touchés.

## Changer d’ordinateur

Tout ce qui concerne votre recherche est dans votre dossier de recherche : le CV de base, `candidatures/` et `.find-job/` (historique, plans, profil). Installez find-job sur le nouvel ordinateur (étapes 1 à 7), puis copiez ce dossier, ou versionnez-le dans un dépôt Git **privé** :

```bash
cd ~/recherche-emploi
git init && git add . && git commit -m "Ma recherche d’emploi"
```

Ce dossier contient vos données personnelles : ne le publiez pas dans un dépôt public.

## Dépannage

| Problème | Solution |
|---|---|
| `find-job: command not found` | Ajoutez `~/.local/bin` au PATH (étape 7), puis ouvrez un nouveau terminal. |
| `/find-job` inconnu dans Claude Code | Relancez `node bin/find-job.js setup`, puis redémarrez Claude Code. Vérifiez que `~/.claude/skills/find-job/SKILL.md` existe. |
| `File 'xxx.sty' not found` | Un paquet LaTeX manque : installez les paquets de l’étape 4 (souvent `texlive-fonts-extra`). |
| `LATEX_MISSING` | `pdflatex` ou `latexmk` est introuvable : étape 4. |
| `find-job demande Node.js 20 ou plus` | Mettez Node à jour (étape 3) ; avec nvm : `nvm install 22 && nvm alias default 22`. |
| Le site de candidature refuse le PDF (« contenu actif ») | Demandez « fais la version sans liens du CV Acme » ou lancez `find-job build ID --sans-liens`. |
| Le tableau de bord ne s’ouvre pas tout seul sous WSL | Copiez l’adresse affichée dans votre navigateur Windows. |
| L’éditeur du tableau de bord reste vide | Le serveur date d’avant une mise à jour : arrêtez-le et relancez `find-job ui`. |

## Ce que fait find-job

### Adapter un CV à une offre

1. **Lecture de l’offre** : données structurées (JobPosting) si le site en publie, sinon texte de la page. Pour LinkedIn, Indeed ou une page rendue en JavaScript, l’agent lit la page autrement ou vous demande de coller le texte. Plusieurs adresses d’un coup sont traitées une par une, chacune dans son dossier.
2. **Analyse** (`analyse.json`) : exigences essentielles, mots-clés, langue, ce que votre CV prouve déjà.
3. **Réécriture** : les mots-clés de l’offre vont dans les compétences et le titre, sur une page au maximum. Votre **accroche**, vos **projets** et la mise en forme du modèle restent tels quels. Les mots-clés absents de votre CV de base sont listés à la livraison : vous retirez ce que vous ne maîtrisez pas.
4. **Lettre de motivation** : 200 à 300 mots, faits concrets tirés du CV, posture d’étudiant qui veut apprendre pour un stage, sans formules toutes faites. Votre propre modèle `lettre.tex` à la racine remplace celui de find-job.
5. **Contrôle qualité** (`find-job check`) :

| Bloquant | Avertissement |
|---|---|
| compilation, une page (CV et lettre), noms `cv_`/`lettre_<entreprise>`, texte provisoire, coordonnées du modèle, accroche modifiée, technologie ajoutée dans un projet, lettre absente, caractères absents de la police | score sous 100 %, chiffres ou dates absents du modèle, formules toutes faites ou ton de sachant dans la lettre, préambule modifié, lignes qui débordent |

Le **score de correspondance** est la part pondérée des mots-clés de l’offre réellement présents dans le CV (les essentiels comptent double).

### Tableau de bord

- **Tableau de bord** : candidatures envoyées, CV adaptés, entretiens et taux de réponse sur 24 h, 48 h, 7 jours, 30 jours ou 3 mois ; « à faire maintenant » (dossiers à finir, prêts à envoyer, relances, dates limites).
- **Candidatures** : lien vers l’offre en un clic, CV et lettre (PDF et TeX), statut, historique, verdict qualité, notes.
- **Éditeur** (✎) : le `.tex` du CV ou de la lettre à côté de son PDF ; **Ctrl+S** enregistre, recompile et relance les contrôles, comme sur Overleaf, sans dépenser de tokens.
- **Semaine** : objectifs et routines de la semaine (la semaine 1 est celle où vous commencez), prévu face au réalisé, bilan et leçons.

Le serveur n’écoute que sur votre ordinateur (127.0.0.1) et se met à jour en direct quand l’agent travaille.

### Où sont vos fichiers

```text
recherche-emploi/
├── cv.tex                          votre modèle (jamais modifié)
├── candidatures/
│   └── 2026-11-09_acme_data_engineer/
│       ├── cv_acme.tex   cv_acme.pdf
│       ├── lettre_acme.tex   lettre_acme.pdf
│       ├── offre.md   analyse.json   qualite.json
└── .find-job/                      historique, plans, profil, journal
```

### Commandes

L’agent s’en sert pour vous ; vous pouvez aussi les lancer vous-même. `find-job help` liste tout. Les principales : `init`, `resume`, `offer URL…`, `prepare`, `check`, `build --sans-liens`, `list --since 7j`, `set ID --status postulee`, `plan set|done|progress|review`, `ui`, `setup`. Détail : [référence de la mémoire](skills/find-job/references/memoire.md).

## Développer

```bash
npm test          # tests : domaine, LaTeX de bout en bout, API du serveur, éditeur
npm run ui        # interface sur l’espace exemple/ (CV fictif)
```

Organisation et règles : [AGENTS.md](AGENTS.md).
