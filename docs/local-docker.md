# CloudflareなしでDockerを使う

`compose.local.yml`はWebダッシュボード、定期実行クローラー、起動前のDBマイグレーションを起動する。CloudflareやTerraformの設定は不要。

## 起動

Docker Desktopを起動し、ルートの`.env`に1Passwordの`OP_SERVICE_ACCOUNT_TOKEN`、`OP_VAULT`、`OP_ITEM`、`OP_TOTP_FIELD`を設定する。さらにWebとクローラーの内部API用に`REFRESH_TOKEN`を設定する。値は`openssl rand -hex 32`で生成できる。

バックアップを使う場合は、既存のiCloud Driveフォルダの絶対パスを`DB_BACKUP_DIR`に設定する。[バックアップ手順](database-backup.md)も参照。

```sh
docker compose -f compose.local.yml -f compose.backup.yml up -d --build
```

ブラウザで <http://127.0.0.1:8765> を開く。バックアップなしで起動する場合は`-f compose.backup.yml`を省略する。既存の`data/moneyforward.db`をそのまま使用する。

Webは`AUTH_MODE=local`で動作し、ローカルホストへのAPIリクエストを許可する。ポートは`127.0.0.1`に限定し、このMacから利用する。ログイン認証を提供する構成ではないため、公開ポートを全インターフェースへ変更したり、外部公開のプロキシを追加したりしない。Cloudflare公開用の`compose.yml`では、このモードは有効にしない。

## 定期実行と確認

クローラー内のsupercronicが毎日6:30・15:30（日本時間）に実行する。Macがスリープ中やDocker停止中は実行されず、復帰時に過去の実行分を補う機能はない。起動直後の即時取得が必要な場合はWebの手動更新を使う。

```sh
docker compose -f compose.local.yml -f compose.backup.yml ps
docker compose -f compose.local.yml -f compose.backup.yml logs -f crawler
```

Docker内のログイン状態は専用ボリュームへ保存するため、ローカル実行時の`data/auth-state.json`とは別。Dockerでの初回認証には1Password設定が必要。

停止時も同じComposeファイルを指定する。DBと認証ボリュームは保持される。

```sh
docker compose -f compose.local.yml -f compose.backup.yml down --remove-orphans
```

Cloudflare版と同じComposeプロジェクトを使用するため、両構成の同時起動はしない。切り替え時は起動済みの構成を停止してから起動する。

## 検証方針

ISO/IEC 25010:2023の機能適合性とセキュリティを対象とする。決定表テストでローカルモードの明示指定とループバックURLの組み合わせを検証し、既存のCloudflare JWT検証が維持されることを確認する。Compose設定の検証ではCloudflare設定なしで解決できること、公開ポートのループバック限定、Web・クローラー・マイグレーションの依存関係、バックアップのマウントを確認する。イメージのビルド、実サービスへのログイン、時刻到来時の実行、iCloudアップロードは別途実環境で確認する。
