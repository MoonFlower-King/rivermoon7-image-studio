# Deployment Notes

This repository is designed for a deployment where:

1. The React frontend is served by Nginx or another static file server.
2. `/v1/images/generations`, `/v1/images/edits`, and `/v1/models` are routed to
   `image-relay`.
3. The relay forwards requests to a NewAPI-compatible upstream.
4. The user's NewAPI key is passed through in the `Authorization` header.

## Frontend Deployment

```bash
cd web
npm install
npm run build
```

Serve `web/dist` as the site root.

## Relay Deployment

```bash
cd image-relay
cp .env.example .env
docker compose up -d --build
```

Health check:

```bash
curl http://127.0.0.1:8320/healthz
```

## Nginx Sketch

```nginx
location /v1/images/ {
    proxy_pass http://127.0.0.1:8320;
    proxy_read_timeout 1200s;
    proxy_send_timeout 1200s;
}

location /v1/models {
    proxy_pass http://127.0.0.1:8320;
}

location / {
    root /path/to/web/dist;
    try_files $uri $uri/ /index.html;
}
```

## Security Checklist

- Do not commit `.env`.
- Do not commit NewAPI tokens, CPA keys, management keys, cookies, or SSH keys.
- Keep user billing in passthrough mode unless you explicitly want server-key
  billing.
- Review logs before sharing them publicly.
