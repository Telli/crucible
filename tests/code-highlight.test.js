import test from 'node:test';
import assert from 'node:assert/strict';

async function load() {
  return import('../src/code-highlight.js');
}

test('an unknown or missing language returns the escaped source instead of throwing', async () => {
  const { highlightCode } = await load();
  assert.equal(highlightCode('a<b && "x"', 'python'), 'a&lt;b &amp;&amp; &quot;x&quot;');
  assert.equal(highlightCode('<i>', undefined), '&lt;i&gt;');
  assert.equal(highlightCode('', 'python'), '');
});

test('a registered language is still highlighted and its text escaped', async () => {
  const { highlightCode } = await load();
  assert.equal(highlightCode('', 'javascript'), '');
  assert.equal(highlightCode('a<b && "x"', 'javascript'), 'a&lt;b &amp;&amp; <span class="hljs-string">&quot;x&quot;</span>');
  assert.match(highlightCode('npm install pkg', 'bash'), /hljs-built_in/);
});

test('highlightElement marks only a known language with its class', async () => {
  const { highlightElement } = await load();
  const classes = new Set();
  const element = { textContent: 'x < 1', innerHTML: '', classList: { add: (...names) => names.forEach(name => classes.add(name)) } };
  highlightElement(element, 'python');
  assert.equal(element.innerHTML, 'x &lt; 1');
  assert.deepEqual([...classes], ['hljs']);
});
