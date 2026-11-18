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

Le test de gestion des images nécessite lui aussi une base jetable sans
super-admin déjà créé :

```bash
BOOKILI_TEST_URL=http://localhost:8765 BOOKILI_TEST_SETUP_TOKEN=cle_de_test python3 tests/homepage-image.py
```

Le test `tests/bookings.py` couvre l'inscription et la validation pro, la
publication, la recherche, les disponibilités, les droits d'accès, les
modifications, les annulations et deux réservations concurrentes. Utiliser
une **nouvelle base jetable**, une clé de configuration valide et plusieurs
workers PHP pour exercer la concurrence réelle :

```bash
PHP_CLI_SERVER_WORKERS=4 npm run dev:api
BOOKILI_TEST_URL=http://localhost:8765 BOOKILI_TEST_SETUP_TOKEN=cle_de_test python3 tests/bookings.py
```

Le premier processus reste dans un terminal pendant que le test s'exécute
dans un autre. Ne jamais utiliser ces tests de création de données en production.

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
`database/migrations/003_super_admin_setup.sql`, puis
`database/migrations/004_homepage_image.sql` et
`database/migrations/005_booking.sql` et
`database/migrations/006_appointment_notifications.sql` dans phpMyAdmin,
uniquement pour les migrations non encore appliquées. Les nouvelles
installations obtiennent ces tables directement via `database/schema.sql`.

Le serveur doit avoir PHP 8.1+ avec PDO MySQL, MySQL/MariaDB et Apache avec
`mod_rewrite` pour les pages de l'application. L'extension PHP **GD**, avec
prise en charge des formats JPEG, PNG et WebP, est nécessaire pour changer
l'image d'accueil. L'extension **EXIF** est également nécessaire pour orienter
correctement les photos JPEG. Aucun processus Node.js à maintenir sur le
serveur.

Pour les e-mails, créez dans cPanel une adresse d'expédition sur votre domaine,
puis renseignez `mail_from` et `mail_from_name` dans
`bookili-config.php` (hors de `public_html`). Ajoutez ensuite une tâche cron
cPanel, par exemple :

```bash
*/15 * * * * /usr/local/bin/php /home/UTILISATEUR_CPANEL/public_html/api/send-notifications.php
```

Le chemin PHP peut être `/usr/bin/php` selon l'hébergeur ; utilisez la version
PHP 8.1+ avec PDO MySQL. Testez le chemin et la configuration en lançant
manuellement la commande sans `*/15 * * * *`. `mail()` doit pouvoir transmettre
à l'agent d'envoi local de l'hébergeur. Configurez SPF/DKIM et vérifiez la
réception de test ; une transmission acceptée par cPanel ne garantit pas la
livraison en boîte de réception. Tant que le cron n'est pas activé, les
notifications restent en attente et les rappels peuvent arriver en retard.
Pour tester le worker sans envoyer de vrais e-mails, `tests/fake-sendmail.sh`
capture les messages dans le fichier défini par `BOOKILI_TEST_MAILBOX` et
`BOOKILI_TEST_MAIL_FAIL=1` simule un refus temporaire. Utilisez exclusivement
une base jetable et des comptes de test.

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

Depuis `/super-admin`, le super-admin peut choisir une image de couverture
JPEG, PNG ou WebP (2 Mo, 8 mégapixels et 6 000 pixels par côté maximum) ou la
supprimer pour rétablir le fond gris. L'image est stockée en base et réencodée
par GD ; les métadonnées sont supprimées. Les réglages PHP cPanel
`upload_max_filesize` et `post_max_size` doivent permettre un envoi de 2 Mo
avec l'enveloppe du formulaire ; la limite MySQL `max_allowed_packet` doit
également dépasser 2 Mo.

## Salon, annuaire et réservations

Après validation commerciale, le professionnel accède à
`/espace-professionnel` avec quatre onglets : **Agenda**, **Caisse**,
**Clients** et **Admin**. Dans Admin, il ajoute ses prestations (catégorie,
durée et tarif en DA), renseigne ses horaires et publie le salon. Un salon
reste masqué par défaut ; sa publication exige au moins une prestation
active et un jour d'ouverture. Une prestation peut être modifiée ou masquée
sans supprimer l'historique.

