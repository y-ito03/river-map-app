# 川の調査マップ アプリ仕様・要件定義・設計・公開運用資料

作成日: 2026-06-05

## 1. 目的

本資料は、川の調査マップアプリの仕様、要件、設計、データ構造、API、さくらVPS公開構成、HTTPS化、アクセス制限、負荷確認、バックアップ、今後の運用作業をまとめたものです。

対象読者は、開発者、サーバ管理者、研究室・授業担当者です。

## 2. アプリ概要

本アプリは、川の調査で得られたAI検出結果とGPS軌跡を地図上に表示し、利用者が検出ポイントに対して追加投稿できるWebアプリです。

主な利用イメージ:

- PC、iPad、スマートフォンのブラウザからアクセスする
- メニューから調査動画ごとの記録を選ぶ
- 地図上にGPS軌跡とAI検出ポイントを表示する
- ピンをクリックして検出生物、検出時刻、地上画像サムネイルを確認する
- 利用者がニックネーム、生物名、コメント、画像を追加投稿する
- 投稿済みデータを再読み込みして閲覧する
- 生物の分布をヒートマップで確認する

## 3. 現在の公開URLと公開状態

現在のVPS:

```text
IPアドレス: 133.167.89.113
初期ドメイン: os3-374-20359.vs.sakura.ne.jp
HTTPS URL: https://os3-374-20359.vs.sakura.ne.jp/
```

現在は開発中のため、NginxのBasic認証でアクセス制限しています。Basic認証のユーザー名・パスワード、SSH秘密鍵、サーバログイン情報は秘密情報なので、本資料には記載しません。

## 4. システム構成

### 4.1 全体構成

```text
PC / iPad / スマートフォン
  |
  | HTTPS :443
  v
Nginx
  |-- Basic認証
  |-- HTTPS終端
  |-- frontend/dist を静的ファイルとして配信
  |-- /api/   -> http://127.0.0.1:8000/api/
  |-- /media/ -> http://127.0.0.1:8000/media/
  v
Node.js / Express backend
  |-- SQLite database.sqlite
  |-- media/uploads/
  |-- media/<processing_id>/thumbnails/
```

### 4.2 各コンポーネントの役割

| コンポーネント | 役割 |
|---|---|
| Nginx | 外部公開の入口、HTTPS終端、Basic認証、静的ファイル配信、API中継 |
| frontend | Viteでビルドするブラウザ用アプリ |
| backend | ExpressによるAPI、投稿保存、画像アップロード、メディア配信 |
| SQLite | 調査グループ、検出ポイント、投稿データの保存 |
| PM2 | Node.jsバックエンドの常時起動と再起動後の復旧 |
| Certbot / Let's Encrypt | HTTPS証明書の取得と自動更新 |

## 5. 技術スタック

### 5.1 フロントエンド

- Vite
- Vanilla JavaScript
- CSS
- Leaflet
- leaflet.heat
- ローカル配置した地図画像・タイル画像

主要ファイル:

```text
frontend/index.html
frontend/main.js
frontend/wizard.js
frontend/style.css
frontend/vite.config.js
frontend/public/
```

### 5.2 バックエンド

- Node.js
- Express
- SQLite
- sqlite / sqlite3
- multer
- csv-parser

主要ファイル:

```text
backend/server.js
backend/init_db.js
backend/package.json
backend/results.csv
backend/database.sqlite
backend/media/
```

### 5.3 VPS

現在のVPSは以下の想定です。

```text
OS: Ubuntu系Linux
VPS: さくらVPS
スペック: 仮想4Core / メモリ4GB / SSD 200GB
```

## 6. 機能要件

### 6.1 地図表示

- 川周辺の地図画像を表示する
- Leafletで地図操作を行う
- 表示範囲を指定された範囲に制限する
- GPS軌跡を青線で表示する
- AI検出ポイントをピンとして表示する

### 6.2 調査記録の切り替え

- サーバから取得した調査グループをメニューに自動表示する
- 調査グループを選ぶと、該当するGPS軌跡と検出ポイントを表示する
- 表示タイトルを調査動画名に合わせて更新する

### 6.3 ポイント詳細表示

ピンをクリックしたとき、以下を表示する。

- 検出された生物名
- 検出時刻
- AI検出画像または地上画像のサムネイル
- 水中画像枠
- 追加投稿ボタン
- 投稿済みデータ

