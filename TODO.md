# Backlog — Nacht-Build „morgen spielbar“

Annahmen (ju hat nicht explizit gewählt):
- 3D = Variante B (Diorama) als Standard + Folge-Kamera/Auto-Tour aus C. Zunächst als Umschalter, 2D bleibt Standard.
- Welt = Schlackental (handgeschriebene 19) + 2 kleine Nachbarsiedlungen (Rabenstollen, Kehlhof), je ~8 Kolonisten.
- Alter Spielstand gesichert unter `../brunnfeld-data-backup-20261109-2335`.

## Läuft / offen
- [ ] Regie-UI: Rollen, Krieg/Provokation, Ereignisse, Pause/Budget im Viewer
- [ ] Kurzer Echtlauf mit Kriegszügen + Kostenmessung
- [ ] Frische Startwelt für ju (Seed 1109, pausiert starten)
- [ ] README: 3D-Ansicht, Regie-UI

## Erledigt
- [x] Modell pro Kolonist (API + Viewer)
- [x] Claude-API-Backend mit Prompt-Caching
- [x] Mehrere Siedlungen: Generator behält die Schlackental-Besetzung, Nachbarn deutsch, Straßen im Dreieck
- [x] Krieg: Spannung, Provokation, Kriegserklärung, Überfälle, Wache, Frieden/Tribut (`src/war.ts`)
- [x] Kriegszug: Angreifer marschieren über die Straße, überfallen bei Ankunft, ziehen heim
- [x] Rollen live setzen: Handwerk, Ratsmitglied, Charakter-Notiz (Backend)
- [x] Sim-Steuerung: Pause, Einzelschritt, Tick-Budget, Tempo (Backend)
- [x] Integration: Routes in `server.ts`, SSE-Whitelist, Pause-Gate in `runSimulation`
- [x] Review (Opus) für Krieg/Geldflüsse + Fixes
- [x] 3D-Ansicht im echten Viewer (Diorama + Folge-Kamera + Auto-Tour)
- [x] README: Krieg, Regie-Routen
