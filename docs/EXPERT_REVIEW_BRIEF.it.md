# D20 FireVerse — Documento per revisione esperta

**Versione:** 1.0 — 28 settembre 2026
**Stato del progetto:** fase di design. Nessuna riga di codice scritta, solo struttura del repository e documenti di decisione.
**Scadenza di consegna:** 23 ottobre 2026, ore 12:00 Pacific Time (circa 25 giorni da oggi)

---

## 0. Cosa ti chiedo

Ti chiedo di **validare o smontare** questo progetto prima che iniziamo a sviluppare. Mi serve un parere franco su:

1. **Fattibilità:** si riesce a consegnare in 25 giorni con un piccolo team?
2. **Architettura:** le scelte tecniche reggono, o c'è un errore strutturale?
3. **Scope:** cosa taglieresti e cosa manca?
4. **Rischi:** quali rischi sottovalutiamo, e quali assunzioni sono sbagliate?
5. **Competitività:** l'idea può vincere secondo i criteri di giudizio dell'hackathon?

In fondo (sezione 19) trovi domande mirate, divise per area di competenza. Puoi rispondere solo a quelle della tua area.

Dove un'informazione **non è verificata** lo scrivo esplicitamente. Correggimi se qualcosa è sbagliato.

---

## 1. Sintesi in 10 righe

- **Cos'è:** un gioco di ruolo da tavolo con d20, basato sulle regole libere SRD 5.1, che si gioca su Amazon Fire TV.
- **Come si gioca:** la campagna è già scritta, con scelte narrative a voto. I combattimenti sono tattici, su griglia, a turni, e ogni giocatore usa liberamente le azioni della propria scheda.
- **Chi gioca:** da 1 a 3 giocatori online, ognuno a casa propria con la sua Fire TV.
- **Input:** telecomando Fire TV (obbligatorio), comandi vocali, e in opzione mouse e tastiera Bluetooth. Il telefono è solo una scheda personaggio in sola lettura.
- **Nessun master:** né umano né AI. Il "master" è il sistema: una storia scritta più un motore di regole deterministico.
- **Narrazione:** vocale con Amazon Polly, sottotitoli obbligatori.
- **Ambiente:** luci smart e audio Echo di casa sincronizzati con gli eventi di gioco, tramite Alexa.
- **Backend:** AWS serverless (API Gateway WebSocket, Lambda TypeScript, DynamoDB, S3, Polly). Il server è l'unica autorità sullo stato di gioco.
- **Persistenza:** personaggi e campagne salvati tra una sessione e l'altra, con level-up e bottino.
- **Licenza:** open source MIT. Contenuti di gioco SRD 5.1 sotto CC-BY 4.0.

---

## 2. Contesto: l'hackathon

**Evento:** "Build, Ship, Shape: Amazon Developer Hackathon 2026" (Devpost)
**Regolamento:** https://amazonappdev2026.devpost.com/rules

### 2.1 Requisiti del track Fire TV (dal regolamento)
- L'app deve funzionare su **Fire OS o Vega OS**. Qualsiasi framework è ammesso (React Native, web, Android nativo, ecc.).
- Serve un video demo **sotto i 3 minuti**, che mostri l'app su un dispositivo Fire TV reale **o** sul simulatore Fire TV/Vega. Il dispositivo fisico non è obbligatorio.
- Il repo GitHub deve essere pubblico e avere una licenza open source visibile. Deve contenere tutto il codice, gli asset e le istruzioni per farlo funzionare.
- Il lavoro deve essere originale e non violare copyright o marchi. Dati, SDK e asset di terzi devono avere una licenza valida per questo uso.
- Nel video non ci possono essere musica protetta da copyright né marchi di terzi.
- Categorie prioritarie: AI-enhanced viewing, sport, fitness, **family entertainment**, **multi-modal UX**, computer vision.

