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

Le test `tests/inventory.py` utilise les mêmes variables et nécessite sa propre
base jetable neuve avec plusieurs workers PHP. Il vérifie les droits par salon,
les entrées/sorties, les stocks bas, l'archivage, l'historique, les exports CSV,
la pagination et des mouvements concurrents ou répétés :

```bash
BOOKILI_TEST_URL=http://localhost:8765 BOOKILI_TEST_SETUP_TOKEN=cle_de_test python3 tests/inventory.py
```

Le test `tests/cash.py` vérifie la caisse et les cartes cadeaux. Le test
`tests/bookings.py` inclut aussi l’agenda multi-collaborateurs et le consentement
aux campagnes marketing. Ils nécessitent chacun une base jetable neuve avec
toutes les migrations à jour.
Le test `tests/professional-agenda.py` vérifie les notes privées, les droits
par salon, la recherche et la création de clients, le cumul de prestations,
les créneaux, les absences individuelles et l’encaissement unique lié au
rendez-vous ; il exige également une base jetable neuve et les mêmes variables.
Pour vérifier la navigation au clavier avec des réponses API simulées, exécutez
`npm run build -- --base=/masalledereception/` puis `node tests/agenda-keyboard.mjs`
sur une machine disposant de Google Chrome. Le test n'accède à aucune base réelle.
Le test `tests/professional-clients.py` couvre la recherche, la fiche et
l’historique des rendez-vous, les notes privées permanentes et l’isolation
des données entre salons. `tests/professional-agenda.py` vérifie également
les options d’affichage de l’agenda.
`tests/professional-profile.py` vérifie la soumission et la modération des
descriptifs d’établissement, la visibilité publique des contenus validés et
l’isolation entre salons.
`tests/professional-photos.py` vérifie l’import des photos, les limites par
établissement, les permissions, la modération, l’ordre de la galerie publique
et l’image de présentation dans les résultats de recherche.

La clé de test doit correspondre à `setup_token` et contenir au moins
64 caractères. Les tests qui créent le super-admin ne doivent pas partager
une même base déjà initialisée.

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
`database/migrations/005_booking.sql`,
`database/migrations/006_appointment_notifications.sql` et
`database/migrations/007_inventory.sql`,
`database/migrations/008_salon_closures.sql` et
`database/migrations/009_cash_register.sql`,
`database/migrations/010_gift_cards.sql`,
`database/migrations/011_admin_billing.sql`,
`database/migrations/012_multi_staff.sql`,
`database/migrations/013_marketing_campaigns.sql`,
`database/migrations/014_staff_hours.sql`,
`database/migrations/015_password_reset.sql`, puis
`database/migrations/016_appointment_notes.sql`,
`database/migrations/017_appointment_services.sql` et
`database/migrations/018_cash_pending_tickets.sql` et
`database/migrations/019_professional_client_notes.sql` et
`database/migrations/020_agenda_display_settings.sql` et
`database/migrations/021_salon_booking_message.sql` et
`database/migrations/022_salon_public_profile.sql` et
`database/migrations/023_salon_photos.sql` et
`database/migrations/024_staff_absences.sql` dans phpMyAdmin,
uniquement pour les migrations non encore appliquées. Les nouvelles
installations obtiennent ces tables directement via `database/schema.sql`.
Les migrations doivent être appliquées dans l’ordre et une seule fois.

Si l’URL publique contient un sous-dossier, construisez le site avec ce
préfixe, par exemple `npm run build -- --base=/masalledereception/`. Copiez
le contenu de `dist/` (y compris `.htaccess`) dans le sous-dossier correspondant.
Si le domaine pointe directement vers ce dossier et que le préfixe n’apparaît
pas dans l’URL, utilisez plutôt `npm run build`. Gardez `bookili-config.php`
hors de `public_html`. Conservez, le cas échéant, le fichier `api/config.php`
du serveur qui charge le fichier privé par son chemin absolu. Dans l’URL de
contrôle `.../api/health.php` et dans le chemin du cron, incluez le sous-dossier
si nécessaire.

### Installation sur mobile

Les icônes Client et Pro sont incluses dans `public/` et automatiquement copiées
dans `dist/` par chaque build : aucun remplacement manuel n’est nécessaire.
Un appareil ayant déjà installé BOOKILI peut conserver son ancienne icône ;
la réinstallation du raccourci peut être nécessaire.

