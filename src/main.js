import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { createWorker } from 'tesseract.js';

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
const scannerGuide = document.getElementById('scanner-guide');
const scannerGuideLabel = document.getElementById('scanner-guide-label');

const rSocio = document.getElementById('r-socio');
const rNombre = document.getElementById('r-nombre');
const rMarcaje = document.getElementById('r-marcaje');
const rPosicion = document.getElementById('r-posicion');
const rEstado = document.getElementById('r-estado');

const btnScan = document.getElementById('btn-scan');
const btnFederacion = document.getElementById('btn-federacion');
const btnNuevo = document.getElementById('btn-nuevo');
const btnSalir = document.getElementById('btn-salir');

let scannerStream = null;
let scannerDetector = null;
let scannerActive = false;
let scannerFrameId = 0;
let scannerMode = 'barcode';
let ocrActive = false;
let ocrInProgress = false;
let ocrTimeoutId = 0;
let ocrWorkerPromise = null;
let scannedCandidates = [];
let currentCandidateIndex = 0;

const SCANNER_MODE_BARCODE = 'barcode';
const SCANNER_MODE_FEDERACION = 'federacion';
const FEDERACION_OCR_AREA = {
  left: 0.12,
  top: 0.64,
  width: 0.76,
  height: 0.18
};

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

function updateFederacionButton() {
  if (!btnFederacion) return;

  if (scannerActive && scannerMode === SCANNER_MODE_FEDERACION) {
    btnFederacion.textContent = 'Cerrar federación';
    btnFederacion.classList.remove('btn-secondary');
    btnFederacion.classList.add('btn-danger', 'scan-active');
    return;
  }

  btnFederacion.textContent = 'Leer federación';
  btnFederacion.classList.remove('btn-danger', 'scan-active');
  btnFederacion.classList.add('btn-secondary');
}

function updateScannerButtons() {
  updateScanButton();
  updateFederacionButton();
}

function setScannerGuideMode(mode) {
  if (!scannerGuide || !scannerGuideLabel) return;

  const showGuide = scannerActive && mode === SCANNER_MODE_FEDERACION;
  scannerGuide.hidden = !showGuide;
  scannerGuideLabel.hidden = !showGuide;
}

function normalizeScannedValue(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) return '';

  const federacionMatch = value.match(/\*\s*(\d{8})\s*\*/);
  if (federacionMatch) {
    return federacionMatch[1];
  }

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

}

function extractFederacionCode(text) {
  const normalizedText = String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[＊✱✳]/g, '*')
    .replace(/\s+/g, ' ')
    .trim();

  const match = normalizedText.match(/\*\s*(\d{8})\s*\*/);
  return match ? match[1] : '';
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: '*0123456789',
        preserve_interword_spaces: '1'
      });
      return worker;
    })();
  }

  return ocrWorkerPromise;
}

