# Rivermoon7 Image Studio

Rivermoon7 Image Studio is a self-hosted image generation workspace based on
ChatGPT Image Studio, with a lightweight image relay for OpenAI-compatible image
endpoints.

This repository contains the source that corresponds to the Rivermoon7 image
site release `20260515-0239-image2-4k-display-fix`.

## Features

- Text-to-image and image edit workflows.
- Multi-image fan-out generation with independent result cards.
- Output format selection: JPEG, PNG, and WebP.
- Automatic 4K routing:
  - Standard sizes use `image2.0`.
  - `3840x2160`, `2160x3840`, and larger pixel counts use `image2.0-4k`.
- NewAPI user-key passthrough, so usage is billed to the user's NewAPI wallet.
- Async image relay with polling support for long-running image jobs.

## Project Structure

```text
.
├── web/                 # Vite + React image workspace
├── image-relay/         # Python relay for /v1/images/* and /v1/models
├── docs/                # Deployment notes
└── LICENSE
```

## Quick Start

### Frontend

```bash
cd web
npm install
npm run dev
```

Build:

```bash
cd web
npm run build
```

### Image Relay

```bash
cd image-relay
cp .env.example .env
docker compose up -d --build
```

The relay listens on `127.0.0.1:8320` by default.

## Configuration

Copy `image-relay/.env.example` to `image-relay/.env` and adjust the values for
your deployment.

Do not commit `.env`, API keys, NewAPI tokens, cookies, or server credentials.

## Model Naming

The public model names are:

- `image2.0`
- `image2.0-4k`

Both can be mapped by your upstream NewAPI channel to an internal upstream model
such as `gpt-image-2`.

## Credits

This project is based on
[peiyizhi0724/ChatGpt-Image-Studio](https://github.com/peiyizhi0724/ChatGpt-Image-Studio)
and includes Rivermoon7-specific workflow and relay changes.

## License

See [LICENSE](LICENSE).
