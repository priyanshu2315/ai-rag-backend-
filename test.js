import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.jpljdohzksblpqfrawtp:UiaYC+!6D@2JdZY@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres' });
async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT id FROM "Document"
    WHERE filename = 'Chunking_Stress_Test_Document.pdf'
    ORDER BY "createdAt" DESC LIMIT 1
  `);
  if (res.rows.length === 0) {
    console.log('Document not found');
    return;
  }
  const docId = res.rows[0].id;
  console.log('Doc ID:', docId);
  
  const chunksRes = await client.query(`
    SELECT "searchText" FROM "ChildChunk"
    WHERE "documentId" = $1 AND "searchText" ILIKE '%Alderbank Yard%'
    LIMIT 5
  `, [docId]);
  
  console.log('Found chunks:', JSON.stringify(chunksRes.rows.map(r => r.searchText), null, 2));
}
main().catch(console.error).finally(() => client.end());
