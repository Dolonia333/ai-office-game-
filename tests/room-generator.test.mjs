/**
 * Tests for RoomGenerator — procedural room generation.
 * Uses Node.js built-in test runner (node:test) with ESM imports.
 * Run: node --experimental-detect-module --test tests/room-generator.test.mjs
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(__dirname, '..', 'data', 'furniture_catalog_openplan.json');
const catalogData = JSON.parse(readFileSync(catalogPath, 'utf8'));

const { RoomGenerator } = await import(join('file://', __dirname, '..', 'src', 'RoomGenerator.js'));

// ---------------------------------------------------------------------------
// Construction & Palette
// ---------------------------------------------------------------------------

describe('RoomGenerator construction', () => {
  it('creates from catalog data', () => {
    const gen = new RoomGenerator(catalogData);
    assert.ok(gen);
    assert.ok(gen.palette);
  });

  it('palette has grouped entries', () => {
    const gen = new RoomGenerator(catalogData);
    const p = gen.palette;
    assert.ok(p.desks.length > 0, 'should have desks');
    assert.ok(p.chairs.length > 0, 'should have chairs');
    assert.ok(p.deskSetups.length > 0, 'should have desk setups');
    assert.ok(p.plants.length > 0, 'should have plants');
  });
});

// ---------------------------------------------------------------------------
// Generation — all archetypes produce items
// ---------------------------------------------------------------------------

describe('RoomGenerator archetypes', () => {
  let gen;
  before(() => { gen = new RoomGenerator(catalogData); });

  for (const purpose of ['workspace', 'conference', 'breakroom', 'manager_office', 'reception', 'storage']) {
    it(`generates items for "${purpose}"`, () => {
      const tpl = gen.generate({ purpose, occupants: 4 });
      assert.ok(tpl.items.length > 0, `${purpose} should produce items`);
      assert.ok(tpl.description, 'should have a description');
    });
  }

  it('unknown purpose falls back to workspace', () => {
    const tpl = gen.generate({ purpose: 'banana' });
    assert.ok(tpl.items.length > 0, 'fallback should still produce items');
  });
});

// ---------------------------------------------------------------------------
// Workspace scaling
// ---------------------------------------------------------------------------

describe('workspace scaling', () => {
  let gen;
  before(() => { gen = new RoomGenerator(catalogData); });

  it('workspace has desks and chairs for each occupant', () => {
    // Run multiple attempts because generation is randomised
    let bestDesks = 0;
    let bestChairs = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const tpl = gen.generate({ purpose: 'workspace', occupants: 4, width: 512, height: 512 });
      const desks = tpl.items.filter(i => /desk|cubicle/.test(i.id) && !/setup|monitor/.test(i.id));
      const chairs = tpl.items.filter(i => /chair/.test(i.id));
      bestDesks = Math.max(bestDesks, desks.length);
      bestChairs = Math.max(bestChairs, chairs.length);
    }
    assert.ok(bestDesks >= 3, `should have at least 3 desks, got ${bestDesks}`);
    assert.ok(bestChairs >= 3, `should have at least 3 chairs, got ${bestChairs}`);
  });

  it('more occupants → more items', () => {
    const small = gen.generate({ purpose: 'workspace', occupants: 2, width: 384, height: 384 });
    const big = gen.generate({ purpose: 'workspace', occupants: 8, width: 768, height: 768 });
    assert.ok(big.items.length > small.items.length,
      `8 occupants (${big.items.length}) should produce more items than 2 (${small.items.length})`);
  });
});

// ---------------------------------------------------------------------------
// Template integrity
// ---------------------------------------------------------------------------

describe('template integrity', () => {
  let gen;
  before(() => { gen = new RoomGenerator(catalogData); });

  it('all item IDs exist in catalog', () => {
    const tpl = gen.generate({ purpose: 'workspace', occupants: 6 });
    const catalogIds = new Set(Object.keys(catalogData.objects));
    for (const item of tpl.items) {
      assert.ok(catalogIds.has(item.id), `"${item.id}" not found in catalog`);
    }
  });

  it('no duplicate instanceIds', () => {
    const tpl = gen.generate({ purpose: 'workspace', occupants: 6 });
    const ids = tpl.items.map(i => i.instanceId);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'all instanceIds should be unique');
  });

  it('decor parentInstanceIds reference valid items', () => {
    const tpl = gen.generate({ purpose: 'workspace', occupants: 4 });
    const allIds = new Set(tpl.items.map(i => i.instanceId));
    for (const item of tpl.items) {
      if (item.parentInstanceId) {
        assert.ok(allIds.has(item.parentInstanceId),
          `parentInstanceId "${item.parentInstanceId}" on "${item.id}" not found`);
      }
    }
  });

  it('respects custom dimensions', () => {
    const tpl = gen.generate({ purpose: 'storage', width: 640, height: 480 });
    assert.ok(tpl.description.includes('640x480'), 'description should show custom dimensions');
  });
});

// ---------------------------------------------------------------------------
// Integration — generateAndRegister
// ---------------------------------------------------------------------------

describe('generateAndRegister', () => {
  it('registers template with fake assembly', () => {
    const gen = new RoomGenerator(catalogData);
    const fakeAssembly = { templates: {} };
    const name = gen.generateAndRegister(fakeAssembly, { purpose: 'conference', occupants: 6 }, 'test_room');
    assert.equal(name, 'test_room');
    assert.ok(fakeAssembly.templates['test_room']);
    assert.ok(fakeAssembly.templates['test_room'].items.length > 0);
  });
});
