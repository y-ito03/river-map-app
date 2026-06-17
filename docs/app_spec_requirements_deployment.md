# 岩倉川の調査記録 アプリ仕様・要件定義・設計・公開運用資料

更新日: 2026-06-12

## 1. 本資料の目的

本資料は、岩倉川の調査記録アプリについて、現在の仕様、要件、画面設計、データ設計、API、サーバ公開構成、アクセス管理、投稿管理、バックアップ、デプロイ、運用上の注意点をまとめたものです。

対象読者は、開発者、授業担当者、研究室関係者、VPS管理者です。

本アプリは開発途中で複数回仕様変更されています。本資料では、2026-06-12時点の実装状態を基準に記述します。

## 2. アプリ概要

本アプリは、小学生が岩倉川周辺で行う生き物調査の結果を、地図上で確認・投稿できるWebアプリです。

主な目的は以下です。

- AI検出結果と移動の軌跡を地図上に表示する
- 班ごとの調査ルートを比較できるようにする
- 児童が見つけた生き物、かいた絵、考えた図、コメントを投稿できるようにする
- 先生が投稿内容を確認し、不適切な投稿を非表示・削除できるようにする
- iPad等のブラウザからQRコードで簡単に利用できるようにする

想定利用者:

- 小学4・5年生
- 授業担当者・先生
- 研究室・管理者

想定端末:

- 主端末: iPad
- 補助対応: PC、スマートフォン

iPadでは横向き利用を推奨します。地図と右側の詳細パネルを同時に見やすいためです。ただし、縦向きやスマートフォンでも操作できるよう、狭い画面では詳細パネルや投稿画面が画面内でスクロールできるようにしています。

## 3. 現在の公開構成

現在のVPS:

```text
IPアドレス: 133.167.89.113
初期ドメイン: os3-374-20359.vs.sakura.ne.jp
HTTPS URL: https://os3-374-20359.vs.sakura.ne.jp/
```

児童向けアクセスは、URLにアクセスコードを含めたQRコードを配布する方針です。

例:

```text
https://os3-374-20359.vs.sakura.ne.jp/?access=アクセスコード
```

実際のアクセスコード、管理用コード、SSH鍵、パスワード類は秘密情報のため、この資料には記載しません。共有が必要な場合は、GitHubや通常の資料ではなく、別の安全な方法で管理します。

## 4. システム構成

### 4.1 全体構成

```text
iPad / PC / スマートフォン
  |
  | HTTPS :443
  v
Nginx
  |-- HTTPS終端
  |-- frontend/dist を静的ファイルとして配信
  |-- /api/   -> http://127.0.0.1:8000/api/
  |-- /media/ -> http://127.0.0.1:8000/media/
  v
Node.js / Express backend
  |-- アクセスコード確認
  |-- 管理用コード確認
  |-- API処理
  |-- 画像アップロード
  |-- SQLite database.sqlite
  |-- media/uploads/
  |-- media/<processing_id>/thumbnails/
```

### 4.2 各コンポーネントの役割

| コンポーネント | 役割 |
|---|---|
| Nginx | 外部公開、HTTPS終端、静的ファイル配信、API・メディア中継 |
| frontend | Viteでビルドするブラウザ用アプリ |
| backend | ExpressによるAPI、投稿保存、画像配信、アクセスコード確認 |
| SQLite | 調査グループ、検出ポイント、投稿データの保存 |
| PM2 | Node.jsバックエンドの常時起動 |
| Certbot / Let's Encrypt | HTTPS証明書の取得と自動更新 |

### 4.3 Dockerについて

教授側でDockerが使える状態にされていますが、現在の本アプリ運用ではDockerを使用していません。

現在は以下の構成で動かしています。

- Node.jsをVPSへ直接インストール
- ExpressバックエンドをPM2で常時起動
- フロントエンドをViteでビルドし、Nginxが `frontend/dist` を配信

Dockerを使わないこと自体は問題ありません。小規模な授業利用では、現在の構成の方が初学者にも追いやすく、障害時の確認もしやすいです。

## 5. 技術スタック

### 5.1 フロントエンド

- Vite
- Vanilla JavaScript
- CSS
- Leaflet
- leaflet.heat
- ローカル配置した地図画像

