# Changelog

All notable changes will be documented here once Voyalier begins publishing releases.

The project follows Semantic Versioning and keeps unreleased work under the section below.

## [Unreleased]

## [0.9.1] - 2026-08-02 — What the browser already promised

### Fixed

- **The passport field has its Save button back.** A sizing rule written for the
  visa cockpit's picker row landed one element too deep — on the combobox rather
  than the field wrapper around it — and because that wrapper stacks its label,
  hint and input in a column, a width of 16rem was read as a height of 256px. A
  44px input became a 256px box, which pushed Save 166px below the field it
  submits and left the country suggestions floating 216px under the input, on
  top of the hint text. On a phone the gap was 220px, over a quarter of the
  screen. Nothing about this was visible to the test suite: jsdom performs no
  layout and reports every element as zero-sized, so all 742 unit tests agreed
  the panel was fine. The guard therefore lives in the end-to-end suite, which
  drives a real browser and already runs inside `make check`; it fails if the
  rule ever moves back.
- **Place names are counted the way the engine counts them.** The trip forms
  measured with JavaScript's `.length`, which counts UTF-16 units, while the
  engine counts characters — so a 61-character name written with emoji counted
  as 122 and was refused, while the same value posted straight to the engine was
  accepted. Pasted, it was worse: the browser's own limit cut it to 60 and said
  nothing at all. Both forms now use the shared counter and the shared constant.
  The limit stays where it was; only the arithmetic changed.
- **A detour no longer costs you your place.** Opening Settings from a search
  discarded the query, opening search from inside a trip dropped you back on the
  trip list while Settings returned correctly, jumping to a result in another
  trip carried the previous trip's section into the new one, and the visa guide
  forgot which step you had open. Four symptoms, three causes, all now closed.
  Notes typed but not saved were never at risk, and still aren't — that was
  checked rather than assumed.
- **Visa steps say each thing once.** Where a step and one of its documents cite
  the same official page — which the curated journeys do in 14 places across all
  four of them, sometimes from a single shared helper — the page was printed
  twice, one line apart, reading as two separate requirements. The duplicate is
  dropped in the interface; the curated data is untouched, because it was never
  wrong.
- **Search titles itself.** It was the only top-level view in the app without a
  top-level heading, which left screen-reader and heading navigation without an
  answer to "where am I". An empty result also now says what is and is not
  searched, at the point of failure rather than three lines above it.
- **A trip's route is printed once.** A trip created without a name is titled
  "From → To" by the engine, which is exactly what the route line underneath it
  said — so most trips showed the same words twice, on the card and again in the
  header.
- **Japanese and Chinese input methods keep their arrow keys.** Every place and
  country field shares one control, and it claimed ArrowUp, ArrowDown, Enter and
  Escape unconditionally — the same keys an input method uses to move through
  its candidate window. It now stands aside until composition ends.

### Added

- **Back does something.** Opening a trip used to leave the browser's history
  untouched, so Back walked out of the workspace rather than undoing the move —
  and on a phone, the back swipe is the first thing anyone reaches for. The view
  now lives in the address bar, which also makes a trip or a section of one
  shareable and bookmarkable. This reverses a decision recorded as an explicit
  non-goal; ADR-0015 carries the reversal and its reasons, chiefly that the same
  deferred list also holds cross-trip search, which shipped two releases ago.
  The search query is deliberately kept out of the URL: it is your own text
  about your own trips, and the address bar is the one place here that would
  carry it into history, screenshots and screen shares.

### Not fixed

- A visa-statistics fetch that reaches the authority but cannot read the reply
  still reports as though the authority were unreachable. The audit blamed the
  interface for discarding a distinction the engine had already made; that was
  wrong. The engine returns one error code for a network failure, a parse
  failure and an uncurated source alike, so telling them apart means adding to
  the wire contract — an ADR, not a release-eve patch.
- The import and candidate-review flow was not exercised by the audit behind
  this release, and is named here rather than left implicit. It is the one
  surface where a paste is still trimmed silently, and where the next pass
  should start.

## [0.9.0] - 2026-08-02 — No route is a dead end

### Added

- **No visa route is a dead end any more.** Every trip whose destination
  resolves now gets a step-by-step guide: the curated journeys where they exist
  (Canada, Japan, Australia), and everywhere else a six-step universal playbook
  — how to find the real authority under the lookalike agency sites, the shared
  vocabulary of entry paths, the document classes that fail when started late,
  where to file, how to track, and what a decision does and does not promise at
  the border. The playbook opens with a banner naming it Voyalier's own
  writing, never reads as an authority's answer, and holds ADR-0006's rule
  under a stricter scan than the curated prose: no currency marks, no duration
  units, anywhere. Ticks, notes, and the self-reported readiness tally work
  identically in both guides. The tradeoff is generality — the playbook links
  at most the one page a real curation act stands behind, and says "confirm at
  the official checklist" where a curated journey would name the exact form.

- **The cockpit can now fetch the authority's own published processing times —
  and ships with none.** A statistics card headed by the authority's name
  starts empty on purpose: no figure is bundled, because a shipped number ages
  into a lie (ADR-0014). One press reads IRCC's processing-times dataset or
  UKVI's decision waiting times page from your device, quotes the rows
  verbatim — the source's labels, units, and "no processing time available"
  included — with the retrieval stamp, the source's own as-of date where it
  publishes one, the licence line, and your own passport's row marked where
  the publication is per-country. The raw page is kept locally and re-read on
  every open, so a parser fix reaches copies already stored; a failed refresh
  keeps the copy visible under a loud banner, and anything older than a week
  says so. Japan, Australia, New Zealand, Korea, and the United States publish
  no dataset Voyalier can read yet, and their cards say exactly that with the
  official link. Statistics history and a US parser were left out deliberately
  — the stored copy is overwrite-on-refresh, and trends are future work.

- **The passport picker now speaks your language.** Typing a country's name —
  in English or Spanish, matched without worrying about accents — suggests
  countries ranked the way travellers type (code match, then name prefixes,
  then the rest, each alphabetically), and a bare two-letter code still works
  exactly as before. A new trip offers the last trip's passport as a single
  labelled tap instead of silently prefilling the field. The visa panel's four
  zones sit on the app's new spacing scale, missions fold behind a disclosure,
  and headings no longer crowd their paragraphs.

### Fixed

- **City packs now select useful places across the whole city instead of one
  parquet-scan corner.** The builder ranks rows by Overture confidence with a
  deterministic visible-field tie-break, gives places and practical amenities
  separate budgets, and excludes categories that do not belong in a travel
  workspace. A failed or empty places query still stops publication, including
  when DuckDB prints an error but exits successfully.

  The source confidence used to choose each row is now retained in the pack
  instead of being discarded after sorting. Older downloaded packs remain
  readable because the field is optional. The category allowlist is deliberately
  conservative; newly introduced Overture categories stay out until reviewed,
  and migrating from the source's deprecated primary-category field remains
  separate work.

- **Recommendations no longer mistake substrings for travel categories, and
  religious and heritage sights are no longer invisible.** `barber` no longer
  becomes nightlife because it contains "bar", and `apartment_building` no
  longer becomes culture because it contains "art". Temples, shrines, churches,
  mosques, synagogues, castles, palaces and monasteries now score as culture.

  Hotels, hostels and ryokan remain unranked because Voyalier has no stay
  dimension; they continue to appear through place-name suggestions rather than
  being assigned a misleading persona score.

- **A configured local API address now agrees with the address the server
  actually bound.** Alternate loopback addresses and an operating-system-chosen
  port no longer fail their own Host check. Non-loopback bind requests are
  rejected before listening, so this does not turn the local engine into a
  network service.

### Changed

- **Runtime, test, and CI dependencies were brought forward together.** This
  includes MapLibre GL 6, current Rust cryptography utilities, the JavaScript
  toolchain, and maintained GitHub Actions. The getrandom and SHA-256 call sites
  were migrated explicitly rather than suppressing their breaking API changes;
  no hosted service or new product capability was added.

## [0.8.3] - 2026-08-01 — The request payload is declared

### Changed

