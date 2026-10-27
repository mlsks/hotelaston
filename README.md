# Hôtel Aston La Scala — refonte du site (maquette fonctionnelle)

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Accueil + toutes les vues (chambres, restaurants, séminaires, offres, accès, avis, FAQ, pages SEO, blog), gabarits des fiches chambres et services, données JSON éditables, JSON-LD `Hotel` / `Restaurant` / `BarOrPub` / `FAQPage` (+ `HotelRoom` injecté par fiche) |
| `styles.css` | Design system (tokens, typographie Cormorant Garamond + Jost, échelle `z-index`, header desktop/mobile, tableau des salles → fiches via container query) |
| `remotion-vanilla.js` | Moteur `interpolate` / `spring` / `measureSpring` / `Easing` porté de Remotion + routeur, réservation, sliders, menu, avis, offres, devis, carte, vidéos, chat |
| `remotion-compositions.tsx` | Compositions Remotion des boucles vidéo (`HeroRooftop`, `HeroRooftopPortrait`, `MoonBarLive`) |
| `media/hero-piscine-*.webp` | Photo actuelle du Hero (source `hotel-aston-la-scala-piscine-landscape.jpg`) : 1024 / 1600 / 2400 px de large et recadrage portrait 900×1600 pour les téléphones. La vidéo est prête à revenir : balise commentée dans `index.html` |
| `media/` | Vidéos du Hero : sources `video_hero.mp4` / `video_hero_mobile.mp4` et boucles lues par le site `video_hero_loop.mp4` / `video_hero_mobile_loop.mp4` (ralenties 2x, aller-retour sans raccord, choisies par l'attribut `media` des `<source>`), posters ; boucle Remotion du Moon Bar ; anciennes boucles Hero Remotion (non utilisées) |
| `video/` | Projet Remotion minimal qui rend `remotion-compositions.tsx` |
| `img/`, `favicon.ico`, `apple-touch-icon.png`, `site.webmanifest` | Logos du header (blanc / or) et favicon « pastille » : disque bleu #14385c, couronne blanche du logo (16 à 512 px) |

## Lancer en local

```bash
python -m http.server 8765 --directory hotelaston
```

Puis http://localhost:8765 (ajouter `#/…?audit` à une URL pour surligner les données à confirmer).

## Régénérer les vidéos

Boucles Remotion (Moon Bar) :

```bash
npm --prefix hotelaston/video run render:all
```

Boucles du Hero (ralenti 2x par interpolation, aller-retour adouci, une seule image clé, étalonnage contraste / vibrance / netteté CAS ; nécessite ffmpeg, numpy, opencv-python) :

```bash
python hotelaston/video/make_hero_loop.py hotelaston/media/video_hero.mp4 hotelaston/media/video_hero_loop.mp4 tmp/dense_desk 27 1920:1080
python hotelaston/video/make_hero_loop.py hotelaston/media/video_hero_mobile.mp4 hotelaston/media/video_hero_mobile_loop.mp4 tmp/dense_mob 26
```

Puis régénérer les posters (première image de chaque boucle) :

```bash
ffmpeg -y -i hotelaston/media/video_hero_loop.mp4 -frames:v 1 -c:v libwebp -quality 80 hotelaston/media/video_hero-poster.webp
```

## Avant mise en ligne

1. **Une vraie page par vue.** Les vues sont servies sous `#/chemin` ; Google n'indexe pas les fragments. Générer une page HTML statique par vue (les `<link rel="canonical">` pointent déjà vers `/fr/chemin`).
2. **Moteur de réservation.** Valider avec D-Edge les noms de paramètres et les codes chambre / tarif (`BOOKING_ENGINE` dans `remotion-vanilla.js`).
3. **Avis.** Remplacer les avis de démonstration (`#data-reviews`) par le flux Google Business Profile.
4. **Images.** Les photos viennent du CDN actuel (JPEG/PNG) : les convertir en WebP et les héberger avec le site.
5. **Données à confirmer** (repérées par la classe `verify`, visibles avec `?audit`) :
   - prix, économies et conditions des offres séjour et séminaire ;
   - politique d'annulation, moyens de paiement ;
   - capacités cabaret / banquet des salons, classe / U / cabaret de Matisse, toutes les données de L'Aston Club ;
   - itinéraire tram depuis la gare ; programme Live Music et lieu des soirées quand le Moon Bar est ouvert.
   - Règle des bars (confirmée par l'hôtel) : un seul bar ouvert à la fois, le Moon Bar quand le temps le permet, sinon L'Aston Club. Pas de mention « jazz ». Le JSON-LD de L'Aston Club n'a donc pas d'horaires fixes.
6. **Incohérences du site actuel à trancher** : saison du Moon Bar (mai–octobre dans la FAQ, juin–septembre pour la piscine), fermeture (00h30 ou minuit), étage (7e ou 8e), numéro de réservation du rooftop (04 92 17 53 09 dans la FAQ, 04 89 22 20 06 sur la page bar).
7. **Réciprocité Résidence.** Ajouter sur residenceastonlascala.com le lien vers l'hôtel (extrait en commentaire en bas de `index.html`).
8. **Page passerelle `#/appartements`.** Les trois liens « Nos appartements » (menu mobile, bandeau de la page Chambres, pied de page) y mènent. Les liens vers residenceastonlascala.com s'ouvrent en nouvel onglet et portent `utm_source=hotel-aston&utm_medium=referral&utm_campaign=passerelle-appartements&utm_content=<emplacement>` (`cta-haut`, `cta-bas`, `faq`, ou le type d'appartement). Données et photos relevées sur le site de la Résidence le 25/10/2026. À confirmer :
   - 17 appartements annoncés, mais le détail par type n'en donne que 16 (4 Rotonde, 5 Vue Ville, 1 Sous les toits, 5 Côté Impasse, 1 PMR) ;
   - accès des clients de la Résidence à la piscine du toit (non indiqué) ;
   - moteur de réservation de la Résidence : D-Edge `J1P3`, `hotelId=29961` (différent de celui de l'hôtel), à valider avant d'y envoyer directement les dates saisies sur l'hôtel.
