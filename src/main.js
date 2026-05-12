import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';

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

const rCodigo = document.getElementById('r-codigo');
const rSocio = document.getElementById('r-socio');
const rNombre = document.getElementById('r-nombre');
const rMarcaje = document.getElementById('r-marcaje');
const rPosicion = document.getElementById('r-posicion');
const rEstado = document.getElementById('r-estado');

const btnScan = document.getElementById('btn-scan');
const btnNuevo = document.getElementById('btn-nuevo');
const btnSalir = document.getElementById('btn-salir');

let scannerStream = null;
let scannerDetector = null;
let scannerActive = false;
let scannerFrameId = 0;
let scannerMode = 'barcode';
let scannedCandidates = [];
let currentCandidateIndex = 0;

const SCANNER_MODE_BARCODE = 'barcode';

const READER_STATE_CLASSES = [
  'reader-state-neutral',
  'reader-state-valid',
  'reader-state-warning',
  'reader-state-invalid'
];

function setActiveView(isLoggedIn) {
  loginView.classList.toggle('active', !isLoggedIn);
  readerView.classList.toggle('active', isLoggedIn);
}

function setReaderVisualState(state) {
  readerView.classList.remove(...READER_STATE_CLASSES);
  readerView.classList.add(`reader-state-${state}`);
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

function resolveEntryState(data) {
  const repeticiones = Number(data.MARREP ?? data.marrep ?? 0);
  const hasEntryData = [
    data.SOCNUM,
    data.socnum,
    data.CATEGORIA,
    data.categoria,
    data.SOCNOM,
    data.nom,
    data.nombre,
    data.SOCAPE,
    data.ape,
    data.apellidos,
    data.MAREST,
    data.marcaje,
    data.mark,
    data.marca,
    data.MARFECHOR,
    data.marfechor,
    data.MARREP,
    data.marrep
  ].some((value) => value !== undefined && value !== null && String(value).trim() !== '');
  const entradaInvalida = !hasEntryData;

  if (entradaInvalida) {
    return {
      estado: 'Entrada inválida',
      repeticiones,
      visualState: 'invalid'
    };
  }

  if (repeticiones >= 1) {
    return {
      estado: `Entrada válida (ya usada ${repeticiones} ${repeticiones === 1 ? 'vez' : 'veces'})`,
      repeticiones,
      visualState: repeticiones > 1 ? 'warning' : 'valid'
    };
  }

  return {
    estado: 'Entrada válida',
    repeticiones,
    visualState: 'valid'
  };
}

function parseRealFederacionCode(code) {
  const normalizedCode = String(code ?? '').trim();
  if (!/^\d{8}$/.test(normalizedCode)) {
    return null;
  }

  const dia = normalizedCode.slice(0, 2);
  const mes = normalizedCode.slice(2, 4);
  const zonaFlag = normalizedCode.slice(4, 5);
  const asiento = normalizedCode.slice(5, 8);

  const diaNum = Number(dia);
  const mesNum = Number(mes);

  if (diaNum < 1 || diaNum > 31 || mesNum < 1 || mesNum > 12) {
    return null;
  }

  return {
    fecha: `${dia}/${mes}`,
    zona: zonaFlag === '1' ? 'Tribuna' : 'Fondo',
    asiento
  };
}

function normalizeApiData(data, scannedCode = '') {
  const socio = data.SOCNUM || data.socnum || data.socio || data.numeroSocio || data.nSocio || '';
  const categoria = data.CATEGORIA || data.categoria || data.cat || '';
  const nombre = data.SOCNOM || data.nom || data.nombre || data.name || '';
  const apellidos = data.SOCAPE || data.ape || data.apellidos || data.surname || '';
  const rawMarcaje = data.MAREST || data.marcaje || data.mark || data.marca || '';
  const marcajeText = stripHtmlTags(decodeHtmlEntities(rawMarcaje));
  const fechaHora = data.MARFECHOR || data.marfechor || data.fechaHora || '';
  const entryState = resolveEntryState(data);
  const rfefCode = parseRealFederacionCode(scannedCode);
  const nombreCompletoBase = `${nombre} ${apellidos}`.trim();
  const isRealFederacion = /REAL\s+FEDERACI[ÓO]N|RFEF/i.test(nombreCompletoBase);

  const marcaje = marcajeText || (fechaHora ? `Leído el ${fechaHora}` : '-');
  let socioText = categoria && !String(socio).includes('(') ? `${socio || '-'} (${categoria})` : socio || '-';
  let nombreText = nombreCompletoBase || '-';
  let posicionText = '-';

  if (rfefCode && isRealFederacion) {
    // Keep the federacion title + date in name, and move location details to Posicion.
    nombreText = nombreText
      .replace(/\b(TRIBUNA|FONDO)\b/gi, '')
      .replace(/·\s*Asiento\s*\d+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!new RegExp(`\\b${rfefCode.fecha}\\b`).test(nombreText)) {
      nombreText = `${nombreText} ${rfefCode.fecha}`.trim();
    }

    posicionText = rfefCode.zona;

    if (socioText === '-' || socioText.trim() === '') {
      socioText = `Asiento ${rfefCode.asiento}`;
    } else if (!/asiento\s+\d+/i.test(socioText)) {
      socioText = `${socioText} · Asiento ${rfefCode.asiento}`;
    }
  }

  return {
    socio: socioText,
    nombre: nombreText,
    marcaje,
    posicion: posicionText,
    estado: entryState.estado,
    repeticiones: entryState.repeticiones,
    visualState: entryState.visualState,
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
  rCodigo.textContent = '-';
  rSocio.textContent = '-';
  rNombre.textContent = '-';
  rMarcaje.textContent = '-';
  rPosicion.textContent = '-';
  rEstado.textContent = '-';
}

function setScannerHint(message, isError = false) {
  if (!scannerHint) return;
  scannerHint.textContent = message;
  scannerHint.classList.toggle('error', isError);
}

function updateScanButton() {
  if (!btnScan) return;

  if (scannerActive && scannerMode === SCANNER_MODE_BARCODE) {
    btnScan.textContent = 'Cerrar cámara';
    btnScan.classList.remove('btn-secondary');
    btnScan.classList.add('btn-danger', 'scan-active');
    return;
  }

  btnScan.textContent = 'Escanear';
  btnScan.classList.remove('btn-danger', 'scan-active');
  btnScan.classList.add('btn-secondary');
}

function updateScannerButtons() {
  updateScanButton();
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

function isValidEan13(value) {
  if (!/^\d{13}$/.test(value)) {
    return false;
  }

  const digits = value.split('').map(Number);
  const checkDigit = digits[12];

  const weightedSum = digits
    .slice(0, 12)
    .reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);

  const expectedCheckDigit = (10 - (weightedSum % 10)) % 10;
  return checkDigit === expectedCheckDigit;
}

function normalizeBarcodeDetection(barcode) {
  const format = String(barcode?.format || '').toLowerCase();
  const rawValue = String(barcode?.rawValue ?? '').trim();

  if (!rawValue) {
    return null;
  }

  if (format === 'ean_13') {
    const normalized = rawValue.replace(/\s+/g, '');

    if (!isValidEan13(normalized)) {
      return null;
    }

    return {
      value: normalizeScannedValue(normalized),
      score: 100,
      format: 'ean_13'
    };
  }

  if (format === 'code_128') {
    const normalized = rawValue.replace(/\s+/g, '');
    if (normalized.length < 1) {
      return null;
    }
    return {
      value: normalizeScannedValue(normalized),
      score: 80,
      format: 'code_128'
    };
  }

  if (format === 'code_23' || format === 'codabar') {
    const normalized = rawValue.replace(/\s+/g, '');
    if (normalized.length < 1) {
      return null;
    }
    return {
      value: normalizeScannedValue(normalized),
      score: 70,
      format: 'code_23'
    };
  }

  if (format === 'code_39' || format === 'code_93') {
    const normalized = rawValue.replace(/\s+/g, '');
    if (normalized.length < 1) return null;
    return {
      value: normalizeScannedValue(normalized),
      score: 75,
      format
    };
  }

  if (format === 'ean_8') {
    const normalized = rawValue.replace(/\s+/g, '');
    if (normalized.length !== 8) return null;
    return {
      value: normalizeScannedValue(normalized),
      score: 90,
      format: 'ean_8'
    };
  }

  if (format === 'upc_a' || format === 'upc_e') {
    const normalized = rawValue.replace(/\s+/g, '');
    if (normalized.length < 6) return null;
    return {
      value: normalizeScannedValue(normalized),
      score: 85,
      format
    };
  }

  if (format === 'itf') {
    const normalized = rawValue.replace(/\s+/g, '');
    if (normalized.length < 1) return null;
    return {
      value: normalizeScannedValue(normalized),
      score: 65,
      format: 'itf'
    };
  }

  if (format === 'qr_code' || format === 'data_matrix' || format === 'pdf417' || format === 'aztec') {
    const normalized = rawValue.trim();
    if (!normalized) return null;
    return {
      value: normalizeScannedValue(normalized),
      score: 80,
      format
    };
  }

  return null;
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
  if (Capacitor.isNativePlatform()) {
    try {
      const permission = await Camera.checkPermissions();

      if (permission.camera === 'granted') {
        return true;
      }

      const requestedPermission = await Camera.requestPermissions({ permissions: ['camera'] });

      if (requestedPermission.camera === 'granted') {
        setStatus(readerStatus, 'Permiso de cámara concedido. Ya puedes escanear.');
        return true;
      }

      setStatus(
        readerStatus,
        'Permiso de cámara denegado. Actívalo en Ajustes > Apps > lector-entradas > Permisos.',
        true
      );
      return false;
    } catch (error) {
      setStatus(readerStatus, `No se pudo solicitar el permiso de cámara: ${error.message}`, true);
      return false;
    }
  }

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
    scannerPanel.setAttribute('hidden', '');
  }

  scannerMode = SCANNER_MODE_BARCODE;
  setScannerHint('Apunta la cámara al código.');
  updateScannerButtons();
}

async function scanCodes() {
  if (!scannerActive || scannerMode !== SCANNER_MODE_BARCODE || !scannerDetector || !scannerVideo) {
    return;
  }

  if (scannerVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    scannerFrameId = requestAnimationFrame(scanCodes);
    return;
  }

  try {
    const barcodes = await scannerDetector.detect(scannerVideo);

    if (barcodes.length > 0) {
        const candidates = (barcodes || [])
          .map(normalizeBarcodeDetection)
          .filter((candidate) => candidate?.value);

        if (candidates.length > 0) {
          candidates.sort((a, b) => b.score - a.score);
          scannedCandidates = candidates;
          currentCandidateIndex = 0;
          
          const detectedValue = candidates[0].value;
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
      'ean_13', 'ean_8',
      'code_128', 'code_39', 'code_93',
      'code_23', 'codabar',
      'itf', 'upc_a', 'upc_e',
      'qr_code', 'data_matrix', 'pdf417', 'aztec'
    ];
    const supportedFormats = BarcodeDetector.getSupportedFormats
      ? await BarcodeDetector.getSupportedFormats()
      : preferredFormats;

    const detectorFormats = preferredFormats.filter((format) => supportedFormats.includes(format));

    scannedCandidates = [];
    currentCandidateIndex = 0;
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
    if (scannerPanel.hasAttribute('hidden')) {
      scannerPanel.removeAttribute('hidden');
    }
    await scannerVideo.play();

    scannerActive = true;
    updateScannerButtons();

    setScannerHint('Apunta la cámara a un código EAN-13.');
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
  setReaderVisualState('neutral');
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
  setReaderVisualState('neutral');
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

  stopScanner();
  clearResult();
  setReaderVisualState('neutral');
  setStatus(readerStatus, 'Consultando entrada...');

  try {
    const terminalCode = localStorage.getItem(TERMINAL_CODE_KEY)?.trim();
    let parsed = null;
    let lastAttemptedCode = ccbb;
    let candidateUsed = 0;

    // Intentar con cada candidato disponible hasta obtener un resultado válido
    for (let i = currentCandidateIndex; i < scannedCandidates.length; i++) {
      const candidate = scannedCandidates[i];
      const codeToTry = candidate.value;
      candidateUsed = i + 1;

      const body = await callApi({
        acc: '2',
        tercod: terminalCode || '',
        socnumccbb: codeToTry
      });

      parsed = parseResponseBody(body);
      lastAttemptedCode = codeToTry;

      if (parsed.hasData) {
        currentCandidateIndex = i + 1;
        break;
      }
    }

    // Si no hay candidatos guardados, intentar con el valor del input
    if (!parsed) {
      const body = await callApi({
        acc: '2',
        tercod: terminalCode || '',
        socnumccbb: ccbb
      });
      parsed = parseResponseBody(body);
    }

    if (!parsed.hasData) {
      clearResult();
      setReaderVisualState('invalid');
      setStatus(readerStatus, parsed.warningText || 'Respuesta no válida del servidor', true);
      return;
    }

    const viewData = normalizeApiData(parsed.data, lastAttemptedCode);

    rCodigo.textContent = cleanValue(lastAttemptedCode);
    rSocio.textContent = cleanValue(viewData.socio);
    rNombre.textContent = cleanValue(viewData.nombre);
    rMarcaje.textContent = cleanValue(viewData.marcaje);
    rPosicion.textContent = cleanValue(viewData.posicion);
    rEstado.textContent = cleanValue(viewData.estado);
    resultCard.hidden = false;
    setReaderVisualState(viewData.visualState);
    ccbbInput.value = '';

    if (viewData.visualState === 'invalid') {
      setStatus(readerStatus, 'Entrada inválida', true);
    } else if (viewData.repeticiones >= 1) {
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
    setReaderVisualState('invalid');
    setStatus(readerStatus, `No se pudo leer CCBB: ${error.message}`, true);
  } finally {
    ccbbInput.value = '';
    ccbbInput.focus();
  }
});

btnScan.addEventListener('click', async () => {
  if (scannerActive && scannerMode === SCANNER_MODE_BARCODE) {
    stopScanner();
    setStatus(readerStatus, 'Escáner detenido');
    ccbbInput.focus();
    return;
  }

  if (scannerActive) {
    stopScanner();
  }

  await startScanner();
});

btnNuevo.addEventListener('click', () => {
  stopScanner();
  readerForm.reset();
  clearResult();
  setReaderVisualState('neutral');
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

updateScannerButtons();
