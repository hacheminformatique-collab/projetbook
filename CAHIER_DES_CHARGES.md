# Cahier des charges BOOKILI

Plan de réalisation issu de l’audit du 21 novembre 2026 : captures pro 2–82,
captures accueil 83–84, PDF Tableau de bord et trois captures mobiles.
Les références ne sont pas incluses dans le dépôt. Les estimations sont en
jours ouvrés d’intégration et de tests locaux, hors dépendances externes.

## Priorité 1 — Espace professionnel mobile

| Lot | Exigences et critères de validation | Estimation |
| --- | --- | ---: |
| Navigation | Barre fixe **Agenda / Caisse / Statistiques / Réglages** utilisable au clavier et adaptée à la zone de sécurité de l’écran. Fichier clients accessible depuis Réglages. Caisse organisée en Encaissement, Transactions et Stocks ; conserver les parcours depuis un rendez-vous, les tickets en cours et le bandeau PC. | 1–2 j |
| Agenda | Conserver le planning quotidien sur mobile et les vues existantes sur PC. Ajouter un panneau latéral de sélection de plusieurs collaborateurs ou de toute l’équipe. Vérifier les pauses, absences, créneaux et changements de date en heure d’Algérie. | À réestimer |
| Statistiques | Les raccourcis **Jour / Semaine / Mois / Année** sont des filtres de statistiques, pas des vues de rendez-vous. Ils couvrent la période en cours jusqu’à aujourd’hui, en heure d’Algérie (semaine à partir du lundi). Prévoir aussi une période personnalisée, les filtres d’équipe, le panier moyen, la ventilation prestations / produits / divers et un export dont le périmètre correspond à l’écran. Afficher en DA et distinguer chiffre d’affaires, encaissements et annulations. Ne pas assimiler un rendez-vous passé à une visite effective. Ne pas afficher HT, TVA ou TTC tant que leur calcul et leur définition ne sont pas validés. | 2–4 j |

Total prioritaire initial : **5–9 jours**, hors cadrage fiscal et services externes.

L’écran Statistiques et son CSV utilisent la même période et le même filtre
d’équipe. Une vente est attribuée d’après le collaborateur du rendez-vous
associé, jamais d’après le compte qui l’a encaissée ; sans collaborateur elle
est comptée dans « Non attribué ». Le panier moyen brut est calculé avant
annulations. La ventilation nette déduit les annulations à leur date et
classe notamment les cartes cadeaux émises dans « Divers ». Il s’agit de
ventes de caisse, pas d’un chiffre d’affaires fiscal.

## Lots suivants

| Références | Socle existant et fonctions restant à intégrer | Estimation |
| --- | --- | ---: |
| 3–8 · Caisse | La vente, les tickets en attente et le journal existent. Ajouter une vue Règlements distincte, le suivi du fond de caisse, dépôts, retraits et remises en banque, les échéances et les impayés. | 4–7 j |
| 9–23, 72–81 et PDF · Rapports | La synthèse des ventes et le CSV du journal existent. Ajouter rapports par prestation, produit et collaborateur, marges, périodes comparées, taux de retour et d’occupation, journal des annulations, statut non-présenté. Après le résumé Statistiques. | 6–10 j |
| 24–28, 52–56 · Réglages caisse | L’émission et l’utilisation de cartes cadeaux en salon existent. Ajouter remises, fidélité, cures, moyens de paiement personnalisés, vues et exports des cartes expirées et des transactions. | 6–10 j |
| 29–32, 51 · Stocks | Le stock, le seuil bas, les mouvements et le CSV existent. Ajouter fournisseurs, commandes et réceptions, stock maximum, inventaires physiques et rapprochement, catégories et opérations en masse. | 4–7 j |
| 33–46, 82 · Clients | La recherche, la fiche, l’historique et les notes existent. Ajouter fusion des doublons, gestion des fiches supprimées, champs configurables, avis clients et modération, dépenses et fréquence de visite. | 6–10 j |
| 47–50 · Paramètres Agenda | Prestations, équipe et visibilité des détails existent. Ajouter affectation par collaborateur, ordre, duplication, modification des tarifs en masse avec historique, couleurs et ordre d’affichage. Contenu de marque à cadrer avec les partenaires. | 4–7 j hors partenaires |
| 57–68 · Établissement | La fiche, le descriptif et les photos modérés, les horaires et fermetures existent. Ajouter recadrage et téléchargement des photos, lien CGV du salon, horaires exceptionnels partiels, jours fériés, ouverture de réservation distincte de la publication, délais et fréquence des créneaux, liste d’attente. | 5–9 j |
| 61, 69–71 et menus Admin · Exploitation | E-mails transactionnels, campagnes et abonnements super-admin existent. Ajouter préférences de notification, cloche mobile, comptes employés et révocation des sessions, paiements et factures côté pro. SMS/push, Google/Meta, site dédié et publicité à cadrer séparément. | 6–10 j hors services externes |
| 83–84 · Accueil | Préserver la grande image PC, la FAQ sous le premier écran et les raccourcis métiers sous la recherche. « Offrir » n’a pas de parcours public actif ; voir le lot en attente. | Non chiffré |

## Paiements à garder en attente

**Tap to Pay sur iPhone**, **terminal de paiement**, **paiement en ligne** et
**achat public de cartes cadeaux** ne sont pas activés. Ils peuvent être
affichés avec la mention **« (bientôt disponible) »**, en texte non interactif,
sans bouton trompeur, collecte de paiement ni engagement de date. Conserver
l’enregistrement des paiements sur place et les cartes cadeaux utilisées en
salon. Chiffrer les intégrations après validation des prestataires, des
appareils pris en charge et des conditions applicables en Algérie.

## Recette et suivi

- Distinguer maquette, intégration locale, validation métier sur une base
  jetable, publication GitHub et déploiement. Un test avec réponses simulées
  n’atteste pas les mutations SQL ni le fonctionnement sur iPhone réel.
- Rejouer sur PC et mobile les entrées de menu existantes et les parcours
  agenda → encaissement → journal, compte client et modération.
- Garder la recette cPanel pour la fin : sauvegarde, restauration de test,
  migrations nécessaires, déploiement de `dist/`, HTTPS, courriels, cron et
  parcours de bout en bout. Faire la revue de sécurité et la validation
  légale et fiscale avant le lancement.