- **Voyalier's two ways of talking to its own engine are now held to the same
  field names.** The browser reaches the local engine over HTTP and the desktop
  app reaches it over Tauri commands, and 72 of the 81 operations write a field
  name by hand on one side and read it by name on the other. Nothing compared
  the two halves, so renaming one field in the desktop bridge left the trip
  editor dead with the entire test suite green.

  The route manifest now declares each request's payload, checked from three
  sides: what each transport actually puts on the wire, what the local server
  reads, and what the desktop app reads. Any two agreeing while the third
  disagrees fails the build.

  Nothing a traveler can see changed. Writing the guard did surface a case the
  earlier review missed — five operations forward a whole object to a struct
  the desktop app re-declares locally rather than sharing — and both facts are
  now recorded and checked.

  What this does not cover: when an operation forwards a whole object, the
  guard proves the forward happened, not that both languages describe that
  object with the same field names. That gap is 18 request bodies and 16
  desktop commands wide and is stated in ADR-0012 rather than left implicit.

### Documentation

- **The decision index listed four records out of twelve, and the agent guide
  described a manifest that had since grown.** Both are corrected, and v0.8.2 —
  which shipped without release notes of its own — now has them.

## [0.8.2] - 2026-08-01 — One copy of each rule

### Fixed

- **Chat again points at the real authority for the questions it was quietly
  skipping.** Voyalier puts a card above a local model's answer whenever a
  question touches entry, health, safety, or prices — subjects it refuses to be
  the last word on. The demonstration build carried its own hand-written copy
  of the word list behind that card, and the copy had fallen to twenty of the
  engine's forty-eight terms and none of its six multi-word phrases. A question
  about entry requirements, customs, ESTA, Schengen, overstaying, quarantine,
  malaria, terrorism, curfews, travel insurance, or yellow fever got the
  model's answer with nothing above it.

  The list is now one file both sides read, so there is no second copy left to
  drift. The single test covering this behavior had asked "Do I need a visa" —
  one of the twenty words the two lists still shared — and passed throughout.

  Only the demonstration build was affected; the shipped desktop and local
  server always used the full list.

- **Three panels now say when the local engine cannot be reached.** Opening AI
  provider settings, reading the encryption status, and setting a passphrase
  each dropped their failure on the floor. The worst of them removed the whole
  Encryption section from Settings with no message, because a panel with no
  status renders nothing at all. All three now show the failure, offer a retry
  where one can help, and tell the workspace status indicator the truth instead
  of leaving it reading Ready.

- **A currency conversion is computed one way rather than two.** The
  destination money block and the engine each carried their own cross-rate
  arithmetic, and nothing held them to the same answer. Writing the shared test
  corrected a real misunderstanding on the way in: the European Central Bank
  feed does not list the euro, and Voyalier adds it at parity so that
  converting from euros needs no special case. An unknown currency still shows
  nothing rather than a rate of one, which would read as a real quote.

### Changed

- **Several rules that existed in more than one place now exist in one.**
  Great-circle distance was written three times, the "this source returned
  something unreadable" sentence seven times, and a test helper for opening the
  sample trip six times. None of this changes what Voyalier does; it changes
  how many places have to agree for it to keep doing it.

- **Two guards were taught to check what they claimed to check.** The
  declaration of which database columns are encrypted was fourteen strings that
  nothing compared against the database, so a typo would have stopped
  encrypting a column in silence. A second check covers a failure that could
  only ever have appeared on an existing traveler's machine during an upgrade,
  never on the machine that introduced it.

  This release deliberately does not touch the larger findings from the same
  review — the two transport layers that are almost entirely forwarding, the
  request payloads no guard covers, or the database schema stated in three
  places. Those need their own decision records and are written down in
  `docs/superpowers/plans/2026-08-01-architecture-deepening-0.8.2.md` so the
  next review does not rediscover them.

## [0.8.1] - 2026-08-01 — The feedback repair

### Fixed

- **A failed form now points to the field that needs changing.** An activity
  whose end preceded its start used to discard the server's field detail,
  display only “Check highlighted fields,” highlight nothing, and offer to
  retry the same invalid request. Saved-reading tags failed the same way when
  there were too many or one was too long. Both forms now name the rule beside
  the responsible field, mark and focus that field, clear the message when the
  traveler corrects it, and reserve Retry for failures that can actually
  recover without editing the request.

  This repair uses the validation details the local engine already returns; it
  does not add browser-side product rules or change the contract.

- **A valid passport code no longer becomes “invalid” when the engine is
  offline.** The visa form had collapsed every save failure into the two-letter
  format message, so a valid code such as `US` was blamed when the real problem
  was transport. Format validation now stays attached only to format failures,
  while the existing workspace recovery banner owns an offline save. The
  traveler-entered code and previously loaded visa guidance remain visible.

  Voyalier still does not infer eligibility or treat a saved nationality as a
  visa decision.

- **Visa progress now describes the two different counts it displays.** The
  checklist count records what the traveler can complete; the guide-step count
  records the authority-backed route Voyalier presents. A four-step route with
  one askable checklist item now says “0 of 1 complete across 4 guide steps”
  instead of appearing to contradict the four-step rail above it.

- **Every trip section is discoverable on a narrow screen.** At 320 and 375
  pixels the horizontal section bar could hide the final AI destination with
  no visual or accessible cue. A named, keyboard-operable continuation control
  now appears only while more section links remain to the right and disappears
  after they are revealed. The page itself still does not scroll sideways.

- **Theme radios keep their names when their visible captions are hidden.** The
  compact topbar and Settings controls now expose Light, System, and Dark to
  assistive technology at every responsive layout. This changes no appearance
  preference or persistence behavior.

## [0.8.0] - 2026-07-31 — The clock repair and four more authorities

### Fixed

- **A trip that crosses a daylight-saving change no longer reads an hour
  wrong.** The destination-facts snapshot resolved a single UTC offset on the
  trip's _first_ day and then used it for every day of the window, so a Paris
  trip spanning the last Sunday in March — or a US trip spanning the first
  Sunday in November — printed every later sunrise, sunset and golden hour
  sixty minutes out, and the home-versus-destination clock with them. The
  snapshot now keeps the IANA zone the geocode already returned and derives
  each day's offset from it.

  The repair comes with the thing it makes possible: when either end of the
  trip moves its clocks mid-stay, the card says so — which place, which day,
  which direction, by how much. It states the fact and stops there; what to do
  about a lost hour is the traveler's business. The time difference beside it
  is still measured on the trip's start date, which is exactly why the change
  had to be stated separately rather than folded into that one number.

  Snapshots stored before this release carry no zone and fall back to the old
  behaviour until the facts are fetched again: one wrong hour beats no sun
  times, and no clock change beats an invented one.

- **Offline city packs had been downloading empty since 20 July.** Every pack
  on the release carried zero places for ten days — the catalogue listed them,
  the download succeeded, and what arrived had no places in it, so
  recommendations and pack suggestions had nothing to rank.

  The cause was a data source moving underneath the publisher: Overture keeps
  only its newest couple of releases, the one pinned here was deleted, and the
  build treated a failed query as "no places found" rather than as a failure.
  It now refuses to publish a pack it could not fill, which is the right trade
  for a publisher that is run by hand and can simply be run again. All
  twenty-two packs have been rebuilt and verified to contain places.

### Added

- **Four more countries will tell you what door you go through — and three of
  them decline to.** Australia resolves: the Department of Home Affairs
  publishes enumerated passport lists for its two electronic authorizations,
  and a passport on either one now gets a four-step route with the
  department's own pages at every step. A passport on neither resolves to the
  visitor visa, because that is Home Affairs' own residual structure.

  New Zealand, Korea and the United States are named as authorities that
  resolve nothing, and that was the finding rather than a shortfall. Each
  publishes a list clean enough to parse and then gates it on something a
  passport cannot answer: New Zealand needs a visa for medical treatment
  whatever the passport, Korea's K-ETA exemption is a temporary measure renewed
  a year at a time and currently expiring on 31 December 2026, and every one of
  the 42 US Visa Waiver Program designations is conditioned on travel history.
  Reading a list is not the same as answering the question the list is part of,
  so those three hand over the authority's own checker and no route.

- **Where your own country keeps an embassy, as somewhere to confirm rather
  than somewhere to go.** The visa panel already knows your passport and where
  you are going, so it now lists your country's embassies and consulates there,
  from a bundled offline extract of about 9,800 missions.

  It is deliberately not an address. The source records closures unevenly
  enough that the raw extract still returned embassies of countries that
  dissolved in 1990, so honorary consulates are excluded, only currently
  existing countries survive, and the panel tells you to confirm the address
  and hours with your own foreign ministry before relying on any of it.
  Coordinates are carried but not drawn as a map pin, for the same reason.

