export const DEFAULTS = Object.freeze({
  threshold: 0.95,
  cutSentences: true,
  cutTails: true,
  skipDialogue: true,
  maxCutFraction: 0.3,
})

const MIN_WORDS_KEPT = 3
const SPAN_FLOOR = 0.5
const STILL_SLOP = 0.7
const TAIL_PUNCTUATION = new Set([',', ';', '—', '–'])
const CLAUSE_OPENERS = new Set([
  'and', 'but', 'or', 'nor', 'so', 'yet',
  'as', 'while', 'when', 'whenever', 'because', 'before', 'after', 'until', 'till', 'since', 'though', 'although', 'if', 'unless', 'whereas', 'once',
])
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

const hot = piece => piece.prob >= SPAN_FLOOR

function tailOf(scored) {
  const words = scored.filter(piece => piece.word)
  const w = words.findIndex(hot)
  if (w < MIN_WORDS_KEPT || !words.slice(w).every(hot)) return null
  const first = words[w]
  const before = scored[scored.indexOf(first) - 1]
  const end = words.at(-1).end
  if (before && TAIL_PUNCTUATION.has(before.text)) return { start: before.start, end }
  if (CLAUSE_OPENERS.has(first.text.toLowerCase())) return { start: first.start, end }
  return null
}

async function readsClean(text, score) {
  return (await score(text)).every(piece => !piece.word || piece.prob < STILL_SLOP)
}

async function decide(body, score, settings) {
  const scored = await score(body)
  const words = scored.filter(piece => piece.word)
  const hotWords = words.filter(hot)
  if (!hotWords.length) return null
  const top = Math.max(...hotWords.map(piece => piece.prob))
  if (top < settings.threshold) return null
  const whole = settings.cutSentences ? { kind: 'sentence', score: top } : null
  if (hotWords.length === words.length) return whole

  const tail = settings.cutTails ? tailOf(scored) : null
  if (tail && (await readsClean(body.slice(0, tail.start) + body.slice(tail.end), score))) return { kind: 'tail', score: top, ...tail }
  return hotWords.length * 2 > words.length ? whole : null
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
    const decision = await decide(body, score, settings)
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
