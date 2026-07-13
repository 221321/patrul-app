var state = {
  guardId: localStorage.getItem('guardId') || null,
  guardName: localStorage.getItem('guardName') || null,
  assignment: null,
  object: null,
  shift: null,
  checkpoints: []
};

function show(id) {
  var screens = ['screen-login', 'screen-main', 'screen-patrol', 'screen-photo'];
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
  var errBox = document.getElementById('loginError');
  errBox.textContent = '';

  api('POST', '/api/login', { phone: phone, pin: pin })
    .then(function (guard) {
      state.guardId = guard.id;
      state.guardName = guard.name;
      localStorage.setItem('guardId', guard.id);
      localStorage.setItem('guardName', guard.name);
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
function toggleShift() {
  if (!state.object) {
    alert('Сначала нужно назначение на объект.');
    return;
  }
  var onShift = state.shift && !state.shift.endedAt;

  if (!onShift) {
    api('POST', '/api/shift/start', { guardId: state.guardId, objectId: state.object.id })
      .then(function (shift) {
        state.shift = shift;
        renderMain();
      });
  } else {
    api('POST', '/api/shift/end', { shiftId: state.shift.id })
      .then(function () {
        loadToday();
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
  // Заготовка: реальный доступ к камере подключается через <input type="file" capture="user">
  // или getUserMedia. Здесь только фиксируем факт отчёта на сервере.
  api('POST', '/api/photo-report', { guardId: state.guardId, shiftId: state.shift ? state.shift.id : null })
    .then(function () {
      document.getElementById('photoStatus').textContent = 'Фото сохранено · ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    });
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
