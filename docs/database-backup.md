# SQLiteをiCloud Driveへバックアップする

`DB_BACKUP_DIR`を設定すると、クローラーのデータ保存・分析・グループ復元が成功した後、成功通知の前にバックアップする。未設定の場合は無効。

SQLiteの`VACUUM INTO`でローカル一時領域に一貫したコピーを生成し、保存先の`.partial`ファイルへコピーする。`PRAGMA integrity_check`とディスクへの書き出しが成功してから、UTC日時とUUID付きの`moneyforward-*.db`へリネームする。

バックアップに失敗すると、そのクローラー実行は失敗として報告される。保存済みの元DBはロールバックしない。過去のバックアップは上書き・自動削除しないため、容量に合わせて古い世代を整理する。

## Macで直接実行する

FinderのiCloud Drive内に`mf-dashboard-backups`フォルダを作成する。ルートの`.env`に、実際の絶対パスを設定する。標準的なパスの例:

```dotenv
DB_BACKUP_DIR="/Users/<user>/Library/Mobile Documents/com~apple~CloudDocs/mf-dashboard-backups"
```

`<user>`はMacのホームディレクトリに合わせて置き換える。`~`や`$HOME`の展開には対応しない。フォルダは事前に作成し、iCloud Driveへの同期が有効であることを確認する。

```sh
pnpm --filter @mf-dashboard/crawler dev:scrape
```

この開発用コマンドは金融機関の一括更新をスキップする。クローラーは既存の通常処理も実行するため、カテゴリ決定・通知を設定している場合はそれらも動作する。

## Docker Composeで実行する

同じ`.env`設定を使用し、追加のComposeファイルでホストの保存先をcrawlerへマウントする。

```sh
docker compose -f compose.yml -f compose.backup.yml up -d
```

コンテナ内では`/app/backups`へ保存し、Mac側のiCloud Driveがアップロードする。Docker Desktopに対象フォルダへのアクセス権が必要。追加ファイルを指定しない通常のComposeではバックアップは無効。

## 保存・復元の確認

- ログのバックアップ完了はローカル保存の完了を意味する。クラウドへのアップロード完了は保証しないため、FinderまたはiCloud.comで確認する。
- 復元には完成した`moneyforward-*.db`だけを使用する。`.partial`は復元対象ではなく、強制終了で残った場合はクローラー停止後に削除できる。
- 復元するときはWebとクローラーを停止し、現在のDBと関連する`-wal`・`-shm`・`-journal`を別フォルダへ退避する。その後、ダウンロード済みバックアップを`data/moneyforward.db`へコピーして再起動する。古い関連ファイルと復元DBを混在させない。
- `.env`や認証セッションはバックアップに含まれない。

## 検証方針

ISO/IEC 25010:2023の機能適合性と信頼性を対象とする。等価分割で未設定・有効な保存先・不正な保存先を検証し、状態遷移とエラー推測で保存成功後のみの実行、保存失敗時のスキップ、バックアップ失敗の伝播を確認する。

匿名データの実SQLiteで、WAL内の確定済みデータを単独のDBとして復元できること、元DBの後続更新から独立していること、世代を上書きしないこと、一時ファイルの後始末を検証する。iCloudのアップロード、Docker Desktopのアクセス権、電源断時のファイルシステム動作は自動テストの対象外。