### 2.2 Criteri di giudizio (stesso peso)
1. **Tech Implementation:** qualità costruttiva e uso delle tecnologie e dispositivi del track.
2. **Design:** esperienza di prodotto completa e coerente, interazione adatta al dispositivo.
3. **Potential Impact:** caso d'uso credibile, pubblico oltre l'hackathon (es. Fire TV Appstore).
4. **Quality of the Idea:** creatività. Il regolamento cita testualmente come idea **ovvia** "remote-controlled game" e come idea **creativa** "multi-modal UX combining voice + D-pad + visual in a single flow".

**Bonus:** fino al **+10%** per chi consegna un "friction log" (problemi incontrati con gli strumenti Amazon).

### 2.3 Mini challenge a cui puntiamo in parallelo
- **AWS Builder:** progetto che usa servizi AWS con integrazioni documentate.
- **Open Source:** nuovo progetto con licenza open source.
- Si possono vincere al massimo un premio di track e un premio mini challenge.

### 2.4 Risorse
- Crediti AWS promozionali da $150, da richiedere entro il 21/10.
- Giudizio tra il 9 e il 20 novembre 2026.

---

## 3. Il prodotto

### 3.1 Problema e proposta
I giochi di ruolo da tavolo richiedono un master umano preparato, tempo di preparazione e di solito la presenza fisica nella stessa stanza. Le piattaforme digitali (tavoli virtuali) sono pensate per il PC e sono complesse.

**D20 FireVerse** porta il gioco di ruolo sul televisore del salotto:
- non serve un master;
- basta il telecomando;
- si gioca con amici a distanza, ognuno sul suo televisore;
- la casa partecipa: luci e suono seguono la storia.

