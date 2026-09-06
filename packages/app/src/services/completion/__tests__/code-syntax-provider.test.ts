import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { buildCompletionContext } from '../context';
import { CodeSyntaxProvider } from '../code-syntax-provider';

function codeContext(doc: string, cursorPos = doc.length) {
  return buildCompletionContext({
    doc,
    cursorPos,
    settings: DEFAULT_COMPLETION_SETTINGS,
    indexData: null,
    n: 4,
  });
}

describe('CodeSyntaxProvider', () => {
  const provider = new CodeSyntaxProvider();

  it.each([
    ['```typescript\nconst value = (', ')'],
    ['```json\n{"name"', ': '],
    ['```yaml\nname', ': '],
    ['```python\nif ready', ':'],
  ])('returns a deterministic edit for %s', (doc, text) => {
    expect(provider.provide(codeContext(doc))).toMatchObject({
      text,
      kind: 'code-syntax',
      feedbackPolicy: 'none',
      edit: { from: doc.length, to: doc.length, insertText: text },
    });
  });

  it('does not guess an unknown fence language or generate semantic code', () => {
    expect(provider.provide(codeContext('```ruby\nif ready'))).toBeNull();
    expect(provider.provide(codeContext('```typescript\nconst unknown'))).toBeNull();
  });

  it('inserts Rust :: between identifiers even though the cursor is not at line end', () => {
    const doc = '```rust\nstd' + 'fmt';
    const cursorPos = '```rust\nstd'.length;
    expect(provider.provide(codeContext(doc, cursorPos))).toMatchObject({
      text: '::',
      edit: { from: cursorPos, to: cursorPos, insertText: '::' },
    });
  });

  it.each([
    ['JSON key separator', '```json\n{"name"value', '```json\n{"name"'.length],
    ['YAML key separator', '```yaml\nname value', '```yaml\nname'.length],
    ['Python control colon', '```python\nif ready pass', '```python\nif ready'.length],
    [
      'delimiter closure',
      '```typescript\nconst value = (next',
      '```typescript\nconst value = ('.length,
    ],
    ['indentation', '```python\nif ready:\n    pass', '```python\nif ready:\n'.length],
  ])('does not trigger %s in the middle of a line', (_label, doc, cursorPos) => {
    expect(provider.provide(codeContext(doc, cursorPos))).toBeNull();
  });
});
