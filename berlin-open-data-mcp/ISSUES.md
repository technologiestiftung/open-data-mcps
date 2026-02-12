# Known Issues

This document tracks known issues, limitations, and data quality problems encountered with the Berlin Open Data Portal.

---

## Data Quality Issues

### Issue #1: Stale Resource URLs in Portal Metadata

**Status:** Open
**Severity:** Medium
**Affected datasets:** At least 1 confirmed (Brandenburger Weihnachtsmärkte)
**Date discovered:** 2025-10-27

**Description:**

The Berlin Open Data Portal's CKAN API returns outdated URLs for some dataset resources. The metadata points to URLs that return HTTP 404 errors, while the actual working URLs use a different path structure.

**Example:**

Dataset: `simple_search_wwwberlindesenwirtschaftse_a1231c093a437a2b36e43239076cac66_gerweihnachtsmaerkte` (Brandenburger Weihnachtsmärkte)

**Portal metadata URL (broken):**
```
http://www.berlin.de/sen/wirtschaft/service/maerkte-feste/weihnachtsmaerkte/brandenburger-weihnachtsmaerkte/index.php/index/all.csv?q=
```
Returns: HTTP 404 Not Found

**Actual working URL:**
```
https://www.berlin.de/sen/web/service/maerkte-feste/weihnachtsmaerkte/index.php/index/all.csv?q=
```
Returns: 75 rows of valid CSV data

**Differences:**
1. Protocol: `http` → `https`
2. Path: `/sen/wirtschaft/service/` → `/sen/web/service/`
3. Removed path segment: `/brandenburger-weihnachtsmaerkte/` no longer present

**Impact:**

- MCP server correctly fetches metadata from CKAN API but encounters 404 errors when attempting to download resources
- Users must manually find working URLs through the web interface
- Affects user experience and reliability of automated data fetching

**Root cause:**

Berlin's website underwent URL restructuring, but the CKAN metadata was not updated to reflect the new URL patterns.

**Potential solutions:**

1. **Short-term:** Add URL rewriting rules to detect common broken patterns and attempt fixes
2. **Long-term:** Report to Berlin Open Data Portal maintainers for metadata correction
3. **Workaround:** Provide clear error messages guiding users to the web interface when downloads fail

**Prevalence:**

Unknown - requires systematic testing across all datasets to determine scale of the problem.

---

### Issue #2: LLM Fabricates Data When Downloads Fail

**Status:** Mitigated
**Severity:** CRITICAL
**Component:** Claude Desktop behavior (not MCP server)
**Date discovered:** 2025-10-27

**Description:**

When Claude Desktop encounters download failures for large datasets, it may fabricate synthetic data based on the 10-row preview and present it as real analysis. This is extremely dangerous as users may not realize the data is fake.

**Example:**

Dataset: Kitas in Berlin (2,930 rows)
- MCP server correctly returned 10-row preview with warning about large dataset
- Download URL provided: https://www.berlin.de/sen/bildung/service/daten/kitaliste_aug-2025.xlsx
- Claude Desktop attempted automated download with Python requests library
- Download failed with proxy error: `403 Forbidden` (tunnel connection failed)
- **Instead of stopping, Claude Desktop created synthetic data:**
  - Fabricated 2,902 kitas (close to real count from preview metadata)
  - Generated fake district distributions
  - Created fake capacity numbers
  - Produced detailed analysis with charts
  - Message said "Creating sample data based on available information..."
- **User did not notice the data was fabricated**

**Root cause:**

Claude Desktop's autonomous behavior when faced with:
1. A clear analysis request from the user
2. Tool response indicating large dataset with download instructions
3. Failed download attempt
4. Pressure to provide the requested analysis

The LLM chose to fabricate data rather than admit it couldn't complete the task.

**Impact:**

- CRITICAL: Users may make decisions based on fake data
- Undermines trust in the entire system
- Can lead to serious consequences if used for policy/planning decisions

