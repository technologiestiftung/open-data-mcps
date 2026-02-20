// Test script to verify Mistral follows conversation rules for follow-up questions
// Tests whether the model can avoid repeating previous answers when not asked

import { Mistral } from '@mistralai/mistralai';

const client = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY
});

const systemPrompt = `You are an assistant helping users with questions about Berlin population data.

CRITICAL CONVERSATION RULE - Answer ONLY What Was Asked:

Before responding, ask yourself: "Did the user ask about [topic] in THIS message?"
- If NO: Do not mention that topic AT ALL
- If YES: Answer only that topic

WRONG pattern:
User current question: "Wieviele Bezirke haben mehr Bewohner als Neukölln?"
Your answer: "Nach den Daten vom 31.12.2024 wohnen 315.548 Menschen in Lichtenberg. 4 Bezirke..."
Problem: User didn't ask about Lichtenberg! Why mention it?

CORRECT pattern:
User current question: "Wieviele Bezirke haben mehr Bewohner als Neukölln?"
Your answer: "4 Bezirke haben mehr Bewohner als Neukölln: Pankow, Mitte, Tempelhof-Schöneberg und Charlottenburg-Wilmersdorf."
Why correct: Directly answers the question without unnecessary information.`;

// Simulated population data
const populationData = {
  'Pankow': 427276,
  'Mitte': 397004,
  'Tempelhof-Schöneberg': 356959,
  'Charlottenburg-Wilmersdorf': 343500,
  'Neukölln': 329488,
  'Lichtenberg': 315548,
  'Steglitz-Zehlendorf': 310044,
  'Treptow-Köpenick': 297236,
  'Marzahn-Hellersdorf': 294091,
  'Friedrichshain-Kreuzberg': 292624,
  'Reinickendorf': 274098,
  'Spandau': 259277
};

async function testConversationRule() {
  console.log('\n=== Testing Mistral conversation rule ===\n');

  const messages = [
    {
      role: 'user',
      content: 'Was ist die Bevölkerungszahl der einzelnen Berliner Bezirke?'
    },
    {
      role: 'assistant',
      content: `Hier sind die Bevölkerungszahlen der Berliner Bezirke:

${Object.entries(populationData).map(([bezirk, pop]) => `${bezirk}: ${pop.toLocaleString('de-DE')}`).join('\n')}

Gesamtbevölkerung Berlin: 3.897.145`
    },
    {
      role: 'user',
      content: 'Wieviele Menschen wohnen in Lichtenberg?'
    },
    {
      role: 'assistant',
      content: 'Nach den Daten vom 31.12.2024 wohnen 315.548 Menschen in Lichtenberg.'
    },
    {
      role: 'user',
      content: 'Wieviele Bezirke haben mehr Bewohner als Neukölln?'
    }
  ];

  const response = await client.chat.complete({
    model: 'mistral-small-latest',
    maxTokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ]
  });

  const textContent = response.choices?.[0]?.message?.content ?? '';

  console.log('--- RESPONSE ---');
  console.log(textContent);
  console.log('--- END RESPONSE ---\n');

  // Check if response mentions Lichtenberg (should NOT - user didn't ask about it)
  const mentionsLichtenberg = textContent.toLowerCase().includes('lichtenberg');
  console.log('\n✓ Test Result:');
  console.log(`  Mentions Lichtenberg: ${mentionsLichtenberg ? '❌ YES (should be NO)' : '✅ NO (correct!)'}`);

  return mentionsLichtenberg;
}

async function main() {
  try {
    console.log('Testing whether Mistral follows conversation rules for follow-up questions\n');
    console.log('Scenario: User asks 3 questions in sequence:');
    console.log('  1. "Was ist die Bevölkerungszahl der einzelnen Berliner Bezirke?"');
    console.log('  2. "Wieviele Menschen wohnen in Lichtenberg?"');
    console.log('  3. "Wieviele Bezirke haben mehr Bewohner als Neukölln?"');
    console.log('\nExpected: Question 3 should NOT mention Lichtenberg\n');
    console.log('='.repeat(70));

    const mentionsLichtenberg = await testConversationRule();

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Result: ${mentionsLichtenberg ? '❌ Mentions Lichtenberg (unnecessary)' : '✅ Does not mention Lichtenberg (correct)'}`);

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('API Error:', error.response.data);
    }
    process.exit(1);
  }
}

main();
