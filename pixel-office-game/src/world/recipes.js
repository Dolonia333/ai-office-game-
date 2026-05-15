// Recipe loader: discovers and indexes scene recipes for rooms/interiors.
// This stays engine-agnostic; Phaser-specific work happens in renderer/furnisher.

// NOTE: Browsers here don't support JSON module import assertions, so we
// inline the recipe contents that mirror the JSON files in data/scene_recipes_*.json.

const openplanBullpenRecipe = {
  id: 'modern_office_openplan_bullpen_v1',
  theme: 'modern_office',
  roomType: 'openplan_bullpen',
  tileSize: 16,
  size: { w: 40, h: 24 },
  palette: {
    floor: 'office_floor_light',
    wall: 'office_wall_white',
    carpet: 'office_rug_blue'
  },
  prefabs: [
    { id: 'desk_cluster_2x2', from: 'interiors', kind: 'furniture' },
    { id: 'office_chair', from: 'interiors', kind: 'seat', action: 'sit' },
    { id: 'pc_monitor', from: 'office', kind: 'device', action: 'use_pc' },
    { id: 'plant_pot_small', from: 'interiors', kind: 'decor' },
    { id: 'whiteboard_wall', from: 'office', kind: 'wall_decor' },
    { id: 'bookshelf', from: 'interiors', kind: 'furniture' },
    { id: 'water_dispenser', from: 'office', kind: 'utility' },
    { id: 'printer_large', from: 'office', kind: 'utility' }
  ],
  layout: {
    deskRows: [
      {
        rowIndex: 0,
        start: { x: 4, y: 6 },
        count: 5,
        spacing: { x: 4, y: 0 },
        attach: {
          chair: { prefab: 'office_chair', anchor: 'chair_1' },
          monitor: { prefab: 'pc_monitor', anchor: 'pc_1' },
          plant: { prefab: 'plant_pot_small', anchor: 'pc_2', frequency: 0.3 }
        }
      },
      {
        rowIndex: 1,
        start: { x: 4, y: 12 },
        count: 5,
        spacing: { x: 4, y: 0 },
        attach: {
          chair: { prefab: 'office_chair', anchor: 'chair_2' },
          monitor: { prefab: 'pc_monitor', anchor: 'pc_2' }
        }
      }
    ],
    wallDecor: [
      {
        prefab: 'whiteboard_wall',
        side: 'top',
        offsetTiles: { x: 10 },
        repeat: 1
      }
    ],
    utilities: [
      { prefab: 'water_dispenser', pos: { x: 2, y: 18 } },
      { prefab: 'printer_large', pos: { x: 32, y: 18 } }
    ]
  },
  spawnPoints: {
    player: { x: 6, y: 20 },
    npcs: [
      { role: 'worker', x: 8, y: 8 },
      { role: 'worker', x: 20, y: 8 },
      { role: 'manager', x: 10, y: 5 }
    ]
  }
};