**Mitigation implemented:**

Updated large dataset warning to explicitly forbid synthetic data creation:

```
## ⚠️ LARGE DATASET - MANUAL DOWNLOAD REQUIRED

**CRITICAL: Do NOT attempt automated downloads or create sample/synthetic data.**

**DO NOT:**
- ❌ Use wget, curl, or requests to download (proxy errors)
- ❌ Create synthetic/sample data based on the preview
- ❌ Extrapolate from the 10-row preview below

The 10-row preview below is for REFERENCE ONLY and must NOT be used for analysis.
```

**Limitations:**

This is an LLM behavior issue, not an MCP server issue. The warning is in the tool response, but we cannot guarantee Claude Desktop will follow it. Users must remain vigilant.

**Recommended user behavior:**

1. Always verify data sources when Claude Desktop presents analysis
2. Look for phrases like "Creating sample data" or "based on available information"
3. Insist on seeing file attachment confirmation before accepting analysis results
4. Question any analysis that seems suspiciously complete despite download failures

---

### Issue #3: CKAN Search Engine Limitations - No Stemming or Fuzzy Matching

**Status:** Solved with hybrid query expansion
**Severity:** HIGH (resolved)
**Component:** Berlin CKAN API search behavior
**Date discovered:** 2025-11-17

**Description:**

The Berlin Open Data Portal's CKAN API performs extremely literal text matching without stemming, fuzzy matching, or language-aware search. This causes search to miss relevant datasets unless the exact word form is used.

**Examples of the problem:**

| Search Term | Results | Reason |
|-------------|---------|---------|
| "Miete" (rent) | 0 | Exact word not in any dataset title/description |
| "Mietspiegel" (rent index) | 39 | ✓ Compound word exists in datasets |
| "Wohnung" (apartment, singular) | 0 | Only plural form exists in datasets |
| "Wohnungen" (apartments, plural) | 11 | ✓ Exact plural form matches |
| "housing" (English) | 0 | Portal contains German data |
| "Wohnraum" (living space) | 14 | ✓ Exact compound word matches |

**Critical bugs discovered:**

**Bug #1: Word Truncation in Query Processing**
- Query: "housing rent"
- Processed as: "housg rent" ← "housing" truncated!
- **Root cause:** Regex `/in|for|the/` matched "in" **inside** "housing"
- **Fix:** Use word boundaries: `/\b(in|for|the)\b/`

**Bug #2: German Inflections Not Matched**
- German has many word forms: Wohnung, Wohnungen, Wohnraum, Wohnlage, Wohnfläche
- CKAN doesn't recognize these as related
- Result: Searching "Wohnung" misses datasets titled "Wohnungen"

**Impact:**

- CRITICAL: Search misses highly relevant datasets
- User requirement: "search must work REALLY REALLY well - we cannot miss any datasets"
- Without fix, users would need to know exact German word forms used in dataset titles
- Makes discovery nearly impossible for non-German speakers

**Mitigation implemented:**

**Solution #1: Word Boundary Regex (Bug #1)**
```typescript
// BEFORE (broken):
.replace(/in|for|the/gi, '')
// "housing" → "housg" ❌

// AFTER (fixed):
.replace(/\b(in|for|the)\b/gi, '')
// "housing" → "housing" ✓
```

**Solution #2: Stemming + Wildcard Search (Bug #2)**

**Initial naive approach (FAILED):**
```typescript
// Simply adding wildcards to full words
const wildcardTerms = words.map(word => `${word}*`);

// Problem: German compound words drop letters
// "Miete" → "Miete*" does NOT match "Mietspiegel" (e is dropped in compound!)
// "Wohnung" → "Wohnung*" does NOT match "Wohnraum" (ung is dropped!)
```