function captureFederacionArea() {
  if (!scannerVideo || scannerVideo.videoWidth <= 0 || scannerVideo.videoHeight <= 0) {
    return null;
  }

  const sourceWidth = scannerVideo.videoWidth;
  const sourceHeight = scannerVideo.videoHeight;
  const cropX = Math.max(0, Math.floor(sourceWidth * FEDERACION_OCR_AREA.left));
  const cropY = Math.max(0, Math.floor(sourceHeight * FEDERACION_OCR_AREA.top));
  const cropWidth = Math.min(sourceWidth - cropX, Math.floor(sourceWidth * FEDERACION_OCR_AREA.width));
  const cropHeight = Math.min(sourceHeight - cropY, Math.floor(sourceHeight * FEDERACION_OCR_AREA.height));

  if (cropWidth <= 0 || cropHeight <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    return null;
  }

  context.drawImage(scannerVideo, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvas;
}

function stopFederacionOcr() {
  ocrActive = false;
  ocrInProgress = false;

  if (ocrTimeoutId) {
    clearTimeout(ocrTimeoutId);
    ocrTimeoutId = 0;
  }
}

function scheduleFederacionOcr(delay = 0) {
  if (!ocrActive) {
    return;
  }

  if (ocrTimeoutId) {
    clearTimeout(ocrTimeoutId);
  }

  ocrTimeoutId = window.setTimeout(() => {
    void runFederacionOcr();
  }, delay);
}

async function runFederacionOcr() {
  if (!ocrActive || ocrInProgress || !scannerVideo) {
    return;
  }

  if (scannerVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    scheduleFederacionOcr(300);
    return;
  }

  ocrInProgress = true;

  try {
    const canvas = captureFederacionArea();

    if (!canvas) {
      setScannerHint('No se pudo capturar la zona marcada.', true);
      scheduleFederacionOcr(500);
      return;
    }

    setScannerHint('Buscando *DDMMZAAA* en la zona marcada...');

    const worker = await getOcrWorker();
    const result = await worker.recognize(canvas);
    const detectedCode = extractFederacionCode(result?.data?.text);

    if (detectedCode) {
      ccbbInput.value = detectedCode;
      stopScanner();
      setStatus(readerStatus, 'Texto de Federación detectado. Consultando entrada...');
      readerForm.requestSubmit();
      return;
    }

    setScannerHint('No se detectó el patrón. Ajusta el texto dentro del recuadro.');
  } catch (error) {
    setScannerHint(`No se pudo leer el texto: ${error.message}`, true);
  } finally {
    ocrInProgress = false;

    if (ocrActive) {
      scheduleFederacionOcr(900);
    }
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
  stopFederacionOcr();

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

  scannerMode = SCANNER_MODE_BARCODE;
  setScannerHint('Apunta la cámara al código.');
  setScannerGuideMode(scannerMode);
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

async function startScanner(mode = SCANNER_MODE_BARCODE) {
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

  if (mode === SCANNER_MODE_BARCODE && !('BarcodeDetector' in window)) {
    setStatus(readerStatus, 'Este dispositivo no admite lectura automática de QR o barras', true);
    return;
  }

  scannerMode = mode;

  try {
    if (mode === SCANNER_MODE_BARCODE) {
      const preferredFormats = ['ean_13', 'code_128', 'code_23'];
      const supportedFormats = BarcodeDetector.getSupportedFormats
        ? await BarcodeDetector.getSupportedFormats()
        : preferredFormats;

      const detectorFormats = preferredFormats.filter((format) => supportedFormats.includes(format));

      scannedCandidates = [];
      currentCandidateIndex = 0;
      scannerDetector = new BarcodeDetector({
        formats: detectorFormats.length ? detectorFormats : preferredFormats
      });
    }

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
    setScannerGuideMode(scannerMode);
    updateScannerButtons();

    if (mode === SCANNER_MODE_FEDERACION) {
      ocrActive = true;
      setScannerHint('Coloca el texto *DDMMZAAA* dentro del recuadro.');
      setStatus(readerStatus, 'Lector de Federación activo');
      scheduleFederacionOcr(250);
      return;
    }

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

    const viewData = normalizeApiData(parsed.data, ccbb);

    rSocio.textContent = cleanValue(viewData.socio);
    rNombre.textContent = cleanValue(viewData.nombre);
    rMarcaje.textContent = cleanValue(viewData.marcaje);
    rPosicion.textContent = cleanValue(viewData.posicion);
    rEstado.textContent = cleanValue(viewData.estado);
    resultCard.hidden = false;
    setReaderVisualState(viewData.visualState);

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

  await startScanner(SCANNER_MODE_BARCODE);
});

btnFederacion.addEventListener('click', async () => {
  if (scannerActive && scannerMode === SCANNER_MODE_FEDERACION) {
    stopScanner();
    setStatus(readerStatus, 'Lector de Federación detenido');
    ccbbInput.focus();
    return;
  }

  if (scannerActive) {
    stopScanner();
  }

  await startScanner(SCANNER_MODE_FEDERACION);
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