主要ファイル:

```text
frontend/index.html
frontend/main.js
frontend/wizard.js
frontend/style.css
frontend/admin.html
frontend/admin.js
frontend/admin.css
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

想定環境:

```text
OS: Ubuntu系Linux
VPS: さくらVPS
スペック: 仮想4Core / メモリ4GB / SSD 200GB
```

## 6. フロントエンド機能仕様

### 6.1 地図表示

現在の地図画像:

```text
frontend/public/river_map5.jpg
```

元の高解像度PNGは読み込みが遅かったため、現在は軽量化したJPEGを使用しています。地図の位置合わせは、以下の値で経度方向に補正しています。

```text
MAP_IMAGE_LNG_OFFSET = 0.00006
```

この値は、アイコンや軌跡が川の中央に近づくように、背景の地図画像だけを少し東側へずらすためのものです。投稿データや検出ポイントの緯度経度自体は変更していません。

初期表示では、地図イラストが余白なく見えるよう、Leafletの `getBoundsZoom` を使って表示倍率を調整しています。

### 6.2 地図操作

- 拡大・縮小
- 地図範囲の制限
- ピン選択
- 自由投稿モードで地図をタップして投稿場所を選択
- 画像タップ時の拡大表示

### 6.3 メニュー

左上の三本線ボタンからメニューを開きます。

メニューには以下を表示します。

- 各班の調査記録
- ぜんぶの班の道
- 好きな場所にとうこうする
- 多く見つかった場所を見る
- 使い方を見る
- 新しくする

メニューを開いた状態で地図などメニュー外をタップすると、メニューは閉じます。

### 6.4 班・クラス表示

クラス名は以下のように表示します。

| CSV上の組 | アプリ上の表示 |
|---|---|
| 1組 | Davis |
| 2組 | Hardy |
| 3組 | Learned |

CSVの `original_video_filename` は、以下のような名前にしておくとアプリが班情報を読み取れます。

```text
1組3班
Davis 3班
Hardy 2班
Learned 7班
```

班ごとの軌跡色は、班番号ごとに色を変えます。クラスは線の種類で区別します。

- Davis: 実線
- Hardy: 破線
- Learned: 点線

これにより、3クラス x 7班を21色で分けるのではなく、色は班、線種はクラスとして整理しています。

### 6.5 全班表示

「ぜんぶの班の道」では、複数班の移動軌跡を同時に表示します。

表示フィルター:

- すべてのクラス
- Davisだけ
- Hardyだけ
- Learnedだけ

全班表示時は、表示対象クラスに該当する投稿済み検出ポイントと自由投稿も表示します。

### 6.6 検出ポイント表示

検出ポイントは通常、青いピンで表示します。

投稿がある検出ポイントは、投稿された生き物に応じたアイコンに変わります。現在対応しているアイコンは以下です。

- アカハライモリ
- サワガニ
- ハグロトンボ
- コオニヤンマ
- その他

アイコンファイル:

```text
frontend/public/species-icons/
```

投稿が複数ある場合は、最新の投稿の生き物を代表としてアイコンに使います。

### 6.7 ポイント詳細表示

検出ポイントを選択すると、右側の詳細パネルに以下を表示します。

- 検出された生き物名
- 地上画像
- 水中画像枠
- 投稿ボタン
- 投稿済み内容

以前表示していた「見つけた時間」は、現在は表示していません。

地上画像、投稿された「かいた絵」、投稿された「考えた図」は、タップすると拡大表示できます。

### 6.8 投稿機能

投稿できる場所は2種類あります。

1. 検出ポイントへの投稿
2. 地図上の好きな場所への自由投稿

投稿項目:

- 生き物
- かいた絵
- 考えた図
- コメント

現在は名前入力を削除しています。児童の個人名を入力しない設計です。

選択できる生き物:

```text
アカハライモリ
サワガニ
ハグロトンボ
コオニヤンマ
その他
```

投稿画面の文言は、小学4・5年生を想定し、できるだけ簡単な表現にしています。

### 6.9 自由投稿

「好きな場所にとうこうする」を選ぶと、地図上をタップして投稿場所を選べます。

自由投稿は、そのとき表示しているクラスに紐づきます。

例:

- Davisを表示している状態で自由投稿した場合、Davisの表示時と全班表示時に表示されます
- Hardyを表示している状態で自由投稿した場合、Hardyの表示時と全班表示時に表示されます

これにより、Davisだけを見ているのにHardyの自由投稿が表示される、といった違和感を避けます。

### 6.10 ヒートマップ

「多く見つかった場所を見る」では、生き物の分布をヒートマップで表示します。

対象:

- AI検出ポイント
- 自由投稿

生き物ごとの数を表示し、生き物名で絞り込みできます。

### 6.11 チュートリアル

初回アクセス時に、コーチマーク型のチュートリアルを表示します。

説明対象:

- メニュー
- 全班表示
- 好きな場所への投稿
- ピンの選択
- 更新

一度見たかどうかはブラウザの `localStorage` に保存します。メニューから「使い方を見る」を選ぶと再表示できます。

## 7. アクセス管理

### 7.1 方針

児童には、アクセスコード付きURLをQRコードとして配布します。

通常URLだけを知っている人がアクセスした場合は、アプリ本体を使えず、QRコードから入り直す案内を表示します。

### 7.2 仕組み

フロントエンドはURLの `access` または `code` クエリを読み取ります。

例:

```text
https://os3-374-20359.vs.sakura.ne.jp/?access=アクセスコード
```

読み取ったアクセスコードはブラウザの `localStorage` に保存され、その後URLからは削除されます。

API通信では以下のヘッダーを付けます。

```text
X-Access-Code: アクセスコード
```

画像表示では以下のようにクエリとして付与します。

```text
/media/uploads/example.jpg?access=アクセスコード
```

バックエンドは環境変数 `ACCESS_CODE` と照合します。

### 7.3 注意点

この方式は、一般公開URLを完全に隠すものではありません。QRコードのURLが外部に共有された場合、その人もアクセスできます。

ただし、小学校内の授業利用で「URLを偶然知った一般ユーザーからの投稿を防ぐ」目的には、Basic認証より児童が使いやすく、現実的な方式です。

アクセスコードが漏れた場合は、以下を行います。

1. VPS側の `ACCESS_CODE` を変更する
2. PM2でバックエンドを再起動する
3. 新しいQRコードを作成して配布する

### 7.4 Basic認証について

開発初期はNginxのBasic認証を使っていましたが、児童にユーザー名・パスワードを入力させる運用は難しいため、現在の主方針はアプリ側のアクセスコード方式です。

Basic認証は、必要に応じて開発中の一時的な保護として使うことはできます。ただし、児童利用時は基本的にオフにします。

## 8. 先生用管理画面

### 8.1 URL

```text
https://os3-374-20359.vs.sakura.ne.jp/admin.html
```

### 8.2 認証

管理画面は管理用コードで保護します。

フロントエンドは管理用コードを `localStorage` に保存し、API通信時に以下のヘッダーを付けます。

```text
X-Admin-Code: 管理用コード
```

バックエンドは環境変数 `ADMIN_CODE` と照合します。`ADMIN_CODE` が未設定の場合は `ACCESS_CODE` を管理用コードとして扱いますが、運用上は `ADMIN_CODE` を別に設定することを推奨します。

### 8.3 管理画面の機能

管理画面では以下ができます。

- 投稿一覧の表示
- 表示中 / 非表示 / すべて の絞り込み
- ピンへの投稿 / えらんだ場所の投稿 の絞り込み
- 投稿画像の確認
- 考えた図の確認
- 投稿を非表示にする
- 非表示の投稿を表示に戻す
- 投稿を削除する

「非表示」は、データベース上に投稿を残したまま児童画面から見えなくする機能です。

「削除」は、データベースの投稿レコードを削除し、対応するアップロード画像も削除します。元に戻せないため、原則としてまず非表示を使うことを推奨します。

### 8.4 不適切投稿への対応

授業中に不適切な投稿があった場合の推奨対応:

1. 管理画面で対象投稿を確認する
2. まず「非表示にする」を押す
3. 授業後に必要なら「削除」する
4. 画像を含む投稿の場合、削除するとアップロード画像も消える

誤って削除した場合に備え、授業前後でバックアップを取ることが重要です。

## 9. データ設計

### 9.1 groups

調査動画または調査グループを表します。

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT | グループID。`processing_id` を使用 |
| name | TEXT | 表示名。CSVの `original_video_filename` |
| gps_track | TEXT | GPS軌跡JSON文字列 |

### 9.2 detections

AIによる生き物検出ポイントを表します。

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT | 検出ポイントID。`init_db.js` がUUIDを生成 |
| group_id | TEXT | 所属グループID |
| class_name | TEXT | 検出された生き物名 |
| confidence | REAL | 検出信頼度 |
| lat | REAL | 緯度 |
| lng | REAL | 経度 |
| timestamp_sec | REAL | 動画内の検出時刻。現在画面には表示しない |
| thumbnail_path | TEXT | サムネイル画像の相対パス |

### 9.3 user_posts

検出ポイントへの児童投稿を表します。

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER | 投稿ID。自動採番 |
| detection_id | TEXT | 対象検出ポイントID |
| nickname | TEXT | 現在は空文字で保存 |
| creature | TEXT | 児童が選択した生き物名 |
| comment | TEXT | コメント |
| image_url | TEXT | かいた絵の画像パス |
| concept_image_url | TEXT | 考えた図の画像パス |
| hidden | INTEGER | 0なら表示、1なら非表示 |

### 9.4 free_posts

自由投稿を表します。

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER | 投稿ID。自動採番 |
| lat | REAL | 緯度 |
| lng | REAL | 経度 |
| class_number | INTEGER | 1=Davis, 2=Hardy, 3=Learned |
| nickname | TEXT | 現在は空文字で保存 |
| creature | TEXT | 児童が選択した生き物名 |
| comment | TEXT | コメント |
| image_url | TEXT | かいた絵の画像パス |
| concept_image_url | TEXT | 考えた図の画像パス |
| hidden | INTEGER | 0なら表示、1なら非表示 |

### 9.5 現在未実装のデータ

現在は投稿日時 `created_at` を保存していません。投稿順はID順で扱っています。

今後、授業後の分析やトラブル対応を強化するなら、以下の追加を検討します。

- 投稿日時
- 投稿端末情報
- 班ID
- 児童個人を特定しない範囲の利用者識別子
- 管理者の操作ログ

## 10. API仕様

### 10.1 GET /api/access-check

目的:

アクセスコードが正しいか確認します。

認証:

```text
X-Access-Code
```

成功:

```json
{ "status": "ok" }
```

### 10.2 GET /api/surveys

目的:

地図描画、メニュー作成、ピン表示、投稿表示、ヒートマップ生成に必要な全データを取得します。

認証:

```text
X-Access-Code
```

レスポンス概要:

```json
{
  "groups": {
    "processing-id": {
      "name": "Davis 1班",
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
              "nickname": "",
              "creature": "コオニヤンマ",
              "comment": "コメント",
              "image_url": "uploads/post_...",
              "concept_image_url": "uploads/concept_..."
            }
          ]
        }
      ]
    }
  },
  "free_posts": [
    {
      "id": 1,
      "lat": 35.0,
      "lng": 135.0,
      "class_number": 1,
      "creature": "サワガニ",
      "comment": "コメント",
      "image_url": "uploads/post_...",
      "concept_image_url": "uploads/concept_..."
    }
  ]
}
```

非表示投稿は返しません。

### 10.3 POST /api/detections/:id/posts

目的:

指定した検出ポイントに投稿します。

認証:

```text
X-Access-Code
```

形式:

```text
multipart/form-data
```

項目:

| 項目 | 説明 |
|---|---|
| nickname | 現在は空文字 |
| creature | 生き物名 |
| comment | コメント |
| image | かいた絵 |
| conceptImage | 考えた図 |

画像保存先:

```text
backend/media/uploads/
```

### 10.4 POST /api/free-posts

目的:

地図上の好きな場所に投稿します。

認証:

```text
X-Access-Code
```

形式:

```text
multipart/form-data
```

項目:

| 項目 | 説明 |
|---|---|
| lat | 緯度 |
| lng | 経度 |
| classNumber | 1=Davis, 2=Hardy, 3=Learned |
| nickname | 現在は空文字 |
| creature | 生き物名 |
| comment | コメント |
| image | かいた絵 |
| conceptImage | 考えた図 |

### 10.5 GET /api/admin/check

目的:

管理用コードが正しいか確認します。

認証:

```text
X-Admin-Code
```

### 10.6 GET /api/admin/posts

目的:

管理画面用に投稿一覧を取得します。表示中・非表示の両方を返します。

認証:

```text
X-Admin-Code
```

### 10.7 PATCH /api/admin/posts/:type/:id

目的:

投稿の表示・非表示を切り替えます。

`type`:

```text
detection
free
```

リクエスト例:

```json
{ "hidden": true }
```

### 10.8 DELETE /api/admin/posts/:type/:id

目的:

投稿を削除します。投稿画像と考えた図の画像も削除します。

`type`:

```text
detection
free
```

## 11. メディアファイル設計

### 11.1 投稿画像

児童が投稿した画像は以下に保存されます。

```text
backend/media/uploads/
```

ファイル名:

```text
post_<timestamp>_<random>.<extension>
concept_<timestamp>_<random>.<extension>
```

### 11.2 検出サムネイル

AI検出結果のサムネイルは以下に置きます。

```text
backend/media/<processing_id>/thumbnails/
```

CSVの `detection_thumbnail_path_relative` には、`media` から見た相対パスを書きます。

例:

```text
b4bc0994-8426-4357-920b-0eb4c52bf1d3/thumbnails/detection_001.jpg
```

この場合、実ファイルは以下に必要です。

```text
backend/media/b4bc0994-8426-4357-920b-0eb4c52bf1d3/thumbnails/detection_001.jpg
```

### 11.3 地図画像・生き物アイコン

地図画像:

```text
frontend/public/river_map5.jpg
```

生き物アイコン:

```text
frontend/public/species-icons/
```

### 11.4 HLS動画について

現在のアプリでは動画再生を行っていません。そのため、以下は必須ではありません。

```text
backend/media/<processing_id>/hls/
backend/media/<processing_id>/original/
```

動画再生機能を追加する場合は、別途仕様化が必要です。

## 12. CSV・軌跡データの追加方法

### 12.1 CSVの置き場所

```text
backend/results.csv
```

### 12.2 サムネイルの置き場所

```text
backend/media/<processing_id>/thumbnails/
```

### 12.3 必要なCSV項目

`init_db.js` が利用している主な列は以下です。

| 列名 | 用途 |
|---|---|
| processing_id | グループID、メディアフォルダ名 |
| original_video_filename | 表示名、クラス・班の判定 |
| full_gps_track_json | 移動軌跡 |
| detection_latitude | 検出緯度 |
| detection_longitude | 検出経度 |
| detection_class_name | 検出生き物名 |
| detection_confidence | 検出信頼度 |
| detection_timestamp_sec | 検出時刻。現在画面には表示しない |
| detection_thumbnail_path_relative | サムネイル相対パス |

### 12.4 班名の書き方

CSVの `original_video_filename` は、アプリが判定できるように以下の形式を推奨します。

```text
Davis 1班
Hardy 2班
Learned 3班
```

または以下も読み取れます。

```text
1組1班
2組2班
3組3班
```

### 12.5 DBへの取り込み

VPSまたはローカルで以下を実行します。

```bash
cd backend
node init_db.js
```

注意:

`init_db.js` は `groups` と `detections` を削除して作り直します。`user_posts` と `free_posts` は削除しませんが、検出ポイントIDは毎回新しいUUIDになるため、既存の検出ポイント投稿が古い検出IDに紐づいたままになる可能性があります。

投稿済みの本番環境で `init_db.js` を実行する前には、必ずバックアップを取ってください。

## 13. ローカル開発手順

### 13.1 バックエンド起動

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

```powershell
$env:PORT=8010
npm start
```

アクセスコード付きで確認する場合:

```powershell
$env:ACCESS_CODE="任意のコード"
$env:ADMIN_CODE="任意の管理コード"
npm start
```

### 13.2 フロントエンド起動

```bash
cd frontend
npm ci
npm run dev
```

Vite開発時は、以下をバックエンドへ中継します。

```text
/api   -> http://127.0.0.1:8000
/media -> http://127.0.0.1:8000
```

### 13.3 ローカル確認項目

- QRコード相当の `?access=...` で入れる
- アクセスコードなしでは案内画面になる
- 地図が表示される
- 地図の位置がピン・軌跡と合っている
- メニューが開く
- メニュー外タップで閉じる
- 班を切り替えられる
- 全班表示でクラス絞り込みできる
- ピンをクリックできる
- 地上画像が表示される
- 画像をタップして拡大表示できる
- 検出ポイントに投稿できる
- 好きな場所に投稿できる
- 投稿後に生き物アイコンへ変わる
- ヒートマップを表示できる
- チュートリアルが表示される
- 管理画面に入れる
- 管理画面で非表示・削除ができる

## 14. VPSデプロイ手順

### 14.1 通常のコード更新

ローカルPCでGitHubへ反映:

```bash
git status
git add -A
git commit -m "変更内容"
git push
```

VPSで反映:

```bash
ssh ito@133.167.89.113
cd ~/river-map-app
git pull
```

フロントエンド変更がある場合:

```bash
cd ~/river-map-app/frontend
npm ci
npm run build
sudo nginx -t
sudo systemctl reload nginx
```

バックエンド変更がある場合:

```bash
cd ~/river-map-app/backend
npm ci
pm2 restart river-map-backend --update-env
```

フロントエンドのみの変更では、通常PM2再起動は不要です。バックエンドAPIや環境変数を変更した場合はPM2再起動が必要です。

### 14.2 環境変数

バックエンドで使う主な環境変数:

| 環境変数 | 役割 |
|---|---|
| PORT | バックエンドのポート。未指定なら8000 |
| ACCESS_CODE | 児童向けアクセスコード |
| ADMIN_CODE | 先生用管理コード |

PM2で環境変数を反映した場合は、再起動時に `--update-env` を付けます。

```bash
pm2 restart river-map-backend --update-env
```

### 14.3 PM2

起動:

```bash
cd ~/river-map-app/backend
pm2 start npm --name river-map-backend -- start
```

状態確認:

```bash
pm2 status
```

期待:

```text
river-map-backend online
```

保存:

```bash
pm2 save
```

### 14.4 Nginx

設定ファイル:

```bash
sudo nano /etc/nginx/sites-available/river-map-app
```

確認:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx
```

