/**
 * Pure-data tests for the city + interior generators. ESM because
 * src/city/* is `type: module`. These tests don't require Phaser — they
 * assert on the JSON the generators produce, which is what the adapter
 * later renders.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { generateCityChunk } = await import('../src/city/cityGenerator.js');
const { generateOfficeInterior } = await import('../src/city/interiorGenerator.js');
const { planCityZones } = await import('../src/city/planner.js');

describe('cityGenerator — shape', () => {
  it('produces a chunk with width/height/layers/buildings', () => {
    const chunk = generateCityChunk({ seed: 't', width: 32, height: 24, roadStride: 8 });
    assert.equal(chunk.width, 32);
    assert.equal(chunk.height, 24);
    assert.ok(Array.isArray(chunk.layers));
    assert.ok(Array.isArray(chunk.buildings));
  });

  it('every layer has a grid of expected dimensions', () => {
    const chunk = generateCityChunk({ seed: 't', width: 24, height: 16 });
    for (const layer of chunk.layers) {
      assert.equal(layer.width, 24);
      assert.equal(layer.height, 16);
      assert.ok(Array.isArray(layer.grid));
      assert.equal(layer.grid.length, 16);
      for (const row of layer.grid) {
        assert.equal(row.length, 24);
      }
    }
  });

  it('road layer has SOME tiles (not empty)', () => {
    const chunk = generateCityChunk({ seed: 'roadtest', width: 48, height: 48, roadStride: 8 });
    const roads = chunk.layers.find(l => l.id === 'roads');
    assert.ok(roads, 'roads layer present');
    let any = 0;
    for (const row of roads.grid) for (const cell of row) if (cell) any++;
    assert.ok(any > 0, 'should have placed at least one road tile');
  });

  it('larger chunks produce buildings (sanity: 64×48 has at least one)', () => {
    const chunk = generateCityChunk({ seed: 'b', width: 64, height: 48, roadStride: 12 });
    assert.ok(chunk.buildings.length > 0, `expected buildings, got ${chunk.buildings.length}`);
    const b = chunk.buildings[0];
    assert.ok(b.id);
    assert.ok(b.footprint || b.rect, 'building has a footprint or rect');
  });

  it('determinism: same seed → identical layers + buildings', () => {
    const a = generateCityChunk({ seed: 'X', width: 32, height: 24, roadStride: 8 });
    const b = generateCityChunk({ seed: 'X', width: 32, height: 24, roadStride: 8 });
    assert.deepEqual(a.layers, b.layers);
    assert.deepEqual(a.buildings, b.buildings);
  });

  it('different seeds → different layouts', () => {
    const a = generateCityChunk({ seed: 'one', width: 48, height: 48, roadStride: 8 });
    const b = generateCityChunk({ seed: 'two', width: 48, height: 48, roadStride: 8 });
    // Layer-equality should fail unless the seed RNG path is broken.
    assert.notDeepEqual(a, b);
  });
});

describe('interiorGenerator — shape', () => {
  it('produces an interior with rooms + furniture', () => {
    const interior = generateOfficeInterior({ seed: 'i', buildingId: 'b1', width: 24, height: 16 });
    assert.equal(interior.buildingId, 'b1');
    assert.ok(Array.isArray(interior.rooms) && interior.rooms.length > 0);
    assert.ok(Array.isArray(interior.furniture));
  });

  it('every furniture entry has a prefabId and (x, y)', () => {
    const { furniture } = generateOfficeInterior({ seed: 'i', buildingId: 'b1', width: 32, height: 24 });
    for (const f of furniture) {
      assert.equal(typeof f.prefabId, 'string');
      assert.equal(typeof f.x, 'number');
      assert.equal(typeof f.y, 'number');
    }
  });

  it('determinism: same (seed, buildingId) → identical furniture', () => {
    const a = generateOfficeInterior({ seed: 'k', buildingId: 'X', width: 20, height: 14 });
    const b = generateOfficeInterior({ seed: 'k', buildingId: 'X', width: 20, height: 14 });
    assert.deepEqual(a.furniture, b.furniture);
  });
});

describe('planner.planCityZones — pure', () => {
  it('returns gridW * gridH zones tagged with source=heuristic', () => {
    const plan = planCityZones({ seed: 's', gridW: 5, gridH: 3 });
    assert.equal(plan.zones.length, 15);
    assert.equal(plan.source, 'heuristic');
  });
});
