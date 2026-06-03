# さくらVPS公開メモ

このアプリは、フロントエンドを静的ファイルとして配信し、バックエンドをNode.jsで常時起動する構成を想定しています。

## 構成

- Nginx: 外部からの `https://ドメイン/` を受ける
- フロントエンド: `frontend/dist` をNginxで配信する
- バックエンド: `backend/server.js` を `127.0.0.1:8000` で起動する
- API: Nginxで `/api/` を `http://127.0.0.1:8000/api/` に中継する
- メディア: Nginxで `/media/` を `http://127.0.0.1:8000/media/` に中継する

## 初回セットアップ例

```bash
cd /var/www/river-map-app/frontend
npm ci
npm run build

cd /var/www/river-map-app/backend
npm ci
npm run start
```

本番では `npm run start` を直接起動し続けるのではなく、`pm2` などで常時起動します。

```bash
cd /var/www/river-map-app/backend
pm2 start npm --name river-map-backend -- run start
pm2 save
```

## Nginx設定例

`server_name` と `root` は実際のドメイン名・設置場所に合わせて変更してください。

```nginx
server {
    listen 80;
    server_name example.com;

    root /var/www/river-map-app/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /media/ {
        proxy_pass http://127.0.0.1:8000/media/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

HTTPS化後は、Let's Encrypt / Certbotで証明書を設定し、HTTPからHTTPSへリダイレクトしてください。

## バックアップ対象

以下は投稿データなので、VPSのバックアップ対象に含めてください。

- `backend/database.sqlite`
- `backend/media/uploads/`
- 必要に応じて `backend/results.csv`

## ローカル開発

ローカルではバックエンドを `8000` で起動してから、フロントエンドをViteで起動します。

```bash
cd backend
npm run start

cd ../frontend
npm run dev
```

Viteの開発サーバーは `/api` と `/uploads` を自動でバックエンドへ中継します。
