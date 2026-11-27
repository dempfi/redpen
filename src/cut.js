export const DEFAULTS = Object.freeze({
  threshold: 0.99,
  cutSentences: true,
  cutTails: true,
  skipDialogue: true,
  maxCutFraction: 0.3,
})

const MIN_WORDS_KEPT = 3
const SPAN_FLOOR = 0.5
const TAIL_PUNCTUATION = new Set([',', ';', '—', '–'])
const TAIL_WORDS = new Set(['and', 'but'])
const OPENING_QUOTES = new Set(['“', '«'])
const CLOSING_QUOTES = new Set(['”', '»'])
const QUOTES = new Set(['"', ...OPENING_QUOTES, ...CLOSING_QUOTES])
const MARKUP = new Set(['*', '_', ...QUOTES])

export function pieces(text) {
  return [...text.matchAll(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu)].map(match => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
    word: /[\p{L}\p{N}]/u.test(match[0]),
  }))
}

export function sentences(text) {
  const found = []
  let lineStart = 0
  for (const line of text.split('\n')) {
    let from = 0
    const push = to => {
      const raw = line.slice(from, to)
      const lead = raw.length - raw.trimStart().length
      if (raw.trim()) found.push({ start: lineStart + from + lead, end: lineStart + from + raw.trimEnd().length })
      from = to
    }
    for (const match of line.matchAll(/[.!?…]+["”’»*_)\]]*(?=\s|$)/gu)) push(match.index + match[0].length)
    push(line.length)
    lineStart += line.length + 1
  }
  return found
}

function insideQuote(text, position) {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1
  let open = false
  for (const char of text.slice(lineStart, position)) {
    if (char === '"') open = !open
    else if (OPENING_QUOTES.has(char)) open = true
    else if (CLOSING_QUOTES.has(char)) open = false
  }
  return open
}

function core(text, sentence) {
  let { start, end } = sentence
  while (start < end && MARKUP.has(text[start])) start++
  while (end > start && MARKUP.has(text[end - 1])) end--
  return { start, end, lead: start - sentence.start, trail: sentence.end - end }
}

function decide(scored, settings) {
  const words = scored.filter(piece => piece.word)
  const hot = piece => piece.prob >= SPAN_FLOOR
  const hotWords = words.filter(hot)
  if (!hotWords.length) return null
  const score = Math.max(...hotWords.map(piece => piece.prob))
  if (score < settings.threshold) return null
  if (hotWords.length === words.length) return settings.cutSentences ? { kind: 'sentence', score } : null
  if (!settings.cutTails) return null

  const first = scored.indexOf(hotWords[0])
  const kept = scored.slice(0, first).filter(piece => piece.word)
  const tail = scored.slice(first).filter(piece => piece.word)
  if (kept.length < MIN_WORDS_KEPT || !tail.every(hot)) return null

  const before = scored[first - 1]
  const last = tail.at(-1)
  if (before && TAIL_PUNCTUATION.has(before.text)) return { kind: 'tail', score, start: before.start, end: last.end }
  if (TAIL_WORDS.has(scored[first].text.toLowerCase())) return { kind: 'tail', score, start: scored[first].start, end: last.end }
  return null
}

function sentenceRange(text, sentence, inner) {
  const balanced = inner.lead === inner.trail
  let start = balanced ? sentence.start : inner.start
  let end = balanced ? sentence.end : inner.end
  if (!balanced && inner.lead && !inner.trail) {
    while (text[end] === ' ') end++
    return { start, end }
  }
  let space = end
  while (text[space] === ' ') space++
  if (space > end && text[space] !== undefined && text[space] !== '\n' && !(inner.trail && !balanced)) return { start, end: space }
  while (start > 0 && text[start - 1] === ' ') start--
  return { start, end }
}

function tailRange(text, start, end) {
  while (start > 0 && text[start - 1] === ' ') start--
  return { start, end }
}

function tidy(text) {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function redpen(text, score, settings = DEFAULTS) {
  const candidates = []
  for (const sentence of sentences(text)) {
    const inner = core(text, sentence)
    const body = text.slice(inner.start, inner.end)
    const spoken = [...text.slice(sentence.start, sentence.end)].some(char => QUOTES.has(char)) || insideQuote(text, sentence.start)
    if (settings.skipDialogue && spoken) continue
    const decision = decide(await score(body), settings)
    if (!decision) continue
    const range =
      decision.kind === 'sentence'
        ? sentenceRange(text, sentence, inner)
        : tailRange(text, inner.start + decision.start, inner.start + decision.end)
    candidates.push({ kind: decision.kind, score: decision.score, ...range })
  }

  const size = text.replace(/\s/g, '').length
  const budget = size * settings.maxCutFraction
  const accepted = []
  let spent = 0
  for (const cut of [...candidates].sort((a, b) => b.score - a.score || a.start - b.start)) {
    const cost = text.slice(cut.start, cut.end).replace(/\s/g, '').length
    if (spent + cost > budget) continue
    spent += cost
    accepted.push(cut)
  }

  let result = text
  for (const cut of [...accepted].sort((a, b) => b.start - a.start)) result = result.slice(0, cut.start) + result.slice(cut.end)
  result = tidy(result)
  if (!accepted.length || !result) return { text, cuts: [] }
  return {
    text: result,
    cuts: accepted.sort((a, b) => a.start - b.start).map(cut => ({ kind: cut.kind, score: cut.score, removed: text.slice(cut.start, cut.end).trim() })),
  }
}
