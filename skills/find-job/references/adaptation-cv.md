# Critères de qualité : CV adapté et lettre de motivation

Un recruteur lit un CV en quelques secondes, souvent après un filtre automatique (ATS). Le dossier doit passer les deux : contenir **tous** les mots de l’offre et donner envie à un humain d’aller plus loin.

## 1. Règles fixes

| Règle | Contrôle |
|---|---|
| CV sur **une page**, jamais plus | `pages` (bloquant) |
| Lettre sur **une page** | `lettre:pages` (bloquant) |
| **100 %** des mots-clés de `analyse.json` dans le CV | `mots-cles` (avertissement tant que < 100 %) |
| Accroche du CV de base **recopiée mot pour mot** | `accroche` (bloquant) |
| Aucun chiffre, date, diplôme, employeur ou ancien intitulé inventé | `faits` |
| Projets et expériences **identiques au CV de base** (stack, faits, liens) | `projets` (bloquant si une technologie ajoutée y apparaît) |
| Stage, alternance, premier emploi : posture d’étudiant qui vient apprendre en contribuant | `posture` (lettre) |
| Mise en forme et coordonnées du modèle conservées | `modele`, `identite` |

## 2. Mots-clés : viser 100 %

Choix de la personne : elle préfère un CV qui coche toute l’offre et retirer elle-même ce qu’elle ne maîtrise pas. Donc :

