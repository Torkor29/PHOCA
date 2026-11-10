# WikeGuard

PWA discrète : façade « diagnostic réseau », coffre photo chiffré derrière.

- **Déverrouiller** : tapez votre code dans « Clé produit » → Activer. Le *premier* code saisi devient votre code secret (≥ 4 caractères). Mauvais code → « Clé produit invalide ».
- Photos chiffrées (AES-256-GCM, clé PBKDF2 dérivée du code) dans IndexedDB, uniquement sur l'appareil. Rien n'est envoyé nulle part.
- Verrouillage automatique dès que l'app passe en arrière-plan.
- Code oublié = photos irrécupérables. Pas de sauvegarde cloud.

## Installation
Hébergez le dossier en HTTPS (ex. GitHub Pages), ouvrez-le dans Safari → Partager → « Sur l'écran d'accueil ».
Ouvrez-la toujours depuis l'icône (le stockage de Safari et celui de l'app installée sont séparés).
