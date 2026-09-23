# Prisma Schema Change Pipeline

## A. Standard flow — field/model/relation changes (schema.prisma can express it)

1. Edit prisma/schema.prisma
2. npx prisma migrate dev --name <short_description>
3. Verify:
   npx prisma migrate status
   npm run indexes -- <TableName>

Done in one command. migrate dev diffs schema.prisma against migration
history, writes the SQL file, applies it, and regenerates Prisma Client
automatically.


## B. Raw-SQL flow — anything schema.prisma can't express
   (custom index types/params, extensions with WITH SCHEMA, triggers, etc.)

1. Edit prisma/schema.prisma (if it touches a declared field/model at all)
2. npx prisma migrate dev --create-only --name <short_description>
   -> generates the migration folder WITHOUT applying it
3. Open the generated migration.sql and hand-write the raw SQL
4. npx prisma migrate deploy
   -> applies pending migrations only, no diffing, no prompts
5. Verify:
   npx prisma migrate status
   npm run indexes -- <TableName>


## C. Command cheat sheet

npx prisma migrate dev --name X       dev: diff schema.prisma, generate + apply migration, regenerate client
npx prisma migrate dev --create-only  dev: generate migration file only, don't apply (for hand-editing SQL)
npx prisma migrate deploy             apply pending migration files as-is, no diffing (CI/production, or step 4 above)
npx prisma migrate status             compare migration history vs actual DB — run after every change
npx prisma generate                   regenerate Prisma Client only (needed after `migrate deploy`, not after `migrate dev`)
npx prisma validate                   check schema.prisma syntax only, no DB connection
npx prisma migrate resolve --applied <name>      mark a migration applied without running its SQL (baselining only)
npx prisma migrate resolve --rolled-back <name>  clear a failed migration record so it can be retried
npm run indexes [-- TableName]        project script: list live indexes from pg_indexes
npm run models                        project script: list available AI models per provider


## D. Rules learned the hard way

- Never hand-edit a migration.sql file after it's been applied — Prisma
  checksums applied migrations; editing one desyncs history from reality.
- Never delete the prisma/migrations folder against a database that already
  has real schema/extensions in it — history and reality go out of sync and
  every future `migrate dev` shows false "drift."
- `migrate resolve` never runs SQL — it only edits Prisma's bookkeeping
  table. Use it only when the DB already matches what the migration claims
  (baselining), never to fake progress.
- HNSW indexes require a FIXED-dimension vector column (`vector(384)`, not
  bare `vector`). Fix the column type before creating the index.
- If `migrate dev`/`status` ever warns about drift or data loss, stop and
  read it before confirming — don't auto-approve.