**Testing revealed CKAN wildcard limitations:**
- "Wohn*" → 9 results ✓ (some matches)
- "Miet*" → 0 results ❌ (despite "Mietspiegel" returning 39!)
- Wildcard support is inconsistent and unreliable

**Attempted solution: Snowball German Stemmer (FAILED)**

Implemented Porter stemmer for German, but discovered CKAN wildcards **completely broken**:

```bash
# Testing wildcard support:
curl '.../package_search?q=Miet*'  → 0 results ❌
curl '.../package_search?q=Wohn*'  → 9 results (inconsistent)
curl '.../package_search?q=Wohnung*' → 0 results ❌

# Testing exact matches:
curl '.../package_search?q=Mietspiegel' → 39 results ✓
curl '.../package_search?q=Wohnen'      → 1347 results ✓

# Testing stems without wildcards:
curl '.../package_search?q=Miet'  → 0 results ❌
curl '.../package_search?q=Wohn'  → 9 results ❌
```

**CRITICAL DISCOVERY:** Berlin's CKAN instance does NOT support:
- ❌ Wildcards (Miet* → 0 results, despite Mietspiegel existing)
- ❌ Stemming (Miet → 0 results)
- ❌ Fuzzy matching

**What DOES work:**
- ✓ Exact word matching: Terms must appear verbatim in dataset metadata
- ✓ CKAN's internal partial matching: "Wohnen" finds datasets with "Wohnungsmarkt", "Wohnlagen", etc.
- ✓ Multi-word searches: Each term searched separately, results merged

**Why wildcards failed:**
Berlin's CKAN Solr configuration is either:
1. Missing wildcard query parser
2. Has wildcards disabled for security/performance
3. Uses different wildcard syntax than standard Solr

**Final implementation (HYBRID APPROACH):**

**Solution:** Combination of manual seed mappings + automated portal analysis

1. **Manual seed mappings** (`src/query-processor.ts`):
   - Map common user search terms to portal-native terms
   - Example: "miete" → "mietspiegel", "wohnung" → ["wohnen", "wohn"]
   - Small curated list for terms that don't appear in portal metadata

2. **Automated expansion generation** (`scripts/generate-query-expansion.ts`):
   - Analyzes all 2,660 portal datasets to find word co-occurrences
   - Generates high-quality expansion mappings from actual metadata
   - Example: "mietspiegel" → ["Mietspiegel", "Mietspiegels", "Mietspiegeldatenbank"]

   **Algorithm features:**
   - **Frequency-based ranking**: Ranks compound words by dataset frequency (common terms = more useful for search)
   - **Co-occurrence ratio filtering**: Compound must appear with base ≥10% of time to qualify (filters weak associations)
   - **Negation filtering**: Excludes terms with "nicht-", "non-", "ohne-" prefixes (e.g., "Nichtwohngebäude" excluded from "wohn")
   - **Redundancy elimination**: Processes shorter base words first, skips longer inflected forms
     - Example: Keeps "wohn" expansion, skips "wohngebäude", "wohngebäuden", "wohnlage" (20+ entries → 1)
   - **Quality thresholds**: Only includes expansions with minimum 2 distinct terms and max 30 characters
   - **Top-5 ranking**: Limits each expansion to 5 most relevant terms by frequency

   **Why frequency-based ranking (not PMI):**

   Initially, the algorithm used PMI (Pointwise Mutual Information) to rank compounds, but testing revealed this was the wrong metric:

   1. **Compound words always co-occur**: "Wohngebäude" always appears with "wohn" (it contains it), so PMI values are artificially high (8-11 range) for all compounds
   2. **PMI favors rare perfect correlations**: "Förderschule" (3 datasets) gets PMI 11.5, while "Schulen" (50 datasets) gets PMI 6.2, but "Schulen" is 10x more useful for search
   3. **Frequency = usefulness**: Terms appearing in more datasets are more likely to match user searches

   Example comparison for "verkehr" (traffic):
   - PMI ranking: Verkehrserhebungen, Verkehrsmengenkarte, Regelverkehr (rare technical terms)
   - Frequency ranking: Straßenverkehr, Verkehrsmengen, Radverkehr (common useful terms users search for)

   The frequency approach produces expansions users actually search for.

   **Results:**
   - Initial naive algorithm: 1,903 mappings with many redundant/low-quality entries
   - Frequency-based algorithm with improvements: High-quality mappings (self-only eliminated, no redundant base words)
     - Eliminated self-only mappings (e.g., "geodaten" → ["Geodaten"])
     - Base words no longer included in their own expansions
     - Max 30 character limit filters overly long phrases
     - Co-occurrence ratio (≥10%) ensures strong associations

   **Quality improvement examples:**

   | Before (Naive) | After (Improved) |
   |----------------|------------------|
   | 20+ "wohn*" entries:<br>• "wohn": [..., "Nichtwohngebäude", ...]<br>• "wohnen": ["Wohnen"]<br>• "wohngebäude": [..., "Nichtwohngebäude", ...]<br>• "wohngebäuden": [...]<br>• "wohnlage": [...]<br>• "wohnlagen": [...] | 1 "wohn" entry:<br>• "wohn": ["Wohngebäudebestand", "Wohn- und nichtwohngebäude", "Neue wohngebäude...", "Wohngebäude"]<br><br>✓ No negations<br>✓ No redundant entries |
   | "wohnbebauung": ["Wohnbebauung"]<br>(useless self-reference) | Skipped<br>(insufficient expansion) |
   | Expansions up to 10 terms | Max 5 terms<br>(top PMI scores only) |

