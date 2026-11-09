# Wishlist

Ideas to come back to, grouped by what they're for. Only the Centauri Carbon 2 matters for now, until a print from it has
proven the numbers. Move an item to the done list once it's built.

## Faster designing

- [ ] Describing a design in words, with the validator still judging the result.

## Shape

- [ ] Curved outlines, and more than one panel thickness.
- [ ] Stepped seams.

## Set aside

- Full parts list. Not for now.
- Printers other than the Centauri Carbon 2. Not until this one is proven.

## Done

- [x] **More than one seam,** for a shell wider than two beds. A piece between two seams stands on its left end to print, so a
  lip's end and its step slope at 45 degrees, and nothing needs support. The plate splits as few times as it needs, each joint
  off a seam, or where it's told, with a rib along each if asked. A round hole in a shell's own top skin still needs a little
  support when it prints on its side, as it did before.
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
