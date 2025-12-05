const { sanitizeSlug, parseMaxTokens } = require('../src/agent/agent-adapter');

test('sanitizeSlug normalizes names and applies fallback', () => {
  expect(sanitizeSlug('My Button 42')).toBe('my_button_42');
  expect(sanitizeSlug('***')).toBe('component'); // fallback when nothing useful
});

test('parseMaxTokens respects positive ints and ignores bad input', () => {
  expect(parseMaxTokens('500', 100)).toBe(500);
  expect(parseMaxTokens('nope', 100)).toBe(100);
});