`status` 画面を閉じるには `q` を押します。

## 15. HTTPS・ネットワーク

### 15.1 HTTPS証明書

現在は、さくらVPSの初期ドメインでLet's Encrypt証明書を取得する方針です。

```text
os3-374-20359.vs.sakura.ne.jp
```

取得:

```bash
sudo certbot --nginx -d os3-374-20359.vs.sakura.ne.jp
```

更新テスト:

```bash
sudo certbot renew --dry-run
```

### 15.2 HTTPからHTTPSへのリダイレクト

HTTPアクセスはHTTPSへ転送する設定が望ましいです。

確認:

```bash
curl -I http://os3-374-20359.vs.sakura.ne.jp/
```

期待:

```text
HTTP/1.1 301 Moved Permanently
Location: https://os3-374-20359.vs.sakura.ne.jp/
```

### 15.3 ファイアウォール

Ubuntu側:

```bash
sudo ufw status
```

必要な許可:

```text
OpenSSH
80/tcp
443/tcp
```

さくらVPS側のパケットフィルターでも、80番・443番を許可する必要があります。

## 16. バックアップ

### 16.1 バックアップ対象

必須:

```text
backend/database.sqlite
backend/media/uploads/
```

検出サムネイルも再生成できない場合は必須:

```text
backend/media/*/thumbnails/
```

