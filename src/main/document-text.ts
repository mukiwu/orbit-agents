import { readFileSync } from 'fs'
import { extname } from 'path'
import mammoth from 'mammoth'

export async function extractDocumentText(filePath: string): Promise<string | null> {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath })
    return result.value.trim().slice(0, 100_000) || null
  }
  if (extension === '.pdf') {
    // 延遲載入：pdf-parse 依賴原生 canvas，載入失敗不該拖垮整個 app 啟動
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(readFileSync(filePath)) })
    try {
      const result = await parser.getText()
      return result.text.trim().slice(0, 100_000) || null
    } finally {
      await parser.destroy()
    }
  }
  return null
}
