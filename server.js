require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// This app never uses Supabase Realtime, but the client initializes it
// regardless — Node < 22 has no native WebSocket, so it needs `ws` supplied.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }
});

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static('public'));

const getIP = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress ||
  '127.0.0.1';

const getCookie = (req, name) => {
  const raw = req.headers.cookie || '';
  const pair = raw.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
};

const setUserCookie = (req, res, memberId) => {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `holix_uid=${memberId}; Max-Age=${60 * 60 * 24 * 365}; Path=/; HttpOnly; SameSite=Lax${secure}`);
};

// Recognize the current member: this device's cookie first, falling back to
// IP (a past member returning on the same network without their cookie).
const findMember = async (req) => {
  const cookieId = getCookie(req, 'holix_uid');
  if (cookieId) {
    const { data } = await supabase.from('members').select('*').eq('id', cookieId).maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase.from('members').select('*')
    .eq('ip', getIP(req)).order('joined_at', { ascending: false }).limit(1).maybeSingle();
  return data || null;
};

const memberWithLists = async (member) => {
  if (!member) return null;
  const [{ data: favs }, { data: reads }] = await Promise.all([
    supabase.from('favorites').select('issue_id').eq('member_id', member.id),
    supabase.from('reads').select('issue_id').eq('member_id', member.id)
  ]);
  return {
    id: member.id, name: member.name, ip: member.ip, joinedAt: member.joined_at,
    favorites: (favs || []).map(f => f.issue_id),
    reads: (reads || []).map(r => r.issue_id)
  };
};

const toMagazine = (row, extra = {}) => ({
  id: row.id,
  title: row.title,
  issue: row.issue_label || '',
  description: row.summary || '',
  coverUrl: row.cover_url,
  pdfUrl: row.pdf_url,
  uploadedAt: row.created_at,
  views: extra.views ?? 0,
  favCount: extra.favCount ?? 0
});

const storagePathFromUrl = (url, bucket) => {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = (url || '').indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
};

const uploadToStorage = async (bucket, file) => {
  const filename = uuidv4() + path.extname(file.originalname);
  const { error } = await supabase.storage.from(bucket).upload(filename, file.buffer, { contentType: file.mimetype });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(filename).data.publicUrl;
};

// Multer – hold uploads in memory, then push to Supabase Storage
const upload = multer({
  storage: multer.memoryStorage(),
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

app.get('/api/me', async (req, res) => {
  const member = await findMember(req);
  if (member) setUserCookie(req, res, member.id);
  const user = await memberWithLists(member);
  res.json(user ? { found: true, user } : { found: false });
});

app.post('/api/register', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

  const existing = await findMember(req);
  if (existing) {
    setUserCookie(req, res, existing.id);
    return res.json({ user: await memberWithLists(existing) });
  }

  const { data, error } = await supabase.from('members')
    .insert({ name: name.trim(), ip: getIP(req) })
    .select().single();
  if (error) return res.status(500).json({ error: 'Registration failed' });

  setUserCookie(req, res, data.id);
  res.json({ user: await memberWithLists(data) });
});

app.post('/api/favorites/:id', async (req, res) => {
  const member = await findMember(req);
  if (!member) return res.status(401).json({ error: 'Not registered' });

  const { data: existing } = await supabase.from('favorites')
    .select('member_id').eq('member_id', member.id).eq('issue_id', req.params.id).maybeSingle();

  if (existing) {
    await supabase.from('favorites').delete().eq('member_id', member.id).eq('issue_id', req.params.id);
  } else {
    await supabase.from('favorites').insert({ member_id: member.id, issue_id: req.params.id });
  }

  const { data: favs } = await supabase.from('favorites').select('issue_id').eq('member_id', member.id);
  res.json({ favorites: (favs || []).map(f => f.issue_id) });
});

// ── MAGAZINE ROUTES ──────────────────────────────────────────

app.get('/api/magazines', async (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const [{ data: rows, error }, { data: stats }] = await Promise.all([
    supabase.from('issues').select('*').order('created_at', { ascending: false }),
    supabase.from('issue_stats').select('*')
  ]);
  if (error) return res.status(500).json({ error: 'Failed to load magazines' });

  const statsById = {};
  (stats || []).forEach(s => { statsById[s.issue_id] = s; });

  let list = rows.map(r => toMagazine(r, {
    views: statsById[r.id]?.read_count || 0,
    favCount: statsById[r.id]?.fav_count || 0
  }));
  if (q) list = list.filter(m =>
    m.title.toLowerCase().includes(q) ||
    m.issue.toLowerCase().includes(q) ||
    m.description.toLowerCase().includes(q)
  );
  res.json(list);
});

app.get('/api/magazines/:id', async (req, res) => {
  const { data: row } = await supabase.from('issues').select('*').eq('id', req.params.id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { data: stats } = await supabase.from('issue_stats').select('*').eq('issue_id', req.params.id).maybeSingle();
  res.json(toMagazine(row, { views: stats?.read_count || 0, favCount: stats?.fav_count || 0 }));
});

// Counts a read once per member per magazine — opening a magazine you've
// already read doesn't increment the counter again. The reads table's
// primary key (member_id, issue_id) enforces that at the database level.
app.post('/api/magazines/:id/read', async (req, res) => {
  const member = await findMember(req);
  if (!member) return res.status(401).json({ error: 'Not registered' });

  const { data: mag } = await supabase.from('issues').select('id').eq('id', req.params.id).maybeSingle();
  if (!mag) return res.status(404).json({ error: 'Not found' });

  let firstRead = true;
  const { error: insertErr } = await supabase.from('reads')
    .insert({ member_id: member.id, issue_id: req.params.id });
  if (insertErr) {
    if (insertErr.code === '23505') firstRead = false; // already read — not an error
    else return res.status(500).json({ error: 'Failed to record read' });
  }

  const { data: stats } = await supabase.from('issue_stats').select('read_count').eq('issue_id', req.params.id).maybeSingle();
  res.json({ views: stats?.read_count || 0, firstRead });
});

// ── COMMENT ROUTES ───────────────────────────────────────────

app.get('/api/comments/:magazineId', async (req, res) => {
  const { data, error } = await supabase.from('comments')
    .select('id, issue_id, body, created_at, member_id, members(name)')
    .eq('issue_id', req.params.magazineId)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: 'Failed to load comments' });
  res.json((data || []).map(c => ({
    id: c.id, magazineId: c.issue_id, userId: c.member_id,
    userName: c.members?.name || 'Member', text: c.body, createdAt: c.created_at
  })));
});

app.post('/api/comments', async (req, res) => {
  const member = await findMember(req);
  if (!member) return res.status(401).json({ error: 'Please register first' });
  const { magazineId, text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Comment text required' });

  const { data, error } = await supabase.from('comments')
    .insert({ issue_id: magazineId, member_id: member.id, body: text.trim() })
    .select().single();
  if (error) return res.status(500).json({ error: 'Failed to post comment' });

  res.json({
    id: data.id, magazineId: data.issue_id, userId: data.member_id,
    userName: member.name, text: data.body, createdAt: data.created_at
  });
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
  async (req, res) => {
    const { title, issue, description } = req.body;
    if (!title || !req.files?.cover || !req.files?.pdf)
      return res.status(400).json({ error: 'Title, cover image and PDF are all required' });
    try {
      const [coverUrl, pdfUrl] = await Promise.all([
        uploadToStorage('covers', req.files.cover[0]),
        uploadToStorage('pdfs', req.files.pdf[0])
      ]);
      const { data, error } = await supabase.from('issues').insert({
        title, issue_label: issue || '', summary: description || '',
        cover_url: coverUrl, pdf_url: pdfUrl
      }).select().single();
      if (error) throw error;
      res.json(toMagazine(data, { views: 0, favCount: 0 }));
    } catch (e) {
      res.status(500).json({ error: e.message || 'Upload failed' });
    }
  }
);

app.delete('/api/admin/magazine/:id', adminOnly, async (req, res) => {
  const { data: row } = await supabase.from('issues').select('*').eq('id', req.params.id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Not found' });

  const coverPath = storagePathFromUrl(row.cover_url, 'covers');
  const pdfPath = storagePathFromUrl(row.pdf_url, 'pdfs');
  await Promise.all([
    coverPath ? supabase.storage.from('covers').remove([coverPath]) : null,
    pdfPath ? supabase.storage.from('pdfs').remove([pdfPath]) : null
  ]);
  // Comments/favorites/reads cascade-delete via their FK to issues.
  await supabase.from('issues').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/stats', adminOnly, async (req, res) => {
  const [
    { count: totalMagazines },
    { count: totalUsers },
    { count: totalComments },
    { data: statsRows },
    { data: issueRows },
    { data: commentRows }
  ] = await Promise.all([
    supabase.from('issues').select('*', { count: 'exact', head: true }),
    supabase.from('members').select('*', { count: 'exact', head: true }),
    supabase.from('comments').select('*', { count: 'exact', head: true }),
    supabase.from('issue_stats').select('*'),
    supabase.from('issues').select('*').order('created_at', { ascending: false }),
    supabase.from('comments').select('issue_id')
  ]);

  const statsById = {};
  (statsRows || []).forEach(s => { statsById[s.issue_id] = s; });
  const commentCountById = {};
  (commentRows || []).forEach(c => { commentCountById[c.issue_id] = (commentCountById[c.issue_id] || 0) + 1; });
  const totalReads = (statsRows || []).reduce((sum, s) => sum + (s.read_count || 0), 0);

  res.json({
    totalMagazines: totalMagazines || 0,
    totalUsers: totalUsers || 0,
    totalComments: totalComments || 0,
    totalReads,
    magazines: (issueRows || []).map(r => ({
      ...toMagazine(r, { views: statsById[r.id]?.read_count || 0, favCount: statsById[r.id]?.fav_count || 0 }),
      commentCount: commentCountById[r.id] || 0
    }))
  });
});

app.get('/api/admin/members', adminOnly, async (req, res) => {
  const { data: members, error } = await supabase.from('members').select('*').order('joined_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to load members' });

  const [{ data: favRows }, { data: readRows }] = await Promise.all([
    supabase.from('favorites').select('member_id'),
    supabase.from('reads').select('member_id')
  ]);
  const favCountByMember = {};
  (favRows || []).forEach(f => { favCountByMember[f.member_id] = (favCountByMember[f.member_id] || 0) + 1; });
  const readCountByMember = {};
  (readRows || []).forEach(r => { readCountByMember[r.member_id] = (readCountByMember[r.member_id] || 0) + 1; });

  res.json(members.map(m => ({
    id: m.id, name: m.name, ip: m.ip, joinedAt: m.joined_at,
    favoritesCount: favCountByMember[m.id] || 0,
    readsCount: readCountByMember[m.id] || 0
  })));
});

// Cumulative day-by-day totals — reads-over-time and member-growth-over-time.
app.get('/api/admin/analytics', adminOnly, async (req, res) => {
  const [{ data: reads }, { data: members }] = await Promise.all([
    supabase.from('reads').select('read_at'),
    supabase.from('members').select('joined_at')
  ]);

  const dayKey = iso => iso.slice(0, 10);
  const cumulative = (isoDates) => {
    const counts = {};
    isoDates.forEach(d => { const k = dayKey(d); counts[k] = (counts[k] || 0) + 1; });
    const days = Object.keys(counts).sort();
    let running = 0;
    return days.map(day => { running += counts[day]; return { date: day, total: running }; });
  };

  res.json({
    reads: cumulative((reads || []).map(r => r.read_at)),
    members: cumulative((members || []).map(m => m.joined_at))
  });
});

app.listen(PORT, () =>
  console.log(`\n🌐  HOLIX Magazine running at http://localhost:${PORT}\n   Admin password: ${ADMIN_PASS}\n`)
);
