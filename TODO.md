# Backlog — Nacht-Build „morgen spielbar“

Annahmen (ju hat nicht explizit gewählt):
- 3D = Variante B (Diorama) als Standard + Folge-Kamera/Auto-Tour aus C. Zunächst als Umschalter, 2D bleibt Standard.
- Welt = Schlackental (handgeschriebene 19) + 2 kleine Nachbarsiedlungen (Rabenstollen, Kehlhof), je ~8 Kolonisten.
- Alter Spielstand gesichert unter `../brunnfeld-data-backup-20261109-2335`, Testwelt der Nacht unter `../brunnfeld-data-test-20261110`.

## Offen (siehe fragen.md)
- [ ] `viewer/public/assets/` fehlt komplett (Gebäude- und Deko-Sprites); die Leucht-Kreise auf der 2D-Karte sind der Fallback, Renderer warnt nur
- [ ] Kriegs-Test (262 Checks) ging beim /tmp-Wipe verloren, war nie im Repo; bei Bedarf nach `tests/` neu bauen
- [ ] Beobachten: rauer LLM-Ton im Rat/Appell und beim Handeln; falls der Rat keine Beschlüsse mehr schafft, Ton-Satz in `src/tools.ts` auf „außerhalb des Rats“ begrenzen
- [ ] 3D-Chunk > 500 kB (three.js); lädt nur bei Klick auf 3D, ok für jetzt
- [ ] 3D-Layout der Siedlungen ist eine Reihe, keine echte Talkarte

## Erledigt
- [x] Modell pro Kolonist (API + Viewer)
- [x] Claude-API-Backend mit Prompt-Caching (Prefix pro Kolonist, gemessen ~11 % billiger)
- [x] Mehrere Siedlungen: Generator behält die Schlackental-Besetzung, Nachbarn deutsch, Straßen im Dreieck
- [x] Krieg: Spannung, Provokation, Kriegserklärung, Überfälle, Wache, Frieden/Tribut (`src/war.ts`)
- [x] Kriegszug: Angreifer marschieren über die Straße, überfallen bei Ankunft, ziehen heim
- [x] Kriegszug per Regie schicken (`POST /api/war/raid`), Live-Test: Marsch → Kampf → Heimweg
- [x] Fix: Appell-Glocke holt Angreifer nicht mehr aus dem Kriegszug
- [x] Fix: Kolonisten teleportieren nicht mehr per Ortsname in fremde Siedlungen
- [x] Rollen live setzen: Handwerk, Ratsmitglied, Charakter-Notiz (Backend + Viewer)
- [x] Sim-Steuerung: Pause, Einzelschritt, Tick-Budget, Tempo (Backend + Viewer)
- [x] Regie-Tab im Viewer: Sim, Krieg, Kriegszug; Start auch ohne Start-Dialog
- [x] Start-Dialog: „Diese Welt starten“, Größe = aktuelle Welt, Kosten-Schätzung
- [x] Integration: Routes in `server.ts`, SSE-Whitelist, Pause-Gate in `runSimulation`
- [x] Review (Opus) für Krieg/Geldflüsse + Fixes
- [x] 3D-Ansicht im echten Viewer (Diorama + Folge-Kamera + Auto-Tour)
- [x] Echtlauf (35 Kolonisten, Haiku): stabil, ~7 ct/Tick, ~3–4 min/Tick
- [x] Frische Startwelt (Seed 1109, Tick 0, 3 Siedlungen, 35 Kolonisten)
- [x] README: Krieg, Regie-Routen, Regie-Tab, Start-Dialog, 3D-Ansicht
- [x] Sprüche: ~350 eigene derbe Sprüche, situativ + per Klick, Sprechblasen in 2D/3D, Regie Aus/Normal/Viel, `npm run test:barks`