- **The eclipses that fall inside your trip.** Thirty-one of them, solar and
  lunar, through 2032, transcribed from NASA's catalogues and bundled — no
  fetch, no snapshot, just a function of your dates. The visibility line is
  NASA's own broad region, shown as exactly that: where the eclipse can be seen
  at all, never "visible from your destination", which would need a
  calculation this does not do.

  Meteor showers were researched for the same card and dropped. Both maintained
  shower calendars are all-rights-reserved and neither permits bundling, and
  the one public-domain alternative carries no rates and had not been updated
  past the previous year. Half the feature was preferable to a licence
  violation.

- **Six more cities in the offline pack catalogue** — Dubai, İstanbul,
  Marrakech, Ciudad de México, Rio de Janeiro and Sydney — chosen to widen a
  list that had been seven US, four European, two Japanese and two Southeast
  Asian, with nothing in Africa, South America, the Middle East or Oceania.
  All six are published and downloadable.

  Adding Dubai surfaced a matching bug worth naming: "United" is a word shared
  by the United Kingdom and the United Arab Emirates, and the suggestion logic
  matched on it, so a London trip was being offered a Dubai pack.

## [0.7.0] - 2026-07-31 — The research workspace and local chat

### Added

- **A trip is now where research lands, and the app can talk about it.** Two
  features, one rule holding both together: material you gather is kept apart
  from material you have confirmed, and the line between them does not move
  because something would be more convenient on the other side.

  **Research resources** are links and files you keep with a trip, each with your
  own title, note, and tags. The important word is _reading_. A resource is never
  evidence: it produces no confirmed booking, no pending candidate to review, and
  it cannot move the readiness rollup. Drop a booking confirmation into it and it
  is filed rather than imported — the panel says so and points at the import flow,
  because quietly parsing it would be the app deciding that your filing was a
  mistake. Saving contacts nothing and is instant.

  Fetching what a page _says_ is a separate thing, and it asks. One reversible
  setting, off until you turn it on, and until then the fetch control is absent
  rather than disabled. Turn it on and Voyalier stores a dated snapshot — title,
  description, and readable text with script and stylesheet content dropped —
  which you can read inside the app on a plane, and which becomes searchable
  alongside your notes and tags in both a trip's search and across every trip. The
  same page saved twice stays one resource; addresses differing only by a campaign
  parameter, a trailing slash, casing, or a fragment are the same page. The page's
  text is not encrypted, because it is public material you did not write and it
  has to stay searchable. Your note on it is, like every other note here.

  **Ask about this trip** is a conversation answered by a local Ollama model on
  your own machine. Cloud providers are deliberately not offered for it. The
  existing assist flow previews the exact request and asks before each send, which
  works because there is exactly one send; a conversation is many, and the honest
  choices were an unusable prompt per message or a standing permission to send
  your trip to a company — so chat is the local one, and cloud keeps the flow it
  can actually honour.

  Each answer is grounded by running the same deterministic search the search box
  uses and quoting back what it found, so the reply can list what it was built
  from and "why did it know that" has a mechanical answer. Confirmation codes and
  traveler names are withheld from the model exactly as they are from a cloud
  provider — being local changes who receives the request, not what may be in it.
  It therefore cannot tell you your booking reference, and says so rather than
  inventing one. Ask about a visa, health, safety, or a price and Voyalier adds
  its own card above the reply pointing at where the real answer lives; the card
  is added to the model's answer, never in place of it, because a keyword that
  guesses wrong should cost you a redundant card and not your answer.

  Conversations are saved per trip and encrypted, and they are deliberately absent
  from search, the shareable brief, and every export. A searchable transcript
  would be retrieved into the next question and the model would begin citing
  itself as something you had established. If an answer is worth keeping, one
  control copies it into the trip's notes, where it becomes yours rather than its.

- **The United Kingdom now names an entry authority, and deliberately resolves no
  route.** Canada and Japan publish per-nationality tables, so Voyalier quotes
  them and walks the steps. GOV.UK publishes a questionnaire instead, because
  whether you need an ETA, a Standard Visitor visa, or neither depends on the
  purpose and length of the visit as well as the passport.

  So a UK trip gets the Home Office named and its own checker handed over, and no
  journey. That is the design working rather than a gap: saying nothing would
  claim no authority governs a UK trip, and deriving a route from the passport
  alone would be Voyalier answering in one step a question the authority declined
  to answer in one step. Everywhere still uncurated continues to name no authority
  at all, which remains a different answer and stays one.

- **Seven things the roadmap had been calling high-confidence for a fortnight, and
  the one it turned out to be wrong about.** The selection rule was that each had
  to land on a seam that already exists, so none of them added a gateway method
  and the route manifest did not move — which is what let seven features share one
  branch instead of seven.

  Four are offline and derived from data already in the app. **Golden hour** is
  the same sunrise solve at a six-degree solar altitude, anchored on each day's
  own sunrise and sunset so a window can never contradict the times printed
  beside it; three separate days carry none, and the polar state tells them apart.
  **Languages** joins the country-facts card, which had been telling travelers the
  plug, the voltage and the emergency number without saying what language any of
  it would be in. **Airport codes** now autocomplete on the code _or_ the airport
  name, because nobody memorises "CDG". And a **flight carbon estimate** sits
  under the Blueprint's flights, computed from their airport codes.

  The carbon estimate is where the roadmap was wrong. It assumed haul bands —
  domestic, short, long — and reading the UK government's published factors showed
  those bands are defined by _territory_ relative to the UK, not by distance.
  Banding by kilometres would have been our threshold wearing their name, so this
  carries the single factor they publish for flights between non-UK destinations
  and says so. A leg whose airport codes are missing or unknown is counted rather
  than skipped, and the panel then says the total is a floor: silently dropping
  two of a trip's four legs would have produced a number that reads as the whole
  trip while being half of it.

  **Offline maps now cover every city pack** rather than four of sixteen, and
  **packs carry a third layer** of practical amenities — cash machines,
  pharmacies, toilets, viewpoints, hospitals — with its own row in the licence
  manifest. Reading Overture's actual taxonomy to build that layer killed one item
  outright: its "fountain" is decorative and its "drinking water dispenser" is a
  wholesaler of water coolers, so there is no drinking-water pin until a source
  publishes a real one. Packs already downloaded keep working; they simply have no
  amenities to show.

  **School holidays** join the holidays panel from a second source covering 36
  countries. Two things about them are deliberate. They are date _ranges_, so a
  trip is "during" one by overlapping it — a one-week July trip sits inside a
  six-week summer break, and asking for containment would report nothing to
  exactly the traveler most affected. And because that source covers fewer
  countries than the public-holiday one, the panel distinguishes "no school
  holidays during your dates" from "nobody publishes a school calendar for this
  country". Telling someone bound for Japan that Japanese schools are in session
  is not something Voyalier knows.

- **Japan is the second destination with a curated entry path.** ADR-0006 said the
  second one would be the test of whether the abstraction held. It held, and
  corrected three things that only a second authority could have shown.

  Japan publishes no electronic authorization at all — its online visa service is
  a channel for the same visa, and eligibility keys on where the applicant
  _lives_, not their nationality, so it is a link inside the journey rather than a
  door of its own. Eighteen of the seventy-four exempt entries condition the
  exemption on a passport type or a prior registration; Voyalier cannot see which
  passport someone holds, so all eighteen resolve to "check your own case" with
  the ministry's own table and no journey. Answering "exempt" there is what would
  put a traveler at a gate without a visa. And the "read on" date is now per
  destination, because re-reading one authority says nothing about the other.

  What did not change is the split. Every factual claim about a requirement is
  still a link, every authored sentence is still a translation or a caution, and
  the test that fails the build on a quoted fee or processing time now runs over
  both destinations. Two guard tests that said "canada.ca" now resolve the domain
  per destination — trivially satisfied while one existed, and the actual guard
  against a Japanese step citing a Canadian page now that two do.

  Left out on purpose: more destinations. Each is a fresh reading of a fresh
  authority, and two in one branch would halve the attention each got.

## [0.6.2] - 2026-07-29 — Honest search, readable engine

### Fixed

- **"Find in this trip" reported that your documents held no match when what had
  actually happened was that the search never ran.** Both of the panel's requests
  were caught into empty lists, so an engine that could not be reached produced
  the same sentence as a real empty result — "No matches for 'paper' in your
  documents or confirmed plans." Voyalier was making a claim about the traveler's
  own files on the strength of a request that never completed, which is the one
  thing that panel exists to be trusted about.

  The same search at workspace scope already got this right, through the shared
  action helper that normalizes and surfaces failures. The two scopes of one
  feature disagreed about whether a failure counts as a failure, and the per-trip
  one was the half that stayed quiet. It now says the engine could not be
  reached, and the "no matches" line is reachable only from a search that
  answered.

  Kept deliberately: the autofill suggestions stay best-effort. A typeahead that
  fails while the search itself succeeds is not worth interrupting the traveler
  with, so that half still degrades silently — now pinned by a test, so the
  silence is a decision rather than the old blanket catch.

  Also closed here, though nobody would have seen it yet: three screens carried
  their own copies of limits the contract already declares — the search box
  length, the import size, and the AI instruction length, one of them labelled
  "Mirror of the backend's". Those numbers are checked against the engine in both
  languages, so changing one would have updated the engine, the contract and the
  check, and quietly left three inputs enforcing the old value. They now read the
  contract's number.

