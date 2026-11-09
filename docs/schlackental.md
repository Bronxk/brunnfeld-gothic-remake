# Schlackental — World Bible

Single source of truth for the reskin. Every engine string, profile, prompt and UI label follows this file.
Original setting: gritty low-fantasy mining colony. **No content from any existing game** (no magic dome/barrier,
no three-camp split, no cult/sleeping god, no ore currency, no names/places/creatures from other games).

## Premise (German, used in prompts and README)

> Das Schlackental ist ein abgelegenes Bergtal, in das der Landesherr seit Jahren Verurteilte schickt, um Eisenerz zu
> fördern. Im letzten Winter hat ein Bergsturz den Kehlpass verschüttet, den einzigen Weg hinaus. Seitdem kommen keine
> Versorgungskarren mehr. Häftlinge, Wachen und Siedler müssen sich selbst durchbringen, und Erz ist plötzlich weniger
> wert als Brot. Bergvogt Reinhart führt die Kolonie mit dem Rat der Rottmeister. Nur über einen halsbrecherischen
> Ziegenpfad kommen ab und zu Schmuggler mit Waren ins Tal.

Player framing: **der Neue / die Neue** — the last convict brought in before the pass collapsed.

## Language

- Everything the agents and the player read is **German** (prompts, perception, tool descriptions, feedback, memory files, viewer UI).
- Code identifiers, comments, commits: English.
- IDs below are ASCII (`ae/oe/ue/ss`). Display names use umlauts. Input from LLM/player must be normalized
  (lowercase, `ä→ae ö→oe ü→ue ß→ss`, spaces→`_`) so `Rüben`, `rueben`, `Rueben` all resolve to `rueben`.

## Terms

| Old (Brunnfeld) | New (Schlackental) |
|---|---|
| Brunnfeld (village) | Schlackental (colony) |
| village / villager | Kolonie / Kolonist (Häftling for convicts) |
| coin(s) | Groschen |
| village elder | Bergvogt |
| village council | Rat der Rottmeister |
| village assembly / meeting | Appell |
| meeting bell | Grubenglocke |
| Monday tax (10 %) | Zehnt |
| marketplace / order board | Tauschbrett (on the Zechenplatz) |
| banishment | Karzerstrafe |
| caravan | Schmugglerzug |

## Locations

| Old | New (exact string) | type |
|---|---|---|
| Village Square | Zechenplatz | square |
| Bakery | Backstube | bakery |
| Tavern | Schenke | tavern |
| Forge | Schmiede | forge |
| Carpenter Shop | Zimmerei | carpenter |
| Mill | Mühle | mill |
| Town Hall | Vogtei | townhall |
| Prison | Karzer | prison |
| Elder's House | Vogtshaus | elder |
| Cottage 1–9 | Baracke 1–9 | cottage |
| Seamstress Cottage | Flickstube | seamstress |
| Healer's Hut | Baderhütte | healer |
| Farm 1 | Unterfeld | farm |
| Farm 2 | Ziegenweide | farm |
| Farm 3 | Oberfeld | farm |
| Forest | Köhlerwald | forest |
| Mine | Erzstollen | mine |
| Merchant Camp | Schmugglerpfad | merchant |

Adjacency, opening hours and map tiles stay the same, only the names change.

## Items

| Old ID | New ID | Display |
|---|---|---|
| wheat | gerste | Gerste |
| flour | mehl | Mehl |
| bread | brot | Brot |
| meat | fleisch | Fleisch |
| milk | milch | Ziegenmilch |
| eggs | eier | Eier |
| vegetables | rueben | Rüben |
| herbs | kraeuter | Kräuter |
| medicine | arznei | Arznei |
| iron_ore | eisenerz | Eisenerz |
| coal | kohle | Kohle |
| iron_tools | werkzeug | Werkzeug |
| timber | bauholz | Bauholz |
| firewood | brennholz | Brennholz |
| furniture | hausrat | Hausrat |
| ale | bier | Dünnbier |
| meal | eintopf | Eintopf |
| cloth | leinen | Leinen |

Recipes, quantities, spoilage, satiation and prices stay identical (only IDs change).

## Skills

| Old | New ID | Display |
|---|---|---|
| farmer | bauer | Feldarbeiter |
| cattle | hirte | Hirte |
| miner | knappe | Knappe |
| woodcutter | holzfaeller | Holzfäller |
| miller | mueller | Müller |
| baker | baecker | Bäcker |
| blacksmith | schmied | Schmied |
| carpenter | zimmermann | Zimmermann |
| tavern | wirt | Wirt |
| healer | bader | Bader |
| merchant | haendler | Händler |
| seamstress | naeherin | Flickerin |
| none | none | ohne Handwerk |

## Cast (default world, 19 NPCs + player)

Same roles, homes, wallets, inventories, tools and acquaintances as the old cast, mapped 1:1.

