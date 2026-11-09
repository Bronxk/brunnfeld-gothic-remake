# Backlog — Nacht-Build „morgen spielbar“

Annahmen (ju hat nicht explizit gewählt):
- 3D = Variante B (Diorama) als Standard + Folge-Kamera/Auto-Tour aus C. Zunächst als Umschalter, 2D bleibt Standard.
- Welt = Schlackental (handgeschriebene 19) + 2 kleine Nachbarsiedlungen (Rabenstollen, Kehlhof), je ~8 Kolonisten.
- Alter Spielstand gesichert unter `../brunnfeld-data-backup-20261109-2335`.

## Läuft / offen
- [ ] Mehrere Siedlungen: Generator behält die Schlackental-Besetzung, Nachbarn deutsch, Straßen im Dreieck
- [ ] Krieg: Spannung, Provokation, Kriegserklärung, Überfälle, Wache, Frieden/Tribut (`src/war.ts`)
- [ ] Rollen live setzen: Handwerk, Ratsmitglied, Charakter-Notiz
- [ ] Sim-Steuerung: Pause, Einzelschritt, Tick-Budget, Tempo
- [ ] 3D-Ansicht im echten Viewer (Diorama + Folge-Kamera + Auto-Tour)
- [ ] Regie-UI: Rollen, Krieg/Provokation, Ereignisse, Pause/Budget im Viewer
- [ ] Integration: Routes in `server.ts`, SSE-Whitelist, Pause-Gate in `runSimulation`
- [ ] Review (Opus) für Krieg/Geldflüsse, kurzer Echtlauf (≤5 Ticks) mit Kostenmessung
- [ ] README: Krieg, Regie, 3D

## Erledigt
- [x] Modell pro Kolonist (API + Viewer)
- [x] Claude-API-Backend mit Prompt-Caching
