import 'dotenv/config'
import express from 'express'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Server } from 'socket.io'
import {
  db,
  createConversation,
  listConversations,
  ownConversation,
  renameConversation,
  touchConversation,
  deleteConversation,
  getRecentMessages,
  getMessageById,
  saveMessage,
  findAiReply,
  setAiContent,
  ownMessage,
  updateMessage,
  deleteMessage,
  getMessageImage,
  setFlag,
  setPinned,
  getPinned,
  searchMessages,
  getUserById,
  getUserAvatar,
  setUserAvatar,
} from './db.js'
import { authRouter, requireAuth, verifyToken } from './auth.js'
import { streamAiReply, moderateText, suggestFollowUps, translateText } from './ai.js'

const PORT = process.env.PORT || 4000
// Frontend address(es) allowed to call this server, comma separated. Example: https://odyra.vercel.app
const ALLOWED_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean)

// Pictures arrive as small, already-compressed data URLs from the browser
const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/
const MAX_MESSAGE_IMAGE = 700_000
const MAX_AVATAR = 150_000
const isImage = (value, max) => typeof value === 'string' && value.length <= max && IMAGE_RE.test(value)

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS }, maxHttpBufferSize: 2e6 })

// Behind a host's proxy (Render, Railway...) the real client IP comes from X-Forwarded-For,
// which the rate limiter needs in order to count each visitor separately
app.set('trust proxy', 1)

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'], // blob: is used while resizing pictures in the browser
        connectSrc: ["'self'", 'ws:', 'wss:'], // Socket.IO
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  }),
)
app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json({ limit: '400kb' }))

// Every live event goes only to the sockets of the account it belongs to
const userRoom = (userId) => `user:${userId}`

// Simple per-user rate limiter: allow(bucket, userId, max) permits `max` calls per minute
const buckets = new Map()
function allow(bucket, userId, max) {
  const key = `${bucket}:${userId}`
  const now = Date.now()
  const recent = (buckets.get(key) || []).filter((t) => now - t < 60_000)
  if (recent.length >= max) return false
  recent.push(now)
  buckets.set(key, recent)
  return true
}
const AI_LIMIT_MESSAGE = 'You are sending messages very fast. Please wait a few seconds and try again.'
const aiAllowed = (userId) => allow('ai', userId, 12)

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 50 }), authRouter)

function sendDataUrl(res, dataUrl, cacheControl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '')
  if (!match) return res.status(404).end()
  res.set({ 'Content-Type': match[1], 'Cache-Control': cacheControl })
  res.send(Buffer.from(match[2], 'base64'))
}

// ---------- Account ----------

app.get('/api/me', requireAuth, (req, res) => {
  const me = getUserById(req.user.id)
  if (!me) return res.status(401).json({ error: 'Please sign in again.' })
  res.json(me)
})

app.put('/api/me/avatar', requireAuth, (req, res) => {
  const image = req.body?.image ?? null
  if (image !== null && !isImage(image, MAX_AVATAR)) {
    return res.status(400).json({ error: 'Please choose a JPEG, PNG or WebP image.' })
  }
  const v = setUserAvatar(req.user.id, image)
  io.to(userRoom(req.user.id)).emit('avatar:updated', { v })
  res.json({ avatarV: v })
})

// Your own profile picture. <img> cannot send headers, so the token comes as ?t=
app.get('/api/avatar', (req, res) => {
  const user = verifyToken(String(req.query.t || ''))
  if (!user) return res.status(401).end()
  sendDataUrl(res, getUserAvatar(user.id), 'private, max-age=31536000, immutable')
})

// A picture from one of YOUR messages. Anyone else gets a 404.
app.get('/api/image/:id', (req, res) => {
  const user = verifyToken(String(req.query.t || ''))
  if (!user) return res.status(401).end()
  const id = Number(req.params.id)
  if (!ownMessage(user.id, id)) return res.status(404).end()
  sendDataUrl(res, getMessageImage(id), 'private, max-age=86400')
})

// ---------- Conversations (always scoped to the signed-in user) ----------

app.get('/api/conversations', requireAuth, (req, res) => res.json(listConversations(req.user.id)))

app.post('/api/conversations', requireAuth, (req, res) => {
  const conversation = createConversation(req.user.id)
  io.to(userRoom(req.user.id)).emit('conversations:changed')
  res.json(conversation)
})

app.patch('/api/conversations/:id', requireAuth, (req, res) => {
  const conversation = ownConversation(req.user.id, Number(req.params.id))
  const title = String(req.body?.title || '')
    .trim()
    .slice(0, 60)
  if (!conversation) return res.status(404).json({ error: 'Chat not found.' })
  if (!title) return res.status(400).json({ error: 'Please type a name.' })
  renameConversation(conversation.id, title)
  io.to(userRoom(req.user.id)).emit('conversations:changed')
  res.json({ ok: true })
})