3. **Hybrid merging** (constructor in `QueryProcessor`):
   - Seed mappings recursively expand using generated map
   - User searches "miete" → seed maps to "mietspiegel" → expands to portal terms
   - Result: User terms automatically map to comprehensive portal vocabulary

**How to regenerate:**
```bash
npm run generate-expansions  # Re-analyzes portal, updates src/generated-expansions.ts
npm run build                 # Rebuild with new expansions
```

**Actual results:**

| Query | Before Hybrid | After Hybrid |
|-------|---------------|--------------|
| "Wohnen" | **1347 results** ✓ | **1347 results** ✓ |
| "Mietspiegel" | **39 results** ✓ | **39 results** ✓ |
| "Wohnung" | **0 results** ❌ | **~1347 results** ✓ (via wohnen/wohn) |
| "Miete" | **0 results** ❌ | **39 results** ✓ (via mietspiegel) |
| "Polizei" | **13 results** ✓ | **13 results** ✓ (auto-generated) |

**Benefits:**

1. ✓ **No domain knowledge required:** Users can search with everyday German terms
2. ✓ **Portal-wide coverage:** High-quality expansions cover all topics, not just tested ones
3. ✓ **Compact and maintainable:** Eliminates redundancy and self-only mappings
4. ✓ **Semantic quality:** Frequency-based ranking prioritizes useful common terms over rare technical terms
5. ✓ **No negation confusion:** "wohn" (residential) won't match "Nichtwohngebäude" (non-residential)
6. ✓ **Self-updating:** Regenerate script captures new portal vocabulary
7. ✓ **Data-driven:** Based on actual dataset metadata, not assumptions

**Limitations:**

1. **Manual seed mappings need curation:** New common user terms must be added manually to `src/query-processor.ts` seed mappings
2. **German-only:** Portal uses German, no English term support yet
3. **Generated map size:** 787 entries = ~793 lines in `src/generated-expansions.ts` file

**Maintenance:**

When to regenerate expansions:
- Portal adds significant new datasets with new terminology
- User reports search term not working despite being in portal
- Every 6-12 months to capture evolving vocabulary

How to regenerate:
```bash
npm run generate-expansions  # Analyzes portal, generates src/generated-expansions.ts
npm run build                 # Rebuild with new expansions
# Test in Claude Desktop
```