### Changed

- **The engine's largest file became eleven readable ones, and the two clients
  stopped repeating what the route list already said.** Nothing here changes what
  Voyalier does; both changes are about the next person to open the code.

  The file holding almost all of the engine's behaviour was 10,099 lines, with
  ninety-five operations in one block and the tests for all of them underneath.
  Reading anything meant scrolling past six unrelated subsystems — the trip
  operations alone were split across a two-thousand-line gap. It is now eleven
  files named for what they do, and the public surface is provably identical
  before and after. What did **not** happen is the obvious version: splitting the
  engine into several objects. Both the browser and desktop apps depend on
  exactly one, and giving them six to learn instead would have made the seam
  worse to use in exchange for tidier files.

  The browser and desktop clients now read each operation's address from the
  shared route list instead of repeating it. That list already existed and was
  already checked against the real server in both directions; it just was not
  being used. Changing an address is now one edit rather than two that have to
  agree.

  Deliberately not done, and written up rather than left implied: generating
  those clients from the route list. It would delete more typing than either
  change above, and it would switch off the type checking that currently
  verifies all seventy-one operations against the contract — and on the engine
  side it would blind two of the checks that keep the browser and desktop apps
  honest with each other, because those checks work by reading the source.

- **Four pieces of the codebase now fail the build where they used to fail a
  test, or fail nothing at all.** None of this changes what Voyalier does. It
  changes what can go wrong without anyone noticing, which is what the last two
  releases kept getting caught by.

  Encrypted fields are now a type rather than a rule to remember. Which columns
  are encrypted was already declared in one place, but reading one and forgetting
  to decrypt it produced a screenful of ciphertext and was caught, eventually, by
  a test — and only for columns a fixture happened to touch. Reading one now
  produces a value the code cannot render until it has gone through the vault.
  The other direction, writing plaintext where encryption was expected, is
  honestly still only caught by that test; ADR-0007 records why, rather than
  claiming the tidier result.

  Each remote source's address moved next to the code that reads its reply. Ten
  URLs sat in a different layer from the parsers that understood them, including
  the four government advisory feeds — where a deliberate gate exists so that no
  arbitrary string can become a request, and the request was then assembled
  somewhere the gate could not see. Two copies of the AI provider authentication
  headers became one.

  Message keys built from a contract code are now checked at build time. Adding a
  new packing suggestion or search result type used to compile cleanly and show
  the traveler a raw key like `packing.laundry` in both languages.

  The offline workspace the tests run against is now held to the contract's own
  field list. It found a second field nobody had noticed was missing — the
  authority's own term for a visa step, which the panel renders and no test had
  ever seen. Eight fields are documented as deliberately absent, each with a
  reason, which is a list the codebase did not previously have.

  What was left out at the time: the engine was still one 10,099-line file, and
  adding an operation still meant writing it out in ten places. Both were taken
  up next, in the entry above — the first fully, the second only as far as it
  could go without giving up a check that is currently earning its keep.

## [0.6.1] - 2026-07-29 — Audited user-flow repairs

### Fixed

- **The visa panel was quoting Canada's immigration service for trips that had
  nothing to do with Canada.** A London → Tokyo trip with an Indian passport was
  shown "Not curated — check the official source", attributed to Immigration,
  Refugees and Citizenship Canada, with a canada.ca link labelled as the official
  source for the traveller's case. Canada is the only destination curated so far,
  and the function that quotes an entry path had no way to say "no authority",
  so Canada's stood in for every other country on earth. It now says nothing
  where it knows nothing: no authority named, no link offered, and a sentence
  telling you to check your destination's own immigration service. This is the
  clearest breach of the product's own contract found so far — Voyalier pointing
  at a government with no connection to the journey — and ADR-0006 has been
  amended in place to say that an uncurated destination yields no quote at all.

  What this does not do is add destinations. A trip to anywhere but Canada still
  gets no curated journey; it now gets an honest absence instead of a misleading
  pointer.

- **The visa section works on the desktop app.** It never had. Every command the
  desktop shell exposes takes a single argument named `input`, and one of the
  eighty-one — the one that loads your visa preparation — asked for its trip id a
  different way, so the desktop app asked and the shell refused, every time. The
  browser build was unaffected, which is why it survived a release: the parity
  guards compared command _names_ across the two shells and found nothing wrong,
  because nothing was wrong with the names.

  The guard now drives every command the way the app really calls it and checks
  which argument comes back unbound, and it reads the command list from the shared
  route manifest rather than a list kept by hand — the hand-kept list had never
  included this command. What was left out: the manifest still does not generate
  the two transports it describes, so a new method is still written out in several
  places. That is a larger change and it needs its own decision record.

- **A visa journey could never be finished.** With all sixteen documents ticked
  the panel read "You marked 7 of 8 steps complete" permanently, and nothing
  anywhere could close the gap: a journey opens with an orientation step that
  asks whether you need the route at all, which has links and nothing to tick,
  and it was being counted in the total it could never contribute to. Steps with
  nothing to tick now leave both halves of the fraction, so the journey reaches
  its own total. The tradeoff is that the total no longer matches the number of
  steps in the rail; the alternative was inventing an acknowledgement control for
  a step that asks for nothing.

- **On a phone, tapping a step in the visa rail did nothing you could see.** The
  rail sits beside the step on a wide screen and stacks above it on a narrow one,
  where the content it changed was about 100px below the fold — the page did not
  move and focus did not move, so the only feedback was a highlight on the row
  you had just touched. Selecting a step now moves focus into it, which brings it
  into view and announces it to a screen reader in the same gesture.

- **Reloading a trip section, or opening a shared link to one, landed nearly four
  screens away from it.** Deferred sections above the target mounted after the
  browser had already chosen where to stop, pushing the target down; a cold load
  of `#section-ai` stopped 3,520px short with the navigation confidently marking
  a different section as current. The jump chips were fixed for this a release
  ago and the reload path was not; both now use one mechanism. Leaving a trip
  from the visa section also left a dead `#section-visa` in the address bar, and
  that section's own chip landed its title underneath the sticky navigation.

- **Correcting a trip's destination left the visa panel answering for the old
  one.** The heading updated and the cockpit went on saying the route had no
  guide while the engine already held an eight-step journey for the new
  destination — visible only after a manual reload.

- **Errors in the visa panel were invisible and told you to look for something
  that was not there.** A one-letter passport code produced "Check the
  highlighted fields", copy written for multi-field dialogs, rendered in ordinary
  body text through a style rule that never existed, beside a field with no
  highlight. The passport picker now uses the same field component as the rest of
  the product, so its error is marked, coloured, announced, and tied to the input
  — and it names the rule it is enforcing. Pressing Save with the field empty did
  nothing at all; it now answers.

- **After a successful Retry the trip still said the engine was unreachable.**
  The header read Ready, the workspace banner was gone, and a banner underneath
  went on insisting otherwise with no Retry and no way to dismiss it. Failures
  from an unreachable engine now expire when the engine answers again. While it
  is down, the trip no longer repeats the workspace's message word for word.

- **Smaller things found in the same pass.** The trip list scrolled sideways on a
  320px screen, clipping its own cards. Four panels in Prepare ran together with
  no separator while their neighbours had one. Review suggestions opened with its
  Confirm buttons 826px below the fold, no scrollbar, and only a Close button
  visible; the dialog now shows that it continues. A rejected Create-a-trip
  submission left keyboard focus on the button that had just refused.

- **A passport you have already entered is offered to your next trip.** It was
  meant to be, and is on a real workspace, but the in-memory workspace the tests
  run against never filled the field in — so the behaviour had no test and the
  prefill silently did nothing in mock mode. It is a suggestion in the picker
  only; Voyalier still never files a passport against a trip you have not
  confirmed, because the trip may not be for you.

