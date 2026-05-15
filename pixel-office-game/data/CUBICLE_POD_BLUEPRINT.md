# 4-Person Cubicle Pod — Complete Assembly Blueprint

**Purpose:** Exact step-by-step instructions to build a perfect 4-person cubicle pod without broken sprites.

**Sprite Sheet:** Modern Office Revamped v1.2  
**Grid Size:** 64×64 pixels per tile  
**Coordinate System:** Top-left anchor (x, y) in pixels

---

## Part 1: The Blueprint (Bird's Eye View)

```
Top View (Facing Down):
┌─────────────────────────────────────────┐
│ CAP │ DESK-TOP (1) │ DESK-TOP (2)  │ CAP │
├─────┼──────────────┼──────────────┼─────┤
│ DIV │ DIVIDER (1)  │ DIVIDER (2)  │ DIV │
├─────┼──────────────┼──────────────┼─────┤
│ CHR │ CHAIR-TOP(1) │ CHAIR-TOP(2) │ CHR │
│ CAP │    [MON]     │    [MON]     │ CAP │
├─────┼──────────────┼──────────────┼─────┤
│ DIV │ DIVIDER (1)  │ DIVIDER (2)  │ DIV │
├─────┼──────────────┼──────────────┼─────┤
│ CHR │CHAIR-BOT(1)  │CHAIR-BOT(2)  │ CHR │
│ CAP │    [MON]     │    [MON]     │ CAP │
└─────┴──────────────┴──────────────┴─────┘
```

**Legend:**
- `DESK-TOP` = Horizontal desk surface (128×64 px) at Z=2
- `DIV` = Horizontal divider (128×64 px) at Z=3, sits ABOVE desk
- `CHR` = Office chair (64×64 px) at Z=1, sits BELOW desk
- `CAP` = Vertical end-cap (64×128 px) at Z=3, seals left/right
- `[MON]` = Dual monitor (128×64 px) at Z=4, Y offset: -15px
- Empty corners are filled with floor tiles

---

## Part 2: Layer-by-Layer Assembly

### **Layer 0: FLOOR (Z=0)**
Fill the entire 4×4 cubicle area with floor tiles.

| Position | Sprite ID | Coordinates | Size |
|----------|-----------|-------------|------|
| Floor (entire area) | `floor_tile_grey_grid` | (320, 160) | 256×256 |

**Code Logic:**
```
for x in range(0, 4):
  for y in range(0, 4):
    place_sprite(
      "floor_tile_grey_grid",
      x * 64,
      y * 64,
      z_index: 0
    )
```

---

### **Layer 1: CHAIRS (Z=1)**
Place office chairs in the gaps between desks. Standard offset: Y_desk + 64px.

| Position | Chair Type | Sprite ID | Coordinates | X | Y | Z | Notes |
|----------|-----------|-----------|-------------|---|---|---|-------|
| Top-Left | Orange (Back) | `office_chair_orange_back` | (0, 320) | 0 | 64 | 1 | Facing back (away) |
| Top-Right | Orange (Back) | `office_chair_orange_back` | (0, 320) | 128 | 64 | 1 | Same orientation |
| Bottom-Left | Orange (Front) | `office_chair_orange_front` | (64, 320) | 0 | 192 | 1 | Facing front (toward) |
| Bottom-Right | Orange (Front) | `office_chair_orange_front` | (64, 320) | 128 | 192 | 1 | Same orientation |

**Rationale:**
- Top chairs face *away* (back of chair to desk) = workers facing top desk
- Bottom chairs face *toward* (seat to desk) = workers facing bottom desk
- Orientation creates "facing across divider" effect

---

### **Layer 2: DESKS (Z=2)**
Place horizontal desk surfaces. These are the "anchors" for everything else.

| Position | Desk Type | Sprite ID | Coordinates | X | Y | Width | Height | Z |
|----------|-----------|-----------|-------------|---|---|-------|--------|---|
| Top-Left Desk | Tan Horizontal | `desk_tan_horizontal` | (64, 0) | 0 | 0 | 128 | 64 | 2 |
| Top-Right Desk | Tan Horizontal | `desk_tan_horizontal` | (64, 0) | 128 | 0 | 128 | 64 | 2 |
| Bottom-Left Desk | Tan Horizontal | `desk_tan_horizontal` | (64, 0) | 0 | 128 | 128 | 64 | 2 |
| Bottom-Right Desk | Tan Horizontal | `desk_tan_horizontal` | (64, 0) | 128 | 128 | 128 | 64 | 2 |

**Stacking Check:**
- Chairs (Z=1) are BELOW desks (Z=2) ✓
- Floor (Z=0) is BELOW chairs ✓

---

### **Layer 3: DIVIDERS & END-CAPS (Z=3)**
This is the CRITICAL layer. Dividers sit ABOVE desks (Y_desk - 64px).

#### **3A: Horizontal Dividers** (Privacy walls between top & bottom)