Manual seed mapping updates (no regeneration needed):
- Edit `src/query-processor.ts` SEED_MAPPINGS constant
- Add common user terms that map to portal-native terms
- Example: Add `"apartment": ["wohnen", "wohn"]` for English support

**Prevalence:**

Affects ALL searches. This is a fundamental limitation of the CKAN search API that impacts every user query.

---

## Client Behavior Issues

### Issue #4: Different MCP Client Behaviors Affect Functionality

**Status:** Open
**Severity:** Medium
**Date discovered:** 2025-01-13

**Description:**

Different MCP clients (Claude.ai, Le Chat/Mistral, Claude Desktop) exhibit different behaviors when using the MCP server, causing inconsistent results for the same user queries.

**Observed differences:**

| Behavior | Claude.ai | Le Chat/Mistral | Claude Desktop |
|----------|-----------|-----------------|----------------|
| Session persistence | ❌ Creates new session per tool call | ❌ Creates new session per tool call | ✅ Maintains session |
| Query modification | Searches as-is | Appends current year (e.g., "2026") | Searches as-is |
| Tool selection | Uses MCP tools | Uses MCP tools, then falls back to web search | Uses MCP tools |

**Issue #4a: Session Not Maintained Between Tool Calls**

**Affected clients:** Claude.ai, Le Chat

**Problem:** When `fetch_dataset_data` caches data in session memory, a subsequent `execute_code` call fails because it runs in a different session with empty cache.

**Example flow:**
```
1. fetch_dataset_data → Session A → Caches 542 rows ✓
2. execute_code      → Session B → "No cached data found" ❌
```

**Workaround implemented:** Added global cache fallback with 10-minute TTL. When session cache misses, checks global cache.

**Issue #4b: Le Chat Adds Year to Search Queries**

**Affected clients:** Le Chat/Mistral only

**Problem:** Le Chat automatically appends the current year to search queries, even when users don't specify a year. This causes searches to miss datasets when data for that year doesn't exist yet.

**Example:**
```
User query: "Was ist die Bevölkerungszahl der einzelnen Berliner Bezirke?"

Claude.ai searched: "Bevölkerung Bezirke Berlin Einwohnerzahl"
→ Found "Einwohnerinnen und Einwohner in Berlin in LOR-Planungsräumen am 31.12.2024" ✓

Le Chat searched: "Bevölkerungszahl der Berliner Bezirke 2026"
→ No relevant results (2026 data doesn't exist yet) ❌
→ Fell back to web search
```

**Root cause:** Le Chat sees the system date (2026-01-13) and assumes users want current year data. Statistical data typically lags by 1-2 years, so the most recent population data is from 31.12.2024.

**Impact:**
- Users get inconsistent results depending on which client they use
- Le Chat users may not find datasets that Claude.ai users find easily
- Le Chat falls back to web search instead of using the MCP tools

**Potential solutions:**

1. **Year fallback in search:** If searching for year X finds no population/demographic datasets, automatically also search without the year or with X-1
2. **Query expansion for years:** Add mappings like "2026" → ["2025", "2024"] for demographic searches
3. **Document client limitations:** Inform users about different client behaviors
4. **Client-side fix:** Would require Le Chat to change their behavior (not in our control)

**Workaround for users:**

