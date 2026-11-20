# Odyra: a private AI chat app

Odyra is a private AI chat app: each person signs in to their own account and chats
privately with an AI assistant. Nobody else can see your chats, pictures or profile photo.

**Live demo:** _add your Render link here after deploying_ (the first load can take about a minute while the free server wakes up)

## Features

- **Private by design:** every chat belongs to one account, and the server checks ownership on every request
- Multiple chats per user, auto-named from your first message, with rename and delete
- Streaming AI replies (words appear as they are generated) and picture understanding (attach a photo and ask about it)
- Edit a message to get a fresh answer, regenerate or retry an answer, copy answers
- Translate any message (English, Urdu, Hindi, Roman Urdu), smart "what to ask next" suggestions
- Pin important messages, search across all your chats, summarize a chat
- Profile photo, emoji picker, dark mode, responsive layout
- One-click guest accounts, so anyone can try the app without signing up
- Security basics: bcrypt passwords, JWT sessions, Helmet headers, rate limits, input validation

## Tech stack

React 18 + Vite, Node.js + Express, Socket.IO, SQLite (better-sqlite3), OpenAI-compatible LLM API (Groq)

## Run it locally

Requires Node.js 18+.

```bash
npm run install:all
cp server/.env.example server/.env   # then edit server/.env
npm run dev
```

Open http://localhost:5173 and create an account.

In `server/.env`, set `JWT_SECRET` to a long random string and `AI_API_KEY` to a key from
https://console.groq.com/keys. For pictures to work, `AI_MODEL` must be a vision model
(see https://console.groq.com/docs/vision). Model names change often.

Optional settings in `server/.env`:

- `AI_VISION_MODEL`: model used when a picture is attached (defaults to `AI_MODEL`)
- `AI_MAX_TOKENS` (default 700): longest reply. Free plans cap how many tokens a model may write per minute,
  so keep this under that limit. If you see a 429 "Request too large" error, lower it
- `AI_FAST_MODEL`: a smaller model for translate and suggestions
- `AI_REASONING_EFFORT`: `low`, `medium` or `high` for reasoning models such as `openai/gpt-oss-20b`
- `MODERATION=on`: AI check that flags abusive messages (off by default)

When the AI service says "too many requests", the server waits the time it asks for and retries automatically.

## How privacy is enforced

- Chats and messages live in `conversations` / `chat_messages` tables, each tied to a `user_id`
- Every REST route and socket event looks up the chat or message *through the signed-in user*; other accounts get "not found"
- Live updates are sent only to the sockets of the account that owns them
- Pictures are served from URLs that check the owner, and profile photos only to their owner
- Search runs only over your own chats
```
```