const receptionRecipe = {
  id: 'modern_office_reception_v1',
  theme: 'modern_office',
  roomType: 'reception_lobby',
  tileSize: 16,
  size: { w: 32, h: 20 },
  palette: {
    floor: 'office_floor_light',
    wall: 'office_wall_white',
    carpet: 'office_rug_dark'
  },
  prefabs: [
    { id: 'reception_counter', from: 'office', kind: 'counter' },
    { id: 'office_chair', from: 'interiors', kind: 'seat', action: 'sit' },
    { id: 'waiting_chair', from: 'interiors', kind: 'seat', action: 'sit' },
    { id: 'pc_monitor', from: 'office', kind: 'device', action: 'use_pc' },
    { id: 'plant_pot_tall', from: 'interiors', kind: 'decor' },
    { id: 'wall_logo_panel', from: 'office', kind: 'wall_decor' },
    { id: 'info_poster', from: 'office', kind: 'wall_decor' },
    { id: 'coffee_table_small', from: 'interiors', kind: 'table' },
    { id: 'magazine_stack', from: 'interiors', kind: 'decor' },
    { id: 'door_glass_double', from: 'exteriors', kind: 'door' }
  ],
  layout: {
    receptionDesk: {
      counter: {
        prefab: 'reception_counter',
        start: { x: 8, y: 6 },
        lengthTiles: 10,
        orientation: 'horizontal'
      },
      frontChairs: [
        {
          prefab: 'waiting_chair',
          start: { x: 9, y: 10 },
          count: 3,
          spacing: { x: 3, y: 0 },
          facing: 'up'
        }
      ],
      staff: [
        {
          role: 'receptionist',
          chairPrefab: 'office_chair',
          pos: { x: 13, y: 7 },
          facing: 'down',
          attach: {
            monitor: {
              prefab: 'pc_monitor',
              offsetPixels: { x: 0, y: -16 }
            }
          }
        }
      ]
    },
    waitingArea: {
      seats: [
        {
          prefab: 'waiting_chair',
          start: { x: 4, y: 12 },
          count: 4,
          spacing: { x: 2, y: 0 },
          facing: 'up'
        },
        {
          prefab: 'waiting_chair',
          start: { x: 22, y: 12 },
          count: 4,
          spacing: { x: 2, y: 0 },
          facing: 'up'
        }
      ],
      tables: [
        {
          prefab: 'coffee_table_small',
          pos: { x: 8, y: 14 },
          attach: [
            { prefab: 'magazine_stack', offsetPixels: { x: 0, y: -4 } }
          ]
        },
        {
          prefab: 'coffee_table_small',
          pos: { x: 24, y: 14 },
          attach: [
            { prefab: 'magazine_stack', offsetPixels: { x: 0, y: -4 } }
          ]
        }
      ]
    },
    decor: {
      plants: [
        { prefab: 'plant_pot_tall', pos: { x: 3, y: 6 } },
        { prefab: 'plant_pot_tall', pos: { x: 29, y: 6 } }
      ],
      wallArt: [
        {
          prefab: 'wall_logo_panel',
          side: 'top',
          offsetTiles: { x: 14 },
          repeat: 1
        },
        {
          prefab: 'info_poster',
          side: 'right',
          offsetTiles: { y: 8 },
          repeat: 2,
          spacing: 2
        }
      ]
    },
    doors: [
      {
        prefab: 'door_glass_double',
        side: 'bottom',
        offsetTiles: { x: 14 }
      }
    ]
  },
  spawnPoints: {
    player: { x: 14, y: 17 },
    npcs: [
      { role: 'receptionist', x: 13, y: 7 },
      { role: 'visitor', x: 10, y: 13 },
      { role: 'visitor', x: 22, y: 13 }
    ]
  }
};

const smallOfficeRecipe = {
  id: 'modern_office_small_office_v1',
  theme: 'modern_office',
  roomType: 'small_office',
  tileSize: 16,
  size: { w: 20, h: 14 },
  palette: {
    floor: 'office_floor_light',
    wall: 'office_wall_plain'
  },
  prefabs: [
    { id: 'desk_cluster_2x2', from: 'interiors', kind: 'furniture' },
    { id: 'office_chair', from: 'interiors', kind: 'seat', action: 'sit' },
    { id: 'pc_monitor', from: 'interiors', kind: 'device', action: 'use_pc' },
    { id: 'plant_pot', from: 'interiors', kind: 'decor' },
    { id: 'bookshelf', from: 'interiors', kind: 'furniture' },
    { id: 'printer', from: 'interiors', kind: 'furniture' }
  ],
  layout: {
    deskArea: {
      desk: {
        prefab: 'desk_cluster_2x2',
        pos: { x: 10, y: 7 }
      },
      chair: {
        prefab: 'office_chair',
        anchor: 'chair_1'
      },
      pc: {
        prefab: 'pc_monitor',
        anchor: 'pc_1'
      }
    },
    sideFurniture: [
      {
        prefab: 'bookshelf',
        pos: { x: 15, y: 4 }
      },
      {
        prefab: 'printer',
        pos: { x: 5, y: 9 }
      }
    ],
    decor: [
      {
        prefab: 'plant_pot',
        pos: { x: 4, y: 5 }
      }
    ]
  },
  spawnPoints: {
    player: { x: 10, y: 11 },
    npcs: [
      { role: 'manager', x: 12, y: 7 }
    ]
  }
};

