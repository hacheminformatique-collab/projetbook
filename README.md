# BOOKILI

Site de recherche et de réservation de prestations beauté et bien-être en Algérie.
Le site public est une application React/Vite statique. Les endpoints PHP et la
base MySQL/MariaDB résident sur le même hébergement cPanel.

## Développement local

Prérequis : Node.js 20.9 ou supérieur pour construire le site, et PHP 8.1 ou
supérieur pour tester l'API.

```bash
npm ci
npm run dev
```

Le site de développement s'ouvre sur <http://localhost:5173>. Les vérifications
du projet sont :

```bash
npm run lint
npm run build
php -l public/api/health.php
php -l public/api/database.php
```

Le serveur Node.js n'est nécessaire que pour construire le site localement. Il
n'est pas nécessaire sur cPanel : le dossier généré `dist/` contient le site
statique et l'API PHP.

## Installation sur cPanel

1. Dans **MySQL Databases**, créer une base et un utilisateur, puis leur
   attribuer les droits nécessaires. cPanel ajoute souvent le préfixe du compte
   devant les deux noms.
2. Dans **phpMyAdmin**, sélectionner cette base et importer
   `database/schema.sql`.
3. Créer `config.php` dans `public/api/`, à partir de
   `public/api/config.example.php`, puis renseigner l'hôte, le nom de base,
   l'utilisateur et le mot de passe fournis par cPanel. `.gitignore` exclut ce
   fichier du dépôt, et le fichier `.htaccess` de l'API en interdit l'accès web.
4. Construire le projet avec `npm ci && npm run build`, puis téléverser **le
   contenu de `dist/`** dans `public_html/` avec le Gestionnaire de fichiers ou
   FTP.
5. Vérifier `https://votre-domaine/api/health.php`. Une réponse
   `{"status":"ok"}` confirme que PHP et MySQL communiquent.

Le serveur doit avoir PHP 8.1+ avec PDO MySQL, MySQL/MariaDB et Apache avec
`mod_rewrite` pour les pages de l'application. Aucun processus Node.js à
maintenir sur le serveur.

## État du projet

Le socle comprend la page d'accueil et sa FAQ, une recherche par catégorie et
les 58 wilayas algériennes, ainsi que des pages d'attente pour les espaces
client et professionnel. L'annuaire réel, les comptes et les rendez-vous
restent à développer. Le schéma MySQL initial pour les comptes, profils,
demandes professionnelles, salons et prestations est disponible dans
`database/schema.sql`.

Les rendez-vous ne doivent pas être stockés dans des fichiers JSON : la
réservation nécessitera des transactions SQL afin d'éviter les créneaux en
double et de séparer les données de chaque établissement.
