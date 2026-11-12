# Persistenza archivio Level 30

Il server usa PostgreSQL quando è impostata `DATABASE_URL`; se manca, usa il JSON locale solo per sviluppo. In produzione gratuito su Render, configurare un database PostgreSQL esterno come Supabase.

## Configurazione Supabase e Render

1. In Supabase apri **Connect** e copia la connessione PostgreSQL, preferibilmente **Session pooler**.
2. Su Render apri il servizio web, vai in **Environment** e imposta `DATABASE_URL` con quella stringa. Non inserirla nel codice o in repository.
3. Salva le variabili e ridistribuisci il servizio.
4. Nei log di avvio verifica `PostgreSQL connected` e il numero di ID caricati. Se la connessione non funziona, il server non si avvia e mostra un errore nei log.

Alla prima connessione il server crea automaticamente la tabella `admin_ids_state`. Se trova un vecchio `data/database.json`, ne importa il contenuto una volta quando la tabella è vuota. Gli inserimenti vengono confermati all'utente solo dopo il completamento della scrittura PostgreSQL.

Se l'archivio era già sparito dal filesystem temporaneo Render prima di questa modifica, recupera un backup dal sito e importalo da **Settings → Import Backup** dopo il deploy.
