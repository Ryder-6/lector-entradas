const API_BASE = 'https://www.qmobile.es/salerm/app/index.php';
const TERMINAL_USER = 'TERMINAL01';
const TERMINAL_PASSWORD = 'salerm2018';
const SESSION_KEY = 'lectorEntradasSesion';

const loginView = document.getElementById('login-view');
const readerView = document.getElementById('reader-view');

const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const mantenerSesion = document.getElementById('mantenerSesion');

const readerForm = document.getElementById('reader-form');
const ccbbInput = document.getElementById('ccbb');
const readerStatus = document.getElementById('reader-status');
const resultCard = document.getElementById('result-card');

const rSocio = document.getElementById('r-socio');
const rNombre = document.getElementById('r-nombre');
const rMarcaje = document.getElementById('r-marcaje');
const rEstado = document.getElementById('r-estado');

const btnNuevo = document.getElementById('btn-nuevo');
const btnSalir = document.getElementById('btn-salir');

function setActiveView(isLoggedIn) {
  loginView.classList.toggle('active', !isLoggedIn);
  readerView.classList.toggle('active', isLoggedIn);
}

function setStatus(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle('error', isError);
}

function cleanValue(value) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function normalizeApiData(data) {
  const socio = data.socnum || data.socio || data.numeroSocio || data.nSocio || '-';
  const categoria = data.categoria || data.cat || '';
  const nombre = data.nom || data.nombre || data.name || '';
  const apellidos = data.ape || data.apellidos || data.surname || '';

  return {
    socio: categoria ? `${socio} (${categoria})` : socio,
    nombre: `${nombre} ${apellidos}`.trim() || '-',
    marcaje: data.marcaje || data.mark || data.marca || '-',
    estado: data.estado || data.status || '-'
  };
}

function parseResponseBody(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed[0] || {};
    }
    return parsed;
  } catch {
    return { estado: text.trim() || 'Sin datos' };
  }
}

async function callApi(params) {
  const url = new URL(API_BASE);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*'
    }
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status}`);
  }

  return response.text();
}

function clearResult() {
  resultCard.hidden = true;
  rSocio.textContent = '-';
  rNombre.textContent = '-';
  rMarcaje.textContent = '-';
  rEstado.textContent = '-';
}

function openReader() {
  setActiveView(true);
  clearResult();
  setStatus(loginStatus, '');
  setStatus(readerStatus, 'Listo para leer CCBB');
  ccbbInput.focus();
}

function closeSession() {
  localStorage.removeItem(SESSION_KEY);
  setActiveView(false);
  loginForm.reset();
  readerForm.reset();
  clearResult();
  setStatus(readerStatus, '');
  setStatus(loginStatus, 'Sesión cerrada');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const usuario = document.getElementById('usuario').value.trim();
  const contrasena = document.getElementById('contrasena').value.trim();

  if (!usuario || !contrasena) {
    setStatus(loginStatus, 'Debes completar usuario y contraseña', true);
    return;
  }

  setStatus(loginStatus, 'Verificando acceso...');

  try {
    await callApi({
      acc: '1',
      terusu: TERMINAL_USER,
      tercon: TERMINAL_PASSWORD
    });

    if (mantenerSesion.checked) {
      localStorage.setItem(SESSION_KEY, '1');
    } else {
      localStorage.removeItem(SESSION_KEY);
    }

    openReader();
  } catch (error) {
    setStatus(loginStatus, `No se pudo iniciar sesión: ${error.message}`, true);
  }
});

readerForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const ccbb = ccbbInput.value.trim();
  if (!ccbb) {
    setStatus(readerStatus, 'Introduce un código CCBB', true);
    return;
  }

  setStatus(readerStatus, 'Consultando entrada...');

  try {
    const body = await callApi({
      acc: '2',
      socnumccbb: ccbb
    });

    const parsed = parseResponseBody(body);
    const viewData = normalizeApiData(parsed);

    rSocio.textContent = cleanValue(viewData.socio);
    rNombre.textContent = cleanValue(viewData.nombre);
    rMarcaje.textContent = cleanValue(viewData.marcaje);
    rEstado.textContent = cleanValue(viewData.estado);
    resultCard.hidden = false;
    setStatus(readerStatus, 'Lectura realizada');
  } catch (error) {
    clearResult();
    setStatus(readerStatus, `No se pudo leer CCBB: ${error.message}`, true);
  }
});

btnNuevo.addEventListener('click', () => {
  readerForm.reset();
  clearResult();
  setStatus(readerStatus, 'Listo para una nueva lectura');
  ccbbInput.focus();
});

btnSalir.addEventListener('click', () => {
  closeSession();
});

if (localStorage.getItem(SESSION_KEY) === '1') {
  openReader();
} else {
  setActiveView(false);
}