CSVも保管推奨:

```text
backend/results.csv
```

### 16.2 VPS上でバックアップ作成

```bash
cd ~/river-map-app/backend
tar -czf ~/river-map-backup-$(date +%Y%m%d-%H%M).tar.gz database.sqlite media/uploads media/*/thumbnails results.csv
```

確認:

```bash
ls -lh ~/river-map-backup-*.tar.gz
```

`media/*/thumbnails` が存在しない場合はエラーになります。その場合は存在するパスだけ指定します。

例:

```bash
tar -czf ~/river-map-backup-$(date +%Y%m%d-%H%M).tar.gz database.sqlite media/uploads results.csv
```

### 16.3 Windowsへコピー

WindowsのコマンドプロンプトまたはPowerShellで実行:

```powershell
scp ito@133.167.89.113:~/river-map-backup-YYYYMMDD-HHMM.tar.gz C:\tmp\
```

ユーザー名が日本語の場合、Downloadsなどでパス問題が起きることがあるため、`C:\tmp` のような英数字だけのフォルダを使うと安全です。

### 16.4 復元方針

復元前に現在のデータを退避します。

```bash
cd ~/river-map-app/backend
cp database.sqlite database.sqlite.before-restore
cp -r media media.before-restore
```

バックアップを展開:

```bash
tar -xzf ~/river-map-backup-YYYYMMDD-HHMM.tar.gz
pm2 restart river-map-backend
```

