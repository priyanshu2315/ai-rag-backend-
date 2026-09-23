import prisma from "../config/db.js";

const table = process.argv[2] || null;

const indexes = table
  ? await prisma.$queryRawUnsafe(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`,
      table,
    )
  : await prisma.$queryRawUnsafe(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname`,
    );

let currentTable = null;
for (const idx of indexes) {
  if (idx.tablename !== currentTable) {
    currentTable = idx.tablename;
    console.log(`\n${currentTable}`);
  }
  console.log(`  ${idx.indexname}`);
  console.log(`    ${idx.indexdef}`);
}

console.log(`\n${indexes.length} index(es) found\n`);

await prisma.$disconnect();
