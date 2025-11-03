# Backend - Sistema de Tickets Redmine

Backend en Node.js + Express para gestionar tickets de soporte en Redmine.

## Configuración

1. Instalar dependencias:
```bash
npm install
```

2. Configurar variables de entorno:
   - Copiar `.env.example` a `.env`
   - Completar con tus credenciales de Redmine

```env
REDMINE_URL=https://tu-redmine.com
REDMINE_API_KEY=tu_api_key_aqui
PORT=3000
DEFAULT_PROJECT_ID=1
```

### Obtener API Key de Redmine:
1. Inicia sesión en Redmine
2. Ve a "Mi cuenta" (My account)
3. En la sección de la derecha, encontrarás "API access key"
4. Copia ese key al archivo `.env`

## Ejecutar

### Modo desarrollo (con auto-reload):
```bash
npm run dev
```

### Modo producción:
```bash
npm start
```

El servidor se ejecutará en `http://localhost:3000`

## Endpoints disponibles

### GET /health
Verifica el estado del servidor

### GET /api/projects
Obtiene la lista de proyectos disponibles en Redmine

### GET /api/trackers
Obtiene los tipos de issues (Bug, Feature, Support, etc.)

### GET /api/priorities
Obtiene las prioridades disponibles

### POST /api/tickets
Crea un nuevo ticket en Redmine

**Body:**
```json
{
  "project_id": 1,
  "subject": "Título del ticket",
  "description": "Descripción del problema",
  "tracker_id": 1,
  "priority_id": 2,
  "modulo": "Ventas",
  "numero_tramite": "12345",
  "identificador_operacion": "OP-2024-001"
}
```

### GET /api/tickets/:id
Obtiene un ticket específico por su ID

## Estructura del proyecto

```
backend/
├── server.js          # Servidor principal y rutas
├── package.json       # Dependencias
├── .env              # Variables de entorno (no incluir en git)
├── .env.example      # Ejemplo de configuración
└── README.md         # Esta documentación
```