## 17. 性能・負荷確認

### 17.1 確認済み

VPS内部で以下の簡易テストを実施済みです。

```bash
ab -n 500 -c 50 http://127.0.0.1:8000/api/surveys
```

結果概要:

```text
Concurrency Level: 50
Complete requests: 500
Failed requests: 0
Requests per second: 約79.94 req/sec
```

`GET /api/surveys` については、50同時接続で失敗しないことを確認済みです。

また、30台程度でのアクセス確認、5台程度での同時投稿確認を行っています。

### 17.2 注意点

以下は追加確認が必要です。

- 30台以上で同時に画像アップロードした場合
- iPad実機での長時間利用
- さくらVPSの帯域制限下で画像読み込みが遅くならないか
- 大きな画像を連続投稿した場合

地図画像は軽量化済みですが、画像投稿が増えると `media/uploads` が大きくなります。授業前後でバックアップと不要投稿の整理が必要です。

## 18. セキュリティ・いたずら対策

### 18.1 現在の対策

- HTTPS化
- QRコード内のアクセスコード
- API側でアクセスコード確認
- メディア配信にもアクセスコード確認
- 管理画面は管理用コードで保護
- 管理画面で非表示・削除が可能
- 名前入力を廃止し、個人情報入力を避ける
- 画像アップロード先を `backend/media/uploads` に限定