| Position | Divider Type | Sprite ID | Coordinates | X | Y | Width | Height | Z | Notes |
|----------|--------------|-----------|-------------|---|---|-------|--------|---|-------|
| Top Divider (Left) | Horizontal Divider | `cubicle_divider_horizontal` | (0, 832) | 0 | -64 | 128 | 64 | 3 | ABOVE top desks |
| Top Divider (Right) | Divider Extension | `cubicle_divider_horizontal_extension` | (128, 832) | 128 | -64 | 128 | 64 | 3 | Extends privacy wall |
| Bottom Divider (Left) | Horizontal Divider | `cubicle_divider_horizontal` | (0, 832) | 0 | 192 | 128 | 64 | 3 | ABOVE bottom desks |
| Bottom Divider (Right) | Divider Extension | `cubicle_divider_horizontal_extension` | (128, 832) | 128 | 192 | 128 | 64 | 3 | Extends privacy wall |

**Placement Logic:**
```
Y_divider = Y_desk - 64

Top divider Y = 0 - 64 = -64 (appears ABOVE desk visually)
Bottom divider Y = 128 - 64 = 64 (appears ABOVE bottom-left desk)
```

**CRITICAL:** If dividers are omitted, cubicle looks like open desks. Dividers ARE the "walls."

#### **3B: Vertical End-Caps** (Side seals)

| Position | Cap Type | Sprite ID | Coordinates | X | Y | Width | Height | Z | Notes |
|----------|----------|-----------|-------------|---|---|-------|--------|---|-------|
| Left Cap | Vertical End-Cap | `cubicle_endcap_vertical` | (0, 896) | -64 | 0 | 64 | 256 | 3 | Tall piece spans full height |
| Right Cap | Vertical End-Cap | `cubicle_endcap_vertical` | (0, 896) | 256 | 0 | 64 | 256 | 3 | Seals right side |

**Rationale:** These pieces are 256 pixels tall (4 tiles). They span from top to bottom of the pod, sealing the sides so you don't see the "open" edges of the desks.

---

### **Layer 4: DESKTOP ITEMS (Z=4)**
Monitors, lamps, papers go here. **IMPORTANT:** Apply Y-offset so items appear to SIT ON the desk, not float in the middle.

#### **4A: Dual Monitors (Primary Tech)**

| Position | Item | Sprite ID | Coordinates | X | Y | Y-Offset | Width | Height | Z | Notes |
|----------|------|-----------|-------------|---|---|----------|-------|--------|---|-------|
| Top-Left Monitor | Dual Monitors (Grey) | `monitor_dual_light_grey` | (320, 1152) | 0 | 0 | -15 | 128 | 64 | 4 | Y offset: -15px |
| Top-Right Monitor | Dual Monitors (Grey) | `monitor_dual_light_grey` | (320, 1152) | 128 | 0 | -15 | 128 | 64 | 4 | Same offset |
| Bottom-Left Monitor | Dual Monitors (Grey) | `monitor_dual_light_grey` | (320, 1152) | 0 | 128 | -15 | 128 | 64 | 4 | Y offset: -15px |
| Bottom-Right Monitor | Dual Monitors (Grey) | `monitor_dual_light_grey` | (320, 1152) | 128 | 128 | -15 | 128 | 64 | 4 | Same offset |

**Math Explanation:**
```
Render Position Y = Desk Y + Y_Offset
Render Position Y = 0 + (-15) = -15  (appears 15px ABOVE desk baseline)
This creates the illusion of monitors sitting on the desk surface.
```

**Constraint:** Dual monitors are 128px wide. Only use on 2-tile (128px) or wider desks. ✓ (We have 128px desks)

#### **4B: Desk Clutter (Optional - adds variety)**

| Position | Item | Sprite ID | Coordinates | X | Y | Y-Offset | Notes |
|----------|------|-----------|-------------|---|---|----------|-------|
| Top-Right Desk | Paperwork Stack | `paperwork_stack` | (0, 448) | 168 | 12 | -12 | Slight left of monitor |
| Bottom-Left Desk | Folder | `folder` | (64, 448) | 32 | 140 | -12 | Slight right of desk |

**Rationale:** Paper stacks and folders prevent the "copy-paste" look and add visual interest.

---

## Part 3: Complete Placement Table (Ready to Code)

This table has **EVERY COORDINATE** you need to build the pod perfectly:

