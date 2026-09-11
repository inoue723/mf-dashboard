import type { Db } from "@mf-dashboard/db";
import { backupDatabase } from "@mf-dashboard/db/backup";
import { beforeEach, expect, test, vi } from "vitest";
import { runDatabaseBackup } from "./database-backup.js";

vi.mock("@mf-dashboard/db/backup", () => ({ backupDatabase: vi.fn<typeof backupDatabase>() }));
const db = {} as Db;
beforeEach(() => vi.resetAllMocks());

test.each([undefined, "", "   "])("保存先未設定なら無効: %s", async (directory) => {
  await runDatabaseBackup(db, { DB_BACKUP_DIR: directory });
  expect(backupDatabase).not.toHaveBeenCalled();
});

test("設定された保存先へバックアップを作成する", async () => {
  await runDatabaseBackup(db, { DB_BACKUP_DIR: " /backups " });
  expect(backupDatabase).toHaveBeenCalledWith(db, "/backups");
});

test("バックアップ失敗を呼び出し元に伝える", async () => {
  vi.mocked(backupDatabase).mockRejectedValueOnce(new Error("backup failed"));
  await expect(runDatabaseBackup(db, { DB_BACKUP_DIR: "/backups" })).rejects.toThrow(
    "backup failed",
  );
});
