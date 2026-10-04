# (R)estate

**Which housing rules apply at this address today, and what is about to change?**
(R)estate reads real state and city housing law, turns it into rules, and answers that question for each of the 500 sample addresses in the RealPage Rental Housing Law Navigator challenge, or for any address you type in California, New Jersey or Massachusetts. Every answer comes with its source. When an answer depends on a fact the record doesn't have, the tool says so and asks for it.

*Not legal advice.*

## Run it

```bash
npm ci                  # rerun after pulling: the UI now uses the motion package
cp .env.example .env    # optional; only needed to extract new laws
npm run dev             # http://localhost:5173
```

The app starts without spending anything. Rules are rebuilt from the cached model responses in `runs/extraction-cache/`.

| Command | What it does |
|---|---|
| `npm run dev` | App and API on port 5173 |
| `npm test` | 35 tests: evaluator logic, extraction checks, and the T1–T5 change tests on the real corpus |
| `npm run export` | Writes `submission/rules.json`, `lookups.json`, `changes.json` and `validation.json` |
| `npm run extract` | Paid. Sends any uncached document to Claude Haiku 4.5, within `ANTHROPIC_BUDGET_USD` (default $2) |
| `npm run extract -- --headlines` | Paid, a few cents. Writes plain-language headlines for rules that don't have one yet |

## How it works

1. **Extract.** Claude Haiku 4.5 reads each of the 61 documents that have text (54 from the starter corpus plus 7 public ordinance, bill and court texts the corpus only linked to). It returns rule records as structured output. Long documents are split into overlapping parts.
2. **Check before trusting.** Code accepts a rule only after these checks:
   - Its quote must appear word for word in the source.
   - Its coverage has to use a small, fixed set of building facts.
   - Its start date has to be shown in the source. Dates that follow from a legal rule are computed by code rather than by the model: New Jersey's "first day of the Nth month after enactment", and California's January 1 start for non-urgency statutes.
   - Duplicate copies of the same law found in several documents are merged.
3. **Resolve the address.** Census geocoder results are matched against official city boundaries. The mailing city is never used as the legal city. 492 of 500 addresses resolve to a city; the other 8 have no house number or ambiguous matches and stay unresolved.
4. **Fill coverage across documents.** When one city page gives a rate and another says which units it covers, a second pass reads all of that city's sources together and fills in the coverage. Its quote is checked word for word, like every other quote.
5. **Evaluate.** A deterministic evaluator uses three-valued logic: applies / doesn't apply / unknown. A missing fact never counts as zero or "no".
   - When the exact unit count is missing, the assessor's own use code still bounds it. For example, NJ class 4C means five or more units, and "APT 7-30 UNITS" means 7 to 30.
   - A certificate-of-occupancy cutoff is tested against the year built. A building built in the cutoff year stays unknown.
   - A state rule that says it yields to a stricter local ordinance is marked superseded where that ordinance applies. A state law that may preempt local bans is flagged for review.
6. **Say it plainly.** Each rule gets a one-sentence headline addressed to the renter, such as "Your landlord must give you 30 days' written notice before raising your rent." A third Haiku pass writes them. Code accepts one only if it speaks to "you" and every number in it appears in the rule's own text. We checked all 57 against the rule text and corrected or wrote 15 by hand (`src/headline-review.ts`); for example, the model wrote "job offer" where New Jersey's law says a conditional offer of housing. The official title stays one click away.
7. **Any address.** Type an address that isn't in the sample and the Census geocoder finds it. The same city boundaries decide its legal city: inside one of the loaded cities, city and state rules are checked; anywhere else in the three states, only state law. With no assessor record, every building fact starts unknown, and step 8 asks for the ones that matter. Typing a sample building's address opens its assessor record instead.
8. **Ask for the missing fact.** For every unresolved answer, the app finds the one fact that would settle it and shows what each plausible value would change, for example "Built 1979: 3 rules apply; Built 1981: none". These what-if cases can be saved as regression tests.

## Results (team-run checks, not an official score)

From `submission/validation.json`:
- 57 rules from 50 documents, all with quotes that appear word for word in their sources.
- 55 are exported in `rules.json`, and all 55 pass the organizer schema. The other 2 are Los Angeles measures whose own text ends before 2026-10-01: the 2020–2024 rent freeze, and the 3% allowance for July 2025 to June 2026.
- 492 of 500 addresses resolve to a legal city.
- Change tests:

| Test | Result |
|---|---|
| T1 | 250 California addresses: not yet effective on 2025-12-31, applies on 2026-01-02 |
| T2 | All 90 Hoboken and Jersey City addresses, none in Newark |
| T3 | 140 New Jersey addresses; 90 conflict flags, all in Jersey City and Hoboken |
| T4 | 110 Massachusetts addresses if the bills were enacted; the bills stay "pending" in lookups |
| T5 | Empty: the ballot question failed, so no rent cap is reported |

## Known limits

- The extraction has not been reviewed by a lawyer, and some agency pages yield rules whose coverage reads "needs review".
- 8 addresses can't be placed in a city (6 have no house number), so city rules show as unknown for them.
- Rent-control coverage for San Francisco and Los Angeles depends on certificate-of-occupancy dates, which the record approximates by year built.
- The corpus has no Los Angeles RSO allowance for July 2026 onward, so LA rent-stabilized units show no current percentage cap.
- Typed addresses need an internet connection to reach the Census geocoder. They stay in memory only and are never part of the exports. Cities without loaded ordinances (Oakland, for example) get state law only, and the page says so.
- `PROJECT_GUIDE.md` holds the team's working notes and decisions.
