// Run from the server folder:  node list-models.js
import 'dotenv/config';

const base = process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1';
const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` } });
if (!res.ok) {
  console.log(`Request failed (${res.status}). Check AI_API_KEY in server/.env.`);
  process.exit(1);
}
const { data } = await res.json();
console.log('Models your key can use:\n');
console.log(data.map((m) => m.id).sort().join('\n'));
console.log('\nPick a chat model from this list and put it in AI_MODEL=... (skip names with "whisper" or "guard").');
