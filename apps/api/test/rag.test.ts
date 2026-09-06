import { describe, expect, it } from 'vitest';
import { askInbox, retrieveEmails } from '../src/rag.js';

const emails = [
  { id: '1', sender: 'billing@acme.test', subject: 'Invoice 1042 due Friday', snippet: 'Please review the invoice payment before Friday.' },
  { id: '2', sender: 'team@acme.test', subject: 'Project meeting', snippet: 'Can we meet tomorrow to review the launch?' },
  { id: '3', sender: 'news@test', subject: 'Weekly newsletter', snippet: 'Deals and promotions.' },
];

describe('email RAG', () => {
  it('ranks semantically relevant lexical evidence first', () => {
    const results = retrieveEmails('invoice payment deadline', emails, 2);
    expect(results[0].id).toBe('1');
    expect(results[0].matchedTerms).toEqual(expect.arrayContaining(['invoice', 'payment']));
  });

  it('returns grounded extractive fallback without a Gemini key', async () => {
    const previous = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await askInbox('When is the invoice due?', emails);
    expect(result.answer).toContain('Invoice 1042');
    expect(result.citations[0].id).toBe('1');
    if (previous) process.env.GEMINI_API_KEY = previous;
  });

  it('does not invent an answer when no evidence matches', async () => {
    const result = await askInbox('What is the weather on Mars?', emails);
    expect(result.confidence).toBeLessThan(0.2);
    expect(result.citations).toHaveLength(0);
  });
});
