# Parametric Enclosure Generator

Turns a declarative layout config into a print-ready 3D enclosure. The same config always produces
the same geometry, and a validator catches collisions, thin walls and oversized parts before anything
gets printed.

**Status:** the config schema, part library, validator, geometry engine and browser preview all work, exporting
STL and STEP, including multi-part assemblies in more than one colour. Nothing has been printed yet.

## Preview

```bash
npm run dev
```

**New** starts from a template, such as a plain box, a desktop wedge, a button box or a wide controller in two halves, and the rest
can be done without touching JSON:

1. **Shape:** set the size, the top surfaces from front to rear, rounds, wall thickness, colours, holes in the walls, an
   opening for anything that reaches out of the enclosure, fixings on the plate, and your printer's bed. Tick "Print as its own piece" to make a surface a separate top, and split the shell if it's too wide.
2. **Layout:** add parts from the library, or make one with **New custom part** from its holes and body sizes, then move them.
3. **Screws:** see the screws placed automatically, and move, add or remove any you need to.
4. **Print:** download each part, and see the hardware to buy.

These tabs only write the config, so the validator checks them like anything else, and clicking a problem takes you to the
tab that fixes it. **Save** and **Open** keep designs as JSON files. **Copy link** copies a link with the whole design in it, compressed after the
`#`, so it never reaches a server, and opening the link loads it, with Undo to go back. It works wherever the app does, so for
others only once it's hosted. Parts with a connector or a recess are still edited in the **Config** tab, and
everything else can be too.

A selected part can be copied in rows, mirrored across the enclosure's centre, centred, or lined up with another part on the same
surface. Drag parts in the 3D view, or use the arrow keys (Shift moves in 0.1 mm steps, R rotates, Delete removes). Changes
write back to the config, and editing the config text updates the view. Everything saves as a draft in the browser.

- **Validation runs on every change**, in the page. A bad position turns red and each problem says why, while the view
  keeps the last valid model and downloads stay off.
- **Only valid plans reach the engine**, in a Web Worker. Moving a part re-cuts just the printed part that holds it. On
  an Apple M4 Pro, that shows on screen in about 60 to 180 ms for the Desk Synth, and a full rebuild of its 9 parts takes about
  1.5 seconds.
- **The worker gets replaced** when its memory passes 1,000 MB, when a build overruns, or after an exception. Plans sent
  during a build replace each other, so dragging never queues up stale work.
- **Show inside** makes the shell see-through, showing part bodies and the boards on the floor so you can move them.
- **The Print tab** lists each printed part with its colour and size, its downloads, the hardware to buy, the pins it uses,
  and the steps to put it together. Choosing a step shows just its parts in the view, separated, with the rest faded, and **Next
  step** walks through them in order.
- **Separate parts** spreads the assembly apart: shell halves sideways, the top up, plates down, the rail forward.
- **Measure** gives the distance between two clicks on the model, pulling onto a corner when one's close. A selected part also
  shows the distance to its nearest neighbour.
- **Clicking a problem** marks where it is in the view, as well as opening the tab that fixes it.
- **Section** slices through the model across the width, front to back or by height, to see tabs, bosses and clearances. Cut
  faces show flat, in the part's colour.
- **Reference model**, on the Layout tab, opens a part's own STEP file and shows it see-through in blue, to measure and line
  things up against. It starts in the middle of the enclosure on its floor, with the middle of its bottom at the x, y and z
  you give, and turns and tips over in quarter turns, for a model drawn with another axis up. It isn't printed, checked or
  kept with the design, and it's gone after a reload.

`npm run build:app` makes a static site in `dist/`. The first visit downloads about 7 MB of compressed WASM. Its paths are
relative, so it works from any folder, such as GitHub Pages' `/<repository>/`.

To publish it on GitHub Pages, push to GitHub, and in the repository's Settings > Pages set Source to "GitHub Actions".
[.github/workflows/pages.yml](.github/workflows/pages.yml) then typechecks, builds and publishes the site on each push to
`main`. It doesn't run the tests, which take over 10 minutes, so run `npm test` before pushing. Drafts are kept in each
browser for each site, so one made on `localhost` doesn't show up on the published site. Copy link carries a design there.

## Config

The config is the design. Lengths are in millimetres.

```json
{
  "schemaVersion": 1,
  "name": "Small controller",
  "enclosure": {
    "width": 300,
    "frontHeight": 40,
    "surfaces": [
      { "id": "deck", "y": 80, "z": 40 },
      { "id": "panel", "y": 125, "z": 66 },
      { "id": "back", "y": 190, "z": 55 }
    ]
  },
  "seams": [{ "x": 150 }],
  "fabrication": { "material": "PETG" },
  "components": [
    { "id": "play", "type": "arcade-24mm", "surface": "deck", "u": 40, "v": 40 },
    { "id": "dial", "type": "ec11-dial-19mm", "surface": "panel", "u": 60, "v": 26 },
    { "id": "mcu", "type": "rp2040-plus", "x": 29, "y": 150 }
  ]
}
```

**Surfaces** describe the side profile. Each one runs from the end of the previous one, or the top of the
front wall, to its `y` and `z`. The last `y` sets the depth. One tilted panel is simply a list of one.

**Parts on a surface** use `u`, from the left edge, and `v`, from that surface's front edge along its slope.
`surface` can be left out if there's only one. **Floor parts** use `x` and `y`.