Sur téléphone, l’agenda occupe l’espace disponible entre son en-tête et la
navigation inférieure. Le sélecteur affiche un collaborateur à la fois, sans
défilement horizontal. Le bouton Menu donne accès au calendrier et aux autres
rubriques ; Options affiche l’échelle et l’actualisation. La vue multi-colonnes
et la vue semaine restent disponibles sur grand écran.

Sur HTTPS, **📱 Installer l’application** ouvre le guide correspondant :
**BOOKILI Client** sur l’accueil et dans l’espace client, **BOOKILI Pro** dans
l’espace professionnel. Les deux raccourcis ont une icône et une adresse
de lancement distinctes ; ils ouvrent l’espace correspondant, ou sa page de
connexion si nécessaire.

Sur Chrome pour Android, le bouton du guide peut ouvrir l’invitation native.
Si elle n’est pas disponible, utilisez le menu du navigateur. Sur iPhone/iPad,
ouvrez le guide dans Safari, puis choisissez **Partager → Sur l’écran
d’accueil** et, si proposée, l’option **Ouvrir comme app web**.

La connexion reste nécessaire pour consulter les données, réserver ou
enregistrer une vente. Le service worker affiche une page hors ligne sans
stocker les données de compte, de réservation ou de caisse. Les rappels par
e-mail sont inchangés ; l’installation n’active pas de notifications push.

Le serveur doit avoir PHP 8.1+ avec PDO MySQL, MySQL/MariaDB et Apache avec
`mod_rewrite` pour les pages de l'application. L'extension PHP **GD**, avec
prise en charge des formats JPEG, PNG et WebP, est nécessaire pour changer
l'image d'accueil et gérer les photos des établissements. L'extension **EXIF**
est également nécessaire pour orienter correctement les images JPEG. Aucun
processus Node.js à maintenir sur le serveur.

Pour les e-mails, créez dans cPanel une adresse d'expédition sur votre domaine,
puis renseignez `mail_from` et `mail_from_name` dans
`bookili-config.php` (hors de `public_html`). Pour les campagnes, ajoutez aussi
`public_url` avec l’URL HTTPS publique exacte de BOOKILI, sous-dossier compris
(par exemple `https://exemple.dz/masalledereception`). Les campagnes ne ciblent
que les clients actifs ayant explicitement coché leur consentement ; celui-ci
peut être retiré depuis le compte ou via le lien de désinscription de chaque
courriel. Les campagnes sont du texte brut, limitées à 5 000 destinataires et
envoyées par lots de 25.

Ajoutez des tâches cron cPanel, par exemple :

```bash
*/15 * * * * /usr/local/bin/php /home/UTILISATEUR_CPANEL/public_html/api/send-notifications.php
*/15 * * * * /usr/local/bin/php /home/UTILISATEUR_CPANEL/public_html/api/send-campaigns.php
```

Les cartes cadeaux sont utilisables uniquement dans le salon émetteur ; le code
complet n’est montré qu’une seule fois à l’émission. Les abonnements BOOKILI
sont suivis avec des règlements saisis manuellement : aucun paiement ou
prélèvement bancaire n’est effectué. L’export super-admin est un relevé interne
des ventes, annulations et règlements, pas une facture réglementaire ni une
déclaration fiscale.

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

Dans **Admin → Descriptif établissement**, le professionnel peut importer un
logo ou une photo du salon (JPEG, PNG ou WebP, 2 Mo et 8 mégapixels maximum).
Ces images sont aussi accessibles depuis **Gestion des photos**, avec une limite
commune de quatre photos. La première photo validée illustre la carte du salon
dans l’annuaire et apparaît en premier sur sa fiche publique ; le bouton
**Présenter** permet de choisir une autre photo validée. Les photos en attente
ou refusées ne sont jamais affichées au public. Sans photo validée, la carte
conserve un emplacement gris. Cette évolution réutilise la galerie existante
et ne nécessite pas de nouvelle migration.

