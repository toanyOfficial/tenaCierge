import fs from 'node:fs';
import path from 'node:path';

export type SchemaColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  comment?: string;
};

export type SchemaTable = {
  name: string;
  columns: SchemaColumn[];
};

type SchemaRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_comment: string;
};

let cache: SchemaTable[] | null = null;

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function readSchemaRows(): SchemaRow[] {
  const csvPath = path.join(process.cwd(), 'docsForCodex', 'schema.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split(/\r?\n/);
  const [headerLine, ...dataLines] = lines;
  const headers = parseCsvLine(headerLine).map((value) => value.replace(/"/g, ''));

  return dataLines
    .filter((line) => line.trim().length)
    .map((line) => {
      const parsed = parseCsvLine(line);
      const row: Partial<SchemaRow> = {};
      headers.forEach((header, index) => {
        row[header as keyof SchemaRow] = parsed[index]?.replace(/^"|"$/g, '') ?? '';
      });
      return row as SchemaRow;
    });
}

function buildSchema(): SchemaTable[] {
  const rows = readSchemaRows();
  const tableMap = new Map<string, SchemaTable>();

  rows.forEach((row) => {
    if (!tableMap.has(row.table_name)) {
      tableMap.set(row.table_name, { name: row.table_name, columns: [] });
    }

    const table = tableMap.get(row.table_name)!;
    table.columns.push({
      name: row.column_name,
      dataType: row.data_type.toLowerCase(),
      nullable: row.is_nullable.toUpperCase() === 'YES',
      comment: row.column_comment
    });
  });

  return Array.from(tableMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getSchemaTables(): SchemaTable[] {
  if (!cache) {
    cache = buildSchema();
  }
  return cache;
}

export function getSchemaTable(name: string): SchemaTable | undefined {
  return getSchemaTables().find((table) => table.name === name);
}