### 18.2 注意点

アクセスコード方式は、強固な個別ログインではありません。QRコードが外部に流出した場合、そのURLを知った人もアクセスできます。

より強い制限が必要になった場合は、以下を検討します。

- 班ごとに異なるアクセスコード
- 期間限定コード
- 投稿だけ別コードにする
- 教員端末だけ管理画面へ入れるIP制限
- 投稿承認制
- 投稿日時・端末識別情報の記録

### 18.3 秘密情報として扱うもの

以下はGitHubや通常の資料に書きません。

- SSH秘密鍵
- VPS初期パスワード
- さくら会員ID・会員メニューパスワード
- GitHubアクセストークン
- 実際のアクセスコード
- 実際の管理用コード

## 19. 障害時の確認手順

### 19.1 アプリが開かない

VPSで確認:

```bash
pm2 status
sudo systemctl status nginx
curl -I http://127.0.0.1:8000/api/surveys
curl -I http://127.0.0.1/
```

外部から確認:

```bash
curl -I https://os3-374-20359.vs.sakura.ne.jp/
```

### 19.2 APIが401になる

アクセスコードまたは管理用コードが間違っている可能性があります。

確認:

- QRコードのURLが正しいか
- VPS側の `ACCESS_CODE` が正しいか
- PM2再起動時に `--update-env` を付けたか