Unknown keys are errors, so a typo can't be silently ignored. `configJsonSchema()` exports the schema for
editors and for an LLM front end.

### Assemblies

An enclosure can be more than a shell and a plate. These are optional, and the Desk Synth uses all of them.

```json
"enclosure": { "color": "#cfc7b4" },
"topPanels": [
  { "surface": "deck", "color": "#1b1c1f" },
  { "surface": "panel", "color": "#1b1c1f", "splits": [214] }
],
"opening": {
  "xMin": 186,
  "xMax": 336.4,
  "yEnd": 92,
  "sill": 7.6,
  "rail": { "depth": 14, "footHeight": 3, "screwX": [178, 344.5] },
  "keepOut": [{ "xMin": 186, "xMax": 336.4, "yMin": 0, "yMax": 18, "top": 27.1 }]
}
```

**`topPanels`** turn a surface into separate printed pieces that cap the shell out to its outer edge, in their own colour.
`splits` cuts a piece that won't fit the bed. Screws go up through tabs on the shell into inserts in posts under the piece,
and their positions are worked out for you, moving around parts. A cutout on that surface belongs to the piece above it,
so moving a button re-cuts that piece alone.

Where `splits` cuts a piece, a tongue on the left piece fits a groove in the right one, to keep their faces flush, unless
`"joint": "flat"`. It's a 1.2 mm wedge with its flat side 0.15 mm past the material's minimum skin from the face, so it prints
on the first layers face down, and the groove's roof slopes at 45 degrees, so neither piece needs support. It stops 3 mm short
of each end, and a cutout in the right piece keeps the groove's depth further from the edge. A panel too thin for it, with
the skin it needs either side, is an error.

`"crease": "screws"` joins a piece to the top panel behind it, where their surfaces meet at a crease, as on the Desk Synth V2: a 3.5
mm flange hangs 10 mm under the front piece's rear edge, and M3 x 8 screws go through it from the front into inserts in bosses
under the piece behind. The flange runs wherever nothing is in the way, which is part bodies and posts under either piece, a
top screw and its tab, a hole over it, and anything standing on the plate tall enough to reach it. Its screws are about 30 mm
apart, and move off the way of a post on the front piece, since a driver comes in from the front. Two pieces with no room for
one get a warning. The pieces are screwed together face down, before anything goes in them. The flange and bosses meet where
the two pieces' undersides do, so the piece behind prints face down with no supports, and its insert holes have a teardrop's
point on the side that's up.

**`opening`** removes the front and top of a region, from the front edge back to `yEnd` and above `sill`. A top panel the
opening runs through falls into separate pieces on its own. A `rail` closes the bottom of the opening's front and screws in
from below, last, once the contents are in, with M3 x 8 flat-head screws in countersinks, as the plate's are, so that it prints
base down with no supports.

**`keepOut`** lists boxes of room the contents need, each up to height `top`. Nothing else may enter one: not bosses, tabs,
posts, boards or part bodies. It's also how the validator checks the contents fit under the surfaces past the opening.

### Rounds on the side profile

```json
"enclosure": { "rounds": { "frontBottom": 12, "rearTop": 22.6, "rearBottom": 22.6 } }
```

Each round is a true arc in the STL and STEP files, and the wall follows it at the same thickness. `rearTop` joins the last
surface to the rear wall, and takes some of that surface, so parts can't go on that part. Together, `rearTop` and `rearBottom`
can make the whole rear one curve.

A bottom round leaves a lip on the shell, and the plate stops short of it, flush with the base. Boards have to sit on what's
left of the plate. Screw bosses on that row reach back to the round with a 45 degree slope.

Where a round meets a rounded corner, the two surfaces meet at a crease rather than blending, because the corner comes from
the outline seen from above. A last surface that ends in a round can't be a separate top panel.

### Holes in walls and holding boards

**`wallHoles`** cuts a hole through a wall. `at` is y on the left and right walls and x on the front and rear, and `z` is its
centre from the base. Bosses and tabs move out of its way.

```json
"wallHoles": [{ "wall": "rear", "at": 100, "z": 15, "width": 14, "height": 8, "cornerRadius": 2 }]
```

**`vents`** cuts a row of upright slots through a wall, as many as fit `width`, and they get the same checks as any wall hole.
`slotWidth` and `gap` are 2 mm unless set, and `height` is how tall each slot is.

```json
"vents": [{ "wall": "rear", "at": 100, "z": 20, "width": 40, "height": 12 }]
```

**`plate.cableTies`** puts a little bridge on the plate for a cable tie to pass under, to hold wires or take the strain off them where
they leave a board. `rotationDeg` of 0 has the tie running front to back, and 90 side to side.

```json
"plate": { "cableTies": [{ "x": 60, "y": 90, "rotationDeg": 90 }] }
```

**A floor part's `port`** describes a connector, and the hole comes with the board. It follows the board along the wall and
turns with it, so the two can't drift apart. If the board is more than `reach` from that wall, there's no hole and you get
a warning.

**A floor part's `holder`** puts a cradle on the plate: `pads` under the board, `clips` in snap-fit pairs along its long edges,
and `stops` to locate it. Positions are from the board's centre, before rotating.

The RP2040-Plus has both: a 14 x 8.5 mm hole with 2 mm corners, and a cradle that holds the board 8 mm above the plate. The
hole, clips and stop are copied from the real Desk Synth. Its pads are not: the real ones sit in the corners, under 12 pin holes,
so these run down the middle to leave all 40 clear. The plate blocks soldering from below, so fit header pins before snapping
the board in. Other library boards don't have a holder or a port yet.

