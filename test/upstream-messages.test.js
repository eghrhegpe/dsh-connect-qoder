/**
 * Contract tests for the OpenAI-to-Qoder message translation.
 *
 * Run: node --test test/upstream-messages.test.js
 *
 * `toQoderMessages` had no coverage, which is a poor place to leave the part of
 * the plugin that keeps the tool loop alive. Its own comment calls the tool
 * translation "the single most important thing" that must survive the trip, and
 * the failure modes it guards are all silent: a dropped system message or a
 * dropped `tool_call_id` does not throw, it produces a request the gateway
 * answers with a permanent 403, or a tool result that can never be matched back
 * to the call that asked for it.
 *
 * The cases below are the ones where the original shape and the translated shape
 * genuinely differ, or where a plausible-looking edit would silently lose data.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toQoderMessages, toQoderTools } from '../lib/upstream.js'

test('a developer role becomes system, and never disappears', () => {
  // pi-ai emits `role: "developer"` for a reasoning model unless the provider
  // declares `supportsDeveloperRole: false`. Qoder has no such role. Dropping
  // it — which an unhandled value used to do — leaves the request with no
  // system message at all, and the gateway answers that with a permanent
  // 403 `10605` on every attempt.
  const out = toQoderMessages([
    { role: 'developer', content: 'be brief' },
  ])
  assert.strictEqual(out.length, 1, 'the system prompt must survive, not be dropped')
  assert.strictEqual(out[0].role, 'system')
  assert.strictEqual(out[0].content, 'be brief')
})

test('system and developer both collapse to one system role', () => {
  const out = toQoderMessages([
    { role: 'system', content: 'first' },
    { role: 'developer', content: 'second' },
  ])
  assert.deepStrictEqual(
    out.map((m) => [m.role, m.content]),
    [
      ['system', 'first'],
      ['system', 'second'],
    ],
  )
})

test('a user message with an image_url block keeps its image', () => {
  // `image_url` is the shape pi-ai's OpenAI-completions API actually puts on the
  // wire through the shim. Matching only the DSH-native `image` shape made every
  // attached image disappear on the way out — silently, because the text half
  // of the message still rendered.
  const out = toQoderMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    },
  ])
  assert.strictEqual(out[0].content.length, 2)
  assert.deepStrictEqual(out[0].content[0], { type: 'text', text: 'what is this?' })
  assert.strictEqual(out[0].content[1].type, 'image_url')
  assert.strictEqual(out[0].content[1].image_url.url, 'data:image/png;base64,AAAA')
})

test('a DSH-native image block is converted to a data URL', () => {
  const out = toQoderMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'describe' },
        { type: 'image', mimeType: 'image/jpeg', data: 'QUJD' },
      ],
    },
  ])
  assert.strictEqual(out[0].content[1].image_url.url, 'data:image/jpeg;base64,QUJD')
})

test('a text-only user message stays a plain string, not a block array', () => {
  // The endpoint is happier with the string form, and pi-ai sends both shapes
  // depending on whether an image is present.
  const out = toQoderMessages([{ role: 'user', content: 'plain' }])
  assert.strictEqual(out[0].content, 'plain')
})

test('an assistant tool_call survives with a stringified arguments field', () => {
  // `arguments` must be a STRING on the wire. A caller that passes an object
  // would serialise to `[object Object]` upstream, and the gateway cannot parse
  // that — the tool call would appear to succeed and then do nothing.
  const out = toQoderMessages([
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', function: { name: 'read', arguments: '{"path":"a.ts"}' } }],
    },
  ])
  assert.deepStrictEqual(out[0].tool_calls, [
    {
      id: 'call_1',
      type: 'function',
      function: { name: 'read', arguments: '{"path":"a.ts"}' },
    },
  ])
  assert.strictEqual(typeof out[0].tool_calls[0].function.arguments, 'string')
})

test('object arguments are serialised rather than stringified to [object Object]', () => {
  const out = toQoderMessages([
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', function: { name: 'read', arguments: { path: 'a.ts' } } }],
    },
  ])
  assert.strictEqual(out[0].tool_calls[0].function.arguments, '{"path":"a.ts"}')
})

test('a tool result keeps the tool_call_id that links it to its call', () => {
  // Without this id the harness cannot match the result back to the call, and
  // the tool loop stalls waiting for a result that can never arrive.
  const out = toQoderMessages([
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'file body' },
  ])
  const toolMessage = out.find((m) => m.role === 'tool')
  assert.ok(toolMessage, 'the tool result message must survive')
  assert.strictEqual(toolMessage.tool_call_id, 'call_1')
  assert.strictEqual(toolMessage.content, 'file body')
})

test('a DSH-native toolCall content block becomes an OpenAI tool_call', () => {
  const out = toQoderMessages([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'looking' },
        { type: 'toolCall', id: 'b1', name: 'grep', arguments: { q: 'x' } },
      ],
    },
  ])
  assert.strictEqual(out[0].content, 'looking')
  assert.deepStrictEqual(out[0].tool_calls, [
    { id: 'b1', type: 'function', function: { name: 'grep', arguments: '{"q":"x"}' } },
  ])
})

test('a tool call missing its id is rejected loudly', () => {
  // The gateway cannot dispatch a call it cannot name, and a result could not
  // be matched to it. This must throw rather than emit a nameless call.
  assert.throws(
    () =>
      toQoderMessages([
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: '{}' } }] },
      ]),
    /missing an id/,
  )
})

test('a tool call missing its function name is rejected loudly', () => {
  assert.throws(
    () =>
      toQoderMessages([
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { arguments: '{}' } }] },
      ]),
    /has no function name/,
  )
})

test('a toolCall block missing its name is rejected loudly', () => {
  assert.throws(
    () =>
      toQoderMessages([
        { role: 'assistant', content: [{ type: 'toolCall', id: 'b1', arguments: {} }] },
      ]),
    /has no function name/,
  )
})

test('a tool result with no id at all is rejected, not emitted unlinked', () => {
  // A tool result that carries no id cannot be matched back to the call that
  // asked for it, so the harness would wait forever for a link that never comes.
  // Emitting it unlinked looks harmless and stalls the loop silently; it must
  // throw. Verified by mutation: removing this guard leaves every other test
  // in this file green.
  assert.throws(
    () => toQoderMessages([{ role: 'tool', content: 'orphan result' }]),
    /missing tool_call_id/,
  )
})

test('both the DSH toolCallId and the OpenAI tool_call_id spellings are accepted', () => {
  // The DSH-native shape and the OpenAI shape both reach this function. If the
  // alias stopped working, a DSH-native tool result would be rejected as
  // unlinked — a regression that is invisible until a caller uses that shape.
  for (const message of [
    { role: 'tool', toolCallId: 'camel', content: 'r' },
    { role: 'tool', tool_call_id: 'snake', content: 'r' },
    { role: 'toolResult', toolCallId: 'camel2', content: 'r' },
  ]) {
    const out = toQoderMessages([message])
    assert.strictEqual(out.length, 1, `message with ${JSON.stringify(message)} must be accepted`)
    assert.strictEqual(out[0].role, 'tool')
    assert.ok(
      typeof out[0].tool_call_id === 'string' && out[0].tool_call_id.length > 0,
      'the id must survive under the OpenAI spelling',
    )
  }
  // And the exact values must not be swapped between the two spellings.
  assert.strictEqual(
    toQoderMessages([{ role: 'tool', toolCallId: 'camel', content: 'r' }])[0].tool_call_id,
    'camel',
  )
  assert.strictEqual(
    toQoderMessages([{ role: 'tool', tool_call_id: 'snake', content: 'r' }])[0].tool_call_id,
    'snake',
  )
})

test('an unknown role is dropped rather than passed through', () => {
  // Qoder would reject a role it does not know; the message cannot be forwarded
  // as-is and must not be silently rewritten into something else either.
  const out = toQoderMessages([
    { role: 'function', content: 'legacy' },
    { role: 'user', content: 'kept' },
  ])
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].role, 'user')
})

test('toQoderTools keeps the OpenAI function schema shape intact', () => {
  const out = toQoderTools([
    { type: 'function', function: { name: 'read', description: 'read a file', parameters: { type: 'object' } } },
  ])
  // The shape is preserved rather than flattened: the gateway expects the
  // OpenAI `function` envelope, so a tool definition that came out as
  // `{name, description}` would be silently unregisterable.
  assert.deepStrictEqual(out, [
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'read a file',
        parameters: { type: 'object' },
      },
    },
  ])
})

test('toQoderTools accepts the bare DSH descriptor and wraps it', () => {
  // The other accepted shape. If this branch stopped wrapping, a direct caller
  // using the DSH descriptor would get an entry with no `function` envelope,
  // which the gateway silently ignores.
  const out = toQoderTools([{ name: 'grep', description: 'search', parameters: { type: 'object' } }])
  assert.strictEqual(out[0].function.name, 'grep')
  assert.strictEqual(out[0].type, 'function')
})

test('toQoderTools defaults a missing description and empty parameters', () => {
  // A tool with no parameters must still declare an object schema, or the
  // gateway may reject the whole request rather than just this tool.
  const out = toQoderTools([{ type: 'function', function: { name: 'now' } }])
  assert.strictEqual(out[0].function.description, '')
  assert.deepStrictEqual(out[0].function.parameters, { type: 'object', properties: {} })
})

test('toQoderTools tolerates a non-array', () => {
  assert.deepStrictEqual(toQoderTools(undefined), [])
  assert.deepStrictEqual(toQoderTools(null), [])
})

test('toQoderTools rejects a tool with no function name', () => {
  // A nameless tool cannot be dispatched, and registering one silently would
  // make the model call into the void.
  assert.throws(
    () => toQoderTools([{ type: 'function', function: { description: 'nameless' } }]),
    /has no function name/,
  )
})

test('toQoderTools rejects a bare descriptor with no name, with its own message', () => {
  // The two shapes report differently, and the index is included so a
  // multi-tool request points at the offending entry.
  assert.throws(
    () => toQoderTools([{ description: 'nameless' }]),
    /tool at index 0 has no name/,
  )
})
