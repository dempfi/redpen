import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as transformers from '@huggingface/transformers'
import { DEFAULTS, redpen } from '../src/cut.js'
import { loadScorer } from '../src/model.js'

if (process.env.REDPEN_MODELS) {
  transformers.env.localModelPath = process.env.REDPEN_MODELS
  transformers.env.allowRemoteModels = false
}
const score = await loadScorer(transformers)
const reference = JSON.parse(readFileSync(new URL('./reference.json', import.meta.url), 'utf8'))

test('browser-side scoring matches the PyTorch checkpoint on every reference sentence', async () => {
  for (const { text, offsets, probs } of reference) {
    const expected = Math.max(...probs.filter((_, token) => offsets[token][1] > offsets[token][0]))
    const actual = Math.max(...(await score(text)).map(piece => piece.prob))
    assert.ok(Math.abs(actual - expected) < 1e-3, `${text}: ${actual} vs ${expected}`)
  }
})

test('the real model cuts a slop tail and a slop sentence at the default settings', async () => {
  const reply = 'He pulls the chair out for you and sits down across the table. Her breath hitches. She crosses the room and stays there, chest heaving. The rain has stopped by the time you reach the car.'
  const { text } = await redpen(reply, score, DEFAULTS)
  assert.equal(text, 'He pulls the chair out for you and sits down across the table. She crosses the room. The rain has stopped by the time you reach the car.')
})

test('the real model leaves a clean reply untouched', async () => {
  const reply = 'He sets the cup down and opens the window. She hands you the keys and gets in on the passenger side.'
  assert.equal((await redpen(reply, score, DEFAULTS)).text, reply)
})