Un client connecté peut confirmer un créneau, retrouver ses rendez-vous à
venir ou passés dans `/espace-client`, puis modifier la prestation et le
créneau ou annuler avant le début. Le professionnel consulte la grille de la
journée, ouvre les détails et les coordonnées du client, enregistre une note
privée par rendez-vous et peut modifier ou annuler les rendez-vous futurs.
La modification utilise les disponibilités et les prix actuels. Sur ordinateur,
un glisser-déposer vers un créneau visible en vue jour ou semaine prépare le
déplacement, à confirmer depuis la fiche ; sur mobile, la fiche permet de
choisir le nouvel horaire.
Dans **Admin → Affichage agenda**, le professionnel peut choisir d’afficher
ou masquer l’horaire, le nom du client, les prestations et la note privée dans
les blocs, puis activer ou masquer le bouton +. Ces préférences sont propres au
salon ; la fiche rendez-vous conserve le détail complet. Masquer le bouton +
n’empêche pas de créer un rendez-vous en cliquant sur un créneau disponible.
L’onglet **Clients** permet de rechercher par nom, téléphone ou e-mail, puis
d’ouvrir la fiche d’un client ayant un rendez-vous confirmé dans le salon.
La fiche affiche ses coordonnées, ses statistiques de rendez-vous, les ventes
liées aux rendez-vous et l’historique paginé, avec les notes privées déjà
laissées sur chaque rendez-vous. Une note privée permanente peut aussi être
ajoutée au client ; elle est isolée par salon et invisible au client et aux
autres établissements. La suppression et la fusion de comptes doublons ne sont
pas encore proposées afin d’éviter des changements irréversibles sur les
comptes ou les rendez-vous d’autres salons.

**Périmètre de cette version :**
- Un agenda par établissement, avec plusieurs rendez-vous simultanés possibles
  si les collaborateurs sont différents. Un rendez-vous historique sans
  collaborateur assigné bloque temporairement tous les collaborateurs sur
  son créneau.
- Une plage continue par jour pour le salon et pour chaque collaborateur,
  sans passage à minuit. Les horaires du collaborateur sont limités à
  l'intersection avec ceux du salon. Les créneaux commencent toutes les
  15 minutes depuis l'ouverture et doivent contenir toute la prestation.
- Les fermetures exceptionnelles du salon s'appliquent à toute l'équipe ;
  les absences individuelles couvrent des journées entières.
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
- Dans **Agenda**, le professionnel peut fermer une journée entière jusqu'à
  365 jours à l'avance, puis supprimer cette fermeture. Les nouvelles réservations
  et modifications vers cette journée sont bloquées. Une fermeture est refusée
  si des rendez-vous confirmés existent déjà ce jour : ils doivent d'abord être
  gérés individuellement. Aucun rendez-vous n'est annulé automatiquement.
  Le motif est privé ; les horaires hebdomadaires reprennent à la suppression.
- Dans **Agenda → Absences collaborateurs**, le professionnel peut enregistrer
  une absence couvrant une ou plusieurs journées, jusqu’à un an à l’avance.
  Elle bloque les nouveaux créneaux pour ce collaborateur et apparaît dans sa
  colonne d’agenda ; les motifs restent privés. L’ajout est refusé si des
  rendez-vous confirmés lui sont déjà attribués. La suppression rétablit ses
  disponibilités habituelles et n’annule jamais de rendez-vous.
- Dans la grille, un trait rose indique l’heure actuelle en Algérie sur la
  journée correspondante lorsqu’elle est affichée. Les colonnes d’un
  collaborateur absent sont ombrées ; ses horaires ne deviennent pas disponibles.
- Les créneaux libres de la grille sont accessibles au clavier : Tab atteint
  une colonne, puis les flèches haut/bas parcourent ses créneaux et Entrée
  ouvre le formulaire. Le créneau choisi reste à vérifier selon la durée des
  prestations avant confirmation.

## Produits et stocks professionnels

