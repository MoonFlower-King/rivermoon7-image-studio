import json
import hashlib
import os
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import error, parse, request


UPSTREAM_BASE_URL = os.environ.get(
    "UPSTREAM_BASE_URL", "http://new-api:3000/v1"
).rstrip("/")
NEWAPI_API_BASE_URL = os.environ.get(
    "NEWAPI_API_BASE_URL",
    UPSTREAM_BASE_URL[:-3] if UPSTREAM_BASE_URL.endswith("/v1") else UPSTREAM_BASE_URL,
).rstrip("/")
EXTERNAL_MODEL = os.environ.get("EXTERNAL_MODEL", "image2.0")
EXTERNAL_4K_MODEL = os.environ.get("EXTERNAL_4K_MODEL", "image2.0-4k")
SUPPORTED_EXTERNAL_MODELS = {EXTERNAL_MODEL, EXTERNAL_4K_MODEL}
INTERNAL_MODEL = os.environ.get("INTERNAL_MODEL", "gpt-image-2")
TOKEN_NAME = os.environ.get("TOKEN_NAME", "image2.0 操练场")
PORT = int(os.environ.get("PORT", "8320"))
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(20 * 1024 * 1024)))
REQUEST_TIMEOUT_SECONDS = int(os.environ.get("REQUEST_TIMEOUT_SECONDS", "600"))
TOKEN_CACHE_TTL_SECONDS = int(os.environ.get("TOKEN_CACHE_TTL_SECONDS", "1800"))
IMAGE_RETRY_ATTEMPTS = int(os.environ.get("IMAGE_RETRY_ATTEMPTS", "2"))
IMAGE_JOB_TTL_SECONDS = int(os.environ.get("IMAGE_JOB_TTL_SECONDS", "1800"))
ALLOWED_SIZES = {
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "2048x1152",
    "3840x2160",
    "2160x3840",
    "auto",
}
ALLOWED_QUALITIES = {"low", "medium", "high", "auto"}
ALLOWED_OUTPUT_FORMATS = {"jpeg", "png", "webp"}
TOOL_CHOICE_RETRY_TEXT = "Tool choice 'image_generation' not found in 'tools' parameter"
TRANSIENT_IMAGE_RETRY_TEXTS = (
    "stream error",
    "stream disconnected",
    "disconnected before completion",
    "internal_error",
    "received from peer",
    "upstream_unavailable",
    "image upstream is unavailable",
    "connection reset",
    "connection aborted",
    "connection closed",
    "timeout",
)
TRANSIENT_IMAGE_RETRY_STATUSES = {408, 429, 500, 502, 503, 504}
NEWAPI_IMAGE_PAGE = os.path.join(
    os.path.dirname(__file__), "newapi-image-playground.html"
)
NEWAPI_IMAGE_ENTRY = os.path.join(os.path.dirname(__file__), "newapi-image-entry.js")
CONSOLE_TOKEN_CACHE = {}
IMAGE_JOBS = {}
IMAGE_JOBS_LOCK = threading.Lock()
IMAGE_RETRY_BACKOFF_SECONDS = (2.0, 5.0, 10.0, 20.0)


def require_config():
    if not UPSTREAM_BASE_URL:
        raise RuntimeError("Missing required environment variable: UPSTREAM_BASE_URL")


