# BOOKILI

Projet de plateforme de réservation beauté et bien-être en Algérie.

## Démarrage

Prérequis : Node.js 20.9 ou supérieur et npm.

```bash
npm ci
npm run dev
```

Le site est accessible sur <http://localhost:3000>. Pour vérifier le projet :

```bash
npm run lint
npm run build
```

## Connexion PostgreSQL

Créez une base et un utilisateur PostgreSQL dans cPanel. Copiez `.env.example`
vers `.env.local`, puis remplacez `DATABASE_URL` par les paramètres transmis
par l'hébergeur. Gardez cette valeur privée : ne la commitez jamais et ne la
placez jamais dans une variable `NEXT_PUBLIC_*`.

Vérifiez la connexion depuis l'environnement qui hébergera l'application :

```bash
npm run db:check
```

Le pilote et le pool PostgreSQL sont prévus pour les accès côté serveur. Les
tables de l'application et leurs migrations seront ajoutées avant d'enregistrer
des comptes ou rendez-vous.

## État du projet

Cette première étape comprend la page d'accueil responsive, sa FAQ et des pages
indiquant que les espaces client et professionnel sont en préparation. Le
parcours de recherche accepte un nom de salon ou une prestation, une catégorie,
et les 58 wilayas algériennes. Les critères sont conservés dans l'URL. L'annuaire
et la réservation ne sont pas encore connectés : aucun résultat fictif n'est
affiché.

L'authentification, les rendez-vous, les espaces d'administration, le
téléversement de l'image d'accueil et l'installation comme PWA restent à
développer. Le fond de l'accueil est gris par défaut.