| Old id | New id | Display | Skill | Home | Work | Description (shown to strangers) | Rat |
|---|---|---|---|---|---|---|---|
| hans | brakel | Brakel | bauer | Baracke 1 | Unterfeld | der Rottmeister der Feldrotte | ★ |
| heinrich | wendel | Wendel | bauer | Baracke 1 | Unterfeld | ein Feldarbeiter | |
| ulrich | wenzel | Wenzel | bauer | Baracke 4 | Oberfeld | ein Rübenbauer | |
| bertram | kasper | Kasper | bauer | Baracke 5 | Unterfeld | ein Feldarbeiter | |
| konrad | ottmar | Ottmar | hirte | Ziegenweide | Ziegenweide | der Ziegenhirte | |
| gerda | irmel | Irmel | mueller | Mühle | Mühle | die Müllerin | ★ |
| anselm | bodo | Bodo | baecker | Backstube | Backstube | der Bäcker | ★ |
| liesel | grete | Grete | wirt | Schenke | Schenke | die Schankwirtin | |
| volker | eckhart | Eckhart | schmied | Schmiede | Schmiede | der Schmied | ★ |
| wulf | lenz | Lenz | zimmermann | Zimmerei | Zimmerei | der Zimmermann | |
| friedrich | jost | Jost | holzfaeller | Baracke 7 | Köhlerwald | ein Holzfäller | |
| dieter | mattis | Mattis | knappe | Baracke 8 | Erzstollen | ein Knappe | |
| rupert | gisbert | Gisbert | knappe | Baracke 3 | Erzstollen | ein Knappe | |
| sybille | walburga | Walburga | bader | Baderhütte | Baderhütte | die Baderin | |
| elke | minna | Minna | naeherin | Flickstube | Flickstube | die Flickerin | |
| ida | rike | Rike | none | Baracke 2 | Baracke 2 | eine Häftlingsfrau aus den Baracken | |
| magda | vroni | Vroni | none | Baracke 8 | Zechenplatz | eine Kolonistin | |
| otto | reinhart | Vogt Reinhart | none | Vogtshaus | Vogtshaus | der Bergvogt | ★ (chair) |
| pater_markus | bruder_anno | Bruder Anno | none | Vogtei | Vogtei | der Kaplan der Kolonie | |

Pre-existing acquaintances (mapped): Brakel↔Wendel, Irmel↔Bodo, Eckhart↔Lenz, Jost↔Gisbert, Mattis↔Gisbert,
Mattis↔Vroni, Grete↔Reinhart, Reinhart↔Bruder Anno.

### Character sketches (for profiles, 3–6 sentences each, German)

- **Brakel** (38) — verurteilt wegen Wilderei, führt seit Jahren die Feldrotte. Liest den steinigen Boden wie andere Gesichter. Hasst Schulden; spart auf eine neue Pflugschar.
- **Wendel** (31) — Brakels Bettnachbar in Baracke 1, gutmütig, hält Hühner hinter dem Unterfeld.
- **Wenzel** (45) — ehemaliger Gärtner eines Klosters, wegen Diebstahls hier. Zieht Rüben auf dem Oberfeld, redet mit seinen Beeten.
- **Kasper** (24) — jung, ungeduldig, schlechter Bauer. Träumt davon, über den Ziegenpfad zu fliehen.
- **Ottmar** (52) — freier Siedler, kam freiwillig mit seinen Ziegen ins Tal. Misstraut den Häftlingen, verkauft trotzdem an alle.
- **Irmel** (47) — Müllerin, einzige, die Gerste mahlen kann. Weiß, dass ohne sie kein Brot entsteht, und lässt es sich bezahlen.
- **Bodo** (36) — Bäcker, früher Feldkoch im Heer. Backt jeden Morgen, solange Irmel liefert. Pragmatiker.
- **Grete** (50) — führt die Schenke, kennt jedes Gerücht. Braut Dünnbier aus Gerste; Schulden schreibt sie mit Kreide an die Wand.
- **Eckhart** (44) — Schmied, einst Waffenschmied, wegen Totschlags verurteilt. Ohne Erz und Kohle steht seine Esse still.
- **Lenz** (29) — Zimmermann, baut Stempel für den Stollen und Hausrat für die Baracken. Eckharts einziger Freund.
- **Jost** (33) — Holzfäller und Köhler im Köhlerwald. Schweigsam, rußgeschwärzt, zuverlässig.
- **Mattis** (27) — Knappe im Erzstollen, flink und vorlaut. Teilt seine Baracke mit Vroni.
- **Gisbert** (41) — alter Knappe mit Staublunge, überlebte zwei Stolleneinbrüche. Kennt jeden Gang.
- **Walburga** (58) — Baderin, sammelt Kräuter im Köhlerwald, näht Wunden und zieht Zähne. Niemand weiß, warum sie hier ist.
- **Minna** (34) — Flickerin, webt Leinen und flickt alles, was reißt. Rechnet still und genau.
- **Rike** (22) — ohne Handwerk, wegen Taschendiebstahls hier. Nimmt jede Arbeit, die Essen bringt.
- **Vroni** (30) — ohne Handwerk, hält sich auf dem Zechenplatz auf, vermittelt Tauschgeschäfte gegen einen Anteil.
- **Vogt Reinhart** (55) — Bergvogt im Namen des Landesherrn. Ohne Nachschub schwindet seine Macht; er hält die Ordnung mit Zehnt, Appell und Karzer.
- **Bruder Anno** (60) — Kaplan, kam freiwillig mit den Verurteilten. Predigt Geduld, schlichtet Streit, hat kein Handwerk.

