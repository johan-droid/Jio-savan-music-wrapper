const { test } = require('node:test');
const assert = require('node:assert');
const { parseDuration } = require('./utils');

test('parseDuration - should return 0 for empty, null or undefined input', () => {
  assert.strictEqual(parseDuration(''), 0);
  assert.strictEqual(parseDuration(null), 0);
  assert.strictEqual(parseDuration(undefined), 0);
});

test('parseDuration - should parse pure numeric string as seconds', () => {
  assert.strictEqual(parseDuration('120'), 120);
  assert.strictEqual(parseDuration('45'), 45);
});

test('parseDuration - should parse MM:SS format', () => {
  assert.strictEqual(parseDuration('3:45'), 225);
  assert.strictEqual(parseDuration('03:45'), 225);
  assert.strictEqual(parseDuration('00:05'), 5);
});

test('parseDuration - should parse HH:MM:SS format', () => {
  assert.strictEqual(parseDuration('1:01:01'), 3661);
  assert.strictEqual(parseDuration('01:05:10'), 3910);
});

test('parseDuration - should handle invalid strings by returning parsed integer or 0', () => {
  assert.strictEqual(parseDuration('not-a-number'), 0);
  // parseInt('10abc') returns 10
  assert.strictEqual(parseDuration('10abc'), 10);
});