app.delete('/api/conversations/:id', requireAuth, (req, res) => {
  const conversation = ownConversation(req.user.id, Number(req.params.id))
  if (!conversation) return res.status(404).json({ error: 'Chat not found.' })
  deleteConversation(conversation.id)
  io.to(userRoom(req.user.id)).emit('conversations:changed')
  res.json({ ok: true })
})

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const conversation = ownConversation(req.user.id, Number(req.params.id))
  if (!conversation) return res.status(404).json({ error: 'Chat not found.' })
  res.json({ messages: getRecentMessages(conversation.id, 300), pinned: getPinned(conversation.id) })
})

// Search across all of the signed-in user's chats
app.get('/api/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2 || q.length > 50) return res.json([])
  res.json(searchMessages(req.user.id, q))
})

// ---------- AI helpers ----------

const LANGUAGES = {
  english: 'English',
  urdu: 'Urdu',
  hindi: 'Hindi',
  'roman-urdu': 'Roman Urdu (Urdu written with English letters)',
}

app.post('/api/translate', requireAuth, async (req, res) => {
  const language = LANGUAGES[req.body?.language]
  const owned = ownMessage(req.user.id, Number(req.body?.messageId))
  const message = owned && getMessageById(owned.id)
  if (!language || !message?.content) return res.status(400).json({ error: 'Nothing to translate.' })
  if (!allow('translate', req.user.id, 20)) {
    return res.status(429).json({ error: 'Too many translations. Try again in a minute.' })
  }
  try {
    res.json({ translation: await translateText(message.content, language) })
  } catch (err) {
    console.error('Translate failed:', err.message)
    res.status(502).json({ error: 'Translation is unavailable right now.' })
  }
})

app.post('/api/suggest', requireAuth, async (req, res) => {
  const conversation = ownConversation(req.user.id, Number(req.body?.conversationId))
  if (!conversation) return res.status(404).json({ error: 'Chat not found.' })
  if (!allow('suggest', req.user.id, 10)) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' })
  }
  try {
    const history = getRecentMessages(conversation.id, 12)
    res.json({ suggestions: await suggestFollowUps({ history }) })
  } catch (err) {
    console.error('Suggest failed:', err.message)
    res.status(502).json({ error: 'Suggestions are unavailable right now.' })
  }
})

// ---------- Real-time layer ----------

io.use((socket, next) => {
  const user = verifyToken(socket.handshake.auth?.token)
  // Reject tokens for accounts that no longer exist (for example after the database was reset)
  if (!user || !getUserById(user.id)) return next(new Error('unauthorized'))
  socket.data.user = user
  next()
})

// A short, friendly reason shown under the message when the AI service fails
function explainAiError(err) {
  const status = err?.status
  if (status === 401 || status === 403) return 'The AI key was rejected. Check AI_API_KEY in server/.env.'
  if (status === 404) return 'The AI model is not available. Check AI_MODEL in server/.env.'
  if (status === 429 && /request too large/i.test(err?.message || '')) {
    return 'The reply size is above your free AI limit. Lower AI_MAX_TOKENS in server/.env (try 600).'
  }
  if (status === 429) return 'The AI service is busy or the free limit was reached. Wait a minute and try again.'
  if (/connection|fetch failed|ENOTFOUND|ECONNREFUSED/i.test(`${err?.code || ''} ${err?.message || ''}`)) {
    return 'Could not reach the AI service. Check your internet connection.'
  }
  return 'The AI could not answer right now.'
}

// Streams the assistant's answer to this user's sockets.
// triggerId: the user message being answered. replaceId: an existing AI reply to rewrite in place.
async function runAi(user, conversationId, { triggerId = null, replaceId = null, instruction = null } = {}) {
  const channel = userRoom(user.id)
  const tempId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  io.to(channel).emit('ai:start', { tempId, conversationId, replaceId, triggerId })
  try {
    // Only this conversation's messages (up to the one being answered) are sent to the AI
    const messages = getRecentMessages(conversationId, 30, triggerId)
    const withPicture = new Set(
      messages
        .filter((m) => m.hasImage)
        .slice(-3)
        .map((m) => m.id),
    )
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
      hasImage: m.hasImage,
      image: withPicture.has(m.id) ? getMessageImage(m.id) : null,
    }))

    const full = await streamAiReply({
      username: user.username,
      history,
      instruction,
      onText: (text) => io.to(channel).emit('ai:chunk', { tempId, text }),
    })
    const content = full || '(no reply)'
    const saved = replaceId
      ? setAiContent(replaceId, content)
      : saveMessage({ conversationId, role: 'ai', content, replyTo: triggerId })
    touchConversation(conversationId)
    io.to(channel).emit('ai:end', { tempId, replaceId, message: saved })
    io.to(channel).emit('conversations:changed')
  } catch (err) {
    console.error('AI error:', err.status ?? '', err.message)
    io.to(channel).emit('ai:failed', { tempId, conversationId, triggerId, replaceId, reason: explainAiError(err) })
  }
}

