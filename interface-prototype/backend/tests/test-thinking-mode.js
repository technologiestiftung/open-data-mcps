// Test script to verify extended thinking mode helps with follow-up questions
// This tests whether Claude can avoid repeating previous answers

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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

async function testWithThinking() {
  console.log('\n=== Testing WITH Extended Thinking ===\n');

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

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 12000,
    system: systemPrompt,
    messages: messages,
    thinking: {
      type: 'enabled',
      budget_tokens: 8000
    }
  });

  console.log('Response content blocks:', response.content.length);

  // Extract thinking and text
  const thinkingBlock = response.content.find(block => block.type === 'thinking');
  const textBlock = response.content.find(block => block.type === 'text');

  if (thinkingBlock) {
    console.log('\n--- THINKING PROCESS ---');
    console.log(thinkingBlock.thinking);
    console.log('--- END THINKING ---\n');
  } else {
    console.log('\n⚠️  No thinking block found\n');
  }

  console.log('--- RESPONSE ---');
  console.log(textBlock?.text || 'No text block found');
  console.log('--- END RESPONSE ---\n');

  // Check if response mentions Lichtenberg
  const mentionsLichtenberg = textBlock?.text?.toLowerCase().includes('lichtenberg');
  console.log('\n✓ Test Result:');
  console.log(`  Mentions Lichtenberg: ${mentionsLichtenberg ? '❌ YES (should be NO)' : '✅ NO (correct!)'}`);

  return mentionsLichtenberg;
}

async function testWithoutThinking() {
  console.log('\n=== Testing WITHOUT Extended Thinking ===\n');

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

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages
    // No thinking parameter
  });

  const textBlock = response.content.find(block => block.type === 'text');

  console.log('--- RESPONSE ---');
  console.log(textBlock?.text || 'No text block found');
  console.log('--- END RESPONSE ---\n');

  // Check if response mentions Lichtenberg
  const mentionsLichtenberg = textBlock?.text?.toLowerCase().includes('lichtenberg');
  console.log('\n✓ Test Result:');
  console.log(`  Mentions Lichtenberg: ${mentionsLichtenberg ? '❌ YES (should be NO)' : '✅ NO (correct!)'}`);

  return mentionsLichtenberg;
}

async function main() {
  try {
    console.log('Testing whether extended thinking helps Claude avoid repeating previous answers\n');
    console.log('Scenario: User asks 3 questions in sequence:');
    console.log('  1. "Was ist die Bevölkerungszahl der einzelnen Berliner Bezirke?"');
    console.log('  2. "Wieviele Menschen wohnen in Lichtenberg?"');
    console.log('  3. "Wieviele Bezirke haben mehr Bewohner als Neukölln?"');
    console.log('\nExpected: Question 3 should NOT mention Lichtenberg\n');
    console.log('='.repeat(70));

    const withoutThinkingMentions = await testWithoutThinking();
    const withThinkingMentions = await testWithThinking();

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`WITHOUT thinking: ${withoutThinkingMentions ? '❌ Mentions Lichtenberg' : '✅ Does not mention Lichtenberg'}`);
    console.log(`WITH thinking:    ${withThinkingMentions ? '❌ Mentions Lichtenberg' : '✅ Does not mention Lichtenberg'}`);

    if (!withoutThinkingMentions && !withThinkingMentions) {
      console.log('\n✅ Both approaches work! The prompt improvements alone may have fixed it.');
    } else if (withoutThinkingMentions && !withThinkingMentions) {
      console.log('\n✅ Extended thinking SOLVES the issue!');
    } else if (withoutThinkingMentions && withThinkingMentions) {
      console.log('\n❌ Extended thinking does NOT solve the issue.');
    } else {
      console.log('\n❓ Unexpected result - neither mentions Lichtenberg with thinking but does without?');
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('API Error:', error.response.data);
    }
  }
}

main();