### 6.4 投稿機能

利用者は検出ポイントに対して以下を投稿できる。

- ニックネーム
- 生物名
- コメント
- 画像ファイル

投稿はウィザード形式で入力する。

投稿ステップ:

1. ニックネーム入力
2. 生物名選択
3. 画像選択
4. コメント入力
5. 確認して登録

選択できる生物名:

```text
アカハライモリ
サワガニ
ハグロトンボ
コオニヤンマ
その他
```

### 6.5 投稿閲覧

- 投稿済みデータをポイント詳細内に表示する
- 同じ検出ポイントに複数投稿がある場合、前後ボタンで切り替える
- 投稿画像がある場合は画像を表示する
- 最新状態にするボタンでサーバから再取得する

### 6.6 ヒートマップ

- 全検出ポイントをもとにヒートマップを表示する
- 生物ごとの検出数を表示する
- 生物名で絞り込みできる

## 7. 非機能要件

### 7.1 セキュリティ

- 公開中はHTTPSを使用する
- 開発中はBasic認証でアクセス制限する
- SSH秘密鍵は第三者に渡さない
- Basic認証のパスワードは資料・GitHub・チャット等に記載しない
- SSHログインは鍵認証を基本とする
- 80番、443番、SSH以外の不要なポートは開けない

### 7.2 性能

最低限の目標:

- 50同時接続程度でAPI取得が失敗しない
- Nginxで静的ファイルを配信し、Node.jsの負荷を抑える
- 小規模利用ではSQLiteを継続利用する

確認済みの簡易負荷テスト:

```bash
ab -n 500 -c 50 http://127.0.0.1:8000/api/surveys
```

結果:

```text
Concurrency Level: 50
Complete requests: 500
Failed requests: 0
Requests per second: 約79.94 req/sec
Time per request: 約625 ms
```

この結果から、`GET /api/surveys` の取得については、50同時接続程度で失敗しないことを確認済みです。ただし、画像アップロードや同時投稿の負荷は別途確認が必要です。

### 7.3 可用性

- バックエンドはPM2で常時起動する
- Nginxはsystemdで起動管理する
- サーバ再起動後にPM2とNginxが復旧する設定を行う

### 7.4 バックアップ

投稿や画像はGitHubでは管理しないため、VPS上のデータを別途バックアップする。

バックアップ対象:

```text
/home/ito/river-map-app/backend/database.sqlite
/home/ito/river-map-app/backend/media/uploads/
/home/ito/river-map-app/backend/media/*/thumbnails/
```

必要に応じて以下も保管する。

```text
/home/ito/river-map-app/backend/results.csv
```

## 8. データ設計

### 8.1 groups

調査動画または調査グループを表す。

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT | グループID。`processing_id` を使用 |
| name | TEXT | 表示名。現在は元動画ファイル名 |
| gps_track | TEXT | GPS軌跡JSON文字列 |

### 8.2 detections

AIによる生物検出ポイントを表す。

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT | 検出ポイントID。UUID |
| group_id | TEXT | 所属グループID |
| class_name | TEXT | 検出された生物名 |
| confidence | REAL | 検出信頼度 |
| lat | REAL | 緯度 |
| lng | REAL | 経度 |
| timestamp_sec | REAL | 動画内の検出時刻 |
| thumbnail_path | TEXT | サムネイル画像の相対パス |

### 8.3 user_posts

利用者の追加投稿を表す。

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER | 投稿ID。自動採番 |
| detection_id | TEXT | 対象検出ポイントID |
| nickname | TEXT | ニックネーム |
| creature | TEXT | 利用者が選択した生物名 |
| comment | TEXT | コメント |
| image_url | TEXT | 投稿画像の相対パス |

現在の実装では `created_at` は未実装です。投稿日時を管理したい場合は、今後追加する候補です。

## 9. API仕様

### 9.1 GET /api/surveys

目的:

地図描画、メニュー作成、ポイント詳細表示、ヒートマップ生成に必要な全データを取得する。

レスポンス例:

```json
{
  "processing-id": {
    "name": "GX010041.MP4",
    "gps_track": [[35.0, 135.0]],
    "detections": [
      {
        "id": "uuid",
        "lat": 35.0,
        "lng": 135.0,
        "class_name": "ハグロトンボ",
        "timestamp": 1357.77,
        "thumbnail_url": "processing-id/thumbnails/image.jpg",
        "user_posts": [
          {
            "nickname": "name",
            "creature": "その他",
            "comment": "コメント",
            "image_url": "uploads/post_..."
          }
        ]
      }
    ]
  }
}
```

### 9.2 POST /api/detections/:id/posts

目的:

指定した検出ポイントに利用者投稿を追加する。

リクエスト:

- `multipart/form-data`
- `nickname`
- `creature`
- `comment`
- `image`

レスポンス例:

```json
{
  "status": "success",
  "message": "投稿をデータベースに保存しました！"
}
```

保存先:

```text
backend/media/uploads/post_<timestamp>.<extension>
```

## 10. メディアファイル設計

### 10.1 必要なメディア

VPS上で必要なメディアは以下です。

```text
backend/media/<processing_id>/thumbnails/
backend/media/uploads/
```

`thumbnails` はAI検出・地上画像サムネイル表示に必要です。`uploads` は利用者投稿画像に必要です。

### 10.2 不要または任意のメディア

現在のアプリではHLS動画を再生していないため、以下は必須ではありません。

```text
backend/media/<processing_id>/hls/
backend/media/<processing_id>/original/
```

動画再生機能を追加する場合は、別途仕様化が必要です。

## 11. ローカル開発手順

### 11.1 バックエンド起動

```bash
cd backend
npm ci
npm start
```

既定ポート:

```text
8000
```

ポートを変更する場合:

```bash
PORT=8010 npm start
```

Windows PowerShellの場合:

```powershell
$env:PORT=8010
npm start
```

### 11.2 フロントエンド起動

```bash
cd frontend
npm ci
npm run dev
```

Vite開発時は以下をバックエンドへ中継する。

```text
/api   -> http://127.0.0.1:8000
/media -> http://127.0.0.1:8000
```

### 11.3 ローカル確認項目

- 地図が表示される
- メニューが表示される
- ピンをクリックできる
- サムネイルが表示される
- 投稿できる
- 投稿画像が再表示される
- 最新状態にするボタンで再取得できる

## 12. VPSデプロイ手順

### 12.1 前提

VPS上に以下が入っていること。

```text
git
Node.js
npm
nginx
pm2
certbot
```

### 12.2 コード取得

```bash
cd ~
git clone https://github.com/y-ito03/river-map-app.git
cd ~/river-map-app
```

リポジトリをprivateに戻した後は、VPSから `git pull` する際にGitHub認証が必要になる場合があります。

### 12.3 フロントエンドビルド

```bash
cd ~/river-map-app/frontend
npm ci
npm run build
```

成果物:

```text
~/river-map-app/frontend/dist
```

### 12.4 バックエンド依存関係

```bash
cd ~/river-map-app/backend
npm ci
```

必要に応じてDB初期化:

```bash
node init_db.js
```

注意:

`init_db.js` は `groups` と `detections` を作り直します。既存投稿を保持したい場合は、実行前に `database.sqlite` をバックアップしてください。

### 12.5 メディア配置

GitHubには投稿画像やサムネイル画像を基本的に置かないため、VPSへ別途コピーする。

必要なコピー対象:

```text
backend/media/<processing_id>/thumbnails/
backend/media/uploads/
```

Windowsからコピーする例:

```powershell
scp -r backend\media ito@133.167.89.113:~/river-map-app/backend/
```

HLS動画をコピーしてしまった場合、現在のアプリでは不要なので削除してよい。

```bash
rm -rf ~/river-map-app/backend/media/<processing_id>/hls
```

## 13. PM2運用

### 13.1 バックエンド起動

```bash
cd ~/river-map-app/backend
pm2 start npm --name river-map-backend -- start
```

### 13.2 状態確認

```bash
pm2 status
```

期待する状態:

```text
river-map-backend online
```

### 13.3 自動起動設定

```bash
pm2 save
pm2 startup
```

`pm2 startup` 実行後に表示される `sudo env PATH=...` のコマンドをコピーして実行する。

## 14. Nginx公開設定

### 14.1 基本方針