### Standoffs

A board with mounting holes can stand on posts printed on the plate, in place of a cradle, with `standoffs` on a floor part:

```json
"standoffs": [{ "at": [-5.7, -23.5], "diameter": 4.5, "holeDiameter": 1.7, "height": 4 }]
```

`at` is from the board's centre, and turns with it. The hole is for a screw to cut its own thread, and stops short of the plate so it
can't come through. Posts get the same checks as a cradle, and the plate's screws keep clear of them. The library's `pico-rp2350`,
`pi-zero`, `arduino-uno`, `perfboard-7x9` and `ads7830` have them. The perfboard's come from the Desk Synth V2, which assumes corner
holes 2.5 mm in from each edge, and the ADS7830's holes are from Adafruit's board file. Its posts leave room for M2 x 4 screws.

### Weight pockets

`plate.weights` puts a walled pocket on the plate, `width` by `depth` inside and `height` tall, 6 mm unless given, to glue a weight
into, such as a steel bar, so that a controller doesn't slide. Its 2 mm walls keep clear of whatever else stands on the plate, as a
support does, and stay 1 mm under the top. A low one can go under a top screw's tab, since the plate goes on last. Each size is in
the hardware list, and gluing them in is a step before the plate goes on.

```json
"plate": { "weights": [{ "x": 100, "y": 60, "width": 40, "depth": 20, "height": 8 }] }
```

### Rubber feet

`plate.feet` puts a shallow recess under the plate for each stick-on rubber foot, so they all go in the same place. Each is 10 mm
across unless given, and 0.8 mm deep, so it prints as the plate's first layers with nothing under them. They keep off what's cut
from under the plate: its edge, its joint, the rail's notch, and the screws' countersinks. **Put four at the corners**, on the Shape
tab, places one 20 mm in from each corner. They're in the hardware list, and the last step.

```json
"plate": { "feet": [{ "x": 23.25, "y": 32 }, { "x": 328.15, "y": 32, "diameter": 12 }] }
```

### Supports

A support is a post on the plate that rises to 0.3 mm under the top, to hold up a wide stretch of it, like the Desk Synth V2's under its
deck. The plate goes on last, so it never blocks a screwdriver:

```json
"plate": { "supports": [{ "x": 70, "y": 44.5, "diameter": 8 }] }
```

The diameter is 8 mm unless given. Its top is level, so under a slope only its low side comes that close. It has to stay on the
plate and off its joint, and clear of the seam rib, boards and their mounts, the plate's other fixings, the opening and its
contents, a top screw's room, a part's body, and anywhere it would show through a cutout. Round bodies, holes, bosses and pins
count as round, so it fits between buttons on a diagonal. A round body under a slope leans with it, and the check allows for
that.

### Notches

A hole can have `notches`, for extra room off its side, such as a keyway for a button's tab. A screen's `recess` can have them too,
for its ribbon, and those stop at the recess's depth. Each is a rectangle positioned from the part's origin, which has to overlap the
hole. They turn with the part, grow with its size in a fit test, and keep other things away.

The library's `arcade-24mm` and `oled-242-ssd1309` have them, read from the printed Desk Synth panels. The form can't show notches, so a
part with them is edited in the **Config** tab.

A rectangular window can also have a `bevel`, a 45 degree chamfer round its edge on the face, this deep. The `oled-242-ssd1309`'s
is 0.75 mm, measured on the printed fit test. It widens the window at the face, so it keeps other holes that much further off, and
it has to be shallower than the panel, or the recess's skin. A top piece prints face down, so the bevel needs no support.

### Parts in the walls

A jack or socket goes through a wall, with `wall`, `at` and `z` in place of a surface or floor position:

```json
{ "id": "midi-in", "type": "midi-din-5", "wall": "rear", "at": 100, "z": 22 }
```

`at` runs along the wall in design coordinates, and `z` is the height of its centre from the base. Its holes are cut for it, and any
beyond the first are offset along the wall as you read it from outside. The room behind it, `body`, is checked against boards,
cradles, what hangs from the top, the seam and the opening, and screws keep out of it. What shows outside, `outside`, has to stay off
the rounded corners and away from other parts. `maxWall` says how thick a wall its thread can reach through.

The library has `midi-din-5`, `trs-35-panel`, `trs-635-panel`, `usb-c-panel` and `dc-barrel-panel`. All of these are estimates that
vary by maker, and warn you to check the real part, so measure it and use your numbers as a custom part. The fit test gives each a
row for its main hole.

### Labels

Text is engraved into a surface or wall, in a lettering made for it, so there's no font to load, and a config builds the same
solids everywhere. Its strokes are never under 0.6 mm wide, which a 0.4 mm nozzle can leave open. It only has capitals, so lowercase
comes out as capitals.

```json
"labels": [
  { "text": "Bass", "component": "bass-voicing", "side": "right" },
  { "text": "USB-C", "component": "mcu", "side": "above", "size": 4 },
  { "text": "Desk Synth", "surface": "back", "u": 150, "v": 35, "size": 8 },
  { "text": "OUT", "wall": "right", "at": 80, "z": 14 }
]
```

