# YouTube Cookie Sync

A browser extension (Chrome + Firefox) that syncs your YouTube session cookies to a self-hosted HTTP service, which writes them to a file. Useful for tools like yt-dlp that need authenticated cookies to access age-restricted or member-only content.

Cookies are encrypted with AES-256-GCM using a pre-shared key before being sent, so the service endpoint can be exposed over a network without transmitting plaintext credentials.

## How it works

1. The extension reads YouTube cookies from your browser
2. Encrypts them with a PSK (AES-256-GCM, PBKDF2 key derivation)
3. POSTs the encrypted payload to your configured endpoint
4. The service decrypts and writes a Netscape-format cookie file

Sync happens automatically whenever cookies change (throttled to once per 10s), or manually on demand.

## Extension

### Install

- Firefox: [Firefox Add-ons](#) *(link once published)*
- Chrome: [Chrome Web Store](#) *(link once published)*

### Setup

1. Install the extension
2. Open the popup and enter your service endpoint URL (e.g. `http://localhost:8080`)
3. Copy the auto-generated PSK — you'll need it for the service
4. Click **Save**, then **Sync Now** to verify

Enable **Continuous Sync** to automatically re-sync whenever YouTube cookies change.

### Dev setup

Deactivate the installed extension first, then load it unpacked:

**Firefox**
```
about:debugging#/runtime/this-firefox → Load Temporary Add-on → select extension/manifest.json
```

**Chrome**
```
chrome://extensions → Developer mode → Load unpacked → select the extension/ folder
```

Symlink the correct manifest before loading:
```bash
cd extension
ln -s manifest-firefox.json manifest.json   # Firefox
ln -s manifest-chrome.json manifest.json    # Chrome
```

**Lint and test:**
```bash
cd extension
npm install
npm run lint
npm test
```

## Service

A small Go HTTP server that decrypts the incoming payload and writes the cookie file.

### Run with Docker

```bash
docker run -d \
  -e PSK=your-psk-here \
  -e COOKIE_FILE=/data/cookies.txt \
  -p 8080:8080 \
  -v /path/to/data:/data \
  ghcr.io/<owner>/youtube-cookie-sync:latest
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PSK` | — | **Required.** Must match the PSK set in the extension |
| `COOKIE_FILE` | `./cookies.txt` | Path where the cookie file is written |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8080` | Bind port |

### Build from source

```bash
cd service
go build -o cookie-sync .
PSK=your-psk COOKIE_FILE=/tmp/cookies.txt ./cookie-sync
```

### Run tests

```bash
cd service
go test -v ./...
```

## Encryption

- Key derivation: PBKDF2-HMAC-SHA256, 100,000 iterations, fixed salt `youtube-cookie-sync-v1`
- Encryption: AES-256-GCM with a random 12-byte IV per message
- Wire format: `POST /cookie` with JSON body `{ "iv": "<base64>", "data": "<base64 ciphertext+tag>" }`