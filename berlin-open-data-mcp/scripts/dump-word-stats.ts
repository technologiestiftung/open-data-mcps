// ABOUTME: Dumps word statistics from portal analysis to JSON for inspection
// ABOUTME: Shows all words found, their frequencies, and dataset counts

import { BerlinOpenDataAPI } from '../src/berlin-api.js';
import { writeFile } from 'fs/promises';

interface WordStats {
  word: string;
  frequency: number;
  datasets: Set<string>;
  relatedWords: Map<string, number>;
}

interface WordStatsJSON {
  word: string;
  frequency: number;
  datasetCount: number;
  exampleDatasets: string[];
}

class WordStatsDumper {
  private api: BerlinOpenDataAPI;
  private wordStats: Map<string, WordStats> = new Map();
  private minWordLength = 3;

  private readonly STOP_WORDS = new Set([
    'und', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer',
    'im', 'am', 'um', 'zu', 'zum', 'zur', 'von', 'vom', 'mit', 'bei', 'nach',
    'über', 'unter', 'aus', 'für', 'durch', 'auf', 'an', 'als', 'bis', 'seit',
    'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
    'berlin', 'berliner', 'daten', 'data', 'dataset', 'datensatz'
  ]);

  constructor() {
    this.api = new BerlinOpenDataAPI();
  }

  private extractWords(text: string): string[] {
    if (!text) return [];

    return text
      .toLowerCase()
      .split(/[^a-zäöüß]+/)
      .filter(w =>
        w.length >= this.minWordLength &&
        !this.STOP_WORDS.has(w) &&
        !/^\d+$/.test(w)
      );
  }

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

      if (result.results.length < limit) break;
    }

    console.log(`✓ Processed ${totalProcessed} datasets`);
    console.log(`✓ Found ${this.wordStats.size} unique words`);
  }

  private processDataset(dataset: any): void {
    const datasetId = dataset.id;

    const titleWords = this.extractWords(dataset.title || '');
    const descWords = this.extractWords(dataset.notes || '');
    const tagWords = dataset.tags?.map((t: any) => t.name.toLowerCase()) || [];

    const allWords = [...titleWords, ...descWords, ...tagWords];
    const uniqueWords = [...new Set(allWords)];

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
    }
  }

  async dumpToJSON(): Promise<void> {
    console.log('\n📝 Creating JSON dumps...');

    // All words with stats
    const allWords: WordStatsJSON[] = Array.from(this.wordStats.values())
      .map(stats => ({
        word: stats.word,
        frequency: stats.frequency,
        datasetCount: stats.datasets.size,
        exampleDatasets: Array.from(stats.datasets).slice(0, 3)
      }))
      .sort((a, b) => b.frequency - a.frequency);

    // Candidate words (frequency >= 3)
    const candidateWords = allWords.filter(w => w.frequency >= 3);

    // Summary stats
    const summary = {
      totalWords: allWords.length,
      candidateWords: candidateWords.length,
      minFrequency: 3,
      generatedAt: new Date().toISOString(),
      frequencyDistribution: {
        freq_1: allWords.filter(w => w.frequency === 1).length,
        freq_2: allWords.filter(w => w.frequency === 2).length,
        freq_3_to_10: allWords.filter(w => w.frequency >= 3 && w.frequency <= 10).length,
        freq_11_to_50: allWords.filter(w => w.frequency >= 11 && w.frequency <= 50).length,
        freq_51_plus: allWords.filter(w => w.frequency >= 51).length
      }
    };

    // Write files
    await writeFile(
      './word-stats-all.json',
      JSON.stringify({ summary, words: allWords }, null, 2),
      'utf-8'
    );

    await writeFile(
      './word-stats-candidates.json',
      JSON.stringify({ summary, words: candidateWords }, null, 2),
      'utf-8'
    );

    console.log('\n✓ Created word-stats-all.json');
    console.log(`  - ${allWords.length} total words`);
    console.log(`  - Sorted by frequency (highest first)`);
    console.log(`  - Includes: word, frequency, datasetCount, exampleDatasets`);
    console.log('\n✓ Created word-stats-candidates.json');
    console.log(`  - ${candidateWords.length} candidate words (frequency >= 3)`);
    console.log(`  - These are the words considered for expansion generation`);

    console.log('\n📊 Frequency distribution:');
    console.log(`  Frequency = 1: ${summary.frequencyDistribution.freq_1} words`);
    console.log(`  Frequency = 2: ${summary.frequencyDistribution.freq_2} words`);
    console.log(`  Frequency 3-10: ${summary.frequencyDistribution.freq_3_to_10} words`);
    console.log(`  Frequency 11-50: ${summary.frequencyDistribution.freq_11_to_50} words`);
    console.log(`  Frequency 51+: ${summary.frequencyDistribution.freq_51_plus} words`);
  }

  async run(): Promise<void> {
    await this.analyzePortalData();
    await this.dumpToJSON();
  }
}

const dumper = new WordStatsDumper();
dumper.run();
