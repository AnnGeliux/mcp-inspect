/**
 * Tests for the JSON syntax highlighter.
 * Tests the `highlight` function indirectly via the component's output HTML.
 *
 * Run with: node --test --import tsx tests/jsonhighlight.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the highlight function directly (it's not exported, so we test via component)
// We'll test the component's rendered HTML output instead.
import React from 'react';
import { render } from './render.tsx';
import JsonHighlight from '../src/renderer/components/JsonHighlight.tsx';

function getHtml(data: unknown): string {
  const { container, cleanup } = render(React.createElement(JsonHighlight, { data }));
  const code = container.querySelector('code');
  const html = code?.innerHTML ?? '';
  cleanup();
  return html;
}

test('JsonHighlight: keys are wrapped in jh-key span', () => {
  const html = getHtml({ name: 'test' });
  assert.ok(html.includes('jh-key'), 'should contain jh-key span for keys');
  assert.ok(html.includes('"name"'), 'should contain the key name');
});

test('JsonHighlight: string values are wrapped in jh-str span', () => {
  const html = getHtml({ name: 'hello' });
  assert.ok(html.includes('jh-str'), 'should contain jh-str span for string values');
  assert.ok(html.includes('"hello"'), 'should contain the string value');
});

test('JsonHighlight: numbers are wrapped in jh-num span', () => {
  const html = getHtml({ count: 42 });
  assert.ok(html.includes('jh-num'), 'should contain jh-num span for numbers');
  assert.ok(html.includes('42'), 'should contain the number value');
});

test('JsonHighlight: booleans are wrapped in jh-bool span', () => {
  const html = getHtml({ active: true, done: false });
  assert.ok(html.includes('jh-bool'), 'should contain jh-bool span for booleans');
  assert.ok(html.includes('true'), 'should contain true');
  assert.ok(html.includes('false'), 'should contain false');
});

test('JsonHighlight: null is wrapped in jh-null span', () => {
  const html = getHtml({ value: null });
  assert.ok(html.includes('jh-null'), 'should contain jh-null span for null');
  assert.ok(html.includes('null'), 'should contain null');
});

test('JsonHighlight: handles nested objects', () => {
  const html = getHtml({ outer: { inner: 'val' } });
  assert.ok(html.includes('jh-key'), 'should highlight keys in nested object');
  assert.ok(html.includes('jh-str'), 'should highlight string values in nested object');
  assert.ok(html.includes('"outer"'), 'should contain outer key');
  assert.ok(html.includes('"inner"'), 'should contain inner key');
  assert.ok(html.includes('"val"'), 'should contain inner value');
});

test('JsonHighlight: handles arrays', () => {
  const html = getHtml({ items: [1, 2, 3] });
  assert.ok(html.includes('jh-num'), 'should highlight numbers in array');
  assert.ok(html.includes('1'), 'should contain array element 1');
  assert.ok(html.includes('2'), 'should contain array element 2');
  assert.ok(html.includes('3'), 'should contain array element 3');
});

test('JsonHighlight: handles empty strings', () => {
  const html = getHtml({ name: '' });
  assert.ok(html.includes('jh-str'), 'empty string should be wrapped in jh-str');
  // The empty string should appear as "" in the output
  assert.ok(html.includes('""'), 'should contain empty string quotes');
});

test('JsonHighlight: handles null value at top level', () => {
  const html = getHtml(null);
  assert.ok(html.includes('jh-null'), 'null at top level should be highlighted');
});

test('JsonHighlight: handles negative numbers', () => {
  const html = getHtml({ temp: -42 });
  assert.ok(html.includes('jh-num'), 'negative number should be highlighted');
  // The regex uses \b which doesn't match - as word boundary,
  // so the - stays outside the span but the number itself is highlighted
  assert.ok(html.includes('42'), 'should contain the number 42');
  assert.ok(html.includes('-42') || html.includes('-<span'), 'should have negative sign near the number');
});

test('JsonHighlight: handles decimal numbers', () => {
  const html = getHtml({ pi: 3.14 });
  assert.ok(html.includes('jh-num'), 'decimal should be highlighted');
  assert.ok(html.includes('3.14'), 'should contain 3.14');
});

test('JsonHighlight: escapes HTML — input with <script> does not produce a script tag', () => {
  // Pass a string that contains HTML tags
  const html = getHtml({ evil: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), 'must NOT contain a literal <script> tag');
  assert.ok(html.includes('&lt;script&gt;'), 'should have escaped the angle brackets');
  assert.ok(html.includes('jh-str'), 'the string value should still be highlighted');
});

test('JsonHighlight: returns non-empty for empty object', () => {
  const html = getHtml({});
  // {} should produce some output (at least braces)
  assert.ok(html.includes('{'), 'should contain opening brace');
  assert.ok(html.includes('}'), 'should contain closing brace');
});

test('JsonHighlight: empty string input returns empty string', () => {
  const html = getHtml('');
  assert.equal(html, '', 'empty string input should produce empty HTML');
});