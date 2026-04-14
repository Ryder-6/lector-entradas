# Lector de Entradas (Capacitor)

Aplicacion movil para lectura de entradas de futbol con dos vistas:

1. Login
2. Lectura de CCBB

La interfaz esta optimizada para movil y preparada para ejecutarse con Capacitor en Android/iOS.

## Funcionalidad

### Login

- Campos: usuario, contrasena
- Check: mantener sesion iniciada
- Boton: iniciar sesion
- Llamada API:

  [https://www.qmobile.es/salerm/app/index.php?acc=1&amp;terusu=TERMINAL01&amp;tercon=salerm2018](https://www.qmobile.es/salerm/app/index.php?acc=1&terusu=TERMINAL01&tercon=salerm2018)

  ejemplo de resultado esperado:
  [{"TERBAN":1,"TERCOD":"TERMINAL01","TERNOM":"TERMINAL 1","TERCON":"salerm2018"}]

### Leer CCBB

- Campo: introducir CCBB
- Botones: leer CCBB, nuevo, salir
- Llamada API:

https://www.qmobile.es/salerm/app/index.php?acc=2&socnumccbb=CODIGO_LEIDO&tercod=TERCOD
https://www.qmobile.es/salerm/app/index.php?acc=2&socnumccbb=9222300005399&tercod=TERMINAL01


ejemplo de resultado esperado:
[{"TIP":0,"SOCBAN":1,"ENTBAN":1,"CATDNIEST":0,"SOCNOM":"Mariam Baena Moreno","SOCNUM":"5051 (GENERAL)","MAREST":"(Alta)<\/span>","MARESTBAN":0,"MARFECHOR":"09\/04\/2026 11:04:06","MARREP":0}]

MARREP: 0 (entrada valida)
MARREP: 1 (entrada valida pero ya usada UNA vez)
MARREP: +1 (usada mas de una vez, warning)

- Datos mostrados:
- Nº de socio (categoria)
- Nombre y apellidos
- Marcaje
- Estado

## Requisitos

- Node.js 20+
- npm 10+

Para compilar en movil con Capacitor:

- Android Studio (Android)
- Xcode (iOS, solo en macOS)

## Instalacion

```bash
npm install
```

## Desarrollo web

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Uso con Capacitor

1. Genera build web:

```bash
npm run build
```

1. Sincroniza Capacitor:

```bash
npx cap sync
```

1. Agrega plataformas (solo la primera vez):

```bash
npx cap add android
npx cap add ios
```

1. Abre proyecto nativo:

```bash
npx cap open android
npx cap open ios
```

## Estructura principal

- index.html: layout con las dos vistas
- src/main.js: logica de login, sesion y consulta CCBB
- src/styles.css: estilos responsive para movil
- capacitor.config.ts: configuracion de Capacitor
