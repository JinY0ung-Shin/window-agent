const http = require('node:http');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');

// --- State ---
let browser = null;
const sessions = new Map(); // session_id -> { context, page, refMap }

// --- Snapshot Engine ---

// Track selectors: each ref gets a unique selector using getByRole + nth for disambiguation
const selectorCounts = new Map();

function buildSelector(node, role, name) {
  // Build a key that uniquely identifies this role+name combination
  const key = name ? `${role}::${name}` : `${role}::__no_name__`;

  // Track occurrences for disambiguation
  const count = (selectorCounts.get(key) || 0);
  selectorCounts.set(key, count + 1);

  if (name) {
    const escapedName = name.replace(/"/g, '\\"');
    if (count > 0) {
      return `role=${role}[name="${escapedName}"] >> nth=${count}`;
    }
    return `role=${role}[name="${escapedName}"]`;
  }
  // Unnamed elements with value: use getByRole with value-based text matching
  // This is more stable than pure nth which can drift if unnamed peers are skipped
  const value = node && node.value;
  if (value) {
    const escapedValue = String(value).replace(/"/g, '\\"');
    return `role=${role}[name="${escapedValue}"] >> nth=${count}`;
  }
  // Truly unnamed, no value: nth is the best we can do
  return `role=${role} >> nth=${count}`;
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'menuitem', 'tab', 'switch', 'searchbox', 'slider', 'spinbutton',
  'option', 'menuitemcheckbox', 'menuitemradio', 'treeitem',
]);

const STRUCTURAL_ROLES = new Set([
  'heading', 'img', 'navigation', 'main', 'banner', 'contentinfo',
]);

const MAX_ELEMENTS = 200;

async function generateSnapshot(page) {
  // Use CDP Accessibility.getFullAXTree since page.accessibility was removed in Playwright 1.50+
  let tree = null;
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    await cdp.send('Accessibility.disable');
    await cdp.detach();
    tree = buildTreeFromCDP(nodes);
  } catch (err) {
    log(`CDP accessibility failed: ${err.message}, falling back to empty tree`);
  }

  const refs = [];
  let refCounter = 1;
  selectorCounts.clear(); // Reset duplicate tracking for each snapshot

  function walk(node) {
    if (!node || refs.length >= MAX_ELEMENTS) return;

    const role = node.role || '';
    const name = node.name || '';
    const value = node.value || '';

    const isInteractive = INTERACTIVE_ROLES.has(role);
    const isStructural = STRUCTURAL_ROLES.has(role);

    if ((isInteractive || isStructural) && (name || value)) {
      const ref = refCounter++;
      const parts = [`[${ref}]`, role];
      if (name) parts.push(`"${name}"`);
      if (value) parts.push(`value="${value}"`);
      if (node.checked !== undefined) parts.push(node.checked ? '[checked]' : '[unchecked]');
      if (node.disabled) parts.push('[disabled]');

      refs.push({
        ref,
        text: parts.join(' '),
        selector: buildSelector(node, role, name),
        role,
        name,
        tag: node.tag || '',
        isPassword: !!(role === 'textbox' && (node.autocomplete === 'current-password' || node.isPassword)),
      });
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);

  const snapshotText = refs.map((r) => r.text).join('\n');
  const refMap = {};
  for (const r of refs) {
    refMap[r.ref] = {
      selector: r.selector,
      role: r.role,
      name: r.name,
      tag: r.tag,
      isPassword: r.isPassword,
    };
  }

  return { snapshotText, refMap, elementCount: refs.length };
}

// Convert CDP Accessibility.getFullAXTree flat node list into a tree structure
function buildTreeFromCDP(nodes) {
  if (!nodes || nodes.length === 0) return null;

  const nodeMap = new Map();
  for (const n of nodes) {
    const role = getProperty(n, 'role');
    const name = getProperty(n, 'name');
    const value = getProperty(n, 'value');
    const checked = getProperty(n, 'checked');
    const disabled = getProperty(n, 'disabled');

    nodeMap.set(n.nodeId, {
      role: role || 'none',
      name: name || '',
      value: value || '',
      checked: checked === 'true' ? true : checked === 'false' ? false : undefined,
      disabled: disabled === 'true',
      isPassword: n.role && n.role.value === 'textbox' && hasProperty(n, 'autocomplete', 'current-password'),
      children: [],
    });
  }

  // Build parent-child relationships
  for (const n of nodes) {
    const parent = nodeMap.get(n.nodeId);
    if (n.childIds) {
      for (const childId of n.childIds) {
        const child = nodeMap.get(childId);
        if (child) parent.children.push(child);
      }
    }
  }

  return nodeMap.get(nodes[0].nodeId) || null;
}

function getProperty(node, propName) {
  // CDP AX nodes have role, name, and value as top-level fields
  if (propName === 'name' && node.name) return node.name.value || '';
  if (propName === 'role' && node.role) return node.role.value || '';
  if (propName === 'value' && node.value) return node.value.value || '';

  if (!node.properties) return '';
  const prop = node.properties.find(p => p.name === propName);
  if (!prop) return '';
  return prop.value ? (prop.value.value || '') : '';
}

function hasProperty(node, propName, expectedValue) {
  if (!node.properties) return false;
  const prop = node.properties.find(p => p.name === propName);
  return prop && prop.value && prop.value.value === expectedValue;
}

// Exported for testing
module.exports = { generateSnapshot, buildResponse, buildSelector, buildTreeFromCDP, selectorCounts, INTERACTIVE_ROLES, STRUCTURAL_ROLES, MAX_ELEMENTS };

// --- Browser Management ---

const LAUNCH_ARGS = ['--no-first-run', '--no-default-browser-check'];

async function ensureBrowser() {
  if (!browser) {
    try {
      // 1st: Playwright bundled/downloaded Chromium
      browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
      log('Browser launched (Playwright Chromium)');
    } catch (err1) {
      log(`Playwright Chromium unavailable: ${err1.message}`);
      try {
        // 2nd: System Chrome fallback
        browser = await chromium.launch({ channel: 'chrome', headless: false, args: LAUNCH_ARGS });
        log('Browser launched (system Chrome)');
      } catch (err2) {
        log(`System Chrome also unavailable: ${err2.message}`);
        // 3rd: Runtime download as last resort
        await installChromiumRuntime();
        browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });
        log('Browser launched (freshly installed Chromium)');
      }
    }
  }
  return browser;
}

