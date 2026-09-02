const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const queryEngine = require('./queryEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure database is initialized before processing any API requests
app.use(async (req, res, next) => {
  try {
    await db.initializeDatabase();
    next();
  } catch (err) {
    console.error('Failed to initialize database:', err);
    res.status(500).json({ error: 'Database initialization failed: ' + err.message });
  }
});

// GET /api/status - Check DB status
app.get('/api/status', (req, res) => {
  try {
    const stats = db.getDatabaseStats();
    res.json({
      status: 'ready',
      sourceFile: 'personal_archive_sqlserver.sql',
      stats
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/stats - Detailed statistics
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getDatabaseStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tags - List all tags
app.get('/api/tags', (req, res) => {
  try {
    const tags = db.queryAll('SELECT t.id, t.name, COUNT(ft.file_id) as count FROM tags t LEFT JOIN file_tags ft ON t.id = ft.tag_id GROUP BY t.id, t.name ORDER BY count DESC');
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/schema - Table schema inspection
app.get('/api/schema', (req, res) => {
  try {
    const tables = [
      {
        name: 'files',
        columns: [
          { name: 'id', type: 'INTEGER', primaryKey: true },
          { name: 'filename', type: 'TEXT', notNull: true },
          { name: 'file_type', type: 'TEXT', notNull: true },
          { name: 'category', type: 'TEXT', notNull: true },
          { name: 'folder', type: 'TEXT', notNull: true },
          { name: 'size_kb', type: 'INTEGER', notNull: true },
          { name: 'date_created', type: 'TEXT', notNull: true },
          { name: 'date_modified', type: 'TEXT', notNull: true },
          { name: 'last_opened', type: 'TEXT', notNull: false },
          { name: 'is_starred', type: 'INTEGER', notNull: true, default: 0 },
          { name: 'description', type: 'TEXT', notNull: false }
        ]
      },
      {
        name: 'tags',
        columns: [
          { name: 'id', type: 'INTEGER', primaryKey: true },
          { name: 'name', type: 'TEXT', notNull: true, unique: true }
        ]
      },
      {
        name: 'file_tags',
        columns: [
          { name: 'file_id', type: 'INTEGER', primaryKey: true, foreignKey: 'files(id)' },
          { name: 'tag_id', type: 'INTEGER', primaryKey: true, foreignKey: 'tags(id)' }
        ]
      }
    ];
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files - Filtered list of files
app.get('/api/files', (req, res) => {
  try {
    const { category, tag, type, starred, search, sort, order } = req.query;
    const whereParts = [];
    const params = [];

    if (category) {
      whereParts.push(`f.category = ?`);
      params.push(category);
    }

    if (type) {
      whereParts.push(`f.file_type = ?`);
      params.push(type);
    }

    if (starred === '1' || starred === 'true') {
      whereParts.push(`f.is_starred = 1`);
    }

    if (tag) {
      whereParts.push(`f.id IN (SELECT ft.file_id FROM file_tags ft JOIN tags t ON ft.tag_id = t.id WHERE t.name = ?)`);
      params.push(tag);
    }

    if (search) {
      whereParts.push(`(f.filename LIKE ? OR f.description LIKE ? OR f.folder LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = whereParts.join(' AND ');
    let orderBy = 'f.id ASC';

    if (sort === 'size') {
      orderBy = `f.size_kb ${order === 'asc' ? 'ASC' : 'DESC'}`;
    } else if (sort === 'date_created' || sort === 'date') {
      orderBy = `f.date_created ${order === 'asc' ? 'ASC' : 'DESC'}`;
    } else if (sort === 'filename' || sort === 'name') {
      orderBy = `f.filename ${order === 'desc' ? 'DESC' : 'ASC'}`;
    } else if (sort === 'last_opened') {
      orderBy = `f.last_opened ${order === 'asc' ? 'ASC' : 'DESC'}`;
    }

    const files = db.getFilesWithTags(whereClause, params, orderBy, 200);
    res.json({ files, count: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat - Natural language query processing
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const result = queryEngine.processNaturalLanguageQuery(message);
    res.json({
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      answer: `An error occurred while processing your request: ${err.message}`
    });
  }
});

// POST /api/query - Direct SQL execution
app.post('/api/query', (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql) {
      return res.status(400).json({ error: 'SQL string is required' });
    }

    const result = queryEngine.executeRawSql(sql);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Personal Archive SQL Chatbot running on http://localhost:${PORT}`);
    console.log(`📁 Source SQL File: personal_archive_sqlserver.sql`);
    console.log(`====================================================`);
  });
}

module.exports = app;
