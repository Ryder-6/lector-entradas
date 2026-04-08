const API_BASE = 'https://www.qmobile.es/salerm/app/index.php';
const SESSION_KEY = 'lectorEntradasSesion';
const TERMINAL_CODE_KEY = 'lectorEntradasTerminal';

const loginView = document.getElementById('login-view');
const readerView = document.getElementById('reader-view');

const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const mantenerSesion = document.getElementById('mantenerSesion');

const readerForm = document.getElementById('reader-form');
const ccbbInput = document.getElementById('ccbb');
const readerStatus = document.getElementById('reader-status');
const resultCard = document.getElementById('result-card');
const scannerPanel = document.getElementById('scanner-panel');
const scannerVideo = document.getElementById('scanner-video');
const scannerHint = document.getElementById('scanner-hint');

const rSocio = document.getElementById('r-socio');
const rNombre = document.getElementById('r-nombre');
const rMarcaje = document.getElementById('r-marcaje');
const rEstado = document.getElementById('r-estado');

const btnScan = document.getElementById('btn-scan');
const btnStopScan = document.getElementById('btn-stop-scan');
const btnNuevo = document.getElementById('btn-nuevo');
const btnSalir = document.getElementById('btn-salir');

let scannerStream = null;
let scannerDetector = null;
let scannerActive = false;
let scannerFrameId = 0;

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

function decodeHtmlEntities(value) {
  const text = String(value ?? '');
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text
    .replace(/\\\"/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return textarea.value;
}

function normalizeApiData(data) {
  const socio = data.SOCNUM || data.socnum || data.socio || data.numeroSocio || data.nSocio || '';
  const categoria = data.CATEGORIA || data.categoria || data.cat || '';
  const nombre = data.SOCNOM || data.nom || data.nombre || data.name || '';
  const apellidos = data.SOCAPE || data.ape || data.apellidos || data.surname || '';
  const tip = data.TIP ?? data.tip;
  const entradaHoy = data.SOCENTOTRDIA ?? data.socentotrdia;
  const socioBloqueado = data.SOCBAN ?? data.socban;
  const entradaBloqueada = data.ENTBAN ?? data.entban;
  const repeticiones = Number(data.MARREP ?? data.marrep ?? 0);
  const rawMarcaje = data.MAREST || data.marcaje || data.mark || data.marca || '';
  const marcajeText = stripHtmlTags(decodeHtmlEntities(rawMarcaje));
  const fechaHora = data.MARFECHOR || data.marfechor || data.fechaHora || '';

  const marcaje = marcajeText || (fechaHora ? `Leído el ${fechaHora}` : '-');

  let estado = data.estado || data.status || '';

  if (!estado) {
    if (Number(entradaBloqueada) === 1) {
      estado = 'Entrada bloqueada';
    } else if (Number(socioBloqueado) === 1) {
      estado = 'Socio bloqueado';
    } else if (tip !== undefined) {
      estado = Number(tip) === 0 ? 'Lectura correcta' : `Tipo ${tip}`;
    } else {
      estado = '-';
    }
  }

  if (repeticiones >= 1) {
    estado = `${estado} · Ya usada ${repeticiones} ${repeticiones === 1 ? 'vez' : 'veces'}`;
  }

  return {
    socio: categoria && !String(socio).includes('(') ? `${socio || '-'} (${categoria})` : socio || '-',
    nombre: `${nombre} ${apellidos}`.trim() || '-',
    marcaje,
    estado,
    repeticiones,
    fechaHora
  };
}

function stripHtmlTags(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseResponseBody(text) {
  const rawText = String(text ?? '').trim();
  const bodyMatch = rawText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const content = (bodyMatch ? bodyMatch[1] : rawText).trim();
  const jsonMatch = content.match(/(\[\s*\{[\s\S]*\}\s*\]|\{\s*[\s\S]*\s*\})/);

  let data = {};
  let hasData = false;

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      data = Array.isArray(parsed) ? parsed[0] || {} : parsed;
      hasData = true;
    } catch {
      data = {};
    }
  }

  const warningText = stripHtmlTags(content.replace(jsonMatch?.[1] || '', ''));

  return {
    data,
    hasData,
    warningText,
    rawText: stripHtmlTags(content) || 'Sin datos'
  };
}

