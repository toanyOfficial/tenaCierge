import fs from 'fs';
import path from 'path';
import * as schema from '../src/db/schema';

const schemaName = process.env.DB_NAME ?? 'tenaCierge';

const sampleTable = schema.clientHeader as any;
const columnSymbol = Object.getOwnPropertySymbols(sampleTable).find(
  (sym) => sym.description === 'drizzle:Columns'
) as symbol;
const nameSymbol = Object.getOwnPropertySymbols(sampleTable).find(
  (sym) => sym.description === 'drizzle:Name'
) as symbol;

const entries = Object.entries(schema)
  .filter(([, value]) => value && columnSymbol in (value as object))
  .map(([exportName, table]) => {
    const t = table as any;
    const tableName = String(t[nameSymbol] ?? exportName);
    const columns = t[columnSymbol] as Record<string, any>;
    return { tableName, columns };
  })
  .sort((a, b) => a.tableName.localeCompare(b.tableName));

const lines: string[] = [
  'table_schema,table_name,column_name,data_type,is_nullable,column_comment'
];

for (const { tableName, columns } of entries) {
  for (const col of Object.values<any>(columns)) {
    const columnName = col.config?.name ?? col.name ?? '';
    const dataType = typeof col.getSQLType === 'function' ? col.getSQLType() : '';
    const isNullable = col.notNull ? 'NO' : 'YES';
    const comment = '';
    const row = [schemaName, tableName, columnName, dataType, isNullable, comment]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(',');
    lines.push(row);
  }
}

const outputPath = path.join(__dirname, '..', 'docsForCodex', 'schema.csv');
fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
console.log(`Updated ${outputPath} with ${lines.length - 1} columns from ${entries.length} tables.`);