- **Two quick actions in a row no longer let the older one win.** Asking for
  recommendations, moving the interest sliders, and asking again could leave the
  first answer on screen if it was the slower of the two — and saving a place from
  it then stored the sliders you had already moved away from. Nothing failed and
  nothing looked stale, which is why it went unnoticed. Overlapping actions are
  now settled in the order they were started rather than the order the answers
  arrive.

## [0.6.0] - 2026-07-28 — The visa preparation release

### Added

- **Voyalier now helps you actually apply for a visa, without ever telling you
  what the rules are.** `readiness.rs` has held its entry-requirements item at a
  permanent "Not checked" since Phase 1, because `AGENTS.md` forbids claiming
  authority over visas — which left the highest-friction task in a trip entirely
  outside the product. The new Visa section takes the other half of the problem:
  not the rules, which governments publish and change, but the execution, which
  nobody publishes and everybody gets wrong. For a route it has curated, it walks
  you through the application step by step — what the authority calls each thing,
  what that means in plain language, which documents it takes, and the specific
  ways people trip. Canada's visitor visa is curated first, both paths, with your
  ticks and notes saved per trip so you can close the app mid-application and come
  back to where you were.

  The split is absolute and enforced by a test: every factual claim about a
  requirement is a link to the authority, and every sentence Voyalier writes is a
  translation or a caution. It never states a fee, a processing time, or an
  eligibility outcome. Entry paths are quoted, carrying the authority's name and
  the date the list was read; where Canada publishes conditions rather than an
  answer, you get the official link and no guess. The most valuable thing in the
  guide is a question it refuses to answer — Canada lets citizens of _some_
  visa-required countries skip the visa entirely for a far cheaper electronic
  authorization, the eligible list is short and it moves, and step one puts that
  in front of you with the list attached rather than resolving it for you.

  What was left out: every destination except Canada, travelling parties, and any
  live refresh of the curated data. That last one is not a shortcut — IRCC
  publishes no machine-readable feed and `canada.ca` refuses automated fetches, so
  curated-and-stamped is the only honest shape, and the guide says when it was
  last read. Your nationality and your notes are encrypted at rest alongside your
  confirmations. Readiness is deliberately unchanged: the entry-requirements item
  still asserts nothing and still cannot clear your trip, and it now reports your
  own tally attributed to you in the same sentence.

### Fixed

- **A workspace with an empty optional field no longer refuses to open.** The
  pass that seals legacy plaintext on startup read every sealed column as a
  string, so a NULL in a nullable one failed the whole open with a storage
  error — not the panel, the workspace. Visa preparation made it easy to reach,
  because ticking a document without writing a note leaves the note empty, but
  it was already reachable through a manual activity saved without a location.
  Nulls are now skipped, since there is nothing there to seal.

## [0.5.2] - 2026-07-21 — The audited-journey release

A browser audit walked Voyalier's primary flows end to end — first run, import
and review, planning, preparation, sharing, search, and the trip lifecycle — at
three widths in both themes, with the engine deliberately killed mid-task. It
found fifteen gaps and no blockers: nothing lost work or trapped the traveler.
What it did find was the product being less truthful and less findable than it
means to be. All fifteen are fixed here.

### Fixed

- **The trip page's jump chips now land where they point.** Clicking "AI" on a
  freshly opened trip stopped roughly 1,700 px short, inside Prepare, because a
  native anchor jump is decided once and the deferred sections above the target
  then mounted and pushed it down. Chips now mount every section, wait for
  layout to settle, and then scroll, so the first click is exact. Deferral still
  covers the idle case — it is abandoned only once the traveler has said where
  they want to go, which means those sections load earlier than before when a
  chip is used. The chips also gained a current-section state.
- **A planning action that fails while the engine is unreachable now says so
  where it happened.** Adding a packing item against a dead engine left the
  topbar reading "Ready", put a bare red line below every planning card owned by
  nothing, and offered no retry. Saved places, the packing checklist, and
  activities now report through the same transport-health path as the rest of
  the app, and each shows its own failure with a Retry beside the control that
  caused it. Typed input survived a failure before and still does. The two
  assist panels report their own failures the old way and were left alone;
  folding them in would have widened this past what the audit reproduced.
- **Retrieved evidence is stamped on your clock, not UTC's.** A snapshot fetched
  at 6:34 PM in Chicago read "Retrieved … 11:34 PM", and an evening import was
  dated tomorrow. Eight places had each re-derived the same date handling from
  an RFC3339 instant; they now share one formatter that converts to the viewer's
  timezone. Flight times are a different kind of value — a departure is local to
  its airport — and are untouched.
- **Imported documents appear the moment they are imported.** The panel that
  exists so you can check what Voyalier read kept its old contents until a
  reload, even as the suggestion count and readiness updated around it.
- **Closing a dialog no longer strands the keyboard.** Focus could land on the
  page body — restarting a keyboard user from the top — when the button that
  opened the dialog was removed by the same action that closed it.
- **Long dialogs keep their buttons on screen.** On a phone, the import sheet
  ran past the bottom of the viewport with Cancel and Import both below the
  fold; the sheet now scrolls inside itself with the actions pinned.
- **Settings no longer looks like the light-theme button.** Its icon was a
  circle with eight radial ticks sitting beside a sun that was a circle with
  eight radial rays; on a phone, where the labels drop away, the row ended in
  two suns.
- **New trips are named with the same arrow the app draws.** The default title
  was stored as "A -> B" and displayed one line above the route "A → B". Trips
  created before this update keep the titles they were given: renaming saved
  data to fix our own punctuation is the worse trade.
- **A field stops arguing once you have answered it.** After a failed submit,
  "Enter where the trip starts." stayed under a field already holding a city
  name until the next submit. Fields that have not been submitted yet still stay
  quiet while you type.
- **One banner when the engine is unreachable, not two.** The workspace and the
  trip view were each rendering the same message and their own Retry.
- **A search result names the flight or stay it found**, instead of heading
  every one of them "Confirmed fact". The excerpt below it still shows the raw
  matched text — that is the evidence for why the result matched, and it has to
  keep matching a date typed into the search box.
- **A schedule conflict links to the plans it names**, rather than naming two
  flights and leaving you to find them.
- **Archiving a trip offers Undo**, instead of only a reveal toggle at the foot
  of the list discovered after the card has already vanished.
- **The made-up-data note sits with the sample trip it describes**, not under
  the sentence about creating your own.

### Notes

The audit covered the browser surface. The packaged desktop shell, the vault
passphrase journey, city-pack downloads, and the AI provider flows were not
exercised and are unchanged here.

## [0.5.1] - 2026-07-21 — The calm-flow reliability release

### Fixed

- **Evidence review now opens at its title instead of halfway through the first
  suggestion.** Keyboard and screen-reader users get the review context before
  its actions, confirmation still advances to the next card, and closing after
  the final decision returns focus to the Blueprint instead of the document
  body. The extraction and confirmation rules are unchanged.
- **The engine status now agrees with the work area.** A transport failure from
  a trip load or mutation changes the topbar to **Offline** as well as showing
  the recovery message; a successful retry restores **Ready**. Storage,
  validation, and domain errors remain local rather than being mislabeled as a
  network outage.
- **The complete topbar now fits at 320 px.** Brand and controls use a deliberate
  two-row mobile layout with visible search, health, theme, and Settings actions
  plus 44 px targets. Desktop spacing and the Quiet Journey visual system stay
  intact.
- **Every visible theme control now reflects the same preference.** Switching
  Light, System, or Dark in the topbar immediately updates the duplicate control
  in Settings, the root palette, and local persistence; no account or remote
  synchronization was added.
- **Blank planning actions now explain what they need.** Custom packing **Add**
  stays disabled until text is present, while a blank manual plan shows an
  inline required-name message and moves focus to the field. The traveler still
  submits every checklist item and plan explicitly.
- **Reloading an active trip returns to that trip and its selected section.**
  Voyalier stores only the active trip id in browser session storage; it does not
  copy trip content, evidence, or search text there. Returning to **All trips**
  clears both the session hint and a stale section fragment.

### Changed

- **The update guide now points to the actual Settings panel.** Platform and
  installer guidance remains Apple Silicon macOS, Windows x64, or a local
  browser build from source; desktop installers are still not OS-signed or
  notarized.
- **The app shell now uses the same Voyalier mark as the documentation.** The
  browser no longer falls back to a missing favicon or logs a failed asset
  request during normal startup.

## [0.5.0] - 2026-07-20 — The traveler-owned planning release

### Added

- **Saved interests and places now survive the planning session.** Persona
  weights persist per trip after a dedicated save action, and a recommendation
  can be explicitly shortlisted with its name, coordinates, reasons, source,
  license, and private notes. A saved place survives removal of its source pack
  and says when that pack is no longer available; **Add to plan** only prefills
  the traveler-authored form, which must still be reviewed and submitted.
