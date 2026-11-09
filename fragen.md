# Fragen / Entscheidungen für ju

1. **Waffen fehlen als Ware.** Der Krieg kennt einen Bonus für Bewaffnete, aber es gibt kein Waffen-Item, also greift er nie.
   - A: Item „Spieß“ (Schmied: Eisen + Holz) einführen, Bonus aktiv *(Vorschlag)*
   - B: Bonus streichen, Kampf nur über Anzahl + Wachen
2. **Kehlhof hat keinen Schmied.** Werkzeug geht dort irgendwann aus.
   - A: Generator gibt jeder Siedlung mind. 1 Schmied *(Vorschlag)*
   - B: so lassen, Kehlhof muss Werkzeug zukaufen (Handelsdruck, gut für Konflikte)
3. **Generierte Nachbar-Kolonisten** (`data/memory_initial/*`, `data/profiles/*` für Rabenstollen/Kehlhof) sind nicht im Git.
   - A: committen, damit die Startwelt reproduzierbar ist *(Vorschlag)*
   - B: so lassen, Welt wird bei Bedarf neu generiert
4. **Rollenwechsel** ändert Handwerk + Arbeitsort, aber nicht Tagesplan/Zuhause. Reicht das?
5. **Haiku-Kolonisten ziehen kaum von selbst in den Krieg.** Im Testlauf (35 Kolonisten) hat nach der Kriegserklärung niemand `ueberfallen` gewählt; Kriegszüge kamen nur über die Regie.
   - A: Rat ruft bei Kriegserklärung automatisch einen Kriegszug aus (3 Leute, danach alle ~8 Ticks einer, solange Krieg) *(Vorschlag, mehr Action)*
   - B: so lassen, du schickst Kriegszüge selbst per Regie-Tab
   - C: Kriegs-Hinweis im Prompt deutlich lauter machen, Entscheidung bleibt bei den LLMs (unsicher, ob Haiku dann anbeißt)
