const { extractJsonResponse } = require('../src/util/extract-json-response');

describe('extractJsonResponse', () => {
  test('parses fenced JSON with trailing commas', () => {
    const text = [
      '```json',
      '{',
      '  "status": "built",',
      '  "props": [],',
      '}',
      '```'
    ].join('\n');
    expect(extractJsonResponse(text)).toEqual({ status: 'built', props: [] });
  });

  test('parses JSON embedded in prose', () => {
    const text = [
      'Here is the mapping schema:',
      '{ "status": "built", "exampleProps": { "size": "md", }, }',
      'Thanks'
    ].join('\n');
    expect(extractJsonResponse(text)).toEqual({
      status: 'built',
      exampleProps: { size: 'md' }
    });
  });

  test('parses all-single-quoted JSON', () => {
    const text = "{ 'status': 'built', 'props': [] }";
    expect(extractJsonResponse(text)).toEqual({ status: 'built', props: [] });
  });
});

