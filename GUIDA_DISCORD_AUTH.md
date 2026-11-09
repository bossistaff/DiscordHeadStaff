# 🚀 Guida Completa: Discord ID Pro & Discord Auth

Benvenuto nella nuova versione potenziata di **Discord ID Pro**!

---

## 🌟 Novità Principali Implementate

1. **Autenticazione Ufficiale Discord OAuth2**:
   - Accesso diretto con l'account Discord.
   - Riconoscimento automatico di avatar, username e ruoli.

2. **Controllo Accessi & Protezione Rigorosa**:
   - **Creatore (👑)**: `459683716634247172`
   - **Admin / Staff (🛡️)**:
     - `817378206520836156`
     - `422345185415135232`
     - `510792663210131456`
   - **Solo ed esclusivamente questi 4 account Discord** hanno accesso alle sezioni:
     - 🔒 **Level 30**
     - 🔒 **Logs**
     - 🔒 **Settings**
   - Gli ospiti o altri utenti vedono le sezioni con il lucchetto e non possono accedervi né inviare dati.

3. **Archivio Level 30 Centralizzato & Condiviso in Tempo Reale**:
   - Gli ID **non rimangono più nel browser locale** di chi li inserisce!
   - Quando uno degli admin/creatore filtra e archivia ID in Level 30, vengono salvati in modo permanente nel database centrale del server (`data/database.json`).
   - **Tutti gli admin collegati vedono immediatamente i nuovi ID** in tempo reale (tramite Server-Sent Events).
   - Nuovo pannello **"Consulta Archivio"**: permette di cercare ID, visualizzare chi li ha inseriti e quando, copiarli o rimuoverli singolarmente.

4. **Audit Logs Condivisi**:
   - Tutte le elaborazioni e aggiunte di ID vengono salvate sul server con autore (username, ID, avatar), data e ora.

5. **Modalità Test Rapido (⚡ Test Account)**:
   - Nel pulsante in alto a destra è presente un selettore rapido che permette di testare all'istante il sito come:
     - Creatore (`459683716634247172`)
     - Admin 1 (`817378206520836156`)
     - Admin 2 (`422345185415135232`)
     - Admin 3 (`510792663210131456`)
     - Ospite non autorizzato (per verificare il blocco di sicurezza)

---

## 🛠️ Come Avviare il Progetto

Apri il terminale nella cartella del progetto (`c:\Users\Pc\Desktop\Admin IDs`) ed esegui:

```bash
npm start
```

Il server si avvierà su:
👉 **`http://localhost:3000`**

---

## 🔑 Come Configurare il Discord Auth (in 2 minuti)

Per abilitare il vero pulsante "Accedi con Discord":

1. Vai sul [Discord Developer Portal](https://discord.com/developers/applications) e accedi.
2. Clicca su **"New Application"** in alto a destra e dagli un nome (es. `Discord ID Pro`).
3. Nel menu a sinistra, clicca su **"OAuth2"** -> **"General"**.
4. Copia il **Client ID**.
5. Clicca su **"Reset Secret"** e copia il **Client Secret**.
6. Sotto la voce **"Redirects"**, clicca su **"Add Redirect"** e inserisci:
   ```
   http://localhost:3000/api/auth/discord/callback
   ```
   *(Se in futuro caricherai il sito online su Railway, Render, VPS o VPS, aggiungi anche l'URL di produzione, es. `https://tuosito.com/api/auth/discord/callback`)*.
7. Clicca su **"Save Changes"** in basso.
8. Apri il file `.env` nella cartella del progetto e incolla le tue chiavi:
   ```env
   PORT=3000
   DISCORD_CLIENT_ID=INCOLLA_QUI_IL_TUO_CLIENT_ID
   DISCORD_CLIENT_SECRET=INCOLLA_QUI_IL_TUO_CLIENT_SECRET
   DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback
   SESSION_SECRET=admin_ids_pro_secret_key_2026
   ```
9. Riavvia il server (`Ctrl+C` poi `npm start`). Ora il pulsante **"Accedi con Discord"** ti reindirizzerà direttamente alla schermata di autorizzazione di Discord!

---

## 📂 Struttura dei File del Progetto

```
Admin IDs/
├── server.js              # Server backend Node.js / Express con OAuth2 & API
├── index.html             # Interfaccia grafica moderna con glassmorphism & live sync
├── package.json           # Dipendenze e script (express, cookie-parser, dotenv)
├── .env                   # Configurazione credenziali e porta
├── .env.example           # File di esempio template
├── data/
│   └── database.json      # Database persistente dell'archivio Level 30 e Logs
└── GUIDA_DISCORD_AUTH.md  # Questa guida
```

