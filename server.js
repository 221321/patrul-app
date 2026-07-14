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
  if (guard.active === false) {
    return res.status(403).json({ error: 'Учётная запись деактивирована' });
  }
  res.json({ id: guard.id, name: guard.name, role: guard.role || 'guard' });
});

// ---------- КОНТРАГЕНТЫ (КОМПАНИИ-ЗАКАЗЧИКИ) ----------
if (!db.has('contractors').value()) {
  db.set('contractors', []).write();
}

app.get('/api/contractors', (req, res) => {
  res.json(db.get('contractors').value());
});

app.post('/api/contractors', (req, res) => {
  const { name, bin, address, contactName, contactPhone } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'Название компании обязательно' });
  }
  const contractor = {
    id: 'k_' + Date.now(),
    name,
    bin: bin || '',
    address: address || '',
    contactName: contactName || '',
    contactPhone: contactPhone || '',
    active: true
  };
  db.get('contractors').push(contractor).write();
  res.json(contractor);
});

app.put('/api/contractors/:id', (req, res) => {
  const { id } = req.params;
  const contractor = db.get('contractors').find({ id }).value();
  if (!contractor) {
    return res.status(404).json({ error: 'Контрагент не найден' });
  }
  const { name, bin, address, contactName, contactPhone, active } = req.body || {};
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (bin !== undefined) updates.bin = bin;
  if (address !== undefined) updates.address = address;
  if (contactName !== undefined) updates.contactName = contactName;
  if (contactPhone !== undefined) updates.contactPhone = contactPhone;
  if (active !== undefined) updates.active = !!active;
  db.get('contractors').find({ id }).assign(updates).write();
  res.json(db.get('contractors').find({ id }).value());
});
// ---------- ОБЪЕКТЫ ----------
app.get('/api/objects', (req, res) => {
  res.json(db.get('objects').value());
});

app.post('/api/objects', (req, res) => {
  const { name, address, contractorId, hasPatrol } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'Название объекта обязательно' });
  }
  const object = {
    id: 'o_' + Date.now(),
    name,
    address: address || '',
    contractorId: contractorId || null,
    hasPatrol: !!hasPatrol,
    checkpoints: [],
    active: true
  };
  db.get('objects').push(object).write();
  res.json(object);
});

app.put('/api/objects/:id', (req, res) => {
  const { id } = req.params;
  const object = db.get('objects').find({ id }).value();
  if (!object) {
    return res.status(404).json({ error: 'Объект не найден' });
  }
  const { name, address, contractorId, hasPatrol, active } = req.body || {};
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (address !== undefined) updates.address = address;
  if (contractorId !== undefined) updates.contractorId = contractorId || null;
  if (hasPatrol !== undefined) updates.hasPatrol = !!hasPatrol;
  if (active !== undefined) updates.active = !!active;
  db.get('objects').find({ id }).assign(updates).write();
  res.json(db.get('objects').find({ id }).value());
});
// ---------- СЕГОДНЯШНЕЕ НАЗНАЧЕНИЕ ----------
// ---------- СОТРУДНИКИ (КАДРЫ) ----------
app.get('/api/employees', (req, res) => {
  const employees = db.get('guards').value().map((g) => ({
    id: g.id,
    name: g.name,
    phone: g.phone,
    role: g.role || 'guard',
    position: g.position || 'Охранник',
    official: g.official !== false,
    active: g.active !== false
  }));
  res.json(employees);
});

app.post('/api/employees', (req, res) => {
  const { name, phone, pin, role, position, official } = req.body || {};
  if (!name || !phone || !pin) {
    return res.status(400).json({ error: 'ФИО, телефон и PIN обязательны' });
  }
  const existing = db.get('guards').find({ phone }).value();
  if (existing) {
    return res.status(409).json({ error: 'Сотрудник с таким телефоном уже существует' });
  }
  const employee = {
    id: 'g_' + Date.now(),
    name,
    phone,
    pin,
    role: role === 'manager' ? 'manager' : 'guard',
    position: position || 'Охранник',
    official: official !== false,
    active: true
  };
  db.get('guards').push(employee).write();
  res.json(employee);
});

app.put('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const guard = db.get('guards').find({ id }).value();
  if (!guard) {
    return res.status(404).json({ error: 'Сотрудник не найден' });
  }
  const { name, phone, pin, role, position, official, active } = req.body || {};
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (phone !== undefined) updates.phone = phone;
  if (pin !== undefined && pin !== '') updates.pin = pin;
  if (role !== undefined) updates.role = role === 'manager' ? 'manager' : 'guard';
  if (position !== undefined) updates.position = position;
  if (official !== undefined) updates.official = !!official;
  if (active !== undefined) updates.active = !!active;
  db.get('guards').find({ id }).assign(updates).write();
  res.json(db.get('guards').find({ id }).value());
});
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

// ---------- НАЗНАЧЕНИЯ (менеджер: кто на каком объекте в какой день) ----------
app.get('/api/assignments', (req, res) => {
  const date = req.query.date || today();
  res.json(db.get('assignments').filter({ date }).value());
});

// Один сотрудник — одно назначение на дату. Повторный POST с тем же guardId+date
// перезаписывает объект. objectId: '' или null — снять назначение.
app.post('/api/assignments', (req, res) => {
  const { guardId, objectId, date } = req.body || {};
  if (!guardId || !date) {
    return res.status(400).json({ error: 'guardId и date обязательны' });
  }
  const existing = db.get('assignments').find({ guardId, date }).value();

  if (!objectId) {
    if (existing) {
      db.get('assignments').remove({ guardId, date }).write();
    }
    return res.json({ removed: true });
  }

  if (existing) {
    db.get('assignments').find({ guardId, date }).assign({ objectId }).write();
    return res.json(db.get('assignments').find({ guardId, date }).value());
  }

  const assignment = { id: 'a_' + Date.now() + '_' + guardId, guardId, objectId, date };
  db.get('assignments').push(assignment).write();
  res.json(assignment);
});

// Смены за дату — чтобы менеджер видел, кто уже начал/закончил
app.get('/api/shifts', (req, res) => {
  const date = req.query.date || today();
  res.json(db.get('shifts').filter({ date }).value());
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
