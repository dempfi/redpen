import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULTS, pieces, redpen, sentences } from '../src/cut.js'

const scorer = (hot, prob = 0.999) => async text => {
  const spans = hot.filter(h => text.includes(h)).map(h => [text.indexOf(h), text.indexOf(h) + h.length])
  return pieces(text).map(p => ({ ...p, prob: spans.some(([a, z]) => p.start >= a && p.end <= z) ? prob : 0.01 }))
}
const run = async (text, hot, settings = {}, prob) => (await redpen(text, scorer(hot, prob), { ...DEFAULTS, maxCutFraction: 1, ...settings })).text

test('pieces split words and punctuation the way BERT does, with offsets', () => {
  assert.deepEqual(pieces("He didn't.").map(p => p.text), ['He', 'didn', "'", 't', '.'])
  const [, didn] = pieces("He didn't.")
  assert.deepEqual([didn.start, didn.end, didn.word], [3, 7, true])
})

test('sentences are found across lines and inside emphasis', () => {
  const text = '*He nods. She sits.*\n"Hi," she says.'
  assert.deepEqual(sentences(text).map(s => text.slice(s.start, s.end)), ['*He nods.', 'She sits.*', '"Hi," she says.'])
})

test('a flagged tail after a comma is cut and the sentence keeps its full stop', async () => {
  assert.equal(await run('He sets the cup down, jaw tight.', ['jaw tight']), 'He sets the cup down.')
})

test('a flagged tail that starts at "and" is cut with its leading space', async () => {
  assert.equal(await run('She crosses the room and stays there, chest heaving.', ['and stays there, chest heaving']), 'She crosses the room.')
})

test('a fully flagged sentence is removed with its spacing', async () => {
  assert.equal(await run('He takes the chair by the window. Her breath hitches. He opens the book on the table.', ['Her breath hitches']), 'He takes the chair by the window. He opens the book on the table.')
})

test('a flagged span in the middle or at the start of a sentence is left alone', async () => {
  const mid = 'He sets, jaw tight, the cup down on the table.'
  assert.equal(await run(mid, ['jaw tight']), mid)
  const start = 'Jaw tight, he sets the cup down on the table.'
  assert.equal(await run(start, ['Jaw tight']), start)
})

test('a tail is kept when cutting it would leave fewer than three words', async () => {
  const text = 'He nods, jaw tight. Then he opens the door and walks out into the rain.'
  assert.equal(await run(text, ['jaw tight']), text)
})

test('a tail with no comma or "and" in front of it is left alone', async () => {
  const text = 'He sets the cup down with his jaw tight.'
  assert.equal(await run(text, ['jaw tight']), text)
})

test('dialogue is skipped by default, including a later sentence of the same quote', async () => {
  const text = 'He opens the door for you and waits. "I know the way. Come up, or send me away."'
  assert.equal(await run(text, ['Come up, or send me away']), text)
  assert.equal(await run(text, ['Come up, or send me away'], { skipDialogue: false }), 'He opens the door for you and waits. "I know the way."')
})

test('scores under the threshold cut nothing', async () => {
  const text = 'He takes the chair by the window. Her breath hitches. He opens the book on the table.'
  assert.equal(await run(text, ['Her breath hitches'], {}, 0.95), text)
  assert.notEqual(await run(text, ['Her breath hitches'], { threshold: 0.9 }, 0.95), text)
})

test('emphasis marks stay balanced when a sentence is removed', async () => {
  assert.equal(await run('*Her breath hitches.* He takes the chair by the window and opens the book.', ['Her breath hitches']), 'He takes the chair by the window and opens the book.')
  assert.equal(await run('*He takes the chair by the window. Her breath hitches.*', ['Her breath hitches']), '*He takes the chair by the window.*')
  assert.equal(await run('*Her breath hitches. He takes the chair by the window.*', ['Her breath hitches']), '*He takes the chair by the window.*')
})

test('a paragraph that held only a removed sentence disappears cleanly', async () => {
  assert.equal(await run('He takes the chair by the window.\n\nHer breath hitches.\n\nHe opens the book on the table.', ['Her breath hitches']), 'He takes the chair by the window.\n\nHe opens the book on the table.')
})

test('cuts stop at the budget and never empty the message', async () => {
  const all = 'Her breath hitches. He goes still. She meets your gaze.'
  assert.equal(await run(all, ['Her breath hitches', 'He goes still', 'She meets your gaze']), all)
  const text = 'Her breath hitches. He takes the chair by the window and opens the book on the table. He goes still.'
  const out = await run(text, ['Her breath hitches', 'He goes still'], { maxCutFraction: 0.2 })
  assert.equal(out, 'Her breath hitches. He takes the chair by the window and opens the book on the table.')
})

test('every switch off means no change', async () => {
  const text = 'He sets the cup down, jaw tight. Her breath hitches. He opens the book on the table.'
  assert.equal(await run(text, ['jaw tight', 'Her breath hitches'], { cutTails: false, cutSentences: false }), text)
})

test('the result reports what was cut', async () => {
  const { cuts } = await redpen('He sets the cup down, jaw tight.', scorer(['jaw tight']), { ...DEFAULTS, maxCutFraction: 1 })
  assert.deepEqual(cuts.map(c => [c.kind, c.removed]), [['tail', ', jaw tight']])
})
