const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js/dist/sql-asm.js');
const { transpileSqlServerToSqlite } = require('./sqlParser');

let dbInstance = null;
let SQL = null;
let initPromise = null;

const SQL_FILE_PATH = path.join(__dirname, 'personal_archive_sqlserver.sql');

async function initializeDatabase() {
  if (dbInstance) {
    return dbInstance;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    SQL = await initSqlJs();
    dbInstance = new SQL.Database();

    let sqlContent = '';
    try {
      if (fs.existsSync(SQL_FILE_PATH)) {
        sqlContent = fs.readFileSync(SQL_FILE_PATH, 'utf8');
      }
    } catch (e) {
      console.warn('Could not read SQL file from disk, using embedded fallback:', e.message);
    }

    if (!sqlContent) {
      // Fallback SQL schema & seed
      try {
        const altPath = path.resolve(process.cwd(), 'personal_archive_sqlserver.sql');
        if (fs.existsSync(altPath)) {
          sqlContent = fs.readFileSync(altPath, 'utf8');
        }
      } catch (err) {
        console.warn('Fallback path read failed:', err.message);
      }
    }

    const statements = transpileSqlServerToSqlite(sqlContent);

    for (const stmt of statements) {
      try {
        if (stmt.trim()) {
          dbInstance.run(stmt);
        }
      } catch (err) {
        console.warn(`Warning executing SQL statement: ${stmt.substring(0, 60)}...`);
        console.warn(`Error: ${err.message}`);
      }
    }

    console.log('Database successfully initialized and loaded.');
    return dbInstance;
  })();

  return initPromise;
}

function queryAll(sql, params = []) {
  if (!dbInstance) throw new Error('Database not initialized');
  const stmt = dbInstance.prepare(sql);
  if (params && params.length > 0) {
    stmt.bind(params);
  }
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function execute(sql) {
  if (!dbInstance) throw new Error('Database not initialized');
  return dbInstance.exec(sql);
}

function getDatabaseStats() {
  const totalFiles = queryOne('SELECT COUNT(*) as count, SUM(size_kb) as total_size, AVG(size_kb) as avg_size FROM files') || {};
  const starredFiles = queryOne('SELECT COUNT(*) as count FROM files WHERE is_starred = 1') || { count: 0 };
  const totalTags = queryOne('SELECT COUNT(*) as count FROM tags') || { count: 0 };
  
  const categories = queryAll('SELECT category, COUNT(*) as count, SUM(size_kb) as total_size FROM files GROUP BY category ORDER BY count DESC');
  const fileTypes = queryAll('SELECT file_type, COUNT(*) as count, SUM(size_kb) as total_size FROM files GROUP BY file_type ORDER BY count DESC');
  const tagsSummary = queryAll(`
    SELECT t.name, COUNT(ft.file_id) as count 
    FROM tags t 
    LEFT JOIN file_tags ft ON t.id = ft.tag_id 
    GROUP BY t.id, t.name 
    ORDER BY count DESC
  `);

  return {
    totalFiles: totalFiles.count || 0,
    totalSizeKb: totalFiles.total_size || 0,
    totalSizeMb: ((totalFiles.total_size || 0) / 1024).toFixed(2),
    avgSizeKb: Math.round(totalFiles.avg_size || 0),
    starredCount: starredFiles.count,
    tagsCount: totalTags.count,
    categories,
    fileTypes,
    tagsSummary
  };
}

function getFilesWithTags(whereClause = '', params = [], orderBy = 'f.id ASC', limit = 100) {
  let sql = `
    SELECT 
      f.id,
      f.filename,
      f.file_type,
      f.category,
      f.folder,
      f.size_kb,
      f.date_created,
      f.date_modified,
      f.last_opened,
      f.is_starred,
      f.description,
      GROUP_CONCAT(t.name, ', ') as tags
    FROM files f
    LEFT JOIN file_tags ft ON f.id = ft.file_id
    LEFT JOIN tags t ON ft.tag_id = t.id
  `;

  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
  }

  sql += ` GROUP BY f.id`;

  if (orderBy) {
    sql += ` ORDER BY ${orderBy}`;
  }

  if (limit) {
    sql += ` LIMIT ${limit}`;
  }

  const rows = queryAll(sql, params);
  return rows.map(row => ({
    ...row,
    tags: row.tags ? row.tags.split(', ') : []
  }));
}

module.exports = {
  initializeDatabase,
  queryAll,
  queryOne,
  execute,
  getDatabaseStats,
  getFilesWithTags,
  getDbInstance: () => dbInstance
};
