const ULINK_DOUBLE = /<ulink\s+url="([^"]*)"\s*>([\s\S]*?)<\/ulink>/gi
const ULINK_SINGLE = /<ulink\s+url='([^']*)'\s*>([\s\S]*?)<\/ulink>/gi
const PARA = /<para\s*>([\s\S]*?)<\/para>/gi
const LIST_CONTAINER = /<\/?(itemizedlist|orderedlist)\s*>/gi
const LIST_ITEM = /<listitem\s*>([\s\S]*?)<\/listitem>/gi
const ANY_TAG = /<\/?[a-zA-Z][^>]*>/g

const ENTITIES = [
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&#39;/g, "'"]
]

export function sanitizeDescription(input) {
  if (input == null) return null
  if (typeof input !== 'string') return null

  let s = input

  s = s.replace(ULINK_DOUBLE, (_, url, inner) => `${inner} (${url})`)
  s = s.replace(ULINK_SINGLE, (_, url, inner) => `${inner} (${url})`)

  s = s.replace(PARA, (_, inner) => `\n\n${inner}\n\n`)

  s = s.replace(LIST_ITEM, (_, inner) => `\n- ${inner}`)
  s = s.replace(LIST_CONTAINER, '\n')

  s = s.replace(ANY_TAG, '')

  for (const [pattern, replacement] of ENTITIES) {
    s = s.replace(pattern, replacement)
  }

  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.trim()

  return s.length === 0 ? null : s
}