class ImageRelayHandler(BaseHTTPRequestHandler):
    server_version = "RivermoonImageRelay/1.0"

    def log_message(self, fmt, *args):
        # BaseHTTPRequestHandler logs only method/path/status here; never log headers or body.
        print(
            f'{self.address_string()} - - [{self.log_date_time_string()}] {fmt % args}',
            flush=True,
        )

    def do_GET(self):
        parsed_path = parse.urlsplit(self.path)
        path = parsed_path.path
        query = parse.parse_qs(parsed_path.query)
        if path in ("/v1/images/generations", "/v1/images/edits") and query.get(
            "job_id"
        ):
            self.handle_image_job_status(query["job_id"][0])
            return

        if path in (
            "/console/image-generation",
            "/console/image-generation/",
            "/console/playground/image-generation",
            "/console/playground/image-generation/",
        ):
            with open(NEWAPI_IMAGE_PAGE, "r", encoding="utf-8") as page:
                self.send_html(200, page.read())
            return

        if path == "/rivermoon-image-entry.js":
            with open(NEWAPI_IMAGE_ENTRY, "rb") as script:
                self.send_bytes(
                    200,
                    script.read(),
                    "application/javascript; charset=utf-8",
                )
            return

        if path in ("", "/"):
            self.send_html(
                200,
                """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rivermoon NewAPI 生图</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        linear-gradient(180deg, rgba(247, 248, 251, 0.96), rgba(239, 243, 247, 0.98)),
        #f7f8fb;
      color: #172026;
    }
    .shell {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 36px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      font-size: clamp(24px, 3vw, 36px);
      line-height: 1.15;
      letter-spacing: 0;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 7px 11px;
      border: 1px solid #cfd7df;
      border-radius: 8px;
      background: #fff;
      color: #4b5663;
      font-size: 14px;
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #1f9d6b;
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    section {
      border: 1px solid #dde4ea;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 16px 36px rgba(26, 38, 52, 0.07);
    }
    .controls {
      padding: 18px;
    }
    .field {
      display: grid;
      gap: 7px;
      margin-bottom: 14px;
    }
    label {
      font-size: 13px;
      font-weight: 650;
      color: #29333d;
    }
    textarea,
    input,
    select {
      width: 100%;
      border: 1px solid #cfd8e2;
      border-radius: 8px;
      background: #fbfcfd;
      color: #172026;
      font: inherit;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    }
    textarea:focus,
    input:focus,
    select:focus {
      border-color: #227c8d;
      background: #fff;
      box-shadow: 0 0 0 3px rgba(34, 124, 141, 0.14);
    }
    textarea {
      min-height: 190px;
      padding: 12px;
      resize: vertical;
      line-height: 1.5;
    }
    input,
    select {
      height: 42px;
      padding: 0 11px;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-top: 16px;
    }
    button,
    a.download {
      height: 42px;
      border: 0;
      border-radius: 8px;
      padding: 0 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.12s ease, opacity 0.12s ease, background 0.12s ease;
    }
    [hidden] {
      display: none !important;
    }
    button:active,
    a.download:active {
      transform: translateY(1px);
    }
    .primary {
      flex: 1;
      background: #16222a;
      color: #fff;
    }
    .primary:disabled {
      cursor: wait;
      opacity: 0.68;
    }
    .secondary,
    a.download {
      border: 1px solid #cfd8e2;
      background: #f6f8fa;
      color: #202a33;
    }
    .result {
      min-height: 640px;
      overflow: hidden;
    }
    .result-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 58px;
      padding: 0 16px;
      border-bottom: 1px solid #e2e8ee;
    }
    .result-title {
      font-weight: 750;
      color: #202a33;
    }
    .result-meta {
      color: #66717d;
      font-size: 13px;
    }
    .stage {
      min-height: 580px;
      display: grid;
      place-items: center;
      padding: 18px;
      background:
        linear-gradient(45deg, #f5f7f9 25%, transparent 25%),
        linear-gradient(-45deg, #f5f7f9 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #f5f7f9 75%),
        linear-gradient(-45deg, transparent 75%, #f5f7f9 75%);
      background-size: 28px 28px;
      background-position: 0 0, 0 14px, 14px -14px, -14px 0;
    }
    .empty {
      width: min(420px, 100%);
      text-align: center;
      color: #596572;
      line-height: 1.6;
    }
    .preview {
      max-width: 100%;
      max-height: 72vh;
      border-radius: 8px;
      box-shadow: 0 18px 46px rgba(20, 29, 38, 0.18);
      background: #fff;
    }
    .message {
      margin-top: 12px;
      min-height: 22px;
      color: #596572;
      font-size: 14px;
      line-height: 1.55;
    }
    .message.error {
      color: #b42318;
    }
    .message.ok {
      color: #167455;
    }
    .spinner {
      width: 34px;
      height: 34px;
      border: 4px solid #cfd8e2;
      border-top-color: #227c8d;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    kbd {
      padding: 2px 6px;
      border-radius: 6px;
      background: #f1f3f7;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 12px;
    }
    @media (max-width: 860px) {
      .workspace {
        grid-template-columns: 1fr;
      }
      header {
        align-items: flex-start;
        flex-direction: column;
      }
      .result {
        min-height: 480px;
      }
      .stage {
        min-height: 420px;
      }
    }
    @media (max-width: 520px) {
      .shell {
        width: min(100vw - 20px, 1180px);
        padding-top: 18px;
      }
      .row {
        grid-template-columns: 1fr;
      }
      .actions {
        flex-direction: column;
      }
      button,
      a.download {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>Rivermoon 生图</h1>
      <div class="status"><span class="dot"></span><span>NewAPI 用户额度</span></div>
    </header>
    <div class="workspace">
      <section class="controls">
        <form id="generateForm">
          <div class="field">
            <label for="prompt">提示词</label>
            <textarea id="prompt" name="prompt" autocomplete="off" required placeholder="写下你想生成的画面"></textarea>
          </div>
          <div class="row">
            <div class="field">
              <label for="size">尺寸</label>
              <select id="size" name="size">
                <option value="1024x1024">1024 x 1024</option>
                <option value="1024x1536">1024 x 1536</option>
                <option value="1536x1024">1536 x 1024</option>
                <option value="auto">auto</option>
              </select>
            </div>
            <div class="field">
              <label for="model">模型</label>
              <input id="model" name="model" value="image2.0" readonly>
            </div>
          </div>
          <div class="field">
            <label for="apiKey">NewAPI 密钥</label>
            <input id="apiKey" name="apiKey" type="password" autocomplete="off" placeholder="sk-...">
          </div>
          <div class="actions">
            <button class="primary" id="generateButton" type="submit">生成图片</button>
            <button class="secondary" id="clearButton" type="button">清空</button>
          </div>
          <div class="message" id="message"></div>
        </form>
      </section>
      <section class="result">
        <div class="result-head">
          <div>
            <div class="result-title">结果</div>
            <div class="result-meta" id="resultMeta">等待生成</div>
          </div>
          <a class="download" id="downloadLink" href="#" download="rivermoon-image.png" hidden>下载</a>
        </div>
        <div class="stage" id="stage">
          <div class="empty" id="emptyState">
            <p>输入提示词后生成图片。</p>
            <p>使用你的 NewAPI 密钥，额度和记录走 NewAPI。</p>
          </div>
        </div>
      </section>
    </div>
  </div>
  <script>
    const form = document.getElementById("generateForm");
    const promptInput = document.getElementById("prompt");
    const sizeInput = document.getElementById("size");
    const apiKeyInput = document.getElementById("apiKey");
    const button = document.getElementById("generateButton");
    const clearButton = document.getElementById("clearButton");
    const message = document.getElementById("message");
    const stage = document.getElementById("stage");
    const resultMeta = document.getElementById("resultMeta");
    const downloadLink = document.getElementById("downloadLink");
    const keyName = "rivermoon_newapi_user_key";

    apiKeyInput.value = localStorage.getItem(keyName) || "";

    function setMessage(text, kind = "") {
      message.textContent = text;
      message.className = "message" + (kind ? " " + kind : "");
    }

    function setBusy(busy) {
      button.disabled = busy;
      button.textContent = busy ? "生成中..." : "生成图片";
    }

    function showLoading() {
      downloadLink.hidden = true;
      resultMeta.textContent = "生成中";
      stage.innerHTML = '<div class="empty"><div class="spinner"></div><p>正在生成图片...</p></div>';
    }

    function showImage(src) {
      const img = document.createElement("img");
      img.className = "preview";
      img.alt = "生成结果";
      img.src = src;
      stage.replaceChildren(img);
      downloadLink.href = src;
      downloadLink.hidden = false;
      resultMeta.textContent = new Date().toLocaleString();
    }

    function extractImage(data) {
      const item = data && data.data && data.data[0];
      if (!item) return "";
      if (item.b64_json) return "data:image/png;base64," + item.b64_json;
      if (item.url) return item.url;
      return "";
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const prompt = promptInput.value.trim();
      const apiKey = apiKeyInput.value.trim();
      if (!prompt) {
        setMessage("请先输入提示词。", "error");
        promptInput.focus();
        return;
      }
      if (!apiKey) {
        setMessage("请填写你的 NewAPI 密钥。", "error");
        apiKeyInput.focus();
        return;
      }

      localStorage.setItem(keyName, apiKey);
      setBusy(true);
      showLoading();
      setMessage("");

      try {
        const body = {
          model: "image2.0",
          prompt,
          size: sizeInput.value
        };
        const response = await fetch("/v1/images/generations", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        const text = await response.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          throw new Error("服务返回了无法解析的内容。");
        }
        if (!response.ok) {
          const detail = data.error && data.error.message ? data.error.message : "生成失败。";
          throw new Error(detail);
        }
        const image = extractImage(data);
        if (!image) {
          throw new Error("生成完成，但响应里没有图片。");
        }
        showImage(image);
        setMessage("生成完成。", "ok");
      } catch (err) {
        resultMeta.textContent = "生成失败";
        stage.innerHTML = '<div class="empty"><p>没有生成图片。</p></div>';
        setMessage(err.message || "生成失败。", "error");
      } finally {
        setBusy(false);
      }
    });

    clearButton.addEventListener("click", () => {
      promptInput.value = "";
      setMessage("");
      resultMeta.textContent = "等待生成";
      downloadLink.hidden = true;
      stage.innerHTML = '<div class="empty"><p>输入提示词后生成图片。</p><p>使用你的 NewAPI 密钥，额度和记录走 NewAPI。</p></div>';
      promptInput.focus();
    });
  </script>
</body>
</html>""",
            )
            return

        if path == "/favicon.ico":
            self.send_bytes(204, b"", "image/x-icon")
            return

        if path == "/healthz":
            self.send_json(200, {"ok": True, "ts": int(time.time())})
            return

        if path == "/v1/models":
            bearer_token = self.bearer_token()
            if not bearer_token:
                self.send_unauthorized()
                return
            self.send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": model_id,
                            "object": "model",
                            "created": 0,
                            "owned_by": "rivermoon",
                        }
                        for model_id in sorted(SUPPORTED_EXTERNAL_MODELS)
                    ],
                },
            )
            return

        self.send_json(
            404,
            {
                "error": {
                    "message": "Not found",
                    "type": "invalid_request_error",
                    "code": "not_found",
                }
            },
        )

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/rivermoon-image-generate":
            self.handle_console_image_generation()
            return

        if path == "/v1/images/edits":
            self.handle_image_edit_proxy()
            return

        if path != "/v1/images/generations":
            self.send_json(
                404,
                {
                    "error": {
                        "message": "Not found",
                        "type": "invalid_request_error",
                        "code": "not_found",
                    }
                },
            )
            return

        bearer_token = self.bearer_token()
        if not bearer_token:
            self.send_unauthorized()
            return

        payload = self.read_json_body()
        if payload is None:
            return

        requested_model = payload.get("model") or EXTERNAL_MODEL
        if requested_model not in SUPPORTED_EXTERNAL_MODELS:
            self.send_json(
                400,
                {
                    "error": {
                        "message": f"Only models {', '.join(sorted(SUPPORTED_EXTERNAL_MODELS))} are supported by this relay.",
                        "type": "invalid_request_error",
                        "param": "model",
                        "code": "unsupported_model",
                    }
                },
            )
            return

        payload["model"] = requested_model
        if not self.normalize_image_payload(payload):
            return
        if self.is_async_image_request():
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.start_image_job(
                "/images/generations",
                body,
                bearer_token,
                "application/json",
            )
            return
        self.forward_image_generation(payload, bearer_token)

    def handle_image_edit_proxy(self):
        bearer_token = self.bearer_token()
        if not bearer_token:
            self.send_unauthorized()
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type.lower():
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Image edits must use multipart/form-data.",
                        "type": "invalid_request_error",
                        "code": "invalid_content_type",
                    }
                },
            )
            return

        body = self.read_raw_body()
        if body is None:
            return
        body = self.normalize_multipart_image_model(body)
        if self.is_async_image_request():
            self.start_image_job(
                "/images/edits",
                body,
                bearer_token,
                content_type,
            )
            return
        self.forward_raw_image_request(
            "/images/edits",
            body,
            bearer_token,
            content_type,
        )

    def handle_console_image_generation(self):
        token_ms = 0
        upstream_ms = 0
        token_cache_hit = False
        status = 500
        payload = self.read_json_body()
        if payload is None:
            return

        size = payload.get("size") or "1024x1024"
        quality = payload.get("quality") or "low"
        image_count = payload.get("n") or 1
        output_format = payload.get("output_format") or "jpeg"
        prompt = payload.get("prompt") if isinstance(payload.get("prompt"), str) else ""
        payload["size"] = size
        payload["quality"] = quality
        payload["n"] = image_count
        payload["output_format"] = output_format
        requested_model = payload.get("model") or EXTERNAL_MODEL
        if requested_model not in SUPPORTED_EXTERNAL_MODELS:
            self.send_json(
                400,
                {
                    "error": {
                        "message": f"Only models {', '.join(sorted(SUPPORTED_EXTERNAL_MODELS))} are supported here.",
                        "type": "invalid_request_error",
                        "param": "model",
                        "code": "unsupported_model",
                    }
                },
            )
            return
        payload["model"] = requested_model
        if not self.normalize_image_payload(payload):
            return
        size = payload["size"]
        quality = payload["quality"]
        image_count = payload["n"]

        auth_headers = self.newapi_console_auth_headers()
        user_id = auth_headers.get("New-API-User", "")
        if not auth_headers.get("Authorization") and not auth_headers.get("Cookie"):
            self.send_newapi_login_required()
            self.log_console_image_metrics(
                user_id, size, quality, output_format, image_count, False, 0, 0, 401, prompt
            )
            return

        token_start = time.monotonic()
        token_key, token_cache_hit = self.get_or_create_console_image_token(auth_headers)
        token_ms = self.elapsed_ms(token_start)
        if not token_key:
            self.log_console_image_metrics(
                user_id, size, quality, output_format, image_count, token_cache_hit, token_ms, 0, 502, prompt
            )
            return

        api_key = token_key if token_key.startswith("sk-") else f"sk-{token_key}"

        upstream_start = time.monotonic()
        status = self.forward_image_generation(payload, api_key)
        upstream_ms = self.elapsed_ms(upstream_start)
        self.log_console_image_metrics(
            user_id,
            size,
            quality,
            output_format,
            image_count,
            token_cache_hit,
            token_ms,
            upstream_ms,
            status,
            prompt,
        )

    def newapi_console_auth_headers(self):
        headers = {
            "Accept": "application/json",
            "Cache-Control": "no-store",
            "User-Agent": "rivermoon-image-ui/2.0",
        }
        auth = self.headers.get("X-Rivermoon-NewAPI-Authorization", "").strip()
        user_id = self.headers.get("X-Rivermoon-NewAPI-User", "").strip()
        cookie = self.headers.get("Cookie", "").strip()

        if auth:
            headers["Authorization"] = auth if auth.lower().startswith("bearer ") else f"Bearer {auth}"
        if user_id:
            headers["New-API-User"] = user_id
        if cookie:
            headers["Cookie"] = cookie
        return headers

    def get_or_create_console_image_token(self, auth_headers):
        cache_key = self.console_token_cache_key(auth_headers)
        if cache_key:
            cached = CONSOLE_TOKEN_CACHE.get(cache_key)
            if cached and cached.get("expires_at", 0) > time.time():
                return cached.get("key", ""), True
            if cached:
                CONSOLE_TOKEN_CACHE.pop(cache_key, None)

        token = self.find_console_image_token(auth_headers)
        if token is None:
            return "", False
        if not token:
            token = self.create_console_image_token(auth_headers)
            if token is None:
                return "", False
        token_id = token.get("id")
        if not token_id:
            self.send_json(
                502,
                {
                    "error": {
                        "message": "NewAPI token record is missing an id.",
                        "type": "server_error",
                        "code": "missing_token_id",
                    }
                },
            )
            return "", False
        key = self.fetch_console_token_key(token_id, auth_headers)
        if key and cache_key:
            now = time.time()
            for stale_key, entry in list(CONSOLE_TOKEN_CACHE.items()):
                if entry.get("expires_at", 0) <= now:
                    CONSOLE_TOKEN_CACHE.pop(stale_key, None)
            CONSOLE_TOKEN_CACHE[cache_key] = {
                "key": key,
                "expires_at": time.time() + TOKEN_CACHE_TTL_SECONDS,
            }
        return key or "", False

    def console_token_cache_key(self, auth_headers):
        # The cache must be keyed by the caller's credentials, not by the
        # client-supplied user id header alone; otherwise anyone could send a
        # victim's user id and reuse the victim's cached image token.
        user_id = auth_headers.get("New-API-User", "").strip()
        credential = "\n".join(
            [
                user_id,
                auth_headers.get("Authorization", "").strip(),
                auth_headers.get("Cookie", "").strip(),
            ]
        )
        if not user_id or credential == user_id + "\n\n":
            return ""
        return "cred:" + hashlib.sha256(credential.encode("utf-8")).hexdigest()

    def find_console_image_token(self, auth_headers):
        for page in range(1, 11):
            data = self.call_newapi_json(
                "GET", f"/api/token/?p={page}&size=10", auth_headers
            )
            if data is None:
                return None
            payload = data.get("data") or {}
            if isinstance(payload, list):
                items = payload
            else:
                items = (
                    payload.get("items")
                    or payload.get("tokens")
                    or payload.get("rows")
                    or payload.get("data")
                    or []
                )
            if not isinstance(items, list):
                items = []
            for item in items:
                if (
                    isinstance(item, dict)
                    and item.get("status") == 1
                    and item.get("name") == TOKEN_NAME
                ):
                    return item
            if len(items) < 10:
                break
        return {}

    def create_console_image_token(self, auth_headers):
        payload = {
            "name": TOKEN_NAME,
            "remain_quota": 0,
            "remain_amount": 0,
            "expired_time": -1,
            "unlimited_quota": True,
            "model_limits_enabled": True,
            "model_limits": EXTERNAL_MODEL,
            "allow_ips": "",
            "group": "",
            "cross_group_retry": False,
        }
        data = self.call_newapi_json("POST", "/api/token/", auth_headers, payload)
        if data is None:
            return None
        token = self.find_console_image_token(auth_headers)
        if not token:
            self.send_json(
                502,
                {
                    "error": {
                        "message": "NewAPI created the image token but did not return it in the token list.",
                        "type": "server_error",
                        "code": "token_not_found",
                    }
                },
            )
            return None
        return token

    def fetch_console_token_key(self, token_id, auth_headers):
        data = self.call_newapi_json("POST", f"/api/token/{token_id}/key", auth_headers)
        if data is None:
            return None
        payload = data.get("data") or {}
        key = payload.get("key") if isinstance(payload, dict) else ""
        if not key:
            self.send_json(
                502,
                {
                    "error": {
                        "message": "NewAPI did not return the token key.",
                        "type": "server_error",
                        "code": "missing_token_key",
                    }
                },
            )
            return None
        return key

    def call_newapi_json(self, method, path, auth_headers, payload=None):
        body = None
        headers = dict(auth_headers)
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"

        upstream_request = request.Request(
            f"{NEWAPI_API_BASE_URL}{path}",
            data=body,
            method=method,
            headers=headers,
        )
        try:
            with request.urlopen(
                upstream_request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                response_body = response.read()
                status = response.status
                content_type = response.headers.get("Content-Type", "application/json")
        except error.HTTPError as exc:
            response_body = exc.read()
            status = exc.code
            content_type = exc.headers.get("Content-Type", "application/json")
        except error.URLError:
            self.send_json(
                502,
                {
                    "error": {
                        "message": "NewAPI console API is unavailable.",
                        "type": "server_error",
                        "code": "newapi_unavailable",
                    }
                },
            )
            return None

        try:
            data = json.loads(response_body.decode("utf-8")) if response_body else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            if status in (401, 403):
                self.send_newapi_login_required()
            else:
                self.send_bytes(status, response_body, content_type)
            return None

        if status in (401, 403):
            self.send_newapi_login_required()
            return None
        if status < 200 or status >= 300 or data.get("success") is False:
            message = (
                data.get("message")
                or (data.get("error") or {}).get("message")
                or "NewAPI request failed."
            )
            self.send_json(
                status if status >= 400 else 502,
                {
                    "error": {
                        "message": message,
                        "type": "newapi_error",
                        "code": "newapi_console_error",
                    }
                },
            )
            return None
        return data

    def bearer_token(self):
        auth = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not auth.startswith(prefix):
            return ""
        token = auth[len(prefix) :].strip()
        return token

    def read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Invalid Content-Length",
                        "type": "invalid_request_error",
                        "code": "invalid_content_length",
                    }
                },
            )
            return None

        if length <= 0:
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Request body must be a JSON object.",
                        "type": "invalid_request_error",
                        "code": "invalid_json",
                    }
                },
            )
            return None

        if length > MAX_BODY_BYTES:
            self.send_json(
                413,
                {
                    "error": {
                        "message": "Request body too large.",
                        "type": "invalid_request_error",
                        "code": "request_too_large",
                    }
                },
            )
            return None

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Request body must be valid JSON.",
                        "type": "invalid_request_error",
                        "code": "invalid_json",
                    }
                },
            )
            return None

        if not isinstance(payload, dict):
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Request body must be a JSON object.",
                        "type": "invalid_request_error",
                        "code": "invalid_json",
                    }
                },
            )
            return None
        return payload

    def read_raw_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Invalid Content-Length",
                        "type": "invalid_request_error",
                        "code": "invalid_content_length",
                    }
                },
            )
            return None

        if length <= 0:
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Request body is required.",
                        "type": "invalid_request_error",
                        "code": "empty_request_body",
                    }
                },
            )
            return None

        if length > MAX_BODY_BYTES:
            self.send_json(
                413,
                {
                    "error": {
                        "message": "Request body too large.",
                        "type": "invalid_request_error",
                        "code": "request_too_large",
                    }
                },
            )
            return None

        return self.rfile.read(length)

    def normalize_image_payload(self, payload):
        size = payload.get("size") or "1024x1024"
        quality = payload.get("quality") or "low"
        output_format = payload.get("output_format") or "jpeg"
        image_count = payload.get("n") or 1

        if size not in ALLOWED_SIZES:
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Unsupported image size. Use 1024x1024, 1536x1024, 1024x1536, 2048x2048, 2048x1152, 3840x2160, 2160x3840, or auto.",
                        "type": "invalid_request_error",
                        "param": "size",
                        "code": "unsupported_size",
                    }
                },
            )
            return False
        if quality not in ALLOWED_QUALITIES:
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Unsupported image quality. Use low, medium, high, or auto.",
                        "type": "invalid_request_error",
                        "param": "quality",
                        "code": "unsupported_quality",
                    }
                },
            )
            return False
        if output_format not in ALLOWED_OUTPUT_FORMATS:
            self.send_json(
                400,
                {
                    "error": {
                        "message": "Unsupported output format. Use jpeg, png, or webp.",
                        "type": "invalid_request_error",
                        "param": "output_format",
                        "code": "unsupported_output_format",
                    }
                },
            )
            return False

        try:
            image_count = int(image_count)
        except (TypeError, ValueError):
            image_count = 1
        image_count = max(1, min(4, image_count))

        requested_model = payload.get("model") or EXTERNAL_MODEL
        payload["model"] = requested_model if requested_model in SUPPORTED_EXTERNAL_MODELS else EXTERNAL_MODEL
        payload["size"] = size
        payload["quality"] = quality
        payload["n"] = image_count
        payload["output_format"] = output_format
        if output_format == "png":
            payload.pop("output_compression", None)
        else:
            try:
                compression = int(payload.get("output_compression", 80))
            except (TypeError, ValueError):
                compression = 80
            payload["output_compression"] = max(0, min(100, compression))
        return True

    def normalize_multipart_image_model(self, body):
        marker = b'name="model"'
        if marker not in body:
            return body

        pattern = re.compile(
            rb'(?is)(Content-Disposition:[^\r\n]*name="model"[^\r\n]*\r\n'
            rb'(?:[^\r\n]+\r\n)*\r\n)[^\r\n]*(\r\n)',
        )

        def replace(match):
            return match.group(1) + EXTERNAL_MODEL.encode("utf-8") + match.group(2)

        normalized, count = pattern.subn(replace, body, count=1)
        return normalized if count else body

    def upstream_model_available(self, bearer_token):
        upstream_request = request.Request(
            f"{UPSTREAM_BASE_URL}/models",
            method="GET",
            headers={
                "Authorization": f"Bearer {bearer_token}",
                "Accept": "application/json",
                "User-Agent": "rivermoon-image-ui/1.1",
            },
        )
        try:
            with request.urlopen(
                upstream_request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                response_body = response.read()
        except error.HTTPError as exc:
            if exc.code in (401, 403):
                self.send_unauthorized()
            else:
                self.send_bytes(
                    exc.code,
                    exc.read(),
                    exc.headers.get("Content-Type", "application/json"),
                )
            return False
        except error.URLError:
            self.send_json(
                502,
                {
                    "error": {
                        "message": "NewAPI upstream is unavailable.",
                        "type": "server_error",
                        "code": "upstream_unavailable",
                    }
                },
            )
            return False

        try:
            data = json.loads(response_body.decode("utf-8"))
            model_ids = {item.get("id") for item in data.get("data", [])}
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            model_ids = set()

        if not SUPPORTED_EXTERNAL_MODELS.issubset(model_ids):
            self.send_json(
                403,
                {
                    "error": {
                        "message": f"NewAPI key does not have access to {', '.join(sorted(SUPPORTED_EXTERNAL_MODELS))}.",
                        "type": "invalid_request_error",
                        "code": "model_not_available",
                    }
                },
            )
            return False

        return True

    def forward_image_generation(self, payload, bearer_token):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        return self.forward_raw_image_request(
            "/images/generations",
            body,
            bearer_token,
            "application/json",
        )

    def forward_raw_image_request(self, upstream_path, body, bearer_token, content_type):
        attempts = max(1, IMAGE_RETRY_ATTEMPTS + 1)
        last_status = 502
        last_body = b""
        last_content_type = "application/json"

        for attempt in range(1, attempts + 1):
            status, response_body, response_content_type = self.call_image_upstream(
                upstream_path,
                body,
                bearer_token,
                content_type,
            )
            last_status = status
            last_body = response_body
            last_content_type = response_content_type

            retry_reason = self.image_retry_reason(status, response_body, attempt)
            if attempt < attempts and retry_reason:
                delay = self.image_retry_delay(attempt)
                print(
                    "image_upstream_retry "
                    f"path={upstream_path} "
                    f"attempt={attempt} "
                    f"status={status} "
                    f"reason={retry_reason} "
                    f"sleep_seconds={delay:g}",
                    flush=True,
                )
                time.sleep(delay)
                continue

            self.send_bytes(status, response_body, response_content_type)
            return status

        self.send_bytes(last_status, last_body, last_content_type)
        return last_status

    def is_async_image_request(self):
        return self.headers.get("X-Rivermoon-Async", "").strip() == "1"

    def start_image_job(self, upstream_path, body, bearer_token, content_type):
        self.cleanup_image_jobs()
        job_id = uuid.uuid4().hex
        now = time.time()
        accept = self.headers.get("Accept", "application/json")
        user_agent = self.headers.get("User-Agent", "rivermoon-image-ui/1.2")
        with IMAGE_JOBS_LOCK:
            IMAGE_JOBS[job_id] = {
                "id": job_id,
                "status": "queued",
                "path": upstream_path,
                "created_at": now,
                "updated_at": now,
                "response_status": None,
                "content_type": "application/json",
                "body": b"",
                "error": "",
            }

        worker = threading.Thread(
            target=self.run_image_job,
            args=(job_id, upstream_path, body, bearer_token, content_type, accept, user_agent),
            daemon=True,
        )
        worker.start()
        self.send_json(
            202,
            {
                "object": "rivermoon_image_job",
                "id": job_id,
                "status": "queued",
                "poll_after_ms": 2000,
            },
        )

    def run_image_job(
        self, job_id, upstream_path, body, bearer_token, content_type, accept, user_agent
    ):
        self.update_image_job(job_id, status="running")
        attempts = max(1, IMAGE_RETRY_ATTEMPTS + 1)

        for attempt in range(1, attempts + 1):
            status, response_body, response_content_type = self.call_image_upstream(
                upstream_path,
                body,
                bearer_token,
                content_type,
                accept=accept,
                user_agent=user_agent,
            )
            retry_reason = self.image_retry_reason(status, response_body, attempt)
            if attempt < attempts and retry_reason:
                delay = self.image_retry_delay(attempt)
                print(
                    "image_async_job_retry "
                    f"job_id={job_id} "
                    f"path={upstream_path} "
                    f"attempt={attempt} "
                    f"status={status} "
                    f"reason={retry_reason} "
                    f"sleep_seconds={delay:g}",
                    flush=True,
                )
                time.sleep(delay)
                continue

            final_status = "succeeded" if 200 <= status < 300 else "failed"
            self.update_image_job(
                job_id,
                status=final_status,
                response_status=status,
                content_type=response_content_type,
                body=response_body,
            )
            print(
                "image_async_job_done "
                f"job_id={job_id} "
                f"path={upstream_path} "
                f"status={status} "
                f"result={final_status} "
                f"bytes={len(response_body)}",
                flush=True,
            )
            return

    def update_image_job(self, job_id, **updates):
        with IMAGE_JOBS_LOCK:
            job = IMAGE_JOBS.get(job_id)
            if not job:
                return
            job.update(updates)
            job["updated_at"] = time.time()

    def cleanup_image_jobs(self):
        cutoff = time.time() - IMAGE_JOB_TTL_SECONDS
        with IMAGE_JOBS_LOCK:
            for job_id, job in list(IMAGE_JOBS.items()):
                if job.get("updated_at", job.get("created_at", 0)) < cutoff:
                    IMAGE_JOBS.pop(job_id, None)

    def handle_image_job_status(self, job_id):
        self.cleanup_image_jobs()
        with IMAGE_JOBS_LOCK:
            job = dict(IMAGE_JOBS.get(job_id) or {})
        if not job:
            self.send_json(
                404,
                {
                    "error": {
                        "message": "Image job not found or expired.",
                        "type": "invalid_request_error",
                        "code": "image_job_not_found",
                    }
                },
            )
            return

        payload = {
            "object": "rivermoon_image_job",
            "id": job["id"],
            "status": job["status"],
            "created_at": int(job["created_at"]),
            "updated_at": int(job["updated_at"]),
            "poll_after_ms": 2000,
        }
        if job["status"] in ("succeeded", "failed"):
            body = job.get("body") or b""
            try:
                payload["body"] = json.loads(body.decode("utf-8"))
            except Exception:
                payload["body"] = body.decode("utf-8", "ignore")
            payload["response_status"] = job.get("response_status") or 500
            payload["content_type"] = job.get("content_type") or "application/json"
        self.send_json(200, payload)

    def call_image_upstream(
        self,
        upstream_path,
        body,
        bearer_token,
        content_type,
        accept=None,
        user_agent=None,
    ):
        upstream_request = request.Request(
            f"{UPSTREAM_BASE_URL}{upstream_path}",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {bearer_token}",
                "Content-Type": content_type,
                "Accept": accept or self.headers.get("Accept", "application/json"),
                "User-Agent": user_agent
                or self.headers.get("User-Agent", "rivermoon-image-ui/1.2"),
            },
        )

        try:
            with request.urlopen(
                upstream_request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                response_body = response.read()
                content_type = response.headers.get("Content-Type", "application/json")
                return response.status, response_body, content_type
        except error.HTTPError as exc:
            response_body = exc.read()
            content_type = exc.headers.get("Content-Type", "application/json")
            return exc.code, response_body, content_type
        except error.URLError:
            return (
                502,
                json.dumps(
                    {
                        "error": {
                            "message": "Image upstream is unavailable.",
                            "type": "server_error",
                            "code": "upstream_unavailable",
                        }
                    },
                    separators=(",", ":"),
                ).encode("utf-8"),
                "application/json",
            )

    def image_retry_reason(self, status, body, attempt):
        if not body:
            return ""
        try:
            text = body.decode("utf-8", "ignore")
        except Exception:
            return ""
        lowered = text.lower()
        if status == 400 and TOOL_CHOICE_RETRY_TEXT in text:
            return "tool_choice_image_generation"
        if attempt >= 1 and status in TRANSIENT_IMAGE_RETRY_STATUSES:
            if any(marker in lowered for marker in TRANSIENT_IMAGE_RETRY_TEXTS):
                return "transient_upstream_disconnect"
        return ""

    def image_retry_delay(self, attempt):
        index = max(0, min(len(IMAGE_RETRY_BACKOFF_SECONDS) - 1, attempt - 1))
        return IMAGE_RETRY_BACKOFF_SECONDS[index]

    def elapsed_ms(self, started_at):
        return int((time.monotonic() - started_at) * 1000)

    def log_console_image_metrics(
        self,
        user_id,
        size,
        quality,
        output_format,
        image_count,
        token_cache_hit,
        token_ms,
        upstream_ms,
        status,
        prompt,
    ):
        print(
            "console_image_generation "
            f"user_id={user_id or '-'} "
            f"model={EXTERNAL_MODEL} "
            f"internal_model={INTERNAL_MODEL} "
            f"size={size} "
            f"quality={quality} "
            f"output_format={output_format} "
            f"n={image_count} "
            f"prompt_chars={len(prompt or '')} "
            f"prompt_hash={self.prompt_hash(prompt)} "
            f"token_cache_hit={str(bool(token_cache_hit)).lower()} "
            f"token_ms={int(token_ms)} "
            f"upstream_ms={int(upstream_ms)} "
            f"status={int(status)}",
            flush=True,
        )

    def prompt_hash(self, prompt):
        if not prompt:
            return "-"
        return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]

    def send_unauthorized(self):
        self.send_json(
            401,
            {
                "error": {
                    "message": "Unauthorized",
                    "type": "invalid_request_error",
                    "code": "unauthorized",
                }
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    def send_newapi_login_required(self):
        self.send_json(
            401,
            {
                "error": {
                    "message": "无法读取当前 NewAPI 登录态，请刷新或重新登录后重试。",
                    "type": "invalid_request_error",
                    "code": "newapi_login_required",
                }
            },
        )

    def send_json(self, status, payload, headers=None):
        self.send_bytes(
            status,
            json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            "application/json",
            headers=headers,
        )

    def send_html(self, status, html):
        self.send_bytes(status, html.encode("utf-8"), "text/html; charset=utf-8")

    def send_bytes(self, status, body, content_type, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            print(
                "client_disconnected_after_upstream "
                f"path={self.path.split('?', 1)[0]} "
                f"status={status} "
                f"bytes={len(body)}",
                flush=True,
            )


def main():
    require_config()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), ImageRelayHandler)
    print(
        f"rivermoon image relay listening on :{PORT}; "
        f"external_models={','.join(sorted(SUPPORTED_EXTERNAL_MODELS))}; internal_model={INTERNAL_MODEL}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