- Mettre dans `analyse.json` tous les termes utiles de l’offre : technologies, outils, méthodes, domaine métier, type de mission (« tests », « documentation technique »), qualités demandées (« rigueur », « travail en équipe »), niveau d’études, langue.
- Les intégrer **uniquement là où rien n’est vérifiable** :
  1. dans la section Compétences, à la bonne ligne (C# avec les langages, Semantic Kernel avec les orchestrateurs) ;
  2. dans la ligne soft skills pour les qualités (« rigueur », « travail en équipe ») ;
  3. dans le titre sous le nom, si cela reste vrai et naturel (jamais dans l’accroche, qui reste celle du CV de base) ;
  4. jamais dans une liste fourre-tout ni dans du texte caché.
- **Ne jamais toucher aux projets ni aux expériences** : leur stack (« Choix techniques »), leurs descriptions, leurs liens et leurs faits restent mot pour mot ceux du CV de base. Les projets sont consultables sur GitHub et en ligne : une technologie ajoutée qui n’y a pas servi se voit tout de suite et décrédibilise tout le CV.
- Écrire les termes comme l’offre les écrit (« PostgreSQL » et non « Postgres » si l’offre écrit PostgreSQL). `A|B` dans `analyse.json` accepte plusieurs formulations.
- Le contrôle `ajouts` liste les mots-clés présents dans le CV adapté mais absents du CV de base et des faits confirmés. Cette liste est **toujours** donnée à la livraison.
- Ce qui reste interdit : inventer un chiffre, une date, un diplôme, une certification, un employeur, un intitulé de poste passé ou un résultat. Un mot-clé ajouté décrit une compétence ; il ne fabrique pas d’expérience.

## 3. La posture : apprendre en contribuant

Pour un stage, une alternance ou un premier emploi (`seniority` de l’analyse, ou préférence `posture` du profil), la personne se présente comme **un étudiant qui a déjà essayé des choses et qui vient apprendre auprès de l’équipe, en y contribuant**. Pas comme un expert qui arrive pour accomplir ou réparer.

- **Ce qu’elle a fait, dit simplement** : « j’ai découvert… en réalisant », « je me suis formé à … sur mes projets », « j’ai pu pratiquer… », « j’y ai appris que… ». Les projets sont des preuves de curiosité et d’apprentissage, pas des titres de gloire.
- **Ce qu’elle veut apprendre, dit précisément** : « apprendre à tester des agents à l’échelle d’une plateforme », « progresser au contact de consultants qui mènent des missions ». Le désir d’apprendre porte sur le métier réel de l’équipe, pas sur des généralités.
- **Ce qu’elle apporte, dit modestement** : « contribuer à », « participer à », « aider l’équipe sur », « avec ce que j’ai déjà pratiqué ». L’apprentissage pèse au moins autant que la contribution.
- **Assurée sur les faits, modeste sur le niveau** : pas d’excuse ni d’auto-dévalorisation (« je n’ai que peu d’expérience »), mais pas non plus de posture de sachant.

À éviter, puis à préférer :

| Trop affirmatif | Juste |
|---|---|
| je transforme des LLMs en outils concrets | je me suis formé aux LLMs en réalisant mes propres outils |
| je construis des agents IA et je les teste | j’ai découvert les agents IA en les construisant et en les testant sur mes projets |
| pour fiabiliser les agents de Joule Studio | pour apprendre à fiabiliser des agents à grande échelle en contribuant aux tests de Joule Studio |
| pour bâtir des automatisations IA au service de vos clients | pour apprendre le métier de consultant en participant à vos projets d’IA générative |
| j’apporte une pratique concrète des LLMs | je pourrai contribuer avec ce que j’ai déjà pratiqué sur les LLMs |
| je maîtrise, expert, solide expérience, j’excelle | (à retirer) |

Le contrôle `posture` vérifie, pour ces offres, que la lettre dit ce que la personne veut apprendre, et repère les tournures de sachant. Pour un poste confirmé, la posture redevient celle d’un professionnel qui apporte son expérience.

## 4. L’accroche : celle du CV de base, mot pour mot

L’accroche du CV de base (le paragraphe de présentation sous l’en-tête, ou la section Profil / Résumé) est **recopiée telle quelle** dans chaque CV adapté : ni reformulée, ni raccourcie, ni enrichie de mots-clés. C’est la personne qui l’écrit et la fait évoluer dans son CV de base ; le ciblage se fait par le titre, les compétences, l’ordre des projets et la lettre.

Le contrôle `accroche` (bloquant) vérifie que le texte de l’accroche du CV de base se retrouve à l’identique dans le CV adapté. Si elle ne tient plus sur une page, on condense ailleurs (§6). Pour un CV traduit dans la langue de l’offre, l’accroche est traduite fidèlement, sans rien ajouter ni retirer.

## 5. Le reste du CV

- **Titre** (sous le nom) : l’intitulé visé, dans la langue de l’offre.
- **Compétences** : celles de l’offre en premier dans chaque ligne ; retirer ce qui distrait.
- **Projets et expériences** : contenu **identique au CV de base** (intitulés, stack technique, puces, liens, dates). Seuls changements permis : l’ordre des projets (le plus pertinent pour l’offre en premier) et, si la page déborde, le retrait d’une puce entière ou d’un projet entier peu pertinent. On ne reformule pas une puce, on n’y ajoute ni mot-clé ni technologie.
- **Langue** : celle de l’offre (CV traduit fidèlement si l’offre est en anglais ; le signaler).
- **Corriger au passage** les coquilles du modèle (accents, espaces avant virgule, doublons) dans la copie adaptée.

## 6. Tenir sur une page

Si `pages` échoue, dans cet ordre (l’accroche n’est jamais raccourcie) : compacter la formation (une ligne par diplôme), raccourcir les centres d’intérêt et soft skills, alléger la section Compétences, puis retirer une puce entière ou un projet entier peu pertinent (sans jamais reformuler ce qui reste). Ne pas réduire la police, les marges ni les espacements du préambule du modèle.

## 7. La lettre de motivation

Une page, 200 à 300 mots, trois ou quatre paragraphes courts, signée du nom de la personne. Elle doit donner l’impression d’avoir été écrite par la personne, pour cette entreprise, ce jour-là.

1. **Ouverture** (2–3 phrases) : pourquoi ce poste et cette entreprise, avec un détail précis tiré de l’offre ou de l’activité de l’entreprise, et ce que la personne aimerait y apprendre. Pas de « je me permets de vous adresser ma candidature ».
2. **Ce qu’elle a déjà essayé** (3–4 phrases) : une ou deux réalisations du CV racontées concrètement (ce qui a été fait, comment) et surtout **ce qu’elle en a appris**, reliées à une mission de l’offre. Les technologies citées pour un projet sont exactement celles du CV de base.
3. **Apprendre en contribuant** (2–3 phrases) : ce qu’elle souhaite apprendre auprès de l’équipe et comment elle pourrait y contribuer, modestement ; contrat, durée et date de début.
4. **Fin** (1–2 phrases) : proposer un échange, formule de politesse simple (« Je serais heureux d’en parler avec vous. Je vous prie d’agréer, Madame, Monsieur, mes salutations distinguées. »).

Pour un ton naturel :

- phrases courtes et variées, à la première personne, vocabulaire de tous les jours ;
- des faits et des noms précis plutôt que des qualités affirmées ;
- pour un stage ou une alternance, la posture du §3 : curieux, désireux d’apprendre, assuré sur ce qu’il a fait, jamais en position de donneur de leçons (« un outil appelé par des agents doit rester stable », « une bonne idée technique ne vaut rien si… » sonnent comme des leçons : les transformer en « j’y ai appris que… ») ;
- aucune formule toute faite : « je me permets », « c’est avec un grand intérêt », « passionné », « dynamique », « fort de », « je suis convaincu », « valeur ajoutée », « relever des défis », « au sein de votre entreprise », « n’hésitez pas », « véritable », « pleinement » (le contrôle `naturel` les repère) ;
- pas de tirets cadratins (—), pas de listes à puces, pas de gras ;
- ne pas recopier le CV : la lettre raconte ce que le CV liste.

Le modèle `lettre_<entreprise>.tex` est pré-rempli (nom, entreprise, poste, date). Remplacer chaque `[à compléter]` : coordonnées (courriel et téléphone du CV, ville) et corps. `\\destinataire` peut prendre le nom d’une personne si l’offre le donne. Une personne qui préfère son propre modèle place `lettre.tex` à la racine de son espace.

## 8. Fichier `analyse.json`

```json
{
  "company": "Veepee",
  "title": "Stage - Développeur(euse) IA Générative",
  "language": "fr",
  "seniority": "stage",
  "posture": "etudiant",
  "mustHave": ["Python", "JavaScript", "IA générative|GenAI", "Bac+5|ingénieur", "anglais"],
  "keywords": ["GPT", "LLM", "LangChain", "Semantic Kernel", "bases de données vectorielles", "calcul de distance|similarité cosinus", "RAG", "C#", "applications web", "tests", "documentation technique", "e-commerce", "rigueur", "travail en équipe"],
  "proven": ["Python", "JavaScript", "LLM", "RAG", "LangChain", "pgvector"],
  "angle": "Assistant RAG multi-modèles déjà en ligne et projet e-commerce avec Decathlon et Zara."
}
```

- `mustHave` : exigences explicitement obligatoires ; elles pèsent double dans le score.
- `keywords` : tous les autres termes utiles, écrits comme dans l’offre.
- `seniority` / `posture` : `stage`, `alternance`, `junior`… déclenchent le contrôle de posture ; `"posture": "etudiant"` le force, `"posture": "confirme"` le désactive.

## 9. Lecture du rapport `find-job check`

| Contrôle | Niveau | Action |
|---|---|---|
| `compilation` | bloquant | Lire `build.errors` (ligne + message) et corriger le .tex |
| `pages` | bloquant | Condenser (§6) jusqu’à une page |
| `nommage` | bloquant | `cv_<entreprise>.tex`, PDF à côté |
| `brouillon` | bloquant | Retirer TODO, XXX, ???, lorem |
| `identite` | bloquant | Remettre courriel, téléphone, liens du modèle |
| `caracteres` | bloquant | Remplacer le caractère ou utiliser la commande LaTeX adaptée |
| `mots-cles` | avertissement | Intégrer les termes manquants jusqu’à 100 % |
| `accroche` | bloquant | Remettre l’accroche du CV de base, mot pour mot |
| `lettre:posture` | avertissement | Stage/alternance : dire ce qu’on veut apprendre, retirer les tournures de sachant (§3) |
| `faits` | avertissement | Corriger, ou faire confirmer puis `find-job profile fact` |
| `modele` | avertissement | Revenir au préambule du modèle ou justifier |
| `adaptation` | avertissement | Le CV est identique au modèle : l’adapter |
| `debordements` | avertissement | Raccourcir les lignes signalées |
| `ajouts` | info | À donner à la personne à la livraison |
| `projets` | bloquant / avertissement | Bloquant : une technologie absente du CV de base apparaît dans un projet ou une expérience, la retirer. Avertissement : mots nouveaux dans ces sections, revenir au texte du modèle |
| `sections` | info | Vérifier qu’une section retirée l’a été volontairement |
| `letter.*` | — | Lettre : `lettre` absente, `compilation`, `pages`, `nommage`, `brouillon` bloquants ; `entreprise`, `coordonnees`, `longueur`, `naturel`, `posture` en avertissement |