### 19.3 画像が出ない

確認:

- `backend/media/uploads/` に投稿画像があるか
- `backend/media/<processing_id>/thumbnails/` にサムネイルがあるか
- CSVの `detection_thumbnail_path_relative` と実ファイルの場所が一致しているか
- `/media/...` へのアクセスにアクセスコードが付いているか

### 19.4 地図が古い

ブラウザキャッシュの可能性があります。

対応:

- PC: `Ctrl + F5`
- iPad: ページ再読み込み
- Safari: Webサイトデータ削除

### 19.5 投稿できない

確認:

- バックエンドが起動しているか
- `ACCESS_CODE` が合っているか
- 画像サイズが大きすぎないか
- Nginxの `client_max_body_size` が十分か
- `backend/media/uploads/` に書き込み権限があるか

## 20. 授業当日の運用案

### 20.1 授業前

1. VPSへログイン
2. `pm2 status` でバックエンド確認
3. `sudo systemctl status nginx` でNginx確認
4. QRコードURLでiPadからアクセス確認
5. テスト投稿
6. 管理画面でテスト投稿を非表示または削除
7. バックアップ作成

### 20.2 授業中

- 児童にはQRコードを配布
- 基本はiPad横向き利用を案内
- 投稿が不適切な場合は先生用管理画面で非表示
- 通信が重い場合は、再読み込みを連打しないよう案内