### 3.2 Pubblico
- Gruppi di amici o famiglie che vogliono una sessione di 45–60 minuti senza preparazione.
- Giocatori di ruolo che non trovano un master.
- Neofiti incuriositi dal genere (per loro serve un'esperienza guidata).

### 3.3 Esperienza tipo (sessione)
1. Il giocatore apre l'app sulla Fire TV. La TV mostra un **codice di abbinamento**, che il giocatore conferma dal telefono con il suo account.
2. **Menu principale:** Nuova partita, Continua, Personaggi, Impostazioni (dispositivi Alexa della stanza, volumi).
3. **Creazione o scelta del personaggio.** Razza, classe, background e metodo per i punteggi: serie standard, point buy o tiro di dadi eseguito dal server.
4. **Stanza di gioco.** L'host crea la stanza e condivide un codice; fino a 2 amici entrano dalla loro Fire TV.
5. **Fase narrativa.** Polly legge il testo, i sottotitoli compaiono sulla TV, poi arrivano le scelte. Ogni giocatore vota col telecomando o a voce. Se non c'è maggioranza, ogni votante tira un d20 (lo tira il server) e il più alto sceglie. Alcune scelte richiedono prove di abilità ("Perception DC 13").
6. **Combattimento.** Luci rosse e musica di battaglia. Si tira l'iniziativa. Nel suo turno, ogni giocatore sceglie un percorso sulla griglia (anche spezzato, entro la sua velocità) e un'azione dalla scheda (attacco, incantesimo, oggetto, Dash, Dodge…). I nemici agiscono con un'AI tattica sul server. I dadi sono animati sulla TV e sincronizzati con il tiro del server.
7. **Progressione.** Bottino, riposi, level-up a metà campagna.
8. **Salvataggio automatico.** Si riprende un'altra sera.
9. **Morte di tutto il gruppo:** i giocatori scelgono se ricaricare il salvataggio o chiudere la partita.

### 3.4 Contenuto v1
- Una campagna one-shot in **2 atti**, da 45 a 60 minuti.
  - Atto 1: esplorazione e un combattimento.
  - Atto 2: dungeon e boss.
  - Level-up a metà (i personaggi partono dal livello 1).
- La campagna è un pacchetto di contenuti sostituibile. In futuro ne aggiungeremo altre, anche con livelli di partenza più alti.

---

## 4. Decisioni già prese (con motivazione)

| Area | Decisione | Motivazione |
|---|---|---|
| Master | Nessun master umano né AI. Campagna scritta. | Un'AI come master (es. Bedrock) introduce allucinazioni, latenza e stati incoerenti, ed è incompatibile con salvataggi e combattimento deterministici. |
| AI generativa | Solo **Polly** (sintesi vocale). Niente LLM nel v1. | Affidabilità della demo, costi prevedibili. |
| Combattimento | Azioni libere dalla scheda, non a scelta predefinita. | Deve essere un vero gioco di ruolo, non un'avventura a bivi. |
| Regole | SRD 5.1 **completo** a catalogo; motore guidato dai dati, con effetti tipizzati. | Richiesta di prodotto: "qualsiasi personaggio, tutti i mostri, tutte le magie". Limite legale: solo SRD. |
| Capacità di classe | Implementate **fino al livello 20**, con priorità ai livelli 1–3. | Scelta del committente, consapevole del rischio sui tempi. |
| Multiplayer | Co-op online, 1–3 giocatori, ognuno sulla propria Fire TV. Si gioca anche da soli. | Prodotto reale ("gioco con un amico da casa sua"), non party game da salotto. |
| Scelte narrative | Voto a maggioranza; senza maggioranza, spareggio con d20 tirato dal server. | Equità e "sapore da tavolo". |
| Autorità | Server autoritativo su tutto (dadi, movimento, azioni, AI nemici, voti). | Anti-cheat, coerenza tra client, salvataggi affidabili. |
| Input | Telecomando obbligatorio + voce + mouse/tastiera BT opzionali, su un'unica mappa di input astratta. | Fire TV nativo; la voce è richiesta dal criterio "creative multi-modal". |
| Telefono | Solo scheda personaggio in sola lettura. | Evita un secondo client di gioco; il multiplayer non ne dipende. |
| Engine TV | **Web** (TypeScript + Phaser 3 o PixiJS) in WebView, su Vega OS e Fire OS. | Vega OS non esegue APK Android (quindi niente Godot o Unity Android). Un'unica codebase TypeScript con backend e companion. |
| Backend | AWS serverless: API Gateway WebSocket, Lambda TS, DynamoDB, S3, Polly. | Adatto al turn-based, costo quasi zero a riposo, vale per la mini challenge AWS Builder. |
| Account | Account creati da un admin; login con codice di abbinamento sulla TV. Account Amazon in futuro. | Digitare una password col D-pad è inaccettabile. |
| Persistenza | Personaggi (riusabili tra campagne) e salvataggi campagna su DynamoDB. | Level-up e bottino tra sessioni. |
| Alexa | Luci e audio Echo nel v1, **non bloccanti**. Dispositivi scelti per stanza/gruppo. Se falliscono, avviso e pulsante "Riprova". | Esperienza "casa che reagisce", senza che il gioco dipenda da questo. |
| Audio multi-casa | Sottotitoli obbligatori; ogni TV scarica e riproduce lo stesso MP3 Polly (un piccolo sfasamento è accettato). L'audio Echo è separato per ogni casa. | Semplicità e robustezza. |
| Movimento | Griglia a 4 direzioni, 5 ft per cella, percorsi composti entro la velocità. Il server calcola le celle raggiungibili, il client mostra l'anteprima, il server valida. | Adatto al D-pad, niente logica duplicata sul client. |
| Mappe | Mini editor interno che produce JSON. | Serve per le mappe della campagna e per quelle future. |
| Licenze | Codice MIT; SRD CC-BY 4.0 con attribuzione; campagna **solo con licenza compatibile** (CC-BY o simile). | Regolamento hackathon e repo pubblico. |
| Termini vietati | "Dungeons & Dragons", "D&D", "Dungeon Master", mostri proprietari (Beholder, Mind Flayer…). | Marchi e proprietà di Wizards of the Coast. |
| Lingua | Tutto in inglese: gioco, voce, codice, documentazione. | Requisito dell'hackathon internazionale. |

---

## 5. Architettura

### 5.1 Vista d'insieme

```
 Casa A                       AWS (eu-west-1)                     Casa B / C
┌──────────────┐        ┌───────────────────────────┐        ┌──────────────┐
│ Fire TV      │◄──WS──►│ API Gateway WebSocket     │◄──WS──►│ Fire TV      │
│ (web client) │        │        │                  │        │ (web client) │
│ remote/voce  │        │   Lambda TS (game server) │        └──────────────┘
└──────┬───────┘        │   ├─ rules engine         │
       │                │   ├─ enemy AI             │        ┌──────────────┐
┌──────▼───────┐        │   ├─ story/vote engine    │◄──WS──►│ Telefono     │
│ Luci / Echo  │◄─Alexa─┤   └─ save/load            │        │ (sola        │
│ (per casa)   │        │ DynamoDB  S3  Polly       │        │  lettura)    │
└──────────────┘        └───────────────────────────┘        └──────────────┘
```

### 5.2 Monorepo

```
packages/rules           Motore regole SRD in TypeScript puro (condiviso)
packages/protocol        Tipi e validazione dei messaggi WebSocket
packages/content-schema  Schemi JSON di campagna, incontri, mappe
tv/                      Client Fire TV web (wrapper Vega + Fire OS)
backend/                 Lambda, infrastruttura, integrazione Polly/Alexa
companion/               Scheda web in sola lettura
content/srd              Dati SRD 5.1 in JSON (con attribuzione)
content/campaigns        Campagne con licenza compatibile
content/maps             Mappe prodotte dall'editor
tools/map-editor         Mini editor di mappe
docs/                    Decisioni, protocollo, spike, friction log
```

### 5.3 Client TV
- TypeScript + Vite; rendering 2D con Phaser 3 o PixiJS (da decidere con una prova di prestazioni).
- Mostra griglia, pedine, effetti, animazione dei dadi, sottotitoli, menu, stanza, impostazioni.
- Non contiene regole di gioco: invia intenzioni e visualizza lo stato ricevuto dal server.
- Obiettivo: 30 FPS su una griglia 20×15 con circa 20 pedine ed effetti.

### 5.4 Backend
- **API Gateway WebSocket:** connessioni persistenti di TV e companion.
- **Lambda TypeScript:** gestisce ogni messaggio; carica lo stato della stanza da DynamoDB, applica il motore regole, salva, trasmette a tutti.
- **DynamoDB:** account, stanze, connessioni, personaggi, salvataggi, stato di combattimento.
- **Polly + S3:** le frasi scritte della campagna vengono sintetizzate **in fase di build** e messe in cache con un hash del testo. A runtime si sintetizzano solo le frasi dinamiche (es. "Aria hits the goblin for 7 damage").
- **Concorrenza:** due messaggi simultanei sulla stessa stanza devono essere serializzati. Idea attuale: scrittura condizionale DynamoDB con numero di versione (optimistic locking) e retry. **Da validare.**

### 5.5 Protocollo (bozza)
- **Dal client:** `AUTH_PAIR`, `CREATE_ROOM`, `JOIN_ROOM`, `CAST_STORY_VOTE`, `REQUEST_REACHABLE`, `PROPOSE_MOVE`, `PERFORM_ACTION`, `END_TURN`, `REQUEST_SAVE`, `CHOOSE_DEATH_OUTCOME`, `ALEXA_RETRY`.
- **Dal server:** `ROOM_STATE`, `STORY_NODE`, `VOTE_STATE`, `VOTE_RESULT`, `STATE_UPDATE`, `REACHABLE_CELLS`, `DICE_REVEAL`, `NARRATION` (testo + URL audio), `ALEXA_HINT`, `SAVE_ACK`, `ERROR`.
- Il client non decide mai il valore di un dado.

---

## 6. Motore di regole

### 6.1 Perimetro
**Catalogo:** tutto l'SRD 5.1, cioè razze, classi e sottoclassi, background, talenti, incantesimi, mostri, equipaggiamento, condizioni.

**Nota importante, da verificare:** l'SRD 5.1 contiene un sottoinsieme limitato del gioco completo. Per esempio, per quanto mi risulta, **una sola sottoclasse per classe, un solo background e un solo talento** (Grappler). Il desiderio di "tutti i talenti" è quindi limitato dall'SRD stesso. Esiste anche l'**SRD 5.2** (regole 2024, anch'esso CC-BY 4.0), con più talenti e background. Serve decidere quale versione usare. Vedi domande in sezione 19.