/**
 * Download Chromium at runtime via Playwright CLI.
 * Emits CHROMIUM_INSTALL_START/DONE/FAILED to stdout for the Rust host to parse.
 */
async function installChromiumRuntime() {
  const playwrightCli = require('path').join(__dirname, 'node_modules', 'playwright', 'cli.js');
  const fallbackPath = process.env.PLAYWRIGHT_BROWSERS_PATH_FALLBACK
    || process.env.PLAYWRIGHT_BROWSERS_PATH;

  process.stdout.write('CHROMIUM_INSTALL_START\n');
  try {
    execFileSync(process.execPath, [playwrightCli, 'install', 'chromium'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: fallbackPath },
      timeout: 300000, // 5 min
    });
    // Point Playwright to the freshly downloaded browsers
    process.env.PLAYWRIGHT_BROWSERS_PATH = fallbackPath;
    process.stdout.write('CHROMIUM_INSTALL_DONE\n');
  } catch (err) {
    process.stdout.write(`CHROMIUM_INSTALL_FAILED=${err.message}\n`);
    throw err;
  }
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

async function buildResponse(page, extra = {}) {
  const { snapshotText, refMap, elementCount } = await generateSnapshot(page);

  // Capture viewport screenshot as base64 PNG
  let screenshot = null;
  try {
    const buffer = await page.screenshot({ type: 'png' });
    screenshot = buffer.toString('base64');
  } catch (err) {
    // Screenshot failure is non-fatal
    log(`Screenshot failed: ${err.message}`);
  }

  return {
    success: true,
    url: page.url(),
    title: await page.title(),
    snapshot: snapshotText,
    ref_map: refMap,
    element_count: elementCount,
    screenshot,
    ...extra,
  };
}

// --- Method Handlers ---

