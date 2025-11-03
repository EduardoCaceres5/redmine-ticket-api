import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import multer from 'multer';
import https from 'https';
import http from 'http';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar multer para almacenar archivos temporalmente
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  }
  // Se permiten todos los tipos de archivos (PDF, imágenes, documentos, etc.)
});

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://redmine-ticket.vercel.app',
    'https://redmine-ticket-*.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

// Configuración de Redmine
const redmineConfig = {
  url: process.env.REDMINE_URL,
  apiKey: process.env.REDMINE_API_KEY,
  defaultProjectId: process.env.DEFAULT_PROJECT_ID
};

// Validar que las variables de entorno críticas estén configuradas
if (!redmineConfig.url || !redmineConfig.apiKey) {
  console.error('ADVERTENCIA: Variables de entorno REDMINE_URL y REDMINE_API_KEY no están configuradas');
}

// Agentes HTTP/HTTPS para manejar conexiones
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

const httpAgent = new http.Agent({
  keepAlive: true
});

// Función auxiliar para hacer llamadas a la API de Redmine
const callRedmineAPI = async (endpoint, method = 'GET', data = null, headers = {}) => {
  try {
    // Validar que las credenciales de Redmine estén configuradas
    if (!redmineConfig.url || !redmineConfig.apiKey) {
      throw new Error('Las credenciales de Redmine no están configuradas. Verifica las variables de entorno REDMINE_URL y REDMINE_API_KEY.');
    }

    // Determinar si la URL es HTTP o HTTPS
    const isHttps = redmineConfig.url.startsWith('https://');

    const config = {
      method,
      url: `${redmineConfig.url}${endpoint}`,
      headers: {
        'X-Redmine-API-Key': redmineConfig.apiKey,
        'Content-Type': 'application/json',
        ...headers
      },
      // Usar el agente apropiado según el protocolo
      httpAgent: !isHttps ? httpAgent : undefined,
      httpsAgent: isHttps ? httpsAgent : undefined
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Error en Redmine API:', {
      endpoint,
      url: redmineConfig.url,
      error: error.message,
      code: error.code,
      response: error.response?.data
    });

    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status,
      code: error.code
    };
  }
};

// Función para subir archivos a Redmine
const uploadFileToRedmine = async (file) => {
  try {
    // Determinar si la URL es HTTP o HTTPS
    const isHttps = redmineConfig.url.startsWith('https://');

    const response = await axios.post(
      `${redmineConfig.url}/uploads.json`,
      file.buffer,
      {
        headers: {
          'X-Redmine-API-Key': redmineConfig.apiKey,
          'Content-Type': 'application/octet-stream',
        },
        httpAgent: !isHttps ? httpAgent : undefined,
        httpsAgent: isHttps ? httpsAgent : undefined
      }
    );

    return {
      success: true,
      upload: {
        token: response.data.upload.token,
        filename: file.originalname,
        content_type: file.mimetype
      }
    };
  } catch (error) {
    console.error('Error subiendo archivo a Redmine:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
};

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor funcionando correctamente' });
});

// Obtener lista de proyectos disponibles (incluyendo subproyectos)
app.get('/api/projects', async (req, res) => {
  // Incluir subproyectos en la respuesta usando el parámetro include
  const result = await callRedmineAPI('/projects.json?include=descendants');

  if (result.success) {
    // Procesar proyectos para agregar información de jerarquía
    const projects = result.data.projects || [];

    // Separar proyectos principales (sin parent) de subproyectos
    const mainProjects = [];
    const subprojectsByParent = new Map();

    projects.forEach(project => {
      if (project.parent) {
        // Es un subproyecto
        const parentId = project.parent.id;
        if (!subprojectsByParent.has(parentId)) {
          subprojectsByParent.set(parentId, []);
        }
        subprojectsByParent.get(parentId).push({
          ...project,
          parent_id: parentId
        });
      } else {
        // Es un proyecto principal
        mainProjects.push({
          ...project,
          has_subprojects: false // Se actualizará después
        });
      }
    });

    // Marcar proyectos principales que tienen subproyectos
    mainProjects.forEach(project => {
      project.has_subprojects = subprojectsByParent.has(project.id);
    });

    res.json({
      main_projects: mainProjects,
      subprojects: Object.fromEntries(subprojectsByParent),
      total_count: projects.length
    });
  } else {
    res.status(result.status || 500).json({
      error: 'Error al obtener proyectos',
      details: result.error
    });
  }
});

// Obtener trackers (tipos de issues) disponibles
app.get('/api/trackers', async (req, res) => {
  const result = await callRedmineAPI('/trackers.json');

  if (result.success) {
    res.json(result.data);
  } else {
    res.status(result.status || 500).json({
      error: 'Error al obtener trackers',
      details: result.error
    });
  }
});

// Obtener prioridades disponibles
app.get('/api/priorities', async (req, res) => {
  const result = await callRedmineAPI('/enumerations/issue_priorities.json');

  if (result.success) {
    res.json(result.data);
  } else {
    res.status(result.status || 500).json({
      error: 'Error al obtener prioridades',
      details: result.error
    });
  }
});

