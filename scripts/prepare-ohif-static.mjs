import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const OHIF_APP_VERSION = "3.12.5"
const PUBLIC_PATH = "/ohif-viewer/"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const tmpDir = join(root, ".tmp-ohif")
const outputDir = join(root, "public", "ohif-viewer")

rmSync(tmpDir, { force: true, recursive: true })
mkdirSync(tmpDir, { recursive: true })
mkdirSync(dirname(outputDir), { recursive: true })

const packOutput = execFileSync(
  "npm",
  ["pack", `@ohif/app@${OHIF_APP_VERSION}`, "--pack-destination", tmpDir, "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
)

const [{ filename }] = JSON.parse(packOutput)
const tarball = join(tmpDir, filename)
execFileSync("tar", ["-xzf", tarball, "-C", tmpDir], { stdio: "inherit" })

rmSync(outputDir, { force: true, recursive: true })
cpSync(join(tmpDir, "package", "dist"), outputDir, { recursive: true })

patchIndexHtml(join(outputDir, "index.html"))
patchAppBundle(outputDir)
patchAppConfig(join(outputDir, "app-config.js"))
removeSourceMaps(outputDir)

rmSync(tmpDir, { force: true, recursive: true })
console.log(`OHIF ${OHIF_APP_VERSION} static build prepared at ${outputDir}`)

function patchIndexHtml(filePath) {
  let html = readFileSync(filePath, "utf8")
  html = html.replaceAll("window.PUBLIC_URL = '/';", `window.PUBLIC_URL = '${PUBLIC_PATH}';`)
  html = html.replace(/(href|src)="\/(?!\/)/g, `$1="${PUBLIC_PATH}`)
  html = html.replace(
    /<script rel="preload" as="script" type="module" src="\/ohif-viewer\/init-service-worker\.js"><\/script>/,
    ""
  )
  html = html.replace("<title>OHIF Viewer</title>", "<title>RAI OHIF Viewer</title>")
  html = injectRaiReturnButton(html)
  writeFileSync(filePath, html)
}

function injectRaiReturnButton(html) {
  const marker = "rai-ohif-return-button"
  if (html.includes(marker)) return html

  const style = `
<style>
  .${marker} {
    align-items: center;
    background: #0f766e;
    border: 1px solid rgba(103, 232, 249, 0.35);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
    color: #fff;
    display: none;
    font: 700 13px/1.1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    gap: 7px;
    padding: 9px 12px;
    position: fixed;
    right: 14px;
    text-decoration: none;
    top: 10px;
    z-index: 2147483647;
  }

  .${marker}:hover {
    background: #0d9488;
  }
</style>`

  const script = `
<script>
  (function () {
    var params = new URLSearchParams(window.location.search);
    var rawReturnUrl = params.get("returnUrl");
    if (!rawReturnUrl) return;

    var target;
    try {
      target = new URL(rawReturnUrl, window.location.origin);
    } catch (_) {
      return;
    }

    var allowedOrigins = [
      window.location.origin,
      "https://app.raipacs.com",
      "http://localhost:4174",
      "http://127.0.0.1:4174",
    ];

    if (allowedOrigins.indexOf(target.origin) === -1 || !target.pathname.startsWith("/viewer/")) return;

    var link = document.createElement("a");
    link.className = "${marker}";
    link.href = target.href;
    link.textContent = "RAI Viewer";
    link.setAttribute("aria-label", "RAI Viewer'a don");
    link.style.display = "inline-flex";
    document.addEventListener("DOMContentLoaded", function () {
      document.body.appendChild(link);
    });
  })();
</script>`

  if (html.includes("</head>")) {
    html = html.replace("</head>", `${style}\n</head>`)
  }
  return html.includes("</body>")
    ? html.replace("</body>", `${script}\n</body>`)
    : `${html}\n${style}\n${script}`
}

function patchAppBundle(dirPath) {
  const bundleName = findFile(dirPath, /^app\.bundle\..+\.js$/)
  const bundlePath = join(dirPath, bundleName)
  let bundle = readFileSync(bundlePath, "utf8")
  bundle = bundle.replace('__webpack_require__.p = "/";', `__webpack_require__.p = "${PUBLIC_PATH}";`)
  writeFileSync(bundlePath, bundle)
}

function patchAppConfig(filePath) {
  let config = readFileSync(filePath, "utf8")
  config = config.replace("routerBasename: null,", "routerBasename: '/ohif-viewer',")
  config = config.replace("showWarningMessageForCrossOrigin: true,", "showWarningMessageForCrossOrigin: false,")
  config = config.replace(
    "  customizationService: {},",
    "  customizationService: {},\n  investigationalUseDialog: { option: 'never' },"
  )

  // The upstream config keeps dynamic config commented out. RAI enables it so
  // /ohif/config can later become the primary datasource contract for self-host OHIF.
  if (!/^\s{2}dangerouslyUseDynamicConfig:\s*\{/m.test(config)) {
    config = config.replace(
      "  dataSources: [",
      "  dangerouslyUseDynamicConfig: {\n    enabled: true,\n    regex: /^(https:\\/\\/(app|ohif)\\.raipacs\\.com|http:\\/\\/localhost:4174|http:\\/\\/127\\.0\\.0\\.1:4174)\\/ohif\\/config\\?token=.+/,\n  },\n  dataSources: ["
    )
  }
  writeFileSync(filePath, config)
}

function findFile(dirPath, pattern) {
  const files = execFileSync("find", [dirPath, "-maxdepth", "1", "-type", "f"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)

  const match = files.map((file) => file.split("/").pop()).find((file) => pattern.test(file))
  if (!match || !existsSync(join(dirPath, match))) {
    throw new Error(`OHIF bundle file not found for pattern ${pattern}`)
  }
  return match
}

function removeSourceMaps(dirPath) {
  const sourceMaps = execFileSync("find", [dirPath, "-type", "f", "-name", "*.map"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)

  for (const sourceMap of sourceMaps) {
    rmSync(sourceMap, { force: true })
  }
}