**Fonte dati prevista:** JSON derivati dall'SRD, del progetto open source `5e-srd-api` / `5e-database`. Licenze da verificare. Escluso 5etools, che contiene materiale non SRD.

### 6.2 Approccio
- Motore **guidato dai dati**: ogni incantesimo, capacità e attacco viene tradotto in una lista di **effetti tipizzati** (attacco, tiro salvezza, danno, cura, bonus/malus, condizione, movimento forzato, area, evocazione, concentrazione, durata).
- Un piccolo insieme di handler speciali per ciò che non si può esprimere in dati (es. Wish, Polymorph, Wild Shape).
- Meccaniche di base: punteggi e modificatori, competenza, vantaggio/svantaggio, colpo critico, resistenze e vulnerabilità, slot incantesimo, concentrazione, azione / azione bonus / reazione / movimento, attacchi di opportunità, copertura, riposi breve e lungo, tiri contro morte, esaurimento.
- Capacità di classe fino al livello 20; priorità ai livelli 1–3 perché la campagna li usa.

### 6.3 AI dei nemici
Senza master, qualcuno deve giocare i mostri. Previsto:
- profili di comportamento (aggressivo, difensivo, codardo, caster, protettore);
- scelta del bersaglio con euristiche (PF bassi, vicinanza, minaccia);
- movimento con pathfinding sulla griglia;
- uso delle azioni del blocco statistiche (attacchi multipli, incantesimi, azioni a ricarica).