// Optional AI moderation of your own messages (off by default). Turn on with MODERATION=on in server/.env
const moderationOn = process.env.MODERATION === 'on'
const moderationCalls = []
async function moderate(user, message) {
  if (!moderationOn || !message || message.isAi || (message.content || '').length < 4) return
  const now = Date.now()
  while (moderationCalls.length && now - moderationCalls[0] > 60_000) moderationCalls.shift()
  if (moderationCalls.length >= 20) return // keep API quota free for the assistant
  moderationCalls.push(now)
  try {
    const verdict = await moderateText(message.content)
    if (!verdict.flag) return
    setFlag(message.id, verdict.reason)
    const updated = getMessageById(message.id)
    if (updated) io.to(userRoom(user.id)).emit('message:updated', updated)
  } catch (err) {
    console.error('Moderation skipped:', err.message)
  }
}

io.on('connection', (socket) => {
  const { user } = socket.data
  const channel = userRoom(user.id)
  socket.join(channel)

  const tooFast = () => {
    socket.emit('chat:error', { message: AI_LIMIT_MESSAGE })
    return true
  }

  // The user sends a message; the AI always answers it
  socket.on('chat:send', async ({ conversationId, content, image } = {}, ack) => {
    try {
      const conversation = ownConversation(user.id, conversationId)
      if (!conversation) return ack?.({ error: 'Chat not found.' })

      const text = String(content || '')
        .trim()
        .slice(0, 2000)
      const picture = isImage(image, MAX_MESSAGE_IMAGE) ? image : null
      if (!text && !picture) return ack?.({ error: 'Type a message or attach a picture.' })
      if (!aiAllowed(user.id)) return ack?.({ error: AI_LIMIT_MESSAGE })

      const message = saveMessage({ conversationId: conversation.id, role: 'user', content: text, image: picture })
      if (conversation.title === 'New chat') {
        renameConversation(conversation.id, (text || 'Picture').replace(/\s+/g, ' ').slice(0, 40))
      }
      touchConversation(conversation.id)
      io.to(channel).emit('message:new', message)
      io.to(channel).emit('conversations:changed')
      ack?.({ ok: true })

      moderate(user, message)
      await runAi(user, conversation.id, { triggerId: message.id })
    } catch (err) {
      console.error('chat:send failed:', err.message)
      ack?.({ error: 'Something went wrong. Please try again.' })
    }
  })

  // Editing your message regenerates the AI answer to it, in place
  socket.on('message:edit', async ({ id, content } = {}) => {
    try {
      const text = String(content || '')
        .trim()
        .slice(0, 2000)
      const owned = ownMessage(user.id, id)
      if (!text || !owned || owned.role !== 'user') return
      if (!aiAllowed(user.id)) return tooFast()

      const updated = updateMessage(id, text)
      io.to(channel).emit('message:updated', updated)
      moderate(user, updated)
      const previous = findAiReply(id)
      await runAi(user, owned.conversation_id, { triggerId: id, replaceId: previous?.id ?? null })
    } catch (err) {
      console.error('message:edit failed:', err.message)
    }
  })

  // Ask the AI to answer a message again (used by "Try again" and "Regenerate")
  socket.on('ai:retry', async ({ id } = {}) => {
    try {
      const owned = ownMessage(user.id, id)
      if (!owned || owned.role !== 'user') return
      if (!aiAllowed(user.id)) return tooFast()
      const previous = findAiReply(id)
      await runAi(user, owned.conversation_id, { triggerId: id, replaceId: previous?.id ?? null })
    } catch (err) {
      console.error('ai:retry failed:', err.message)
    }
  })

  socket.on('chat:summarize', async ({ conversationId } = {}) => {
    try {
      const conversation = ownConversation(user.id, conversationId)
      if (!conversation) return
      if (!aiAllowed(user.id)) return tooFast()
      await runAi(user, conversation.id, {
        instruction: 'Summarize our conversation so far in 3-5 short bullet points.',
      })
    } catch (err) {
      console.error('chat:summarize failed:', err.message)
    }
  })

  // Deleting your message also removes the AI answer to it
  socket.on('message:delete', ({ id } = {}) => {
    const owned = ownMessage(user.id, id)
    if (!owned) return
    const ids = [id]
    if (owned.role === 'user') {
      const reply = findAiReply(id)
      if (reply) ids.push(reply.id)
    }
    for (const messageId of ids) {
      deleteMessage(messageId)
      io.to(channel).emit('message:deleted', { id: messageId, conversationId: owned.conversation_id })
    }
  })

  // Pin up to 10 messages per chat
  socket.on('message:pin', ({ id, pinned } = {}) => {
    const owned = ownMessage(user.id, id)
    if (!owned) return
    if (pinned && getPinned(owned.conversation_id).length >= 10) {
      return socket.emit('chat:error', { message: 'You can pin up to 10 messages per chat.' })
    }
    setPinned(id, !!pinned)
    io.to(channel).emit('message:updated', getMessageById(id))
  })
})

// In production the same server also serves the built React app (run `npm run build` first),
// so the whole project runs as ONE service with no CORS setup.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist')
if (fs.existsSync(clientDist)) {
  // index.html must never be cached (after a new deploy it points to new, differently named files);
  // the hashed files in /assets can be cached for a long time
  app.use(
    express.static(clientDist, {
      maxAge: '1y',
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
  console.log('Serving the built client from', clientDist)
}

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
