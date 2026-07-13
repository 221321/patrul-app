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
const fs = require('fs');
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'photos');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Приём фото: base64 (jpeg, уже сжатый на клиенте) + метаданные
app.post('/api/photo-report', (req, res) => {
  const { guardId, shiftId, imageBase64 } = req.body || {};
  if (!guardId || !imageBase64) {
    return res.status(400).json({ error: 'guardId и imageBase64 обязательны' });
  }

  // убираем префикс data:image/jpeg;base64, если есть
  const raw = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');

  // защита от слишком тяжёлых файлов (клиент сжимает, но на всякий случай)
  if (buf.length > 3 * 1024 * 1024) {
    return res.status(413).json({ error: 'Фото слишком большое' });
  }

  const id = 'p_' + Date.now();
  const fileName = id + '.jpg';
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buf);

  const report = {
    id,
    guardId,
    shiftId: shiftId || null,
    file: '/uploads/photos/' + fileName,
    takenAt: new Date().toISOString()
  };
  db.get('photoReports').push(report).write();
  res.json(report);
});

// Лента фотоотчётов для менеджера: ?date=2026-07-13 (по умолчанию сегодня)
app.get('/api/photo-reports', (req, res) => {
  const date = req.query.date || today();
  const guards = db.get('guards').value();
  const reports = db.get('photoReports')
    .filter((r) => r.takenAt.slice(0, 10) === date)
    .value()
    .map((r) => {
      const guard = guards.find((g) => g.id === r.guardId);
      return {
        id: r.id,
        guardName: guard ? guard.name : r.guardId,
        file: r.file,
        takenAt: r.takenAt
      };
    })
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  res.json(reports);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Патруль Р — сервер запущен на порту ' + PORT);
});
