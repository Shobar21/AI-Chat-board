// Checks that the project is ready to be pushed to GitHub and deployed on Render.
// Run from the project folder (next to package.json):  node check-deploy.cjs
const fs = require('fs')
const path = require('path')

const root = __dirname
const read = (p) => (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8') : null)
const results = []
const check = (label, ok, hint = '') => results.push({ label, ok, hint })

// --- required files and markers ---
const pkg = read('package.json')
check(
  'package.json has "build" and "start" scripts',
  !!pkg && /"build"/.test(pkg) && /"start"/.test(pkg),
  'Replace package.json with the one from odyra-update.zip',
)
const serverPkg = read('server/package.json')
check('server/package.json has a "start" script', !!serverPkg && /"start"/.test(serverPkg))
const render = read('render.yaml')
check(
  'render.yaml is present and has build/start commands',
  !!render && /buildCommand: npm run build/.test(render) && /startCommand: npm start/.test(render),
  'Copy render.yaml from odyra-update.zip into the project folder',
)
const auth = read('server/src/auth.js')
check(
  'Guest login on the server (server/src/auth.js)',
  !!auth && auth.includes("'/guest'"),
  'Replace server/src/auth.js from odyra-update.zip',
)
const authUi = read('client/src/Auth.jsx')
check(
  'Guest button on the login page (client/src/Auth.jsx)',
  !!authUi && authUi.includes('Try it as a guest'),
  'Replace client/src/Auth.jsx from odyra-update.zip',
)
const index = read('server/src/index.js')
check(
  'Server can serve the built app (server/src/index.js)',
  !!index && index.includes('clientDist') && index.includes('trust proxy'),
  'Replace server/src/index.js with the latest index.js',
)
check(
  'Server index.html caching fix (recommended)',
  !!index && index.includes("'no-cache'"),
  'Replace server/src/index.js with the latest index.js',
)
const api = read('client/src/api.js')
check(
  'client/src/api.js supports a separate backend address',
  !!api && api.includes('API_BASE'),
  'Replace client/src/api.js with the latest api.js',
)
const db = read('server/src/db.js')
check(
  'Private conversations in the database (server/src/db.js)',
  !!db && db.includes('CREATE TABLE IF NOT EXISTS conversations'),
  'Replace server/src/db.js from odyra-full.zip',
)

// --- secrets must never be pushed ---
const gitignore = read('.gitignore') || ''
check('.gitignore hides .env files', /^\.env$/m.test(gitignore), 'Add a line with .env to .gitignore')
check('.gitignore hides node_modules', /^node_modules$/m.test(gitignore), 'Add a line with node_modules to .gitignore')
check('.gitignore hides the database files', /^\*\.db$/m.test(gitignore), 'Add a line with *.db to .gitignore')

const leaks = []
;(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scan(full)
      continue
    }
    if (entry.name === '.env' || /\.(db|db-shm|db-wal|png|jpg|zip)$/.test(entry.name)) continue // never uploaded anyway
    if (/gsk_[A-Za-z0-9]{20,}/.test(fs.readFileSync(full, 'utf8'))) leaks.push(path.relative(root, full))
  }
})(root)
check(
  'No Groq API key written inside any file that gets uploaded',
  leaks.length === 0,
  `Remove the key from: ${leaks.join(', ')}`,
)

// --- local .env (information only: on Render the key is typed into the dashboard) ---
const env = read('server/.env')
let envNote
if (env === null) envNote = 'server/.env not found (fine for Render, but local chat will not work without it)'
else if (/AI_API_KEY=\s*(your-|$)/m.test(env) || !/AI_API_KEY=/.test(env))
  envNote = 'server/.env has no real AI_API_KEY yet'
else envNote = 'server/.env has an AI_API_KEY set (it stays on your computer)'

let failed = 0
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}`)
  if (!r.ok) {
    failed++
    if (r.hint) console.log(`      -> ${r.hint}`)
  }
}
console.log(`\nInfo  ${envNote}`)
console.log(
  failed === 0
    ? '\nAll checks passed. You can push to GitHub and deploy on Render.'
    : `\n${failed} check(s) failed. Fix the lines marked FAIL, then run this again.`,
)
process.exit(failed === 0 ? 0 : 1)
