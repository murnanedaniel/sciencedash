-- m16: extend JobKind enum with project_brain_global and workhorse_tick_global.
-- SQLite enums are stored as TEXT, so adding new values is a no-op at the
-- database level — the schema change lives in schema.prisma and the new
-- values are accepted because the column has no CHECK constraint. This
-- file exists so prisma's _prisma_migrations table records the version
-- bump and `prisma migrate deploy` recognises the migration as applied.
SELECT 1;
