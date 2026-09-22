# Guide : configurer Tailscale pour le pont Ollama/Trame

Ce guide couvre la configuration a faire UNE SEULE FOIS (compte + PC), a la
main, avant de lancer `setup-ollama-bridge.ps1`. Le script ne peut pas faire
ces etapes lui-meme : Tailscale exige une connexion interactive dans un vrai
navigateur (mesure anti-hameconnage voulue par Tailscale, pas une limite de
ce script), et les deux reglages du compte se font dans leur console web.

Comptez environ 5 minutes. Une fois fait, vous n'y reviendrez plus -- le
script se contente ensuite de verifier automatiquement que tout est toujours
en place a chaque lancement (et vous previent clairement sinon).

---

## Etape 1 -- Creer un compte et installer Tailscale sur ce PC

1. Allez sur https://tailscale.com et cliquez sur "Get started" / "Sign up".
2. Connectez-vous avec un compte existant (Google, Microsoft, GitHub...) --
   Tailscale n'a pas de systeme de mot de passe separe, ce qui evite d'avoir
   un identifiant de plus a gerer. Le plan "Personal" (gratuit) suffit pour
   cet usage.
3. Telechargez le client Windows depuis
   https://tailscale.com/download/windows et installez-le normalement.
   (Vous pouvez aussi l'installer via winget si vous preferez :
   `winget install --id Tailscale.Tailscale -e`)
4. Un icone Tailscale apparait dans la barre des taches (zone de
   notification, pres de l'horloge).

## Etape 2 -- Se connecter (tailscale up)

1. Ouvrez une invite PowerShell normale et lancez :
   ```
   tailscale up
   ```
2. Une page se lance dans votre navigateur par defaut, vous demandant de
   vous connecter avec le meme compte qu'a l'etape 1 puis d'autoriser cet
   appareil sur votre "tailnet" (le nom que Tailscale donne a votre reseau
   prive personnel -- un seul suffit ici, cree automatiquement au premier
   login).
3. Une fois valide dans le navigateur, la commande se termine dans
   PowerShell et affiche que la machine est connectee.

Vous pouvez verifier l'etat a tout moment avec `tailscale status`.

## Etape 3 -- Verifier que MagicDNS est actif

MagicDNS donne a ce PC un nom stable du type `mon-pc.tailxxxxx.ts.net` --
c'est cette partie du nom qui devient l'adresse publique de votre pont une
fois Funnel active plus bas. Il est active par defaut pour un tailnet neuf,
mais verifiez :

1. Allez sur https://login.tailscale.com/admin/dns
2. Verifiez que "MagicDNS" est bien sur "Enabled" (bouton en haut de la
   page). Si ce n'est pas le cas, activez-le.

## Etape 4 -- Activer les certificats HTTPS

Necessaire pour que Funnel puisse presenter un certificat HTTPS valide sur
votre nom de machine (sans quoi Trame, comme n'importe quel navigateur,
refuserait la connexion).

1. Toujours sur https://login.tailscale.com/admin/dns
2. Trouvez la section "HTTPS Certificates" et cliquez sur "Enable HTTPS
   Certificates" si ce n'est pas deja actif.

## Etape 5 -- Autoriser Funnel (exposition publique)

Funnel est la fonctionnalite qui rend un service accessible depuis
l'internet public (par defaut, un tailnet n'expose rien en dehors de vos
propres appareils connectes). Sur un tailnet personnel recemment cree,
c'est generalement deja autorise par defaut -- mais verifiez :

1. Allez sur https://login.tailscale.com/admin/acls/file
2. Cherchez une section `"nodeAttrs"` dans la politique. Elle doit contenir
   une entree qui autorise l'attribut `funnel`, par exemple :
   ```json
   "nodeAttrs": [
     {
       "target": ["autogroup:member"],
       "attr":   ["funnel"]
     }
   ]
   ```
3. Si cette section est absente, ajoutez-la (le reste de votre politique
   ACL existante ne change pas) puis cliquez sur "Save".

Si vous preferez ne pas toucher au fichier ACL brut, la console propose
aussi parfois cette meme option sous forme de case a cocher dans les
reglages du tailnet (https://login.tailscale.com/admin/settings/general,
section relative a Funnel) -- les deux methodes reviennent au meme.

## Etape 6 -- Verifier que tout est en place

Depuis le dossier du script, lancez :
```
.\setup-ollama-bridge.ps1 -Diagnose
```
Ce mode ne demarre rien (ni Ollama, ni Caddy, ni le tunnel) -- il verifie
uniquement, dans l'ordre, chacune des etapes ci-dessus et vous dit
precisement laquelle corriger si quelque chose manque encore :
- Tailscale installe
- Connecte a un tailnet
- MagicDNS actif (nom de machine lisible)
- Certificats HTTPS actives
- Permission Funnel accordee

Une fois que `-Diagnose` affiche "OK" partout, lancez le script normalement :
```
.\setup-ollama-bridge.ps1
```

---

## Questions frequentes

**Est-ce que je dois refaire cette configuration a chaque fois ?**
Non. Une fois le compte et le PC configures (etapes 1 a 5), tout est
permanent. Vous n'aurez plus jamais besoin de repasser par le navigateur --
le script relance juste `tailscale serve`/`tailscale funnel` a chaque
demarrage, ce qui est instantane et silencieux.

**L'adresse publique va-t-elle encore changer a chaque lancement, comme
avec l'ancien tunnel Cloudflare ?**
Non, c'est justement le principal interet de ce changement : le nom
`https://<votre-pc>.<tailnet>.ts.net` est fixe tant que vous ne renommez pas
la machine sur le tailnet. Trame n'a besoin d'etre mis a jour qu'une
seule fois (fait automatiquement par le script au premier lancement
reussi).

**Est-ce que Tailscale voit passer mes conversations/donnees ?**
Non pour le trafic normal entre vos propres appareils (chiffre de bout en
bout, WireGuard). Pour Funnel specifiquement (le trafic public), les
requetes transitent par un relais Tailscale pour joindre votre PC depuis
l'exterieur -- documente et attendu pour cette fonctionnalite -- mais restent
chiffrees en HTTPS de bout en bout entre le client et votre PC ; Tailscale
n'a jamais besoin de connaitre le jeton secret de ce pont pour faire
transiter les octets.

**Le PC doit-il rester allume et connecte pour que ca marche ?**
Oui, comme pour l'ancienne solution -- Funnel expose ce PC precis, pas un
serveur intermediaire. Si le PC est eteint ou hors reseau, la generation
locale (texte et image) redevient indisponible et Trame bascule sur
votre fournisseur de secours configure, si vous en avez un.
