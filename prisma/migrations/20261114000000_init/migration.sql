-- Baseline migration (ARC-44).
--
-- Establishes the Prisma Migrate history that development and isolated test
-- databases are initialized from. It intentionally creates no tables: the
-- location and search-cache tables arrive with ARC-45 and forecast snapshots
-- with ARC-46, each as its own checked-in migration.
SELECT 1;