- **Packing suggestions now lead to an actual checklist.** Evidence-backed
  suggestions remain suggestions until the traveler clicks **Add**, while custom
  items, checked state, and removal persist locally. Voyalier still does not
  auto-pack, infer personal needs, or claim the list is complete.
- **Activities, rail legs, and transfers fill the space between
  confirmations.** Traveler-authored items can be added, edited, timed, and
  removed without inheriting evidence authority. Literal time overlaps are
  notices—not readiness failures—and title, location, and local time can appear
  in Today, the printable brief, and calendar export while private notes are
  excluded by construction.
- **Workspace search now reaches across every trip.** One local query searches
  imported documents, confirmed facts, trip notes, saved places, and manual plan
  items with bounded snippets and explicit trip/source provenance. Pending
  extraction candidates stay out until reviewed, and no index or query leaves
  the device.
- **Settings now carries a source and license register.** The product-visible
  table and its shared Rust/TypeScript golden name the major official,
  open-data, map, weather, and reference inputs plus the authority each one does
  and does not have. It is a shipped register, not a promise that every source
  is live or authoritative for a particular trip.
- **Nashville, Kyoto, Tokyo, and Paris now have verified offline-map targets.**
  The publisher builds every catalog-enabled PMTiles slice in one run, retries
  lower zooms to stay below the hard size bound, verifies each archive, and
  writes one complete manifest. Other catalog cities continue to use the
  explicit online fallback until their own bounded extract is enabled.
- **Spanish is available as an immediate local preference.** Settings offers
  System, English, and Español; changing it rerenders the visible application
  without a reload and persists only in local storage. Every English message
  has a reviewed Spanish counterpart with matching placeholders and plural
  forms, so secondary workflows no longer fall back to English.
- **A real-browser acceptance layer now runs in the release gate.** Playwright
  starts disposable SQLite and the real Axum + Vite stack, then drives trip
  creation, Today, checklist state, manual planning, workspace search,
  data-source settings, the Spanish switch, and reload persistence in Chromium.
  It complements—not replaces—the Rust, live Axum serialization,
  transport-parity, component, accessibility, and packaged-app checks.

- **Back up your whole workspace, and restore it anywhere.** Voyalier keeps
  everything on your device, which meant a lost computer was lost trips — and the
  optional vault passphrase has no recovery. Settings now saves your entire
  workspace to a single encrypted `.vbk` file: trips, imported confirmations,
  confirmed facts, notes, and offline packs. You choose a backup passphrase, and
  the **whole** file is sealed under it, so even trip names and dates are
  unreadable without it. The file also carries your workspace's encryption key,
  re-wrapped under that passphrase — which is what lets a backup open on a
  **different** computer, where the original keychain key never existed.
  Restoring replaces your workspace rather than merging into it, and happens in
  two deliberate steps: picking the file and passphrase only **stages** it,
  changing nothing, and the swap runs at the next launch before the database
  opens. Your current data is snapshotted first, so a restore you did not mean is
  recoverable. A backup from a newer Voyalier is refused rather than half-read;
  an older one migrates forward. Downloaded maps and AI provider keys are
  deliberately left out — maps re-download, and third-party keys stay in your
  keychain instead of travelling in a file — and the app says so rather than
  letting you find out later.
- **A tipping guide on the destination-facts card.** The card now shows a short,
  conservative note on tipping customs for the destination country — worked out
  on your device from a bundled table. It's framed as a rough guide (customs
  vary and change), never a rule, and never affects your trip's readiness.
- **"About this place" — a short summary of your destination.** One click
  fetches a plain-language summary of where you're going from Wikipedia, shown
  with attribution and a link to read more. The words stay Wikipedia's (licensed
  CC BY-SA), never rewritten as Voyalier's own or treated as a safety claim.
- **World Heritage sites near your destination.** The destination-facts card now
  lists the UNESCO World Heritage sites closest to where you're going — with the
  year each was inscribed and how far away it is — worked out on your device from
  a bundled list of the world's ~940 sites (from Wikidata) and the coordinates
  the card already resolved. No network; a nearby-notable list, not a claim of
  completeness.
- **Public holidays during your trip.** One click fetches the destination
  country's public holidays (from Nager.Date) and shows the ones that fall
  within your travel dates — with their local-language names — so a closed-bank,
  closed-shops day doesn't catch you out. It's informational and never changes
  your trip's readiness; a date or destination change refetches.
- **The time difference from home, on the destination-facts card.** The card now
  says how far your destination runs ahead of (or behind) where you're leaving
  from — "Kyoto is 14h ahead of Chicago" — worked out on your device from both
  places' time zones on your travel dates. Fetching the card now also asks the
  map for your origin's time zone; if the origin can't be placed the line is
  simply left off. Sub-hour zones (India, Nepal) keep their exact minutes, and
  a matching zone reads "same time" rather than nothing.
- **Destination autocomplete that knows the world's cities, offline.** Typing a
  place used to suggest only the 16 city packs and your own past trips, so most
  destinations got nothing. Now the origin and destination fields match against
  a bundled gazetteer of ~32,000 cities (GeoNames), ranked by population and
  matched with or without accents — "zur" and "zue" both find Zürich — entirely
  on your device, no per-keystroke network lookup. Your own places and the city
  packs still come first, and free text you type always works.
- **Nearest airports, offline.** The destination-facts card now lists the
  airports closest to where you're going — code, name, and how far — worked out
  on your device from a bundled list of the world's scheduled-service airports
  and the coordinates the card already resolved. No network, and it shows the
  distance as a plain fact rather than telling you which airport is "best".
- **A destination-facts card: the sky, the money, and the practical stuff.** One
  click now answers the small questions every trip raises. **Sky** shows
  sunrise, sunset and the moon phase for each day, computed on your device from
  the destination's coordinates — no network, no source to go stale, and polar
  day or night stated plainly rather than as a sunrise that never comes.
  **Money** shows the destination's currency against the US dollar, euro and
  pound using the European Central Bank's daily reference rates, clearly
  labelled indicative — not the rate your card or an ATM will give — and honest
  when the ECB doesn't publish a currency. **Practical** carries the plug types,
  voltage, which side they drive on, the calling code, and the emergency number,
  for the same countries the advice panel covers. Adds `fetchDestinationFacts`
  across every transport; the country facts and sun/moon days are worked out
  fresh on each read, so a corrected fact is never frozen into an old snapshot.
- **Typical weather, air quality, alerts, and a packing list — on the click you
  already make.** The outlook used to stop at a 16-day forecast, which is silent
  about the trips people actually plan months ahead. Fetching now also asks what
  these calendar dates have **usually** been like at your destination (ten years
  of observed history, in one request), the **UV and air quality** per day, and —
  for US destinations — active **National Weather Service alerts**, shown
  verbatim and linked. From that same evidence Voyalier works out **what to
  pack**, and shows the reading behind each suggestion, so "rain shell" comes
  with "44% of typical days see rain" rather than asking you to take its word.
  Normals always carry the sample they rest on, and say "typically", never
  "will be" — history is not a forecast. Each layer is fetched independently, so
  a slow archive never costs you the forecast, and outside the US no alert
  block appears at all rather than an empty one that would read as all-clear.
- **Four governments' travel advice, side by side.** Official advice used to mean
  the UK FCDO alone, because when that shipped the US had no machine-readable
  feed. It does now, so the panel adds the **US State Department**, **Global
  Affairs Canada**, and the **Auswärtiges Amt**, plus **US CDC health notices** —
  every one an official, keyless source, still fetched only on your click and
  still stored as a dated local copy. Each government gets its own card in its
  own words: levels are never merged or compared across them (a US "Level 2" and
  a Canadian advisory-state 2 are different claims), and the German source is
  shown in German rather than machine-translated into a safety judgement it never
  made. A source that cannot be reached says so and keeps its last saved copy
  instead of vanishing. Replaces `fetchTravelAdvice` with `fetchAdvisories`
  across every transport; existing saved UK advice migrates in place.
- **Imported documents manager.** Voyalier reads confirmation emails full of
  codes and traveler names, and until now kept them with no way to see or remove
  them — the loudest gap in a privacy-first product. Each trip now lists what was
  imported, with the counts that make deleting it an informed choice, shows the
  original text on request (unsealed from the vault only when asked, never in a
  listing), and removes it behind a two-step confirm. Deleting takes its
  still-pending suggestions with it; facts already confirmed from it stay — the
  traveler approved those — and are marked as having lost their source rather
  than passing as hand-typed. Adds `listDocuments`/`getDocument`/`deleteDocument`
  across every transport.
