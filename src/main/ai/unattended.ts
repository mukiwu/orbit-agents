import type { ResolvedLocale } from '../../shared/i18n/resolveLocale'

const INSTRUCTION = [
  'You are running in an unattended, scheduled environment.',
  'No human is available to respond to you at any point during this run.',
  'Do not ask the user questions, do not request confirmation, and do not present',
  'options that require a choice. When something is ambiguous, make a reasonable',
  'assumption, state it briefly, and continue. Always complete the task autonomously',
  'and produce a final result.'
].join(' ')

const LANGUAGE_DIRECTIVE: Record<ResolvedLocale, string> = {
  en: 'Regardless of the language of these instructions or the project content, write all of your output to the user in English, including progress narration and the final result.',
  'zh-TW': '不論這些指示或專案內容是什麼語言，請全程使用繁體中文（台灣用語）回覆，包含所有過程說明、進度敘述與最終結果。'
}

const FORMAT_DIRECTIVE = [
  'Format your response as readable Markdown:',
  'separate paragraphs with a blank line,',
  'and use headings and bullet lists where they aid readability.',
  'Do not return a single unbroken block of text.'
].join(' ')

export function buildUnattendedInstruction(locale: ResolvedLocale): string {
  return [INSTRUCTION, LANGUAGE_DIRECTIVE[locale], FORMAT_DIRECTIVE].join('\n\n')
}

export function prefixUnattended(prompt: string, locale: ResolvedLocale): string {
  return `${buildUnattendedInstruction(locale)}\n\n${prompt}`
}