### 6.4 Fuori dal combattimento
- Prove di abilità e tiri salvezza definiti nei nodi della storia, con esiti diversi.
- Riposi, bottino, negozi semplici, trappole.

---

## 7. Multiplayer e sincronizzazione
- **Stanza:** l'host crea, gli altri entrano con un codice di 6 caratteri. "Host" significa solo "creatore con privilegi": la simulazione è tutta sul server.
- **Fase narrativa:** tutti vedono lo stesso nodo, voto collettivo, spareggio d20.
- **Combattimento:** iniziativa individuale. Chi non è di turno vede cosa fanno gli altri, con il messaggio "Waiting for <name>".
- **Disconnessione:** pausa automatica dopo un timeout, salvataggio, ripresa alla riconnessione. Da definire cosa succede se il giocatore non torna (il gruppo continua con il suo PG controllato dall'AI? Rimozione?).
- **Audio:** ogni TV riproduce lo stesso MP3; lo sfasamento tra le case è accettato. I sottotitoli garantiscono comprensione.

---

## 8. Input
- **Livello astratto:** `MoveCursor`, `Confirm`, `Cancel`, `Point`, `Tab`, `VoiceCommand`.
- **Telecomando:** frecce per cursore e menu, OK per confermare, Back per annullare.
- **Mouse/tastiera BT:** puntatore e click, frecce, Invio, Esc, scorciatoie.
- **Voce:** votare le scelte ("choose option two"), dichiarare azioni ("cast fireball on the goblin"), comandi rapidi ("end turn").
  - **Non verificato:** quale canale tecnico permetta l'input vocale dentro un'app su Vega OS e Fire OS. Candidati: Alexa Video Skill Kit, skill Alexa custom, server MCP per Alexa+, microfono del telefono tramite companion. **Prova tecnica prevista nella settimana 1.**
- **Movimento sulla griglia:** il server invia le celle raggiungibili; il giocatore traccia il percorso con le frecce (anche spezzato), vede l'anteprima e conferma.

---

## 9. Alexa e ambiente
**Obiettivo:** ogni giocatore sceglie nelle impostazioni i dispositivi della propria stanza (luci, Echo). Mai "tutta la casa" per default.

**Scene:**
- luci: taverna (ambra), esplorazione, combattimento (rosso), boss, vittoria, sconfitta;
- pulsazione sugli incantesimi grandi;
- tinta di urgenza con PF bassi;
- flash in base al tipo di danno;
- oscuramento in fase stealth;
- audio d'ambiente in loop su Echo, con controllo del volume.

**Non bloccante:** se Alexa non è collegata, il gioco funziona uguale. Se fallisce durante la partita, compare un avviso e un pulsante "Riprova".

**Non verificato, rischio alto:** per quanto mi risulta non esiste un'API pubblica che permetta a un'app di terze parti di comandare a piacere le luci dell'utente collegate ad Alexa, né di avviare audio su un Echo senza un'invocazione vocale. Alternative possibili: trigger di routine Alexa, API locale di Philips Hue, skill con AudioPlayer. **Prova tecnica prevista nella settimana 1.**

---

## 10. Audio e narrazione
- **Polly:** voci Neural in inglese (es. Matthew, Brian). Sintesi in fase di build per i testi fissi.
- **Volumi separati:** narrazione, effetti, musica, Echo.
- **Musica ed effetti:** pacchetti CC0 o CC-BY (preferenza). Opzioni alternative documentate in `docs/ART_AUDIO_OPTIONS.md`.

---

## 11. Account e persistenza
- **v1:** account creati da un admin. Login con codice di abbinamento mostrato sulla TV e confermato dal telefono o dal web. Implementazione probabile con Amazon Cognito (da confermare).
- **Futuro:** login con Amazon.
- **Dati salvati:** personaggi (riusabili tra campagne diverse), salvataggi di campagna (nodo corrente, stato del gruppo, bottino, flag narrativi), stato di combattimento se si salva a metà.

---

## 12. Contenuti, grafica, aspetti legali
- **Campagna:** va trovata un'avventura con licenza **CC-BY o compatibile**, da adattare. Un modulo "trovato su internet" senza licenza **non** può entrare nel repo.
- **Grafica:** placeholder geometrici durante lo sviluppo, poi un pacchetto CC0 (es. Kenney) e un logo originale.
- **Attribuzione:** file `ATTRIBUTION.md` con SRD e ogni asset di terzi.
- **Nessun riferimento** ai marchi di Wizards of the Coast, nemmeno nel pitch ("tabletop RPG", "d20 SRD").

---

## 13. Dispositivi supportati

| Sistema | Dispositivi (per quanto verificato) | Note |
|---|---|---|
| Fire OS (base Android) | Fire TV Stick 4K, 4K Plus, 4K Max, vecchie HD | App via WebView wrapper / APK |
| Vega OS (base Linux) | Fire TV Stick 4K Select, nuova Fire TV Stick HD | Solo React Native o WebView; niente APK |

Amazon ha dichiarato che le future Fire Stick useranno Vega OS. Per la demo è accettato il simulatore.

**Da verificare:** prestazioni reali di Canvas/WebGL nella Vega WebView e nella WebView di Fire OS su hardware entry-level.

---

## 14. Costi (stime da validare)
- **Budget del team:** circa 0 €, più $150 di crediti AWS dell'hackathon.
- **Polly:** la campagna ha forse 30–60 mila caratteri di narrazione; sintetizzati una volta sola, costano pochi dollari anche con voci Neural.
- **API Gateway WebSocket, Lambda, DynamoDB on-demand:** a volume da hackathon (poche decine di sessioni) si stima sotto i $5 al mese.
- **Rischio:** loop di messaggi o sintesi ripetute per errore. Mitigazione: allarmi di budget AWS, cache per hash.

---

## 15. Team e piano

**Team:** il committente più alcuni collaboratori con accesso al repo. Numero di persone e disponibilità oraria da definire.

**Piano in 25 giorni:**

| Periodo | Obiettivi |
|---|---|
| 28/09 – 04/10 | Account AWS e Amazon Developer, SDK Vega e simulatore. Prove tecniche su renderer, voce e Alexa. Schemi JSON. Import dati SRD. Scelta della campagna con licenza. |
| 05/10 – 11/10 | Motore regole di base. Backend WebSocket con stanze. TV: griglia, pedine, input. Login con codice. |
| 12/10 – 18/10 | Creazione personaggio. Ciclo di combattimento completo. AI nemici. Motore narrativo e voto. Polly. Salvataggi. |
| 19/10 – 21/10 | Voce, luci ed Echo, companion, level-up e bottino, capacità di classe oltre il livello 3. |
| 22/10 – 23/10 | Blocco delle modifiche, test, video di 3 minuti, consegna, friction log. |

---

## 16. Rischi noti

| # | Rischio | Probabilità | Impatto | Mitigazione attuale |
|---|---|---|---|---|
| 1 | Scope troppo ampio per 25 giorni (SRD completo fino al livello 20, 3 giocatori online, voce, Alexa, persistenza) | Alta | Alto | Priorità ai livelli 1–3; il resto è in coda |
| 2 | Alexa non permette di controllare luci ed Echo da un'app di terze parti | Media-alta | Medio | Prova tecnica subito; fallback Hue; funzione non bloccante |
| 3 | Nessun canale di input vocale utilizzabile dentro l'app | Media | Alto (criterio "creative") | Prova tecnica; fallback microfono del telefono |
| 4 | Prestazioni insufficienti della WebView su Stick entry-level | Media | Alto | Prova tecnica con Phaser e PixiJS; il simulatore basta per la demo |
| 5 | Concorrenza sullo stato della stanza in Lambda (race condition) | Media | Alto | Optimistic locking su DynamoDB |
| 6 | Campagna con licenza non adatta o introvabile | Media | Medio | Scriverne una ispirata, in parallelo |
| 7 | AI nemici troppo stupida o troppo lenta | Media | Medio | Profili semplici e deterministici |
| 8 | Bilanciamento della campagna (troppo facile o letale) | Alta | Medio | Test di gioco nella terza settimana |
| 9 | Coordinamento del team distribuito | Media | Alto | Ownership per package, PR piccole, contratti tipizzati |
| 10 | Video di 3 minuti che non trasmette il valore di un gioco da 60 minuti | Media | Alto | Sceneggiatura del video pianificata presto |
| 11 | Latenza WebSocket e cold start di Lambda percepibili | Bassa-media | Medio | Gioco a turni; warm-up; messaggi piccoli |

---

## 17. Fuori scope (v1)
- AI generativa come master o per testi dinamici (Bedrock).
- Telefono come controller di gioco.
- Matchmaking pubblico tra sconosciuti.
- Contenuti non SRD.
- Controllo Alexa di tutta la casa.
- Più di 3 giocatori.
- Login con Amazon.

---

## 18. Punti deboli che conosco già
- La scelta "SRD completo fino al livello 20" è voluta, ma il suo valore non si vede in una campagna di livelli 1–3 né in un video di 3 minuti.
- Le due funzioni più "creative" per i giudici, voce e casa che reagisce, sono anche le due **meno verificate** tecnicamente.
- Il passaggio da Godot a web è recente e motivato da Vega OS, ma nessuno ha ancora misurato le prestazioni.
- Non esiste ancora un documento di game design (bilanciamento, UX dei menu con D-pad, onboarding dei neofiti).
- Team, ruoli e ore disponibili non sono ancora definiti.

---

## 19. Domande per l'esperto

### A. Generali / product
1. In 25 giorni, con un team piccolo, cosa taglieresti per primo senza perdere competitività?
2. Il concept è "ovvio" o "creativo" rispetto ai criteri del regolamento? Cosa lo renderebbe più forte?
3. Un gioco di ruolo da 45–60 minuti è il formato giusto per giudici che guardano un video di 3 minuti?
4. Il pubblico "family entertainment" è credibile per un gioco con regole SRD complete, o serve una modalità semplificata?

### B. Fire TV / Vega OS
5. Web in WebView su Vega e Fire OS è una scelta solida per un gioco 2D a griglia? Meglio React Native per Vega?
6. Phaser 3 o PixiJS nella Vega WebView: ci sono limiti noti (WebGL, audio, memoria)?
7. Come si gestisce l'input vocale dentro un'app Fire TV / Vega? Esiste un canale ufficiale?
8. Focus management e navigazione D-pad in una WebView: problemi noti?
9. Pubblicare sull'Appstore sia per Vega sia per Fire OS con la stessa codebase web è realistico?

### C. Alexa / smart home
10. Un'app di terze parti può comandare le luci dell'utente scelte da lui (per stanza o gruppo) tramite Alexa? Con quale API?
11. Si può avviare audio d'ambiente su un Echo dall'app, senza invocazione vocale?
12. Se no, qual è l'alternativa più credibile (routine, Hue, skill)?
13. Ha senso usare il track Alexa+ (server MCP) come componente del progetto Fire TV?

### D. Backend / AWS
14. API Gateway WebSocket + Lambda + DynamoDB per un gioco a turni con stato condiviso: va bene, o serve un processo con stato (ECS, GameLift, server Node persistente)?
15. Come serializzeresti i messaggi concorrenti sulla stessa stanza?
16. Cognito per il login con codice di abbinamento: è la scelta giusta, o è eccessiva?
17. Le stime di costo sono realistiche? Quali trappole di billing conviene evitare?
18. Cosa renderebbe il progetto competitivo per la mini challenge AWS Builder, visto che il regolamento considera "ovvio" l'uso di S3 per storage o di una singola chiamata Bedrock?

### E. Regole e game design
19. SRD 5.1 o SRD 5.2 (regole 2024)? Quale offre più contenuto utile, e quale ha dati JSON già pronti?
20. Un motore di regole guidato da effetti tipizzati regge l'intero SRD? Quanti casi speciali ti aspetti?
21. L'AI dei nemici con profili ed euristiche è sufficiente per un'esperienza divertente?
22. La griglia a 4 direzioni al posto delle diagonali snatura troppo le regole?
23. Il voto con spareggio a d20 funziona per 2–3 giocatori, o crea frustrazione?
24. Che cosa succede se un giocatore si disconnette definitivamente a metà combattimento?
25. Come renderesti la creazione del personaggio veloce col telecomando, visto che la scelta di incantesimi e talenti può essere lunga?

### F. Legale
26. Codice MIT + dati SRD CC-BY 4.0 + asset CC0: ci sono incompatibilità?
27. Quali termini o elementi (oltre a "D&D" e ai mostri proprietari) sono a rischio?
28. Dove trovare avventure one-shot con licenza CC-BY o compatibile adatte ai livelli 1–3?
29. I JSON di `5e-srd-api` / `5e-database` possono essere inclusi nel repo? Con quale attribuzione?

### G. Delivery
30. Come struttureresti il video da 3 minuti?
31. Come organizzeresti un team distribuito per non bloccarsi sui contratti tra package?
32. Quali tre metriche misureresti per dire "è pronto per la consegna"?

---

## 20. Glossario
- **SRD 5.1 / 5.2:** System Reference Document; sottoinsieme delle regole della 5ª edizione rilasciato sotto licenza Creative Commons CC-BY 4.0.
- **d20:** dado a 20 facce, alla base delle risoluzioni.
- **Server autoritativo:** il server è l'unico a decidere lo stato di gioco; i client inviano solo intenzioni.
- **Vega OS:** nuovo sistema operativo Amazon basato su Linux per Fire TV; supporta React Native e WebView, non gli APK Android.
- **Fire OS:** sistema Fire TV basato su Android.
- **Polly:** servizio AWS di sintesi vocale.
- **Companion:** app web sul telefono che mostra la scheda personaggio in sola lettura.
- **Friction log:** registro dei problemi incontrati con gli strumenti Amazon; vale un bonus in giudizio.
- **Spike:** prova tecnica a tempo limitato per verificare la fattibilità di una scelta.

---

## Allegati nel repo
- `.cursorrules`: regole operative per lo sviluppo
- `docs/PRODUCT_DECISIONS.md`: decisioni bloccate
- `docs/SPIKES.md`: prove tecniche in corso
- `docs/ART_AUDIO_OPTIONS.md`: opzioni per grafica e audio
- `docs/protocol.md`: bozza del protocollo WebSocket
