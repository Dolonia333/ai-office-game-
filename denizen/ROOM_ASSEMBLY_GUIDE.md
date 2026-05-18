# Room Assembly System — Implementation Guide

This guide shows you how to use the complete room rendering pipeline to build perfect offices without broken sprites.

---

## System Overview

Three components work together:

1. **sprite-assembly-system.json** — Complete sprite inventory with coordinates, z-index, and modular grouping rules
2. **room-templates.json** — Pre-built room layouts (cubicle pod, breakroom, CEO office, etc.)
3. **RoomAssembly.js** — Phaser scene integration that validates and renders templates

**Flow:**
```
room-templates.json
        ↓ (load template)
RoomAssembly.validateTemplate()
        ↓ (validate modular groups & sprites)
RoomAssembly.renderRoom()
        ↓ (render each layer in Z order)
Perfect Office Scene ✓
```

---

## Quick Start: Render a Cubicle Pod

### Step 1: Initialize in your Phaser scene

```javascript
import { RoomAssembly } from './src/city/RoomAssembly.js';

class OfficeScene extends Phaser.Scene {
  preload() {
    // Load assembly system and templates
    this.load.json('spriteAssembly', './data/sprite-assembly-system.json');
    this.load.json('roomTemplates', './data/room-templates.json');
  }

  create() {
    const spriteAssembly = this.cache.json.get('spriteAssembly');
    const roomTemplates = this.cache.json.get('roomTemplates');

    // Create room assembly
    this.roomAssembly = new RoomAssembly(
      this,
      spriteAssembly,
      roomTemplates
    );

    // Initialize sprite registry
    this.roomAssembly.initializeSpriteRegistry();

    // Render cubicle pod
    const room = this.roomAssembly.renderRoom('cubicle_pod_4person', {
      offsetX: 100,
      offsetY: 100,
      debug: true  // Show console logs
    });

    if (room) {
      console.log('✅ Room rendered successfully');
      console.log(this.roomAssembly.getRoomStats('cubicle_pod_4person'));
    }
  }
}
```

### Step 2: Check validation results

```javascript
// Get room statistics
const stats = this.roomAssembly.getRoomStats('cubicle_pod_4person');

console.log(stats);
// Output:
// {
//   templateName: 'cubicle_pod_4person',
//   roomName: '4-Person Cubicle Pod (Snake Layout)',
//   totalSprites: 24,
//   dimensions: { width: 256, height: 256 },
//   byType: {
//     floor_tile_grey_grid: 1,
//     office_chair_orange_back: 2,
//     office_chair_orange_front: 2,
//     desk_tan_horizontal: 4,
//     cubicle_divider_horizontal: 2,
//     ...
//   },
//   byZIndex: {
//     '0': 1,  // Floor
//     '1': 4,  // Chairs
//     '2': 4,  // Desks
//     '3': 6,  // Dividers & end-caps
//     '4': 4   // Monitors
//   }
// }
```

---

## Available Templates

### 1. **cubicle_pod_4person** ⭐
Standard 4-person cubicle with privacy dividers and dual monitors.
- **Dimensions:** 256×256 px
- **Sprites:** 24 items
- **Modular Groups:** pod_4person (CRITICAL validations)
- **Best for:** Typical office workspace

```javascript
this.roomAssembly.renderRoom('cubicle_pod_4person');
```

### 2. **breakroom_sofa**
Casual seating with 3-piece sofa, coffee table, water cooler, and plant.
- **Dimensions:** 384×256 px
- **Sprites:** 6 items
- **Modular Groups:** sofa_tan_3piece (left + middle + right = REQUIRED)
- **Best for:** Employee breaks

```javascript
this.roomAssembly.renderRoom('breakroom_sofa');
```

### 3. **ceo_office**
Large executive office with premium desk, visitor seating, triple monitors, bookshelf, and art.
- **Dimensions:** 384×384 px
- **Sprites:** 11 items
- **Modular Groups:** bookshelf_tall (top + bottom = REQUIRED)
- **Best for:** Executive suite

```javascript
this.roomAssembly.renderRoom('ceo_office');
```