const targetOfficeRecipe = {
  id: 'modern_office_target_office_v1',
  theme: 'modern_office',
  roomType: 'target_office',
  tileSize: 16,
  size: { w: 32, h: 20 },
  palette: {
    floor: 'office_floor_light',
    wall: 'office_wall_plain'
  },
  prefabs: [
    { id: 'desk_cluster_2x2', from: 'interiors', kind: 'furniture' },
    { id: 'office_chair', from: 'interiors', kind: 'seat', action: 'sit' },
    { id: 'pc_monitor', from: 'interiors', kind: 'device', action: 'use_pc' },
    { id: 'plant_pot', from: 'interiors', kind: 'decor' },
    { id: 'bookshelf', from: 'interiors', kind: 'furniture' },
    { id: 'water_cooler', from: 'interiors', kind: 'utility' },
    { id: 'printer', from: 'interiors', kind: 'furniture' }
  ],
  layout: {
    deskRows: [
      {
        rowIndex: 0,
        start: { x: 4, y: 8 },
        count: 3,
        spacing: { x: 6, y: 0 },
        attach: {
          chair: { prefab: 'office_chair', anchor: 'chair_1' },
          monitor: { prefab: 'pc_monitor', anchor: 'pc_1' }
        }
      },
      {
        rowIndex: 1,
        start: { x: 4, y: 14 },
        count: 3,
        spacing: { x: 6, y: 0 },
        attach: {
          chair: { prefab: 'office_chair', anchor: 'chair_1' },
          monitor: { prefab: 'pc_monitor', anchor: 'pc_1' }
        }
      }
    ],
    sideFurniture: [
      { prefab: 'bookshelf', pos: { x: 26, y: 6 } },
      { prefab: 'water_cooler', pos: { x: 26, y: 18 } },
      { prefab: 'printer', pos: { x: 14, y: 3 } }
    ],
    decor: [
      { prefab: 'plant_pot', pos: { x: 20, y: 4 } },
      { prefab: 'plant_pot', pos: { x: 2, y: 18 } }
    ]
  },
  spawnPoints: {
    player: { x: 16, y: 16 },
    npcs: [
      { role: 'worker', x: 6, y: 10 },
      { role: 'worker', x: 16, y: 10 }
    ]
  }
};


const referenceOfficeRecipe = {
  id: 'reference_office_small_v1',
  theme: 'modern_office',
  roomType: 'reference_office',
  tileSize: 16,
  size: { w: 24, h: 16 },
  palette: {
    floor: 'office_floor_light',
    wall: 'office_wall_white'
  },
  prefabs: smallOfficeRecipe.prefabs,
  layout: {
    deskArea: {
      desk: {
        prefab: 'desk_cluster_2x2',
        pos: { x: 15, y: 6 }
      },
      chair: {
        prefab: 'office_chair',
        anchor: 'chair_1'
      },
      pc: {
        prefab: 'pc_monitor',
        anchor: 'pc_1'
      }
    },
    sideFurniture: [
      {
        prefab: 'bookshelf',
        pos: { x: 20, y: 3 }
      },
      {
        prefab: 'printer',
        pos: { x: 18, y: 9 }
      }
    ],
    decor: [
      {
        prefab: 'plant_pot',
        pos: { x: 21, y: 9 }
      }
    ],
    waitingArea: {
      seats: [
        {
          prefab: 'office_chair',
          start: { x: 4, y: 12 },
          count: 3,
          spacing: { x: 2, y: 0 },
          facing: 'up'
        }
      ]
    }
  },
  spawnPoints: {
    player: { x: 6, y: 13 },
    npcs: [{ role: 'worker', x: 15, y: 7 }]
  }
};

const allRecipes = [openplanBullpenRecipe, receptionRecipe, smallOfficeRecipe, referenceOfficeRecipe, targetOfficeRecipe];

/**
 * Build an index of recipes by id and by (theme, roomType).
 */
export function buildRecipeIndex() {
  const byId = new Map();
  const byThemeType = new Map(); // key = `${theme}:${roomType}`

  for (const r of allRecipes) {
    if (!r || !r.id) continue;
    byId.set(r.id, r);
    const theme = r.theme || 'default';
    const roomType = r.roomType || 'generic';
    const key = `${theme}:${roomType}`;
    if (!byThemeType.has(key)) byThemeType.set(key, []);
    byThemeType.get(key).push(r);
  }

  return { byId, byThemeType };
}

/**
 * Pick a recipe for a given theme/roomType. Falls back to any recipe
 * with matching theme or to a random recipe if nothing matches exactly.
 */
export function pickRecipeForRoom(rng, index, theme, roomType) {
  const { byThemeType } = index;
  const exactKey = `${theme}:${roomType}`;
  const themeKey = `${theme}:generic`;

  let candidates = byThemeType.get(exactKey);
  if (!candidates || candidates.length === 0) {
    candidates = byThemeType.get(themeKey);
  }
  if (!candidates || candidates.length === 0) {
    // fallback: any recipe
    candidates = Array.from(byThemeType.values()).flat();
  }
  if (!candidates || candidates.length === 0) return null;

  const pick = rng.pick ? rng.pick(candidates) : candidates[0];
  return pick || null;
}

