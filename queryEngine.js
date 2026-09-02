const db = require('./db');

/**
 * Normalizes user input text
 */
function cleanText(text) {
  return text.toLowerCase().trim();
}

/**
 * Format bytes into human readable KB or MB
 */
function formatSize(kb) {
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(2)} MB`;
  }
  return `${kb} KB`;
}

/**
 * Built-in Rule & Heuristic NLP-to-SQL Engine
 */
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
    const stats = db.getDatabaseStats();
    sql = `
SELECT 
  (SELECT COUNT(*) FROM files) AS total_files,
  (SELECT SUM(size_kb) FROM files) AS total_size_kb,
  (SELECT COUNT(*) FROM files WHERE is_starred = 1) AS starred_files,
  (SELECT COUNT(*) FROM tags) AS total_tags;
    `;
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: '📊 Personal Archive Overview & Statistics',
      answer: `Your archive contains **${stats.totalFiles} files** totaling **${stats.totalSizeMb} MB** across **${stats.categories.length} categories**. You have **${stats.starredCount} starred items** and **${stats.tagsCount} active tags**.`,
      stats: stats,
      type: 'summary',
      rows: stats.categories.map(c => ({
        Category: c.category,
        'File Count': c.count,
        'Storage Used': formatSize(c.total_size)
      }))
    };
  }

  // 2. CATEGORY BREAKDOWN / GROUPINGS
  if (
    query === 'categories' ||
    query.includes('by category') || 
    query.includes('list categories') || 
    query.includes('show categories') || 
    query.includes('categories breakdown') ||
    query.includes('all categories')
  ) {
    sql = `
SELECT 
  category, 
  COUNT(*) AS file_count, 
  SUM(size_kb) AS total_size_kb,
  ROUND(AVG(size_kb), 1) AS avg_size_kb
FROM files 
GROUP BY category 
ORDER BY file_count DESC, total_size_kb DESC;
    `;
    const rows = db.queryAll(sql);
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: '📁 Files Grouped by Category',
      answer: `Found **${rows.length} categories** in your archive. Here is the breakdown:`,
      rows: rows.map(r => ({
        Category: r.category,
        'File Count': r.file_count,
        'Total Size': formatSize(r.total_size_kb),
        'Avg Size': formatSize(Math.round(r.avg_size_kb))
      }))
    };
  }

  // 3. FILE TYPE / EXTENSION BREAKDOWN
  if (
    query.includes('by type') || 
    query.includes('by file type') || 
    query.includes('file types') || 
    query.includes('file extensions') ||
    query.includes('format breakdown')
  ) {
    sql = `
SELECT 
  file_type, 
  COUNT(*) AS file_count, 
  SUM(size_kb) AS total_size_kb
FROM files 
GROUP BY file_type 
ORDER BY file_count DESC;
    `;
    const rows = db.queryAll(sql);
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: '📄 Files Grouped by Type',
      answer: `Breakdown of your files by file extension:`,
      rows: rows.map(r => ({
        'File Type': r.file_type,
        'Count': r.file_count,
        'Total Storage': formatSize(r.total_size_kb)
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
    sql = `
SELECT 
  t.name AS tag_name, 
  COUNT(ft.file_id) AS file_count
