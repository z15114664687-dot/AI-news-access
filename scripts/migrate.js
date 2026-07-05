const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const migrationsDir = path.join(process.cwd(), "db", "migrations");

function runMigrations(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const appliedNow = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
    })();
    appliedNow.push(file);
  }
  return appliedNow;
}

module.exports = { runMigrations };

if (require.main === module) {
  const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "ai-intel.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const appliedNow = runMigrations(db);
  db.close();
  console.log(
    appliedNow.length
      ? `Applied migrations: ${appliedNow.join(", ")} (${dbPath})`
      : `SQLite database is up to date at ${dbPath}.`,
  );
}
