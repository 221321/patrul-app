const express = require('express');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);

db.defaults({
  guards: [],
  objects: [],
  assignments: [],
  shifts: [],
  checkpointScans: [],
  photoReports: []
}).write();

const app = express();
app.use(express.json({ limit: '8mb' })); // фото в base64 может быть тяжёлым
app.use(express.static(path.join(__dirname, 'public')));

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- ВХОД ----------
// Заготовка: вход по номеру телефона + короткому PIN.
// В проде PIN стоит хранить хэшированным, а не в открытом виде.
app.post('/api/login', (req, res) => {
  const { phone, pin } = req.body || {};
  const guard = db.get('guards').find({ phone, pin }).value();
  if (!guard) {
    return res.status(401).json({ error: 'Неверный телефон или PIN' });
  }
  res.json({ id: guard.id, name: guard.name });
});

// ---------- СЕГОДНЯШНЕЕ НАЗНАЧЕНИЕ ----------
app.get('/api/me/:guardId/today', (req, res) => {
  const { guardId } = req.params;
  const assignment = db.get('assignments')
    .find({ guardId, date: today() })
    .value();

  if (!assignment) {
    return res.json({ assignment: null, object: null, shift: null });
  }

  const object = db.get('objects').find({ id: assignment.objectId }).value();

  const shift = db.get('shifts')
    .find({ guardId, objectId: assignment.objectId, date: today() })
    .value() || null;

  let checkpoints = [];
  if (object && object.hasPatrol) {
    const scans = db.get('checkpointScans')
      .filter({ shiftId: shift ? shift.id : null })
      .value();
    checkpoints = object.checkpoints.map((cp) => {
      const scan = scans.find((s) => s.checkpointId === cp.id);
      return { id: cp.id, name: cp.name, scannedAt: scan ? scan.scannedAt : null };
    });
  }

  res.json({ assignment, object, shift, checkpoints });
});

// ---------- НАЧАЛО СМЕНЫ ----------
app.post('/api/shift/start', (req, res) => {
  const { guardId, objectId } = req.body || {};
  if (!guardId || !objectId) {
    return res.status(400).json({ error: 'guardId и objectId обязательны' });
  }

  const existing = db.get('shifts')
    .find({ guardId, objectId, date: today(), endedAt: null })
    .value();
  if (existing) {
    return res.json(existing);
  }

  const shift = {
    id: 's_' + Date.now(),
    guardId,
    objectId,
    date: today(),
    startedAt: new Date().toISOString(),
    endedAt: null
  };
  db.get('shifts').push(shift).write();
  res.json(shift);
});

// ---------- КОНЕЦ СМЕНЫ ----------
app.post('/api/shift/end', (req, res) => {
  const { shiftId } = req.body || {};
  const shift = db.get('shifts').find({ id: shiftId }).value();
  if (!shift) {
    return res.status(404).json({ error: 'Смена не найдена' });
  }
  db.get('shifts').find({ id: shiftId }).assign({ endedAt: new Date().toISOString() }).write();
  res.json({ ok: true });
});

// ---------- ОТМЕТКА ТОЧКИ ОБХОДА (скан QR) ----------
app.post('/api/checkpoint/scan', (req, res) => {
  const { shiftId, checkpointId } = req.body || {};
  if (!shiftId || !checkpointId) {
    return res.status(400).json({ error: 'shiftId и checkpointId обязательны' });
  }
  const already = db.get('checkpointScans')
    .find({ shiftId, checkpointId })
    .value();
  if (already) {
    return res.json(already);
  }
  const scan = {
    id: 'c_' + Date.now(),
    shiftId,
    checkpointId,
    scannedAt: new Date().toISOString()
  };
  db.get('checkpointScans').push(scan).write();
  res.json(scan);
});

// ---------- ФОТООТЧЁТ ----------
// Заготовка: принимает фото в base64 и просто сохраняет метаданные + сам файл на диск.
// Для продакшна лучше сразу писать в отдельную папку /uploads с очисткой старых файлов.
app.post('/api/photo-report', (req, res) => {
  const { guardId, shiftId } = req.body || {};
  if (!guardId) {
    return res.status(400).json({ error: 'guardId обязателен' });
  }
  const report = {
    id: 'p_' + Date.now(),
    guardId,
    shiftId: shiftId || null,
    takenAt: new Date().toISOString()
  };
  db.get('photoReports').push(report).write();
  res.json(report);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Патруль Р — сервер запущен на порту ' + PORT);
});