A label with a `component` goes beside that part, and moves with it. For a board, that's beside its hole in the wall. `size` is
how tall a capital is, 5 mm unless set and at least 3.5 mm, and `depth` is 0.6 mm unless set. A top panel prints face down, so its
labels are on the bed, and come out crisp as long as supports stay off for it.

The validator won't take a label that runs past the usable part of a surface, off the flat of a wall, across a joint between
printed parts, into a hole, the opening or another label, or so deep that it leaves under the material's minimum skin. One under a
part's flange gets a warning, because it wouldn't be seen.

A label with a `color` is inlaid in it: the engraving is still cut, and a body of its own fills it, flush with the face. Each
bed's 3MF has the part and its labels as one object of two parts, each with its colour, so the slicer can give the labels their
own filament, and the download has them as an STL too. On a top piece, which prints face down, they're only in its first few
layers.

```json
"labels": [{ "text": "VOL", "u": 60, "v": 40, "size": 8, "color": "#f2f2f2" }]
```
### Knobs

A part with a shaft, like the library's `ec11-encoder`, can have a printed knob on it, from the Layout tab or in the config:

```json
{ "id": "volume", "type": "ec11-encoder", "surface": "top", "u": 60, "v": 40, "knob": { "diameter": 14, "height": 16 } }
```

Each is 14 mm across and 16 mm tall unless given, fluted round its side, with a groove across its top over the shaft's flat. It
sits as low on the shaft as the nut allows, 3 mm above the panel, or higher if the shaft is longer than it can take, and needs
6 mm of shaft in it. A part's `shafts` give each one's place, diameter, D flat and length from the panel's underside. The hole
is the shaft's size plus `fabrication.fit.knobHole`, 0.1 mm unless a fit test says otherwise, and the fit test has a row of
holes to try once a design has a knob. Knobs are printed parts of their own, top down so the hole needs no support, with a
`color` of their own, and they go on last.

### Pins

The Print tab counts the microcontroller's pins a design uses, if wired the way it assumes, and gives each part on the I2C bus an
address. Each part says what it needs in `pins`:

| Field | What it is |
| --- | --- |
| `switches` | On and off inputs, like a button, which go through shift registers first, 3 pins for the whole chain |
| `direct` | Pins of its own, like an encoder's two phases or an LED |
| `analog` | Analog inputs, on the microcontroller's own analog pins first, then on an analog board like the ADS7830 |
| `i2c` | The addresses it can be set to, sharing the 2 pins of the bus |
| `gpio`, `analogPins` | A microcontroller's own |
| `shiftInputs`, `analogInputs` | What a shift register or analog board adds |

Shift registers on a board of your own, like the Desk Synth's perfboard, go in `"wiring": { "shiftRegisters": 2 }`, or the Wiring field on the Shape tab. The Desk Synth comes to
9 of the RP2040-Plus's 26 pins, as its firmware uses: 3 for the shift registers that read its 8 buttons and 2 dial switches, 4 for
the dials' phases, and 2 for the bus to the screen, encoder boards and converters. Running out of pins, I2C addresses or analog
inputs is a warning, since a design can be wired other ways.

### Parts

[src/library.ts](src/library.ts) holds the parts. Each records its `source` (`measured`, `datasheet` or
`estimated`), and anything not measured gets a warning.

| Source | Parts |
| --- | --- |
| Measured, from the Desk Synth's Fusion model | 24 mm arcade button, EC11 dials (19 and 30 mm), Adafruit #5752 encoder board, 2.42 inch SSD1309 OLED, RP2040-Plus, 7 x 9 cm perfboard, ADS7830 board |
| From the maker's drawing, not in that build | 0.96 inch SSD1306 OLED, whose boards vary, so check yours, and the RP2350-Plus, which has the RP2040-Plus's outline and goes in the same cradle in the Desk Synth V2. Teensy 4.0 and 4.1, Arduino Nano and Seeed XIAO, each in a cradle laid out like the RP2040-Plus's, with its USB through the left wall when it's against it. Print a fit test for their clips |
| Estimated, not in that build | Latching button, potentiometer, TTP223, Pico 2, 74HC165 breakout |

The arcade button's hole is from the model, but its body isn't measured: the diameter comes from the
assembly manual's drawing, and the 22 mm depth is the room the Desk Synth leaves under its deck.

The display also has a recess for its glass and four posts for its M2 screws, using the same `recess` and `posts`
fields that any custom part can use. The post and hole diameters are estimates.

A part in `customParts` is defined right in the config, so a missing part never blocks anyone. It can also
replace a library part with the same name:

```json
"customParts": {
  "arcade-24mm": {
    "name": "My measured button",
    "source": "measured",
    "mount": "panel",
    "cutouts": [{ "kind": "circle", "diameter": 24.4 }],
    "above": { "footprint": { "shape": "circle", "diameter": 28 }, "height": 8 },
    "below": { "footprint": { "shape": "circle", "diameter": 28 }, "depth": 22 }
  }
}
```

### The Desk Synth example

[examples/desk-synth.json](examples/desk-synth.json) uses the real Desk Synth footprint, side profile, parts and positions, and splits
the same way as the Fusion model. It builds 9 printed parts:

