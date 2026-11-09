# Planifier la semaine et en tirer des leçons

Le but n’est pas de remplir un agenda mais de rendre la recherche régulière et mesurable, puis d’apprendre de l’écart entre le prévu et le réalisé.

## 1. Préparer

- `find-job resume` : leçons récentes, score des dernières semaines, CV prêts non envoyés, relances dues, préférences.
- Si les semaines précédentes plafonnent à 40–60 %, le plan était trop ambitieux : réduire plutôt qu’ajouter. Au-dessus de 90 % plusieurs semaines, monter légèrement.
- Les leçons des bilans deviennent des routines ou des règles (« Postuler avant 11 h » → routine du lundi au jeudi).

## 2. Objectifs (3 au plus, mesurables)

| `metric` | Mesuré par | Exemple |
|---|---|---|
| `applications` | statuts « postulée » de la semaine | Envoyer 8 candidatures ciblées |
| `prepared` | CV adaptés de la semaine | Adapter 10 CV |
| `followups` | statuts « relancée » | Relancer 3 recruteurs |
| `interviews` | statuts « entretien » | Obtenir 1 entretien (à éviter comme objectif principal : peu maîtrisable) |
| `manual` | `find-job plan progress` | Contacter 5 personnes, 2 candidatures spontanées |

Préférer des objectifs d’action (envoyer, relancer, contacter) à des objectifs de résultat. Un ordre de grandeur réaliste avec un CV adapté par offre : 1 à 3 candidatures de qualité par jour travaillé.

## 3. Routines (habitudes datées)

Jours ISO : 1 = lundi … 7 = dimanche. Une routine par habitude, libellé court et concret, avec la durée si utile. Exemples : veille des offres (30 min, lun–ven), bloc candidatures avant 11 h (lun–jeu), relances (mar et ven), réseau (mer), préparation d’entretien (jour J−1). Laisser au moins un jour sans routine.

## 4. Fichier de plan

```json
{
  "week": "S1",
  "objective": "Décrocher deux entretiens de data engineer à Lyon",
  "goals": [
    { "key": "candidatures", "label": "Envoyer 8 candidatures ciblées", "metric": "applications", "target": 8 },
    { "key": "relances", "label": "Relancer 3 recruteurs", "metric": "followups", "target": 3 },
    { "key": "reseau", "label": "Contacter 5 personnes", "metric": "manual", "target": 5, "unit": "messages" }
  ],
  "routines": [
    { "key": "veille", "label": "Veille des offres (30 min)", "days": [1, 2, 3, 4, 5], "minutes": 30 },
    { "key": "postuler", "label": "Postuler avant 11 h", "days": [1, 2, 3, 4] }
  ],
  "notes": "Semaine courte : jeudi après-midi pris."
}
```

- `week` facultatif : semaine en cours par défaut, ou semaine 1 si la recherche n’a pas commencé. Accepte `"S2"` (deuxième semaine de recherche) ou un identifiant ISO (`"2026-W45"`).
- `key` stable : réutiliser les mêmes clés d’une semaine à l’autre pour comparer, et lors d’une mise à jour pour garder les coches.
- `find-job plan set --file .find-job/cache/plan-S1.json`.

## 5. Pendant la semaine

- « J’ai fait ma veille » → `find-job plan done veille` (`--day` pour un autre jour, `--undo` pour décocher).
- « J’ai écrit à 2 personnes » → `find-job plan progress reseau 2 --add`.
- Les candidatures et relances se comptent seules dès que leur statut est enregistré.
- Le score compare la part réalisée à la part de semaine écoulée : « en avance », « dans le rythme », « en retard ». En retard un mercredi : proposer d’alléger ou de décaler, pas de culpabiliser.

## 6. Bilan

1. `find-job plan show` : écarts par objectif et par jour.
2. Une ou deux questions : qu’est-ce qui a aidé ? qu’est-ce qui a empêché ?
3. Formuler 2 à 4 leçons **actionnables** (« Bloquer 9 h–11 h pour postuler » plutôt que « être plus organisé »).
4. Enregistrer :

```json
{
  "wins": "Les candidatures du matin ont reçu plus de réponses.",
  "blockers": "Trop de temps passé par CV le lundi.",
  "lessons": ["Postuler avant 11 h", "Limiter la veille à 30 minutes"],
  "nextFocus": "Décrocher deux entretiens",
  "mood": 4
}
```

`find-job plan review --file .find-job/cache/bilan-S1.json [--week S1]`. `mood` (1–5) est facultatif. Le score de la semaine est figé avec le bilan.
