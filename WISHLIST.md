# Wishlist

Ideas to come back to, grouped by what they're for. Only the Centauri Carbon 2 matters for now, until a print from it has
proven the numbers. Move an item to the done list once it's built.

## Faster designing

- [ ] Describing a design in words, with the validator still judging the result.

## Ease of use

The aim: anything set by typing a number or picking from a list in the sidebar should, within reason, also be something to
click or drag in the view.

- [ ] **Light up a single number** when its field has the cursor, such as a round or the corner radius, not only a whole card,
  and the fields on the other tabs.
- [ ] **Select several parts with a dragged box,** and several labels, holes or plate items, as Shift-click selects parts.
- [ ] **Type a size onto the view:** click a dimension shown beside a selection, such as its distance to an edge or a
  neighbour, and type what it should be.
- [ ] **More fixes from a problem:** turning the view to look at it, and a fix for a label, hole or screw in the wrong place, as a
  part has.
- [ ] **Show where a part can go** while it's being dragged, by shading the areas that would be refused.
- [ ] **A built-in tutorial** that guides a newcomer step by step through making a basic synth: choosing a shape, adding
  buttons, knobs and a screen, a board on the floor, labels, a seam if it's too wide for the bed, fixing what the problem list
  says, and exporting the files to print. Each step points at the control to use and checks the design to know whether it's
  been done right, saying what's still missing, and the next step stays locked until it has. It ends on a finished screen that
  makes it plain the tutorial is complete, with the synth shown and the design kept as an ordinary one afterwards. It can be
  left at any point, but not skipped ahead.
- [ ] **Small drawings for the less obvious fields,** such as u and v, bulge and bow, beside their notes.

## Shape

- [ ] A true arc for a curve in the STEP file, and lettering placed on a curve by itself.
- [ ] A bowed wall that's hollow, with the inside following it, and bowed side walls.
- [ ] A tongue and groove along the seam, with keys, as the real Desk Synth has. It needs a wall of 4 mm or more there, and the
  seam's lip does the same job in a thinner one, so this only matters for matching the real shell.

## Set aside

- Full parts list. Not for now.
- Printers other than the Centauri Carbon 2. Not until this one is proven.

## Done

- [x] **Snapping while dragging a part,** with dashed guides: to a neighbour's centre or edge, the middle of its surface, wall or
  floor, and the row's own gap. Alt drags without it. Handles and labels don't snap yet.
- [x] **Hover to see what something is,** with its name and main sizes, and **look at what's selected** with F or a
  double-click, square onto it and near.
- [x] **Plainer names and notes on the fields:** u and v read "Across (u)" and "Back (v)", and the less obvious fields, such as a
  curve, a bow, a lip or a round, have a note on hover saying what they change, with a dotted line under their name.
- [x] **Fix a part's problem with one button:** a part that has one can move to the nearest spot, up to 40 mm away, where it has
  none and nothing else is made worse.
- [x] **Copy and paste parts,** with their knobs, caps, labels and any custom part they are, within a design and between designs.
- [x] **Select several parts** with Shift-click, in the view or the parts list, to nudge, turn or delete together, put in one
  row or column, or space evenly. The view's Shift-click is untried in the app, the list's is.
- [x] **Drag the rest:** a label, a hole or vent in a wall, a support, pin, foot, weight pocket, cable tie bridge or hole in the
  plate, by a handle in its middle, once it's selected.
- [x] **Handles on the shape:** for a seam or the plate's split along the width, the walls' width, depth and front height, a
  bowed wall's bow, and a surface's crease, back and up, and its curve from the middle of its arc.
- [x] **Drag parts into place:** from the library's Add button onto a surface, wall or the floor in the view, and from one top
  surface onto another while dragging.
- [x] **Select the rest by clicking:** a part's own label selects its part, a screw selects it on the Screws tab, and the plate's
  split, the opening and the boxes of room kept in it have fields of their own to open at.
