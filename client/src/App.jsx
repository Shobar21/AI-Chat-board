import { useEffect, useState } from 'react';
import { session } from './api.js';
import Auth from './Auth.jsx';
import Chat from './Chat.jsx';

function initialTheme() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [user, setUser] = useState(session.user);
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
  }, [theme]);

  if (!user || !session.token) {
    return <Auth onSignedIn={(data) => { session.save(data); setUser(data.user); }} />;
  }
  return (
    <Chat
      user={user}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      onSignOut={() => { session.clear(); setUser(null); }}
    />
  );
}
