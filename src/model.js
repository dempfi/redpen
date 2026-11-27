import { pieces } from './cut.js'

export const MODEL = 'dempfi/redpen-slop-11m'
const MAX_TOKENS = 128

export async function loadScorer(transformers, { model = MODEL, onProgress } = {}) {
  const { AutoTokenizer, AutoModelForTokenClassification, Tensor } = transformers
  const tokenizer = await AutoTokenizer.from_pretrained(model)
  const network = await AutoModelForTokenClassification.from_pretrained(model, { dtype: 'fp32', progress_callback: onProgress })
  const [cls, sep] = tokenizer.encode('')
  const tensor = values => new Tensor('int64', BigInt64Array.from(values, BigInt), [1, values.length])

  return async text => {
    const found = pieces(text)
    const ids = [cls]
    const owner = [-1]
    for (const [index, piece] of found.entries()) {
      const sub = tokenizer.encode(piece.text, { add_special_tokens: false })
      if (ids.length + sub.length > MAX_TOKENS - 1) break
      for (const id of sub) {
        ids.push(id)
        owner.push(index)
      }
    }
    ids.push(sep)
    owner.push(-1)

    const { logits } = await network({
      input_ids: tensor(ids),
      attention_mask: tensor(ids.map(() => 1)),
      token_type_ids: tensor(ids.map(() => 0)),
    })
    const probs = found.map(() => 0)
    for (let token = 0; token < ids.length; token++) {
      if (owner[token] < 0) continue
      const clean = logits.data[token * 2]
      const slop = logits.data[token * 2 + 1]
      probs[owner[token]] = Math.max(probs[owner[token]], 1 / (1 + Math.exp(clean - slop)))
    }
    return found.map((piece, index) => ({ ...piece, prob: probs[index] }))
  }
}
