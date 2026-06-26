import { describe, it, expect } from 'vitest'
import { runProvider } from './runner'
import type { AiProvider, ExecutionContext } from './types'

// A provider that runs `node -e <script>` so we can drive real stdout bytes.
function fakeNodeProvider(script: string): AiProvider {
  return {
    id: 'codex',
    displayName: 'fake',
    capabilities: { mcp: false, attachments: 'image-flag', streaming: 'text' },
    resolveCommand: () => 'node',
    buildArgs: () => ['-e', script],
    buildEnv: () => ({ ...process.env }),
    promptDelivery: 'arg',
    needsPty: false,
    parseOutput: (raw) => raw,
    test: async () => ({ success: true, output: '' }),
    listModels: async () => [],
    listMcps: async () => []
  }
}

function ctx(): ExecutionContext {
  return {
    prompt: 'hi',
    systemInstruction: '',
    model: null,
    mcpTools: [],
    imagePaths: [],
    addDirs: [],
    projectPath: null,
    skipPermissions: true
  }
}

describe('runProvider output decoding', () => {
  it('reassembles multi-byte UTF-8 split across stream chunks without corruption', async () => {
    // Emit each byte of a Chinese string on its own with a delay, forcing the
    // stream to deliver multi-byte characters split across separate data chunks.
    const script =
      "const b=Buffer.from('根據你的計畫週報');let i=0;(function n(){if(i>=b.length)return;process.stdout.write(Buffer.from([b[i++]]));setTimeout(n,5)})()"

    const result = await runProvider(fakeNodeProvider(script), ctx())

    expect(result.output).toContain('根據你的計畫週報')
    expect(result.output).not.toContain('�')
  })
})
