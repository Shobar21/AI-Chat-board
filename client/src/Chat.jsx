import { Fragment, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { api, session, API_BASE } from './api.js'
import { APP_NAME } from './config.js'
import { resizeImage } from './images.js'
import Markdown from './markdown.jsx'

const LANG_LABELS = { english: 'English', urdu: 'Urdu', hindi: 'Hindi', 'roman-urdu': 'Roman Urdu' }
const STARTERS = [
  'Explain how databases work in simple words',
  'Help me write a polite email to my teacher',
  'Give me 5 project ideas for my CV',
  'Explain this diagram (attach a picture first)',
]
const COLORS = ['#0e7c86', '#3b6fb6', '#7a5ab8', '#b8567a', '#b36b1f', '#3f8a55']
const EMOJIS = [
  '😀',
  '😂',
  '😍',
  '🥳',
  '😎',
  '🤔',
  '😢',
  '😡',
  '👍',
  '👏',
  '🙏',
  '🔥',
  '🎉',
  '❤️',
  '💡',
  '✅',
  '🌸',
  '☕',
  '🎂',
  '🎁',
  '🌙',
  '⭐',
  '🚀',
  '👀',
]

const colorFor = (name) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]
const timeOf = (iso) =>
  new Date(iso.replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Icon({ name }) {
  const paths = {
    clip: (
      <path d='M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48' />
    ),
    smile: (
      <>
        <circle cx='12' cy='12' r='10' />
        <path d='M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01' />
      </>
    ),
    send: (
      <>
        <path d='M22 2L11 13' />
        <path d='M22 2l-7 20-4-9-9-4 20-7z' />
      </>
    ),
    sun: (
      <>
        <circle cx='12' cy='12' r='5' />
        <path d='M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4' />
      </>
    ),
    moon: <path d='M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z' />,
    x: <path d='M18 6L6 18M6 6l12 12' />,
    alert: <path d='M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01' />,
    pin: <path d='M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z' />,
    search: (
      <>
        <circle cx='11' cy='11' r='7' />
        <path d='M21 21l-4.3-4.3' />
      </>
    ),
    sparkle: (
      <path d='M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16z' />
    ),
    plus: <path d='M12 5v14M5 12h14' />,
    trash: <path d='M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6' />,
    edit: (
      <>
        <path d='M12 20h9' />
        <path d='M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z' />
      </>
    ),
  }
  return (
    <svg
      viewBox='0 0 24 24'
      width='20'
      height='20'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      {paths[name]}
    </svg>
  )
}

function Avatar({ name, ai, v = 0 }) {
  if (ai)
    return (
      <div className='avatar ai' aria-hidden='true'>
        AI
      </div>
    )
  if (v > 0) return <img className='avatar' src={`${API_BASE}/api/avatar?v=${v}&t=${session.token}`} alt='' />
  return (
    <div className='avatar' style={{ background: colorFor(name) }} aria-hidden='true'>
      {name[0].toUpperCase()}
    </div>
  )
}

function StreamingReply({ text }) {
  return (
    <article className='msg ai streaming'>
      <Avatar name='AI' ai />
      <div className='body'>
        <header>
          <strong>AI</strong>
          <span className='badge'>assistant</span>
          <time>typing</time>
        </header>
        <div className='text'>{text ? <Markdown text={text} /> : <p>...</p>}</div>
      </div>
    </article>
  )
}

export default function Chat({ user, theme, onToggleTheme, onSignOut }) {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [pinned, setPinned] = useState([])
  const [aiStreams, setAiStreams] = useState({}) // tempId -> { text, conversationId, replaceId }
  const [failed, setFailed] = useState({}) // user message id -> reason the AI could not answer
  const [connected, setConnected] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [pending, setPending] = useState(null) // picture waiting to be sent
  const [notice, setNotice] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [myAvatar, setMyAvatar] = useState(user.avatarV ?? 0)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [revealed, setRevealed] = useState(() => new Set()) // flagged messages the user chose to show
  const [translations, setTranslations] = useState({}) // messageId -> { language, text, loading }
  const [langMenuFor, setLangMenuFor] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggesting, setSuggesting] = useState(false)

  const socketRef = useRef(null)
  const activeRef = useRef(null)
  const loadSeq = useRef(0)
  const pendingJump = useRef(null)
  const noticeTimer = useRef(null)
  const bottomRef = useRef(null)
  const composerRef = useRef(null)
  const photoInput = useRef(null)
  const avatarInput = useRef(null)

  activeRef.current = activeId

  function showNotice(message) {
    setNotice(message)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 4000)
  }

  // Loads this user's chats (and creates the first one if there are none yet)
  async function loadConversations() {
    try {
      let list = await api('/conversations')
      if (!list.length) list = [await api('/conversations', { method: 'POST' })]
      setConversations(list)
      setActiveId((current) => (current && list.some((c) => c.id === current) ? current : list[0].id))
    } catch (err) {
      if (err.status === 401) onSignOut()
    }
  }

  useEffect(() => {
    loadConversations()
    api('/me')
      .then((me) => setMyAvatar(me.avatarV))
      .catch((err) => {
        if (err.status === 401) onSignOut()
      })

    const socket = io(API_BASE || undefined, { auth: { token: session.token } })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') onSignOut()
    })
    socket.on('conversations:changed', loadConversations)
    socket.on('avatar:updated', ({ v }) => setMyAvatar(v))
    socket.on('chat:error', ({ message }) => showNotice(message))

    socket.on('message:new', (msg) => {
      if (msg.conversationId !== activeRef.current) return
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    })
    socket.on('message:updated', (msg) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)))
      if (msg.conversationId !== activeRef.current) return
      setPinned((prev) => {
        if (!msg.pinned) return prev.filter((p) => p.id !== msg.id)
        return prev.some((p) => p.id === msg.id) ? prev.map((p) => (p.id === msg.id ? msg : p)) : [msg, ...prev]
      })
    })
    socket.on('message:deleted', ({ id }) => {
      setMessages((prev) => prev.filter((m) => m.id !== id))
      setPinned((prev) => prev.filter((p) => p.id !== id))
    })

    socket.on('ai:start', ({ tempId, conversationId, replaceId, triggerId }) => {
      setAiStreams((s) => ({ ...s, [tempId]: { text: '', conversationId, replaceId: replaceId ?? null } }))
      if (triggerId)
        setFailed((f) => {
          const { [triggerId]: _clear, ...rest } = f
          return rest
        })
    })
    socket.on('ai:chunk', ({ tempId, text: piece }) =>
      setAiStreams((s) => (tempId in s ? { ...s, [tempId]: { ...s[tempId], text: s[tempId].text + piece } } : s)),
    )
    socket.on('ai:end', ({ tempId, replaceId, message }) => {
      setAiStreams((s) => {
        const { [tempId]: _done, ...rest } = s
        return rest
      })
      if (!message || message.conversationId !== activeRef.current) return
      setMessages((prev) => {
        if (replaceId) return prev.map((m) => (m.id === replaceId ? message : m))
        return prev.some((m) => m.id === message.id) ? prev : [...prev, message]
      })
    })
    socket.on('ai:failed', ({ tempId, triggerId, reason }) => {
      setAiStreams((s) => {
        const { [tempId]: _gone, ...rest } = s
        return rest
      })
      if (triggerId) setFailed((f) => ({ ...f, [triggerId]: reason || 'The AI could not answer right now.' }))
    })

    return () => socket.disconnect()
  }, [])

  // Load the open chat (again after a reconnect, in case something was missed)
  useEffect(() => {
    if (!activeId || !connected) return
    const seq = ++loadSeq.current
    setMessages([])
    setPinned([])
    setEditingId(null)
    setPinnedOpen(false)
    setSearchOpen(false)
    setSearchQuery('')
    setSuggestions([])
    setLangMenuFor(null)
    api(`/conversations/${activeId}/messages`)
      .then((res) => {
        if (seq !== loadSeq.current) return
        setMessages(res.messages)
        setPinned(res.pinned)
      })
      .catch((err) => {
        if (err.status === 401) onSignOut()
      })
  }, [activeId, connected])

  // Only streams that belong to the open chat are shown
  const visibleStreams = Object.entries(aiStreams).filter(([, v]) => v.conversationId === activeId)
  const tailStreams = visibleStreams.filter(([, v]) => v.replaceId == null) // new replies, shown at the bottom
  const tailText = tailStreams.map(([, v]) => v.text).join('')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, tailStreams.length, tailText])

  // After opening a chat from a search result, scroll to the message that matched
  useEffect(() => {
    const id = pendingJump.current
    if (id && messages.some((m) => m.id === id)) {
      pendingJump.current = null
      jumpTo(id)
    }
  }, [messages])

  useEffect(() => {
    if (!lightbox) return undefined
    const close = (e) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [lightbox])

  // Debounced search across all of this user's chats
  useEffect(() => {
    const q = searchQuery.trim()
    if (!searchOpen || q.length < 2) {
      setSearchResults([])
      return undefined
    }
    const timer = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(q)}`)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, searchOpen])

  function resizeComposer(el) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  function send(e) {
    e?.preventDefault()
    const content = text.trim()
    if ((!content && !pending) || sending || !activeId) return
    setSending(true)
    socketRef.current.emit('chat:send', { conversationId: activeId, content, image: pending }, (res) => {
      setSending(false)
      if (res?.error) {
        showNotice(res.error)
        return
      } // keep what the user typed
      setText('')
      setPending(null)
      setEmojiOpen(false)
      setSuggestions([])
      if (composerRef.current) composerRef.current.style.height = 'auto'
    })
  }

  async function attachPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      let data = null
      for (const [max, quality] of [
        [1000, 0.8],
        [800, 0.65],
        [600, 0.5],
      ]) {
        data = await resizeImage(file, { max, quality })
        if (data.length <= 650_000) break
      }
      if (data.length > 650_000) throw new Error('That picture is too large.')
      setPending(data)
      composerRef.current?.focus()
    } catch (err) {
      showNotice(err.message)
    }
  }

  async function changeAvatar(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    setMenuOpen(false)
    if (!file) return
    try {
      const image = await resizeImage(file, { max: 160, quality: 0.85, square: true })
      const { avatarV } = await api('/me/avatar', { method: 'PUT', body: { image } })
      setMyAvatar(avatarV)
    } catch (err) {
      showNotice(err.message)
    }
  }

  async function removeAvatar() {
    setMenuOpen(false)
    try {
      const { avatarV } = await api('/me/avatar', { method: 'PUT', body: { image: null } })
      setMyAvatar(avatarV)
    } catch (err) {
      showNotice(err.message)
    }
  }

  async function newChat() {
    const current = conversations.find((c) => c.id === activeId)
    if (current?.title === 'New chat' && !messages.length) {
      composerRef.current?.focus()
      return
    }
    try {
      const created = await api('/conversations', { method: 'POST' })
      await loadConversations()
      setActiveId(created.id)
    } catch (err) {
      showNotice(err.message)
    }
  }

  async function renameChat() {
    const current = conversations.find((c) => c.id === activeId)
    const title = window.prompt('Rename this chat', current?.title ?? '')
    if (!title || !title.trim()) return
    try {
      await api(`/conversations/${activeId}`, { method: 'PATCH', body: { title } })
    } catch (err) {
      showNotice(err.message)
    }
  }

  async function deleteChat(c) {
    if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return
    try {
      await api(`/conversations/${c.id}`, { method: 'DELETE' })
    } catch (err) {
      showNotice(err.message)
    }
  }

  function startEdit(m) {
    setEditingId(m.id)
    setEditText(m.content)
  }

  function saveEdit(m) {
    const content = editText.trim()
    setEditingId(null)
    if (!content || content === m.content) return
    socketRef.current.emit('message:edit', { id: m.id, content })
  }

  function removeMessage(m) {
    const extra = m.role === 'user' ? ' and the AI answer to it' : ''
    if (window.confirm(`Delete this message${extra}?`)) {
      socketRef.current.emit('message:delete', { id: m.id })
    }
  }

  function retry(userMessageId) {
    socketRef.current.emit('ai:retry', { id: userMessageId })
  }

  function togglePin(m) {
    socketRef.current.emit('message:pin', { id: m.id, pinned: !m.pinned })
  }

  async function copyText(m) {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopiedId(m.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      showNotice('Could not copy. Select the text and press Ctrl+C.')
    }
  }

  async function translate(m, language) {
    setLangMenuFor(null)
    setTranslations((t) => ({ ...t, [m.id]: { language, text: '', loading: true } }))
    try {
      const { translation } = await api('/translate', { method: 'POST', body: { messageId: m.id, language } })
      setTranslations((t) => ({ ...t, [m.id]: { language, text: translation, loading: false } }))
    } catch (err) {
      setTranslations((t) => {
        const { [m.id]: _gone, ...rest } = t
        return rest
      })
      showNotice(err.message)
    }
  }

  async function suggestFollowUps() {
    if (suggesting) return
    setSuggesting(true)
    setEmojiOpen(false)
    try {
      const { suggestions: list } = await api('/suggest', { method: 'POST', body: { conversationId: activeId } })
      setSuggestions(list)
    } catch (err) {
      showNotice(err.message)
    } finally {
      setSuggesting(false)
    }
  }

  function pickSuggestion(s) {
    setText(s)
    setSuggestions([])
    requestAnimationFrame(() => {
      if (!composerRef.current) return
      composerRef.current.focus()
      resizeComposer(composerRef.current)
    })
  }

  function jumpTo(id) {
    setSearchOpen(false)
    setPinnedOpen(false)
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${id}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('flash')
      setTimeout(() => el.classList.remove('flash'), 1800)
    })
  }

  function openSearchResult(r) {
    if (r.conversationId === activeId) {
      jumpTo(r.id)
      return
    }
    pendingJump.current = r.id
    setActiveId(r.conversationId)
  }

  function onComposerKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    } else if (e.key === 'ArrowUp' && !text) {
      const last = [...messages].reverse().find((m) => m.role === 'user' && m.content)
      if (last) {
        e.preventDefault()
        startEdit(last)
      }
    }
  }

  const active = conversations.find((c) => c.id === activeId)
  const aiBusy = visibleStreams.length > 0

  return (
    <div className='layout'>
      <aside className='sidebar'>
        <h2 className='brand'>
          <span className='brand-mark'>{APP_NAME[0]}</span>
          {APP_NAME}
        </h2>
        <button className='new-chat' onClick={newChat}>
          <Icon name='plus' />
          <span>New chat</span>
        </button>
        <p className='side-label'>Your chats</p>
        <nav aria-label='Your chats'>
          {conversations.map((c) => (
            <div key={c.id} className={`chat-item ${c.id === activeId ? 'active' : ''}`}>
              <button className='chat-title' onClick={() => setActiveId(c.id)} title={c.title}>
                {c.title}
              </button>
              <button className='icon-btn small' onClick={() => deleteChat(c)} aria-label={`Delete chat ${c.title}`}>
                <Icon name='trash' />
              </button>
            </div>
          ))}
        </nav>

        <div className='me'>
          {menuOpen && <div className='backdrop' onClick={() => setMenuOpen(false)} />}
          {menuOpen && (
            <div className='profile-menu' role='menu'>
              <button role='menuitem' onClick={() => avatarInput.current.click()}>
                Change profile photo
              </button>
              {myAvatar > 0 && (
                <button role='menuitem' onClick={removeAvatar}>
                  Remove photo
                </button>
              )}
              <button
                role='menuitem'
                onClick={() => {
                  onToggleTheme()
                  setMenuOpen(false)
                }}
              >
                {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              </button>
              <button role='menuitem' className='danger' onClick={onSignOut}>
                Sign out
              </button>
            </div>
          )}
          <button
            className='me-btn'
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup='menu'
            aria-expanded={menuOpen}
          >
            <Avatar name={user.username} v={myAvatar} />
            <span className='me-text'>
              <strong>{user.username}</strong>
              <small>
                <span className={`dot ${connected ? 'on' : ''}`} /> {connected ? 'online' : 'reconnecting'}
              </small>
            </span>
          </button>
          <input ref={avatarInput} type='file' accept='image/*' hidden onChange={changeAvatar} />
        </div>
      </aside>

      <section className='chat'>
        <header className='chat-head'>
          <div className='title-block'>
            <div className='title-row'>
              <h1>{active?.title ?? '...'}</h1>
              <button className='icon-btn small' onClick={renameChat} aria-label='Rename chat'>
                <Icon name='edit' />
              </button>
            </div>
            <p>Private chat: only you can see it</p>
          </div>
          <div className='head-actions'>
            <button
              className='icon-btn'
              onClick={() => setSearchOpen((o) => !o)}
              aria-label='Search your chats'
              aria-expanded={searchOpen}
            >
              <Icon name='search' />
            </button>
            <button
              className='icon-btn'
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button
              onClick={() => socketRef.current.emit('chat:summarize', { conversationId: activeId })}
              disabled={aiBusy || !messages.length}
            >
              Summarize chat
            </button>
          </div>
        </header>

        {searchOpen && (
          <div className='search-panel'>
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchOpen(false)
              }}
              placeholder='Search all your chats'
              aria-label='Search your chats'
            />
            <div className='search-results'>
              {searchQuery.trim().length < 2 ? (
                <p className='muted-note'>Type at least 2 letters.</p>
              ) : !searchResults.length ? (
                <p className='muted-note'>No messages found.</p>
              ) : (
                searchResults.map((r) => (
                  <button key={r.id} className='result' onClick={() => openSearchResult(r)}>
                    <strong>{r.title}</strong>
                    <time>{timeOf(r.createdAt)}</time>
                    <span>
                      {r.role === 'ai' ? 'AI' : 'You'}: {r.content}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {pinned.length > 0 && (
          <div className='pinned-bar'>
            <button className='pinned-toggle' onClick={() => setPinnedOpen((o) => !o)} aria-expanded={pinnedOpen}>
              <Icon name='pin' />
              <b>{pinned.length} pinned</b>
              <span className='pinned-latest'>
                {pinned[0].isAi ? 'AI' : 'You'}: {pinned[0].content || 'Picture'}
              </span>
            </button>
            {pinnedOpen && (
              <div className='pinned-list'>
                {pinned.map((p) => (
                  <div key={p.id} className='pinned-item'>
                    <button onClick={() => jumpTo(p.id)}>
                      <strong>{p.isAi ? 'AI' : 'You'}</strong> {p.content || 'Picture'}
                    </button>
                    <button className='icon-btn small' onClick={() => togglePin(p)} aria-label='Unpin message'>
                      <Icon name='x' />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className='messages' aria-live='polite'>
          {!messages.length && !aiBusy && (
            <div className='welcome'>
              <div className='logo' aria-hidden='true'>
                {APP_NAME[0]}
              </div>
              <h2>Hi {user.username}, what is on your mind?</h2>
              <p>This chat is private: only you can see it. Ask anything, or attach a picture.</p>
              <div className='starters'>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setText(s)
                      composerRef.current?.focus()
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            const replacing = visibleStreams.find(([, v]) => v.replaceId === m.id)
            if (replacing) return <StreamingReply key={m.id} text={replacing[1].text} />
            const mine = m.role === 'user'
            const editing = editingId === m.id
            const photo = m.hasImage ? `${API_BASE}/api/image/${m.id}?t=${session.token}` : null
            const hidden = !!m.flagged && !revealed.has(m.id)
            const tr = translations[m.id]
            return (
              <Fragment key={m.id}>
                <article id={`msg-${m.id}`} className={`msg ${m.isAi ? 'ai' : ''} ${mine ? 'mine' : ''}`}>
                  <Avatar name={user.username} ai={m.isAi} v={myAvatar} />
                  <div className='body'>
                    <header>
                      <strong>{m.isAi ? 'AI' : 'You'}</strong>
                      {m.isAi && <span className='badge'>assistant</span>}
                      <time>{timeOf(m.createdAt)}</time>
                      {m.editedAt && <span className='edited'>(edited)</span>}
                      {m.pinned && (
                        <span className='pin-mark' title='Pinned'>
                          <Icon name='pin' />
                        </span>
                      )}
                    </header>

                    {photo && (
                      <button className='photo' onClick={() => setLightbox(photo)} aria-label='Open picture'>
                        <img src={photo} alt='Picture you sent' loading='lazy' />
                      </button>
                    )}

                    {editing ? (
                      <div className='edit'>
                        <textarea
                          autoFocus
                          rows={2}
                          value={editText}
                          maxLength={2000}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditingId(null)
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              saveEdit(m)
                            }
                          }}
                        />
                        <div className='edit-actions'>
                          <button className='primary' onClick={() => saveEdit(m)}>
                            Save and ask again
                          </button>
                          <button onClick={() => setEditingId(null)}>Cancel</button>
                          <small>Enter to save, Esc to cancel</small>
                        </div>
                      </div>
                    ) : m.isAi ? (
                      <div className='text'>
                        <Markdown text={m.content} />
                      </div>
                    ) : hidden ? (
                      <div className='flagged'>
                        <Icon name='alert' />
                        <span>Flagged by AI moderation: {m.flagged}</span>
                        <button onClick={() => setRevealed((set) => new Set(set).add(m.id))}>Show anyway</button>
                      </div>
                    ) : (
                      m.content && <p className='text plain'>{m.content}</p>
                    )}

                    {tr && (
                      <div className='translation'>
                        <small>{tr.loading ? 'Translating...' : `Translated to ${LANG_LABELS[tr.language]}`}</small>
                        {!tr.loading && <p dir='auto'>{tr.text}</p>}
                        {!tr.loading && (
                          <button
                            className='link'
                            onClick={() => setTranslations(({ [m.id]: _hide, ...rest }) => rest)}
                          >
                            Hide translation
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {!editing && (
                    <div className={`tools ${langMenuFor === m.id ? 'open' : ''}`}>
                      <button onClick={() => togglePin(m)}>{m.pinned ? 'Unpin' : 'Pin'}</button>
                      {m.content && (
                        <span className='lang-wrap'>
                          <button
                            onClick={() => setLangMenuFor((id) => (id === m.id ? null : m.id))}
                            aria-haspopup='menu'
                            aria-expanded={langMenuFor === m.id}
                          >
                            Translate
                          </button>
                          {langMenuFor === m.id && (
                            <div className='lang-menu' role='menu'>
                              {Object.entries(LANG_LABELS).map(([key, label]) => (
                                <button key={key} role='menuitem' onClick={() => translate(m, key)}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </span>
                      )}
                      {m.isAi && m.content && (
                        <button onClick={() => copyText(m)}>{copiedId === m.id ? 'Copied!' : 'Copy'}</button>
                      )}
                      {m.isAi && m.replyTo && (
                        <button onClick={() => retry(m.replyTo)} disabled={aiBusy}>
                          Regenerate
                        </button>
                      )}
                      {mine && m.content && (
                        <button onClick={() => startEdit(m)} aria-label='Edit message'>
                          Edit
                        </button>
                      )}
                      <button className='danger' onClick={() => removeMessage(m)} aria-label='Delete message'>
                        Delete
                      </button>
                    </div>
                  )}
                </article>

                {failed[m.id] && (
                  <div className='ai-failed' role='alert'>
                    <Icon name='alert' />
                    <span>{failed[m.id]}</span>
                    <button onClick={() => retry(m.id)}>Try again</button>
                  </div>
                )}
              </Fragment>
            )
          })}

          {tailStreams.map(([id, v]) => (
            <StreamingReply key={id} text={v.text} />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className='composer-wrap'>
          {notice && (
            <p className='notice' role='alert'>
              {notice}
            </p>
          )}
          {emojiOpen && (
            <div className='emoji-panel' role='listbox' aria-label='Emoji'>
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  onClick={() => {
                    setText((t) => t + em)
                    composerRef.current?.focus()
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          )}
          {pending && (
            <div className='preview'>
              <img src={pending} alt='Picture to send' />
              <button className='icon-btn small' onClick={() => setPending(null)} aria-label='Remove picture'>
                <Icon name='x' />
              </button>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className='suggestions' aria-label='Suggested messages'>
              {suggestions.map((sug) => (
                <button key={sug} onClick={() => pickSuggestion(sug)}>
                  {sug}
                </button>
              ))}
              <button className='icon-btn small' onClick={() => setSuggestions([])} aria-label='Dismiss suggestions'>
                <Icon name='x' />
              </button>
            </div>
          )}
          <form className='composer' onSubmit={send}>
            <button
              type='button'
              className='icon-btn'
              onClick={() => photoInput.current.click()}
              aria-label='Attach a picture'
            >
              <Icon name='clip' />
            </button>
            <button
              type='button'
              className='icon-btn'
              onClick={() => setEmojiOpen((o) => !o)}
              aria-label='Insert emoji'
            >
              <Icon name='smile' />
            </button>
            <button
              type='button'
              className={`icon-btn ${suggesting ? 'busy' : ''}`}
              onClick={suggestFollowUps}
              disabled={suggesting || !messages.length}
              aria-label='Suggest what to ask next'
              title='Suggest what to ask next'
            >
              <Icon name='sparkle' />
            </button>
            <input ref={photoInput} type='file' accept='image/*' hidden onChange={attachPhoto} />
            <textarea
              ref={composerRef}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                resizeComposer(e.target)
              }}
              onKeyDown={onComposerKeyDown}
              maxLength={2000}
              aria-label='Message'
              placeholder='Message the AI...'
            />
            <button className='send' disabled={(!text.trim() && !pending) || sending} aria-label='Send message'>
              <Icon name='send' />
            </button>
          </form>
          <p className='hint'>Enter to send, Shift+Enter for a new line, Up arrow to edit your last message</p>
        </div>
      </section>

      {lightbox && (
        <div className='lightbox' role='dialog' aria-label='Picture' onClick={() => setLightbox(null)}>
          <img src={lightbox} alt='Full size' />
        </div>
      )}
    </div>
  )
}