- Nginxが外部からのHTTP/HTTPSを受ける
- フロントエンドは `frontend/dist` を配信する
- `/api/` と `/media/` はバックエンド `127.0.0.1:8000` へ中継する
- 開発中はBasic認証を有効にする

### 14.2 設定ファイル

```bash
sudo nano /etc/nginx/sites-available/river-map-app
```

設定反映:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

状態確認:

```bash
sudo systemctl status nginx
```

`status` 画面を閉じるには `q` を押す。

### 14.3 Basic認証

パスワードファイル作成:

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd river
```

Nginx設定の `server` ブロック内に追加:

```nginx
auth_basic "River Map";
auth_basic_user_file /etc/nginx/.htpasswd;
```

Let's Encryptの認証用パスはBasic認証を無効化する。

```nginx
location ^~ /.well-known/acme-challenge/ {
    auth_basic off;
    root /home/ito/river-map-app/frontend/dist;
}
```

## 15. HTTPS化

### 15.1 使用ドメイン

現在は、さくらVPSの初期ドメインを使用する。

```text
os3-374-20359.vs.sakura.ne.jp
```

### 15.2 Certbotで証明書取得

```bash
sudo certbot --nginx -d os3-374-20359.vs.sakura.ne.jp
```

### 15.3 証明書更新テスト

```bash
sudo certbot renew --dry-run
```

確認済み結果:

```text
Congratulations, all simulated renewals succeeded
```

### 15.4 HTTPS確認

```bash
curl -I -u river https://os3-374-20359.vs.sakura.ne.jp/api/surveys
```

パスワードを入力し、以下が返れば成功。

```text
HTTP/1.1 200 OK
```

Basic認証なしで確認すると、以下が返るのは正常。

```text
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="River Map"
```

## 16. さくらVPS側のネットワーク設定

### 16.1 OS内ファイアウォール

VPS上のUbuntuでは `ufw` を使用している。

確認:

```bash
sudo ufw status
```

許可対象:

```text
OpenSSH
80/tcp
443/tcp
```

### 16.2 さくらVPSパケットフィルター

さくらVPSコントロールパネル側でも、Web用の80番・443番を許可する必要がある。

外部からタイムアウトする場合の切り分け:

- VPS内部で `curl -I http://127.0.0.1/` が成功する
- VPS内部で `curl -I http://127.0.0.1/api/surveys` が成功する
- `sudo ufw status` で80/443が許可済み
- それでも外部ブラウザからアクセスできない

この場合、さくらVPSコントロールパネル側のパケットフィルターを確認する。

## 17. バックアップ

### 17.1 バックアップ作成

```bash
cd ~/river-map-app/backend
tar -czf ~/river-map-backup-$(date +%Y%m%d).tar.gz database.sqlite media/uploads media/*/thumbnails
```

確認:

```bash
ls -lh ~/river-map-backup-*.tar.gz
```

確認済みバックアップ例:

```text
/home/ito/river-map-backup-20260605.tar.gz
サイズ: 約79MB
```

### 17.2 Windowsへコピー

Windows側で実行:

```powershell
mkdir C:\tmp
scp ito@133.167.89.113:~/river-map-backup-20260605.tar.gz C:\tmp\
```

確認:

```powershell
dir C:\tmp
```

### 17.3 復元方針

復元する場合は、バックアップをVPSへ戻して展開する。

```bash
cd ~/river-map-app/backend
tar -xzf ~/river-map-backup-YYYYMMDD.tar.gz
pm2 restart river-map-backend
```

復元前に現在の `database.sqlite` と `media/` を別名で退避してから行うこと。

## 18. 動作確認チェックリスト

### 18.1 ブラウザ確認

URL:

```text
https://os3-374-20359.vs.sakura.ne.jp/
```

確認項目:

- HTTPSでアクセスできる
- ブラウザで保護された接続と表示される
- Basic認証が表示される
- Basic認証後にアプリが表示される
- 地図が表示される
- メニューが開く
- 調査記録を切り替えられる
- ピンをクリックできる
- サムネイル画像が表示される
- 投稿済み画像が表示される
- 新規投稿できる
- ページ再読み込み後も投稿が残る
- iPadから警告なしにアクセスできる

### 18.2 API確認

Basic認証付き:

```bash
curl -I -u river https://os3-374-20359.vs.sakura.ne.jp/api/surveys
```

期待:

```text
HTTP/1.1 200 OK
```

