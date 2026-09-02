const fs = require('fs');
const path = require('path');

/**
 * Transpiles SQL Server script (T-SQL) from personal_archive_sqlserver.sql
 * into valid SQLite statements.
 */
function transpileSqlServerToSqlite(sqlContent) {
  // Remove block comments and line comments
  let cleaned = sqlContent
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove multi-line comments
    .replace(/^--.*$/gm, ''); // remove single-line comments

  // Normalize GO statements to semicolons
  cleaned = cleaned.replace(/\bGO\b/gi, ';');

  // Remove T-SQL specific commands that are not valid in SQLite
  cleaned = cleaned.replace(/SET\s+IDENTITY_INSERT\s+\w+\s+(ON|OFF)\s*;?/gi, '');
  cleaned = cleaned.replace(/USE\s+\w+\s*;?/gi, '');
  cleaned = cleaned.replace(/CREATE\s+DATABASE\s+[\s\S]*?;/gi, '');
  cleaned = cleaned.replace(/IF\s+OBJECT_ID[\s\S]*?;\s*/gi, '');

  // Convert T-SQL data types and syntax to SQLite
  // IDENTITY(1,1) PRIMARY KEY -> INTEGER PRIMARY KEY AUTOINCREMENT
  cleaned = cleaned.replace(/INT\s+IDENTITY\(\d+,\s*\d+\)\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  cleaned = cleaned.replace(/IDENTITY\(\d+,\s*\d+\)/gi, '');
  
  // NVARCHAR / VARCHAR / DATETIME / DATE -> TEXT
  cleaned = cleaned.replace(/NVARCHAR\(\d+\)/gi, 'TEXT');
  cleaned = cleaned.replace(/VARCHAR\(\d+\)/gi, 'TEXT');
  cleaned = cleaned.replace(/DATETIME/gi, 'TEXT');
  cleaned = cleaned.replace(/DATE\b/gi, 'TEXT');
  cleaned = cleaned.replace(/BIT\b/gi, 'INTEGER');

  // Convert N'string' string literals to 'string'
  cleaned = cleaned.replace(/N'([^']*(?:''[^']*)*)'/g, "'$1'");

  // Split statements by semicolon
  const rawStatements = cleaned
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return rawStatements;
}

module.exports = { transpileSqlServerToSqlite };