- **A real Settings screen.** Updates and Encryption used to sit at the bottom of
  the home list while the three AI panels re-mounted inside every trip, so with
  zero trips there was no way to configure AI at all. A topbar gear now opens
  Settings from anywhere; the trip page keeps only trip-scoped surfaces and gains
  a sticky Plan/Prepare/Discover/AI jump nav.

- A **Download and install** page in the documentation, now that a release
  carries real artifacts. It presents the three ways to run Voyalier as equals —
  Apple Silicon macOS, Windows x64, or in a browser from source on any OS
  (including Intel Macs and Linux) — walks through the Gatekeeper and SmartScreen
  first-launch warnings and explains what they do and don't mean, and documents
  the optional SHA-256 check. Links point at `releases/latest` rather than any
  version, so the docs cannot go stale behind a release.
- **Offline maps for Nashville and Kyoto.** Pack CI extracts and verifies a
  bounded Protomaps PMTiles archive for each enabled city, the local core
  verifies its size and SHA-256 before storing it, and MapLibre reads only
  bounded byte ranges through the existing app gateway. Download size varies by
  city and is stated that way before the click. The online OpenFreeMap style
  remains the explicit fallback when a compatible local archive is not present;
  other city packs do not pretend to be available offline yet.

- **Trip notes**, **calendar export**, and a **sample trip**. Notes are free text
  for the half-made plans a trip has nowhere else to keep — sealed at rest, and
  excluded from shared briefs and AI requests by construction. **Export calendar**
  writes an `.ics` locally from the redacted brief, so confirmation codes and
  traveler names cannot ride along into a cloud calendar; times stay floating
  because a confirmation gives a wall clock and no timezone, and Voyalier does
  not invent one. On an empty workspace, **Explore a sample trip** builds a demo
  through the ordinary import flow and drops you into a review — the thing
  Voyalier is actually for.

### Changed

- Opening a trip now fetches **3 times instead of 8**. Below-fold sections mount
  only when they are nearly on screen, so advice, weather, notes, documents,
  search, packs, recommendations, the map, and AI no longer all fetch for a
  traveler who never scrolls to them. The section nav still reaches them: chips
  target wrappers that exist whether or not the section has mounted, and landing
  there is what brings it in. A test asserts the budget so it cannot quietly
  regress.
- The README and website lead with the download rather than `git clone`: the
  homepage's primary action is now **Download for Mac or Windows**, the
  `source-only beta` badge is replaced by `public beta` plus a separate
  `installers unsigned` badge (deletable on its own when certificates land), and
  the release badge reads its version from GitHub instead of being hardcoded.
  **Getting started** is reframed as the from-source path it always was.

- **The mock gateway and the Rust core now answer to the same golden files.** The
  in-memory gateway that every component test runs against re-implemented ~990
  lines of the core's rules in TypeScript, with nothing comparing the two — the
  one test that would have has never run in CI. Facts both languages must agree
  on (validation limits, place folding, the default AI instructions, the
  official-source links) now live in `packages/contracts/parity/`, held by a test
  on each side. See [ADR-0004](docs/architecture/ADR-0004-mock-parity.md).
- **The core reports readiness findings; the interface writes the sentence.**
  Readiness prose — including its pluralization — was built in Rust and rendered
  raw, so one panel had two copy pipelines: the status label was translatable and
  the sentence beside it was not. Rendered copy is unchanged. See the
  [ADR-0003 amendment](docs/architecture/ADR-0003-phase2-contract.md).
- Schema migrations are an ordered list keyed on `PRAGMA user_version`, which was
  previously written on every open and never read. Ordering is now structural
  rather than held by a comment, each step runs at most once, and a legacy-shaped
  database is migrated in a test — the fixture-backed migration coverage
  `ARCHITECTURE.md` asks for before the signed beta.
- The records whose columns the vault seals read and write through one module, so
  "this column is sealed" is declared once and checked by a test that walks the
  declaration.
- Invalidation has a home. A view names the scope it reads; a mutation names the
  scopes it changed, and only views reading those re-fetch. Deleting a document
  no longer refetches a whole trip, and the refresh counter that used to be
  drilled from the app root down through two components is gone.

### Fixed

- **A failed archive, unarchive, calendar export, unconfirm, or sample-trip build
  now says so.** Those actions — on both the trip page and the trip list — only
  announced their failure to screen readers, so a sighted user watched the button
  stop spinning and saw nothing at all.
- Browsing city packs no longer swallows a failure: the catalog fetch had no
  error handling, so a failed load became an unhandled rejection.
- Place names with accented capitals (`REYKJAVÍK`) matched no city pack — the
  core folded them to a word separator instead of their base letters. `Tromsø`
  and `Weißenburg` had the mirror-image bug in the mock.
- Release checksums are now generated by a cross-platform Node script; Git Bash
  on the Windows runner does not include the previously assumed `shasum` binary.

## [0.4.3] - 2026-07-13 — First self-updating build

### Changed

- First release to ship the signed desktop bundles and the updater's
  `latest.json` manifest, so the in-app **Updates** check resolves instead of
  failing. The updater's own minisign signing is independent of OS code-signing
  (Apple notarization / Windows Authenticode), which remains blocked on paid
  certificates — first-open still shows an "unidentified developer" warning.

  (0.4.2 was tagged but never released — its bump omitted the `Cargo.lock`
  refresh, so the protected tag was abandoned rather than force-moved.)

## [0.4.1] - 2026-07-12 — Flow-gap fixes

### Fixed

- More user-flow dead-ends: the **Import** and **Add flight or stay** primary
  buttons were enabled on an empty form (they looked clickable but only errored),
  and are now disabled until there's something to submit. The **vault unlock**
  screen was a dead end on a forgotten passphrase — it now offers a "Forgot your
  passphrase?" explainer with the honest no-recovery reality and the
  restore-from-backup path.

## [0.4.0] - 2026-07-12 — Public beta polish

Assistive setup, a real type identity, and a correctness/robustness sweep on top
of the 0.3.0 beta base. OS code-signing (Apple notarization / Windows
Authenticode) remains blocked on paid certificates; the free in-app updater's own
minisign signing is separate.

### Added

- **Destination-aware, assistive trip setup.** Origin/destination fields are an
  accessible WAI-ARIA combobox with offline suggestions drawn from your existing
  trips and the pack catalog; setup surfaces "Recommended for this trip" packs and
  offline field suggestions for address/property fields. Nothing is geocoded per
  keystroke and nothing leaves the device.
- **Guided on-device AI setup.** When no runtime is detected, a step-by-step
  install → start → get-a-model wizard; once Ollama is running, models can be
  pulled in-app (`pullLocalModel`). Cloud keys gain **Validate & save**
  (`validateProviderKey`) and a "How to get a key" helper.
- **On-device lodging-date drafts.** "Fill gaps with on-device AI" proposes
  missing lodging dates from your own imported text (`previewAssistDraft` /
  `runAssistDraft`, `assisted` extraction method); every suggestion is a draft you
  review before anything is saved.
- **Editable AI instructions.** A settings panel to view and override the system
  instructions used for assist and for the date draft, with per-instruction reset
  (`getAiPrompts` / `setAiPrompt`). The date draft stays schema-locked to dates
  regardless of the instruction, and replies stay marked non-authoritative.
- **Relaxed, typeahead in-trip search.** As-you-type local search where any word
  matches (partial words too), matching terms are offered as autofill
  suggestions, and each result can be copied to reuse (`suggestSearchTerms`).
- **Edit and unarchive trips.** An Edit dialog (`updateTrip`) that keeps imported
  documents/facts/plans, an Unarchive action, and an archive show/hide toggle.
- **Import from a file.** The import dialog accepts a local `.eml`/`.html`/`.txt`
  file via a picker or drag-and-drop, read on-device (no upload) with the format
  inferred from the extension — a saved confirmation email no longer has to be
  hand-pasted.
- **A real type identity.** The interface's named typefaces (Zen Kaku Gothic New,
  Shippori Mincho) are now actually loaded — self-hosted Latin/Latin-Ext WOFF2
  subsets (~94 KB, SIL OFL), with **no runtime web-font request**. The
  documentation site self-hosts the same files, removing its only third-party
  request.
- **Branded macOS DMG installer window** (background + icon layout).
- **Confirm-guards on destructive actions.** Dismissing a candidate and removing
  a manual fact, a downloaded pack, or a stored provider key now take a two-step
  confirm (arm → confirm); reversible actions stay one click.

