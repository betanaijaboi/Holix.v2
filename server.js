const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure required directories exist
['data', 'uploads/covers', 'uploads/pdfs'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Init JSON data stores
const initFile = (file, val) => { if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(val, null, 2)); };
initFile('data/magazines.json', []);
initFile('data/users.json', []);
initFile('data/comments.json', []);

const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const getIP = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress ||
  '127.0.0.1';

// Multer – separate destinations for covers vs pdfs
const storage = multer.diskStorage({
  destination: (req, file, cb) =>
    cb(null, file.fieldname === 'cover' ? 'uploads/covers' : 'uploads/pdfs'),
  filename: (req, file, cb) =>
    cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'cover' && !file.mimetype.startsWith('image/'))
      return cb(new Error('Cover must be an image'));
    if (file.fieldname === 'pdf' && file.mimetype !== 'application/pdf')
      return cb(new Error('File must be a PDF'));
    cb(null, true);
  }
});

// ── USER ROUTES ──────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  const ip = getIP(req);
  const users = readJSON('data/users.json');
  const user = users.find(u => u.ip === ip);
  res.json(user ? { found: true, user } : { found: false });
});

app.post('/api/register', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const ip = getIP(req);
  const users = readJSON('data/users.json');
  const existing = users.find(u => u.ip === ip);
  if (existing) return res.json({ user: existing });
  const user = { id: uuidv4(), name: name.trim(), ip, favorites: [], joinedAt: new Date().toISOString() };
  users.push(user);
  writeJSON('data/users.json', users);
  res.json({ user });
});

app.post('/api/favorites/:id', (req, res) => {
  const ip = getIP(req);
  const users = readJSON('data/users.json');
  const idx = users.findIndex(u => u.ip === ip);
  if (idx === -1) return res.status(401).json({ error: 'Not registered' });
  const favs = users[idx].favorites;
  const pos = favs.indexOf(req.params.id);
  pos === -1 ? favs.push(req.params.id) : favs.splice(pos, 1);
  writeJSON('data/users.json', users);
  res.json({ favorites: favs });
});

// ── MAGAZINE ROUTES ──────────────────────────────────────────

app.get('/api/magazines', (req, res) => {
  const all = readJSON('data/magazines.json');
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json(all);
  res.json(all.filter(m =>
    m.title.toLowerCase().includes(q) ||
    (m.issue || '').toLowerCase().includes(q) ||
    (m.description || '').toLowerCase().includes(q)
  ));
});

app.get('/api/magazines/:id', (req, res) => {
  const all = readJSON('data/magazines.json');
  const i = all.findIndex(m => m.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  all[i].views = (all[i].views || 0) + 1;
  writeJSON('data/magazines.json', all);
  const users = readJSON('data/users.json');
  const favCount = users.filter(u => Array.isArray(u.favorites) && u.favorites.includes(req.params.id)).length;
  res.json({ ...all[i], favCount });
});

// ── COMMENT ROUTES ───────────────────────────────────────────

app.get('/api/comments/:magazineId', (req, res) => {
  const all = readJSON('data/comments.json');
  res.json(all.filter(c => c.magazineId === req.params.magazineId));
});

app.post('/api/comments', (req, res) => {
  const ip = getIP(req);
  const user = readJSON('data/users.json').find(u => u.ip === ip);
  if (!user) return res.status(401).json({ error: 'Please register first' });
  const { magazineId, text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Comment text required' });
  const comment = {
    id: uuidv4(), magazineId, userId: user.id, userName: user.name,
    text: text.trim(), createdAt: new Date().toISOString()
  };
  const all = readJSON('data/comments.json');
  all.push(comment);
  writeJSON('data/comments.json', all);
  res.json(comment);
});

// ── ADMIN ROUTES ─────────────────────────────────────────────

const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'holix2026';

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASS) {
    res.json({ token: Buffer.from('admin:' + Date.now()).toString('base64') });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

const adminOnly = (req, res, next) => {
  const t = req.headers['x-admin-token'];
  if (!t) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (!Buffer.from(t, 'base64').toString().startsWith('admin:')) throw 0;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

app.post('/api/admin/upload', adminOnly,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  (req, res) => {
    const { title, issue, description } = req.body;
    if (!title || !req.files?.cover || !req.files?.pdf)
      return res.status(400).json({ error: 'Title, cover image and PDF are all required' });
    const mag = {
      id: uuidv4(), title, issue: issue || '', description: description || '',
      coverUrl: '/uploads/covers/' + req.files.cover[0].filename,
      pdfUrl: '/uploads/pdfs/' + req.files.pdf[0].filename,
      views: 0, uploadedAt: new Date().toISOString()
    };
    const all = readJSON('data/magazines.json');
    all.unshift(mag);
    writeJSON('data/magazines.json', all);
    res.json(mag);
  }
);

app.delete('/api/admin/magazine/:id', adminOnly, (req, res) => {
  const all = readJSON('data/magazines.json');
  const i = all.findIndex(m => m.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const mag = all[i];
  [path.join(__dirname, mag.coverUrl), path.join(__dirname, mag.pdfUrl)].forEach(p => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  all.splice(i, 1);
  writeJSON('data/magazines.json', all);
  const comments = readJSON('data/comments.json').filter(c => c.magazineId !== req.params.id);
  writeJSON('data/comments.json', comments);
  res.json({ ok: true });
});

app.get('/api/admin/stats', adminOnly, (req, res) => {
  const magazines = readJSON('data/magazines.json');
  const users = readJSON('data/users.json');
  const comments = readJSON('data/comments.json');
  res.json({
    totalMagazines: magazines.length,
    totalUsers: users.length,
    totalComments: comments.length,
    magazines: magazines.map(m => ({
      ...m, commentCount: comments.filter(c => c.magazineId === m.id).length
    }))
  });
});

app.listen(PORT, () =>
  console.log(`\n🌐  HOLIX Magazine running at http://localhost:${PORT}\n   Admin password: ${ADMIN_PASS}\n`)
);