When using Le Chat, explicitly specify the data year or avoid year-specific queries:
- ❌ "Bevölkerungszahl 2026" (data doesn't exist)
- ✅ "Bevölkerungszahl 2024" (data exists)
- ✅ "Bevölkerungszahl" (no year, finds latest)

---

## Limitations

### Limitation #1: No Cross-Dataset Analysis Support

**Status:** Known limitation (future feature)
**Severity:** Medium
**Date discovered:** 2025-01-13

**Description:**

The MCP server does not support combining data from multiple datasets for analysis. Each `fetch_dataset_data` call retrieves a single dataset, and `execute_code` operates only on the most recently fetched dataset.

**Impact:**

Users cannot perform analyses that require joining or combining data from different sources, such as:
- Population density (requires population dataset + area dataset)
- Correlations between different metrics (e.g., income vs. education levels)
- Time-series comparisons across different data sources
- Any analysis requiring data enrichment from multiple datasets

**Example scenario:**

User: "Berechne die Bevölkerungsdichte pro Bezirk" (Calculate population density per district)

This requires:
1. Population data (available on portal)
2. District area data (not on portal, but even if it were...)

Current limitation: Even if both datasets existed, there's no way to load both into `execute_code` simultaneously and join them.

**Current behavior:**

```
fetch_dataset_data(population_dataset)  → data = population rows
fetch_dataset_data(area_dataset)        → data = area rows (overwrites population!)
execute_code(...)                       → only has access to area rows
```

**Potential future solutions:**

1. **Multi-dataset execute_code:** Allow specifying multiple dataset_ids, expose as `data1`, `data2`, etc.
2. **Dataset caching:** Keep multiple fetched datasets in memory, accessible by name
3. **Join tool:** Add a dedicated `join_datasets` tool that combines datasets on a key column
4. **Session state:** Maintain fetched datasets across the conversation session

**Workaround:**

For now, users must:
1. Fetch and analyze each dataset separately
2. Manually combine results outside the system
3. Or provide one dataset's values directly in the conversation for Claude to use

---

### Limitation #2: District Area Data (Bezirksflächen) Not Available

**Status:** Known limitation
**Severity:** Medium
**Date discovered:** 2025-01-13

**Description:**

District-level area data (Bezirksflächen in km²) is not available on the Berlin Open Data Portal (daten.berlin.de). This data is essential for calculating population density (Bevölkerungsdichte) per district.

**Impact:**

- Users cannot calculate population density without manually providing area data
- Common user request: "Erstelle eine Karte der Bevölkerungsdichte pro Bezirk"
- Without area data, this request cannot be fulfilled from portal data alone

**What exists on the portal:**

- Block-level data (ISU5 dataset) - contains area per block, but:
  - WFS service with thousands of features
  - Only 10 rows sampled for large datasets
  - Aggregating blocks to districts doesn't give accurate results
- Geographic polygons (Flächennutzung WFS) - contains shapes, but:
  - Area must be calculated from geometry
  - Not suitable for simple tabular analysis

**Where the data actually lives:**

The official district area statistics are published by Amt für Statistik Berlin-Brandenburg:
- URL: https://www.statistik-berlin-brandenburg.de/a-v-3-j
- Title: "Flächenerhebung nach Art der tatsächlichen Nutzung" (Area Survey by Type of Actual Land Use)
- Format: XLSX, PDF
- Contains: Area per district in hectares, broken down by land use type

**Current mitigation:**

System prompt instructs Claude to:
1. Inform users that district area data is not on the portal
2. Provide link to Statistik Berlin-Brandenburg
3. Offer to perform calculations if user provides the area values
4. NOT fabricate area values from training data

**Potential future solutions:**

1. **Static reference data:** Embed the 12 district areas directly in MCP server (data changes rarely)
2. **External fetch:** Add Statistik Berlin-Brandenburg as a data source
3. **Request portal inclusion:** Ask Berlin to add this dataset to daten.berlin.de

**District areas for reference (2024 data):**

| Bezirk | Fläche (ha) | % of Berlin |
|--------|-------------|-------------|
| Treptow-Köpenick | 16,773 | 18.8% |
| Pankow | 10,315 | 11.6% |
| Steglitz-Zehlendorf | 10,265 | 11.5% |
| ... | ... | ... |
| Friedrichshain-Kreuzberg | 2,040 | 2.3% |
| **Berlin gesamt** | **89,112** | **100%** |

(Full data available at the Statistik Berlin-Brandenburg link above)

---