// Crear un nuevo ticket en Redmine
app.post('/api/tickets', upload.array('attachments', 5), async (req, res) => {
  const {
    project_id,
    subject,
    description,
    tracker_id,
    priority_id,
    modulo,
    numero_tramite,
    identificador_operacion,
    user_info
  } = req.body;

  // Validaciones básicas
  if (!subject || !description) {
    return res.status(400).json({
      error: 'Campos requeridos faltantes',
      details: 'subject y description son obligatorios'
    });
  }

  // Extraer información del usuario de Keycloak
  let userInfo = null;
  try {
    userInfo = user_info ? JSON.parse(user_info) : null;
  } catch (error) {
    console.warn('Error al parsear user_info:', error);
  }

  // Validar que se haya proporcionado información del usuario
  if (!userInfo || !userInfo.email) {
    return res.status(400).json({
      error: 'Información de usuario no disponible',
      details: 'Se requiere información del usuario autenticado para crear el ticket'
    });
  }

  console.log(`📝 Creando ticket para usuario: ${userInfo.name} (${userInfo.email})`);

  try {
    // Subir archivos a Redmine primero
    const uploads = [];
    if (req.files && req.files.length > 0) {
      console.log(`📎 Subiendo ${req.files.length} archivo(s)...`);
      for (const file of req.files) {
        const uploadResult = await uploadFileToRedmine(file);
        if (uploadResult.success) {
          uploads.push(uploadResult.upload);
        } else {
          console.error('Error al subir archivo:', uploadResult.error);
        }
      }
    }

    // Construir descripción completa con información del usuario y campos personalizados
    let fullDescription = description;

    // Agregar información del solicitante
    fullDescription += '\n\n---\n**Información del Solicitante:**\n';
    fullDescription += `- **Nombre:** ${userInfo.name}\n`;
    fullDescription += `- **Email:** ${userInfo.email}\n`;
    if (userInfo.username) fullDescription += `- **Usuario Keycloak:** ${userInfo.username}\n`;

    // Agregar información adicional si existe
    if (modulo || numero_tramite || identificador_operacion) {
      fullDescription += '\n**Información Adicional:**\n';
      if (modulo) fullDescription += `- **Módulo:** ${modulo}\n`;
      if (numero_tramite) fullDescription += `- **Número de trámite:** ${numero_tramite}\n`;
      if (identificador_operacion) fullDescription += `- **Identificador de operación:** ${identificador_operacion}\n`;
    }

    // Estructura del issue para Redmine
    const issueData = {
      issue: {
        project_id: project_id || redmineConfig.defaultProjectId,
        subject: subject,
        description: fullDescription,
        tracker_id: tracker_id || 1, // Por defecto tipo "Bug" o "Soporte"
        priority_id: priority_id || 2, // Por defecto prioridad "Normal"
        // No se especifica author_id, Redmine usará el usuario de la API Key
      }
    };

    // Agregar uploads si hay archivos
    if (uploads.length > 0) {
      issueData.issue.uploads = uploads;
    }

    const result = await callRedmineAPI('/issues.json', 'POST', issueData);

    if (result.success) {
      const ticketId = result.data.issue.id;

      // Log de auditoría
      const auditLog = {
        timestamp: new Date().toISOString(),
        action: 'CREATE_TICKET',
        user: {
          keycloak_id: userInfo.sub,
          email: userInfo.email,
          username: userInfo.username,
          name: userInfo.name
        },
        ticket: {
          redmine_id: ticketId,
          project_id: project_id,
          subject: subject,
          tracker_id: tracker_id,
          priority_id: priority_id
        },
        attachments: uploads.length
      };

      console.log('✅ AUDIT:', JSON.stringify(auditLog));
      console.log(`✅ Ticket #${ticketId} creado exitosamente por ${userInfo.name} (${userInfo.email})`);

      res.status(201).json({
        message: 'Ticket creado exitosamente',
        ticket: result.data.issue,
        attachmentsUploaded: uploads.length
      });
    } else {
      console.error('❌ Error al crear ticket en Redmine:', result.error);
      res.status(result.status || 500).json({
        error: 'Error al crear ticket',
        details: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error en el proceso de creación de ticket:', error);

    // Log de error para auditoría
    if (userInfo) {
      console.error('ERROR AUDIT:', JSON.stringify({
        timestamp: new Date().toISOString(),
        action: 'CREATE_TICKET_FAILED',
        user: {
          email: userInfo.email,
          username: userInfo.username,
          name: userInfo.name
        },
        error: error.message
      }));
    }

    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Obtener un ticket específico
app.get('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const result = await callRedmineAPI(`/issues/${id}.json`);

  if (result.success) {
    res.json(result.data);
  } else {
    res.status(result.status || 500).json({
      error: 'Error al obtener ticket',
      details: result.error
    });
  }
});

// Iniciar servidor solo en desarrollo local
// En Vercel, la app se exporta como función serverless
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Servidor backend ejecutándose en http://localhost:${PORT}`);
    console.log(`Redmine URL configurado: ${redmineConfig.url}`);
  });
}

// Exportar la app para Vercel
export default app;
