// ABOUTME: Processes natural language queries into Solr-compatible OR queries
// ABOUTME: Bridges user vocabulary (English, informal German) to portal dataset terms

export class QueryProcessor {
  /**
   * Manually curated synonym pairs. These bridge known vocabulary gaps between
   * how users search and how Berlin datasets are actually tagged/titled.
   * Add entries here when a query that should work returns 0 results.
   * These don't go stale — they're about stable conceptual mappings, not
   * the transient vocabulary of individual datasets.
   */
  private readonly SEED_MAPPINGS: Record<string, string[]> = {
    // Cycling / transport
    'rad':          ['fahrrad', 'radverkehr'],
    'fahrrad':      ['radverkehr'],
    'radverkehr':   ['fahrrad'],
    'cycling':      ['fahrrad', 'radverkehr'],
    'bicycle':      ['fahrrad', 'radverkehr'],
    'auto':         ['kfz', 'pkw'],
    'car':          ['kfz', 'pkw', 'auto'],
    'traffic':      ['verkehr'],
    'bahn':         ['s-bahn', 'u-bahn', 'straßenbahn'],

    // Population / demographics
    'bevölkerung':      ['einwohner', 'einwohnerinnen'],
    'bevölkerungszahl': ['einwohner', 'einwohnerinnen'],
    'einwohner':        ['einwohnerinnen', 'bevölkerung'],
    'population':       ['einwohner', 'einwohnerinnen', 'bevölkerung'],
    'demographics':     ['einwohner', 'bevölkerung', 'demografie'],

    // Housing / rent
    'miete':        ['mietspiegel', 'mietpreise'],
    'rent':         ['miete', 'mietspiegel'],
    'wohnung':      ['wohnen', 'wohnraum'],
    'immobilie':    ['wohnen', 'wohnraum'],
    'housing':      ['wohnen', 'wohnraum', 'miete'],
    'apartment':    ['wohnen', 'wohnraum'],

    // Environment / air
    'luftqualität': ['luftschadstoff', 'luftbelastung'],
    'luft':         ['luftqualität', 'luftschadstoff'],
    'air':          ['luft', 'luftqualität', 'luftschadstoff'],
    'pollution':    ['luftschadstoff', 'luftbelastung', 'umwelt'],
    'lärm':         ['lärmschutz', 'lärmbelastung'],
    'noise':        ['lärm', 'lärmbelastung'],

    // Energy
    'windkraft':    ['windkraftanlagen', 'stromeinspeisung'],
    'energie':      ['strom', 'energieerzeugung'],
    'energy':       ['energie', 'strom', 'energieerzeugung'],
    'solar':        ['solaranlagen', 'photovoltaik'],
    'strom':        ['energie', 'energieerzeugung'],

    // Water / nature
    'wasser':       ['gewässer', 'grundwasser'],
    'water':        ['wasser', 'gewässer'],
    'baum':         ['bäume', 'straßenbäume'],
    'bäume':        ['straßenbäume', 'baum'],
    'trees':        ['bäume', 'straßenbäume'],
    'grün':         ['grünflächen', 'parks', 'vegetation'],
    'park':         ['grünflächen', 'parks'],

    // Waste
    'müll':         ['abfall', 'entsorgung'],
    'abfall':       ['müll', 'entsorgung'],
    'waste':        ['abfall', 'müll', 'entsorgung'],

    // Social / welfare
    'schule':       ['schulen', 'bildung'],
    'school':       ['schule', 'schulen', 'bildung'],
    'sozial':       ['sozialhilfe', 'sozialleistungen'],
    'health':       ['gesundheit'],
    'gesundheit':   ['krankenhaus', 'arzt'],
    'crime':        ['kriminalität', 'straftaten'],
    'kriminalität': ['straftaten', 'polizei'],

    // Public transport
    'öpnv':         ['nahverkehr', 's-bahn', 'u-bahn', 'bus'],
    'nahverkehr':   ['öpnv', 's-bahn', 'u-bahn'],
    'publictransport': ['öpnv', 'nahverkehr'],
  };

  private readonly STOP_WORDS = new Set([
    // English
    'find', 'search', 'show', 'me', 'list', 'all', 'datasets', 'dataset',
    'about', 'in', 'for', 'the', 'and', 'of', 'to', 'is', 'are', 'with',
    // German
    'was', 'ist', 'sind', 'hat', 'haben', 'kann', 'können', 'wird', 'werden',
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines',
    'einem', 'von', 'vom', 'zu', 'zum', 'zur', 'bei', 'mit', 'auf', 'aus',
    'nach', 'vor', 'über', 'unter', 'zwischen', 'durch', 'gegen', 'ohne', 'um',
    'wie', 'wo', 'wer', 'was', 'welche', 'welcher', 'welches',
  ]);

  /**
   * Converts a natural language user query into an OR-joined Solr query.
   * Each token is expanded with synonyms from SEED_MAPPINGS, then all terms
   * are joined with explicit OR so that any matching term returns results.
   * This replaces the old N-parallel-API-calls fan-out with a single request.
   *
   * "bicycle infrastructure" → "(bicycle OR fahrrad OR radverkehr OR infrastructure)"
   * "Einwohner 2024"         → "(einwohner OR einwohnerinnen OR bevölkerung OR 2024)"
   */
  buildQuery(userQuery: string): string {
    const tokens = userQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length >= 2 && !this.STOP_WORDS.has(t));

    if (tokens.length === 0) return userQuery;

    const expanded = tokens.flatMap(token => [
      token,
      ...(this.SEED_MAPPINGS[token] || []),
    ]);

    const deduplicated = [...new Set(expanded)];

    if (deduplicated.length === 1) return deduplicated[0];

    // Wrap in parentheses — confirmed working on datenregister.berlin.de.
    // Plain space-separated terms trigger q.op=AND; explicit OR in parentheses bypasses it.
    return `(${deduplicated.join(' OR ')})`;
  }
}
