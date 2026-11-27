<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png">
  <img src="assets/banner-light.png" alt="Redpen, a linter for LLM prose. The sentence “He lets out a breath he didn't know he was holding.” is underlined in red and scored SLOP 1.00.">
</picture>

# Redpen

Redpen reads every reply your model writes and cuts the slop out of it before you see it. It works in SillyTavern as an extension, and in JanitorAI or any other OpenAI-compatible frontend as a proxy. *Her breath hitches.* is gone. *He sets the cup down, jaw tight.* becomes *He sets the cup down.*

It only cuts. It never rewrites a word, never calls an LLM, and never touches your own messages.

The model behind it is [Redpen Slop 11M](https://huggingface.co/dempfi/redpen-slop-11m), an 11M-parameter token classifier. It runs on your own machine, in the browser or on your SillyTavern server, so nothing you write goes to a third party.

## SillyTavern

1. In SillyTavern, open **Extensions** and choose **Install extension**.
2. Paste `https://github.com/dempfi/redpen` and install.
3. Open **Extensions → Redpen** to change the settings.

The model (44 MB) downloads once, on the first reply after install, and is cached by the browser.

### Run the model on the server

By default each browser runs the model itself. To run it once on your SillyTavern server, so phones and tablets do no model work and download nothing, install Redpen as a server plugin too:

1. Set `enableServerPlugins: true` in SillyTavern's `config.yaml`.
2. Clone this repo into SillyTavern's `plugins` folder and install it:

   ```sh
   cd SillyTavern/plugins
   git clone https://github.com/dempfi/redpen
   cd redpen && npm install --omit=dev
   ```

3. Restart SillyTavern.

The extension finds the plugin by itself and uses it. **Extensions → Redpen** shows where the model is running. Without the plugin, nothing changes: the extension keeps running the model in the browser.

## JanitorAI and other OpenAI-compatible frontends

JanitorAI has no extensions, but it lets you point a chat at a custom proxy. Redpen ships a small proxy that sits between JanitorAI and your model provider, asks the provider for the reply, cuts the slop, and hands the cleaned reply back.

```sh
git clone https://github.com/dempfi/redpen
cd redpen && npm install --omit=dev
REDPEN_UPSTREAM=https://openrouter.ai/api/v1 npm run proxy
```

`REDPEN_UPSTREAM` is your provider's OpenAI-compatible address. Then, in JanitorAI's **API Settings → Proxy**:

| Field | Value |
| --- | --- |
| Proxy URL | `http://localhost:8787/v1/chat/completions` |
| API key | Your provider's key. The proxy passes it through and never stores it. |
| Model | The model name your provider expects. |

The proxy has to be reachable from wherever JanitorAI makes the request. If `localhost` is refused, or you chat from a phone, put the proxy behind an HTTPS address of your own, for example with a tunnel.

Replies arrive all at once and not word by word, because Redpen needs the whole reply before it can cut. The same proxy works with any frontend that speaks the OpenAI chat API.

| Variable | Default | What it does |
| --- | --- | --- |
| `REDPEN_UPSTREAM` | none, required | Your provider's address. |
| `PORT` | 8787 | The port the proxy listens on. |
| `REDPEN_THRESHOLD` | 0.99 | Confidence needed to cut. |
| `REDPEN_MAX_CUT` | 0.3 | Most of a reply it may remove. |
| `REDPEN_CUT_SENTENCES` | on | Set to `0` to keep sentences that are all slop. |
| `REDPEN_CUT_TAILS` | on | Set to `0` to keep slop tails. |
| `REDPEN_SKIP_DIALOGUE` | on | Set to `0` to let it cut inside quotation marks. |

## What it cuts

Redpen makes two kinds of cut, and only when the model is confident:

| Cut | Before | After |
| --- | --- | --- |
| A sentence that is all slop | He takes the chair by the window. Her breath hitches. He opens the book. | He takes the chair by the window. He opens the book. |
| A slop tail after a comma or “and” | She crosses the room and stays there, chest heaving. | She crosses the room. |

Everything else stays as the model wrote it. A flagged phrase in the middle of a sentence is left alone, because removing it would mean rewriting the sentence.

## Settings

These are the SillyTavern extension's settings; the proxy takes the same ones as environment variables. The defaults are deliberately conservative. At the default confidence, 97% of what the model flags is slop.

| Setting | Default | What it does |
| --- | --- | --- |
| Cut slop from model replies | On | The master switch. |
| Confidence needed to cut | 0.99 | How sure the model must be. Lower it to cut more. |
| Remove a sentence when all of it is slop | On | The first kind of cut. |
| Trim a slop tail after a comma or “and” | On | The second kind of cut. |
| Never touch dialogue | On | Leaves anything inside quotation marks alone. |
| Most of a reply it may remove | 30% | A cap per reply. Redpen never empties a message. |
| Keep the original text with the message | On | Stores the uncut reply so **Restore the last cut message** can bring it back. |
| Show what was cut | On | A small notice listing each cut. |

Greetings and your own messages are never changed.

## Limits

- English only.
- Trained on fiction and roleplay prose.
- It trims; it does not improve. A reply that is slop from end to end mostly stays, because Redpen will not remove more than the cap.

## Development

```sh
npm install
npm test
```

The tests cover the cutting rules, the server plugin's routes and the proxy, and check the scoring against the PyTorch checkpoint.

## License

The extension is AGPL-3.0, like SillyTavern. The model weights are CC BY-NC 4.0.
