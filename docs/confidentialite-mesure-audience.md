# Paragraphe à ajouter à la politique de confidentialité

*À faire valider par l'hôtel (direction, juriste ou DPO). Les éléments entre crochets sont à compléter. Texte vérifié le 27/10/2026 contre le code des statistiques (`Backend/server/analytics/`, `Backend/templates-src/assets/track.js`).*

---

## Mesure d'audience

Pour comprendre comment notre site est utilisé et l'améliorer, nous mesurons sa fréquentation avec un outil que nous hébergeons nous-mêmes. Aucune donnée n'est transmise à un service tiers de statistiques ni de publicité.

**Sans cookie et sans identifiant durable.** Cette mesure ne dépose aucun cookie ni traceur sur votre appareil. Votre adresse IP n'est pas conservée : au moment de la visite, elle sert à déduire le pays et la région d'origine, et à calculer une empreinte technique valable une seule journée, qui permet de compter les visiteurs distincts du jour. Cette empreinte ne peut pas être reliée d'un jour à l'autre : nous ne pouvons pas vous reconnaître d'une visite à l'autre.

**Données collectées.** Nous enregistrons uniquement des informations générales sur la visite : pages consultées, site ou service d'où vous arrivez (son nom de domaine seulement), type d'appareil, langue, pays et région, dates de séjour et nombre de voyageurs recherchés dans le module de réservation, clics vers la réservation, le téléphone ou l'e-mail, et mesures de vitesse d'affichage. Aucun texte que vous saisissez (formulaires, chat) n'est enregistré par cette mesure. Ces données ne sont consultées que sous forme de statistiques globales.

**Finalités.** Connaître la fréquentation du site, savoir quels canaux nous amènent des visiteurs, mesurer l'efficacité de nos informations et offres, anticiper la demande et améliorer la rapidité du site.

**Durée de conservation.** Les données de visite sont supprimées automatiquement au bout de 13 mois. Seuls des totaux par jour, qui ne concernent plus aucune visite en particulier, sont gardés 25 mois pour comparer d'une année sur l'autre.

**Base légale.** Cette mesure repose sur notre intérêt légitime à suivre la fréquentation de notre site. Elle ne fait appel à aucun cookie ni traceur et ne sert qu'à produire des statistiques ; elle ne nécessite donc pas votre consentement préalable.

**Vous opposer à cette mesure.** Si vous activez l'option « Ne pas suivre » (Do Not Track) ou « Global Privacy Control » de votre navigateur, votre visite n'est pas comptabilisée. Vous pouvez aussi nous écrire à [adresse e-mail de contact] pour toute question sur cette mesure d'audience.

**Géolocalisation.** [Seulement si la base DB-IP est installée :] Le pays et la région sont déduits localement grâce à la base « IP Geolocation by DB-IP » (db-ip.com, licence CC BY 4.0), sans aucun envoi à un tiers.

---

### Points vérifiés dans le code

- « Ne pas suivre » et GPC : respectés, le script ne mesure rien (`track.js`, ligne 16).
- IP : jamais enregistrée ; empreinte = sel du jour + IP + navigateur, sel effacé le surlendemain (table `an_salts`).
- Texte saisi : jamais enregistré ; du site d'origine, seul le domaine est gardé (`server/analytics/ingest.js`).
- Purge : événements après 13 mois, agrégats après 25 mois.
- Si l'option « statistiques niveau 2 » (visiteurs qui reviennent, identifiant de 13 mois) est activée un jour, ce paragraphe ne suffira plus : il faudra un mécanisme de refus et une mise à jour du texte.
