const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = 3472;
const DATA_FILE = path.join(__dirname, 'data', 'records.json');

// ── 데이터 유틸 ──────────────────────────────────────────────
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { babies: { a: { name: '아둥이', sex: 'boy', birthDate: null, dueDate: null }, b: { name: '바둥이', sex: 'girl', birthDate: null, dueDate: null } }, records: [] };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 초기 데이터
if (!fs.existsSync(DATA_FILE)) {
  saveData({
    babies: {
      a: { name: '아둥이', sex: 'boy', birthDate: null, dueDate: '2026-04-09' },
      b: { name: '바둥이', sex: 'girl', birthDate: null, dueDate: '2026-04-09' }
    },
    records: []
  });
}

// ── API ──────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static('public'));

// 전체 데이터
app.get('/api/data', (req, res) => {
  res.json(loadData());
});

// 아기 설정 업데이트
app.put('/api/babies/:id', (req, res) => {
  const data = loadData();
  if (!data.babies[req.params.id]) return res.status(404).json({ error: 'not found' });
  Object.assign(data.babies[req.params.id], req.body);
  saveData(data);
  io.emit('babies:update', data.babies);
  res.json(data.babies[req.params.id]);
});

// 기록 추가
app.post('/api/records', (req, res) => {
  const data = loadData();
  const record = {
    id: uuidv4(),
    baby: req.body.baby,
    date: req.body.date,
    weight: req.body.weight != null ? Number(req.body.weight) : null,
    height: req.body.height != null ? Number(req.body.height) : null,
    headCirc: req.body.headCirc != null ? Number(req.body.headCirc) : null,
    note: req.body.note || '',
    createdAt: new Date().toISOString()
  };
  data.records.push(record);
  saveData(data);
  io.emit('record:new', record);
  res.json(record);
});

// 기록 수정
app.put('/api/records/:id', (req, res) => {
  const data = loadData();
  const idx = data.records.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  Object.assign(data.records[idx], {
    weight: req.body.weight != null ? Number(req.body.weight) : null,
    height: req.body.height != null ? Number(req.body.height) : null,
    headCirc: req.body.headCirc != null ? Number(req.body.headCirc) : null,
    note: req.body.note || data.records[idx].note
  });
  saveData(data);
  io.emit('record:update', data.records[idx]);
  res.json(data.records[idx]);
});

// 기록 삭제
app.delete('/api/records/:id', (req, res) => {
  const data = loadData();
  const idx = data.records.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  data.records.splice(idx, 1);
  saveData(data);
  io.emit('record:delete', req.params.id);
  res.json({ ok: true });
});

// twin-log에서 가져오기
app.post('/api/import-twin-log', async (req, res) => {
  try {
    const resp = await fetch('http://localhost:3468/api/growth/a');
    const respB = await fetch('http://localhost:3468/api/growth/b');
    const growthA = await resp.json();
    const growthB = await respB.json();
    const data = loadData();
    let imported = 0;

    for (const g of [...growthA, ...growthB]) {
      const exists = data.records.some(r => r.baby === g.baby && r.date === g.date);
      if (!exists) {
        data.records.push({
          id: uuidv4(),
          baby: g.baby,
          date: g.date,
          weight: g.weight,
          height: g.height,
          headCirc: g.headCirc,
          note: 'twin-log에서 가져옴',
          createdAt: new Date().toISOString()
        });
        imported++;
      }
    }
    saveData(data);
    io.emit('data:refresh');
    res.json({ imported });
  } catch (err) {
    res.status(500).json({ error: 'twin-log 연결 실패', detail: err.message });
  }
});

// ── Socket.io ────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

// ── 서버 시작 ────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`🌱 growth-curve running on http://localhost:${PORT}`);
});