function isValidLoginResponse(data, usuario, contrasena) {
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return false;
  }

  const estadoTerminal = Number(data.TERBAN ?? data.terban ?? 0);
  const usuarioApi = String(data.TERCOD ?? data.tercod ?? '').trim();
  const contrasenaApi = String(data.TERCON ?? data.tercon ?? '').trim();

  if (estadoTerminal !== 1) {
    return false;
  }

  if (usuarioApi && usuarioApi.toUpperCase() !== usuario.toUpperCase()) {
    return false;
  }

  if (contrasenaApi && contrasenaApi !== contrasena) {
    return false;
  }

  return true;
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

function setScannerHint(message, isError = false) {
  if (!scannerHint) return;
  scannerHint.textContent = message;
  scannerHint.classList.toggle('error', isError);
}

function normalizeScannedValue(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) return '';

  try {
    const url = new URL(value);
    const extracted =
      url.searchParams.get('socnumccbb') ||
      url.searchParams.get('ccbb') ||
      url.searchParams.get('codigo') ||
      url.searchParams.get('code');

    return extracted?.trim() || value;
  } catch {
    return value;
  }
}

async function getCameraPermissionState() {
  if (!navigator.permissions?.query) {
    return 'prompt';
  }

  try {
    const result = await navigator.permissions.query({ name: 'camera' });
    return result.state;
  } catch {
    return 'prompt';
  }
}

async function requestCameraPermission() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }

  const permissionState = await getCameraPermissionState();

  if (permissionState === 'granted') {
    return true;
  }

  if (permissionState === 'denied') {
    setStatus(
      readerStatus,
      'Permiso de cámara denegado. Actívalo en Ajustes > Apps > lector-entradas > Permisos.',
      true
    );
    return false;
  }

  try {
    setStatus(readerStatus, 'Solicitando permiso de cámara...');

    const tempStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }
      },
      audio: false
    });

    tempStream.getTracks().forEach((track) => track.stop());
    setStatus(readerStatus, 'Permiso de cámara concedido. Ya puedes escanear.');
    return true;
  } catch (error) {
    const permissionDenied =
      error?.name === 'NotAllowedError' ||
      error?.name === 'PermissionDeniedError' ||
      /permission denied|denegado/i.test(String(error?.message || ''));

    const message = permissionDenied
      ? 'Permiso de cámara denegado. Actívalo en Ajustes > Apps > lector-entradas > Permisos.'
      : `No se pudo solicitar la cámara: ${error.message}`;

    setStatus(readerStatus, message, true);
    return false;
  }
}

function stopScanner() {
  scannerActive = false;

  if (scannerFrameId) {
    cancelAnimationFrame(scannerFrameId);
    scannerFrameId = 0;
  }

  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }

  if (scannerVideo) {
    scannerVideo.pause();
    scannerVideo.srcObject = null;
  }

  if (scannerPanel) {
    scannerPanel.hidden = true;
  }

  setScannerHint('Apunta la cámara al código.');
}

async function scanCodes() {
  if (!scannerActive || !scannerDetector || !scannerVideo) {
    return;
  }

  if (scannerVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    scannerFrameId = requestAnimationFrame(scanCodes);
    return;
  }

  try {
    const barcodes = await scannerDetector.detect(scannerVideo);

    if (barcodes.length > 0) {
      const detectedValue = normalizeScannedValue(barcodes[0].rawValue);

      if (detectedValue) {
        ccbbInput.value = detectedValue;
        stopScanner();
        setStatus(readerStatus, 'Código detectado. Consultando entrada...');
        readerForm.requestSubmit();
        return;
      }
    }
  } catch {
    setScannerHint('Buscando código…');
  }

  scannerFrameId = requestAnimationFrame(scanCodes);
}

