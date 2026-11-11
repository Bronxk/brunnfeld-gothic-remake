import type { BarkPool } from "./barks-types.js";

/**
 * Hand-written colonist barks for Schlackental. German, Du-form, rough register.
 * Role lines are preferred over "any" when the speaker has that role.
 * Placeholders: {dorf} everywhere, {gegner} only in fremder, spannung and krieg_*.
 */
export const BARK_POOL: BarkPool = {
  gruss: {
    any: [
      "Was glotzt du? Hab ich Schlacke im Gesicht?",
      "Na. Auch noch nicht verreckt.",
      "Red schon, ich hab nicht ewig.",
      "Wenn's um Groschen geht: hab keine.",
      "Ah, du. Hätt schlimmer kommen können. Knapp.",
      "Willst du was, oder stehst du nur im Weg?",
      "Du schon wieder. Hat dich der Stollen noch nicht gefressen?",
      "Hm. Was.",
      "Wenn du mich anpumpen willst, spar dir die Luft.",
      "Bist du der, der mir noch Gerste schuldet?",
    ],
    vogt: [
      "Sprich. Ich hör zu, solang's kurz ist.",
      "Hast du ein Anliegen oder nur Langeweile?",
      "Steh grade, wenn du mit mir redest.",
      "Wer was will, kommt in die Vogtei. Also?",
    ],
    rottmeister: [
      "Meine Rotte schuftet. Und du?",
      "Rede. Der Rat tagt sowieso erst später.",
      "Brauchst du Arbeit? Ich hab genug Dreck zu verteilen.",
    ],
    wirt: [
      "Setz dich, aber zahl vorher.",
      "Dünnbier gibt's, Mitleid nicht.",
      "Durst oder Ärger? Für eins davon hab ich Platz.",
    ],
    bader: [
      "Wo blutet's denn? Zeig her.",
      "Kein Fieber? Dann stiehl mir nicht die Zeit.",
      "Mach mal den Mund auf. Ah, da fault einer.",
    ],
    knappe: [
      "Glück tief. Hast du Kohle dabei?",
      "Komm grad aus dem Stollen. Red lauter, die Ohren klingeln.",
      "Schau nicht so, das ist Erzstaub, kein Dreck.",
    ],
    schmied: [
      "Rede, solang das Eisen glüht.",
      "Bringst du was Krummes? Sag's gleich.",
      "Fester Preis. Damit wär das Gespräch fast schon durch.",
    ],
  },

  abweisen: {
    any: [
      "Verpiss dich, oder du schaufelst morgen Schlacke für mich.",
      "Heute nicht. Morgen auch nicht.",
      "Noch ein Wort, und du frisst Schlacke.",
      "Lass mich, sonst suchst du deine Zähne im Schlackehaufen.",
      "Hau ab, du Grubenratte.",
      "Geh wem anders auf den Sack, Schlackekopf.",
      "Ich hab Hunger, keine Geduld. Weg da.",
      "Stell dich woanders hin, du nimmst mir die Luft.",
      "Scher dich zum Bergsturz und grab dich selbst aus.",
    ],
    vogt: [
      "Die Vogtei ist zu. Für dich sowieso.",
      "Noch ein Wort und du zählst die Nächte im Karzer.",
      "Beschwerden beim Appell. Nicht bei mir, nicht jetzt.",
      "Ein paar Nächte Karzer kühlen jeden Hitzkopf.",
      "Der Karzer ist voll? Dann rücken sie halt zusammen.",
      "Wer Regeln bricht, wohnt hinter Gittern. Ganz einfach.",
    ],
    rottmeister: [
      "Meine Rotte hat Vorrang. Du nicht.",
      "Geh zu deinem eigenen Rottmeister heulen.",
      "Ich hab den Rat am Hals. Nicht auch noch dich.",
    ],
    wirt: [
      "Kein Groschen, kein Bier. Raus.",
      "Die Schenke ist kein Schlafsaal. Raus mit dir.",
      "Anschreiben? Ich schreib dir gleich was ins Gesicht.",
    ],
    bader: [
      "Stirb woanders, ich hab Kundschaft.",
      "Wenn's nicht blutet, ist's kein Fall für mich.",
      "Noch einmal jammern, und ich zieh dir einen gesunden Zahn.",
    ],
    knappe: [
      "Ich hab zwölf Stunden Stollen in den Knochen. Weg.",
      "Red mit dem Fels. Der hört eher zu als ich.",
      "Lass mich, sonst lernst du meine Spitzhacke kennen.",
    ],
    schmied: [
      "Nicht jetzt. Das Eisen wartet nicht.",
      "Steh nicht an der Esse rum, du Funkenfänger.",
      "Raus, bevor ich dich mit dem Hammer begrüße.",
    ],
  },

  fremder: {
    any: [
      "Schaut mal, was aus {gegner} hergekrochen ist.",
      "Pfoten weg vom Tauschbrett, du gehörst nicht hierher.",
      "Wer hat das reingelassen? Taschen zu, Leute.",
      "Riechst du das? Fremder Dreck an fremden Stiefeln.",
      "Geh heim nach {gegner}, solang du noch laufen kannst.",
      "Hier kennt dich keiner. Und keiner will.",
      "Ein falscher Blick, und du gehst ohne Zähne zurück.",
      "Spionierst du für {gegner}? Sag's lieber gleich.",
      "Fremdes Gesicht, fremde Finger. Ich behalt dich im Auge.",
      "Bei uns zahlt man doppelt, wenn man nicht von hier ist.",
    ],
  },

  hunger: {
    any: [
      "Mein Magen knurrt lauter als der Berg.",
      "Ich fress gleich Schlacke, ehrlich.",
      "Seit gestern nur Rübenwasser. Mir dreht sich alles.",
      "Hunger. Und Brot gibt's nur gegen Groschen. Scheiße.",
      "Wenn ich nicht bald was beiß, beiß ich dich.",
      "Die Ratten im Stollen sehen langsam lecker aus.",
      "Leerer Bauch, kurze Lunte. Merk dir das.",
      "Für 'n Kanten Brot würd ich Stiefel lecken.",
      "Verdammt, sogar Gerstenbrei wär jetzt ein Fest.",
    ],
  },

  erschoepft: {
    any: [
      "Meine Knochen sind aus Schlacke.",
      "Noch ein Schritt und ich leg mich hin, wo ich steh.",
      "Ich bin so fertig, ich schlaf im Stehen.",
      "Selbst die Schlacke hat mehr Saft als ich.",
      "Der Tag hat mich ausgekotzt.",
      "Arme wie nasse Lumpen. Scheißtag.",
      "Wer mich jetzt weckt, stirbt.",
      "Ich schlepp mich nur noch. Frag nicht.",
      "Nicht mal die Glocke kriegt mich jetzt hoch.",
    ],
  },

  verletzt: {
    any: [
      "Verdammt, das hört nicht auf zu bluten.",
      "Mein Bein ist hin. Ich kann nur noch kriechen.",
      "Glotz nicht, verbind lieber.",
      "Gib mir Dünnbier und 'nen Stock zum Draufbeißen.",
      "Wenn das schwarz wird, ist der Arm weg.",
      "Nur 'n Kratzer. Ein tiefer, verdammter Kratzer.",
      "Bind das ab, bevor ich alles vollblute.",
      "Der Fels hat zurückgeschlagen.",
      "Fass mich nicht an, da ist was gebrochen.",
    ],
  },

  krank: {
    any: [
      "Ich huste schwarz. Das ist nie gut.",
      "Halt Abstand, sonst hast du's auch.",
      "Grubenfieber. Ich spür's in den Knochen.",
      "Mir ist kalt und heiß zugleich. Verdammter Mist.",
      "Schlackelunge. Kriegt hier jeder irgendwann.",
      "Mein Husten klingt wie 'n Stollen beim Einbruch.",
      "Kräuter helfen? Ich riech schon die Grube.",
      "Mich schüttelt's wie 'n nassen Hund.",
      "Wenn ich umkipp, gehört mein Werkzeug keinem. Merkt euch das.",
    ],
  },

  arbeit: {
    any: [
      "Siehst du nicht, dass ich schufte? Oder fehlen dir Augen?",
      "Stehst du hier nur rum, oder packst du an?",
      "Schuften, schuften, und der Pass bleibt trotzdem zu.",
      "Jeder Handgriff ein Groschen. Und du kostest mich grad einen.",
      "Wer hier nicht schuftet, frisst auch nicht.",
      "Schaff du mal so lange. Dann reden wir.",
      "Schwielen auf Schwielen. Herrlich, das Tal.",
      "Zuschauen kostet extra, Freundchen.",
      "Jeden Tag derselbe Dreck, nur der Rücken wird krummer.",
    ],
    bauer: [
      "Steine, Steine, und dazwischen drei Halme Gerste.",
      "Dieser Acker gibt nur her, was man ihm abprügelt.",
      "Tritt mir nicht in die Rüben, du Trampel.",
      "Die Asche frisst die Saat. Und ich fress Asche.",
    ],
    hirte: [
      "Die Ziegen sind klüger als die halbe Kolonie.",
      "Komm meiner Herde zu nah, und du kriegst Hörner.",
      "Wer mir 'ne Ziege klaut, hängt an ihrem Strick.",
      "Mecker nur, Biest. Du landest trotzdem im Eintopf.",
    ],
    knappe: [
      "Schlag um Schlag, und das Erz lacht mich aus.",
      "Hörst du den Stollen knacken? Der hat Hunger auf Leute.",
      "Kohle im Gesicht, Kohle in der Lunge, keine in der Tasche.",
      "Halt die Lampe still, oder du hackst morgen selbst.",
      "Tief rein, schnell raus. So bleibt ein Knappe am Leben.",
      "Wieder taubes Gestein. Verfluchter Berg.",
    ],
    holzfaeller: [
      "Achtung, Stamm! Oder bleib stehen, ist mir gleich.",
      "Der Köhlerwald wird jeden Tag dünner. Ich auch.",
      "Noch so 'n Ast im Weg, und ich spalt dich gleich mit.",
      "Axt rein, Kreuz kaputt. Jeden Tag dasselbe.",
    ],
    mueller: [
      "Mehlstaub in der Nase, Schlacke in der Gerste.",
      "Mahl ich noch was, oder mahl ich dich?",
      "Wer Mehl will, bringt Gerste. Und keine Ausreden.",
      "Der Stein knirscht. Hoffentlich nur Korn.",
    ],
    baecker: [
      "Brot backt sich nicht vom Glotzen.",
      "Finger weg vom Teig, sonst back ich sie mit.",
      "Seit Sonnenaufgang an der Glut. Was willst du?",
      "Asche im Ofen, Asche im Brot. Wird schon keiner merken.",
    ],
    schmied: [
      "Hammer drauf, bis es Werkzeug wird. Oder Schrott.",
      "Ohne Erz und Kohle ist meine Esse kalt. Und ich sauer.",
      "Noch 'ne Hacke kaputt? Fresst ihr Knappen Steine?",
      "Ein Schlag zu viel, und das Eisen ist hin. Ruhe!",
    ],
    zimmermann: [
      "Krumm gewachsen, krumm gesägt. Wie alles im Tal.",
      "Halt den Balken, nicht deine Klappe.",
      "Noch ein dummer Spruch, und ich nagel dich an die Wand.",
      "Stützbalken für die Grube. Sonst gibt's Knappenmus.",
    ],
    wirt: [
      "Bier ist dünn, Eintopf ist heiß, Beschwerden sind draußen.",
      "Wer kotzt, wischt auf. Regel eins.",
      "Ich hör alles, was hier gesoffen wird. Merk dir das.",
      "Den Krug kriegst du voll, die Rechnung auch.",
    ],
    bader: [
      "Beiß auf das Holz, das wird jetzt unschön.",
      "Halt still, oder ich näh dir die Lippe mit zu.",
      "Die Kräuter werden knapp. Wer jetzt krank wird, hat Pech.",
      "Zahn raus, Groschen her. So läuft das.",
    ],
    haendler: [
      "Alles hat seinen Preis. Du auch.",
      "Ich verkauf dir Dreck, und du bedankst dich noch.",
      "Ich kenn jeden, der was hat. Und jeden, der was schuldet.",
      "Angebot, Nachfrage, Schlacke. Mehr Wirtschaft gibt's hier nicht.",
    ],
    naeherin: [
      "Wieder Löcher? Was treibt ihr in euren Kitteln, Fels kauen?",
      "Stich, Stich, Stich. Und ihr reißt's in 'ner Stunde auf.",
      "Halt still, die Nadel kennt keine Gnade.",
      "Ich flick dir den Kittel. Dein Maul näh ich gratis zu.",
    ],
    rottmeister: [
      "Schneller, ihr Schlackefresser! Der Rat will Zahlen.",
      "Wer trödelt, schafft morgen doppelt.",
      "Meine Rotte, meine Regeln. Ab an die Arbeit.",
      "Noch so 'ne Pause, und ich meld dich beim Vogt.",
    ],
    vogt: [
      "Ich stopf Löcher, die ihr Idioten jeden Tag aufreißt.",
      "Abgaben, Streit, Klagen. Und keiner will zuständig sein.",
      "Ohne Ordnung fressen wir uns hier gegenseitig auf.",
      "Siegel drauf, Strafe drauf. Das Vogtamt ist Drecksarbeit.",
    ],
  },

  markt: {
    any: [
      "Was, so viel? Für den Schrott?",
      "Das Tauschbrett lügt nicht. Du schon.",
      "Zehn Groschen? Dafür kriegst du höchstens meine Faust.",
      "Mach 'n ehrlichen Preis, oder verschwinde vom Brett.",
      "Riecht nach Wucher hier.",
      "Leg drauf, sonst geh ich.",
      "Wer hat den Preis angeschlagen? Ein Besoffener?",
      "Ich tausch, aber nicht gegen Luft.",
      "Die Hälfte. Und dafür sag ich sogar danke.",
    ],
    haendler: [
      "Kauf oder lass es, aber glotz nicht umsonst.",
      "Preis steht am Brett. Feilschen kostet extra.",
      "Für dich mach ich 'nen Freundschaftspreis. Doppelt.",
      "Morgen ist's teurer, das versprech ich dir.",
    ],
    wirt: [
      "Dünnbier, frisch gepanscht. Greif zu.",
      "Eintopf gegen Groschen. Gegen Geschichten nur, wenn sie gut sind.",
      "Mein Bier ist billiger als dein Kummer.",
    ],
    baecker: [
      "Frisches Brot! Fast ohne Asche drin.",
      "Brot gegen Groschen, nicht gegen Gejammer.",
      "Wer Mehl bringt, kriegt Rabatt. Wer jammert, nicht.",
    ],
  },

  dieb: {
    any: [
      "Dieb! Haltet den Mistkerl!",
      "Wer war das? Ich brech ihm alle Finger.",
      "Mein Beutel! Verdammt, mein Beutel ist weg!",
      "Langfinger in {dorf}. Pass auf deinen Kram auf.",
      "Wer klaut, landet im Karzer. Oder unterm Schlackehaufen.",
      "Ich hab nichts gesehen. Und du auch nicht, klar?",
      "Irgendein Schlackefresser hat lange Finger gemacht.",
      "Durchsucht die Baracken, alle!",
      "Am helllichten Tag! Hat hier keiner Augen?",
    ],
  },

  arm: {
    any: [
      "Kein Groschen. Nicht mal für Dünnbier.",
      "Meine Taschen sind verschütteter als der Kehlpass.",
      "Pleite. Bald verkauf ich meine Stiefel.",
      "Leih mir was. Nein? Dann eben nicht, Geizhals.",
      "Ich zähl meine Groschen. Dauert nicht lang.",
      "Bald fress ich Gras mit den Ziegen.",
      "Arm wie 'ne Grubenratte. Nur hässlicher.",
      "Wer nichts hat, dem nimmt das Tal noch mehr.",
      "Noch drei Groschen. Danach geh ich betteln.",
    ],
  },

  reich: {
    any: [
      "Groschen hab ich. Freunde komischerweise auch, seit gestern.",
      "Was guckst du auf meinen Beutel? Finger weg.",
      "Fleiß, Freundchen. Und ein bisschen Glück am Brett.",
      "Ich kauf den halben Zechenplatz, wenn mir danach ist.",
      "Neidisch? Recht so.",
      "Mein Beutel klimpert. Hörst du's? Schönster Klang im Tal.",
      "Wer was will, fragt höflich. Und zahlt Zinsen.",
      "Ich zahl, du schleppst. So läuft das jetzt.",
      "Reich im Tal heißt: drei Brote mehr als du.",
    ],
  },

  spannung: {
    any: [
      "Die aus {gegner} führen was im Schilde, ich riech's.",
      "Wenn die aus {gegner} kommen, sind wir bereit.",
      "Schärft die Hacken. Nur so, für alle Fälle.",
      "Da hinten auf der Straße? Späher, garantiert.",
      "Die drüben zählen schon unsere Ziegen.",
      "Ich trau keinem, der von drüben kommt.",
      "Noch ein schiefer Blick von drüben, und es kracht.",
      "Der Rat redet. Ich wetz lieber das Messer.",
      "Riecht nach Ärger. Und nach Rauch von drüben.",
      "Für {dorf} würd ich zuschlagen. Sofort.",
    ],
  },

  krieg_marsch: {
    any: [
      "Auf nach {gegner}! Heute zahlen die Zinsen.",
      "Weiter, weiter. Wer zurückbleibt, kriegt keine Beute.",
      "Die Füße bluten, aber die Wut trägt mich.",
      "Haltet die Klappe, die sollen uns nicht kommen hören.",
      "Packt die Hacken fester. Bald wird's laut.",
      "Wer jetzt kneift, braucht in {dorf} nicht mehr aufzutauchen.",
      "Schneller! Bevor die ihre Türen verrammeln.",
      "Ich hab Hunger. Drüben gibt's sicher Brot.",
      "Keiner redet, keiner singt. Marsch!",
    ],
    rottmeister: [
      "Rotte, zusammenbleiben! Wer ausschert, kriegt's von mir.",
      "Augen auf die Straße. Hinter jedem Stein kann einer lauern.",
      "Wer schlappmacht, den trag ich nicht. Lauf!",
    ],
    vogt: [
      "Vorwärts. Ich geh vorn, also redet keiner.",
      "Für {dorf}! Und für jeden Groschen, den {gegner} uns schuldet.",
      "Wir nehmen, was uns zusteht. Nicht mehr. Fast.",
    ],
  },

  krieg_angriff: {
    any: [
      "Holt euch alles, was nicht festgenagelt ist!",
      "Rein da! Tauschbrett zuerst!",
      "Für {dorf}! Schlagt drauf!",
      "Die Vorräte! Schnappt euch die Vorräte!",
      "Wer sich wehrt, kriegt die Hacke.",
      "Brennt nichts an, wir wollen's ja noch fressen.",
      "Lauft, ihr Ratten aus {gegner}!",
      "Säcke voll, und dann nichts wie weg!",
      "Ha! Die schlafen ja noch!",
    ],
    rottmeister: [
      "Rotte! Zwei rein, der Rest sichert!",
      "Nicht plündern, bevor die Straße frei ist!",
      "Nehmt das Erz, das Bier lasst stehen!",
    ],
    vogt: [
      "Schnell rein, schnell raus. Kein Heldentum!",
      "Nehmt, was wir brauchen. Den Rest lasst liegen.",
      "Zurück, sobald die Glocke von {gegner} läutet!",
    ],
  },

  krieg_verteidigung: {
    any: [
      "Sie kommen aus {gegner}! Alle an die Baracken!",
      "Haltet stand, verdammt! Keiner kriegt unser Brot!",
      "Schlagt sie zurück in ihr Loch!",
      "Weg von unserem Korn, ihr Hungerleider!",
      "Nehmt alles, was schwer ist, und haut drauf!",
      "Kein Schritt weiter, ihr Schlackefresser!",
      "Verrammelt die Backstube!",
      "Ich hab nicht so lang geschuftet, damit ihr's klaut!",
      "Raus aus {dorf}, oder ihr bleibt für immer!",
    ],
    rottmeister: [
      "Rotte zu mir! Schulter an Schulter!",
      "Keiner rennt! Wer rennt, kriegt's von beiden Seiten.",
      "Haltet den Zechenplatz, egal was kommt!",
    ],
    vogt: [
      "Läutet die Glocke! Alle zur Vogtei!",
      "Das ist unser Tal! Schickt sie heim, blutig!",
      "Wer jetzt kämpft, isst den Winter über zuerst.",
    ],
  },

  krieg_sieg: {
    any: [
      "Ha! Das hat gesessen!",
      "Das hat {gegner} verdient.",
      "Gewonnen! Heute Abend wird gesoffen!",
      "Seht ihr die rennen? Das war's dann wohl.",
      "Ein paar Beulen, aber wir stehen noch.",
      "Davon redet man in {gegner} noch lange.",
      "Hat mich zwei Zähne gekostet. Hat sich gelohnt.",
      "Meine Hacke hat heute mehr geschafft als die ganze Woche.",
      "Verbindet die Verletzten, dann wird gefeiert.",
    ],
    rottmeister: [
      "Gute Arbeit, Rotte. Doppelte Ration heute.",
      "Zählt die Köpfe. Ich will keinen vergessen.",
      "So kämpft eine Rotte! Merkt euch das.",
    ],
    vogt: [
      "Ein Sieg für {dorf}. Der Rat wird's gern hören.",
      "Gut gemacht. Jetzt aber keine Dummheiten mehr.",
      "Heute haben wir gewonnen. Morgen zählen wir die Kosten.",
    ],
  },

  krieg_niederlage: {
    any: [
      "Verdammt. Alles für nichts.",
      "Die haben uns die Schlacke aus dem Leib geprügelt.",
      "Rettet, was noch zu retten ist. Schnell!",
      "Verloren. Das wird ein langer Winter.",
      "Das zahl ich {gegner} heim, schwör ich.",
      "Mein Schädel brummt wie die Appellglocke.",
      "Wer hat gesagt, das wird leicht? Dem hau ich eine rein.",
      "Scheiße. Leckt eure Wunden und haltet's Maul.",
      "Nächstes Mal. Nächstes Mal ohne Gnade.",
    ],
    rottmeister: [
      "Meine Rotte ist halbiert. Verfluchter Tag.",
      "Sammelt euch. Keiner bleibt liegen.",
      "Das war meine Schuld. Und ich vergess es nicht.",
    ],
    vogt: [
      "Eine Niederlage, keine Schande. Noch nicht.",
      "Der Rat wird mich dafür fressen.",
      "Wir leben noch. Das zählt jetzt, sonst nichts.",
    ],
  },

  appell: {
    any: [
      "Schon wieder Appell? Ich hab grad mal den Löffel gehoben.",
      "Die Glocke. Was will der Vogt denn jetzt?",
      "Wenn das wieder nur Gerede ist, geh ich.",
      "Wer schwänzt, sitzt im Karzer. Also stehen wir halt.",
      "Bestimmt wieder Abgaben. Verfluchte Glocke.",
      "Der Vogt redet, wir frieren.",
      "Hoffentlich geht's um den Pass. Geht's aber nie.",
      "Antreten, Maul halten, nicken. Kenn ich.",
      "Wer am lautesten nickt, kriegt die beste Schicht.",
    ],
    vogt: [
      "Ruhe! Wer redet, wenn ich rede, verdient sich den Karzer.",
      "Alle da? Nein? Dann merk ich mir die Lücken.",
      "Hört zu, das sag ich nur einmal.",
      "Ich läut die Glocke nicht zum Spaß.",
    ],
    rottmeister: [
      "Rotte, vorne antreten. Und keiner gähnt.",
      "Lasst den Vogt ausreden. Dann meckert ihr.",
      "Wieder eine Stunde weniger Arbeit. Toll.",
    ],
  },

  karzer: {
    any: [
      "Lasst mich raus, ihr Dreckskerle!",
      "Kalt, feucht, und die Ratten haben mehr Platz.",
      "Ich hab nichts getan! Fast nichts!",
      "Wer mich hier reingesteckt hat, kriegt's zurück.",
      "Vier Wände, ein Eimer. Der Vogt nennt das Gnade.",
      "Zähl die Steine. Dreihundert. Nochmal von vorn.",
      "Irgendwann komm ich raus. Und dann knallt's.",
      "Bringt mir wenigstens Brot, ihr Unmenschen.",
      "Besser als die Grube. Knapp.",
    ],
  },

  wetter: {
    any: [
      "Dreckswetter. Selbst die Ziegen fluchen.",
      "Es regnet Asche. Schon wieder.",
      "Kalt bis in die Zähne.",
      "Sturm. Hält die Baracke? Wohl kaum.",
      "Der Regen wäscht die Schlacke in die Rüben.",
      "Nass bis auf die Knochen. Scheiße.",
      "Bei dem Wind kriecht dir der Staub in jede Ritze.",
      "Der Himmel ist so grau wie die Halden.",
      "Wer jetzt draußen schuftet, ist bescheuert. So wie ich.",
    ],
  },

  nacht: {
    any: [
      "Kann nicht schlafen. Der Berg knarrt.",
      "Mitten in der Nacht, und ich zähl Groschen, die ich nicht hab.",
      "Was schleichst du hier rum? Geh pennen.",
      "Nachts klingt der Stollen wie ein Tier.",
      "Im Dunkeln sieht das Tal fast schön aus. Fast.",
      "Wer jetzt noch wach ist, hat was vor.",
      "Hörst du das? Steine rutschen. Wieder.",
      "Psst. Die Baracke schnarcht.",
      "Morgen wieder Schicht. Und ich lieg wach. Klasse.",
    ],
  },
};
