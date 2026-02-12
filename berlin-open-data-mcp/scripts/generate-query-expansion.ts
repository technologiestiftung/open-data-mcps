// ABOUTME: Analyzes Berlin Open Data Portal metadata to generate query expansion mappings
// ABOUTME: Builds data-driven term expansions based on actual dataset titles, descriptions, and tags
//
// OVERVIEW:
// This script solves the problem that Berlin's CKAN API doesn't support wildcards, stemming, or fuzzy matching.
// Users searching for "Miete" (rent) get 0 results because datasets use "Mietspiegel" (rent index).
//
// SOLUTION:
// 1. Fetch all 2,660+ datasets from the portal
// 2. Analyze word co-occurrences in titles, descriptions, and tags
// 3. Build expansion mappings: user terms → portal-native terms
// 4. Export to src/generated-expansions.ts for use by QueryProcessor
//
// ALGORITHM FEATURES:
// - Frequency-based ranking (common terms = more useful for search)
// - Co-occurrence ratio filtering (compounds must strongly associate with base)
// - Negation filtering (excludes "nicht-", "non-" prefixed terms)
// - Redundancy elimination (processes shorter base words first, skips longer forms)
// - Quality thresholds (minimum 2 distinct terms, max 30 chars)
//
// USAGE:
//   npm run generate-expansions
//
// OUTPUT:
//   src/generated-expansions.ts - TypeScript module with QUERY_EXPANSION map
//
// MAINTENANCE:
// Re-run when portal data changes to capture new vocabulary.
// Generated map is merged with manual seed mappings in src/query-processor.ts

import { BerlinOpenDataAPI } from '../src/berlin-api.js';

interface WordStats {
  word: string;
  frequency: number;
  datasets: Set<string>;
  relatedWords: Map<string, number>; // co-occurring words and their frequencies
}

class QueryExpansionGenerator {
  private api: BerlinOpenDataAPI;
  private wordStats: Map<string, WordStats> = new Map();
  private minWordLength = 3;
  private minFrequency = 3; // Word must appear in at least 3 datasets

  // Words to exclude from analysis (noise words)
  private readonly STOP_WORDS = new Set([
    // German articles and prepositions
    'und', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'einem',
    'im', 'am', 'um', 'zu', 'zum', 'zur', 'von', 'vom', 'mit', 'bei', 'nach',
    'über', 'unter', 'aus', 'für', 'durch', 'auf', 'an', 'als', 'bis', 'seit',
    'vor', 'zwischen', 'gegen', 'ohne',
    // German common verbs
    'ist', 'sind', 'war', 'waren', 'wird', 'werden', 'wurde', 'wurden',
    'hat', 'haben', 'hatte', 'hatten', 'kann', 'können', 'konnte', 'konnten',
    'muss', 'müssen', 'musste', 'mussten', 'soll', 'sollen', 'sollte', 'sollten',
    'will', 'wollen', 'wollte', 'wollten',
    // German question words and pronouns
    'was', 'wer', 'wie', 'wo', 'wann', 'warum', 'welche', 'welcher', 'welches',
    // English stop words
    'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
    'find', 'search', 'show', 'list', 'about', 'all',
    // Berlin-specific noise
    'berlin', 'berliner', 'daten', 'data', 'dataset', 'datensatz'
  ]);

  constructor() {
    this.api = new BerlinOpenDataAPI();
  }

  /**
   * Extracts significant words from text, normalizing and filtering
   */
  private extractWords(text: string): string[] {
    if (!text) return [];

    // Split on non-word characters, normalize
    const words = text
      .toLowerCase()
      .split(/[^a-zäöüß]+/)
      .filter(w =>
        w.length >= this.minWordLength &&
        !this.STOP_WORDS.has(w) &&
        !/^\d+$/.test(w) // exclude pure numbers
      );

    return words;
  }

