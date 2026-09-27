/**
 * Scratch: does mock.module() + dynamic import get lib/index.js loaded?
 * Run: node --experimental-test-module-mocks scratch/probe.test.js
 */
import { test, mock } from 'node:test'

test('import index.js with peers mocked', async () => {
  mock.module('@deepseek-ai/dsh-home-paths', { namedExports: { resolveDshHome: () => 'C:/tmp' } })
  mock.module('@deepseek-ai/dsh-llm', {
    namedExports: { resolveImageAttachmentAccess: () => undefined, resolveRetryPolicy: () => ({}), createProvider: () => ({}), openAICompletionsApi: () => ({}), PiAiAdapter: class {} },
  })
  mock.module('@deepseek-ai/dsh-llm-pi-ai', { namedExports: { PiAiAdapter: class {} } })
  mock.module('@deepseek-ai/dsh-settings', { namedExports: {} })
  mock.module('@deepseek-ai/dsh-host-webserver', { namedExports: {} })
  mock.module('@earendil-works/pi-ai', { namedExports: { createProvider: () => ({}), openAICompletionsApi: () => ({}) } })
  mock.module('@earendil-works/pi-ai/api/openai-completions.lazy', {
    namedExports: { openAICompletionsApi: () => ({}) },
  })
  mock.module('@deepseek-ai/cordis', { namedExports: {} })
  mock.module('@deepseek-ai/schemastery', {
    defaultExport: Object.assign(() => undefined, { object: () => ({}), array: () => ({}) }),
  })

  try {
    const mod = await import('../lib/index.js')
    console.log('IMPORT OK:', Object.keys(mod).join(', '))
  } catch (error) {
    console.log('IMPORT FAILED:', error?.code ?? error?.constructor?.name, '-', error?.message)
  }
})