const handlers = {
  async create_session({ session_id }) {
    if (!session_id) throw new Error('session_id is required');
    if (sessions.has(session_id)) throw new Error(`Session already exists: ${session_id}`);

    const b = await ensureBrowser();
    const context = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    sessions.set(session_id, { context, page, refMap: {} });
    log(`Session created: ${session_id}`);

    const response = await buildResponse(page);
    sessions.get(session_id).refMap = response.ref_map;
    return response;
  },

  async navigate({ session_id, params }) {
    const { url } = params || {};
    if (!url) throw new Error('params.url is required');

    const { page } = getSession(session_id);
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    const response = await buildResponse(page);
    sessions.get(session_id).refMap = response.ref_map;
    return response;
  },

  async snapshot({ session_id }) {
    const { page } = getSession(session_id);
    const response = await buildResponse(page);
    sessions.get(session_id).refMap = response.ref_map;
    return response;
  },

  async click({ session_id, params }) {
    const { ref } = params || {};
    if (ref === undefined || ref === null) throw new Error('params.ref is required');

    const session = getSession(session_id);
    const entry = session.refMap[String(ref)];
    if (!entry) throw new Error(`Ref ${ref} not found in current snapshot`);

    const { page } = session;
    const locator = page.locator(entry.selector);
    await locator.click({ timeout: 5000 });

    // Wait briefly for navigation or DOM changes
    await page.waitForTimeout(500);
    try {
      await page.waitForLoadState('load', { timeout: 2000 });
    } catch {
      // Ignore timeout — page may not navigate
    }

    const response = await buildResponse(page);
    session.refMap = response.ref_map;
    return response;
  },

  async type({ session_id, params }) {
    const { ref, text } = params || {};
    if (ref === undefined || ref === null) throw new Error('params.ref is required');
    if (text === undefined || text === null) throw new Error('params.text is required');

    const session = getSession(session_id);
    const entry = session.refMap[String(ref)];
    if (!entry) throw new Error(`Ref ${ref} not found in current snapshot`);

    if (entry.isPassword) {
      throw new Error('Cannot type into password fields for security reasons');
    }

    const { page } = session;
    const locator = page.locator(entry.selector);
    await locator.fill(String(text), { timeout: 5000 });

    const response = await buildResponse(page);
    session.refMap = response.ref_map;
    return response;
  },

  async wait({ session_id, params }) {
    const seconds = Math.min(Math.max((params && params.seconds) || 2, 0), 10);

    const { page } = getSession(session_id);
    await page.waitForTimeout(seconds * 1000);

    const response = await buildResponse(page);
    sessions.get(session_id).refMap = response.ref_map;
    return response;
  },

  async back({ session_id }) {
    const { page } = getSession(session_id);
    await page.goBack({ waitUntil: 'load', timeout: 10000 });

    const response = await buildResponse(page);
    sessions.get(session_id).refMap = response.ref_map;
    return response;
  },

  async close_session({ session_id }) {
    if (!session_id) throw new Error('session_id is required');
    const session = sessions.get(session_id);
    if (!session) throw new Error(`Session not found: ${session_id}`);

    await session.context.close();
    sessions.delete(session_id);
    log(`Session closed: ${session_id}`);

    return { success: true, message: `Session ${session_id} closed` };
  },

  async close() {
    for (const [id, session] of sessions) {
      try {
        await session.context.close();
      } catch {
        // Ignore close errors
      }
      sessions.delete(id);
    }
    if (browser) {
      await browser.close();
      browser = null;
    }
    log('All sessions and browser closed');
    return { success: true, message: 'Browser closed' };
  },
};

// --- HTTP Server ---

function log(msg) {
  process.stderr.write(`[sidecar] ${new Date().toISOString()} ${msg}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    // GET /health
    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // POST /execute
    if (req.method === 'POST' && req.url === '/execute') {
      const body = await readBody(req);
      const { method, session_id, params } = body;

      log(`${method} session=${session_id || 'N/A'}`);

      const handler = handlers[method];
      if (!handler) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: `Unknown method: ${method}` }));
        return;
      }

      const result = await handler({ session_id, params });
      res.end(JSON.stringify(result));
      return;
    }

    // Unknown route
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: 'Not found' }));
  } catch (err) {
    log(`Error: ${err.message}`);
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
});

// Only start server when run directly (not when required for tests)
if (require.main === module) {
  // Chromium availability is checked lazily in ensureBrowser() with a
  // 3-stage fallback (bundled → system Chrome → runtime download).
  // No pre-flight download here to avoid penalizing machines that already
  // have Chrome installed.
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    process.stdout.write(`SIDECAR_PORT=${port}\n`);
    log(`Listening on 127.0.0.1:${port}`);
  });

  // Graceful shutdown (outside async IIFE)
  process.on('SIGTERM', async () => {
    log('SIGTERM received, shutting down');
    try {
      await handlers.close();
    } catch {
      // Ignore
    }
    server.close(() => process.exit(0));
  });

  process.on('SIGINT', async () => {
    log('SIGINT received, shutting down');
    try {
      await handlers.close();
    } catch {
      // Ignore
    }
    server.close(() => process.exit(0));
  });
}