FROM tags t
LEFT JOIN file_tags ft ON t.id = ft.tag_id
GROUP BY t.id, t.name
ORDER BY file_count DESC;
    `;
    const rows = db.queryAll(sql);
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: '🏷️ Active Tags & Counts',
      answer: `Found **${rows.length} tags** across the database:`,
      rows: rows.map(r => ({
        'Tag Name': `#${r.tag_name}`,
        'Files Tagged': r.file_count
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
    sql = `
SELECT 
  f.id, f.filename, f.file_type, f.category, f.size_kb, f.folder,
  GROUP_CONCAT(t.name, ', ') AS tags
FROM files f
LEFT JOIN file_tags ft ON f.id = ft.file_id
LEFT JOIN tags t ON ft.tag_id = t.id
GROUP BY f.id
ORDER BY f.size_kb DESC
LIMIT 10;
    `;
    const rows = db.queryAll(sql);
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: '💾 Top 10 Largest Files',
      answer: `The largest file in your archive is **${rows[0]?.filename}** (${formatSize(rows[0]?.size_kb)}).`,
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
    sql = `
SELECT 
  f.id, f.filename, f.file_type, f.category, f.size_kb, f.folder,
  GROUP_CONCAT(t.name, ', ') AS tags
FROM files f
LEFT JOIN file_tags ft ON f.id = ft.file_id
LEFT JOIN tags t ON ft.tag_id = t.id
GROUP BY f.id
ORDER BY f.size_kb ASC
LIMIT 10;
    `;
    const rows = db.queryAll(sql);
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: '💾 Top 10 Smallest Files',
      answer: `The smallest file in your archive is **${rows[0]?.filename}** (${formatSize(rows[0]?.size_kb)}).`,
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
    sql = `
SELECT 
  f.id, f.filename, f.file_type, f.category, f.folder, f.size_kb, f.date_created,
  GROUP_CONCAT(t.name, ', ') AS tags
FROM files f
LEFT JOIN file_tags ft ON f.id = ft.file_id
LEFT JOIN tags t ON ft.tag_id = t.id
WHERE f.last_opened IS NULL
GROUP BY f.id
ORDER BY f.date_created DESC;
    `;
    const rows = db.queryAll(sql);
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: '📂 Files Never Opened',
      answer: `Found **${rows.length} files** with no record of being opened (\`last_opened IS NULL\`):`,
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
    sql = `
SELECT 
  f.id, f.filename, f.file_type, f.category, f.last_opened, f.size_kb,
  GROUP_CONCAT(t.name, ', ') AS tags
FROM files f
LEFT JOIN file_tags ft ON f.id = ft.file_id
LEFT JOIN tags t ON ft.tag_id = t.id
WHERE f.last_opened IS NOT NULL
GROUP BY f.id
ORDER BY f.last_opened DESC
LIMIT 10;
    `;
    const rows = db.queryAll(sql);
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: '🕒 Most Recently Opened Files',
      answer: `Here are the top **${rows.length} files** by \`last_opened\` date:`,
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
    const regex = new RegExp(`\\b${tag}\\b`, 'i');
    if (regex.test(query) || (tag === 'renew-soon' && (query.includes('renew') || query.includes('renewal')))) {
      matchedTags.push(tag);
    }
  }

  const matchedCategories = [];
  for (const cat of availableCategories) {
    const regex = new RegExp(`\\b${cat.toLowerCase()}\\b|\\b${cat.toLowerCase()}s\\b`, 'i');
    if (regex.test(query)) {
      matchedCategories.push(cat);
    }
  }
  // Category aliases with word boundaries
  if (/\b(id|ids|identification|passport|license|licence)\b/i.test(query)) {
    if (!matchedCategories.includes('Identification')) matchedCategories.push('Identification');
  }
  if (/\b(health|doctor|dentist|vaccine|vaccination|prescription|medical)\b/i.test(query)) {
    if (!matchedCategories.includes('Medical')) matchedCategories.push('Medical');
  }
  if (/\b(school|degree|diploma|course|academic|transcript|education)\b/i.test(query)) {
    if (!matchedCategories.includes('Education')) matchedCategories.push('Education');
  }
  if (/\b(job|resume|salary|payslip|employment|work)\b/i.test(query)) {
    if (!matchedCategories.includes('Work')) matchedCategories.push('Work');
  }
  if (/\b(photo|photos|picture|pictures)\b/i.test(query)) {
    if (!matchedCategories.includes('Photo')) matchedCategories.push('Photo');
  }
  if (/\b(tax|taxes|w2|deduction)\b/i.test(query)) {
    if (!matchedCategories.includes('Tax')) matchedCategories.push('Tax');
  }
  if (/\b(invoice|invoices|billing)\b/i.test(query)) {
    if (!matchedCategories.includes('Invoice')) matchedCategories.push('Invoice');
  }
  if (/\b(contract|contracts|lease|nda|agreement)\b/i.test(query)) {
    if (!matchedCategories.includes('Contract')) matchedCategories.push('Contract');
  }
  if (/\b(receipt|receipts)\b/i.test(query)) {
    if (!matchedCategories.includes('Receipt')) matchedCategories.push('Receipt');
  }
  if (/\b(warranty|warranties)\b/i.test(query)) {
    if (!matchedCategories.includes('Warranty')) matchedCategories.push('Warranty');
  }
  if (/\b(insurance|policy|claim)\b/i.test(query)) {
    if (!matchedCategories.includes('Insurance')) matchedCategories.push('Insurance');
  }

  const matchedTypes = [];
  for (const t of availableTypes) {
    const regex = new RegExp(`\\b${t.toLowerCase()}\\b`, 'i');
    if (regex.test(query)) {
      matchedTypes.push(t);
    }
  }
  if (/\b(image|images)\b/i.test(query) && matchedCategories.length === 0) {
    matchedTypes.push('JPG', 'PNG');
  }
  if (/\b(excel|spreadsheet|spreadsheets)\b/i.test(query)) {
    matchedTypes.push('XLSX');
  }
  if (/\b(word|docx)\b/i.test(query)) {
    matchedTypes.push('DOCX');
  }

  // Starred filter
  let isStarredFilter = false;
  if (/\b(starred|star|favorites?|bookmarked)\b/i.test(query)) {
    isStarredFilter = true;
  }

  // Size filters
  let sizeCondition = null;
  const sizeMbMatch = query.match(/(?:>|greater than|larger than|more than|over|above)\s*(\d+(?:\.\d+)?)\s*(?:mb|megabytes?)/i);
  if (sizeMbMatch) {
    const kb = Math.round(parseFloat(sizeMbMatch[1]) * 1024);
    sizeCondition = `f.size_kb > ${kb}`;
  }
  const sizeKbMatch = query.match(/(?:>|greater than|larger than|more than|over|above)\s*(\d+)\s*(?:kb|kilobytes?)/i);
  if (sizeKbMatch) {
    sizeCondition = `f.size_kb > ${parseInt(sizeKbMatch[1], 10)}`;
  }
  const sizeUnderMatch = query.match(/(?:<|less than|smaller than|under|below)\s*(\d+(?:\.\d+)?)\s*(mb|kb|megabytes?|kilobytes?)/i);
  if (sizeUnderMatch) {
    let kb = parseFloat(sizeUnderMatch[1]);
    if (sizeUnderMatch[2].startsWith('m')) kb *= 1024;
    sizeCondition = `f.size_kb < ${Math.round(kb)}`;
  }

  // Year filters
  const yearMatch = query.match(/\b(202[1-6])\b/);
  let yearCondition = null;
  if (yearMatch) {
    const year = yearMatch[1];
    if (query.includes('modified')) {
      yearCondition = `f.date_modified LIKE '${year}%'`;
    } else if (query.includes('opened')) {
      yearCondition = `f.last_opened LIKE '${year}%'`;
    } else {
      yearCondition = `(f.date_created LIKE '${year}%' OR f.filename LIKE '%${year}%' OR f.folder LIKE '%${year}%')`;
    }
  }

  const stopWords = new Set([
    'show', 'me', 'all', 'the', 'files', 'file', 'find', 'get', 'list', 'what', 'which', 'are', 'in', 'my', 'is', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'to', 'from', 'having', 'tagged', 'category', 'type', 'format', 'documents', 'document', 'archive', 'records', 'items', 'please', 'give', 'any', 'that', 'than', 'larger', 'greater', 'smaller', 'less', 'more', 'over', 'under', 'mb', 'kb', 'megabytes', 'kilobytes', 'size', 'created', 'modified', 'opened', 'date', 'dates', 'starred', 'star', 'stars', 'favorite', 'favorites', 'bookmarked',
    'renew', 'renewal', 'renew-soon', 'urgent', 'important', 'archived', 'shared', 'expired', 'signed', 'draft', 'confidential', 'contain', 'containing'
  ]);

  // Clean query for search keywords
  let cleanedForKw = query
    .replace(/\b\d+(?:\.\d+)?\s*(?:mb|kb|megabytes?|kilobytes?)\b/gi, '')
    .replace(/\b202[1-6]\b/g, '')
    .replace(/[^a-z0-9_]/g, ' ');

  const searchKeywords = [];
  const rawWords = cleanedForKw.split(/\s+/);
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
    whereParts.push(`f.is_starred = 1`);
  }

  if (matchedTags.length > 0) {
    const tagList = matchedTags.map(t => `'${t}'`).join(', ');
    whereParts.push(`f.id IN (SELECT ft.file_id FROM file_tags ft JOIN tags t ON ft.tag_id = t.id WHERE t.name IN (${tagList}))`);
  }

  if (matchedCategories.length > 0) {
    const catList = matchedCategories.map(c => `'${c}'`).join(', ');
    whereParts.push(`f.category IN (${catList})`);
  }

  if (matchedTypes.length > 0) {
    const typeList = [...new Set(matchedTypes)].map(t => `'${t}'`).join(', ');
    whereParts.push(`f.file_type IN (${typeList})`);
  }

  if (sizeCondition) {
    whereParts.push(sizeCondition);
  }

  if (yearCondition) {
    whereParts.push(yearCondition);
  }

  if (searchKeywords.length > 0) {
    const kwConditions = searchKeywords.map(kw => `(f.filename LIKE '%${kw}%' OR f.description LIKE '%${kw}%' OR f.folder LIKE '%${kw}%')`);
    whereParts.push(`(${kwConditions.join(' OR ')})`);
  }

  if (whereParts.length > 0) {
    const whereSql = whereParts.join(' AND ');
    sql = `
SELECT 
  f.id, f.filename, f.file_type, f.category, f.folder, f.size_kb, f.date_created, f.date_modified, f.last_opened, f.is_starred, f.description,
  GROUP_CONCAT(t.name, ', ') AS tags
FROM files f
LEFT JOIN file_tags ft ON f.id = ft.file_id
LEFT JOIN tags t ON ft.tag_id = t.id
WHERE ${whereSql}
GROUP BY f.id
ORDER BY f.date_created DESC;
    `;

    const rows = db.queryAll(sql);
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: `🔍 Found ${rows.length} file${rows.length === 1 ? '' : 's'}`,
      answer: rows.length > 0 
        ? `Found **${rows.length} matching file${rows.length === 1 ? '' : 's'}** for your query:`
        : `No files matched your criteria (${whereSql}). Try a broader search.`,
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

  // 9. DIRECT FUZZY / TEXT MATCHING
  sql = `
SELECT 
  f.id, f.filename, f.file_type, f.category, f.folder, f.size_kb, f.date_created, f.is_starred, f.description,
  GROUP_CONCAT(t.name, ', ') AS tags
FROM files f
LEFT JOIN file_tags ft ON f.id = ft.file_id
LEFT JOIN tags t ON ft.tag_id = t.id
WHERE f.filename LIKE '%${query}%' 
   OR f.description LIKE '%${query}%' 
   OR f.category LIKE '%${query}%'
   OR f.folder LIKE '%${query}%'
GROUP BY f.id
ORDER BY f.date_created DESC;
  `;
  const fallbackRows = db.queryAll(sql);

  if (fallbackRows.length > 0) {
    return {
      success: true,
      query: userInput,
      sql: sql.trim(),
      title: `🔍 Search Results for "${userInput}"`,
      answer: `Found **${fallbackRows.length} files** matching "${userInput}":`,
      rows: fallbackRows.map(r => ({
        Filename: r.filename,
        Category: r.category,
        Type: r.file_type,
        Size: formatSize(r.size_kb),
        Folder: r.folder,
        Tags: r.tags || 'None',
        Description: r.description || ''
      }))
    };
  }

  // Default fallback
  const defaultSql = `SELECT f.id, f.filename, f.file_type, f.category, f.size_kb, f.folder FROM files f ORDER BY f.id ASC LIMIT 10;`;
  const top10 = db.queryAll(defaultSql);
  return {
    success: true,
    query: userInput,
    sql: defaultSql.trim(),
    title: '💡 Personal Archive Assistant',
    answer: `I can help you search, filter, and analyze any data in your \`personal_archive_sqlserver.sql\` database.\n\nTry questions like:\n- **"Show me all confidential documents"**\n- **"Which files are larger than 2MB?"**\n- **"List my invoices from 2024"**\n- **"What are my starred files?"**\n- **"Storage breakdown by category"**\n- **"Files never opened"**`,
    rows: top10.map(r => ({
      Filename: r.filename,
      Category: r.category,
      Type: r.file_type,
      Size: formatSize(r.size_kb),
      Folder: r.folder
    }))
  };
}

/**
 * Execute raw SQL query
 */
function executeRawSql(rawSql) {
  try {
    const trimmed = rawSql.trim();
    if (!trimmed) {
      throw new Error('Empty SQL query');
    }
    
    const rows = db.queryAll(trimmed);
    return {
      success: true,
      sql: trimmed,
      rowCount: rows.length,
      rows: rows,
      columns: rows.length > 0 ? Object.keys(rows[0]) : []
    };
  } catch (err) {
    return {
      success: false,
      sql: rawSql,
      error: err.message
    };
  }
}

module.exports = {
  processNaturalLanguageQuery,
  executeRawSql,
  formatSize
};