```json
{
  "cubicle_pod_4person": [
    
    // Layer 0: FLOOR
    {
      "type": "floor_tile_grey_grid",
      "coords": [320, 160],
      "placement": "fill_area",
      "x": 0, "y": 0, "w": 256, "h": 256,
      "z_index": 0
    },

    // Layer 1: CHAIRS
    {
      "type": "office_chair_orange_back",
      "coords": [0, 320],
      "x": 0, "y": 64,
      "z_index": 1,
      "notes": "Top-left chair"
    },
    {
      "type": "office_chair_orange_back",
      "coords": [0, 320],
      "x": 128, "y": 64,
      "z_index": 1,
      "notes": "Top-right chair"
    },
    {
      "type": "office_chair_orange_front",
      "coords": [64, 320],
      "x": 0, "y": 192,
      "z_index": 1,
      "notes": "Bottom-left chair"
    },
    {
      "type": "office_chair_orange_front",
      "coords": [64, 320],
      "x": 128, "y": 192,
      "z_index": 1,
      "notes": "Bottom-right chair"
    },

    // Layer 2: DESKS
    {
      "type": "desk_tan_horizontal",
      "coords": [64, 0],
      "x": 0, "y": 0,
      "z_index": 2,
      "notes": "Top-left desk"
    },
    {
      "type": "desk_tan_horizontal",
      "coords": [64, 0],
      "x": 128, "y": 0,
      "z_index": 2,
      "notes": "Top-right desk"
    },
    {
      "type": "desk_tan_horizontal",
      "coords": [64, 0],
      "x": 0, "y": 128,
      "z_index": 2,
      "notes": "Bottom-left desk"
    },
    {
      "type": "desk_tan_horizontal",
      "coords": [64, 0],
      "x": 128, "y": 128,
      "z_index": 2,
      "notes": "Bottom-right desk"
    },

    // Layer 3A: HORIZONTAL DIVIDERS
    {
      "type": "cubicle_divider_horizontal",
      "coords": [0, 832],
      "x": 0, "y": -64,
      "z_index": 3,
      "notes": "Top divider (left section)"
    },
    {
      "type": "cubicle_divider_horizontal_extension",
      "coords": [128, 832],
      "x": 128, "y": -64,
      "z_index": 3,
      "notes": "Top divider (right section)"
    },
    {
      "type": "cubicle_divider_horizontal",
      "coords": [0, 832],
      "x": 0, "y": 192,
      "z_index": 3,
      "notes": "Bottom divider (left section)"
    },
    {
      "type": "cubicle_divider_horizontal_extension",
      "coords": [128, 832],
      "x": 128, "y": 192,
      "z_index": 3,
      "notes": "Bottom divider (right section)"
    },

    // Layer 3B: VERTICAL END-CAPS
    {
      "type": "cubicle_endcap_vertical",
      "coords": [0, 896],
      "x": -64, "y": 0,
      "z_index": 3,
      "height": 256,
      "notes": "Left side seal (tall, spans full height)"
    },
    {
      "type": "cubicle_endcap_vertical",
      "coords": [0, 896],
      "x": 256, "y": 0,
      "z_index": 3,
      "height": 256,
      "notes": "Right side seal (tall, spans full height)"
    },

    // Layer 4: DESKTOP ITEMS
    {
      "type": "monitor_dual_light_grey",
      "coords": [320, 1152],
      "x": 0, "y": 0,
      "y_offset": -15,
      "z_index": 4,
      "notes": "Top-left monitor"
    },
    {
      "type": "monitor_dual_light_grey",
      "coords": [320, 1152],
      "x": 128, "y": 0,
      "y_offset": -15,
      "z_index": 4,
      "notes": "Top-right monitor"
    },
    {
      "type": "monitor_dual_light_grey",
      "coords": [320, 1152],
      "x": 0, "y": 128,
      "y_offset": -15,
      "z_index": 4,
      "notes": "Bottom-left monitor"
    },
    {
      "type": "monitor_dual_light_grey",
      "coords": [320, 1152],
      "x": 128, "y": 128,
      "y_offset": -15,
      "z_index": 4,
      "notes": "Bottom-right monitor"
    }
  ]
}
```

---

## Part 4: Troubleshooting "Broken" Sprites

| Problem | Cause | Fix |
|---------|-------|-----|
| Monitors floating in middle of desk | Y-offset not applied | Add `y_offset: -15` to monitor rendering |
| Chairs appear in front of desks | Wrong Z-index | Change chair Z from 3 to 1 (must be BELOW desks) |
| Cubicle looks "open" | Dividers omitted | Add horizontal dividers at `y: -64` |
| Cubicle sides visible | End-caps missing | Add vertical end-caps at `x: -64` and `x: 256` |
| Desk looks isolated/weird | Floor not filled | Fill entire area with floor tiles first (Z=0) |
| Sofa appears broken | Only using middle tile | Use: left + middle + right as a group |
| Bookshelf has gap | Vertical offset wrong | Keep exactly 64px between top and bottom |

---

## Part 5: Next Steps

1. **Paste this JSON** into an implementation function
2. **Loop through each layer** (0→4) to render in order
3. **Validate modular groups** before rendering (e.g., ensure sofa has ends)
4. **Test in browser** — should see perfect 4-person cubicle without floating/misaligned items

**Ready?** Do you want me to create the **actual game rendering code** that uses this blueprint?
