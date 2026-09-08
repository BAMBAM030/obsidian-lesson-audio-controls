# Obsidian Lesson Audio Controls

Ein kleines, offline-fähiges Obsidian-Plugin für Sprachlern-Audios. Es funktioniert für jede Sprache und jeden frei wählbaren Ordner in einem Obsidian-Vault.

## Funktionen

- ergänzt eingebettete Audio-Player und direkt geöffnete Audio-Tabs
- sieben Tempo-Stufen: `0,7×`, `0,8×`, `0,9×`, `1,0×`, `1,1×`, `1,2×`, `1,3×`
- native Wiederholung mit sichtbarer Checkbox
- pausieren beendet die Wiedergabe; das Plugin startet Audio nicht selbstständig neu
- löst relative `../Audio/...`-Quellen über Obsidian auf, ohne Mac-Pfade zu speichern
- ignoriert Dateien außerhalb des gewählten Lektionsordners sowie externe URLs
- touch-freundliche Bedienelemente für kleinere Bildschirme
- räumt Listener und DOM-Erweiterungen beim Deaktivieren wieder auf

Das Plugin verändert keine Audiodatei. Die Geschwindigkeitsänderung gilt nur für die aktuelle Wiedergabe.

## Voraussetzungen

- Obsidian mit aktivierten Community-Plugins
- ein Vault-Ordner mit Lektionen und lokalen Audio-Dateien
- keine Cloud, kein Account und keine API erforderlich

## Installation

1. Dieses Repository herunterladen oder klonen.
2. Den gesamten Projektordner nach folgendem Ort in deinem Vault kopieren:

   ```text
   DEIN-VAULT/.obsidian/plugins/lesson-audio-controls/
   ```

3. In Obsidian **Einstellungen → Community-Plugins** öffnen und **Lern-Audio-Steuerung** aktivieren.
4. Unter **Einstellungen → Lern-Audio-Steuerung** den Ordner festlegen, der deine Lektionen enthält, zum Beispiel:

   ```text
   Languages/Italiano
   ```

   oder

   ```text
   Sprachen/Portugiesisch Brasilien
   ```

Das Plugin arbeitet danach ausschließlich innerhalb dieses Ordners. Du kannst den Ordner jederzeit auf eine andere Sprache umstellen.

> Auf iPad/iPhone muss der Plugin-Ordner ebenfalls im Vault vorhanden und über deine Synchronisation verfügbar sein. Relative Audio-Links funktionieren auch ohne Plugin; Tempo- und Wiederholungssteuerung benötigen das Plugin.

## Beispiel für eine portable Lektion

Lege Audio und Markdown so ab:

```text
Languages/
└── Italiano/
    ├── Audio/
    │   └── 2026-09-09-ciao.mp3
    └── Lessons/
        └── 2026-09-09-ciao.md
```

In `2026-09-09-ciao.md`:

```html
<audio controls loop preload="metadata" src="../Audio/2026-09-09-ciao.mp3"></audio>

[🎧 Audio-Datei öffnen](../Audio/2026-09-09-ciao.mp3)
```

Relative Links sind portabel: keine `file://`-URLs, keine `/Users/...`-Pfade und keine fest eingetragene Vault-ID.

## Umgang mit Audiodateien

Das Plugin erstellt keine Audiodateien und enthält keine Audio-KI-Integration. Du kannst Aufnahmen, TTS-Dateien oder eigene MP3s verwenden. Lege sie einfach innerhalb des gewählten Lektionsordners ab und verlinke sie relativ aus der Markdown-Datei.

## Entwicklung und Tests

```bash
npm install
npm test
npm run check
```

Die Tests decken unter anderem ab:

- sieben Tempo-Buttons und Standardtempo 1,0×
- Loop-Steuerung und korrektes Pausieren
- eingebettete Player und Audio-Tabs
- relative Audio-Quellen
- frei konfigurierbare Sprach-/Lektionsordner
- Ausschluss fremder Dateien und Notizen
- keine doppelten Controls
- sauberes Plugin-Unload

## Datenschutz und Umfang

Dieses Repository enthält keine API-Schlüssel, Nutzerprofile, Cloud-Zugänge, Sprachlern-Prompts oder personenbezogenen Daten. Es enthält ausschließlich die technische Audio-Unterstützung für Obsidian.
