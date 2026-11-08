# Split Pot – Gemeinsame Ausgaben fair teilen

Web-App zum Verwalten gemeinsamer Ausgaben (z. B. Wochenendtrip, WG, Reise):
Ausgaben erfassen, Salden pro Person berechnen und optimale Ausgleichszahlungen
vorschlagen. Die Daten werden **serverseitig** in einer Datei gespeichert
(`data/splitpot.json`); zusätzlich bleibt eine lokale Kopie im Browser
(localStorage) als Offline-Fallback.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) (Version 18 oder höher).
Keine weiteren Abhängigkeiten – der Server nutzt nur Node-Standardmodule.

```bash
node server.js
```

Die App läuft danach unter <http://127.0.0.1:3000>.

Konfiguration über Umgebungsvariablen:

| Variable | Standard    | Bedeutung                              |
| -------- | ----------- | -------------------------------------- |
| `PORT`   | `3000`      | HTTP-Port                              |
| `HOST`   | `127.0.0.1` | Bind-Adresse (z. B. `0.0.0.0` hinter einem Reverse-Proxy) |

## Struktur

```
server.js                 Node-Server: statische Dateien + REST-API, Datei-Persistenz
public/
  index.html              Einstiegseite (inkl. Content-Security-Policy)
  app.js                  App-Logik (React, ohne Build-Schritt)
  styles.css              Stylesheet
  vendor/react*.js        React 18.3.1 (lokal eingebunden, kein CDN nötig)
data/splitpot.json        Gespeicherte Daten (wird beim ersten Speichern angelegt)
```

## API

| Methode | Pfad       | Beschreibung                                      |
| ------- | ---------- | ------------------------------------------------- |
| `GET`   | `/api/data` | Liefert `{ data: … }` bzw. `{ data: null }`       |
| `PUT`   | `/api/data` | Speichert den Datenstand (validiert, atomar, max. 1 MB) |

## Datenmodell

```json
{
  "title": "Wochenende an der Küste",
  "currency": "EUR",
  "members": ["Alex", "Sam"],
  "expenses": [
    { "id": 1, "title": "Abendessen", "amount": 92, "payer": "Mia",
      "participants": ["Alex", "Mia"], "comment": "", "date": "2026-06-15" }
  ],
  "payments": [ { "id": 4, "from": "Alex", "to": "Mia", "amount": 46 } ]
}
```

Import/Export: Über „JSON sichern“ / „JSON laden“ in der App sowie CSV-Export
der Ausgaben (Excel-kompatibel, mit Schutz vor Formel-Injektion).

## Hinweise für den Betrieb

- Der Server bindet standardmäßig nur `127.0.0.1`. Für einen öffentlichen
  Betrieb hinter einem Reverse-Proxy (nginx, Caddy, …) `HOST=0.0.0.0` setzen
  und TLS sowie Zugriffsschutz (z. B. Basic Auth im Proxy) konfigurieren.
- Die Datendatei liegt im Git-Ignore; Backups lassen sich über den in der App
  eingebauten JSON-Export erstellen.
- Es gibt keine Benutzerverwaltung: Alle Besucher teilen sich denselben
  Datenstand. Für mehrere Anlässe/Gruppen müsste eine Authentifizierung bzw.
  Multi-Tenant-Logik ergänzt werden.