### 4. **vending_corridor**
Small utility area with drink machine, snack machine, and water cooler.
- **Dimensions:** 256×256 px
- **Sprites:** 3 utility items
- **Best for:** Breakroom alcove

```javascript
this.roomAssembly.renderRoom('vending_corridor');
```

### 5. **open_workspace**
Large floor plan with multiple desk clusters, decor, and utilities.
- **Dimensions:** 512×512 px
- **Sprites:** 16+ items
- **Best for:** Open office layout

```javascript
this.roomAssembly.renderRoom('open_workspace');
```

---

## Common Patterns

### Pattern 1: Layout Multiple Rooms

```javascript
// Create a multi-room office
const rooms = [
  { template: 'cubicle_pod_4person', offsetX: 0, offsetY: 0 },
  { template: 'cubicle_pod_4person', offsetX: 300, offsetY: 0 },
  { template: 'breakroom_sofa', offsetX: 0, offsetY: 300 },
  { template: 'vending_corridor', offsetX: 300, offsetY: 300 }
];

rooms.forEach(roomConfig => {
  const room = this.roomAssembly.renderRoom(
    roomConfig.template,
    {
      offsetX: roomConfig.offsetX,
      offsetY: roomConfig.offsetY
    }
  );

  if (room) {
    console.log(`✅ Rendered: ${room.name}`);
  }
});
```

### Pattern 2: List Available Templates

```javascript
const templates = this.roomAssembly.listTemplates();

console.table(templates);
// Output:
// ┌─────────────────────────┬────────────────────────────────────┬──────────────┐
// │ id                      │ name                               │ itemCount    │
// ├─────────────────────────┼────────────────────────────────────┼──────────────┤
// │ cubicle_pod_4person     │ 4-Person Cubicle Pod (Snake Layout)│ 20           │
// │ breakroom_sofa          │ Breakroom with Sofa & Table        │ 6            │
// │ ceo_office              │ Executive Office                   │ 11           │
// │ vending_corridor        │ Vending Machine Alcove             │ 3            │
// │ open_workspace          │ Open Floor Plan                    │ 16           │
// └─────────────────────────┴────────────────────────────────────┴──────────────┘
```

### Pattern 3: Debug Validation Failures

```javascript
const template = this.roomAssembly.loadTemplate('my_custom_room');
const validation = this.roomAssembly.validateTemplate(template);

if (!validation.valid) {
  console.error('❌ Validation failed:');

  // Check for missing sprites
  if (!validation.registry.valid) {
    console.error('Missing sprites:', validation.registry.missing);
  }

  // Check for broken modular groups
  if (!validation.modular.valid) {
    validation.modular.errors.forEach(err => {
      console.error(`Broken group "${err.group}": missing ${err.missing.join(', ')}`);
      console.error(`Fix: ${err.breaking_rule}`);
    });
  }
}
```

---

## Creating Custom Room Templates

To add your own room template:

1. **Add to room-templates.json**:
```json
{
  "templates": {
    "my_custom_office": {
      "name": "My Custom Office",
      "description": "Description of the room",
      "dimensions": { "width": 512, "height": 512 },
      "z_sortable": true,
      "items": [
        {
          "type": "floor",
          "sprite_id": "floor_tile_grey_grid",
          "x": 0, "y": 0,
          "width": 512, "height": 512,
          "z_index": 0
        },
        {
          "type": "seat",
          "sprite_id": "office_chair_orange_back",
          "x": 100, "y": 100,
          "z_index": 1
        },
        {
          "type": "surface",
          "sprite_id": "desk_tan_horizontal",
          "x": 100, "y": 32,
          "z_index": 2
        },
        {
          "type": "desktop_item",
          "sprite_id": "monitor_dual_light_grey",
          "x": 100, "y": 32,
          "y_offset": -15,
          "z_index": 4
        }
      ]
    }
  }
}
```

2. **Render it**:
```javascript
this.roomAssembly.renderRoom('my_custom_office');
```

3. **Validation will automatically**:
   - ✅ Check all sprites exist
   - ✅ Validate modular groups (sofas, bookshelves) are complete
   - ✅ Verify Z-index ordering
   - ✅ Report any issues

