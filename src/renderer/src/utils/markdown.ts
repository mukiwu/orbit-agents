// ReactMarkdown's default URL sanitizer only whitelists http(s)/mailto/xmpp and
// strips everything else (including file://). The agent links to local preview
// files, so we allow file:// (and tel:) through while still blocking script-y
// schemes like javascript: / data:.
const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp|tel|file):/i

export function safeMarkdownUrl(url: string): string {
  const value = url.trim()
  const colon = value.indexOf(':')
  if (colon === -1) return value // relative url / anchor

  const slash = value.indexOf('/')
  const question = value.indexOf('?')
  const hash = value.indexOf('#')

  // A colon after a /, ?, or # is part of the path, not a protocol → relative.
  if (
    (slash !== -1 && colon > slash) ||
    (question !== -1 && colon > question) ||
    (hash !== -1 && colon > hash)
  ) {
    return value
  }

  return SAFE_PROTOCOL.test(value) ? value : ''
}

// The agent sometimes emits a raw <iframe src="..."> to preview a generated
// HTML file. We never render raw HTML; rewrite it to a normal link so the user
// can open the preview in their browser instead.
export function linkifyIframes(markdown: string, label: string): string {
  // Angle-bracket the destination so paths containing spaces (e.g. iCloud's
  // "Mobile Documents") aren't truncated by the markdown link parser.
  return markdown.replace(
    /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:\s*<\/iframe>)?/gi,
    (_match, src) => `[${label}](<${src}>)`
  )
}
