

1. フロントエンドの構成と現状（バックエンドへの共有事項）
フロントエンドは、以下の技術スタックで既にUIと画面遷移が完成しています。

環境: Node.js, Vite

言語/スタイル: HTML, Vanilla JavaScript, CSS

地図ライブラリ: Leaflet (leaflet.heat プラグイン使用)

オフライン対応: 国土地理院の衛星写真タイル画像（ズーム15〜18）を事前にダウンロードし、アプリ内のローカルディレクトリ（public/tiles/）から読み込む完全オフライン仕様。外部CDNへの依存は排除済み。

現在、フロントエンドはバックエンドAPIの完成を待つため、data.js というファイルに記述した**ダミーデータ（JSON）**を読み込んで動作しています。バックエンド開発者は、このダミーデータと全く同じ構造のJSONを返すAPIエンドポイントを構築することが主なミッションとなります。

2. データベース設計案（テーブル/コレクション構造）
バックエンド（RDB等を想定）で管理すべきデータの構造です。

① groups (班・調査グループ)
id (String / UUID): グループの一意なID（例: "group1"）

name (String): 表示名（例: "1班"）

gps_track (JSON): GPSの移動軌跡の配列 [[lat, lng], [lat, lng], ...]

② detections (AIによる生物検出ポイント)
id (String / UUID): 検出ポイントの一意なID

group_id (Foreign Key): どの班のデータか

class_name (String): 検出された生物名（例: "サワガニ", "コオニヤンマ"）

latitude (Float): 緯度

longitude (Float): 経度

timestamp_sec (Float): 動画内の検出時間（秒）

ground_image_url (String): 地上画像（サムネイル）のサーバー保存パス

underwater_image_url (String): 水中画像のサーバー保存パス（※紐付け方法は運用でカバーするか要検討）

③ user_posts (児童による追加投稿)
id (String / UUID): 投稿の一意なID

detection_id (Foreign Key): どの検出ポイントに対する投稿か

nickname (String): 児童のニックネーム

creature (String): 児童が選択した生物名

comment (Text): 自由記述コメント

image_url (String): 児童がアップロードした画像のサーバー保存パス

created_at (Timestamp): 投稿日時

3. API仕様書（フロントエンドとの通信インターフェース）
フロントエンドからバックエンドに対して呼び出すAPIは、主に以下の2つです。

API 1: 全データの取得（初期描画・リロード用）
エンドポイント: GET /api/surveys (または /api/groups)

目的: 地図の描画、班の切り替え、ヒートマップの生成に必要な全てのデータを一括で取得する。

レスポンス仕様:
フロントエンドの data.js と完全に互換性のある、以下のJSON構造を返却してください。（キー名が班のIDになります）