- [x] **A right-click menu in the view:** rotate, duplicate, make an array, delete, add a label, or move to another surface, for a part; the
  same, as far as they apply, for a label, hole, vent, seam or plate item; and on a bare surface, wall or floor, add anything that
  can go there, put where it was clicked. **Make an array…** from it asks how many and how far apart, with the spacing filled in
  as the least that adds no problem.
- [x] **Keys for anything selected,** not only parts: the arrows nudge a label, hole, vent, seam or plate item, R turns a
  label or weight pocket, Delete removes it, and Ctrl+D copies it, or a part with its knob, cap and labels, beside the
  original where it adds no problem. None of them act while the focus is in a field.
- [x] **Click anything in the view to select it,** not only parts: a label, a hole or vent in a wall, a seam, something on the
  plate, or the surface or walls. The Shape tab opens at its fields, and it's lit up in the view. And the other way round:
  putting the cursor in its fields lights it up.
- [x] **Click in the view to choose where something goes.** Adding a part, label, hole, vent, seam, support, foot, weight
  pocket, pin or cable tie waits for a click on a surface, wall, the floor or the underside, and puts it there, with the
  surface or wall filled in from what was clicked.
- [x] **Parts on a curved surface,** each on a flat of its own let into the curve, as thick as the surface, with sloped
  sides so it needs no support. Its own label goes on the flat with it, and dragging it in the view follows the curve. And
  the view no longer draws a line at each of a curve's short flats.
- [x] **Curved outlines.** A surface's `bulge` makes it an arc seen from the side, built as short flats within 0.05 mm of
  it, which nothing can be mounted on. `bow` makes the front or rear wall bow outward seen from above, solid out to its curve
  with the inside left square, so nothing goes through one. Both build with seams and lips, and need no support by the app's
  own check. Not yet sliced or printed.
- [x] **A thickness of its own for each surface,** for its top panel or the shell's skin under it, with everything on it checked
  against that: cutouts, labels, tongues, creases, the seam's lip, knobs and the fit test.
- [x] **More than one seam,** for a shell wider than two beds. A piece between two seams stands on its left end to print, so a
  lip's end and its step slope at 45 degrees, and nothing needs support. The plate splits as few times as it needs, each joint
  off a seam, or where it's told, with a rib along each if asked. A round hole in a shell's own top, printed on its side, has
  a teardrop point now, but a rectangular one still needs support there.
- [x] **A lip along the seam,** set by its length: the left half's outer skin reaches past the seam over a step in the right half,
  with a 0.2 mm gap, so the joint line is hidden and the halves line up. Both halves still print without support. The Desk Synth
  V2 example has a 3 mm one. Not yet printed, so the gap is a guess.
- [x] **Key caps,** printed for a Cherry MX-style switch, now in the library: a flat top on a collar over its cross stem,
  printed top down without support. Its socket uses the knob's fit, with no fit test row of its own yet.
- [x] **Room for wires, their routes, and cable ties along them.** Each part keeps room where its wires leave it, they're routed
  across the floor to their board with lengths on the Print tab, and a button lays cable tie bridges along the routes. All of it
  only warns, and one tick turns it off. The library's plugs are estimates.
- [x] **Nothing left to support** on any part of the Desk Synth or the Dial deck, by the app's own check. Upright plate bosses
  rise from their wall at 45 degrees over a wedge on the plate. Upright top tabs take flat heads in countersinks, with
  teardrop bores, and go where their gusset fits where they can. Seam bolts' head bores are teardrops too, and a fin carries
  a rear tab's web up to the skin. The check now lets short roofs held at both ends bridge. Not yet sliced or printed.
- [x] **A hosted version,** on GitHub Pages, so that others can open a design's link.
- [x] **Inlaid labels in a second colour,** as a body of their own in the part's object in each bed's 3MF. Not yet opened in a
  slicer.