  /**
   * Fetches all datasets from the portal and builds word statistics
   */
  async analyzePortalData(): Promise<void> {
    console.log('📊 Fetching all datasets from Berlin Open Data Portal...');

    let offset = 0;
    const limit = 1000;
    let totalProcessed = 0;

    while (true) {
      const result = await this.api.searchDatasets({ query: '*:*', limit, offset });

      if (result.results.length === 0) break;

      console.log(`Processing datasets ${offset + 1} to ${offset + result.results.length}...`);

      for (const dataset of result.results) {
        this.processDataset(dataset);
      }

      totalProcessed += result.results.length;
      offset += limit;

      // Break if we've processed all available results
      if (result.results.length < limit) break;
    }

    console.log(`✓ Processed ${totalProcessed} datasets`);
    console.log(`✓ Found ${this.wordStats.size} unique significant words`);
  }

  /**
   * Processes a single dataset, extracting and recording word statistics
   */
  private processDataset(dataset: any): void {
    const datasetId = dataset.id;

    // Extract words from title and description
    const titleWords = this.extractWords(dataset.title || '');
    const descWords = this.extractWords(dataset.notes || '');
    const tagWords = dataset.tags?.map((t: any) => t.name.toLowerCase()) || [];

    const allWords = [...titleWords, ...descWords, ...tagWords];
    const uniqueWords = [...new Set(allWords)];

    // Update word statistics
    for (const word of uniqueWords) {
      if (!this.wordStats.has(word)) {
        this.wordStats.set(word, {
          word,
          frequency: 0,
          datasets: new Set(),
          relatedWords: new Map()
        });
      }

      const stats = this.wordStats.get(word)!;
      stats.frequency++;
      stats.datasets.add(datasetId);

      // Record co-occurring words (words that appear in same dataset)
      for (const otherWord of uniqueWords) {
        if (otherWord !== word) {
          const currentCount = stats.relatedWords.get(otherWord) || 0;
          stats.relatedWords.set(otherWord, currentCount + 1);
        }
      }
    }
  }