| Part | Colour | Size in mm |
| --- | --- | --- |
| Shell 1, Shell 2 | Beige | 190 x 197 x 54, 165 x 197 x 54 |
| Deck 1, Deck 2 | Black | 186 x 77 x 3, 15 x 77 x 3, plus posts |
| Panel 1, Panel 2 | Black | 214 x 51 x 28, 137 x 51 x 28, plus posts |
| Plate 1, Plate 2 | Beige | 137 x 161 x 13, including the board's cradle, and 208 x 161 x 8, including the tray's pins |
| Front rail | Beige | 174 x 13 x 8 |

The keybed isn't generated: the tray, keys and sensor holder are the existing parts from the real build, and the plate
carries the tray's two countersunk holes and three locating pins. The USB hole matches the real shell's to within a 0.2 mm
sampling grid, and the real RP2040-Plus clears every part in its cradle. The `keepOut` boxes come from those real meshes. Every
vertex of the tray, keys and sensors falls inside them, and sampling 63 real keybed bodies against the 9 parts finds no
collisions. The rounds match the real shell's outline to within about 0.1 mm at the heights checked. **Check it before you print**,
because compared with the real build:

- Key travel isn't checked. The fit is only tested with the keys at rest.
- The deck and panel aren't joined at the crease, where the real one uses dowels. The Desk Synth V2 example screws them together.
- The seam is straight, and the real one steps.
- The ridge behind the panel is simplified.
- The plate has 8 screws, where the real one has 11, because the perfboard takes the row at the rear of the plate. So its joint
  is at x = 140 rather than 127, where both pieces can be screwed down beside it at the front, and only the rear corners are held.
- The rear seam joint moved in from the wall to fit between the curves of the round.
- The perfboard is 13 mm further back, because the OLED's single-box body is cautious near the front.
- The RP2040-Plus is 0.3 mm further from the wall, because the generated wall is 3.25 mm there, and the real one is 3 mm.
- The shell doesn't have the real one's short guides beside the USB hole. The cradle is on the plate alone.
- The RP2040-Plus cradle's pads are down the middle rather than in the corners, which hasn't been tried against a real board.
- The perfboard and ADC boards stand on posts, but the real ones sit on the plate loose.

These parts haven't been opened in Fusion. An earlier two-part version's STEP files imported into Fusion 2705.1.30 as one
solid per part, with volumes matching the engine to within 1 mm³, so the format is tested but this design isn't.

### The Desk Synth V2 example

[examples/desk-synth-v2.json](examples/desk-synth-v2.json) is the same, with what the real V2 changed that the builder can describe:

- The deck is screwed to the screen panel along their crease (`"crease": "screws"` on the deck), through a flange under its rear
  edge into bosses under the panel. The 2.42 inch OLED's body is a cautious box, so the flange stops short of it, with 4 screws
  where the V2 has 7.
- The panel's two pieces meet with a tongue and groove, which every split in a top panel now has.
- The plate splits at x = 176, as the V2's does, with a rib that bolts its pieces together. The converter boards move 2 mm left for
  it, as they do there. Their footprints include their STEMMA QT plugs, so only 2 bolts fit, where the V2 has 5.
- The board is the RP2350-Plus, in the same cradle.
- Its three supports stand between the buttons, under the middle of the deck.

Its lip along the shell's seam, edge lips round the perfboard and snap-off support fins aren't describable.

### The Dial deck example

[examples/dial-deck.json](examples/dial-deck.json) is a small desk controller for a first test print: a black face with the
2.42 inch OLED and two dials, on a beige wedge 140 x 85 x 40 mm, with the RP2040-Plus in its cradle and USB through the left
wall, and a round on its upper rear edge. It has no seam, so it needs 3 prints and about 6 hours in all. Choose it from
**Examples** in the preview.

## Validation

`validateConfig(input)` returns either a `BuildPlan` or every problem it found, each with a code, a message
and a path into the config. The engine only accepts a `BuildPlan`, because invalid layouts can crash it or
produce wrong geometry with no error.