- [x] **Printed knobs** on a part's shafts, fluted with a pointer, and a row in the fit test for their D holes.
- [x] **Shareable links,** with the whole design compressed after the `#`, which load it when opened.
- [x] **A step-by-step assembly guide.** Each step on the Print tab shows just its parts, separated, with the rest faded.
- [x] **Cradles for more boards:** Teensy 4.0 and 4.1, Arduino Nano and Seeed XIAO, from their makers' sizes.
- [x] **Ergonomic checks.** Room for fingers between controls, and a screen tilted so it can be read, set by what's comfortable on
  the Desk Synth.
- [x] **Pin budgets.** The microcontroller's pins a design uses, through shift registers and the I2C bus, with an address for each
  part on the bus. The Desk Synth comes to the 9 its firmware uses.
- [x] **Rubber feet and weight pockets.** Shallow recesses under the plate for stick-on feet, four at the corners in one step,
  and walled pockets on it to glue weights into.
- [x] **A bevel on a window's face edge,** as on the Desk Synth's screen, measured from its printed fit test.
- [x] **Fewer supports on the Desk Synth.** The screwed crease meets where the pieces' undersides do, so Panel 1 needs none. Seam
  tabs slope all the way out to a rounded wall, and the front rail's screws are countersunk, so it needs none either.
- [x] **Round things checked as round** where a support goes, so the Desk Synth V2's three fit between its buttons. A round body
  under a slope is allowed for as it leans. Elsewhere, such as bosses and the crease flange, they still count as boxes.
- [x] **Sharing the bed.** Parts of each colour packed onto as few beds as they fit, on the Print tab and in the guide, with a 3MF
  for each bed that has its parts already placed.
- [x] **A part's STEP file as a reference,** shown see-through in the design, to measure and line up against. It isn't kept
  with the design yet, or used to make a part.
- [x] **Joints from the Desk Synth V2.** A tongue and groove where a top panel splits, a screwed flange where two top pieces meet at a
  crease, a rib that bolts the plate's pieces together, and supports from the plate up to the top. Posts for the perfboard and
  ADC boards, and the RP2350-Plus.
- [x] **Notched holes,** for the real arcade button keyway and the room for a screen's ribbon.
- [x] **Vents, and cable tie bridges** on the plate, which also do for strain relief.
- [x] **Version history.** Undo survives a reload, and versions can be kept by name, in the browser.
- [x] **Print time, filament and cost,** as a rough estimate from each part's shape, fitted to what the slicer says.
- [x] **Standoffs** from a board's mounting holes, in place of a cradle.
- [x] **Wall-mounted parts,** with a nut outside and a body behind the wall that everything else keeps clear of.
- [x] **More parts:** MIDI DIN and TRS jacks, panel-mount USB and DC sockets, faders and LEDs. Their sizes are estimates until measured.
- [x] **Test slices of the real design.** A corner of the shell, and both sides of the seam joint, in the fit test.
- [x] **Engraved labels.** On a surface or wall, or beside a part and moving with it. In a lettering of its own, in capitals.
- [x] **More fit test coverage.** The seam pin, wall holes, and a section of real shell wall. Pins on the plate aren't covered,
  because what they fit into isn't in the design.
- [x] **Print-ready exports.** Parts come out oriented for printing, in a bundle with the assembly steps, with the bed in view.
  The app works out how each part should print, finds overhangs, and shapes what it can for that.
- [x] **Section view.** A slider that slices through the model, to see tabs, bosses and clearances.
- [x] **Arrays, alignment and mirroring.** Place "2 x 4 at 30 mm" in one step.
- [x] Multi-hole custom parts in the form.
- [x] Measuring, and the spacing to the nearest neighbour while dragging.
- [x] Problems shown in the view, highlighting the exact spot.
- [x] Starting templates, such as a desktop wedge, a pedal or a small box.
- [x] **Which parts need reprinting.** After a change, list the parts that actually differ, and download just those.
- [x] **Printer profile.** Fit test results carry over to new designs, kept in the browser. Exporting one to a file isn't built.