async function startScanner() {
  if (!window.isSecureContext) {
    setStatus(readerStatus, 'La cámara solo funciona en HTTPS o en la app instalada', true);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus(readerStatus, 'La cámara no está disponible en este dispositivo', true);
    return;
  }

  const hasPermission = await requestCameraPermission();
  if (!hasPermission) {
    return;
  }

  if (!('BarcodeDetector' in window)) {
    setStatus(readerStatus, 'Este dispositivo no admite lectura automática de QR o barras', true);
    return;
  }

  try {
    const preferredFormats = [
      'qr_code',
      'ean_13',
      'ean_8',
      'code_128',
      'code_39',
      'upc_a',
      'upc_e',
      'itf',
      'codabar',
      'pdf417',
      'data_matrix',
      'aztec'
    ];

    const supportedFormats = BarcodeDetector.getSupportedFormats
      ? await BarcodeDetector.getSupportedFormats()
      : preferredFormats;

    const detectorFormats = preferredFormats.filter((format) => supportedFormats.includes(format));

    scannerDetector = new BarcodeDetector({
      formats: detectorFormats.length ? detectorFormats : preferredFormats
    });

    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }
      },
      audio: false
    });

    scannerVideo.srcObject = scannerStream;
    scannerPanel.hidden = false;
    await scannerVideo.play();

    scannerActive = true;
    setScannerHint('Apunta la cámara al código de barras o QR.');
    setStatus(readerStatus, 'Escáner activo');
    scanCodes();
  } catch (error) {
    stopScanner();

    const permissionDenied =
      error?.name === 'NotAllowedError' ||
      error?.name === 'PermissionDeniedError' ||
      /permission denied|denegado/i.test(String(error?.message || ''));

    const message = permissionDenied
      ? 'Permiso de cámara denegado. Actívalo en Ajustes > Apps > lector-entradas > Permisos.'
      : `No se pudo iniciar la cámara: ${error.message}`;

    setStatus(readerStatus, message, true);
  }
}

function openReader() {
  setActiveView(true);
  clearResult();
  setStatus(loginStatus, '');
  setStatus(readerStatus, 'Listo para leer CCBB');
  ccbbInput.focus();
  void requestCameraPermission();
}

function closeSession() {
  stopScanner();
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(TERMINAL_CODE_KEY);
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
    const body = await callApi({
      acc: '1',
      terusu: usuario,
      tercon: contrasena
    });

    const parsed = parseResponseBody(body);

    if (!parsed.hasData || !isValidLoginResponse(parsed.data, usuario, contrasena)) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TERMINAL_CODE_KEY);
      setActiveView(false);
      setStatus(loginStatus, 'Usuario o contraseña no válidos', true);
      return;
    }

    localStorage.setItem(
      TERMINAL_CODE_KEY,
      String(parsed.data.TERCOD ?? parsed.data.tercod ?? usuario).trim()
    );

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
    const terminalCode = localStorage.getItem(TERMINAL_CODE_KEY)?.trim();

    const body = await callApi({
      acc: '2',
      tercod: terminalCode || '',
      socnumccbb: ccbb
    });

    const parsed = parseResponseBody(body);

    if (!parsed.hasData) {
      clearResult();
      setStatus(readerStatus, parsed.warningText || 'Respuesta no válida del servidor', true);
      return;
    }

    const viewData = normalizeApiData(parsed.data);

    rSocio.textContent = cleanValue(viewData.socio);
    rNombre.textContent = cleanValue(viewData.nombre);
    rMarcaje.textContent = cleanValue(viewData.marcaje);
    rEstado.textContent = cleanValue(viewData.estado);
    resultCard.hidden = false;

    if (viewData.repeticiones >= 1) {
      setStatus(
        readerStatus,
        `Aviso: esta entrada ya se había leído antes (${viewData.repeticiones} ${viewData.repeticiones === 1 ? 'uso' : 'usos'}).`,
        true
      );
    } else if (parsed.warningText) {
      setStatus(readerStatus, `Aviso del servidor: ${parsed.warningText}`, true);
    } else {
      setStatus(readerStatus, 'Lectura realizada');
    }
  } catch (error) {
    clearResult();
    setStatus(readerStatus, `No se pudo leer CCBB: ${error.message}`, true);
  }
});

btnScan.addEventListener('click', async () => {
  if (scannerActive) {
    stopScanner();
    setStatus(readerStatus, 'Escáner detenido');
    return;
  }

  await startScanner();
});

btnStopScan.addEventListener('click', () => {
  stopScanner();
  setStatus(readerStatus, 'Escáner detenido');
  ccbbInput.focus();
});

btnNuevo.addEventListener('click', () => {
  stopScanner();
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
  localStorage.removeItem(TERMINAL_CODE_KEY);
  setActiveView(false);
}