## World events

| Old | New |
|---|---|
| drought | Dürre |
| plague | Grubenfieber |
| caravan | Schmugglerzug über den Ziegenpfad |
| bandit_threat | Wegelagerer am Ziegenpfad |
| mine_collapse | Stolleneinbruch |
| tax_day | Zehnttag |
| double_harvest | Reiche Ernte |
| plague_rumor | Fiebergerücht |

## Prompt glossary (Stage 2 translation contract)

Rules:
- Address agents with **du** ("Du bist Brakel.", "Du hast Hunger."). Neutral, terse, no flowery prose.
- Keep machine contracts in English: JSON keys (`actions`, `tool`, `args`, `item`, `qty`, `price`, …), action/tool
  names (`move_to`, `post_order`, `buy_item`, `speak`, …), side values (`sell`/`buy`), ids. Only descriptions and
  surrounding text become German.
- Show items to readers with `ITEM_LABELS` (Brot, Rüben, …) and skills with `SKILL_LABELS`; inputs accept both via
  `resolveItemId`. Example args in tool hints use the ID (`{"item": "brot"}`).
- Feedback tags keep the square brackets (code checks `startsWith("[")`):

| English tag | German tag |
|---|---|
| [Can't do that] | [Geht nicht] |
| [Can't produce] | [Kann nicht herstellen] |
| [Can't eat] | [Nicht essbar] |
| [Can't hire] | [Kann nicht anheuern] |
| [Can't afford] | [Zu teuer] |
| [Can't seize] | [Kann nicht beschlagnahmen] |
| [Can't go there] | [Dort geht's nicht hin] |
| [Can't fine] | [Kann nicht strafen] |
| [Can't speak] | [Kann nicht sprechen] |
| [Can't post] | [Kann nicht anschlagen] |
| [Can't move] | [Kann nicht gehen] |
| [Can't negotiate] | [Kann nicht verhandeln] |
| [Blocked by law] | [Verboten per Ratsbeschluss] |
| [Barter failed] | [Tausch gescheitert] |
| [Village concern] | [Sorge der Kolonie] |
| [Petition] | [Gesuch] |
| [Quorum] | [Beschlussfähigkeit] |
| [Thought] | [Gedanke] |
| [Negotiate] | [Verhandlung] |
| [Deal] | [Handel] |
| [Travelling] | [Unterwegs] |
| [Arrived] | [Angekommen] |
| [Spoke] | [Gesagt] |
| [Planned] | [Geplant] |
| [Hired] | [Angeheuert] |
| [Not hired] | [Nicht angeheuert] |
| [No match] | [Kein Angebot] |
| [Hint] | [Hinweis] |
| [Curfew] | [Sperrstunde] |
| [URGENT] | [DRINGEND] |
| [God Mode] | [Schicksal] |

Perception vocabulary:

| English | German |
|---|---|
| Spring / Summer / Autumn / Winter | Frühling / Sommer / Herbst / Winter |
| Monday … Sunday | Montag … Sonntag |
| Day 1/7 | Tag 1/7 |
| Weather: Clear, 12°C | Wetter: Klar, 12 °C |
| X is here. | X ist hier. |
| (You're hungry.) | (Du hast Hunger.) |
| Inventory | Inventar |
| Wallet: 32 coin | Geldbeutel: 32 Groschen |
| Tools: … durability | Werkzeug: … Zustand |
| You can produce here | Hier kannst du herstellen |
| [ready now] | [jetzt möglich] |
| Marketplace board | Tauschbrett |
| SELL / WANT | BIETE / SUCHE |
| expires in N ticks | läuft ab in N Stunden |
| Messages / From X | Nachrichten / Von X |
| village craftspeople | Handwerker der Kolonie |
| reserved | reserviert |
| the miller from the Mill (unknown person) | die Müllerin aus der Mühle |

## Look (viewer, decided by design demo)

Dark, sooty, warm: slate and coal greys, rust, lamp-amber light, parchment UI. No borrowed art from other games.
