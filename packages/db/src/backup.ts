import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdtemp, open, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import type { Db } from "./index";

/** Publish a verified, standalone snapshot; never copy the live database file. */
export async function backupDatabase(db: Db, directory: string): Promise<string> {
  if (!isAbsolute(directory)) throw new Error("DB_BACKUP_DIR must be an absolute path");
  if (!(await stat(directory)).isDirectory()) {
    throw new Error("DB_BACKUP_DIR must be an existing directory");
  }

  const name = `moneyforward-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.db`;
  const destination = join(directory, name);
  const staging = join(directory, `.${name}.partial`);
  const workspace = await mkdtemp(join(tmpdir(), "mf-dashboard-backup-"));
  try {
    const snapshot = join(workspace, "snapshot.db");
    await db.run(sql`VACUUM INTO ${snapshot}`);
    await chmod(snapshot, 0o600);
    // A cloud sync service may see this temporary copy, but it is not a finished backup.
    await copyFile(snapshot, staging);
    const client = createClient({ url: pathToFileURL(staging).href });
    try {
      const result = await client.execute("PRAGMA integrity_check");
      if (result.rows.length !== 1 || result.rows[0]?.[0] !== "ok") {
        throw new Error("Database backup integrity check failed");
      }
    } finally {
      client.close();
    }
    const file = await open(staging, "r+");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(staging, destination);
    return destination;
  } finally {
    await rm(staging, { force: true });
    await rm(workspace, { recursive: true, force: true });
  }
}
