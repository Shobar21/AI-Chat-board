import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set. Using an insecure development default.');
}

const sign = (user) =>
  jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  req.user = user;
  next();
}

export const authRouter = Router();

function validate(username, password) {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) {
    return 'Username must be 3-20 characters: letters, numbers, or underscores.';
  }
  if (typeof password !== 'string' || password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

authRouter.post('/register', (req, res) => {
  const { username, password } = req.body || {};
  const problem = validate(username, password);
  if (problem) return res.status(400).json({ error: problem });

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);
  const user = { id: Number(lastInsertRowid), username, avatarV: 0 };
  res.json({ token: sign(user), user });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  const user = { id: row.id, username: row.username, avatarV: row.avatar ? row.avatar_v : 0 };
  res.json({ token: sign(user), user });
});

// "Continue as guest": a fresh, private account with a random name and a password nobody knows.
// Every visitor gets their own empty space. Turn off with ALLOW_GUESTS=off.
authRouter.post('/guest', (_req, res) => {
  if (process.env.ALLOW_GUESTS === 'off') {
    return res.status(403).json({ error: 'Guest accounts are turned off. Please create an account.' });
  }
  let username;
  do {
    username = `guest_${crypto.randomBytes(3).toString('hex')}`;
  } while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username));

  const hash = bcrypt.hashSync(crypto.randomBytes(24).toString('base64url'), 10);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);
  const user = { id: Number(lastInsertRowid), username, avatarV: 0 };
  res.json({ token: sign(user), user });
});