L'annuaire `/recherche` filtre les salons publiés par nom de salon,
prestation, ville, wilaya et catégorie, avec pagination. La fiche
`/salons/ID` présente les prestations, l'adresse, le téléphone et les
disponibilités. Les comptes suspendus et les salons masqués ne sont pas
réservables.

Un client connecté peut confirmer un créneau, retrouver ses rendez-vous à
venir ou passés dans `/espace-client`, puis modifier la prestation et le
créneau ou annuler avant le début. Le professionnel consulte l'agenda d'une
journée et peut annuler les rendez-vous futurs ; l'onglet Clients ne montre
que les clients ayant un rendez-vous non annulé dans son propre salon.

**Périmètre de cette version :**
- Un agenda unique par établissement, donc un seul rendez-vous à la fois ;
  la gestion de plusieurs collaborateurs n'est pas encore implémentée.
- Horaires hebdomadaires avec une plage continue par jour, sans fermeture
  exceptionnelle ni passage à minuit. Les créneaux commencent toutes les
  15 minutes depuis l'ouverture et doivent contenir toute la prestation.
- Les dates sont calculées explicitement dans le fuseau `Africa/Algiers`.
  Réservation et modification de créneau possibles jusqu'à 60 jours à l'avance.
- La confirmation est immédiate à l'écran, sans validation manuelle
  supplémentaire du professionnel. Une file transactionnelle programme
  confirmation, modification, annulation et rappels à J−7 et J−1. Le cron
  les traite toutes les 15 minutes avec reprises progressives, jusqu'à cinq
  tentatives. Une modification invalide les rappels précédents et les
  reprogramme ; un rappel dont l'heure est déjà passée n'est pas envoyé.
  Configurez l'expéditeur et le cron ci-dessus : sans eux, les e-mails ne
  partiront pas. Aucun paiement n'est effectué en ligne.
- Les mutations d'agenda sont sérialisées par verrou InnoDB sur le salon et
  la disponibilité est revérifiée avant enregistrement pour éviter les
  doubles réservations. Une modification échouée conserve le rendez-vous initial.
- La mise en file des courriels est dans la même transaction que le rendez-vous ;
  si elle échoue, la réservation est annulée aussi.
- Le prix et la durée sont figés pour une réservation existante. Une
  modification volontaire de la réservation adopte les caractéristiques
  affichées de la prestation choisie ; un changement de tarif ou de durée
  entre affichage et confirmation oblige à recharger la fiche.
- Modifier des horaires ou masquer un salon ne supprime pas ses rendez-vous
  déjà confirmés. Leur annulation reste possible même si le salon est masqué.

La caisse, les stocks, les cartes cadeaux, la gestion multi-collaborateurs,
les abonnements et les campagnes marketing restent à développer.

## État du projet

Le socle comprend la page d'accueil et sa FAQ, une recherche par catégorie et
les 58 wilayas algériennes, des formulaires d'inscription client et
professionnel, la connexion par mot de passe, le tableau de bord de validation
des demandes professionnelles, la création initiale du super-admin, la
personnalisation de l'image d'accueil, la gestion du téléphone et du mot
de passe client, la configuration du salon, l'annuaire et le parcours de
réservation avec notifications e-mail et rappels programmés.
Le schéma MySQL crée les tables `accounts`, `client_profiles`,
`registration_rate_limits`, `professional_applications`,
`professional_profiles`, `salons`, `services`, `platform_setup`,
`homepage_image`, `salon_hours`, `appointments` et `notification_outbox`.
Pour une
base ayant déjà reçu la première version du schéma MySQL, appliquez
`database/migrations/002_registration_auth.sql`, puis
`database/migrations/003_super_admin_setup.sql`,
`database/migrations/004_homepage_image.sql`,
`database/migrations/005_booking.sql` et
`database/migrations/006_appointment_notifications.sql`, dans cet ordre,
uniquement si ces migrations ne sont pas déjà appliquées.