VPS内部:

```bash
curl -I http://127.0.0.1:8000/api/surveys
```

期待:

```text
HTTP/1.1 200 OK
```

### 18.3 サービス確認

```bash
pm2 status
sudo systemctl status nginx
sudo certbot renew --dry-run
```

期待:

- `river-map-backend` が `online`
- `nginx` が `active (running)`
- 証明書更新テストが成功

## 19. 運用手順

### 19.1 コード更新

```bash
cd ~/river-map-app
git pull

cd frontend
npm ci
npm run build

cd ../backend
npm ci
pm2 restart river-map-backend
sudo systemctl reload nginx
```

privateリポジトリの場合、VPSから `git pull` するにはGitHub認証またはデプロイキー設定が必要になる。

### 19.2 投稿データを守る注意点

以下は投稿データに影響するため注意する。

- `backend/database.sqlite` を削除しない
- `backend/media/uploads/` を削除しない
- 投稿がある状態で `node init_db.js` を不用意に実行しない
- デプロイ前にバックアップを取る

### 19.3 開発中の公開制限

開発中はBasic認証を有効にしたままにする。

正式公開時は、以下を検討する。

- Basic認証を外すかどうか
- 投稿できる人を制限するか
- 画像アップロードサイズ制限
- 投稿内容の削除・管理機能
- 荒らし投稿対策

## 20. 現在確認済みの状態

2026-06-05時点で確認済み:

- さくらVPSの80/443番ポートが外部から通る
- HTTPS化済み
- 初期ドメインでアクセス可能
- Basic認証設定済み
- `GET /api/surveys` がBasic認証付きで `200 OK`
- 証明書更新dry-run成功
- 50同時接続の簡易負荷テスト成功
- バックアップ作成済み
- バックアップをWindowsへコピー済み
- PM2でバックエンドが `online`
- Nginxが `active (running)`

## 21. 未確認・今後の課題

### 21.1 HTTPからHTTPSへのリダイレクト

`http://os3-374-20359.vs.sakura.ne.jp/` から `https://...` へ自動転送されるかは、まだ最終確認または設定調整が必要です。

確認:

```bash
curl -I http://os3-374-20359.vs.sakura.ne.jp/
```

期待:

```text
HTTP/1.1 301 Moved Permanently
Location: https://os3-374-20359.vs.sakura.ne.jp/
```

### 21.2 同時投稿・画像アップロード負荷

`GET /api/surveys` の50同時接続は確認済みですが、以下は未確認です。

- 複数人の同時投稿
- 複数人の同時画像アップロード
- 大きな画像を連続投稿した場合
- 外部インターネット経由での負荷

### 21.3 投稿管理機能

現在は投稿追加機能が中心です。以下は今後の検討事項です。

- 投稿削除
- 投稿編集
- 管理者画面
- 不適切投稿の非表示
- 投稿日時の記録

### 21.4 SQLiteの長期運用

小規模利用ではSQLiteで問題ありません。利用者数や投稿数が増えた場合は、PostgreSQLなどへの移行を検討します。

### 21.5 メディア配信最適化

現在 `/media/` はExpress経由で配信しています。画像アクセスが多い場合は、Nginxから直接配信する構成も検討できます。

## 22. 先生・管理者への報告文例

```text
公開環境の初期設定が完了しました。

現在、https://os3-374-20359.vs.sakura.ne.jp/ でHTTPSアクセスできる状態です。
開発中のため、NginxのBasic認証でアクセス制限をかけています。

確認済みの内容は以下です。

・HTTPS証明書の取得
・証明書自動更新のdry-run成功
・APIのHTTPSアクセス確認
・PM2によるバックエンド常時起動
・Nginxの起動確認
・50同時接続の簡易負荷テスト
・DBと画像ファイルのバックアップ作成

今後は、PC/iPadでの実際の画面操作、投稿、画像表示、HTTPからHTTPSへの自動転送設定を確認します。
```

## 23. 重要な注意

以下は絶対にGitHubや資料に書かない。

- SSH秘密鍵
- Basic認証パスワード
- VPS初期パスワード
- さくら会員ID・会員メニューパスワード
- GitHubアクセストークン

秘密情報が漏れた可能性がある場合は、すぐにパスワード変更または鍵の再発行を行う。
