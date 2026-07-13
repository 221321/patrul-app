var state = {
  guardId: localStorage.getItem('guardId') || null,
  guardName: localStorage.getItem('guardName') || null,
  assignment: null,
  object: null,
  shift: null,
  checkpoints: []
};

function show(id) {
  var screens = ['screen-login', 'screen-main', 'screen-entrance-scan', 'screen-patrol', 'screen-photo'];
  for (var i = 0; i < screens.length; i++) {
    document.getElementById(screens[i]).classList.add('hidden');
  }
  document.getElementById(id).classList.remove('hidden');
}

function api(method, url, body) {
  return fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (r) {
    if (!r.ok) {
      return r.json().then(function (e) { throw new Error(e.error || 'Ошибка запроса'); });
    }
    return r.json();
  });
}

// ---------- ВХОД ----------
function doLogin() {
  var phone = document.getElementById('loginPhone').value.trim();
  var pin = document.getElementById('loginPin').value.trim();
  loginWith(phone, pin);
}

// ТЕСТ: удалить перед сдачей клиенту
function quickLogin(phone, pin) {
  loginWith(phone, pin);
}

function loginWith(phone, pin) {
  var errBox = document.getElementById('loginError');
  errBox.textContent = '';

api('POST', '/api/login', { phone: phone, pin: pin })
    .then(function (guard) {
      state.guardId = guard.id;
      state.guardName = guard.name;
      localStorage.setItem('guardId', guard.id);
      localStorage.setItem('guardName', guard.name);
      if (guard.role === 'manager') {
        window.location.href = '/photos.html';
        return;
      }
      enterMain();
    })
    .catch(function (e) {
      errBox.textContent = e.message;
    });
}

function logout() {
  localStorage.removeItem('guardId');
  localStorage.removeItem('guardName');
  state.guardId = null;
  show('screen-login');
}

// ---------- ГЛАВНЫЙ ЭКРАН ----------
function enterMain() {
  document.getElementById('guardName').textContent = state.guardName || '—';
  show('screen-main');
  loadToday();
}

function loadToday() {
  api('GET', '/api/me/' + state.guardId + '/today')
    .then(function (data) {
      state.assignment = data.assignment;
      state.object = data.object;
      state.shift = data.shift;
      state.checkpoints = data.checkpoints || [];
      renderMain();
    });
}

function renderMain() {
  var nameEl = document.getElementById('objectName');
  var addrEl = document.getElementById('objectAddress');
  var patrolBtn = document.getElementById('btnPatrol');
  var shiftBtn = document.getElementById('btnShift');
  var shiftLabel = document.getElementById('shiftLabel');

  if (state.object) {
    nameEl.textContent = state.object.name;
    addrEl.textContent = state.object.address || '';
  } else {
    nameEl.textContent = 'Объект не назначен';
    addrEl.textContent = 'Обратитесь к начальнику отдела';
  }

  patrolBtn.style.display = (state.object && state.object.hasPatrol) ? 'flex' : 'none';

  var onShift = state.shift && !state.shift.endedAt;
  shiftLabel.textContent = onShift ? 'Закончить смену' : 'Начать смену';
  shiftBtn.classList.toggle('on', !!onShift);
}

// ---------- СМЕНА ----------
var pendingShiftAction = null; // 'start' | 'end'

function toggleShift() {
  if (!state.object) {
    alert('Сначала нужно назначение на объект.');
    return;
  }
  var onShift = state.shift && !state.shift.endedAt;
  pendingShiftAction = onShift ? 'end' : 'start';
  document.getElementById('entranceTitle').textContent =
    onShift ? 'Отсканируйте QR на входе — конец смены' : 'Отсканируйте QR на входе — начало смены';
  show('screen-entrance-scan');
}

function cancelEntranceScan() {
  pendingShiftAction = null;
  show('screen-main');
}

