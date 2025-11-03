import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import multer from 'multer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar multer para almacenar archivos temporalmente
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Aceptar solo imágenes
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'));
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de Redmine
const redmineConfig = {
  url: process.env.REDMINE_URL,
  apiKey: process.env.REDMINE_API_KEY,
  defaultProjectId: process.env.DEFAULT_PROJECT_ID
};

// Función auxiliar para hacer llamadas a la API de Redmine
const callRedmineAPI = async (endpoint, method = 'GET', data = null, headers = {}) => {
  try {
    const config = {
      method,
      url: `${redmineConfig.url}${endpoint}`,
      headers: {
        'X-Redmine-API-Key': redmineConfig.apiKey,
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Error en Redmine API:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status
    };
  }
};

// Función para subir archivos a Redmine
const uploadFileToRedmine = async (file) => {
  try {
    const response = await axios.post(
      `${redmineConfig.url}/uploads.json`,
      file.buffer,
      {
        headers: {
          'X-Redmine-API-Key': redmineConfig.apiKey,
          'Content-Type': 'application/octet-stream',
        },
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

// Obtener lista de proyectos disponibles
app.get('/api/projects', async (req, res) => {
  const result = await callRedmineAPI('/projects.json');

  if (result.success) {
    res.json(result.data);
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
    identificador_operacion
  } = req.body;

  // Validaciones básicas
  if (!subject || !description) {
    return res.status(400).json({
      error: 'Campos requeridos faltantes',
      details: 'subject y description son obligatorios'
    });
  }

  try {
    // Subir archivos a Redmine primero
    const uploads = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const uploadResult = await uploadFileToRedmine(file);
        if (uploadResult.success) {
          uploads.push(uploadResult.upload);
        } else {
          console.error('Error al subir archivo:', uploadResult.error);
        }
      }
    }

    // Construir descripción completa con campos personalizados
    let fullDescription = description;

    if (modulo || numero_tramite || identificador_operacion) {
      fullDescription += '\n\n--- Información adicional ---\n';
      if (modulo) fullDescription += `Módulo: ${modulo}\n`;
      if (numero_tramite) fullDescription += `Número de trámite: ${numero_tramite}\n`;
      if (identificador_operacion) fullDescription += `Identificador de operación: ${identificador_operacion}\n`;
    }

    // Estructura del issue para Redmine
    const issueData = {
      issue: {
        project_id: project_id || redmineConfig.defaultProjectId,
        subject: subject,
        description: fullDescription,
        tracker_id: tracker_id || 1, // Por defecto tipo "Bug" o "Soporte"
        priority_id: priority_id || 2, // Por defecto prioridad "Normal"
      }
    };

    // Agregar uploads si hay archivos
    if (uploads.length > 0) {
      issueData.issue.uploads = uploads;
    }

    const result = await callRedmineAPI('/issues.json', 'POST', issueData);

    if (result.success) {
      res.status(201).json({
        message: 'Ticket creado exitosamente',
        ticket: result.data.issue,
        attachmentsUploaded: uploads.length
      });
    } else {
      res.status(result.status || 500).json({
        error: 'Error al crear ticket',
        details: result.error
      });
    }
  } catch (error) {
    console.error('Error en el proceso de creación de ticket:', error);
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor backend ejecutándose en http://localhost:${PORT}`);
  console.log(`Redmine URL configurado: ${redmineConfig.url}`);
});
