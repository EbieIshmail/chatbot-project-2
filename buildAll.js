const fs = require('fs');
const path = require('path');
const db = require('./db');
const { transpileSqlServerToSqlite } = require('./sqlParser');

(async () => {
  await db.initializeDatabase();
  const files = db.queryAll('SELECT * FROM files');
  const tags = db.queryAll('SELECT * FROM tags');
  const fileTags = db.queryAll('SELECT * FROM file_tags');
  const sqlSource = fs.readFileSync(path.join(__dirname, 'personal_archive_sqlserver.sql'), 'utf8');
  const transpiledStatements = transpileSqlServerToSqlite(sqlSource);

  console.log(`Loaded dataset: ${files.length} files, ${tags.length} tags, ${fileTags.length} file_tags`);

  // Build the Core Client Database Engine Code
  const clientEngineCore = `
  const SEED_FILES = ${JSON.stringify(files, null, 2)};
  const SEED_TAGS = ${JSON.stringify(tags, null, 2)};
  const SEED_FILE_TAGS = ${JSON.stringify(fileTags, null, 2)};
  const SQL_STATEMENTS = ${JSON.stringify(transpiledStatements, null, 2)};

  let wasmDb = null;
  let isWasmReady = false;
  let initPromise = null;

  // Build tag lookup map
  const tagMap = new Map();
  SEED_TAGS.forEach(t => tagMap.set(t.id, t.name));

  const fileTagsMap = new Map();
  SEED_FILE_TAGS.forEach(ft => {
    if (!fileTagsMap.has(ft.file_id)) fileTagsMap.set(ft.file_id, []);
    const tagName = tagMap.get(ft.tag_id);
    if (tagName) fileTagsMap.get(ft.file_id).push(tagName);
  });

  // Pre-join files with tags
  const enrichedFiles = SEED_FILES.map(f => ({
    ...f,
    tags: fileTagsMap.get(f.id) || []
  }));

  async function initWasmDatabase() {
    if (isWasmReady && wasmDb) return wasmDb;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        if (typeof window !== 'undefined' && window.initSqlJs) {
          const SQL = await window.initSqlJs({
            locateFile: file => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/' + file
          });
          wasmDb = new SQL.Database();
          for (const stmt of SQL_STATEMENTS) {
            if (stmt && stmt.trim()) {
              try {
                wasmDb.run(stmt);
              } catch (e) {
                console.warn('WASM DB run stmt warning:', e.message);
              }
            }
          }
          isWasmReady = true;
          console.log('✅ In-browser WebAssembly SQLite database initialized');
          return wasmDb;
        }
      } catch (err) {
        console.warn('WASM SQLite init skipped/failed, using fallback relational engine:', err.message);
      }
      return null;
    })();

    return initPromise;
  }

  function queryAll(sql, params = []) {
    if (isWasmReady && wasmDb) {
      try {
        const stmt = wasmDb.prepare(sql);
        if (params && params.length > 0) stmt.bind(params);
        const results = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      } catch (e) {
        console.warn('WASM query error, falling back to JS engine:', e.message);
      }
    }
    return executeFallbackQuery(sql, params);
  }

  function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  function execute(sql) {
    if (isWasmReady && wasmDb) {
      return wasmDb.exec(sql);
    }
    return queryAll(sql);
  }

  function formatSize(kb) {
    if (kb >= 1024) {
      return (kb / 1024).toFixed(2) + ' MB';
    }
    return kb + ' KB';
  }

  function getDatabaseStats() {
    const totalFiles = enrichedFiles.length;
    const totalSizeKb = enrichedFiles.reduce((sum, f) => sum + (f.size_kb || 0), 0);
    const avgSizeKb = Math.round(totalSizeKb / (totalFiles || 1));
    const starredCount = enrichedFiles.filter(f => f.is_starred === 1).length;
    const tagsCount = SEED_TAGS.length;

    // Categories
    const catMap = {};
    enrichedFiles.forEach(f => {
      if (!catMap[f.category]) catMap[f.category] = { count: 0, total_size: 0 };
      catMap[f.category].count++;
      catMap[f.category].total_size += f.size_kb;
    });
    const categories = Object.keys(catMap).map(cat => ({
      category: cat,
      count: catMap[cat].count,
      total_size: catMap[cat].total_size
    })).sort((a, b) => b.count - a.count);

    // File Types
    const typeMap = {};
    enrichedFiles.forEach(f => {
      if (!typeMap[f.file_type]) typeMap[f.file_type] = { count: 0, total_size: 0 };
      typeMap[f.file_type].count++;
      typeMap[f.file_type].total_size += f.size_kb;
    });
    const fileTypes = Object.keys(typeMap).map(type => ({
      file_type: type,
      count: typeMap[type].count,
      total_size: typeMap[type].total_size
    })).sort((a, b) => b.count - a.count);

    // Tags Summary
    const tagCountMap = {};
    SEED_TAGS.forEach(t => { tagCountMap[t.name] = 0; });
    SEED_FILE_TAGS.forEach(ft => {
      const name = tagMap.get(ft.tag_id);
      if (name) tagCountMap[name] = (tagCountMap[name] || 0) + 1;
    });
    const tagsSummary = Object.keys(tagCountMap).map(name => ({
      name: name,
      count: tagCountMap[name]
    })).sort((a, b) => b.count - a.count);

    return {
      totalFiles,
      totalSizeKb,
      totalSizeMb: (totalSizeKb / 1024).toFixed(2),
      avgSizeKb,
      starredCount,
      tagsCount,
      categories,
      fileTypes,
      tagsSummary
    };
  }

  function getFilesWithTags(whereClause = '', params = [], orderBy = 'f.id ASC', limit = 200) {
    let result = enrichedFiles.map(f => ({ ...f, tags: [...f.tags] }));

    if (whereClause) {
      if (whereClause.includes('f.is_starred = 1')) {
        result = result.filter(f => f.is_starred === 1);
      }
      if (whereClause.includes('f.category = ?') && params.length > 0) {
        const cat = params[0];
        result = result.filter(f => f.category === cat);
      }
      if (whereClause.includes('f.file_type = ?') && params.length > 0) {
        const t = params[params.length - 1];
        result = result.filter(f => f.file_type === t);
      }
      if (whereClause.includes('t.name = ?')) {
        const tag = params[params.length - 1];
        result = result.filter(f => f.tags.includes(tag));
      }
    }

    if (orderBy) {
      if (orderBy.includes('size_kb DESC')) result.sort((a, b) => b.size_kb - a.size_kb);
      else if (orderBy.includes('size_kb ASC')) result.sort((a, b) => a.size_kb - b.size_kb);
      else if (orderBy.includes('date_created DESC')) result.sort((a, b) => new Date(b.date_created) - new Date(a.date_created));
      else if (orderBy.includes('date_created ASC')) result.sort((a, b) => new Date(a.date_created) - new Date(b.date_created));
      else if (orderBy.includes('filename DESC')) result.sort((a, b) => b.filename.localeCompare(a.filename));
      else if (orderBy.includes('filename ASC')) result.sort((a, b) => a.filename.localeCompare(b.filename));
    }

    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }

    return result;
  }

  function executeFallbackQuery(rawSql, params = []) {
    const sql = (rawSql || '').trim();
    const upper = sql.toUpperCase();

    // Check common queries
    if (upper.includes('FROM FILES') && upper.includes('GROUP BY CATEGORY')) {
      const stats = getDatabaseStats();
      return stats.categories.map(c => ({
        category: c.category,
        file_count: c.count,
        total_size_kb: c.total_size,
        avg_size_kb: Math.round(c.total_size / c.count)
      }));
    }

    if (upper.includes('FROM FILES') && upper.includes('GROUP BY FILE_TYPE')) {
      const stats = getDatabaseStats();
      return stats.fileTypes.map(ft => ({
        file_type: ft.file_type,
        file_count: ft.count,
        total_size_kb: ft.total_size
      }));
    }

    if (upper.includes('FROM TAGS') || (upper.includes('TAGS T') && upper.includes('FILE_TAGS'))) {
      const stats = getDatabaseStats();
      return stats.tagsSummary.map(t => ({
        tag_name: t.name,
        name: t.name,
        file_count: t.count,
        count: t.count
      }));
    }

    if (upper.includes('SELECT') && upper.includes('COUNT(*)')) {
      if (upper.includes('WHERE IS_STARRED = 1')) {
        const count = enrichedFiles.filter(f => f.is_starred === 1).length;
        return [{ count }];
      }
      const stats = getDatabaseStats();
      return [{
        total_files: stats.totalFiles,
        total_size_kb: stats.totalSizeKb,
        starred_files: stats.starredCount,
        total_tags: stats.tagsCount,
        count: stats.totalFiles,
        total_size: stats.totalSizeKb,
        avg_size: stats.avgSizeKb
      }];
    }

    // Default filtered file query
    let rows = enrichedFiles.map(f => ({
      id: f.id,
      filename: f.filename,
      file_type: f.file_type,
      category: f.category,
      folder: f.folder,
      size_kb: f.size_kb,
      date_created: f.date_created,
      date_modified: f.date_modified,
      last_opened: f.last_opened,
      is_starred: f.is_starred,
      description: f.description,
      tags: f.tags.join(', ')
    }));

    if (upper.includes('WHERE')) {
      if (upper.includes('LAST_OPENED IS NULL')) {
        rows = rows.filter(f => !f.last_opened);
      } else if (upper.includes('LAST_OPENED IS NOT NULL')) {
        rows = rows.filter(f => f.last_opened);
      }
      if (upper.includes('IS_STARRED = 1') || upper.includes('IS_STARRED=1')) {
        rows = rows.filter(f => f.is_starred === 1);
      }
      const sizeGtMatch = upper.match(/SIZE_KB\\s*>\\s*(\\d+)/);
      if (sizeGtMatch) {
        const minSize = parseInt(sizeGtMatch[1], 10);
        rows = rows.filter(f => f.size_kb > minSize);
      }
      const sizeLtMatch = upper.match(/SIZE_KB\\s*<\\s*(\\d+)/);
      if (sizeLtMatch) {
        const maxSize = parseInt(sizeLtMatch[1], 10);
        rows = rows.filter(f => f.size_kb < maxSize);
      }
      const catMatch = sql.match(/category\\s*=\\s*'([^']+)'/i);
      if (catMatch) {
        rows = rows.filter(f => f.category.toLowerCase() === catMatch[1].toLowerCase());
      }
      const typeMatch = sql.match(/file_type\\s*=\\s*'([^']+)'/i);
      if (typeMatch) {
        rows = rows.filter(f => f.file_type.toLowerCase() === typeMatch[1].toLowerCase());
      }
      const likeMatch = sql.match(/(?:filename|description|folder)\\s+LIKE\\s+'%([^%']+)'/i);
      if (likeMatch) {
        const term = likeMatch[1].replace(/%/g, '').toLowerCase();
        rows = rows.filter(f => (f.filename + ' ' + (f.description || '') + ' ' + f.folder).toLowerCase().includes(term));
      }
    }

    if (upper.includes('ORDER BY')) {
      if (upper.includes('SIZE_KB DESC')) rows.sort((a, b) => b.size_kb - a.size_kb);
      else if (upper.includes('SIZE_KB ASC')) rows.sort((a, b) => a.size_kb - b.size_kb);
      else if (upper.includes('LAST_OPENED DESC')) rows.sort((a, b) => (b.last_opened || '').localeCompare(a.last_opened || ''));
      else if (upper.includes('DATE_CREATED DESC')) rows.sort((a, b) => (b.date_created || '').localeCompare(a.date_created || ''));
      else if (upper.includes('FILENAME ASC')) rows.sort((a, b) => a.filename.localeCompare(b.filename));
    }

    const limitMatch = upper.match(/LIMIT\\s+(\\d+)/);
    if (limitMatch) {
      const lim = parseInt(limitMatch[1], 10);
      rows = rows.slice(0, lim);
    }

    return rows;
  }

  function cleanText(text) {
    return (text || '').toLowerCase().trim();
  }

  // --------------------------------------------------------
  // NLP Query Engine
  // --------------------------------------------------------
  function processNaturalLanguageQuery(userInput) {
    const query = cleanText(userInput);
    let sql = '';

    // 1. STATS / SUMMARY / OVERVIEW
    if (
      query === 'summary' ||
      query === 'overview' ||
      query === 'stats' ||
      query.includes('how many total files') ||
      query.includes('how many files do i have') ||
      query === 'how many files' ||
      query.includes('storage breakdown') ||
      query.includes('disk space') ||
      query.includes('archive summary')
    ) {
      const stats = getDatabaseStats();
      sql = 'SELECT (SELECT COUNT(*) FROM files) AS total_files, (SELECT SUM(size_kb) FROM files) AS total_size_kb, (SELECT COUNT(*) FROM files WHERE is_starred = 1) AS starred_files, (SELECT COUNT(*) FROM tags) AS total_tags;';
      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '📊 Personal Archive Overview & Statistics',
        answer: 'Your archive contains **' + stats.totalFiles + ' files** totaling **' + stats.totalSizeMb + ' MB** across **' + stats.categories.length + ' categories**. You have **' + stats.starredCount + ' starred items** and **' + stats.tagsCount + ' active tags**.',
        stats: stats,
        type: 'summary',
        rows: stats.categories.map(c => ({
          Category: c.category,
          'File Count': c.count,
          'Storage Used': formatSize(c.total_size)
        }))
      };
    }

    // 2. CATEGORY BREAKDOWN
    if (
      query === 'categories' ||
      query.includes('by category') || 
      query.includes('list categories') || 
      query.includes('show categories') || 
      query.includes('categories breakdown') ||
      query.includes('all categories')
    ) {
      sql = 'SELECT category, COUNT(*) AS file_count, SUM(size_kb) AS total_size_kb, ROUND(AVG(size_kb), 1) AS avg_size_kb FROM files GROUP BY category ORDER BY file_count DESC, total_size_kb DESC;';
      const rows = queryAll(sql);
      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '📁 Files Grouped by Category',
        answer: 'Found **' + rows.length + ' categories** in your archive. Here is the breakdown:',
        rows: rows.map(r => ({
          Category: r.category,
          'File Count': r.file_count || r.count,
          'Total Size': formatSize(r.total_size_kb || r.total_size),
          'Avg Size': formatSize(Math.round(r.avg_size_kb || 0))
        }))
      };
    }

    // 3. FILE TYPE BREAKDOWN
    if (
      query.includes('by type') || 
      query.includes('by file type') || 
      query.includes('file types') || 
      query.includes('file extensions') ||
      query.includes('format breakdown')
    ) {
      sql = 'SELECT file_type, COUNT(*) AS file_count, SUM(size_kb) AS total_size_kb FROM files GROUP BY file_type ORDER BY file_count DESC;';
      const rows = queryAll(sql);
      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '📄 Files Grouped by Type',
        answer: 'Breakdown of your files by file extension:',
        rows: rows.map(r => ({
          'File Type': r.file_type,
          'Count': r.file_count || r.count,
          'Total Storage': formatSize(r.total_size_kb || r.total_size)
        }))
      };
    }

    // 4. TAGS LIST & BREAKDOWN
    if (
      query === 'tags' ||
      query.includes('all tags') || 
      query.includes('list tags') || 
      query.includes('show tags') || 
      query.includes('tag breakdown') ||
      query.includes('tag statistics')
    ) {
      sql = 'SELECT t.name AS tag_name, COUNT(ft.file_id) AS file_count FROM tags t LEFT JOIN file_tags ft ON t.id = ft.tag_id GROUP BY t.id, t.name ORDER BY file_count DESC;';
      const rows = queryAll(sql);
      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '🏷️ Active Tags & Counts',
        answer: 'Found **' + rows.length + ' tags** across the database:',
        rows: rows.map(r => ({
          'Tag Name': '#' + (r.tag_name || r.name),
          'Files Tagged': r.file_count || r.count
        }))
      };
    }

    // 5. LARGEST / SMALLEST FILES
    if (
      query.includes('largest') || 
      query.includes('biggest') || 
      query.includes('heaviest') || 
      query.includes('most storage') ||
      (query.includes('top') && query.includes('files') && query.includes('size'))
    ) {
      sql = 'SELECT f.id, f.filename, f.file_type, f.category, f.size_kb, f.folder, GROUP_CONCAT(t.name, \\', \\') AS tags FROM files f LEFT JOIN file_tags ft ON f.id = ft.file_id LEFT JOIN tags t ON ft.tag_id = t.id GROUP BY f.id ORDER BY f.size_kb DESC LIMIT 10;';
      const rows = queryAll(sql);
      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '💾 Top 10 Largest Files',
        answer: 'The largest file in your archive is **' + (rows[0] ? rows[0].filename : '') + '** (' + formatSize(rows[0] ? rows[0].size_kb : 0) + ').',
        rows: rows.map(r => ({
          Filename: r.filename,
          Category: r.category,
          Type: r.file_type,
          Size: formatSize(r.size_kb),
          Folder: r.folder,
          Tags: r.tags || 'None'
        }))
      };
    }

    if (query.includes('smallest')) {
      sql = 'SELECT f.id, f.filename, f.file_type, f.category, f.size_kb, f.folder, GROUP_CONCAT(t.name, \\', \\') AS tags FROM files f LEFT JOIN file_tags ft ON f.id = ft.file_id LEFT JOIN tags t ON ft.tag_id = t.id GROUP BY f.id ORDER BY f.size_kb ASC LIMIT 10;';
      const rows = queryAll(sql);
      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '💾 Top 10 Smallest Files',
        answer: 'The smallest file in your archive is **' + (rows[0] ? rows[0].filename : '') + '** (' + formatSize(rows[0] ? rows[0].size_kb : 0) + ').',
        rows: rows.map(r => ({
          Filename: r.filename,
          Category: r.category,
          Type: r.file_type,
          Size: formatSize(r.size_kb),
          Folder: r.folder,
          Tags: r.tags || 'None'
        }))
      };
    }

    // 6. NEVER OPENED
    if (
      query.includes('never opened') || 
      query.includes('not opened') || 
      query.includes('unopened') ||
      query.includes('no last opened')
    ) {
      sql = 'SELECT f.id, f.filename, f.file_type, f.category, f.folder, f.size_kb, f.date_created, GROUP_CONCAT(t.name, \\', \\') AS tags FROM files f LEFT JOIN file_tags ft ON f.id = ft.file_id LEFT JOIN tags t ON ft.tag_id = t.id WHERE f.last_opened IS NULL GROUP BY f.id ORDER BY f.date_created DESC;';
      const rows = queryAll(sql);
      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '📂 Files Never Opened',
        answer: 'Found **' + rows.length + ' files** with no record of being opened (\`last_opened IS NULL\`):',
        rows: rows.map(r => ({
          Filename: r.filename,
          Category: r.category,
          Type: r.file_type,
          Size: formatSize(r.size_kb),
          Created: r.date_created,
          Tags: r.tags || 'None'
        }))
      };
    }

    // 7. RECENTLY OPENED
    if (query.includes('recently opened') || query.includes('last opened')) {
      sql = 'SELECT f.id, f.filename, f.file_type, f.category, f.last_opened, f.size_kb, GROUP_CONCAT(t.name, \\', \\') AS tags FROM files f LEFT JOIN file_tags ft ON f.id = ft.file_id LEFT JOIN tags t ON ft.tag_id = t.id WHERE f.last_opened IS NOT NULL GROUP BY f.id ORDER BY f.last_opened DESC LIMIT 10;';
      const rows = queryAll(sql);
      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '🕒 Most Recently Opened Files',
        answer: 'Here are the top **' + rows.length + ' files** by \`last_opened\` date:',
        rows: rows.map(r => ({
          Filename: r.filename,
          Category: r.category,
          'Last Opened': r.last_opened,
          Size: formatSize(r.size_kb),
          Tags: r.tags || 'None'
        }))
      };
    }

    // 8. DYNAMIC MULTI-CRITERIA FILTER PARSING
    const availableTags = ['urgent', 'important', 'archived', 'shared', 'expired', 'renew-soon', 'signed', 'draft', 'confidential', 'favorite'];
    const availableCategories = ['Tax', 'Invoice', 'Contract', 'Receipt', 'Identification', 'Insurance', 'Medical', 'Education', 'Work', 'Personal', 'Photo', 'Warranty'];
    const availableTypes = ['PDF', 'JPG', 'DOCX', 'XLSX', 'PNG', 'TXT'];

    const matchedTags = [];
    for (const tag of availableTags) {
      const regex = new RegExp('\\\\b' + tag + '\\\\b', 'i');
      if (regex.test(query) || (tag === 'renew-soon' && (query.includes('renew') || query.includes('renewal')))) {
        matchedTags.push(tag);
      }
    }

    const matchedCategories = [];
    for (const cat of availableCategories) {
      const regex = new RegExp('\\\\b' + cat.toLowerCase() + '\\\\b|\\\\b' + cat.toLowerCase() + 's\\\\b', 'i');
      if (regex.test(query)) {
        matchedCategories.push(cat);
      }
    }
    // Category aliases with word boundaries
    if (/\\b(id|ids|identification|passport|license|licence)\\b/i.test(query)) {
      if (!matchedCategories.includes('Identification')) matchedCategories.push('Identification');
    }
    if (/\\b(health|doctor|dentist|vaccine|vaccination|prescription|medical)\\b/i.test(query)) {
      if (!matchedCategories.includes('Medical')) matchedCategories.push('Medical');
    }
    if (/\\b(school|degree|diploma|course|academic|transcript|education)\\b/i.test(query)) {
      if (!matchedCategories.includes('Education')) matchedCategories.push('Education');
    }
    if (/\\b(job|resume|salary|payslip|employment|work)\\b/i.test(query)) {
      if (!matchedCategories.includes('Work')) matchedCategories.push('Work');
    }
    if (/\\b(photo|photos|picture|pictures)\\b/i.test(query)) {
      if (!matchedCategories.includes('Photo')) matchedCategories.push('Photo');
    }
    if (/\\b(tax|taxes|w2|deduction)\\b/i.test(query)) {
      if (!matchedCategories.includes('Tax')) matchedCategories.push('Tax');
    }
    if (/\\b(invoice|invoices|billing)\\b/i.test(query)) {
      if (!matchedCategories.includes('Invoice')) matchedCategories.push('Invoice');
    }
    if (/\\b(contract|contracts|lease|nda|agreement)\\b/i.test(query)) {
      if (!matchedCategories.includes('Contract')) matchedCategories.push('Contract');
    }
    if (/\\b(receipt|receipts)\\b/i.test(query)) {
      if (!matchedCategories.includes('Receipt')) matchedCategories.push('Receipt');
    }
    if (/\\b(warranty|warranties)\\b/i.test(query)) {
      if (!matchedCategories.includes('Warranty')) matchedCategories.push('Warranty');
    }
    if (/\\b(insurance|policy|claim)\\b/i.test(query)) {
      if (!matchedCategories.includes('Insurance')) matchedCategories.push('Insurance');
    }

    const matchedTypes = [];
    for (const t of availableTypes) {
      const regex = new RegExp('\\\\b' + t.toLowerCase() + '\\\\b', 'i');
      if (regex.test(query)) {
        matchedTypes.push(t);
      }
    }
    if (/\\b(image|images)\\b/i.test(query) && matchedCategories.length === 0) {
      matchedTypes.push('JPG', 'PNG');
    }
    if (/\\b(excel|spreadsheet|spreadsheets)\\b/i.test(query)) {
      matchedTypes.push('XLSX');
    }
    if (/\\b(word|docx)\\b/i.test(query)) {
      matchedTypes.push('DOCX');
    }

    // Starred filter
    let isStarredFilter = false;
    if (/\\b(starred|star|favorites?|bookmarked)\\b/i.test(query)) {
      isStarredFilter = true;
    }

    // Size filters
    let sizeCondition = null;
    let sizeMbMatch = query.match(/(?:>|greater than|larger than|more than|over|above)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:mb|megabytes?)/i);
    if (sizeMbMatch) {
      const kb = Math.round(parseFloat(sizeMbMatch[1]) * 1024);
      sizeCondition = 'f.size_kb > ' + kb;
    }
    let sizeKbMatch = query.match(/(?:>|greater than|larger than|more than|over|above)\\s*(\\d+)\\s*(?:kb|kilobytes?)/i);
    if (sizeKbMatch) {
      sizeCondition = 'f.size_kb > ' + parseInt(sizeKbMatch[1], 10);
    }
    let sizeUnderMatch = query.match(/(?:<|less than|smaller than|under|below)\\s*(\\d+(?:\\.\\d+)?)\\s*(mb|kb|megabytes?|kilobytes?)/i);
    if (sizeUnderMatch) {
      let kb = parseFloat(sizeUnderMatch[1]);
      if (sizeUnderMatch[2].startsWith('m')) kb *= 1024;
      sizeCondition = 'f.size_kb < ' + Math.round(kb);
    }

    // Year filters
    const yearMatch = query.match(/\\b(202[1-6])\\b/);
    let yearCondition = null;
    if (yearMatch) {
      const year = yearMatch[1];
      if (query.includes('modified')) {
        yearCondition = "f.date_modified LIKE '" + year + "%'";
      } else if (query.includes('opened')) {
        yearCondition = "f.last_opened LIKE '" + year + "%'";
      } else {
        yearCondition = "(f.date_created LIKE '" + year + "%' OR f.filename LIKE '%" + year + "%' OR f.folder LIKE '%" + year + "%')";
      }
    }

    // Stop words
    const stopWords = new Set([
      'show', 'me', 'all', 'the', 'files', 'file', 'find', 'get', 'list', 'what', 'which', 'are', 'in', 'my', 'is', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'to', 'from', 'having', 'tagged', 'category', 'type', 'format', 'documents', 'document', 'archive', 'records', 'items', 'please', 'give', 'any', 'that', 'than', 'larger', 'greater', 'smaller', 'less', 'more', 'over', 'under', 'mb', 'kb', 'megabytes', 'kilobytes', 'size', 'created', 'modified', 'opened', 'date', 'dates', 'starred', 'star', 'stars', 'favorite', 'favorites', 'bookmarked',
      'renew', 'renewal', 'renew-soon', 'urgent', 'important', 'archived', 'shared', 'expired', 'signed', 'draft', 'confidential', 'contain', 'containing'
    ]);

    let cleanedForKw = query
      .replace(/\\b\\d+(?:\\.\\d+)?\\s*(?:mb|kb|megabytes?|kilobytes?)\\b/gi, '')
      .replace(/\\b202[1-6]\\b/g, '')
      .replace(/[^a-z0-9_]/g, ' ');

    const searchKeywords = [];
    const rawWords = cleanedForKw.split(/\\s+/);
    for (const w of rawWords) {
      if (
        w.length > 2 && 
        !stopWords.has(w) && 
        !availableTags.includes(w) && 
        !availableCategories.map(c => c.toLowerCase()).includes(w) &&
        !availableTypes.map(t => t.toLowerCase()).includes(w) &&
        !['largest', 'biggest', 'smallest'].includes(w)
      ) {
        searchKeywords.push(w);
      }
    }

    const whereParts = [];

    if (isStarredFilter) {
      whereParts.push('f.is_starred = 1');
    }

    if (matchedTags.length > 0) {
      const tagList = matchedTags.map(t => "'" + t + "'").join(', ');
      whereParts.push('f.id IN (SELECT ft.file_id FROM file_tags ft JOIN tags t ON ft.tag_id = t.id WHERE t.name IN (' + tagList + '))');
    }

    if (matchedCategories.length > 0) {
      const catList = matchedCategories.map(c => "'" + c + "'").join(', ');
      whereParts.push('f.category IN (' + catList + ')');
    }

    const uniqueTypes = Array.from(new Set(matchedTypes));
    if (uniqueTypes.length > 0) {
      const typeList = uniqueTypes.map(t => "'" + t + "'").join(', ');
      whereParts.push('f.file_type IN (' + typeList + ')');
    }

    if (sizeCondition) {
      whereParts.push(sizeCondition);
    }

    if (yearCondition) {
      whereParts.push(yearCondition);
    }

    if (searchKeywords.length > 0) {
      const kwConditions = searchKeywords.map(kw => "(f.filename LIKE '%" + kw + "%' OR f.description LIKE '%" + kw + "%' OR f.folder LIKE '%" + kw + "%')");
      whereParts.push('(' + kwConditions.join(' OR ') + ')');
    }

    if (whereParts.length > 0) {
      const whereSql = whereParts.join(' AND ');
      sql = 'SELECT f.id, f.filename, f.file_type, f.category, f.folder, f.size_kb, f.date_created, f.date_modified, f.last_opened, f.is_starred, f.description, GROUP_CONCAT(t.name, \\', \\') AS tags FROM files f LEFT JOIN file_tags ft ON f.id = ft.file_id LEFT JOIN tags t ON ft.tag_id = t.id WHERE ' + whereSql + ' GROUP BY f.id ORDER BY f.date_created DESC;';

      let rows = [];
      if (isWasmReady && wasmDb) {
        rows = queryAll(sql);
      } else {
        // Fallback filter
        rows = enrichedFiles.filter(f => {
          if (isStarredFilter && f.is_starred !== 1) return false;
          if (matchedTags.length > 0 && !matchedTags.some(t => f.tags.includes(t))) return false;
          if (matchedCategories.length > 0 && !matchedCategories.includes(f.category)) return false;
          if (uniqueTypes.length > 0 && !uniqueTypes.includes(f.file_type)) return false;
          if (sizeCondition) {
            if (sizeMbMatch && f.size_kb <= Math.round(parseFloat(sizeMbMatch[1]) * 1024)) return false;
            if (sizeKbMatch && f.size_kb <= parseInt(sizeKbMatch[1], 10)) return false;
            if (sizeUnderMatch) {
              let kb = parseFloat(sizeUnderMatch[1]);
              if (sizeUnderMatch[2].startsWith('m')) kb *= 1024;
              if (f.size_kb >= Math.round(kb)) return false;
            }
          }
          if (yearMatch) {
            const yr = yearMatch[1];
            if (query.includes('modified') && !f.date_modified.startsWith(yr)) return false;
            else if (query.includes('opened') && (!f.last_opened || !f.last_opened.startsWith(yr))) return false;
            else if (!f.date_created.startsWith(yr) && !f.filename.includes(yr) && !f.folder.includes(yr)) return false;
          }
          if (searchKeywords.length > 0) {
            const fn = (f.filename + ' ' + (f.description || '') + ' ' + f.folder).toLowerCase();
            if (!searchKeywords.some(kw => fn.includes(kw))) return false;
          }
          return true;
        }).map(f => ({ ...f, tags: f.tags.join(', ') }));
      }

      return {
        success: true,
        query: userInput,
        sql: sql.trim(),
        title: '🔍 Found ' + rows.length + ' file' + (rows.length === 1 ? '' : 's'),
        answer: rows.length > 0 
          ? 'Found **' + rows.length + ' matching file' + (rows.length === 1 ? '' : 's') + '** for your query:'
          : 'No files matched your criteria (' + whereSql + '). Try a broader search.',
        rows: rows.map(r => ({
          Filename: r.filename,
          Category: r.category,
          Type: r.file_type,
          Size: formatSize(r.size_kb),
          Folder: r.folder,
          Created: r.date_created,
          'Last Opened': r.last_opened || 'Never',
          Starred: r.is_starred ? '⭐ Yes' : 'No',
          Tags: r.tags || 'None',
          Description: r.description || ''
        }))
      };
    }

    // Default fallback
    const defaultSql = 'SELECT f.id, f.filename, f.file_type, f.category, f.size_kb, f.folder FROM files f ORDER BY f.id ASC LIMIT 10;';
    const top10 = queryAll(defaultSql);
    return {
      success: true,
      query: userInput,
      sql: defaultSql.trim(),
      title: '💡 Personal Archive Assistant',
      answer: 'I can help you search, filter, and analyze any data in your \`personal_archive_sqlserver.sql\` database.\\n\\nTry questions like:\\n- **\"Show me all confidential documents\"**\\n- **\"Which files are larger than 2MB?\"**\\n- **\"List my invoices from 2024\"**\\n- **\"What are my starred files?\"**\\n- **\"Storage breakdown by category\"**\\n- **\"Files never opened\"**',
      rows: (top10 || []).map(r => ({
        Filename: r.filename,
        Category: r.category,
        Type: r.file_type,
        Size: formatSize(r.size_kb),
        Folder: r.folder
      }))
    };
  }

  function executeRawSql(rawSql) {
    try {
      const trimmed = (rawSql || '').trim();
      if (!trimmed) {
        throw new Error('Empty SQL query');
      }
      
      const rows = queryAll(trimmed);
      return {
        success: true,
        sql: trimmed,
        rowCount: rows ? rows.length : 0,
        rows: rows || [],
        columns: rows && rows.length > 0 ? Object.keys(rows[0]) : []
      };
    } catch (err) {
      return {
        success: false,
        sql: rawSql,
        error: err.message
      };
    }
  }

  const schemaTables = [
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

  const clientDbInstance = {
    initWasmDatabase,
    queryAll,
    queryOne,
    execute,
    formatSize,
    getDatabaseStats,
    getFilesWithTags,
    processNaturalLanguageQuery,
    executeRawSql,
    getSchema: () => schemaTables,
    getTags: () => {
      const stats = getDatabaseStats();
      return stats.tagsSummary;
    },
    isWasmReady: () => isWasmReady
  };
`;

  // 1. Generate public/dbClient.js
  const dbClientJs = `/**
 * Personal Archive Database & Query Engine for Browser & Cloudflare Worker
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.clientDb = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  ${clientEngineCore}
  return clientDbInstance;
}));
`;
  fs.writeFileSync(path.join(__dirname, 'public', 'dbClient.js'), dbClientJs);

  // 2. Generate self-contained _worker.js
  const workerJs = `/**
 * Cloudflare Worker router for Personal Archive
 */
${clientEngineCore}
const clientDb = clientDbInstance;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API Routing
    if (url.pathname.startsWith('/api/')) {
      const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { headers });
      }

      if (url.pathname === '/api/status') {
        return new Response(JSON.stringify({
          status: 'ready',
          sourceFile: 'personal_archive_sqlserver.sql',
          stats: clientDb.getDatabaseStats()
        }), { headers });
      }

      if (url.pathname === '/api/stats') {
        return new Response(JSON.stringify(clientDb.getDatabaseStats()), { headers });
      }

      if (url.pathname === '/api/tags') {
        return new Response(JSON.stringify(clientDb.getTags()), { headers });
      }

      if (url.pathname === '/api/schema') {
        return new Response(JSON.stringify({ tables: clientDb.getSchema() }), { headers });
      }

      if (url.pathname === '/api/files') {
        const category = url.searchParams.get('category');
        const type = url.searchParams.get('type');
        const starred = url.searchParams.get('starred');
        const tag = url.searchParams.get('tag');
        const search = url.searchParams.get('search');

        let filesList = clientDb.getFilesWithTags();

        if (category) filesList = filesList.filter(f => f.category === category);
        if (type) filesList = filesList.filter(f => f.file_type === type);
        if (starred === '1' || starred === 'true') filesList = filesList.filter(f => f.is_starred === 1);
        if (tag) filesList = filesList.filter(f => f.tags && f.tags.includes(tag));
        if (search) {
          const s = search.toLowerCase();
          filesList = filesList.filter(f => f.filename.toLowerCase().includes(s) || (f.description || '').toLowerCase().includes(s));
        }

        return new Response(JSON.stringify({ files: filesList, count: filesList.length }), { headers });
      }

      if (url.pathname === '/api/chat' && request.method === 'POST') {
        try {
          const body = await request.json();
          const message = body.message;
          const result = clientDb.processNaturalLanguageQuery(message);
          return new Response(JSON.stringify(result), { headers });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400, headers });
        }
      }

      if (url.pathname === '/api/query' && request.method === 'POST') {
        try {
          const body = await request.json();
          const sql = body.sql;
          const result = clientDb.executeRawSql(sql);
          return new Response(JSON.stringify(result), { headers });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400, headers });
        }
      }

      return new Response(JSON.stringify({ error: 'Endpoint not found' }), { status: 404, headers });
    }

    // Static Asset Serving
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
`;
  fs.writeFileSync(path.join(__dirname, '_worker.js'), workerJs);
  fs.writeFileSync(path.join(__dirname, 'public', '_worker.js'), workerJs);

  // 3. Generate self-contained public/app.js
  const appJsTemplate = `/**
 * Personal Archive AI Assistant & SQL Explorer Frontend
 * Embedded with zero-latency in-browser SQLite & relational engine.
 */

// Embedded Client Database Engine
${clientEngineCore}
window.clientDb = clientDbInstance;

// Application State
const state = {
  activeTab: 'chat-tab',
  files: [],
  filteredFiles: [],
  categories: [],
  tags: [],
  stats: null,
  schema: null,
  viewMode: 'cards', // 'cards' | 'table'
  chatHistory: []
};

// DOM Elements
const elements = {
  // Navigation
  navButtons: document.querySelectorAll('.nav-item'),
  tabs: document.querySelectorAll('.tab-content'),

  // Sidebar stats
  sidebarTotalFiles: document.getElementById('sidebar-total-files'),
  sidebarTotalSize: document.getElementById('sidebar-total-size'),
  sidebarStarredCount: document.getElementById('sidebar-starred-count'),
  sidebarTagsCount: document.getElementById('sidebar-tags-count'),
  sidebarCatCount: document.getElementById('sidebar-cat-count'),

  // Chat Tab
  chatMessages: document.getElementById('chat-messages'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  suggestionChips: document.getElementById('suggestion-chips'),
  btnClearChat: document.getElementById('btn-clear-chat'),

  // Explorer Tab
  explorerSearch: document.getElementById('explorer-search'),
  filterCategory: document.getElementById('filter-category'),
  filterTag: document.getElementById('filter-tag'),
  filterType: document.getElementById('filter-type'),
  sortFiles: document.getElementById('sort-files'),
  filterStarred: document.getElementById('filter-starred'),
  resultsCount: document.getElementById('explorer-results-count'),
  cardsContainer: document.getElementById('explorer-cards-container'),
  tableContainer: document.getElementById('explorer-table-container'),
  tableBody: document.getElementById('explorer-table-body'),
  viewCardsBtn: document.getElementById('view-cards-btn'),
  viewTableBtn: document.getElementById('view-table-btn'),

  // Analytics Tab
  kpiFiles: document.getElementById('kpi-files'),
  kpiStorage: document.getElementById('kpi-storage'),
  kpiStarred: document.getElementById('kpi-starred'),
  kpiTags: document.getElementById('kpi-tags'),
  categoryChartList: document.getElementById('category-chart-list'),
  fileTypeChartList: document.getElementById('file-type-chart-list'),
  tagCloudList: document.getElementById('tag-cloud-list'),

  // SQL Studio
  schemaTree: document.getElementById('schema-tree'),
  sqlEditor: document.getElementById('sql-editor'),
  btnRunSql: document.getElementById('btn-run-sql'),
  btnFormatSql: document.getElementById('btn-format-sql'),
  queryMetaStatus: document.getElementById('query-meta-status'),
  studioResultsTable: document.getElementById('studio-results-table'),
  btnExportSql: document.getElementById('btn-export-sql'),

  // Modal
  fileModal: document.getElementById('file-modal'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalType: document.getElementById('modal-type'),
  modalFilename: document.getElementById('modal-filename'),
  modalCategory: document.getElementById('modal-category'),
  modalSize: document.getElementById('modal-size'),
  modalFolder: document.getElementById('modal-folder'),
  modalStarred: document.getElementById('modal-starred'),
  modalCreated: document.getElementById('modal-created'),
  modalModified: document.getElementById('modal-modified'),
  modalOpened: document.getElementById('modal-opened'),
  modalTags: document.getElementById('modal-tags'),
  modalDescription: document.getElementById('modal-description')
};

// Utilities
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdown(text) {
  if (!text) return '';
  let formatted = escapeHtml(text).replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  formatted = formatted.replace(/\\n/g, '<br>');
  return formatted;
}

// Safe JSON fetch helper that never crashes
async function safeFetchJson(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// ----------------------------------------------------
// INITIALIZATION & API FETCHING
// ----------------------------------------------------
async function initializeApp() {
  setupEventListeners();
  addWelcomeMessage();
  
  // Try initializing WebAssembly SQLite in the background
  if (window.clientDb && window.clientDb.initWasmDatabase) {
    window.clientDb.initWasmDatabase().catch(() => {});
  }
  
  await loadDatabaseData();
}

async function loadDatabaseData() {
  // 1. Immediately populate from in-browser client database (0ms delay)
  if (window.clientDb) {
    state.stats = window.clientDb.getDatabaseStats();
    state.files = window.clientDb.getFilesWithTags();
    state.filteredFiles = [...state.files];
    state.tags = window.clientDb.getTags();
    state.schema = window.clientDb.getSchema();

    updateSidebarStats();
    populateFilterDropdowns();
    renderExplorerFiles();
    renderAnalytics();
    renderSchemaTree();
  }

  // 2. Optionally sync with backend API if available
  try {
    const [statusRes, filesRes, tagsRes, schemaRes] = await Promise.all([
      safeFetchJson('/api/status'),
      safeFetchJson('/api/files'),
      safeFetchJson('/api/tags'),
      safeFetchJson('/api/schema')
    ]);

    if (statusRes && statusRes.stats && filesRes && filesRes.files) {
      state.stats = statusRes.stats;
      state.files = filesRes.files;
      state.filteredFiles = [...state.files];
      if (tagsRes) state.tags = tagsRes;
      if (schemaRes && schemaRes.tables) state.schema = schemaRes.tables;

      updateSidebarStats();
      populateFilterDropdowns();
      renderExplorerFiles();
      renderAnalytics();
      renderSchemaTree();
    }
  } catch (err) {
    // Running offline / client-side
  }
}

function updateSidebarStats() {
  if (!state.stats) return;
  elements.sidebarTotalFiles.textContent = state.stats.totalFiles;
  elements.sidebarTotalSize.textContent = state.stats.totalSizeMb + ' MB';
  elements.sidebarStarredCount.textContent = state.stats.starredCount;
  elements.sidebarTagsCount.textContent = state.stats.tagsCount;
  elements.sidebarCatCount.textContent = state.stats.categories.length;

  // KPI cards
  elements.kpiFiles.textContent = state.stats.totalFiles;
  elements.kpiStorage.textContent = state.stats.totalSizeMb + ' MB';
  elements.kpiStarred.textContent = state.stats.starredCount;
  elements.kpiTags.textContent = state.stats.tagsCount;
}

function populateFilterDropdowns() {
  // Categories
  if (state.stats && state.stats.categories) {
    elements.filterCategory.innerHTML = '<option value="">All Categories (12)</option>';
    state.stats.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.category;
      opt.textContent = c.category + ' (' + c.count + ')';
      elements.filterCategory.appendChild(opt);
    });
  }

  // Tags
  if (state.tags) {
    elements.filterTag.innerHTML = '<option value="">All Tags (10)</option>';
    state.tags.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = '#' + t.name + ' (' + t.count + ')';
      elements.filterTag.appendChild(opt);
    });
  }

  // File Types
  if (state.stats && state.stats.fileTypes) {
    elements.filterType.innerHTML = '<option value="">All Types (PDF, JPG...)</option>';
    state.stats.fileTypes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.file_type;
      opt.textContent = t.file_type + ' (' + t.count + ')';
      elements.filterType.appendChild(opt);
    });
  }
}

// ----------------------------------------------------
// EVENT LISTENERS
// ----------------------------------------------------
function setupEventListeners() {
  // Tab Switching
  elements.navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      elements.navButtons.forEach(b => b.classList.remove('active'));
      elements.tabs.forEach(t => t.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(targetTab).classList.add('active');
      state.activeTab = targetTab;
    });
  });

  // Chat Form Submit
  elements.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleChatSubmit();
  });

  // Chat textarea Enter key
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });

  // Clear Chat Button
  elements.btnClearChat.addEventListener('click', () => {
    elements.chatMessages.innerHTML = '';
    addWelcomeMessage();
  });

  // Suggestion Chips Click
  elements.suggestionChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const prompt = chip.getAttribute('data-prompt');
      elements.chatInput.value = prompt;
      handleChatSubmit();
    }
  });

  // Explorer Filters & Search
  elements.explorerSearch.addEventListener('input', applyExplorerFilters);
  elements.filterCategory.addEventListener('change', applyExplorerFilters);
  elements.filterTag.addEventListener('change', applyExplorerFilters);
  elements.filterType.addEventListener('change', applyExplorerFilters);
  elements.sortFiles.addEventListener('change', applyExplorerFilters);
  elements.filterStarred.addEventListener('change', applyExplorerFilters);

  // View Mode Toggle
  elements.viewCardsBtn.addEventListener('click', () => {
    elements.viewCardsBtn.classList.add('active');
    elements.viewTableBtn.classList.remove('active');
    elements.cardsContainer.classList.remove('hidden');
    elements.tableContainer.classList.add('hidden');
    state.viewMode = 'cards';
  });

  elements.viewTableBtn.addEventListener('click', () => {
    elements.viewTableBtn.classList.add('active');
    elements.viewCardsBtn.classList.remove('active');
    elements.cardsContainer.classList.add('hidden');
    elements.tableContainer.classList.remove('hidden');
    state.viewMode = 'table';
  });

  // Modal Close
  elements.modalCloseBtn.addEventListener('click', () => {
    elements.fileModal.classList.add('hidden');
  });

  elements.fileModal.addEventListener('click', (e) => {
    if (e.target === elements.fileModal) {
      elements.fileModal.classList.add('hidden');
    }
  });

  // SQL Studio Run & Sample Queries
  elements.btnRunSql.addEventListener('click', executeStudioQuery);
  elements.sqlEditor.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      executeStudioQuery();
    }
  });

  document.querySelectorAll('.quick-q-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.sqlEditor.value = btn.getAttribute('data-sql');
      executeStudioQuery();
    });
  });

  elements.btnFormatSql.addEventListener('click', () => {
    const raw = elements.sqlEditor.value;
    const formatted = raw
      .replace(/\\bSELECT\\b/gi, '\\nSELECT')
      .replace(/\\bFROM\\b/gi, '\\nFROM')
      .replace(/\\bWHERE\\b/gi, '\\nWHERE')
      .replace(/\\bGROUP BY\\b/gi, '\\nGROUP BY')
      .replace(/\\bORDER BY\\b/gi, '\\nORDER BY')
      .replace(/\\bLEFT JOIN\\b/gi, '\\nLEFT JOIN')
      .replace(/\\bJOIN\\b/gi, '\\nJOIN')
      .replace(/\\bLIMIT\\b/gi, '\\nLIMIT')
      .trim();
    elements.sqlEditor.value = formatted;
  });
}

// ----------------------------------------------------
// CHATBOT FUNCTIONS
// ----------------------------------------------------
function addWelcomeMessage() {
  const welcomeHtml = \`
    <div class="message-bubble assistant">
      <div class="avatar-icon">🤖</div>
      <div class="message-body">
        <div class="message-card">
          <p>Hello! I am your <strong>Personal Archive SQL Assistant</strong>.</p>
          <p style="margin-top: 6px;">I have loaded <strong>51 files</strong> and <strong>10 tags</strong> from <code>personal_archive_sqlserver.sql</code>. You can ask me to search, filter, calculate sizes, find tagged documents, or analyze your records in plain English!</p>
        </div>
      </div>
    </div>
  \`;
  elements.chatMessages.innerHTML = welcomeHtml;
}

async function handleChatSubmit() {
  const message = elements.chatInput.value.trim();
  if (!message) return;

  // Add User Message
  appendUserMessage(message);
  elements.chatInput.value = '';
  elements.chatInput.focus();

  // Add Loading Skeleton
  const loadingId = 'loading-' + Date.now();
  appendLoadingMessage(loadingId);

  try {
    // Try backend API first
    let data = await safeFetchJson('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    // Fallback to client-side in-browser database & query engine if API not available
    if (!data && window.clientDb) {
      await new Promise(r => setTimeout(r, 150));
      data = window.clientDb.processNaturalLanguageQuery(message);
    }

    removeLoadingMessage(loadingId);

    if (data && data.success) {
      appendBotMessage(data);
    } else if (data && data.error) {
      appendErrorMessage(data.error);
    } else {
      appendErrorMessage('Failed to process message.');
    }
  } catch (err) {
    removeLoadingMessage(loadingId);
    if (window.clientDb) {
      const fallbackData = window.clientDb.processNaturalLanguageQuery(message);
      if (fallbackData && fallbackData.success) {
        appendBotMessage(fallbackData);
        return;
      }
    }
    appendErrorMessage('Unable to process query: ' + err.message);
  }
}

function appendUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'message-bubble user';
  div.innerHTML = \`
    <div class="avatar-icon">👤</div>
    <div class="message-body">
      <div class="message-card">
        <p>\${escapeHtml(text)}</p>
      </div>
    </div>
  \`;
  elements.chatMessages.appendChild(div);
  scrollToBottom();
}

function appendLoadingMessage(id) {
  const div = document.createElement('div');
  div.className = 'message-bubble assistant';
  div.id = id;
  div.innerHTML = \`
    <div class="avatar-icon">🤖</div>
    <div class="message-body">
      <div class="message-card">
        <span style="color: var(--accent-cyan); font-weight: 500;">Translating question to SQL & executing query...</span>
      </div>
    </div>
  \`;
  elements.chatMessages.appendChild(div);
  scrollToBottom();
}

function removeLoadingMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function appendBotMessage(data) {
  const div = document.createElement('div');
  div.className = 'message-bubble assistant';

  let tableHtml = '';
  if (data.rows && data.rows.length > 0) {
    const columns = Object.keys(data.rows[0]);
    tableHtml = \`
      <div class="chat-table-wrapper">
        <table class="chat-table">
          <thead>
            <tr>
              \${columns.map(col => '<th>' + escapeHtml(col) + '</th>').join('')}
            </tr>
          </thead>
          <tbody>
            \${data.rows.map(row => \`
              <tr>
                \${columns.map(col => '<td>' + escapeHtml(row[col]) + '</td>').join('')}
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
    \`;
  }

  let sqlInspectorHtml = '';
  if (data.sql) {
    sqlInspectorHtml = \`
      <div class="sql-inspector">
        <div class="sql-inspector-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
          <span>⚡ Executed SQL Query (\${data.rows ? data.rows.length : 0} rows)</span>
          <span style="font-size: 0.72rem; color: var(--accent-cyan);">Click to view SQL ▾</span>
        </div>
        <pre class="sql-code-block">\${escapeHtml(data.sql)}</pre>
      </div>
    \`;
  }

  div.innerHTML = \`
    <div class="avatar-icon">🤖</div>
    <div class="message-body">
      <div class="message-card">
        <div style="font-weight: 600; color: #fff; margin-bottom: 4px;">\${escapeHtml(data.title || 'Answer')}</div>
        <div>\${formatMarkdown(data.answer)}</div>
        \${tableHtml}
        \${sqlInspectorHtml}
      </div>
    </div>
  \`;

  elements.chatMessages.appendChild(div);
  scrollToBottom();
}

function appendErrorMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message-bubble assistant';
  div.innerHTML = \`
    <div class="avatar-icon">⚠️</div>
    <div class="message-body">
      <div class="message-card" style="border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08);">
        <p style="color: #f87171; font-weight: 600;">\${escapeHtml(msg)}</p>
      </div>
    </div>
  \`;
  elements.chatMessages.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// ----------------------------------------------------
// ARCHIVE EXPLORER FUNCTIONS
// ----------------------------------------------------
function applyExplorerFilters() {
  const search = elements.explorerSearch.value.toLowerCase().trim();
  const category = elements.filterCategory.value;
  const tag = elements.filterTag.value;
  const type = elements.filterType.value;
  const starredOnly = elements.filterStarred.checked;
  const sort = elements.sortFiles.value;

  state.filteredFiles = state.files.filter(f => {
    // Search match
    if (search) {
      const matchName = f.filename.toLowerCase().includes(search);
      const matchDesc = (f.description || '').toLowerCase().includes(search);
      const matchFolder = f.folder.toLowerCase().includes(search);
      if (!matchName && !matchDesc && !matchFolder) return false;
    }

    // Category match
    if (category && f.category !== category) return false;

    // Type match
    if (type && f.file_type !== type) return false;

    // Starred match
    if (starredOnly && !f.is_starred) return false;

    // Tag match
    if (tag && (!f.tags || !f.tags.includes(tag))) return false;

    return true;
  });

  // Sort
  state.filteredFiles.sort((a, b) => {
    if (sort === 'size-desc') return b.size_kb - a.size_kb;
    if (sort === 'size-asc') return a.size_kb - b.size_kb;
    if (sort === 'date-desc') return new Date(b.date_created) - new Date(a.date_created);
    if (sort === 'date-asc') return new Date(a.date_created) - new Date(b.date_created);
    if (sort === 'name-asc') return a.filename.localeCompare(b.filename);
    return a.id - b.id;
  });

  renderExplorerFiles();
}

function renderExplorerFiles() {
  const count = state.filteredFiles.length;
  elements.resultsCount.textContent = 'Showing ' + count + ' of ' + state.files.length + ' files';

  // 1. Render Cards
  elements.cardsContainer.innerHTML = '';
  if (count === 0) {
    elements.cardsContainer.innerHTML = \`
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted);">
        <p style="font-size: 1.1rem; color: #fff;">No matching files found</p>
        <p style="font-size: 0.85rem; margin-top: 4px;">Try clearing filters or search terms.</p>
      </div>
    \`;
  } else {
    state.filteredFiles.forEach(file => {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.onclick = () => openFileModal(file);

      const typeClass = 'type-' + file.file_type.toLowerCase();
      const starIcon = file.is_starred ? '<span class="star-icon starred">⭐</span>' : '<span class="star-icon">☆</span>';
      const tagsHtml = (file.tags || []).map(t => '<span class="tag-badge tag-' + t + '">#' + escapeHtml(t) + '</span>').join('');

      card.innerHTML = \`
        <div class="file-card-header">
          <span class="file-type-badge \${typeClass}">\${escapeHtml(file.file_type)}</span>
          \${starIcon}
        </div>
        <div class="file-card-title">\${escapeHtml(file.filename)}</div>
        <div class="file-card-meta">
          <span>📁 \${escapeHtml(file.category)} • \${formatSize(file.size_kb)}</span>
          <span>📅 Created: \${escapeHtml(file.date_created)}</span>
        </div>
        <div class="file-card-tags">
          \${tagsHtml || '<span style="font-size: 0.7rem; color: var(--text-muted);">No tags</span>'}
        </div>
      \`;
      elements.cardsContainer.appendChild(card);
    });
  }

  // 2. Render Table
  elements.tableBody.innerHTML = '';
  state.filteredFiles.forEach(file => {
    const tr = document.createElement('tr');
    tr.onclick = () => openFileModal(file);
    const starText = file.is_starred ? '⭐' : '';
    const tagsText = (file.tags || []).map(t => '#' + t).join(', ');

    tr.innerHTML = \`
      <td>\${file.id}</td>
      <td>\${starText}</td>
      <td style="font-weight: 600; color: #fff;">\${escapeHtml(file.filename)}</td>
      <td><span class="badge-category">\${escapeHtml(file.category)}</span></td>
      <td><span class="file-type-badge type-\${file.file_type.toLowerCase()}">\${escapeHtml(file.file_type)}</span></td>
      <td>\${formatSize(file.size_kb)}</td>
      <td><code>\${escapeHtml(file.folder)}</code></td>
      <td>\${escapeHtml(file.date_created)}</td>
      <td><span style="font-size: 0.78rem; color: var(--accent-cyan);">\${escapeHtml(tagsText || 'None')}</span></td>
    \`;
    elements.tableBody.appendChild(tr);
  });
}

function openFileModal(file) {
  elements.modalType.textContent = file.file_type;
  elements.modalType.className = 'file-type-badge type-' + file.file_type.toLowerCase();
  elements.modalFilename.textContent = file.filename;
  elements.modalCategory.textContent = file.category;
  elements.modalSize.textContent = formatSize(file.size_kb) + ' (' + file.size_kb.toLocaleString() + ' KB)';
  elements.modalFolder.textContent = file.folder;
  elements.modalStarred.textContent = file.is_starred ? '⭐ Yes (Starred)' : 'No';
  elements.modalCreated.textContent = file.date_created;
  elements.modalModified.textContent = file.date_modified;
  elements.modalOpened.textContent = file.last_opened || 'Never opened';
  elements.modalDescription.textContent = file.description || 'No description provided.';

  elements.modalTags.innerHTML = '';
  if (file.tags && file.tags.length > 0) {
    file.tags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'tag-badge tag-' + t;
      span.textContent = '#' + t;
      elements.modalTags.appendChild(span);
    });
  } else {
    elements.modalTags.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">No tags assigned</span>';
  }

  elements.fileModal.classList.remove('hidden');
}

// ----------------------------------------------------
// ANALYTICS DASHBOARD
// ----------------------------------------------------
function renderAnalytics() {
  if (!state.stats) return;

  // Category Storage Bars
  elements.categoryChartList.innerHTML = '';
  const totalKb = state.stats.totalSizeKb;

  state.stats.categories.forEach(cat => {
    const percent = ((cat.total_size / totalKb) * 100).toFixed(1);
    const div = document.createElement('div');
    div.className = 'chart-bar-item';
    div.innerHTML = \`
      <div class="bar-meta">
        <span><strong>\${escapeHtml(cat.category)}</strong> (\${cat.count} files)</span>
        <span>\${formatSize(cat.total_size)} • \${percent}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width: \${percent}%;"></div>
      </div>
    \`;
    elements.categoryChartList.appendChild(div);
  });

  // File Type Distribution
  elements.fileTypeChartList.innerHTML = '';
  state.stats.fileTypes.forEach(ft => {
    const div = document.createElement('div');
    div.className = 'file-type-item';
    div.innerHTML = \`
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="file-type-badge type-\${ft.file_type.toLowerCase()}">\${ft.file_type}</span>
        <span style="font-size: 0.85rem; color: #fff;">\${ft.count} files</span>
      </div>
      <span style="font-size: 0.8rem; color: var(--text-secondary);">\${formatSize(ft.total_size)}</span>
    \`;
    elements.fileTypeChartList.appendChild(div);
  });

  // Tag Cloud
  elements.tagCloudList.innerHTML = '';
  state.stats.tagsSummary.forEach(t => {
    const pill = document.createElement('div');
    pill.className = 'tag-cloud-pill';
    pill.innerHTML = \`
      <span>#\${escapeHtml(t.name)}</span>
      <strong>\${t.count}</strong>
    \`;
    pill.onclick = () => {
      elements.filterTag.value = t.name;
      applyExplorerFilters();
      elements.navButtons.forEach(b => b.classList.remove('active'));
      elements.tabs.forEach(tab => tab.classList.remove('active'));
      document.getElementById('nav-explorer').classList.add('active');
      document.getElementById('explorer-tab').classList.add('active');
    };
    elements.tagCloudList.appendChild(pill);
  });
}

// ----------------------------------------------------
// SQL STUDIO FUNCTIONS
// ----------------------------------------------------
function renderSchemaTree() {
  if (!state.schema) return;
  elements.schemaTree.innerHTML = '';

  state.schema.forEach(table => {
    const node = document.createElement('div');
    node.className = 'table-node';
    const colsHtml = table.columns.map(col => {
      const pkBadge = col.primaryKey ? '<span class="col-pk">🔑 PK</span>' : '';
      return \`
        <div class="col-item">
          <span>\${escapeHtml(col.name)}</span>
          <span>\${escapeHtml(col.type)} \${pkBadge}</span>
        </div>
      \`;
    }).join('');

    node.innerHTML = \`
      <div class="table-node-name">🗄️ \${escapeHtml(table.name)}</div>
      <div class="table-cols-list">
        \${colsHtml}
      </div>
    \`;
    elements.schemaTree.appendChild(node);
  });
}

async function executeStudioQuery() {
  const sql = elements.sqlEditor.value.trim();
  if (!sql) return;

  elements.queryMetaStatus.textContent = 'Executing query...';
  const startTime = performance.now();

  try {
    let data = await safeFetchJson('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });

    if (!data && window.clientDb) {
      data = window.clientDb.executeRawSql(sql);
    }

    const duration = (performance.now() - startTime).toFixed(1);

    if (data && data.success) {
      elements.queryMetaStatus.innerHTML = '✅ <strong>' + data.rowCount + ' rows</strong> returned in ' + duration + 'ms';
      renderStudioResultsTable(data.rows, data.columns);
      elements.btnExportSql.classList.remove('hidden');
      elements.btnExportSql.onclick = () => exportToCsv(data.rows, 'sql_query_export.csv');
    } else if (data) {
      elements.queryMetaStatus.innerHTML = '<span style="color: #f87171;">❌ SQL Error: ' + escapeHtml(data.error || 'Execution failed') + '</span>';
      elements.studioResultsTable.innerHTML = '<div style="padding: 20px; color: #f87171; font-family: var(--font-mono); font-size: 0.85rem;">' + escapeHtml(data.error || 'Execution failed') + '</div>';
      elements.btnExportSql.classList.add('hidden');
    } else {
      throw new Error('Unable to execute query');
    }
  } catch (err) {
    elements.queryMetaStatus.textContent = '❌ Error: ' + err.message;
  }
}

function renderStudioResultsTable(rows, columns) {
  if (!rows || rows.length === 0) {
    elements.studioResultsTable.innerHTML = \`
      <div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        Query executed successfully. 0 rows returned.
      </div>
    \`;
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr>' + columns.map(c => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = columns.map(c => '<td>' + escapeHtml(row[c] !== null ? row[c] : 'NULL') + '</td>').join('');
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  elements.studioResultsTable.innerHTML = '';
  elements.studioResultsTable.appendChild(table);
}

function exportToCsv(rows, filename) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(','),
    ...rows.map(row => headers.map(h => '"' + String(row[h] || '').replace(/"/g, '""') + '"').join(','))
  ].join('\\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Start application
window.addEventListener('DOMContentLoaded', initializeApp);
`;

  fs.writeFileSync(path.join(__dirname, 'public', 'app.js'), appJsTemplate);

  // 4. Generate wrangler.toml for Cloudflare Workers & Assets
  const wranglerToml = `name = "chatbot-project"
main = "_worker.js"
compatibility_date = "2024-09-01"

[assets]
directory = "./public"
binding = "ASSETS"
`;
  fs.writeFileSync(path.join(__dirname, 'wrangler.toml'), wranglerToml);

  console.log('✅ Successfully built all bundles!');
})();
