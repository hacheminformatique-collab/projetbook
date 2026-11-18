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

Le site de développement s'ouvre sur <http://localhost:5173>.

Dans un deuxième terminal, lancer l'API PHP locale :

```bash
npm run dev:api
```

Le proxy Vite transmet `/api/*` à cette API. `BOOKILI_API_TARGET` permet de
changer l'adresse du serveur PHP. En local, l'API reste sans connexion tant que
la base MySQL cPanel n'a pas été configurée.

Les contrôles statiques du projet sont :

```bash
npm run lint
npm run build
php -l public/api/health.php
php -l public/api/database.php
```

Le test d'intégration `tests/client-account.py` crée des comptes et modifie
des mots de passe : l'exécuter uniquement sur une installation de test avec
une base jetable, jamais en production. Avec l'API de test démarrée :

```bash
BOOKILI_TEST_URL=http://localhost:8765 python3 tests/client-account.py
```

Pour tester aussi le refus d'accès d'un super-admin aux API client, définir
`BOOKILI_TEST_SETUP_TOKEN` avec la clé de configuration de cette installation
de test ; le test crée alors son premier super-admin.

Le serveur Node.js n'est nécessaire que pour construire le site localement. Il
n'est pas nécessaire sur cPanel : le dossier généré `dist/` contient le site
statique et l'API PHP.

## Installation sur cPanel

1. Dans **MySQL Databases**, créer une base et un utilisateur, puis leur
   attribuer les droits nécessaires. cPanel ajoute souvent le préfixe du compte
   devant les deux noms.
2. Dans **phpMyAdmin**, sélectionner cette base et importer
   `database/schema.sql`.
   Si vous aviez déjà importé l'ancien schéma PostgreSQL, créez une base MySQL
   neuve et importez ce schéma ; il n'est pas compatible avec PostgreSQL.
3. Créer `/home/UTILISATEUR_CPANEL/bookili-config.php` à partir de
   `public/api/config.example.php`, puis renseigner l'hôte, le nom de base,
   l'utilisateur et le mot de passe fournis par cPanel. Générez une clé de
   configuration avec `php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"` et
   placez-la dans `setup_token`. Le fichier est ainsi hors de `public_html`.
   En développement local, il reste possible d'utiliser `public/api/config.php`,
   qui n'est jamais inclus dans le dépôt.
4. Construire le projet avec `npm ci && npm run build`, puis téléverser **le
   contenu de `dist/`** dans `public_html/` avec le Gestionnaire de fichiers ou
   FTP.
5. Vérifier `https://votre-domaine/api/health.php`. Une réponse
   `{"status":"ok"}` confirme que PHP et MySQL communiquent.
6. Ouvrir `https://votre-domaine/gestion-commercial` pour créer le premier
   compte super-admin avec la clé, son adresse e-mail et un mot de passe fort.
   Retirer immédiatement `setup_token` du fichier de configuration après sa
   création. La création initiale est verrouillée en base et ne peut réussir
   qu'une fois.

Pour une base existante déjà installée, importer une fois
`database/migrations/003_super_admin_setup.sql` dans phpMyAdmin avant d'ouvrir
la gestion commerciale. Les nouvelles installations obtiennent cette table
directement via `database/schema.sql`.

Le serveur doit avoir PHP 8.1+ avec PDO MySQL, MySQL/MariaDB et Apache avec
`mod_rewrite` pour les pages de l'application. Aucun processus Node.js à
maintenir sur le serveur.

L'API sert un jeton CSRF de session, chiffre les mots de passe avec
`password_hash`, utilise des requêtes SQL préparées, limite les tentatives de
connexion et d'inscription et refuse les mots de passe de moins de 12
caractères. Les accès aux espaces client et professionnel sont contrôlés par
rôle dans la session PHP. Les demandes professionnelles restent en attente
jusqu'à leur validation commerciale.

L'espace client permet de consulter son profil, modifier son numéro de
téléphone et changer son mot de passe après vérification du mot de passe
actuel. Le changement de mot de passe est limité en nombre de tentatives et
accepte entre 12 et 72 octets pour éviter la troncature bcrypt. Les autres
sessions déjà ouvertes ne sont pas automatiquement déconnectées.

## État du projet

Le socle comprend la page d'accueil et sa FAQ, une recherche par catégorie et
les 58 wilayas algériennes, des formulaires d'inscription client et
professionnel, la connexion par mot de passe, le tableau de bord de validation
des demandes professionnelles, la création initiale du super-admin et la
gestion du téléphone et du mot de passe client.
L'annuaire réel et les rendez-vous restent à développer.
Le schéma MySQL crée les tables `accounts`, `client_profiles`,
`registration_rate_limits`, `professional_applications`,
`professional_profiles`, `salons`, `services` et `platform_setup`. Pour une
base ayant déjà reçu la première version du schéma MySQL, appliquez
`database/migrations/002_registration_auth.sql`, puis
`database/migrations/003_super_admin_setup.sql`, dans cet ordre.
