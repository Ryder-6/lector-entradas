# Lector de Entradas (Capacitor)

Aplicacion movil/web para control de acceso en futbol, preparada con Vite + Capacitor.

La app incluye dos vistas principales:

1. Login de terminal
2. Lectura de entradas (manual y por camara)

## Estado actual

Funcionalidades implementadas actualmente:

- Login contra API remota con validacion de respuesta.
- Opcion "Mantener sesion iniciada" usando localStorage.
- Consulta de entrada por CCBB manual.
- Escaneo por camara de codigos de barras (EAN-13, Code 128, Codabar/code_23) cuando el dispositivo soporta BarcodeDetector.
- Modo "Leer federacion" con OCR (tesseract.js) para detectar patrones tipo `*DDMMZAAA*`.
- Normalizacion de datos de API y visualizacion de estado de entrada.
- Estado visual por resultado: neutro, valido, aviso por reuso, invalido.

## Flujo funcional

### 1) Login

Campos y acciones:

- Usuario
- Contraseña
- Mantener sesion iniciada
- Boton "Iniciar sesion"

Llamada API usada por la app:

`https://www.qmobile.es/salerm/app/index.php?acc=1&terusu=USUARIO&tercon=CONTRASENA`

Ejemplo de respuesta valida:

`[{"TERBAN":1,"TERCOD":"TERMINAL01","TERNOM":"TERMINAL 1","TERCON":"CONTRASENA"}]`

Reglas de validacion en cliente:

- `TERBAN` debe ser `1`.
- Si `TERCOD` viene informado, debe coincidir con el usuario (sin distinguir mayusculas/minusculas).
- Si `TERCON` viene informado, debe coincidir con la contraseña.

### 2) Lectura de entradas

Opciones disponibles:

- Introducir CCBB manualmente y pulsar "Leer CCBB".
- Abrir camara con "Escanear" (modo codigo de barras).
- Abrir camara con "Leer federacion" (modo OCR en zona guiada).
- "Nuevo" para limpiar formulario y resultado.
- "Salir" para cerrar sesion local.

Llamada API usada por la app:

`https://www.qmobile.es/salerm/app/index.php?acc=2&socnumccbb=CODIGO_LEIDO&tercod=TERCOD`

Ejemplo de respuesta:

`[{"TIP":0,"SOCBAN":1,"ENTBAN":1,"SOCNOM":"nombre","SOCNUM":"5051 (GENERAL)","MAREST":"(Alta)</span>","MARFECHOR":"09/04/2026 11:04:06","MARREP":0}]`

Interpretacion de `MARREP`:

- `0`: entrada valida sin usos previos.
- `1`: entrada valida, ya usada una vez.
- `>1`: entrada valida, usada multiples veces (aviso).

Datos mostrados en pantalla:

- N. socio (categoria)
- Nombre
- Marcaje
- Posicion
- Estado

## Requisitos

- Node.js 20 o superior
- npm 10 o superior

Para compilacion movil con Capacitor:

- Android Studio (Android)
- Xcode (iOS, solo macOS)

## Instalacion

```bash
npm install
```

## Scripts

```bash
npm run dev         # servidor Vite (puerto 5173)
npm run build       # build web en dist
npm run preview     # previsualizar build
npm run cap:sync    # sincronizar proyecto Capacitor
npm run cap:android # abrir Android Studio
npm run cap:ios     # abrir Xcode
```

## Uso con Capacitor

1. Generar build web:

```bash
npm run build
```

2. Sincronizar assets/plugins con Capacitor:

```bash
npm run cap:sync
```

3. (Primera vez) agregar plataforma:

```bash
npx cap add android
npx cap add ios
```

4. Abrir proyecto nativo:

```bash
npm run cap:android
npm run cap:ios
```

## Notas de camara y permisos

- En web, la camara requiere contexto seguro (HTTPS o localhost).
- En app nativa, se solicita permiso de camara via plugin de Capacitor Camera.
- Si no hay soporte de BarcodeDetector, el modo "Escanear" puede no estar disponible en algunos dispositivos/navegadores.

## Stack y dependencias principales

- Vite
- Capacitor 7 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`)
- `@capacitor/camera` para permisos/capacidad de camara en nativo
- `tesseract.js` para OCR en modo federacion

## Estructura principal

- `index.html`: layout de login y lector
- `src/main.js`: logica de login, sesion, escaner y consultas API
- `src/styles.css`: estilos responsive orientados a movil
- `capacitor.config.ts`: configuracion de Capacitor (`webDir: dist`)
- `vite.config.js`: servidor Vite en host abierto y puerto `5173`
