import Database from 'better-sqlite3';

export const db = new Database(process.env.DB_PATH || 'chat.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Every conversation belongs to exactly one user, and every message belongs to a conversation.
// Nothing is shared between accounts.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    avatar_v INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'ai')),
    content TEXT NOT NULL DEFAULT '',
    image TEXT,
    reply_to INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0,
    flagged TEXT,
    edited_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, id);
`);

// Accounts from older versions keep working: add the profile picture columns if they are missing.
// (The old shared "rooms" and "messages" tables are left untouched and are no longer used.)
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('users', 'avatar', 'TEXT');
addColumn('users', 'avatar_v', 'INTEGER NOT NULL DEFAULT 0');

// ---------- Conversations ----------

export function createConversation(userId, title = 'New chat') {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO conversations (user_id, title) VALUES (?, ?)')
    .run(userId, title);
  return db
    .prepare('SELECT id, title, updated_at AS updatedAt FROM conversations WHERE id = ?')
    .get(Number(lastInsertRowid));
}

export const listConversations = (userId) =>
  db
    .prepare('SELECT id, title, updated_at AS updatedAt FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC')
    .all(userId)
    .map((c) => ({ ...c }));

// Returns the conversation only if it belongs to this user
export const ownConversation = (userId, id) =>
  db.prepare('SELECT id, title FROM conversations WHERE id = ? AND user_id = ?').get(id, userId);

export const renameConversation = (id, title) =>
  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);

export const touchConversation = (id) =>
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(id);

export const deleteConversation = (id) => db.prepare('DELETE FROM conversations WHERE id = ?').run(id);

// ---------- Messages ----------

// Pictures are served from their own URLs, so message payloads only say whether one exists.
const MESSAGE_SELECT = `
  SELECT id, conversation_id AS conversationId, role, content,
         created_at AS createdAt, edited_at AS editedAt,
         (image IS NOT NULL) AS hasImage, flagged, pinned, reply_to AS replyTo
  FROM chat_messages
`;
const shape = (r) => ({ ...r, isAi: r.role === 'ai', hasImage: !!r.hasImage, pinned: !!r.pinned });

export function getRecentMessages(conversationId, limit = 300, upToId = null) {
  const rows = db
    .prepare(`${MESSAGE_SELECT} WHERE conversation_id = ? AND (? IS NULL OR id <= ?) ORDER BY id DESC LIMIT ?`)
    .all(conversationId, upToId, upToId, limit);
  return rows.reverse().map(shape);
}

export function getMessageById(id) {
  const row = db.prepare(`${MESSAGE_SELECT} WHERE id = ?`).get(id);
  return row ? shape(row) : null;
}

export function saveMessage({ conversationId, role, content = '', replyTo = null, image = null }) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO chat_messages (conversation_id, role, content, reply_to, image) VALUES (?, ?, ?, ?, ?)')
    .run(conversationId, role, content, replyTo, image);
  return getMessageById(Number(lastInsertRowid));
}

// The AI reply that answered a given user message, if any
export const findAiReply = (triggerId) =>
  db.prepare("SELECT id FROM chat_messages WHERE reply_to = ? AND role = 'ai' ORDER BY id DESC LIMIT 1").get(triggerId);

// Rewrite an AI reply in place (not marked as "edited")
export function setAiContent(id, content) {
  db.prepare("UPDATE chat_messages SET content = ? WHERE id = ? AND role = 'ai'").run(content, id);
  return getMessageById(id);
}

// Returns message info only if the message is in one of THIS user's conversations
export const ownMessage = (userId, id) =>
  db
    .prepare(
      `SELECT m.id, m.conversation_id, m.role, m.reply_to
       FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND c.user_id = ?`
    )
    .get(id, userId);

export function updateMessage(id, content) {
  db.prepare("UPDATE chat_messages SET content = ?, edited_at = datetime('now'), flagged = NULL WHERE id = ?").run(content, id);
  return getMessageById(id);
}

export const deleteMessage = (id) => db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
export const getMessageImage = (id) => db.prepare('SELECT image FROM chat_messages WHERE id = ?').get(id)?.image;

export const setFlag = (id, reason) =>
  db.prepare('UPDATE chat_messages SET flagged = ? WHERE id = ?').run(reason, id);

export const setPinned = (id, pinned) =>
  db.prepare('UPDATE chat_messages SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);

export const getPinned = (conversationId) =>
  db.prepare(`${MESSAGE_SELECT} WHERE conversation_id = ? AND pinned = 1 ORDER BY id DESC`).all(conversationId).map(shape);

// Case-insensitive search across ONLY this user's conversations.
// % and _ typed by the user are treated as plain text.
export function searchMessages(userId, q, limit = 30) {
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return db
    .prepare(
      `SELECT m.id, m.conversation_id AS conversationId, c.title AS title, m.role, m.content,
              m.created_at AS createdAt
       FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.content LIKE ? ESCAPE '\\'
       ORDER BY m.id DESC LIMIT ?`
    )
    .all(userId, like, limit)
    .map((r) => ({ ...r }));
}

// ---------- Users ----------

export const getUserById = (id) =>
  db.prepare('SELECT id, username, CASE WHEN avatar IS NULL THEN 0 ELSE avatar_v END AS avatarV FROM users WHERE id = ?').get(id);
export const getUserAvatar = (id) => db.prepare('SELECT avatar FROM users WHERE id = ?').get(id)?.avatar;

// Returns the new avatar version (0 when the picture was removed)
export function setUserAvatar(userId, dataUrl) {
  db.prepare('UPDATE users SET avatar = ?, avatar_v = avatar_v + 1 WHERE id = ?').run(dataUrl, userId);
  return dataUrl ? db.prepare('SELECT avatar_v FROM users WHERE id = ?').get(userId).avatar_v : 0;
}