### 20.3 授業後

1. 投稿データを確認
2. 不要投稿を非表示または削除
3. バックアップを作成
4. Windows側へバックアップをコピー
5. 必要に応じてCSVや画像を分析用に保管

## 21. システムが動かなかった場合のアナログ代替案

授業当日にネットワークやVPS障害でアプリが使えない場合に備え、以下を準備します。

### 21.1 紙地図方式

- 岩倉川周辺の地図を印刷する
- 班ごとに色ペンを用意する
- 見つけた場所に番号シールを貼る
- 別紙に番号、生き物名、コメント、絵を記入する

### 21.2 写真記録方式

- iPadまたはカメラで発見場所と絵を撮影する
- 写真ファイル名またはメモで班名と番号を管理する
- 授業後に先生または管理者がアプリへ代理入力する

### 21.3 ホワイトボード集約方式

- 班ごとに発見内容を付箋へ記入
- 大きな地図やホワイトボードに貼る
- 最後に全体で共有する

アプリ停止時でも、紙地図、番号シール、記録用紙があれば授業目的は維持できます。

## 22. 今後の改善候補

優先度が高いもの:

- 投稿日時の保存
- 班別・授業日別の投稿管理
- 投稿の一括エクスポート
- 画像アップロード時の自動圧縮
- 管理画面で投稿詳細をより見やすくする
- 児童向け文言のさらなる調整

必要に応じて検討するもの:

- PostgreSQLへの移行
- Nginxによる `/media/` 直接配信
- 班ごとの個別アクセスコード
- 投稿承認制
- 動画再生機能
- 独自ドメイン取得

## 23. 現在の重要なファイル一覧

```text
frontend/main.js                         アプリ本体
frontend/wizard.js                       投稿ウィザード
frontend/style.css                       アプリ画面のCSS
frontend/admin.html                      管理画面HTML
frontend/admin.js                        管理画面JS
frontend/admin.css                       管理画面CSS
frontend/public/river_map5.jpg           現在の地図画像
frontend/public/species-icons/           生き物アイコン
backend/server.js                        APIサーバ
backend/init_db.js                       CSV取り込み・DB初期化
backend/results.csv                      AI検出結果・軌跡CSV
backend/database.sqlite                  SQLiteデータベース
backend/media/uploads/                   児童投稿画像
backend/media/<processing_id>/thumbnails/ 検出サムネイル
```

## 24. 最終確認チェックリスト

公開前:

- QRコードURLでiPadから入れる
- 通常URLではアクセス制限画面になる
- 地図位置がずれていない
- 地図読み込みが遅すぎない
- Davis / Hardy / Learned の表示が正しい
- 全班表示とクラス絞り込みが正しい
- 検出ポイント投稿ができる
- 自由投稿ができる
- 投稿後にアイコンが変わる
- 画像拡大表示ができる
- チュートリアルが表示される
- 管理画面で非表示にできる
- 管理画面で削除できる
- バックアップを取得できる
- PM2がonline
- Nginxがactive
- HTTPS証明書が有効

## 25. 現在の状態まとめ

2026-06-12時点で、アプリは以下の状態です。

- さくらVPS上でHTTPS公開する構成
- Nginxが静的ファイル配信とAPI中継を担当
- バックエンドはExpress + SQLite
- フロントエンドはVite + Leaflet
- 児童向けはQRコードのアクセスコード方式
- 先生向け管理画面あり
- 投稿の非表示・削除が可能
- 検出ポイント投稿と自由投稿に対応
- 投稿画像と考えた図に対応
- 生き物アイコン表示に対応
- 全班表示とクラス絞り込みに対応
- 地図画像は軽量化JPEGを使用
- 50同時接続の簡易APIテストは成功済み
