import { loadScorer } from '../src/model.js'

let scorer

export function nodeScorer() {
  scorer ??= import('@huggingface/transformers').then(loadScorer).catch(error => {
    scorer = undefined
    throw error
  })
  return scorer
}