### Changed

- **Copy pass for reading ease and one voice.** Architecture words retired from
  the UI ("local core" → engine/ready wording), jargon removed ("grounded",
  "forecast horizon", "milestone"), run-on scope lines split, "Unconfirm" →
  "Back to review", "Add a fact" → "Add flight or stay".
- **Design-token foundation.** Quantized ad-hoc font-weights onto the three
  shipped weights; added type-scale, z-index, on-accent, and motion tokens.
- **Subtle, token-driven motion + paper texture**, all under the existing
  reduced-motion kill-switch; a shared `SectionTitle` gives every section the
  same icon + display-serif heading.
- New additive error codes `assist/unreachable` and `weather/fetch_failed` for
  clearer failure messages.

### Fixed

- **Data loss:** returning a _manual_ fact from the Blueprint used to delete it
  silently; it is now an explicit, confirmed "Remove".
- Trip search could repopulate results and announce a stale count after the box
  was cleared (in-flight requests are now invalidated on every keystroke).
- The delete-trip confirmation compared against a hardcoded English word; it now
  tracks the localized field.
- The map showed a silent empty frame on missing WebGL / library-load failure;
  it now explains why (and its marker follows the theme). The Today panel shows a
  retryable line instead of vanishing on error.
- WCAG AA contrast fix for small "silver-on-paper" meta text; dark-mode toast
  shadow and `theme-color` no longer use a frozen light-theme value.
- Raw parser warning codes and internal document ids are no longer shown to
  users; clipboard copy no longer reports success when no clipboard exists; the
  AI-instruction editor caps length client-side; both date fields carry the
  date-range error; the loopback dev server returns `403` (not `500`) for a
  blocked host/origin.

## [0.3.0] - 2026-07-11 — Phase 3 public beta base

Phase 3 (public beta) work. OS code-signing (Apple notarization / Windows
Authenticode) remains blocked on paid certificates; the in-app updater's own
signing is separate and free, and ships in this release.

### Added

- **In-app updater.** `tauri-plugin-updater` driven entirely through Rust
  command wrappers — the webview is never granted the updater capability, so
  there is no path for a compromised page to redirect an update. Updates are
  minisign-verified on-device, releases carry per-platform checksums and SLSA
  build provenance, and the pipeline fails closed if the signing key was never
  configured. A one-time, reversible "check automatically?" consent; a topbar
  pill and an Updates panel that both work before the vault is unlocked; a
  per-platform install flow (macOS/Linux stage the swap and prompt a restart;
  Windows confirms before download, then closes/updates/reopens); a pre-update
  database backup with an in-app "clear backups" affordance; and a "just
  updated" toast. v0.3.0 is the install-once base — the self-update loop
  proves itself starting on v0.3.1.
- **Complete UI localization.** Every panel, dialog, shell, and label now
  renders through a type-safe message catalog (`t()`), with locale-aware
  pluralization (`Intl.PluralRules`) and date/number formatting. English is
  the byte-identical source of truth; added locales are data-only.
- **Email confirmation import.** The import dialog accepts a raw confirmation
  email (`.eml` or pasted) alongside plain text and HTML. The Rust extractor
  prefers the HTML MIME part so the existing structured-data parser still
  fires, decodes quoted-printable and base64 transfer encodings, and is
  depth-capped against a crafted deeply-nested-multipart denial-of-service.
- **Persona-weighted recommendations.** `getRecommendations` ranks a trip's
  downloaded-pack places by per-trip persona weights (food, culture, nature,
  nightlife, shopping) with a deterministic keyword-to-dimension rule — per-pick
  source, license, score, and reasons, plus a cross-dimension wildcard.
- **Offline Today view.** A deterministic "now / next" summary (trip phase with
  day counts, today's departures/arrivals/check-ins, and the next anchor) from
  confirmed facts against the current date. No network, no model.
- **Encrypted vault.** Confirmation codes and traveler names are sealed at rest
  with an XChaCha20-Poly1305 data key. By default the key lives in the OS
  keychain (transparent unlock); an **optional passphrase** wraps the key with
  Argon2id and removes it from the keychain, so the app opens locked behind a
  full-screen unlock gate and data is protected even on an unlocked machine. The
  passphrase is only ever used locally to derive a key — never stored, returned,
  or logged — and encryption degrades to plaintext where no keychain exists so
  the app still runs everywhere.
- **Map view.** A consent-gated MapLibre GL map plotting the destination and
  downloaded-pack recommendations, using the keyless OpenFreeMap basemap; per-pack
  PMTiles extracts are the planned offline path.
- **Grounded-intelligence polish.** The AI request preview now cites what it is
  grounded in and shows a rough token estimate; a link-only "Health notices"
  readiness item (CDC/WHO) joins entry requirements.

### Changed

- Release pipeline hardened for signed updates: every action in the release and
  pack-publish workflows is pinned to a commit SHA, the signing key is scoped
  to a single step and only reachable from a protected environment on a real
  tag (never a manual dry run), build provenance is attested, and city-pack
  releases are enforced pre-release so
  they can never shadow `releases/latest` and break the updater.
- New `vault/locked` and `vault/passphrase_incorrect` error codes; the gateway
  gained additive `getVaultStatus`/`setVaultPassphrase`/`unlockVault`/
  `removeVaultPassphrase`, `getRecommendations`, and `getToday` methods (plus a
  `VaultStatus` type) — all backward-compatible.
- Performance: the consent-gated map lazy-loads MapLibre GL on first use, so the
  initial JavaScript payload drops from ~357 KB to ~84 KB gzipped; the ~1 MB map
  library is a separate chunk fetched only when a map is opened.
- Accessibility: an automated axe-core gate runs on every test suite (home, trip
  detail, a dialog, the vault unlock screen). Its first pass fixed a heading-level
  skip on trip cards (`h3` → `h2`) and a duplicate `banner` landmark caused by
  dialog headers.

## [0.2.0] - 2026-07-11 — Grounded intelligence (Phase 2)

Every capability ships end to end (Rust core → SQLite app → Axum API → Tauri IPC → TS contract → mock → web UI), additive and backward-compatible, with keys and high-stakes data handled per the privacy contract.

### Added

- **Sourced readiness.** A link-only `entry_requirements` item (curated official links; never asserts or clears rules), consent-gated FCDO travel-advice snapshots from the GOV.UK Content API, and a consent-gated Open-Meteo weather outlook — each stored dated, source-linked, freshness-labeled, and invalidated when the trip's place/window changes. US State advisories are link-only (no machine-readable feed exists).
- **Trip search.** Deterministic `searchTrip` over imported documents and confirmed facts, with provenance and transparent scoring.
- **Offline city packs.** A validated catalog (Nashville plus the four Hawaii islands as separate packs, plus ~11 more), each keeping Overture places and a separate Wikivoyage prose layer under their own licenses; per-trip download with consent; and a CI workflow that builds and publishes pack contents to the `packs-v1` release.
- **BYOK AI assist.** On-device detection (Ollama), OS-keychain key storage, a deterministic redacted request preview, on-device inference (Ollama) and cloud inference (OpenAI/Anthropic), and a per-trip activity log. Keys live only in the OS keychain and only ever appear in an outgoing auth header — never in a payload, log, database, or error. Confirmation codes and traveler names are excluded from every request by construction; a fixed system prompt forbids inventing high-stakes facts; each reply carries a non-authoritative disclaimer.

### Changed

- `TripDetail` gained additive `itineraryConflicts`, `readiness`, `travelAdvice`, and `weather` fields; new `assist/failed` and `pack/download_failed` error codes; provider errors now surface the provider's real cause.

## [0.1.0] — Foundation and first vertical slice (Phase 1)

### Added

- Initial repository, product, architecture, security, web, API, desktop, documentation, and delivery foundations.
- The Phase 1 local core: SQLite-backed app services, deterministic confirmation parsers, contract schema drift tests, HTTP endpoints, and direct Tauri IPC command tests; trip CRUD, deterministic Blueprint, import/review, conflict validation, a readiness rollup, and a redaction-first shareable brief.

### Changed

- Rebuilt the brand identity around the folded-route mark (one strip, one fold, one vermilion waypoint), replacing the Wayline V: new mark/lockup/app-icon assets, washi–sumi–indigo–vermilion design tokens, Zen Kaku Gothic New and Shippori Mincho type, a redesigned animated landing page, and a matching README and docs theme.
- Reworked desktop transport to direct Tauri IPC with no fixed loopback listener in the desktop crate.