  /**
   * Check if a word is a negation of another word
   */
  private isNegation(word: string, baseWord: string): boolean {
    const negationPrefixes = ['nicht', 'non', 'ohne', 'un'];

    for (const prefix of negationPrefixes) {
      // Check if word starts with negation prefix followed by base word
      const negatedForm = prefix + baseWord;
      if (word === negatedForm || word.startsWith(negatedForm)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if this word is redundant with an existing expansion
   * Returns true if a shorter base word already covers this
   */
  private isRedundant(word: string, existingExpansions: Map<string, string[]>): boolean {
    // Check if a shorter substring of this word already has an expansion
    for (let len = 3; len < word.length; len++) {
      const substr = word.substring(0, len);
      if (existingExpansions.has(substr)) {
        return true;
      }
    }
    return false;
  }


  /**
   * Generates expansion candidates for common base words
   * Strategy: For each base word, find semantically related compound words
   * Uses frequency-based ranking, co-occurrence filtering, negation filtering, and redundancy elimination
   */
  generateExpansions(): Map<string, string[]> {
    console.log('\n🔍 Generating query expansions...');

    const expansions = new Map<string, string[]>();

    // Filter to words that meet minimum frequency threshold
    // Sort by length (shorter first) then frequency
    const significantWords = Array.from(this.wordStats.values())
      .filter(stats => stats.frequency >= this.minFrequency)
      .sort((a, b) => {
        if (a.word.length !== b.word.length) {
          return a.word.length - b.word.length; // Shorter words first
        }
        return b.frequency - a.frequency; // Then by frequency
      });

    console.log(`Found ${significantWords.length} significant words (frequency >= ${this.minFrequency})`);

    let skippedRedundant = 0;
    let skippedNoExpansion = 0;

    // For each significant word, find related compound words
    for (const stats of significantWords) {
      const baseWord = stats.word;

      // Skip if this word is redundant with an existing shorter expansion
      if (this.isRedundant(baseWord, expansions)) {
        skippedRedundant++;
        continue;
      }

      // Find words that contain this base word (compounds)
      const compounds: Array<{ word: string; freq: number }> = [];

      for (const [relatedWord, coOccurrence] of stats.relatedWords.entries()) {
        const relatedStats = this.wordStats.get(relatedWord);
        if (!relatedStats) continue;

        // Skip if this is a negation of the base word
        if (this.isNegation(relatedWord, baseWord)) {
          continue;
        }

        // Consider as compound if:
        // 1. Related word contains base word
        // 2. Related word is longer (is actually a compound)
        // 3. Not overly long (max 30 characters)
        // 4. They co-occur frequently enough
        if (relatedWord.includes(baseWord) &&
            relatedWord.length > baseWord.length &&
            relatedWord.length <= 30 &&
            coOccurrence >= 2) {

          // Calculate co-occurrence ratio: how often does compound appear WITH base?
          const coOccRatio = coOccurrence / relatedStats.frequency;

          // Only include if compound strongly associates with base (>= 10% of time)
          if (coOccRatio >= 0.1) {
            compounds.push({
              word: relatedWord,
              freq: relatedStats.frequency
            });
          }
        }
      }

      // Sort by frequency (most common compounds first)
      compounds.sort((a, b) => b.freq - a.freq);

      // Take top 5 most relevant compounds
      const topCompounds = compounds.slice(0, 5).map(c => this.capitalize(c.word));

      // Only create expansion if we have at least 2 distinct terms
      const uniqueCompounds = [...new Set(topCompounds)];

      if (uniqueCompounds.length >= 2) {
        expansions.set(baseWord, uniqueCompounds);
      } else {
        skippedNoExpansion++;
      }
    }

    console.log(`✓ Generated ${expansions.size} expansion mappings`);
    console.log(`  Skipped ${skippedRedundant} redundant entries`);
    console.log(`  Skipped ${skippedNoExpansion} entries with insufficient expansion`);

    return expansions;
  }

  /**
   * Capitalizes first letter (CKAN seems case-sensitive for some fields)
   */
  private capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  /**
   * Exports expansion map as TypeScript code
   */
  exportAsTypeScript(expansions: Map<string, string[]>): string {
    let output = '// GENERATED FILE - Do not edit manually\n';
    output += '// Generated by scripts/generate-query-expansion.ts\n';
    output += '// Run: npm run generate-expansions\n\n';
    output += 'export const QUERY_EXPANSION: Record<string, string[]> = {\n';

    // Sort by key for consistent output
    const sortedEntries = Array.from(expansions.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (const [baseWord, expansionList] of sortedEntries) {
      const expansionsStr = expansionList.map(w => `"${w}"`).join(', ');
      output += `  "${baseWord}": [${expansionsStr}],\n`;
    }

    output += '};\n';

    return output;
  }

  /**
   * Main execution
   */
  async run(): Promise<void> {
    try {
      await this.analyzePortalData();
      const expansions = this.generateExpansions();

      // Print sample expansions
      console.log('\n📋 Sample expansions:');
      let count = 0;
      for (const [base, expanded] of expansions.entries()) {
        if (count++ >= 10) break;
        console.log(`  "${base}" → [${expanded.join(', ')}]`);
      }

      // Export to file
      const tsCode = this.exportAsTypeScript(expansions);
      const fs = await import('fs/promises');
      await fs.writeFile('./src/generated-expansions.ts', tsCode, 'utf-8');

      console.log('\n✓ Expansion map written to src/generated-expansions.ts');
      console.log('✓ Update query-processor.ts to import and use this map');

    } catch (error) {
      console.error('❌ Error generating expansions:', error);
      throw error;
    }
  }
}

// Run if executed directly
const generator = new QueryExpansionGenerator();
generator.run();
