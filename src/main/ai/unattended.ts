const INSTRUCTION = [
  'You are running in an unattended, scheduled environment.',
  'No human is available to respond to you at any point during this run.',
  'Do not ask the user questions, do not request confirmation, and do not present',
  'options that require a choice. When something is ambiguous, make a reasonable',
  'assumption, state it briefly, and continue. Always complete the task autonomously',
  'and produce a final result.'
].join(' ')

export function buildUnattendedInstruction(): string {
  return INSTRUCTION
}

export function prefixUnattended(prompt: string): string {
  return `${INSTRUCTION}\n\n${prompt}`
}
