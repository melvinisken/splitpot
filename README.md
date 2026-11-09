# Split Pot – Gemeinsame Ausgaben fair teilen

Web-App zum Verwalten gemeinsamer Ausgaben (z. B. Wochenendtrip, WG, Reise):
Ausgaben erfassen, Salden pro Person berechnen und optimale Ausgleichszahlungen
vorschlagen. Die Daten werden **ausschließlich serverseitig** gespeichert
(`data/splitpot.json`); es gibt keine lokale Speicherung im Browser.

Die App läuft ohne Build-Schritt und ohne CDN – React liegt lokal bei
(`public/vendor/`). Es gibt zwei Betriebsvarianten:

| Variante | Voraussetzung | Speicherung |
| -------- | ------------- | ----------- |
| **PHP-Webspace** | PHP 7.0+ (Standard-Shared-Hosting) | `data/splitpot.json` via `api.php` |
| **Node.js** | Node 18+ | `data/splitpot.json` via `server.js` |

Der Client erkennt automatisch, welches Backend vorhanden ist: er prüft
`/api/data` (Node-Server) und `api.php` (PHP-Webspace) – jeweils absolut und
relativ, damit auch Installationen in einem Unterverzeichnis funktionieren –
und nutzt den ersten Endpunkt, der gültiges JSON liefert; HTML-Fehlerseiten
mit Status 200 werden übersprungen. Blockiert der Host die `PUT`-Methode
(Status 405), weicht der Client automatisch auf `POST` mit dem Header
`X-HTTP-Method-Override: PUT` aus, das `api.php` ebenfalls akzeptiert.
Ohne erreichbares Backend lädt die App keine Daten und speichert nichts
(kein lokaler Fallback mehr).

## Betrieb auf PHP-Webspace (Shared Hosting)

1. Alle Dateien aus `public/` **und** `api.php` per FTP in das
   Webverzeichnis hochladen (z. B. `htdocs/` bzw. `public_html/`) – die
   Verzeichnisstruktur dabei beachten:

   ```
   htdocs/
     api.php
     index.html
     app.js
     styles.css
     vendor/react*.js
   ```

2. Fertig. Beim ersten Speichern legt `api.php` den Ordner `data/` mit der
   Datendatei an und schützt ihn per `.htaccess` gegen direkten Webzugriff
   (Apache). Falls der Ordner nicht angelegt werden kann, `data/` manuell
   per FTP anlegen und mit Schreibrechten versehen (meist 0770 oder 0775).

3. Aufruf: `https://deine-domain.de/` – die API läuft dann unter
   `https://deine-domain.de/api.php`.

**Sicherheitshinweis:** Bei nginx (statt Apache) bitte zusätzlich den
Zugriff auf `/data/` in der Serverkonfiguration sperren:

```nginx
location ^~ /data/ { deny all; return 404; }
```

## Betrieb mit Node.js

```bash
node server.js     # läuft auf http://127.0.0.1:3000
```

Konfiguration über Umgebungsvariablen:

| Variable | Standard    | Bedeutung                              |
| -------- | ----------- | -------------------------------------- |
| `PORT`   | `3000`      | HTTP-Port                              |
| `HOST`   | `127.0.0.1` | Bind-Adresse (z. B. `0.0.0.0` hinter einem Reverse-Proxy) |

## Struktur

```
api.php                   PHP-Backend: GET/PUT, Validierung, atomares Schreiben (flock)
server.js                 Node-Server: statische Dateien + REST-API, Datei-Persistenz
public/
  index.html              Einstiegseite (inkl. Content-Security-Policy)
  app.js                  App-Logik (React, ohne Build-Schritt)
  styles.css              Stylesheet
  vendor/react*.js        React 18.3.1 (lokal eingebunden, kein CDN nötig)
data/splitpot.json        Gespeicherte Daten (wird beim ersten Speichern angelegt)
```

## API

| Methode | Pfad (Node)  | Pfad (PHP)  | Beschreibung                                      |
| ------- | ------------ | ----------- | ------------------------------------------------- |
| `GET`   | `/api/data`  | `/api.php`  | Liefert `{ data: … }` bzw. `{ data: null }`       |
| `PUT`   | `/api/data`  | `/api.php`  | Speichert den Datenstand (validiert, atomar, max. 1 MB) |

Beide Backends validieren dasselbe Datenmodell und schreiben atomar
(Temp-Datei + Umbenennen; PHP zusätzlich mit Sperrdatei gegen
gleichzeitige Schreibzugriffe).

## Datenmodell (Version 2, mehrere Anlässe)

```json
{
  "version": 2,
  "activeEventId": 1,
  "events": [
    {
      "id": 1,
      "title": "Wochenende an der Küste",
      "currency": "EUR",
      "members": ["Alex", "Sam"],
      "expenses": [
        { "id": 1, "title": "Abendessen", "amount": 92, "payer": "Mia",
          "participants": ["Alex", "Mia"], "comment": "", "date": "2026-06-15" }
      ],
      "payments": [ { "id": 4, "from": "Alex", "to": "Mia", "amount": 46 } ]
    }
  ]
}
```

In der App lassen sich beliebig viele Anlässe anlegen („＋ Neu“ neben der
Anlass-Auswahl), zwischen ihnen wechseln und sie samt aller Ausgaben löschen
(damit lassen sich auch die Demo-Daten vollständig entfernen). Ältere
Ein-Anlass-Exporte (Version 1) werden beim Laden automatisch migriert;
beide Backends akzeptieren beide Formate.

Import/Export: Über „JSON sichern“ / „JSON laden“ in der App sowie CSV-Export
der Ausgaben (Excel-kompatibel, mit Schutz vor Formel-Injektion).

## Hinweise für den Betrieb

- Die Datendatei liegt im Git-Ignore; Backups lassen sich über den in der App
  eingebauten JSON-Export erstellen.
- Es gibt keine Benutzerverwaltung: Alle Besucher teilen sich denselben
  Datenstand. Für mehrere Anlässe/Gruppen müsste eine Authentifizierung bzw.
  Multi-Tenant-Logik ergänzt werden.
- Bei gleichzeitigem Bearbeiten von zwei Geräten gilt „zuletzt gespeichert
  gewinnt“.
