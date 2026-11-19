# Mon Carnet de bord EPS

Application statique, prévue pour les séances d’EPS sur iPad ou ordinateur.

- Classes et trombinoscope PRONOTE importés depuis une capture JPG ou PNG.
- Feuille d’appel par date et trimestre, avec accès à l’historique. Présence, oubli d’affaires et dispenses sont suivis séparément.
- Dispenses de séance avec durée facultative en minutes. Une dispense datée s’affiche pour toutes les séances concernées, y compris sur un autre trimestre.
- Personnalisation du titre, du texte, de la couleur et de la photo d’accueil. Les classes reçoivent chacune une couleur modifiable.
- Photos indépendantes sur la couverture, l’accueil du carnet et les classes. Appréciations EPS et fiches Prof principal par élève et trimestre, avec mentions, mémo et mode lecture. Ces données sont incluses dans la sauvegarde complète.
- Rappel dans le carnet chaque semaine et sauvegarde complète datée dans Fichiers. Le fichier contient les classes, photos, appels, notes, réglages, tableaux et barèmes. La restauration remplace le carnet de l’appareil après confirmation.
- Notes par trimestre, barèmes, coefficients et moyenne sur 20.
- Tableau blanc par trimestre avec séances réouvrables et exportables.

## Données et sécurité

- Le carnet est enregistré dans la base IndexedDB du navigateur (beaucoup plus de place que l’ancien stockage, limité à environ 5 Mo sur iPad). Les données de l’ancien stockage sont migrées automatiquement au premier lancement.
- Les sauvegardes sont chiffrées sur l’appareil (AES-GCM 256 bits, clé dérivée de la phrase secrète par PBKDF2-SHA256, 600 000 itérations). Les anciennes sauvegardes `.json` restent lisibles.
- La phrase secrète n’est jamais enregistrée ni envoyée. Si elle est perdue, les sauvegardes chiffrées et le carnet en ligne sont illisibles.
- Le bouton « Effacer le carnet de cet appareil » supprime tout le carnet du navigateur, par exemple sur un ordinateur partagé.

## Carnet en ligne (Vercel)

Le carnet peut être envoyé vers un store Vercel Blob **privé** pour être récupéré sur un autre appareil. Il est chiffré avant l’envoi : le serveur ne reçoit que des données illisibles.

Mise en place :

1. Dans le projet Vercel, onglet **Storage** : créer un store **Blob** en accès **Private** et le relier au projet.
2. Dans le carnet, page **Sauvegarde → Configuration et options → Afficher mon code d’accès** : choisir la phrase secrète, puis copier le code.
3. Dans Vercel, **Settings → Environment Variables** : ajouter `CARNET_CLE_ACCES` avec ce code, puis redéployer.

Le code d’accès est une empreinte dérivée de la phrase. Il permet au serveur de vérifier les demandes, mais pas de lire le carnet. Après un changement de phrase, mettre à jour `CARNET_CLE_ACCES`.

`vercel.json` ajoute les en-têtes de sécurité (politique de sécurité du contenu, interdiction d’intégration dans une autre page, pas d’indexation). Sur GitHub Pages, l’application reste utilisable sans le carnet en ligne.