---

## Modular Group Rules (CRITICAL)

### Sofas (Must Have Ends)
```
INVALID: [sofa_middle]  →  Armless stump ❌
VALID:   [sofa_left, sofa_middle, sofa_right]  →  Perfect sofa ✓
VALID:   [sofa_left, sofa_middle, sofa_middle, sofa_right]  →  Longer sofa ✓
```

### Bookshelves (Must Be Stacked)
```
INVALID: [bookshelf_top]  →  Floating shelf ❌
INVALID: [bookshelf_bottom]  →  Missing top ❌
VALID:   [bookshelf_top @ (x, y), bookshelf_bottom @ (x, y+64)]  →  Complete shelf ✓
```

### Cubicles (Must Be Enclosed)
```
INVALID: [desk] (no dividers)  →  Exposed cubicle ❌
VALID:   [desk, divider_above, endcap_left, endcap_right]  →  Enclosed pod ✓
```

---

## Y-Offset Rules (Critical for Desktop Items)

Items that sit ON desks need a **Y-offset** so they don't float in the middle:

```
Desktop Item Rule:
  render_y = item.y + item.y_offset
  
Example:
  Desk at Y=100
  Monitor at Y=100, y_offset=-15
  Render Position Y = 100 + (-15) = 85  (appears 15px ABOVE desk baseline)
  Result: Monitor appears "sitting on top" of desk ✓
```

### Standard Y-Offsets by Item Type:
| Item Type | Y-Offset |
|-----------|----------|
| Monitor | -15px |
| Desk Lamp | -16px |
| Paper Stack | -12px |
| Coffee Cup | -10px |
| Money Pile | -20px |

---

## Z-Index Layer Reference

| Z-Index | Layer Name | Items | Purpose |
|---------|-----------|-------|---------|
| **0** | Floor | Floor tiles | Base walkable surface |
| **1** | Under-Furniture | Chairs (not sitting) | Below desks visually |
| **2** | Furniture | Desks, sofas, tables | Main surfaces |
| **3** | Partitions | Dividers, wall art, plants | Privacy & decor |
| **4** | Desktop Items | Monitors, lamps, clutter | Sitting on surfaces |
| **5** | Characters | NPCs, player | Walk in front of everything |

---

## Performance Tips

### Tip 1: Pre-render large rooms
```javascript
// Better: Render once
const room = this.roomAssembly.renderRoom('open_workspace');
// Don't re-render every frame
```

### Tip 2: Use offsets to tile rooms
```javascript
// Good: Re-use template, offset position
const pod1 = this.roomAssembly.renderRoom('cubicle_pod_4person', {
  offsetX: 0, offsetY: 0
});
const pod2 = this.roomAssembly.renderRoom('cubicle_pod_4person', {
  offsetX: 300, offsetY: 0
});
```

### Tip 3: Check validation early
```javascript
// Fail fast: Validate before rendering
const validation = this.roomAssembly.validateTemplate(template);
if (!validation.valid) {
  console.error('Fix template before rendering');
  return;
}
```

---

## Troubleshooting

### Issue: Monitors appear floating mid-desk
**Fix:** Ensure y_offset is set to -15 in template

### Issue: Sofa looks broken/armless
**Fix:** Ensure all 3 pieces (left, middle, right) are in template

### Issue: Bookshelf has a gap
**Fix:** Ensure Y offset between top and bottom is exactly 64px

### Issue: Sprite not found error
**Fix:** Check sprite_id matches exactly in sprite-assembly-system.json

### Issue: Wrong Z-order (chair in front of desk)
**Fix:** Chairs should be Z=1, desks Z=2, ensure chair has `"z_index": 1`

---

## Next Steps

1. ✅ Load sprite-assembly-system.json
2. ✅ Load room-templates.json
3. ✅ Create RoomAssembly instance
4. ✅ Call renderRoom() for desired layout
5. ✅ Check validation results
6. ✅ Add custom rooms as needed

**Result:** Perfectly assembled offices without broken sprites! 🎉