| Code | What it catches |
| --- | --- |
| `SCHEMA_INVALID` | Wrong types, unknown keys, out-of-range values |
| `DUPLICATE_ID`, `UNKNOWN_PART`, `UNKNOWN_SURFACE`, `WRONG_MOUNT` | Bad references |
| `SURFACE_INVALID` | Surfaces that double back, are near-vertical, or barely differ from a neighbour |
| `GEOMETRY_IMPOSSIBLE` | No room above the floor, a surface too short to offset, oversized radii, rounds that don't fit |
| `WALL_TOO_THIN` | Walls or panel below the material's minimum |
| `SKIN_INVALID` | A pocket with too thin a skin, or none left |
| `PANEL_THICKNESS_UNSUITABLE` | A panel too thick or thin for a part, such as snap-in buttons |
| `CUTOUTS_TOO_CLOSE` | Overlaps (crash the engine), tangents (non-manifold edges), thin webs |
| `CUTOUT_OUTSIDE_SURFACE` | Past the edge, too near a wall or crease, or in a rounded corner |
| `CUTOUT_CROSSES_SEAM`, `CUTOUT_HITS_RIB` | Would be cut on one half only, or too close to the seam |
| `BODIES_COLLIDE` | Parts touching above a surface, below it, across surfaces, or on the floor |
| `BODY_HITS_ENCLOSURE` | A body reaching the floor, walls or another surface, allowing for each slope |
| `BODY_HITS_RIB` | A body or board in the way of a seam tab, or a board crossing the seam |
| `SEAM_INVALID` | A seam too near an edge, a tab too small, or too little height for its fasteners |
| `SEAM_UNBRACED` | Warning: parts leave no room for a tab under any surface |
| `PLATE_INVALID` | A plate joint too near an edge, too few screws, or a listed or added screw in the way of something |
| `TOP_PANEL_INVALID` | A top panel on a missing surface, two on one surface, a piece with too few screws, or an added screw that can't go there |
| `FASTENER_GAP` | Warning: a wall or top panel with a long stretch no screw holds |
| `FASTENER_CHANGE_UNUSED` | Warning: a removal in the config that no longer matches any screw |
| `WALL_HOLE_INVALID` | A hole too near a corner, the plate or the top, on a seam, opening or rail block, or too close to another |
| `PORT_UNREACHED` | Warning: a board too far from the wall its connector faces, so it gets no hole |
| `BOARD_HOLDER_INVALID` | A cradle off the plate, across its joint, or in the way of a pin, hole, part, board, seam tab or other cradle |
| `BOARD_HOLDER_SKIPPED` | Warning: a board with a cradle when the plate is turned off |
| `OPENING_INVALID` | An opening outside the walls, contents that won't fit under the top, rail screws in the opening, or a part or board in reserved space |
| `PART_TOO_LARGE` | A printed part that won't fit the build volume, with how many seams it needs |
| `SMALL_HOLE`, `UNVERIFIED_PART` | Warnings: a hole that may print badly, a part that hasn't been measured |
| `PINS_SHORT` | Warning: the microcontroller runs out of pins, I2C addresses or analog inputs. See Pins |
| `ERGONOMICS` | Warning: controls too close for fingers, 2 mm between buttons and 5 mm beside a knob or fader, or a screen lying flatter than about 15 degrees, or facing away |

Material limits in [src/library.ts](src/library.ts) are starting points for a 0.4 mm nozzle, not test
results. `fabrication.minWall`, `minWeb` and `minSkin` override them.

## Engine

