const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildSelector, buildResponse, selectorCounts, INTERACTIVE_ROLES, STRUCTURAL_ROLES } = require('../server');

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

describe('snapshot generation (unit)', () => {
  // We test the snapshot logic by importing generateSnapshot and mocking a page object
  const { generateSnapshot } = require('../server');

  function mockPage(tree) {
    return {
      accessibility: {
        snapshot: async () => tree,
      },
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

  it('detects password fields', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'textbox', name: 'Password', autocomplete: 'current-password' },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.equal(result.refMap['1'].isPassword, true);
  });

  it('marks non-password textbox as not password', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'textbox', name: 'Username' },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.equal(result.refMap['1'].isPassword, false);
  });

  it('includes checked state for checkboxes', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'checkbox', name: 'Agree', checked: true },
        { role: 'checkbox', name: 'Newsletter', checked: false },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.ok(result.snapshotText.includes('[checked]'));
    assert.ok(result.snapshotText.includes('[unchecked]'));
  });

  it('includes disabled state', async () => {
    const tree = {
      role: 'WebArea',
      name: '',
      children: [
        { role: 'button', name: 'Submit', disabled: true },
      ],
    };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.ok(result.snapshotText.includes('[disabled]'));
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

  it('limits elements to 200', async () => {
    const children = [];
    for (let i = 0; i < 250; i++) {
      children.push({ role: 'button', name: `Btn ${i}` });
    }
    const tree = { role: 'WebArea', name: '', children };
    const page = mockPage(tree);
    const result = await generateSnapshot(page);

    assert.equal(result.elementCount, 200);
  });

  it('handles null tree gracefully', async () => {
    const page = mockPage(null);
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

    assert.equal(result.elementCount, 3);
    assert.ok(result.snapshotText.includes('[1] navigation "Main Nav"'));
    assert.ok(result.snapshotText.includes('[2] link "Home"'));
    assert.ok(result.snapshotText.includes('[3] link "About"'));
  });
});

describe('buildResponse', () => {
  function mockPage(tree, screenshotResult = Buffer.from('fake-png')) {
    return {
      accessibility: {
        snapshot: async () => tree,
      },
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
    // Other fields should still be populated
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
