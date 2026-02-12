// ABOUTME: Processes natural language queries into structured search parameters
// ABOUTME: Maps English and German keywords to relevant dataset tags and categories

import { DatasetSearchParams } from './types.js';
import { QUERY_EXPANSION } from './generated-expansions.js';

export class QueryProcessor {
  // Manual seed mappings: common user search terms → portal-native terms
  // These handle terms users search for that don't appear in portal metadata
  private readonly SEED_MAPPINGS: Record<string, string[]> = {
    // User searches "miete" but portal uses "Mietspiegel"
    "miete": ["mietspiegel"],

    // User searches "wohnung" but portal uses "wohnen", "wohnraum", etc.
    "wohnung": ["wohnen", "wohn"],

    // User searches "bevölkerung" but portal uses "einwohner"
    "bevölkerung": ["einwohner"],

    // Additional common user terms
    "immobilie": ["wohnen", "wohn"],
    "rad": ["fahrrad"],
    "auto": ["kfz"],
    "windkraft": ["windkraftanlagen", "stromeinspeisung"]
  };

  // Combined expansion map: merges seed mappings with generated expansions
  private readonly QUERY_EXPANSION: Record<string, string[]>;

  constructor() {
    // Merge seed mappings with generated expansions
    this.QUERY_EXPANSION = { ...QUERY_EXPANSION };

    // Expand seed mappings recursively
    for (const [userTerm, portalTerms] of Object.entries(this.SEED_MAPPINGS)) {
      const expandedTerms = new Set<string>();

      for (const portalTerm of portalTerms) {
        const lowerPortalTerm = portalTerm.toLowerCase();

        // Check if portal term has expansions in generated map
        if (QUERY_EXPANSION[lowerPortalTerm]) {
          // Add all expanded terms
          QUERY_EXPANSION[lowerPortalTerm].forEach(t => expandedTerms.add(t));
        } else {
          // No expansion available, use portal term directly (capitalized)
          expandedTerms.add(portalTerm.charAt(0).toUpperCase() + portalTerm.slice(1));
        }
      }

      // Store the combined expansion for the user term
      this.QUERY_EXPANSION[userTerm] = Array.from(expandedTerms);
    }
  }

  processQuery(naturalLanguageQuery: string): DatasetSearchParams {
    // Clean up noise words using word boundaries to avoid partial matches
    const cleanQuery = naturalLanguageQuery
      .replace(/\b(find|search|show|me|list|all|datasets?|about|in|for|the|and)\b/gi, '')
      .trim()
      .replace(/\s+/g, ' '); // Normalize whitespace

    // Use cleaned query directly
    const searchQuery = cleanQuery || naturalLanguageQuery;

    // Build search parameters
    const searchParams: DatasetSearchParams = {
      query: searchQuery,
      limit: 20
    };

    return searchParams;
  }

  extractSearchTerms(naturalLanguageQuery: string): string[] {
    // Clean up noise words using word boundaries to avoid partial matches
    // CRITICAL: Use \b to match whole words only, not substrings
    // Without \b: "housing" → "housg" (because "in" matches inside "housing")
    // With \b: "housing" → "housing" ✓
    const cleanQuery = naturalLanguageQuery
      .replace(/\b(find|search|show|me|list|all|datasets?|about|in|for|the|and|was|ist|sind|hat|haben|kann|können|wird|werden|der|die|das|den|dem|des|ein|eine|einer|eines|einem|von|vom|zu|zum|zur|bei|mit|auf|aus|nach|vor|über|unter|zwischen|durch|gegen|ohne|um)\b/gi, '')
      .trim()
      .replace(/\s+/g, ' '); // Normalize whitespace

    // Split into significant words (3+ characters to avoid noise)
    const words = cleanQuery.split(/\s+/).filter(w => w.length >= 3);

    if (words.length === 0) {
      return [cleanQuery || naturalLanguageQuery];
    }

    // CRITICAL: Berlin's CKAN instance does NOT support wildcards or stemming
    // SOLUTION: Query expansion map
    // Maps common search terms → actual terms that exist in portal datasets
    //
    // Example: User searches "miete"
    //   Without expansion: "miete" → 0 results ❌
    //   With expansion: ["Mietspiegel", "Mietpreis"] → 39 results ✓

    const expandedTerms: string[] = [];

    for (const word of words) {
      const lowerWord = word.toLowerCase();

      // Check if this word has an expansion mapping
      if (this.QUERY_EXPANSION[lowerWord]) {
        // Use expanded terms (verified to work in portal)
        expandedTerms.push(...this.QUERY_EXPANSION[lowerWord]);
      } else {
        // No expansion available, use original word
        expandedTerms.push(word);
      }
    }

    // Remove duplicates while preserving order
    return [...new Set(expandedTerms)];
  }

  extractIntent(query: string): 'search' | 'list' | 'specific' {
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('find') || lowerQuery.includes('search') || lowerQuery.includes('show me')) {
      return 'search';
    }

    if (lowerQuery.includes('list') || lowerQuery.includes('all datasets')) {
      return 'list';
    }

    return 'search'; // Default to search
  }

  generateSummary(results: any[], originalQuery: string): string {
    if (results.length === 0) {
      return `No datasets found for "${originalQuery}". Try refining your search terms.`;
    }

    const categories = new Set<string>();
    const formats = new Set<string>();

    results.forEach(dataset => {
      dataset.tags?.forEach((tag: any) => categories.add(tag.name));
      dataset.resources?.forEach((resource: any) => formats.add(resource.format));
    });

    let summary = `Found ${results.length} dataset(s) related to "${originalQuery}":\n\n`;

    results.slice(0, 5).forEach((dataset, index) => {
      summary += `${index + 1}. **${dataset.title}**\n`;
      summary += `   ${dataset.notes?.substring(0, 100)}${dataset.notes?.length > 100 ? '...' : ''}\n`;
      summary += `   Formats: ${dataset.resources?.map((r: any) => r.format).join(', ') || 'N/A'}\n\n`;
    });

    if (results.length > 5) {
      summary += `... and ${results.length - 5} more datasets.\n\n`;
    }

    summary += `**Categories found:** ${Array.from(categories).slice(0, 10).join(', ')}\n`;
    summary += `**Available formats:** ${Array.from(formats).slice(0, 10).join(', ')}`;

    return summary;
  }
}