const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildSelector, buildResponse, selectorCounts, INTERACTIVE_ROLES, STRUCTURAL_ROLES, buildTreeFromCDP } = require('../server');

describe('buildSelector', () => {
  beforeEach(() => {
    selectorCounts.clear();
  });

  it('builds role+name selector when name is present', () => {
    const sel = buildSelector({}, 'button', 'Submit');
    assert.equal(sel, 'role=button[name="Submit"]');
  });

  it('builds role-only+nth selector when name is empty', () => {
    const sel = buildSelector({}, 'textbox', '');
    assert.equal(sel, 'role=textbox >> nth=0');
  });

  it('escapes double quotes in name', () => {
    const sel = buildSelector({}, 'link', 'Say "hello"');
    assert.equal(sel, 'role=link[name="Say \\"hello\\""]');
  });

  it('disambiguates duplicate named elements with nth', () => {
    const sel1 = buildSelector({}, 'button', 'Delete');
    const sel2 = buildSelector({}, 'button', 'Delete');
    const sel3 = buildSelector({}, 'button', 'Delete');
    assert.equal(sel1, 'role=button[name="Delete"]');
    assert.equal(sel2, 'role=button[name="Delete"] >> nth=1');
    assert.equal(sel3, 'role=button[name="Delete"] >> nth=2');
  });

  it('disambiguates unnamed elements of same role', () => {
    const sel1 = buildSelector({}, 'textbox', '');
    const sel2 = buildSelector({}, 'textbox', '');
    assert.equal(sel1, 'role=textbox >> nth=0');
    assert.equal(sel2, 'role=textbox >> nth=1');
  });

  it('different names do not collide', () => {
    const sel1 = buildSelector({}, 'button', 'OK');
    const sel2 = buildSelector({}, 'button', 'Cancel');
    assert.equal(sel1, 'role=button[name="OK"]');
    assert.equal(sel2, 'role=button[name="Cancel"]');
  });
});

describe('role sets', () => {
  it('includes expected interactive roles', () => {
    for (const role of ['button', 'link', 'textbox', 'checkbox', 'combobox']) {
      assert.ok(INTERACTIVE_ROLES.has(role), `Missing interactive role: ${role}`);
    }
  });

  it('includes expected structural roles', () => {
    for (const role of ['heading', 'img', 'navigation', 'main']) {
      assert.ok(STRUCTURAL_ROLES.has(role), `Missing structural role: ${role}`);
    }
  });

  it('does not overlap interactive and structural', () => {
    for (const role of INTERACTIVE_ROLES) {
      assert.ok(!STRUCTURAL_ROLES.has(role), `Role ${role} appears in both sets`);
    }
  });
});

describe('buildTreeFromCDP', () => {
  it('builds tree from CDP node list', () => {
    const nodes = [
      { nodeId: '1', role: { value: 'WebArea' }, name: { value: '' }, childIds: ['2', '3'] },
      { nodeId: '2', role: { value: 'heading' }, name: { value: 'Title' }, childIds: [] },
      { nodeId: '3', role: { value: 'button' }, name: { value: 'Click' }, childIds: [] },
    ];
    const tree = buildTreeFromCDP(nodes);
    assert.equal(tree.role, 'WebArea');
    assert.equal(tree.children.length, 2);
    assert.equal(tree.children[0].role, 'heading');
    assert.equal(tree.children[0].name, 'Title');
    assert.equal(tree.children[1].role, 'button');
    assert.equal(tree.children[1].name, 'Click');
  });

  it('returns null for empty node list', () => {
    assert.equal(buildTreeFromCDP([]), null);
    assert.equal(buildTreeFromCDP(null), null);
  });
});