function confirmEntranceScan() {
  if (pendingShiftAction === 'start') {
    api('POST', '/api/shift/start', { guardId: state.guardId, objectId: state.object.id })
      .then(function (shift) {
        state.shift = shift;
        pendingShiftAction = null;
        show('screen-main');
        renderMain();
      });
  } else if (pendingShiftAction === 'end') {
    api('POST', '/api/shift/end', { shiftId: state.shift.id })
      .then(function () {
        pendingShiftAction = null;
        loadToday();
        show('screen-main');
      });
  }
}

// ---------- ОБХОД ----------
function showPatrol() {
  show('screen-patrol');
  renderCheckpoints();
}

function renderCheckpoints() {
  var list = document.getElementById('checkpointList');
  list.innerHTML = '';

  state.checkpoints.forEach(function (cp) {
    var item = document.createElement('div');
    item.className = 'checkpoint-item' + (cp.scannedAt ? ' done' : '');

    var left = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'checkpoint-name';
    name.textContent = cp.name;
    left.appendChild(name);

    if (cp.scannedAt) {
      var time = document.createElement('div');
      time.className = 'checkpoint-time';
      time.textContent = 'отмечено ' + new Date(cp.scannedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      left.appendChild(time);
    }

    var btn = document.createElement('button');
    btn.className = 'checkpoint-btn';
    btn.textContent = cp.scannedAt ? 'Отмечено' : 'Сканировать';
    btn.disabled = !!cp.scannedAt;
    btn.onclick = function () { scanCheckpoint(cp.id); };

    item.appendChild(left);
    item.appendChild(btn);
    list.appendChild(item);
  });
}

function scanCheckpoint(checkpointId) {
  // Заготовка: реальный QR-скан камерой подключается отдельно (например, через
  // библиотеку jsQR). Здесь по нажатию сразу шлём отметку на сервер.
  if (!state.shift) {
    alert('Сначала начните смену.');
    return;
  }
  api('POST', '/api/checkpoint/scan', { shiftId: state.shift.id, checkpointId: checkpointId })
    .then(function () {
      loadToday();
      renderCheckpoints();
      show('screen-patrol');
    });
}

// ---------- ФОТООТЧЁТ ----------
function showPhoto() {
  document.getElementById('photoStatus').textContent = '';
  show('screen-photo');
}

function takePhoto() {
  // Открывает камеру телефона (input с capture="user" — сразу фронталка)
  document.getElementById('photoInput').click();
}

function photoSelected(input) {
  var file = input.files && input.files[0];
  if (!file) return;

  var statusEl = document.getElementById('photoStatus');
  statusEl.textContent = 'Обработка фото…';

  var reader = new FileReader();
  reader.onload = function (e) {
    compressImage(e.target.result, 1024, 0.8, function (compressedBase64) {
      // превью на экране
      var preview = document.getElementById('photoPreview');
      preview.src = compressedBase64;
      preview.classList.remove('hidden');

      statusEl.textContent = 'Отправка…';
      api('POST', '/api/photo-report', {
        guardId: state.guardId,
        shiftId: state.shift ? state.shift.id : null,
        imageBase64: compressedBase64
      })
        .then(function () {
          statusEl.textContent = 'Фото сохранено · ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        })
        .catch(function (err) {
          statusEl.textContent = 'Ошибка: ' + err.message;
          statusEl.style.color = '#B23A2E';
        });
    });
  };
  reader.readAsDataURL(file);

  // сброс, чтобы повторное фото с тем же файлом тоже сработало
  input.value = '';
}

// Сжатие через canvas: длинная сторона <= maxSide, JPEG с заданным качеством
function compressImage(dataUrl, maxSide, quality, cb) {
  var img = new Image();
  img.onload = function () {
    var w = img.width;
    var h = img.height;
    if (w > maxSide || h > maxSide) {
      if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
      else { w = Math.round(w * maxSide / h); h = maxSide; }
    }
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(canvas.toDataURL('image/jpeg', quality));
  };
  img.src = dataUrl;
}

function backToMain() {
  show('screen-main');
  loadToday();
}

// ---------- СТАРТ ----------
if (state.guardId) {
  enterMain();
} else {
  show('screen-login');
}
