# YouTube Digest Learning

> A learning-focused community edition based on [YouTube Digest](https://github.com/zarazhangrui/youtube-digest) by Zara Zhang. Version 1.4.3 builds a complete watch, understand, shadow, collect, review, and deep-reading workflow around real YouTube videos.

This project preserves the upstream MIT License and copyright notice. It is an independent derivative project and is not an official release of the original author.

[English](README.md) | [简体中文](README.zh-CN.md)

Turn every YouTube video into a resource for deep learning. YouTube Digest Learning brings transcripts, bilingual translation, AI overviews, explanations, vocabulary, exports, and timestamped notes into one Chrome side panel, so you can study ideas and language without losing your place.

## Added in this learning edition

- Automatically select and highlight level-appropriate vocabulary, collocations, natural expressions, and memorable sentences using the learner's learning, fuzzy, and mastered history.
- Show compact in-player subtitles in highlighted English, Chinese, or highlighted bilingual mode, synchronized with playback.
- Loop the current sentence for shadowing, move between sentences, and choose a 0.8, 1.5, or 2.5 second speaking gap.
- Save selected words and phrases locally and highlight them when they reappear in other videos.
- Show part of speech, UK and US IPA, and one-tap English pronunciation for words; keep phrases grounded in their original sentence without redundant IPA.
- Lead with English definitions, keep Chinese support collapsed until requested, and retain personal notes, original context, sources, and encounter counts.
- Review locally with four recall ratings and spaced scheduling.
- Limit each day to 10 new items and 20 reviews; overflow is deferred without being lost.
- Export the vocabulary notebook as CSV.
- Export original, Simplified Chinese, or bilingual transcripts as printable HTML, Markdown, or plain text.
- Generate a printable intensive-reading PDF with bilingual transcript, UK and US IPA, personalized vocabulary, natural phrases, key sentences, ideas, questions, and speaking practice.
- Reuse cached transcript, translation, and intensive-reading results when reopening the same video to reduce duplicate API requests.
- Preview a video through an AI overview in English, Simplified Chinese, or an aligned bilingual view without paying for another request when switching languages.

## Version 1.4.3

- Added part of speech, UK and US IPA, and one-tap English pronunciation to word cards in Words.
- Added concise contextual English definitions to smart-highlighted words and phrases, with Chinese support collapsed by default.
- Extended review cards with pronunciation, IPA, English definitions, original context, and optional Chinese help.
- Extended vocabulary CSV export with part of speech, IPA, English definitions, and Chinese meanings.
- Kept phrase learning focused on English definitions and original sentences without unnecessary phrase-level IPA.

## Version 1.4.2

- Added a quick pre-viewing summary and English, Simplified Chinese, and bilingual Overview modes.
- Generate both Overview languages together and cache them locally, so language switching does not trigger another DeepSeek request.
- Completed synchronized in-player subtitles in three display modes.
- Added sentence-loop shadowing with adjustable speaking gaps.
- Added personalized smart reading and intensive-reading PDF export.
- Added an adaptive vocabulary profile, cross-video highlighting, and a local vocabulary notebook.
- Added spaced review with daily limits of 10 new items and 20 reviews.
- Fixed translation JSON handling and YouTube dynamic-layout integration issues.

## Features inherited from the upstream project

- Turn native YouTube captions into a readable, searchable transcript.
- View the original transcript, a Simplified Chinese translation, or an aligned bilingual view.
- Generate AI overviews, chapters, key quotes, and selected-text explanations.
- Navigate long videos by clicking timestamps in the transcript, overview, or notes.
- Save polished timestamped notes for later study.
- Keep control of your data with your own API keys, local Chrome storage, and no analytics or telemetry.

YouTube Digest is a bring-your-own-key project installed locally from GitHub. It is not available through the Chrome Web Store, does not include API credits, and does not run a developer-operated server.

## Install with your coding agent

You do not need to understand the code or use the command line. Send this message to your coding agent:

> Download or clone this project into a permanent folder I choose, tell me its exact full path, and use that same folder for Chrome's Load unpacked step. If I need a suggestion during this first installation, offer `~/Documents/youtube-digest-learning` on macOS or Linux, or `%USERPROFILE%\Documents\youtube-digest-learning` on Windows, but do not assume either path. Walk me through installation and setup in simple terms. https://github.com/danniezhang200-ship-it/youtube-digest-learning

Your agent should:

1. Ask where you want to keep the project, download or clone it there, and tell you the exact full path. If you want a suggestion, it can offer `~/Documents/youtube-digest` on macOS or Linux, or `%USERPROFILE%\Documents\youtube-digest` on Windows.
2. Open the official DeepSeek page below and help you create your own account.
3. Walk you through selecting the exact project folder you chose in Chrome with **Load unpacked**.
4. Show you where to enter your DeepSeek API key in the extension's **Settings** page.
5. Open a YouTube video with captions and confirm the transcript and translation work.

Keep this folder in the same place after installation. If you move or delete it, Chrome's unpacked extension stops working until you load the extension again from its new permanent folder.

Never paste an API key into an AI chat, source file, screenshot, or public message. Enter keys yourself, directly in the YouTube Digest Settings page. Your coding agent can point to the correct field without seeing the key.

## Install manually

If you prefer to do it yourself:

1. Open [github.com/danniezhang200-ship-it/youtube-digest-learning](https://github.com/danniezhang200-ship-it/youtube-digest-learning).
2. Choose **Code**, then **Download ZIP**.
3. Choose a permanent folder and unzip the project there. Optional suggestions are `~/Documents/youtube-digest` on macOS or Linux, or `%USERPROFILE%\Documents\youtube-digest` on Windows. You may use a different folder.
4. In Chrome, open `chrome://extensions`.
5. Turn on **Developer mode**.
6. Click **Load unpacked**.
7. Select the exact project folder you chose, which must contain `manifest.json`.
8. Pin YouTube Digest from Chrome's Extensions menu if you want quick access.

Because this is an unpacked extension, it does not update automatically. After downloading an update or changing local files, click **Reload** on the YouTube Digest card at `chrome://extensions`, then refresh open YouTube tabs. Moving or deleting the source folder breaks the unpacked extension until you load it again from the new location.

## Set up your API key

YouTube Digest needs one key under your own provider account:

1. A **DeepSeek API key** for overviews, explanations, translation, and automatic note polishing.

Transcripts do not need a key. They are read from YouTube's own caption track in the video tab you already have open.

### Get a DeepSeek API key

1. Open the official [DeepSeek API Keys page](https://platform.deepseek.com/api_keys).
2. Sign in or create a DeepSeek Platform account when prompted.
3. Choose **Create new API key**, give it a recognizable name such as `YouTube Digest`, and create it.
4. Copy the key immediately. The full key may only be shown once.
5. Paste it into **DeepSeek API key** in YouTube Digest Settings.
6. If DeepSeek reports insufficient balance, add credit in your DeepSeek Platform account and try again.

See the [official DeepSeek API documentation](https://api-docs.deepseek.com/) for current account and API details.

Open **Settings** from the side panel. You can also open the YouTube Digest **Options** page from its card at `chrome://extensions` or by right-clicking its toolbar icon. Paste keys only into these Settings fields. Never paste a key into an AI chat, repository file, screenshot, or public message.

The published version supports DeepSeek V4 Flash as its only AI provider:

```text
Base URL: https://api.deepseek.com
Model: deepseek-v4-flash
```

YouTube Digest sends every DeepSeek request in non-thinking mode for responsive, predictable interactions. The endpoint and model are fixed in Settings, so the only AI credential you enter is your DeepSeek API key. To use another provider or model, copy the safe customization prompt in Settings and give it to a coding agent for your local copy. Never add an API key to that prompt or chat.

Keys and settings are stored in Chrome's local extension storage on your device. Release builds do not include or use `config.js`.

## Use YouTube Digest

1. Open a standard YouTube watch page with captions.
2. Click the YouTube Digest extension icon to open the side panel.
3. Read the timestamped transcript, or choose **Original**, **中文**, or **双语**.
4. Open **Overview** for a quick summary, chapters, and key quotes, then choose **English**, **中文**, or **双语**.
5. Select transcript text when you want an AI explanation.
6. Save a note from the player or a key quote, then revisit it from **Notes**.

### Recommended learning workflow

1. Start with highlighted English subtitles and focus on understanding without pausing too often.
2. Open a highlight when an item is genuinely worth learning, then confirm it into the vocabulary notebook.
3. Use sentence shadowing for important lines and imitate pronunciation, stress, pauses, and tone during the speaking gap.
4. Complete up to 10 new items and 20 reviews in **Words**; recall results keep tuning future highlights.
5. Generate an intensive-reading PDF for videos worth printing, retelling, and studying deeply.

## What works today

- Google Chrome 116 or newer, using the Side Panel API.
- Standard `youtube.com/watch` video pages.
- Native YouTube subtitle tracks, read directly from the open video tab. YouTube Digest prefers English when available, but may show another native language.
- Original, Simplified Chinese, and aligned bilingual transcript views.
- Compact synchronized in-player English, Chinese, and bilingual subtitles.
- Sentence-loop shadowing, previous/next sentence controls, and adjustable speaking gaps.
- Personalized vocabulary and expression highlighting with an adaptive learning profile.
- A local vocabulary notebook, spaced review, and daily learning limits.
- Printable intensive-reading PDF export.
- AI overviews, selected-text explanations, translation, and automatic note polishing.
- Local notes and a local cache for recent transcript and digest results.
- DeepSeek V4 Flash for all published AI features. Other providers require a local code adaptation and are not supported by this published version.

Shorts, live streams, private or access-restricted videos, and videos without an available native transcript may not work. Firefox, Safari, mobile browsers, and other Chromium browsers are not currently tested or supported.

YouTube Digest never requests AI-generated transcripts and never transcribes audio locally. When a video has no native captions, it says so instead.

## How transcripts are read

The extension's content script, which already runs on the watch page, asks the player for the video's caption track and downloads the timestamped subtitles from YouTube itself. This costs nothing and needs no key. Keep the video tab open while the transcript loads.

Both sources hand back the same payload, the one Supadata's API returns, so everything downstream reads one structure and neither source can drift from the other.

When that caption request comes back empty even though the video has subtitles, YouTube Digest falls back to opening YouTube's own **Show transcript** panel and reading it. The side panel reports live progress while it works, and long videos can take up to a minute.

A transcript is fetched at most once per video. The result is saved locally as soon as it succeeds, so reopening the same video reuses it instead of reading the page again. Cached transcripts expire after 7 days, the 10 most recent are kept, and **Clear cached digests** in Settings removes them.

## Optional Supadata fallback

Supadata is a paid service that parses YouTube's internals on its own servers. It is **off by default** and only runs when both conditions hold:

1. You tick **Use the paid Supadata service when YouTube's captions cannot be read** in Settings.
2. You save a Supadata API key in the same section.

To enable it, open the [Supadata sign-up page](https://dash.supadata.ai/auth/sign-up), complete onboarding, then copy the generated key from the [Supadata dashboard](https://dash.supadata.ai/) into YouTube Digest Settings. See the [official Supadata documentation](https://docs.supadata.ai/) if the dashboard flow changes.

Current as of August 9, 2026, the [Supadata pricing page](https://supadata.ai/pricing) lists a free tier with **100 credits per month**, no credit card required. Unused credits do not roll over. Supadata pricing can change, so check the current page before relying on these numbers.

The [Supadata transcript documentation](https://docs.supadata.ai/get-transcript) describes the transcript request modes and credit behavior:

- A native transcript request uses **1 credit**, regardless of video duration.
- A generated transcript costs **2 credits per video minute**. YouTube Digest does not use this path because it forces `mode=native`.
- An unavailable native lookup returned as HTTP `206` still uses **1 credit**.

Because the fallback only fires after YouTube's own captions fail, most videos never spend a credit. Set a spending limit and monitor the account anyway.

DeepSeek usage is separate. DeepSeek may apply its own free quota, rate limits, or charges. YouTube Digest does not collect payments or resell access. The estimate below explains the current DeepSeek translation cost.

## Transcript translation

Chrome's built-in translator is the default. It runs a model on your device, so translating a transcript costs nothing, needs no API key, and works offline. It requires Chrome 138 or newer and downloads the language pack once, which the side panel reports while it happens.

You can switch **Transcript translation** to DeepSeek in Settings. DeepSeek reads a whole batch in context, which reads better on idioms and technical wording, at the token cost estimated below. A failed browser translation is never retried against DeepSeek automatically: spending tokens you did not ask to spend would defeat the free default. If Chrome's translator is unavailable, the side panel says so and points at the setting.

## DeepSeek V4 Flash translation cost estimate

The estimate below applies only when you switch transcript translation to DeepSeek.

Current as of August 10, 2026, DeepSeek lists the following prices per 1 million tokens on its official [pricing page](https://api-docs.deepseek.com/quick_start/pricing/):

- Cache-hit input: **$0.0028 USD**.
- Cache-miss input: **$0.14 USD**.
- Output: **$0.28 USD**.

DeepSeek says these prices may increase soon, so check the current pricing page before relying on this estimate. Its official [token usage guide](https://api-docs.deepseek.com/quick_start/token_usage/) estimates about 0.3 token per English character and about 0.6 token per Chinese character. Its [context caching guide](https://api-docs.deepseek.com/guides/kv_cache/) explains the automatic best-effort disk cache used for repeated prefixes.

A measured 20-minute English talk contained **2,935 spoken English words** and 15,433 transcript characters. With YouTube Digest's current grouping, it became 128 semantic segments and 43 requests of three segments each. Repeated prompts and JSON brought the rendered input to about 108,528 English characters, or **about 32,600 input tokens** using DeepSeek's 0.3 token per English character heuristic. The translated Chinese JSON output is estimated at about 3,500 to 4,500 tokens using the 0.6 token per Chinese character heuristic, plus JSON and ID overhead.

If all input is billed as cache miss, input costs about $0.0046 and output costs about $0.0010 to $0.0013, for a total of about $0.0056 to $0.0059. When much of the repeated system prompt hits DeepSeek's automatic best-effort cache, a realistic lower end is about $0.002 to $0.003. A practical estimate for fully translating this talk is therefore **$0.002 to $0.006 USD, about ¥0.02 to ¥0.04**.

Translation is lazy and progressive. Cached segments are reused, and only rows you request by scrolling into them incur calls. Retries, provider behavior, and pricing changes can increase the final cost.

## Remix it with your coding agent

This is a personal remix project. Upstream issues and pull requests are not accepted. If something breaks or you want a new feature, download or fork your own copy and ask your coding agent to fix, remix, or personalize it for you.

YouTube Digest uses plain HTML, CSS, and JavaScript with no build step, so it is a friendly starting point for agent-assisted projects. Ideas to try:

- Add more translation languages and let each person choose a learning language.
- Create customized summary templates for lectures, interviews, tutorials, reviews, or research talks.
- Build a vocabulary notebook that saves a word, its sentence, meaning, and video timestamp.
- Export notes and vocabulary to Markdown, CSV, Anki, or another study tool.
- Add personal topic filters that highlight the chapters most relevant to a goal.
- Add optional local-model support for a different privacy and cost tradeoff.
- Improve accessibility with keyboard navigation, font controls, and higher-contrast themes.

Ask your agent to preserve the bring-your-own-key model, keep secrets out of source files, run the checks below, and test the remix on real videos.

If you want another AI provider or model, first open the exact YouTube Digest project folder that Chrome loaded through **Load unpacked** in your coding agent. Then open YouTube Digest Settings and use **Copy customization prompt**. Replace the `[PROVIDER]` and `[MODEL]` placeholders before sending it. Do not include any API key in the prompt or chat. After the agent updates your local copy, enter the key yourself in the Settings field it identifies.

## Privacy and data flow

YouTube Digest makes provider requests directly from the extension:

1. It reads the transcript from the YouTube page you already have open. No third party is involved.
2. It sends the transcript and relevant video metadata to DeepSeek when you request AI features.
3. Focused features send only the content they need, such as selected text with context or small transcript batches for translation.
4. It stores keys, settings, notes, and recent cache entries locally in Chrome.
5. It sends a canonical YouTube watch URL to Supadata only if you enabled the optional fallback and YouTube's own captions could not be read.

There is no YouTube Digest account system, advertising, analytics, or telemetry. DeepSeek, and Supadata when you enable it, still receive data under their own terms and privacy policies. See [PRIVACY.md](PRIVACY.md) for details.

## Troubleshooting

### The Digest button is missing on a YouTube video

- At `chrome://extensions`, find YouTube Digest and click **Reload**, then refresh the YouTube tab.
- Confirm that you are on a standard `https://www.youtube.com/watch?...` page, not a Short, embed, or live page.
- The current version automatically follows YouTube when its responsive action bar changes. Wait a moment after the page finishes loading.
- If you have an older downloaded copy, resizing the YouTube window horizontally once may reveal the button. Then download the latest version so resizing is no longer required.
- If it is still missing, ask your coding agent to inspect the content script on that exact video page.

### The side panel does not open

- Confirm that you are on a standard `https://www.youtube.com/watch?...` page.
- At `chrome://extensions`, confirm YouTube Digest is enabled and click **Reload**.
- Refresh the YouTube tab after reloading the extension.
- Ask your coding agent to inspect the extension if the problem continues.

### YouTube Digest asks for setup

- Open **Settings** and save a DeepSeek key. Transcripts need no key.
- This published version uses the fixed DeepSeek V4 Flash endpoint and model. There are no Base URL or Model fields to configure.
- If Settings says a legacy custom provider was removed, enter a DeepSeek key. The old AI key was cleared so it could not be reused with the wrong service.

### No transcript is found

- Confirm the video is public and has native captions.
- Keep the YouTube video tab open. The transcript is read from that page, so a closed or navigated-away tab reports "YouTube tab needed".
- If the panel says the transcript panel did not open, click **Show transcript** under the video yourself, then try again.
- If you enabled the optional Supadata fallback, check its key, remaining credits, rate limit, and account status. Unavailable lookups and manual retries still consume credits.

YouTube Digest will not fall back to generated transcription.

### AI requests fail

- A `401` or `403` usually means the DeepSeek key or account access is invalid.
- A `429` usually means a DeepSeek rate or spending limit was reached.
- Confirm the key was created in the DeepSeek Platform account linked above and that the account has available credit.
- If you adapted a local copy for another model, use the Settings customization prompt again and ask your coding agent to inspect that local implementation.

Never share API keys, private transcripts, or personal notes in chats, screenshots, or logs.

## Checks for coding agents

Ask your coding agent to run these commands after changing the project:

```bash
npm test
npm run check
npm run package
```

The agent should also reload the unpacked extension in Chrome and test several real YouTube videos. Automated checks do not prove that live provider requests and YouTube interactions work.

## License

MIT. See [LICENSE](LICENSE).