describe('snapshot generation (unit)', () => {
  const { generateSnapshot } = require('../server');

  // Mock page with CDP session support
  function mockPage(tree) {
    // Convert tree to CDP-style flat nodes
    const nodes = [];
    let nextId = 1;

    function flatten(node, parentId) {
      if (!node) return;
      const id = String(nextId++);
      const childIds = [];
      const cdpNode = {
        nodeId: id,
        role: { value: node.role || 'none' },
        name: { value: node.name || '' },
        childIds,
        properties: [],
      };
      if (node.value) cdpNode.value = { value: node.value };
      if (node.checked !== undefined) cdpNode.properties.push({ name: 'checked', value: { value: String(node.checked) } });
      if (node.disabled) cdpNode.properties.push({ name: 'disabled', value: { value: 'true' } });
      if (node.autocomplete) cdpNode.properties.push({ name: 'autocomplete', value: { value: node.autocomplete } });
      nodes.push(cdpNode);

      if (node.children) {
        for (const child of node.children) {
          const childId = String(nextId);
          childIds.push(childId);
          flatten(child);
        }
      }
    }

    if (tree) flatten(tree);

    return {
      context: () => ({
        newCDPSession: async () => ({
          send: async (method) => {
            if (method === 'Accessibility.getFullAXTree') return { nodes };
            return {};
          },
          detach: async () => {},
        }),
      }),
    };
  }

  it('assigns sequential ref numbers', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'heading', name: 'Title' },
        { role: 'link', name: 'Home' },
        { role: 'button', name: 'Click me' },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.equal(result.elementCount, 3);
    assert.ok(result.snapshotText.includes('[1] heading "Title"'));
    assert.ok(result.snapshotText.includes('[2] link "Home"'));
    assert.ok(result.snapshotText.includes('[3] button "Click me"'));
  });

  it('includes ref_map with selectors', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'button', name: 'OK' },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.equal(result.refMap['1'].role, 'button');
    assert.equal(result.refMap['1'].name, 'OK');
    assert.equal(result.refMap['1'].selector, 'role=button[name="OK"]');
    assert.equal(result.refMap['1'].isPassword, false);
  });

  it('includes value for inputs', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'textbox', name: 'Search', value: 'hello' },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.ok(result.snapshotText.includes('value="hello"'));
  });

  it('skips nodes without name or value', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'button', name: '' },
        { role: 'link', name: '' },
        { role: 'heading', name: 'Visible' },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.equal(result.elementCount, 1);
    assert.ok(result.snapshotText.includes('Visible'));
  });

  it('handles null tree gracefully (CDP returns empty)', async () => {
    const page = {
      context: () => ({
        newCDPSession: async () => ({
          send: async () => ({ nodes: [] }),
          detach: async () => {},
        }),
      }),
    };
    const result = await generateSnapshot(page);

    assert.equal(result.elementCount, 0);
    assert.equal(result.snapshotText, '');
  });

  it('handles CDP failure gracefully', async () => {
    const page = {
      context: () => ({
        newCDPSession: async () => { throw new Error('CDP unavailable'); },
      }),
    };
    const result = await generateSnapshot(page);

    assert.equal(result.elementCount, 0);
    assert.equal(result.snapshotText, '');
  });

  it('walks nested children', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        {
          role: 'navigation',
          name: 'Main Nav',
          children: [
            { role: 'link', name: 'Home' },
            { role: 'link', name: 'About' },
          ],
        },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.ok(result.elementCount >= 3);
    assert.ok(result.snapshotText.includes('navigation "Main Nav"'));
    assert.ok(result.snapshotText.includes('link "Home"'));
    assert.ok(result.snapshotText.includes('link "About"'));
  });
});

describe('buildResponse', () => {
  function mockPage(tree, screenshotResult = Buffer.from('fake-png')) {
    const nodes = [];
    let nextId = 1;

    function flatten(node) {
      if (!node) return;
      const id = String(nextId++);
      const childIds = [];
      nodes.push({
        nodeId: id,
        role: { value: node.role || 'none' },
        name: { value: node.name || '' },
        childIds,
        properties: [],
      });
      if (node.children) {
        for (const child of node.children) {
          childIds.push(String(nextId));
          flatten(child);
        }
      }
    }

    if (tree) flatten(tree);

    return {
      context: () => ({
        newCDPSession: async () => ({
          send: async (method) => {
            if (method === 'Accessibility.getFullAXTree') return { nodes };
            return {};
          },
          detach: async () => {},
        }),
      }),
      url: () => 'https://example.com',
      title: async () => 'Example',
      screenshot: async () => screenshotResult,
    };
  }

  it('includes screenshot as base64 string', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [{ role: 'button', name: 'OK' }],
    };
    const page = mockPage(tree);
    const result = await buildResponse(page);

    assert.equal(result.success, true);
    assert.equal(result.url, 'https://example.com');
    assert.equal(result.title, 'Example');
    assert.equal(typeof result.screenshot, 'string');
    assert.equal(result.screenshot, Buffer.from('fake-png').toString('base64'));
    assert.equal(result.element_count, 1);
  });

  it('returns null screenshot when capture fails', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [{ role: 'link', name: 'Home' }],
    };
    const page = mockPage(tree);
    page.screenshot = async () => { throw new Error('GPU error'); };
    const result = await buildResponse(page);

    assert.equal(result.success, true);
    assert.equal(result.screenshot, null);
    assert.equal(result.url, 'https://example.com');
    assert.equal(result.element_count, 1);
  });

  it('passes extra fields through', async () => {
    const tree = { role: 'WebArea', name: '', children: [] };
    const page = mockPage(tree);
    const result = await buildResponse(page, { custom: 'value' });

    assert.equal(result.custom, 'value');
    assert.equal(result.success, true);
  });
});