L'onglet **Caisse → Stocks** permet de créer et modifier des produits
(nom, référence facultative, prix unitaire en DA et seuil d'alerte), puis
d'enregistrer des entrées ou sorties avec un motif obligatoire. Chaque produit
commence à zéro : l'approvisionnement initial est une entrée de stock.
Les quantités sont des unités entières, limitées à 1 000 000 par produit ;
le prix est un entier compris entre 0 et 10 000 000 DA.

Les mouvements sont historisés avec la date en heure d'Algérie, la variation
et le stock après mouvement. Ils ne sont ni modifiables ni supprimables :
une erreur se corrige par un mouvement inverse motivé. Les quantités et
l'historique sont enregistrés dans une même transaction ; les verrous
empêchent deux sorties concurrentes de rendre le stock négatif. Une même
demande réessayée avec sa clé d'origine n'est comptée qu'une fois.

Un produit dont la quantité est inférieure ou égale à son seuil est signalé
en stock bas. La recherche porte sur le nom et la référence, avec un filtre
stock bas et une option pour consulter les produits archivés. L'archivage
conserve le stock et l'historique, mais interdit les nouveaux mouvements ;
la réactivation est possible depuis le formulaire de modification.

L'export CSV reprend **tous** les produits du salon correspondant aux filtres,
et pas seulement la page affichée. Il utilise UTF-8 et le séparateur
point-virgule ; les textes pouvant être interprétés comme des formules sont
neutralisés. Les données d'un autre salon ne sont jamais exportées.

Une sortie saisie dans **Stocks** n’enregistre pas de vente. Les alertes sont
affichées dans l’espace professionnel, sans e-mail de stock.

## Vente et journal de caisse

Dans **Caisse → Vente**, ajoutez des produits et des prestations actifs au
panier, puis indiquez le mode du règlement **déjà reçu**. Le serveur vérifie
les prix et les quantités. L’enregistrement fige le nom et le prix de chaque
ligne, et déduit les produits vendus dans la même transaction. Une réservation
ne crée pas de vente et ne modifie pas les stocks.

**Caisse → Journal** affiche les ventes et les annulations de la période,
avec un total net et un export CSV. L’annulation intégrale d’une vente est
motivée, remet les produits en stock, et ajoute une ligne négative datée
sans effacer la vente initiale. À utiliser seulement si les produits ont
été effectivement remis en stock. BOOKILI n’effectue ni paiement ni
remboursement bancaire ; ce journal interne n’est ni une facture ni un export
comptable réglementaire.

**Caisse → Synthèse** présente les ventes brutes, les annulations, le net des
règlements et une ventilation par jour. Les rendez-vous comptés ont un horaire
passé et sont confirmés ; BOOKILI ne suit pas encore la présence effective du
client.

**Caisse → Tickets en attente** permet de sauvegarder un panier, de le reprendre
ou de l’abandonner. Les tickets sont isolés par salon, versionnés pour éviter
les écrasements concurrents et réessayables sans créer de doublon après une
réponse réseau incertaine. Le stock n’est pas réservé lors de la mise en
attente ; prix, disponibilité et quantité sont revérifiés à l’encaissement, qui
marque le ticket payé dans la même transaction que la vente.

Le test `tests/cash.py` utilise les mêmes variables que `tests/bookings.py` et
nécessite sa propre base jetable et plusieurs workers PHP.

## Récupération du mot de passe

Les clients et les professionnels actifs peuvent demander un lien depuis
leur écran de connexion. Il expire après 30 minutes, ne fonctionne qu’une
fois et permet de choisir un nouveau mot de passe sans saisir l’ancien.
La réinitialisation invalide les anciennes sessions du compte. L’envoi est
immédiat (sans cron) et utilise `mail_from`, `mail_from_name` et `public_url`
dans la configuration privée. `public_url` doit être l’URL publique HTTPS
exacte, sous-dossier compris.

## Feuille de route

La structure de l’espace professionnel suit les références : nom du salon en
haut à gauche, quatre onglets dans la barre supérieure et rubriques propres à
chaque onglet dans le panneau latéral. Sur mobile, les rubriques passent sous
les onglets. Les archives de référence ne sont pas incluses dans le dépôt.

Premier lot livré : grille journalière complète, colonnes d’équipe, fiche
rendez-vous, coordonnées client et notes privées par rendez-vous. Le changement
de créneau, de prestation ou de collaborateur se fait depuis la fiche.
La conformité visuelle intégrale aux ZIP n’est pas encore acquise : restent
notamment la création de rendez-vous par le salon, les prestations multiples et
le passage de la fiche rendez-vous à l’encaissement,
la refonte détaillée de Caisse, Clients et Admin, puis le parcours client.

| Références | Éléments à reproduire dans BOOKILI |
| --- | --- |
| Accueil, nouvelle maquette rose et blanc | Logo texte et menu transparent sur la couverture puis clair au défilement. Recherche par ville + prestation, six raccourcis illustrés et FAQ en accordéon. L’élargissement à la wilaya et les rayons de 5, 10 et 30 km nécessitent un référentiel des villes et la géolocalisation des établissements. Fond gris tant que le super-admin n’a pas chargé une photo sans texte incrusté. |
| Agenda, capture 2 | Calendrier et filtres d’équipe à gauche, vues jour et semaine, échelle de 15 min à 2 h et horloge en heure algérienne. La grille affiche les horaires d’ouverture par défaut ; les rendez-vous hors de ces horaires restent visibles. La fiche donne accès aux dix dernières notes de rendez-vous passés dans le même salon. |
| Caisse, captures 3–32 et tableau de bord PDF | Encaissement, tickets et règlements, stocks et cartes cadeaux, vues comptables par période, indicateurs de visites et de ventes en DA. Les modes de paiement et les états fiscaux des exemples ne sont pas importés tels quels. |
| Clients, captures 33–46 | Fichier client, listes et filtres, historique, vues de suivi et avis ; fiche accessible depuis le rendez-vous. |
| Admin, captures 47–82 | Paramètres du salon, de l’équipe, des prestations et de la réservation en ligne, médias, notifications et tableaux de suivi. |

1. Valider sur une base de test les migrations et les parcours de réservation,
   caisse, cartes cadeaux, abonnements, exports et campagnes avant mise en production.
2. Reprendre intégralement les deux ZIP de référence, écran par écran :
   accueil, interface professionnelle et parcours client associé. Inventorier
   les fonctionnalités, les écarts visuels et les interactions à reproduire
   sur ordinateur et mobile avant de redessiner les écrans. La fidélité de la
   refonte et la fluidité de l’agenda sont des critères de livraison.
3. Rendre l’agenda directement visible dans l’espace professionnel : journée
   complète, créneaux libres et occupés distincts et colonnes par collaborateur.
   Permettre de déplacer un rendez-vous vers un créneau compatible et de
   modifier sa prestation. Revérifier tarif, durée et disponibilité au moment
   de l’enregistrement ; conserver le rendez-vous initial en cas de conflit.
   Côté client, rendre les disponibilités visuelles et faciliter la réservation
   et la modification sur mobile.
4. Ouvrir une fiche au clic sur un rendez-vous, avec le détail de la prestation,
   sa durée, son prix et des notes internes visibles uniquement par le
   professionnel du salon concerné. Le nom et le prénom ouvrent la fiche du
   client et ses informations utiles à la prise en charge. Les notes ne sont
   ni affichées au client ni intégrées aux e-mails.
5. Valider les parcours interactifs et la fidélité aux captures avant diffusion,
   puis documenter la sauvegarde, les migrations et le déploiement cPanel.

## État du projet

Le socle comprend la page d'accueil et sa FAQ, une recherche par catégorie et
les 58 wilayas algériennes, des formulaires d'inscription client et
professionnel, la connexion par mot de passe, le tableau de bord de validation
des demandes professionnelles, la création initiale du super-admin, la
personnalisation de l'image d'accueil, la gestion du téléphone et du mot
de passe client, la configuration du salon, l'annuaire et le parcours de
réservation avec notifications e-mail et rappels programmés, ainsi que la
gestion des produits, des stocks et des mouvements.
Il comprend également les cartes cadeaux, la répartition des rendez-vous par
collaborateur avec ses horaires hebdomadaires, la suspension/réactivation auditée des comptes, la gestion
manuelle des forfaits et règlements, l’export comptable interne et les
campagnes marketing avec consentement révocable.
Le schéma MySQL crée les tables `accounts`, `client_profiles`,
`registration_rate_limits`, `professional_applications`,
`professional_profiles`, `salons`, `services`, `platform_setup`,
`homepage_image`, `salon_hours`, `salon_closures`, `appointments`, `notification_outbox`,
`products`, `stock_movements`, `cash_sales` et `cash_sale_lines`.
Pour une
base ayant déjà reçu la première version du schéma MySQL, appliquez
`database/migrations/002_registration_auth.sql`, puis
`database/migrations/003_super_admin_setup.sql`,
`database/migrations/004_homepage_image.sql`,
`database/migrations/005_booking.sql`,
`database/migrations/006_appointment_notifications.sql` et
`database/migrations/007_inventory.sql`,
`database/migrations/008_salon_closures.sql` et
`database/migrations/009_cash_register.sql`,
`database/migrations/010_gift_cards.sql`,
`database/migrations/011_admin_billing.sql`,
`database/migrations/012_multi_staff.sql`,
`database/migrations/013_marketing_campaigns.sql`,
`database/migrations/014_staff_hours.sql`,
`database/migrations/015_password_reset.sql`,
`database/migrations/016_appointment_notes.sql`,
`database/migrations/017_appointment_services.sql` et
`database/migrations/018_cash_pending_tickets.sql` et
`database/migrations/019_professional_client_notes.sql` et
`database/migrations/020_agenda_display_settings.sql` et
`database/migrations/021_salon_booking_message.sql` et
`database/migrations/022_salon_public_profile.sql` et
`database/migrations/023_salon_photos.sql` et
`database/migrations/024_staff_absences.sql`, dans cet ordre,
uniquement si ces migrations ne sont pas déjà appliquées.