[src/engine.ts](src/engine.ts) builds solids with [Replicad](https://replicad.xyz), which is OpenCascade
compiled to WASM. The [engine spike](spikes/replicad-engine/README.md) has the measurements behind that
choice, including import tests in Fusion.

`buildEnclosure(plan)` returns each printed part. `recutPart` re-cuts one part from its stored blank, so
moving a part doesn't rebuild the shell.

Two things a host has to handle:

- **WASM memory grows** about 8 MB per full rebuild and can't be freed. Replace the instance now and then.
- **Replace the instance after any exception**, since its heap may be corrupted.

Also, Replicad's `translate` consumes the shape it's called on, so call `clone()` first if you still need it.

### Staying deterministic

The browser and the command line produce byte-identical STL and STEP files for the same config. That holds because
nothing that shapes the geometry uses trig functions: Node and Chromium differ in the last bit of `sin`, `cos`, `tan`
and `atan2`, which was enough to change a few STL triangles. Surface directions come from division and `sqrt`, which
give the same bits everywhere. Keep it that way in [src/profile.ts](src/profile.ts) and [src/engine.ts](src/engine.ts).

## Bottom plate and fastening

By default, a plate fits inside the walls with 0.25 mm of clearance. These sizes come from the real Desk Synth:

| Feature | Size |
| --- | --- |
| Insert hole in the shell | Ø4 x 6 mm, for M3 brass heat-set inserts |
| Clearance hole in the plate | Ø3.4 mm |
| Countersink in the plate and seam tabs | Ø6.32 mm, 1.6 mm deep, for M3 flat-head screws |

The Ø8 mm bosses are my choice, and merge with the wall beside them. Under a separate top panel, a boss stops just past its
insert and has to touch a wall. So does one on the front or rear wall of a seamed shell, which also slopes back to the wall
at 45 degrees, because it prints on its side. Any other boss rises to the top of the shell. Insert holes in a seamed shell have a teardrop point towards the seam, for the same reason.

A plate can also carry `countersunkHoles` and locating `pins` for whatever sits on it.

If the plate doesn't fit the bed, it splits 60 mm from the shell's seam, so it ties the two halves together. Screws
go at the corners and either side of that joint, then wherever a wall has a gap over `plate.screwSpacing`. They
move out of the way of parts, so moving a part can change them and rebuild the shell. Replace them all by listing
`plate.screws`, or set `plate.enabled` to false.

With `"joint": "rib"`, the pieces also bolt to each other through an 11 mm rib along the joint, before anything goes on, so the
plate is one rigid piece, as on the Desk Synth V2. The left piece has a boss for each bolt's heat-set insert, which goes in sideways,
and the right piece takes an M3 x 10 flat-head screw in a countersink, driven from the right. A wedge-shaped tongue low on the
right half fits a groove in the left, to keep the plate flush, and neither half needs support standing up. The rib runs between
the walls, inside any bottom round, and stops short of the shell's bosses, a seam rib round its walls, and the rail's notch.
Anything else where it stands is an error, but a board can come within 0.2 mm of it. Its bolts spread along it about 45 mm apart,
each moved to the nearest spot where nothing is in the way of its boss or of a short driver from the right.

To change only some, use the **Screws** tab, which writes what you changed and nothing else:

```json
"plate": { "fasteners": { "add": [{ "x": 26.5, "y": 170.35 }], "remove": [{ "x": 6.8, "y": 170.35 }] } },
"topPanels": [{ "surface": "deck", "fasteners": { "add": [{ "wall": "front", "at": 70 }], "remove": [{ "wall": "front", "at": 93 }] } }]
```

Moving a screw is removing it and adding another. A top screw only needs its wall, because it always sits on that wall's
line, and `at` is y on the left and right walls and x on the others, as for a wall hole.

The automatic layout runs first and doesn't see these, so changing one screw leaves the others where they were. An added
screw then replaces any automatic one in its way, and gets the same checks, with the same reasons if it can't go there.
A removal matches a screw within 4 mm. If the design changes and it no longer matches, that screw comes back with a warning.

`FASTENER_GAP` warns about more than 1.5 times `plate.screwSpacing` along a wall, or on a top panel more than 135 mm between
screws, or 90 mm from its end to its last screw. These limits are judgement rather than test results, so they only warn.
The Desk Synth example has four of these warnings, because its parts leave almost no room for more screws in those places.

### Reaching the screws

A screw is no use if a driver can't get to it, so each one has to have a clear path for its head and a driver's shaft, 6 mm
across. The paths depend on the order it goes together, which the **Print** tab lists for the design:

1. Seam bolts first, with nothing else fitted, driven sideways from inside the left half. 60 mm is kept clear behind each.
2. Top screws next, driven up from below through the open base with the plate off. A path can't pass through a bottom round,
   a plate boss, a seam tab, a rail block, another top screw or the body of a part.
3. Boards and whatever the opening holds go in on the plate, so they aren't in the way of any of that.
4. Plate screws and then rail screws, driven from below, where nothing is ever in the way.

Automatic screws keep to these paths, and an added one that can't is rejected with the reason. On a rounded front, this moves
the front row back behind the round, on longer tabs. A screen's screws go in on the bench, before its top piece goes on, so
they aren't checked. Nor is there any check on the angle of a driver or on your hands, only on a straight path.

The Screws tab covers plate and top screws. Seam bolts follow the seam, rail screws are set with the rail, and a screen's
screws come with its part.

## Keeping versions

The draft and its undo history are kept in the browser, so both survive a reload. On the **Config** tab, **Keep this version** stores
the design under a name, and says how each one differs from what you have now. Going back to one is a single step you can undo. It's
all in that browser, so save the file for anything you can't lose.

## Printing

Exports come out as they should print, centred on the bed, so don't turn them in the slicer. The **Print** tab shows each part
on the bed and can download everything in one zip, with a guide. `npm run build` writes the same files and guide. The guide
ends with the hardware to buy and the steps to put it together. A board's screws into its standoffs are sized from their holes,
long enough to go through a 1.6 mm board and as far into the hole as they can without bottoming out.

The tab also gives a rough time, weight and filament cost, for each part and in all, and the guide has them too. They come from each
part's surface and volume, fitted to what ElegooSlicer says for 26 parts of the templates and the Dial deck, on the Centauri Carbon 2
profile at 0.20 mm with Rapid PETG. A shell takes about twice as long per gram as a flat part. On the Desk Synth, which wasn't used to fit
them, that gives 430 g and 26 h against the slicer's 435 g and 27.5 h. A single part's weight is within about 20%, and its time
within about 40%, so use your slicer's figure for anything that matters. The price per kg is kept in the browser.

**Sharing the bed**, on the tab and in the guide, groups the parts of each colour onto as few beds as they fit, largest first,
5 mm apart and 5 mm in from the edge. A part keeps the way up it prints, but may lie a quarter turn round. Each one counts as the
box it takes up on the bed, so they fit at least that well. It's a suggestion: a part that needs supports beside one that
doesn't is fine in a slicer, but a long print of several parts risks more on one failure. Each bed with more than one part also
comes as `bed-1.3mf` and so on, in the download and from `npm run build`, with its parts already placed. It's the core 3MF format
that every slicer opens, with each part as its own object, rather than any one slicer's project file.

**Mark as printed** remembers each part's shape in the browser. After a change, the tab says which parts need reprinting, and can
download just those, so a small move doesn't cost a whole set.

The app works out the orientation from each part's real mesh, after every change. It tries each wall down and each of the
part's surfaces face down, and scores them on what has to hang in the air, what starts in mid-air, whether there's enough on
the bed, whether it fits, and how tall it is. Then it goes up through the chosen one a layer at a time to find anything with
nothing under it. The checks come from the Desk Synth's own scripts, `oh.py`, `islands.py` and `support.py`, and they reach the same
orientations as that build without being told: shell halves on their outer walls, top pieces face down, and plates flat.

Some of this is taken care of in the design, depending on how the part prints:

| Part | Prints | Shaped for it |
| --- | --- | --- |
| Shell with a seam | On its outer wall, seam up | Bosses, tabs and rail blocks slope back to a wall at 45 degrees, and holes have a teardrop point |
| Shell without a seam | Upright, base down | Screw tabs have a 45 degree gusset under them, bored through for the screw |
| Top piece | Face down, posts up | Its holes need no support at all |
| Plate and rail | Flat, countersinks down | Nothing |

A shell without a seam stays upright even with a bottom round, because on its side its far wall would be a wide roof. With a
top that's part of the shell, it goes face down instead, unless the mesh says otherwise.

The limits are 45 degrees from upright for an overhang, about 70 for a roof, and a span of 12 mm for a bridge. They're taken from
the Desk Synth's scripts and haven't been proven by a print. What's left over, the app says to use supports for, and marks on the bed
view. It only knows the Centauri Carbon 2's 256 mm bed by default, though `fabrication.buildVolume` can change it.

These results are from the Desk Synth example in ElegooSlicer, using the Centauri Carbon 2 profile with Rapid PETG. They show
metres of support, and its share of the filament for that part:

| Part | Orientation | 20° threshold | 10° threshold |
| --- | --- | --- | --- |
| Shell 1 | Side wall on the bed | 10.1 m, 21% | 8.5 m, 18% |
| Shell 2 | Side wall on the bed | 7.3 m, 20% | 7.3 m, 20% |
| Deck 1 and 2 | Face down | None needed | Not measured |
| Panel 1 and 2 | Face down | None needed | Not measured |
| Plate 1 and 2 | Flat, with Plate 1's clips up | None needed | Not measured |
| Front rail | Flat | Under 0.1 m | Not measured |

The two-part shell before this used 45.5 m and 15.5 m at 20°. Adding the rounds raised these from 9.2 m and 3.9 m, and took
Shell 1 at 10° from none to 8.5 m. Much of what's left on Shell 1 goes to the seam bolts, at about 3 m each, because the head recess
leaves a thin sliver that starts in mid-air. The Dial deck's shell, printed upright, took 1.84 m before its tabs had gussets, and
takes 1.02 m now, most of it under the plate bosses. Nothing has been printed yet.

### Fit test

Nothing here has been checked on your printer, so print this before the real parts. It's a small print of the design's own
holes, bosses and clips in a range of sizes, made with the same code as the enclosure. It's on the **Print** tab, or:

```bash
npm run fit-test -- examples/desk-synth.json
```

The first piece has the fixings every design needs. The next pieces have that design's board clips and part holes. Print them
as exported, in the material and settings you'll use. Dots in the left margin number the rows, and the dots behind a hole number
its size. Each row says what to try, and picking the size that fits writes it into the config:

```json
"fabrication": { "fit": { "insertHole": 4.1, "insertHoleSideways": 4.2, "screwHole": 3.5, "clipGap": 0.1, "pinSocket": 4.4, "partHoles": { "arcade-24mm": 0.15 } } }
```

`insertHole` is for holes that print upright: top posts, seam inserts, and the bosses of a shell with no seam.
`insertHoleSideways` is for the bosses and rail blocks of a seamed shell, which lie down as it prints. `partHoles` adds to every
hole of that part, including the hole for a board's connector, and the validator's checks use the result. The plate's row sets
`plate.clearance`. A seamed design also gets a row of sockets and a loose pin, which set `pinSocket`.

Holes in the walls up to 40 mm get a row of three sizes in a wall of the real thickness, turned the way the shell prints that
wall. A hole you added yourself keeps its size as `fitChange` on that hole.

To try a part the design doesn't use, so it's ready for later, list it. Its row goes after the others, so they keep their numbers:

```json
"fabrication": { "fitTestParts": ["oled-ssd1306"] }
```

The **Wall section** is a corner of the real shell, cut from it and printed the same way up, to see how its walls and rounds come
out. There's nothing to pick from it. It's made from the shell as it stands, so it's exported with the rest of the fit test.

A seamed design also gets the **Seam joint**: a slice from each half around one tab, with its pin, socket, insert hole and bolt
hole, printed the same way up. Bolting the two together shows whether the real joint comes together. On the Desk Synth they take about
30 minutes and 5 g each in ElegooSlicer.

A row's sizes stay put when you pick one, so a print you've already made can still be read. To test further than a row goes,
set a value past it in the config, and the row moves to centre on that.

These sizes describe the printer more than the design, so **Save these for my printer** keeps them in the browser. New designs
start with them, and a design that differs says how and offers to use them. They still go into the config, so a saved file builds
the same anywhere.

A part with one round hole gets three sizes. Anything else is printed once, to check its spacing and fit, because a range of
those would be too big to be worth printing. In ElegooSlicer, using the Centauri Carbon 2 profile at 0.20 mm with Rapid PETG, the
The Desk Synth's first piece takes about 1 h 36 min and 21 g, and its second 2 h 10 min and 32 g. Its plug and pin take about 5 minutes
and 1 g each, and its wall section 45 minutes and 10 g.

It doesn't cover pins on the plate, because what they fit into isn't in the design, or the holes in a board's standoffs. Nothing has
been printed yet, including this.

## Limits for now

- One seam at most, straight across the width. The validator's rules handle more, but the schema caps it at one.
- Rotation in quarter turns only.
- A top edge fillet only on a single surface.
- One panel thickness for all surfaces.
- Bodies are single boxes or cylinders, and rounded corners count as square. Both err towards reporting less room.
- Parts can block every tab under the surfaces, leaving a seam bolted only at the front and rear. That gives a
  `SEAM_UNBRACED` warning.
- Not describable yet, all in the real Desk Synth: stepped seams, or a lip along one, and edge lips round a board.

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run validate -- examples/desk-synth.json
```

```bash
npm run build -- examples/desk-synth.json output
```

`npm run build` is the command-line build, and `npm run build:app` builds the site. `npm run build` validates the config, builds it, checks each part for a valid solid, a watertight mesh and
correct volumes, and writes STL and STEP files.

`test/engine.test.ts` checks the promise that matters most: whatever the validator accepts, the engine builds
correctly. It generates random side profiles and places parts at random, including right up against the limits.
`ENGINE_SEEDS` sets how many layouts to try.
