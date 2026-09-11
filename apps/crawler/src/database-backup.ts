import type { Db } from "@mf-dashboard/db";
import { backupDatabase } from "@mf-dashboard/db/backup";
import { info } from "./logger.js";

export async function runDatabaseBackup(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const directory = env.DB_BACKUP_DIR?.trim();
  if (!directory) return;
  info("Creating database backup...");
  await backupDatabase(db, directory);
  info("Database backup verified and saved; cloud upload is managed by the host.");
}
