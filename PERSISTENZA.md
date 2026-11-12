# Persistenza archivio Level 30

L'archivio è salvato in `database.json`. In locale si trova in `data/`; in produzione il percorso si configura con `DATA_DIR`.

## Render

Il disco del filesystem incluso in un servizio Render senza disco persistente è temporaneo: il file JSON non sopravvive a un riavvio o a un nuovo deploy. Per conservare gli ID:

1. Apri il servizio web su Render e aggiungi un Persistent Disk.
2. Imposta il mount path del disco su `/var/data`.
3. Nelle variabili d'ambiente del servizio imposta `DATA_DIR=/var/data`.
4. Ridistribuisci il servizio.

Il servizio deve usare un piano Render che consenta i Persistent Disk. Dopo il primo avvio il server sposta automaticamente l'eventuale `data/database.json` esistente nel nuovo percorso. Verifica in log la riga `[DB] Migrated existing archive...` o `[DB] Loaded ... IDs ...`.

Il server ora restituisce un errore se non riesce a scrivere il database, invece di confermare falsamente il salvataggio. Il volume deve restare montato allo stesso percorso nei successivi riavvii e deploy.
