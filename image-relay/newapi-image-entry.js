(function () {
  const ITEM_ID = "rivermoon-image-menu";
  const ROOT_ID = "rivermoon-image-root";
  const STYLE_ID = "rivermoon-image-generation-style";
  const MODEL = "image2.0";
  const LEGACY_ITEM_ID = ["rivermoon", "image", "generation", "menu", "item"].join("-");
  const LEGACY_ITEM_CLASS = ["rivermoon", "image", "menu", "item"].join("-");
  let guardInstalled = false;
  let resizeInstalled = false;
  let restoreScheduled = false;
  let rivermoonImageActive = false;

  async function readJsonResponse(response) {
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}
    return data;
  }

  function responseErrorMessage(data, fallback) {
    return (
      data.message ||
      (data.error && data.error.message) ||
      fallback ||
      "请求失败。"
    );
  }

  function authHeaderFromToken(token) {
    if (!token || typeof token !== "string") return "";
    const trimmed = token.trim();
    if (!trimmed) return "";
    return /^Bearer\s+/i.test(trimmed) ? trimmed : "Bearer " + trimmed;
  }

  function readNewApiLogin() {
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem("user") || "null");
    } catch {}
    const userId =
      user && (user.id || user.user_id || user.userId)
        ? String(user.id || user.user_id || user.userId)
        : "";
    const authorization = authHeaderFromToken(
      user && (user.token || user.access_token || user.accessToken)
    );
    return { authorization, userId };
  }

  function consoleImageHeaders() {
    const auth = readNewApiLogin();
    const headers = { "Content-Type": "application/json" };
    if (auth.authorization) {
      headers["X-Rivermoon-NewAPI-Authorization"] = auth.authorization;
    }
    if (auth.userId) {
      headers["X-Rivermoon-NewAPI-User"] = auth.userId;
    }
    return headers;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .rivermoon-image-page {
        min-height: 100%;
        padding: 26px 28px 32px;
        background: #f7f8fa;
        color: #1f2937;
        width: 100%;
        box-sizing: border-box;
        font-family: inherit;
      }
      #rivermoon-image-root {
        position: fixed;
        z-index: 2147483000;
        overflow: auto;
        background: #f7f8fa;
        box-sizing: border-box;
      }
      #rivermoon-image-root[hidden] {
        display: none !important;
      }
      #rivermoon-image-menu,
      [data-rivermoon-image-menu="1"] {
        cursor: pointer !important;
        user-select: none;
      }
      .rivermoon-image-title {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
        font-size: 24px;
        line-height: 1.2;
        letter-spacing: 0;
        color: #111827;
        font-weight: 760;
      }
      .rivermoon-image-subtitle {
        margin: 8px 0 22px;
        color: #6b7280;
        font-size: 14px;
      }
      .rivermoon-image-badge {
        height: 24px;
        border-radius: 999px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        background: #eef6ff;
        color: #1677ff;
        font-size: 12px;
        font-weight: 700;
      }
      .rivermoon-image-grid {
        display: grid;
        grid-template-columns: minmax(300px, 380px) minmax(460px, 1fr) minmax(240px, 300px);
        gap: 16px;
        align-items: stretch;
      }
      .rivermoon-image-card {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fff;
        color: #1f2937;
        box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
      }
      .rivermoon-image-form {
        padding: 18px;
      }
      .rivermoon-image-card h2 {
        margin: 0 0 16px;
        font-size: 15px;
        line-height: 1.3;
        letter-spacing: 0;
        color: #111827;
        font-weight: 760;
      }
      .rivermoon-field {
        display: grid;
        gap: 7px;
        margin-bottom: 14px;
      }
      .rivermoon-field label {
        font-size: 13px;
        font-weight: 650;
        color: #374151;
      }
      .rivermoon-field textarea,
      .rivermoon-field select,
      .rivermoon-field input {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #fff;
        color: #111827;
        font: inherit;
        outline: none;
      }
      .rivermoon-field textarea {
        min-height: 142px;
        padding: 10px 12px;
        resize: vertical;
        line-height: 1.5;
      }
      .rivermoon-field textarea.negative {
        min-height: 82px;
      }
      .rivermoon-field select,
      .rivermoon-field input {
        height: 40px;
        padding: 0 10px;
      }
      .rivermoon-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .rivermoon-counter {
        text-align: right;
        font-size: 12px;
        color: #9ca3af;
        margin-top: -8px;
        margin-bottom: 12px;
      }
      .rivermoon-generate {
        width: 100%;
        height: 44px;
        border: 0;
        border-radius: 8px;
        background: #1677ff;
        color: white;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
      .rivermoon-generate:disabled {
        cursor: wait;
        opacity: .65;
      }
      .rivermoon-action-line {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .rivermoon-action-line .rivermoon-generate {
        width: auto;
        flex: 1;
      }
      .rivermoon-elapsed {
        min-width: 54px;
        height: 44px;
        border: 1px solid #dbe2ea;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #4b5563;
        background: #f8fafc;
        font-size: 13px;
        font-weight: 700;
      }
      .rivermoon-elapsed[hidden] { display: none !important; }
      .rivermoon-message {
        min-height: 22px;
        margin-top: 12px;
        font-size: 13px;
        color: #6b7280;
        line-height: 1.5;
      }
      .rivermoon-message.error { color: #b42318; }
      .rivermoon-message.ok { color: #12735b; }
      .rivermoon-canvas {
        padding: 18px;
        display: grid;
        grid-template-rows: auto 1fr;
      }
      .rivermoon-canvas-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .rivermoon-canvas-stage {
        min-height: 520px;
        border: 1px dashed #d1d5db;
        border-radius: 8px;
        background: #fafafa;
        display: grid;
        place-items: center;
        text-align: center;
        color: #6b7280;
        padding: 18px;
        overflow: hidden;
      }
      .rivermoon-preview {
        max-width: 100%;
        max-height: 72vh;
        border-radius: 8px;
        background: white;
        box-shadow: 0 12px 28px rgba(15, 23, 42, .12);
      }
      .rivermoon-status {
        padding: 18px;
      }
      .rivermoon-status-list {
        display: grid;
        gap: 10px;
        color: #374151;
        font-size: 14px;
      }
      .rivermoon-status-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid #f0f2f5;
        padding-bottom: 10px;
      }
      .rivermoon-history-empty {
        min-height: 120px;
        display: grid;
        place-items: center;
        color: #6b7280;
      }
      .rivermoon-download {
        height: 36px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: white;
        color: #1f2937;
        padding: 0 12px;
        font-weight: 750;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
      }
      .rivermoon-download[hidden] { display: none !important; }
      .rivermoon-spinner {
        width: 34px;
        height: 34px;
        border: 4px solid #d1d5db;
        border-top-color: #1677ff;
        border-radius: 50%;
        animation: rivermoon-spin .9s linear infinite;
        margin: 0 auto 12px;
      }
      @keyframes rivermoon-spin { to { transform: rotate(360deg); } }
      @media (max-width: 1180px) {
        .rivermoon-image-grid { grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); }
        .rivermoon-status { grid-column: 1 / -1; }
      }
      @media (max-width: 760px) {
        .rivermoon-image-page { padding: 14px; }
        .rivermoon-image-grid { grid-template-columns: 1fr; }
        .rivermoon-canvas-stage { min-height: 380px; }
      }
    `;
    document.head.appendChild(style);
  }

  function directText(el) {
    return Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.nodeValue.trim())
      .join("");
  }

  function replaceText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue.includes("操练场")) {
        node.nodeValue = node.nodeValue.replace("操练场", "图像生成");
      }
      return;
    }
    Array.from(node.childNodes || []).forEach(replaceText);
  }

  function swallow(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }

  function isLikelyImageMenuElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const text = (node.textContent || "").replace(/\s+/g, "").trim();
    if (!text.includes("图像生成") || text.length > 16) return false;
    const rect = node.getBoundingClientRect();
    return (
      rect.width >= 80 &&
      rect.width <= 340 &&
      rect.height >= 20 &&
      rect.height <= 72 &&
      rect.left <= Math.min(360, window.innerWidth * 0.45)
    );
  }

  function findImageMenuFromTarget(target) {
    let node =
      target && target.nodeType === Node.ELEMENT_NODE
        ? target
        : target && target.parentElement;
    for (let i = 0; node && node !== document.body && i < 10; i += 1) {
      if (
        node.getAttribute &&
        node.getAttribute("data-rivermoon-image-menu") === "1"
      ) {
        return node;
      }
      if (node.id === ITEM_ID || isLikelyImageMenuElement(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function eventHitsEntry(event) {
    const path = event.composedPath ? event.composedPath() : [];
    if (
      path.some(
        (node) =>
          node &&
          node.nodeType === Node.ELEMENT_NODE &&
          node.getAttribute &&
          node.getAttribute("data-rivermoon-image-menu") === "1"
      )
    ) {
      return true;
    }
    const target =
      event.target && event.target.nodeType === Node.ELEMENT_NODE
        ? event.target
        : event.target && event.target.parentElement;
    return Boolean(
      target &&
        target.closest &&
        (target.closest("#" + ITEM_ID + ',[data-rivermoon-image-menu="1"]') ||
          findImageMenuFromTarget(target))
    );
  }

  function installEventGuard() {
    if (guardInstalled) return;
    guardInstalled = true;
    [window, document].forEach((target) => {
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        target.addEventListener(
          type,
          function (event) {
            if (!eventHitsEntry(event)) return;
            swallow(event);
            showImagePage();
            return false;
          },
          true
        );
      });
      target.addEventListener(
        "keydown",
        function (event) {
          if (!eventHitsEntry(event)) return;
          if (event.key === "Enter" || event.key === " ") {
            swallow(event);
            showImagePage();
            return false;
          }
        },
        true
      );
    });
    document.addEventListener(
      "click",
      function (event) {
        if (clickShouldCloseImagePage(event)) hideImagePage();
      },
      true
    );
  }

  function removeLegacyEntries() {
    const stale = new Set();
    [ITEM_ID, LEGACY_ITEM_ID].forEach((id) => {
      const node = document.getElementById(id);
      if (node) stale.add(node);
    });
    document
      .querySelectorAll("." + LEGACY_ITEM_CLASS)
      .forEach((node) => stale.add(node));
    stale.forEach((node) => {
      if (node && node.parentElement) node.parentElement.removeChild(node);
    });
  }

  function cleanMenuClone(entry) {
    const nodes = [entry, ...Array.from(entry.querySelectorAll("*"))];
    nodes.forEach((node) => {
      if (node !== entry) node.removeAttribute("id");
      [
        "href",
        "to",
        "aria-current",
        "data-key",
        "data-item-key",
        "data-path",
        "data-route",
        "data-router",
        "data-selected",
      ].forEach((name) => node.removeAttribute(name));
      if (node.classList) {
        Array.from(node.classList).forEach((name) => {
          if (/selected|active|current/i.test(name)) node.classList.remove(name);
        });
      }
      if (node.tagName === "A") node.setAttribute("role", "button");
    });
    entry.id = ITEM_ID;
    entry.setAttribute("data-rivermoon-image-menu", "1");
    entry.setAttribute("role", "menuitem");
    entry.setAttribute("tabindex", "0");
    entry.setAttribute("title", "图像生成");
    replaceText(entry);
    if (!entry.textContent.trim().includes("图像生成")) {
      entry.appendChild(document.createTextNode("图像生成"));
    }
    return entry;
  }

  function closestMenuRow(el) {
    let current = el;
    for (let i = 0; current && i < 8; i += 1) {
      const rect = current.getBoundingClientRect();
      const text = current.textContent.trim();
      if (
        text.includes("操练场") &&
        text.length <= 12 &&
        rect.width >= 120 &&
        rect.height >= 28
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return el.closest("a,button,li,[role='menuitem'],.semi-navigation-item") || el;
  }

  function findPlaygroundItem() {
    const candidates = Array.from(
      document.querySelectorAll("a,button,span,div,li,[role='menuitem']")
    ).filter((el) => {
      const text = el.textContent.trim();
      return text === "操练场" || directText(el) === "操练场";
    });
    for (const candidate of candidates) {
      const row = closestMenuRow(candidate);
      if (row && row.parentElement) return row;
    }
    return null;
  }

  function findSidebar() {
    const entry = document.getElementById(ITEM_ID) || findPlaygroundItem();
    let best = null;
    let node = entry;
    while (node && node !== document.body) {
      const rect = node.getBoundingClientRect();
      if (
        rect.left <= 40 &&
        rect.width >= 150 &&
        rect.width <= 340 &&
        rect.height >= Math.min(420, window.innerHeight * 0.45)
      ) {
        best = node;
      }
      node = node.parentElement;
    }
    if (best) return best;
    return Array.from(document.querySelectorAll("aside,nav,div"))
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.left <= 40 &&
          rect.width >= 150 &&
          rect.width <= 340 &&
          rect.height >= Math.min(420, window.innerHeight * 0.45)
      )
      .sort((a, b) => b.rect.height - a.rect.height)[0]?.el;
  }

  function findHeaderBottom() {
    const candidates = Array.from(document.querySelectorAll("header,nav,div"))
      .map((el) => ({ el, rect: el.getBoundingClientRect(), text: el.textContent || "" }))
      .filter(
        ({ rect, text }) =>
          rect.top <= 8 &&
          rect.width >= window.innerWidth * 0.65 &&
          rect.height >= 44 &&
          rect.height <= 180 &&
          (text.includes("New API") || text.includes("首页") || text.includes("控制台"))
      )
      .sort((a, b) => b.rect.bottom - a.rect.bottom);
    return candidates[0] ? Math.ceil(candidates[0].rect.bottom) : 88;
  }

  function getImageRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    return root;
  }

  function layoutImageRoot() {
    const root = getImageRoot();
    const sidebar = findSidebar();
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 240;
    const left = Math.max(0, Math.min(window.innerWidth - 320, Math.ceil(sidebarRight)));
    const top = Math.max(0, Math.min(window.innerHeight - 240, findHeaderBottom()));
    root.style.left = left + "px";
    root.style.top = top + "px";
    root.style.right = "0";
    root.style.bottom = "0";
    root.style.width = "";
    root.style.height = "";
  }

  function ensureResizeHandler() {
    if (resizeInstalled) return;
    resizeInstalled = true;
    window.addEventListener("resize", () => {
      if (rivermoonImageActive) layoutImageRoot();
    });
  }

  function scheduleImageRestore(delay) {
    window.setTimeout(() => {
      if (rivermoonImageActive) renderImagePage();
    }, delay);
  }

  function scheduleObservedRestore() {
    if (!rivermoonImageActive || restoreScheduled) return;
    restoreScheduled = true;
    window.setTimeout(() => {
      restoreScheduled = false;
      if (rivermoonImageActive) renderImagePage();
    }, 80);
  }

  function setMenuActive() {
    const current = document.getElementById(ITEM_ID);
    if (!current) return;
    current.style.background = "rgba(22, 119, 255, 0.10)";
    current.style.color = "rgb(22, 119, 255)";
    current.style.fontWeight = "650";
  }

  function clearMenuActive() {
    const current = document.getElementById(ITEM_ID);
    if (!current) return;
    current.style.background = "";
    current.style.color = "";
    current.style.fontWeight = "";
  }

  function hideImagePage() {
    rivermoonImageActive = false;
    const root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    clearMenuActive();
  }

  function clickShouldCloseImagePage(event) {
    if (!rivermoonImageActive) return false;
    const target =
      event.target && event.target.nodeType === Node.ELEMENT_NODE
        ? event.target
        : event.target && event.target.parentElement;
    if (!target || !target.closest) return false;
    if (target.closest("#" + ROOT_ID + ',[data-rivermoon-image-menu="1"]')) {
      return false;
    }
    return Boolean(target.closest("a,button,[role='menuitem'],.semi-navigation-item"));
  }

  function imagePageHtml() {
    return `
      <div class="rivermoon-image-page">
        <h1 class="rivermoon-image-title">图像生成 <span class="rivermoon-image-badge">image2.0</span></h1>
        <p class="rivermoon-image-subtitle">使用当前 NewAPI 账号额度生成图片</p>
        <div class="rivermoon-image-grid">
          <section class="rivermoon-image-card rivermoon-image-form">
            <h2>生成设置</h2>
            <form id="rivermoonImageForm">
              <div class="rivermoon-field">
                <label for="rivermoonModel">模型</label>
                <select id="rivermoonModel">
                  <option value="image2.0">image2.0</option>
                </select>
              </div>
              <div class="rivermoon-field">
                <label for="rivermoonPrompt">提示词</label>
                <textarea id="rivermoonPrompt" maxlength="2000" required placeholder="描述你想生成的画面..."></textarea>
              </div>
              <div class="rivermoon-counter"><span id="rivermoonPromptCount">0</span> / 2000</div>
              <div class="rivermoon-field">
                <label for="rivermoonNegative">负面提示词</label>
                <textarea id="rivermoonNegative" class="negative" placeholder="可选，不希望出现的元素..."></textarea>
              </div>
              <div class="rivermoon-row">
                <div class="rivermoon-field">
                  <label for="rivermoonSize">尺寸</label>
                  <select id="rivermoonSize">
                    <option value="1024x1024">1024x1024</option>
                    <option value="1024x1536">1024x1536</option>
                    <option value="1536x1024">1536x1024</option>
                    <option value="2048x2048">2048x2048 · 2K</option>
                    <option value="2048x1152">2048x1152 · 2K</option>
                    <option value="3840x2160">3840x2160 · 4K 横图</option>
                    <option value="2160x3840">2160x3840 · 4K 竖图</option>
                    <option value="auto">auto</option>
                  </select>
                </div>
                <div class="rivermoon-field">
                  <label for="rivermoonQuality">质量</label>
                  <select id="rivermoonQuality">
                    <option value="low">low - 最快/省额度</option>
                    <option value="medium">medium - 均衡</option>
                    <option value="high">high - 更慢/更贵</option>
                    <option value="auto">auto - 上游决定</option>
                  </select>
                </div>
              </div>
              <div class="rivermoon-row">
                <div class="rivermoon-field">
                  <label for="rivermoonOutputFormat">输出格式</label>
                  <select id="rivermoonOutputFormat">
                    <option value="jpeg">jpeg - 默认/更小</option>
                    <option value="png">png - 无损/更大</option>
                    <option value="webp">webp - 体积更小</option>
                  </select>
                </div>
                <div class="rivermoon-field">
                  <label for="rivermoonOutputCompression">压缩率</label>
                  <input id="rivermoonOutputCompression" type="number" min="0" max="100" value="80">
                </div>
              </div>
              <div class="rivermoon-field">
                <label for="rivermoonCount">生成数量</label>
                <input id="rivermoonCount" type="number" min="1" max="4" value="1">
              </div>
              <div class="rivermoon-action-line">
                <button class="rivermoon-generate" id="rivermoonGenerate" type="submit">✧ 生成图像</button>
                <span class="rivermoon-elapsed" id="rivermoonElapsed" hidden>0s</span>
              </div>
              <div class="rivermoon-message" id="rivermoonMessage"></div>
            </form>
          </section>

          <section class="rivermoon-image-card rivermoon-canvas">
            <div class="rivermoon-canvas-head">
              <h2>创作画布</h2>
              <a class="rivermoon-download" id="rivermoonDownload" href="#" download="rivermoon-image.png" hidden>下载</a>
            </div>
            <div class="rivermoon-canvas-stage" id="rivermoonStage">
              <div>
                <div style="font-size:42px; opacity:.22;">▧</div>
                <p>生成的图像将显示在这里</p>
                <p>填写提示词并点击“生成图像”开始创作</p>
              </div>
            </div>
          </section>

          <section class="rivermoon-image-card rivermoon-status">
            <h2>模型状态</h2>
            <div class="rivermoon-status-list">
              <div class="rivermoon-status-row"><span>当前模型</span><strong id="rivermoonCurrentModel">image2.0</strong></div>
              <div class="rivermoon-status-row"><span>调用方式</span><strong>NewAPI</strong></div>
              <div class="rivermoon-status-row"><span>预计费用</span><strong>按 NewAPI 计费</strong></div>
            </div>
            <h2 style="margin-top:24px;">最近生成</h2>
            <div class="rivermoon-history-empty" id="rivermoonHistory">暂无生成</div>
          </section>
        </div>
      </div>
    `;
  }

  function extractImage(data) {
    const item = data && data.data && data.data[0];
    if (!item) return "";
    if (item.b64_json) return "data:image/png;base64," + item.b64_json;
    if (item.url) return item.url;
    return "";
  }

  function wireImagePage(host) {
    const form = host.querySelector("#rivermoonImageForm");
    const prompt = host.querySelector("#rivermoonPrompt");
    const negative = host.querySelector("#rivermoonNegative");
    const model = host.querySelector("#rivermoonModel");
    const size = host.querySelector("#rivermoonSize");
    const quality = host.querySelector("#rivermoonQuality");
    const outputFormat = host.querySelector("#rivermoonOutputFormat");
    const outputCompression = host.querySelector("#rivermoonOutputCompression");
    const count = host.querySelector("#rivermoonCount");
    const button = host.querySelector("#rivermoonGenerate");
    const message = host.querySelector("#rivermoonMessage");
    const stage = host.querySelector("#rivermoonStage");
    const download = host.querySelector("#rivermoonDownload");
    const promptCount = host.querySelector("#rivermoonPromptCount");
    const currentModel = host.querySelector("#rivermoonCurrentModel");
    const history = host.querySelector("#rivermoonHistory");
    const elapsed = host.querySelector("#rivermoonElapsed");
    let elapsedTimer = null;
    let startedAt = 0;

    function setMessage(text, kind) {
      message.textContent = text || "";
      message.className = "rivermoon-message" + (kind ? " " + kind : "");
    }

    function setBusy(busy) {
      button.disabled = busy;
      button.textContent = busy ? "生成中..." : "✧ 生成图像";
    }

    function formatElapsed(ms) {
      const seconds = Math.max(0, Math.round(ms / 1000));
      return seconds + "s";
    }

    function updateElapsed() {
      if (!startedAt) return;
      elapsed.textContent = formatElapsed(Date.now() - startedAt);
    }

    function startElapsed() {
      startedAt = Date.now();
      elapsed.hidden = false;
      updateElapsed();
      if (elapsedTimer) window.clearInterval(elapsedTimer);
      elapsedTimer = window.setInterval(updateElapsed, 1000);
    }

    function stopElapsed() {
      if (elapsedTimer) {
        window.clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
      updateElapsed();
      const total = startedAt ? formatElapsed(Date.now() - startedAt) : "0s";
      startedAt = 0;
      return total;
    }

    function showLoading() {
      download.hidden = true;
      stage.innerHTML = '<div><div class="rivermoon-spinner"></div><p>正在生成图像...</p></div>';
    }

    prompt.addEventListener("input", () => {
      promptCount.textContent = String(prompt.value.length);
    });
    model.addEventListener("change", () => {
      currentModel.textContent = model.value;
    });
    outputFormat.addEventListener("change", () => {
      const isPng = outputFormat.value === "png";
      outputCompression.disabled = isPng;
      outputCompression.title = isPng ? "PNG 不使用压缩率参数" : "";
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = prompt.value.trim();
      if (!text) {
        setMessage("请先填写提示词。", "error");
        prompt.focus();
        return;
      }
      setBusy(true);
      showLoading();
      startElapsed();
      setMessage("正在通过 NewAPI 生成图片...");
      let totalElapsed = "0s";
      try {
        const fullPrompt = negative.value.trim()
          ? `${text}\n\nNegative prompt: ${negative.value.trim()}`
          : text;
        const body = {
          model: model.value,
          prompt: fullPrompt,
          size: size.value,
          quality: quality.value,
          output_format: outputFormat.value,
          n: Number(count.value || 1),
        };
        if (outputFormat.value !== "png") {
          body.output_compression = Number(outputCompression.value || 80);
        }
        const response = await fetch("/rivermoon-image-generate", {
          method: "POST",
          headers: consoleImageHeaders(),
          credentials: "include",
          body: JSON.stringify(body),
        });
        const data = await readJsonResponse(response);
        if (!response.ok) {
          throw new Error(responseErrorMessage(data, "生成失败。"));
        }
        const src = extractImage(data);
        if (!src) throw new Error("生成完成，但响应里没有图片。");
        const img = document.createElement("img");
        img.className = "rivermoon-preview";
        img.alt = "生成结果";
        img.src = src;
        stage.replaceChildren(img);
        download.href = src;
        download.hidden = false;
        history.textContent = new Date().toLocaleString();
        totalElapsed = stopElapsed();
        setMessage(`生成完成，用时 ${totalElapsed}，费用已计入当前 NewAPI 用户额度。`, "ok");
      } catch (error) {
        totalElapsed = stopElapsed();
        stage.innerHTML = "<div><p>没有生成图片。</p></div>";
        setMessage(`${error.message || "生成失败。"}（用时 ${totalElapsed}）`, "error");
      } finally {
        setBusy(false);
      }
    });
  }

  function renderImagePage() {
    installStyles();
    ensureResizeHandler();
    const root = getImageRoot();
    root.hidden = false;
    if (!root.querySelector("#rivermoonImageForm")) {
      root.innerHTML = imagePageHtml();
      root.dataset.rivermoonImagePage = "1";
      wireImagePage(root);
    }
    layoutImageRoot();
    setMenuActive();
    return true;
  }

  function showImagePage() {
    rivermoonImageActive = true;
    renderImagePage();
    [50, 150, 350, 800, 1400].forEach(scheduleImageRestore);
  }

  function installEntry() {
    if (document.getElementById(ITEM_ID)) return;
    const item = findPlaygroundItem();
    if (!item || !item.parentElement) return;

    const entry = cleanMenuClone(item.cloneNode(true));

    ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
      entry.addEventListener(
        type,
        function (event) {
          swallow(event);
          showImagePage();
          return false;
        },
        true
      );
    });
    entry.addEventListener(
      "keydown",
      function (event) {
        if (event.key === "Enter" || event.key === " ") {
          swallow(event);
          showImagePage();
          return false;
        }
      },
      true
    );

    item.parentElement.insertBefore(entry, item.nextSibling);
  }

  function start() {
    removeLegacyEntries();
    installEventGuard();
    installEntry();
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      installEntry();
      if (document.getElementById(ITEM_ID) || tries > 60) {
        window.clearInterval(timer);
      }
    }, 250);

    const observer = new MutationObserver(() => {
      installEntry();
      scheduleObservedRestore();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
