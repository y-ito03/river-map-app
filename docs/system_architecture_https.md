# VPS公開時のシステム構成とHTTPS証明書方針

## 想定構成

このアプリは、VPS上で以下の構成にする想定です。

```text
iPad / PC
  |
  | HTTPS :443
  v
Nginx
  |-- frontend/dist を静的配信
  |-- /api/     -> Node.js Express backend :8000
  |-- /media/   -> Node.js Express backend :8000
  v
Node.js / Express
  |-- SQLite database.sqlite
  |-- media/uploads/
```

役割は以下です。

- Nginx: 外部公開の入口、HTTPS終端、静的ファイル配信、APIへの中継
- frontend: Viteでビルドした `frontend/dist`
- backend: Express API、投稿保存、画像アップロード
- SQLite: 小規模運用向けのDB
- `backend/media/`: AIサムネイル画像と投稿画像の保存先

## 50同時接続への対応方針

入口はNginxで受けます。Nginxは静的ファイル配信と同時接続処理に強いため、iPad等からの同時アクセスはNginxで受け、APIだけをNode.jsへ流します。

想定する確認項目:

- 50同時接続でトップページ、JS/CSS、画像が返ること
- 50同時接続で `GET /api/surveys` が落ちないこと
- 投稿APIは同時連打よりも通常利用を想定し、まずは少数同時投稿で確認すること
- 試用期間中のOutgoing 10Mbps制限で静的ファイルや画像配信が遅くなるか確認すること

負荷試験は、まず `wrk`、`ab`、`k6` などで以下を確認します。

```bash
# 例: 50接続で30秒間APIを確認
wrk -t4 -c50 -d30s https://example.com/api/surveys
```

## HTTPS証明書方針

基本方針は、無料のLet's Encrypt証明書を使います。

理由:

- 無料で利用できる
- iPad / Safari / Chrome など一般的なブラウザで信頼される公開CAの証明書である
- CertbotでNginxへの設定と自動更新ができる
- 研究・授業用途のWebアプリなら、有料証明書を買う必要性は低い

証明書を取るには、アクセスに使う名前が必要です。

推奨:

```text
https://独自ドメイン/
```

独自ドメインが未準備の場合の暫定案:

```text
https://os3-374-20359.vs.sakura.ne.jp/
```

ただし、長期運用では独自ドメインの方が説明しやすく、証明書・URL・利用者案内も安定します。

IPアドレス直打ちのURLは避けます。

```text
https://133.167.89.113/
```

IPアドレス用証明書も技術的には選択肢になりつつありますが、通常のWeb公開ではドメイン名で証明書を取得する構成の方が無難です。

## 証明書取得の作業イメージ

Ubuntu + Nginx + Certbotの例です。

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

Nginxで対象ドメインのHTTPアクセスが通る状態にしてから、以下を実行します。

```bash
sudo certbot --nginx -d example.com
```

さくらVPSのホスト名を暫定利用する場合は以下です。

```bash
sudo certbot --nginx -d os3-374-20359.vs.sakura.ne.jp
```

自動更新確認:

```bash
sudo certbot renew --dry-run
```

## 教授への回答案

```text
予定している構成は、VPS上でNginxを入口にし、NginxでHTTPS終端・静的ファイル配信・API中継を行う構成です。

iPad/PC -> HTTPS(443) -> Nginx
Nginx -> frontend/dist
Nginx /api -> Node.js Express backend:8000
Nginx /uploads -> Node.js Express backend:8000
backend -> SQLite database.sqlite / media/uploads

50同時接続程度は、入口をNginxにして静的ファイルをNginxから返し、APIだけNode.jsへ流す構成で確認します。wrk/k6等で / と /api/surveys に対して50接続程度の負荷試験を行い、試用期間中のOutgoing 10Mbps制限で静的ファイルや画像配信が遅くならないかも確認します。

HTTPS証明書は、基本的には無料のLet's Encryptを使う方針がよいと考えています。iPadから信頼されない自己署名証明書は使わず、CertbotでNginxに証明書を設定し、自動更新も設定します。

独自ドメインが用意できるならそれを使うのが最も安定です。独自ドメインがまだない場合は、暫定的に os3-374-20359.vs.sakura.ne.jp に対してLet's Encrypt証明書を取る構成を検討します。IPアドレス直打ちは証明書・利用者案内の面で避けたいです。

有料証明書は、大学・研究室の運用ルールで指定がある場合のみ検討でよく、今回の用途ではLet's Encryptで十分だと思います。
```
