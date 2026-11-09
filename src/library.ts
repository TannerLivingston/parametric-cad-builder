// Parts and fabrication defaults.
//
// "measured" parts come from the real Desk Synth: the reference bodies and printed
// panels in its Fusion model, read from the STL exports in
// the build's assembly manual meshes (exported 2026-10-17). Cutouts are the sizes
// modelled there, and they include that build's printing clearance.
//
// "estimated" parts aren't in that build, or have no reference body in the model.
// Their numbers haven't been checked against real hardware.
import { partSchema, type Material, type Part } from "./schema.js";

const raw: Record<string, unknown> = {
  "arcade-24mm": {
    name: "24 mm arcade button",
    control: "press",
    pins: { switches: 1 },
    source: "measured",
    mount: "panel",
    cutouts: [
      {
        kind: "circle",
        diameter: 24.24,
        // A keyway towards the rear, reaching 13 mm from the centre. The real one's sides slope in at
        // 45 degrees over its last 1.2 mm, and this steps instead.
        notches: [
          { width: 10.72, height: 4, at: [0, 9.9] },
          { width: 8.36, height: 1.5, at: [0, 12.25] },
        ],
      },
    ],
    above: { footprint: { shape: "circle", diameter: 26.4 }, height: 4.6 },
    below: { footprint: { shape: "circle", diameter: 23.2 }, depth: 22 },
    panelThickness: { max: 4 },
    notes:
      "The hole and its keyway are from the deck, but the body is not measured: its diameter comes from the assembly manual's drawing, and the 22 mm depth is the room the Desk Synth leaves under its deck. The 4 mm panel limit is an estimate.",
  },
  "ec11-dial-30mm": {
    name: "EC11 encoder with 30 mm dial (chord voicing)",
    control: "turn",
    pins: { direct: 2, switches: 1 },
    source: "measured",
    mount: "panel",
    cutouts: [{ kind: "circle", diameter: 7.4 }],
    above: { footprint: { shape: "circle", diameter: 30 }, height: 18.2 },
    below: { footprint: { shape: "rect", width: 12.5, height: 12.5 }, depth: 11.5 },
    notes: "Pushed up from below, with a washer and nut on top.",
  },
  "ec11-dial-19mm": {
    name: "EC11 encoder with 19 mm dial (bass voicing)",
    control: "turn",
    pins: { direct: 2, switches: 1 },
    source: "measured",
    mount: "panel",
    cutouts: [{ kind: "circle", diameter: 7.4 }],
    above: { footprint: { shape: "circle", diameter: 19 }, height: 18.2 },
    below: { footprint: { shape: "rect", width: 12.5, height: 12.5 }, depth: 11.5 },
    notes: "Pushed up from below, with a washer and nut on top.",
  },
  "ec11-encoder": {
    name: "EC11 encoder, 20 mm D shaft",
    pins: { direct: 2, switches: 1 },
    control: "turn",
    source: "datasheet",
    mount: "panel",
    cutouts: [{ kind: "circle", diameter: 7.4 }],
    shafts: [{ at: [0, 0], diameter: 6, flat: 4.5, length: 20 }],
    above: { footprint: { shape: "circle", diameter: 12 }, height: 17 },
    below: { footprint: { shape: "rect", width: 12.5, height: 12.5 }, depth: 11.5 },
    notes: "Alps' EC11E with a 20 mm shaft, measured from the face it's held by. Pushed up from below, with a washer and nut on top. Give it a knob, or put a bought one on. The hole is the Desk Synth's.",
  },
  "encoder-board-5752": {
    name: "Adafruit #5752 quad encoder board with 4 EC11s and 12 mm knobs",
    control: "turn",
    pins: { i2c: [0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50] },
    source: "measured",
    mount: "panel",
    cutouts: [
      { kind: "circle", diameter: 7.4, at: [-28.55, 0] },
      { kind: "circle", diameter: 7.4, at: [-9.55, 0] },
      { kind: "circle", diameter: 7.4, at: [9.55, 0] },
      { kind: "circle", diameter: 7.4, at: [28.55, 0] },
    ],
    above: { footprint: { shape: "rect", width: 69.1, height: 12 }, height: 15.5 },
    below: { footprint: { shape: "rect", width: 96.2, height: 21.6 }, depth: 11.4 },
    notes: "The body includes a STEMMA QT plug at each end.",
  },
  "oled-242-ssd1309": {
    name: "2.42 inch SSD1309 OLED (HiLetgo)",
    control: "screen",
    pins: { i2c: [0x3c, 0x3d] },
    source: "measured",
    mount: "panel",
    cutouts: [
      {
        kind: "rect",
        width: 57.6,
        height: 29.5,
        at: [0, 2.7],
        // Measured on the printed fit test: 59.1 mm wide at the face, down to the window by 0.8 mm deep.
        bevel: 0.75,
        // For the glass, with room at the front for its ribbon.
        recess: { width: 63.2, height: 39.5, skin: 1.6, at: [0, 0.75], notches: [{ width: 39, height: 1.4, at: [0, -19.5] }] },
      },
    ],
    posts: [
      { at: [-32.95, -21.8], diameter: 3.8, reach: 4.1, holeDiameter: 1.6, holeDepth: 2.6 },
      { at: [32.95, -21.8], diameter: 3.8, reach: 4.1, holeDiameter: 1.6, holeDepth: 2.6 },
      { at: [-32.95, 21.8], diameter: 3.8, reach: 4.1, holeDiameter: 1.6, holeDepth: 2.6 },
      { at: [32.95, 21.8], diameter: 3.8, reach: 4.1, holeDiameter: 1.6, holeDepth: 2.6 },
    ],
    above: { footprint: { shape: "rect", width: 57.6, height: 29.5 }, height: 0 },
    below: { footprint: { shape: "rect", width: 68.7, height: 47 }, depth: 11 },
    notes:
      "The origin is the centre of the PCB, which screws to four posts with M2 x 5 screws. The 11 mm depth is the header at the rear edge, and the PCB itself is only 2 mm, so this box is cautious near the front. The recess, its notch and the posts are from the printed Desk Synth panel. The real posts sit a little off-centre around their holes.",
  },
  "rp2040-plus": {
    name: "Waveshare RP2040-Plus",
    pins: { gpio: 26, analogPins: 3 },
    source: "measured",
    mount: "floor",
    footprint: { shape: "rect", width: 51, height: 21 },
    height: 13.5,
    port: { side: "left", z: 10.6, width: 14, height: 8.5, cornerRadius: 2 },
    holder: {
      underside: 8,
      thickness: 1,
      // Down the middle, so that every pin hole is clear underneath. The real Desk Synth's sit in the
      // corners, under 12 pins. These also stay off the four corner mounting holes.
      pads: [
        { at: [-21, 0], width: 4, height: 9 },
        { at: [0, 0], width: 4, height: 9 },
        { at: [22, 0], width: 4, height: 9 },
      ],
      stops: [{ at: [26.8, 0], width: 2.2, height: 6 }],
      clips: [{ at: -9.6, length: 6 }, { at: 12.4, length: 6 }],
    },
    notes: "USB-C faces the left edge. The hole, clips and stop are copied from the Desk Synth, where the board snaps in from above. Fit header pins before snapping it in, since the plate blocks soldering from below, with their plastic underneath, because the barbs reach 0.8 mm over the top of the board.",
  },
  "perfboard-7x9": {
    name: "7 x 9 cm perfboard, populated",
    source: "measured",
    mount: "floor",
    footprint: { shape: "rect", width: 90, height: 70 },
    height: 19.6,
    // From the Desk Synth V2, for M2 self-tapping screws. Its corner holes are assumed to be 2.5 mm in
    // from each edge, which varies between makers.
    standoffs: [
      { at: [-42.5, -32.5], diameter: 6.5, holeDiameter: 1.6, height: 6 },
      { at: [42.5, -32.5], diameter: 6.5, holeDiameter: 1.6, height: 6 },
      { at: [-42.5, 32.5], diameter: 6.5, holeDiameter: 1.6, height: 6 },
      { at: [42.5, 32.5], diameter: 6.5, holeDiameter: 1.6, height: 6 },
    ],
    notes: "The height includes a 12 mm component envelope. Check the corner holes are 2.5 mm in from the edges, because boards vary.",
  },
  ads7830: {
    name: "Adafruit ADS7830 ADC board with STEMMA QT plug",
    pins: { i2c: [0x48, 0x49, 0x4a, 0x4b], analogInputs: 8 },
    source: "measured",
    mount: "floor",
    footprint: { shape: "rect", width: 17.7, height: 42.5 },
    height: 8.5,
    // The holes are from Adafruit's board file, and the posts from the Desk Synth V2. The footprint
    // includes a STEMMA QT plug at each end.
    standoffs: [
      { at: [-6.35, -12.7], diameter: 4.8, holeDiameter: 1.6, height: 3 },
      { at: [6.35, -12.7], diameter: 4.8, holeDiameter: 1.6, height: 3 },
      { at: [-6.35, 12.7], diameter: 4.8, holeDiameter: 1.6, height: 3 },
      { at: [6.35, 12.7], diameter: 4.8, holeDiameter: 1.6, height: 3 },
    ],
    notes: "Screws down with M2 x 4 screws, since the holes in its posts are 2.8 mm deep.",
  },

  "latch-button": {
    name: "12 mm latching push button",
    control: "press",
    pins: { switches: 1 },
    source: "estimated",
    mount: "panel",
    cutouts: [{ kind: "circle", diameter: 12.2 }],
    above: { footprint: { shape: "circle", diameter: 15 }, height: 6 },
    below: { footprint: { shape: "circle", diameter: 16 }, depth: 22 },
  },
  "pot-9mm": {
    name: "9 mm potentiometer",
    control: "turn",
    pins: { analog: 1 },
    source: "estimated",
    mount: "panel",
    cutouts: [{ kind: "circle", diameter: 7.2 }],
    above: { footprint: { shape: "circle", diameter: 22 }, height: 18 },
    below: { footprint: { shape: "rect", width: 12, height: 14 }, depth: 14 },
    panelThickness: { max: 4 },
    notes: "Above-panel footprint is the knob, so it sets the spacing between dials.",
  },
  ttp223: {
    name: "TTP223 capacitive touch module",
    control: "touch",
    pins: { switches: 1 },
    source: "estimated",
    mount: "panel",
    cutouts: [{ kind: "pocket", width: 16, height: 12, skin: 1 }],
    above: { footprint: { shape: "rect", width: 16, height: 12 }, height: 0 },
    below: { footprint: { shape: "rect", width: 16, height: 12 }, depth: 4 },
    notes: "Senses through the skin, so the pocket is blind. Skin thickness affects sensitivity.",
  },
  "oled-ssd1306": {
    name: "0.96 inch SSD1306 I2C OLED, 4-pin",
    control: "screen",
    pins: { i2c: [0x3c, 0x3d] },
    source: "datasheet",
    mount: "panel",
    cutouts: [
      {
        kind: "rect",
        width: 24,
        height: 13,
        at: [0, 2.1],
        // For the glass, with room at the front for its ribbon, and at the rear for the header's solder tails.
        recess: {
          width: 27.3,
          height: 20,
          skin: 1.5,
          at: [0, 0],
          notches: [
            { width: 15.2, height: 4.6, at: [0, -12.1] },
            { width: 10.3, height: 3.9, at: [0, 11.75] },
          ],
        },
      },
    ],
    posts: [
      { at: [-11.65, -11.9], diameter: 3.5, reach: 3, holeDiameter: 1.6, holeDepth: 2.2 },
      { at: [11.65, -11.9], diameter: 3.5, reach: 3, holeDiameter: 1.6, holeDepth: 2.2 },
      { at: [-11.65, 11.9], diameter: 3.5, reach: 3, holeDiameter: 1.6, holeDepth: 2.2 },
      { at: [11.65, 11.9], diameter: 3.5, reach: 3, holeDiameter: 1.6, holeDepth: 2.2 },
    ],
    above: { footprint: { shape: "rect", width: 24, height: 13 }, height: 0 },
    below: { footprint: { shape: "rect", width: 27.3, height: 27.8 }, depth: 10 },
    panelThickness: { max: 3 },
    notes:
      "From the MC096 drawing, and these boards vary between makers, so check yours. The origin is the centre of the PCB, whose face rests on the back of a 3 mm panel, with the glass in the recess. The screws are M2 x 3, because the holes only have 3.4 mm with the PCB. The 10 mm depth is the header at the rear edge.",
  },
  "midi-din-5": {
    name: "5-pin MIDI DIN socket",
    pins: { direct: 1 },
    source: "estimated",
    mount: "wall",
    holes: [
      { width: 15.5, height: 15.5, cornerRadius: 7.75, at: [0, 0] },
      { width: 3.2, height: 3.2, cornerRadius: 1.6, at: [-11.1, 0] },
      { width: 3.2, height: 3.2, cornerRadius: 1.6, at: [11.1, 0] },
    ],
    body: { width: 21, height: 21, depth: 22 },
    outside: { width: 30, height: 20 },
    notes: "Screw spacing varies between makers, so check the real part. Allow room behind it for the wires.",
  },
  "trs-35-panel": {
    name: "3.5 mm TRS panel jack",
    source: "estimated",
    mount: "wall",
    holes: [{ width: 6.2, height: 6.2, cornerRadius: 3.1, at: [0, 0] }],
    body: { width: 12, height: 12, depth: 18 },
    outside: { width: 10, height: 10 },
    maxWall: 4,
    notes: "Check its thread reaches through the wall with room for the nut.",
  },
  "trs-635-panel": {
    name: "6.35 mm jack, panel mount",
    source: "estimated",
    mount: "wall",
    holes: [{ width: 9.5, height: 9.5, cornerRadius: 4.75, at: [0, 0] }],
    body: { width: 18, height: 21, depth: 32 },
    outside: { width: 15, height: 15 },
    maxWall: 4,
    notes: "Check its thread reaches through the wall with room for the nut.",
  },
  "usb-c-panel": {
    name: "Panel-mount USB-C socket with screws",
    source: "estimated",
    mount: "wall",
    holes: [
      { width: 10.5, height: 4.5, cornerRadius: 2, at: [0, 0] },
      { width: 3.2, height: 3.2, cornerRadius: 1.6, at: [-14, 0] },
      { width: 3.2, height: 3.2, cornerRadius: 1.6, at: [14, 0] },
    ],
    body: { width: 15, height: 9, depth: 30 },
    outside: { width: 36, height: 10 },
    notes: "These vary a lot, and the cable leaves the back, so measure the real one.",
  },
  "dc-barrel-panel": {
    name: "DC barrel socket, panel mount",
    source: "estimated",
    mount: "wall",
    holes: [{ width: 8.2, height: 8.2, cornerRadius: 4.1, at: [0, 0] }],
    body: { width: 12, height: 12, depth: 20 },
    outside: { width: 12, height: 12 },
    maxWall: 4,
  },
  "led-3mm": {
    name: "3 mm LED",
    pins: { direct: 1 },
    source: "estimated",
    mount: "panel",
    cutouts: [{ kind: "circle", diameter: 3.2, at: [0, 0] }],
    above: { footprint: { shape: "circle", diameter: 3.2 }, height: 2 },
    below: { footprint: { shape: "circle", diameter: 5 }, depth: 6 },
  },
  "led-5mm": {
    name: "5 mm LED",
    pins: { direct: 1 },
    source: "estimated",
    mount: "panel",
    cutouts: [{ kind: "circle", diameter: 5.2, at: [0, 0] }],
    above: { footprint: { shape: "circle", diameter: 5.2 }, height: 3 },
    below: { footprint: { shape: "circle", diameter: 7 }, depth: 7 },
  },
  "fader-60mm": {
    name: "60 mm slide fader",
    control: "slide",
    pins: { analog: 1 },
    source: "estimated",
    mount: "panel",
    cutouts: [
      { kind: "rect", width: 3, height: 66, cornerRadius: 1.4, at: [0, 0] },
      { kind: "circle", diameter: 3.2, at: [0, -39.5] },
      { kind: "circle", diameter: 3.2, at: [0, 39.5] },
    ],
    above: { footprint: { shape: "rect", width: 16, height: 90 }, height: 12 },
    below: { footprint: { shape: "rect", width: 10, height: 88 }, depth: 14 },
    notes: "Screw spacing varies between makers, so check the real part.",
  },
  "pico-rp2350": {
    name: "Raspberry Pi Pico 2 (RP2350)",
    pins: { gpio: 26, analogPins: 3 },
    source: "estimated",
    mount: "floor",
    footprint: { shape: "rect", width: 21, height: 51 },
    height: 12,
    standoffs: [
      { at: [-5.7, -23.5], diameter: 4.5, holeDiameter: 1.7, height: 4 },
      { at: [5.7, -23.5], diameter: 4.5, holeDiameter: 1.7, height: 4 },
      { at: [-5.7, 23.5], diameter: 4.5, holeDiameter: 1.7, height: 4 },
      { at: [5.7, 23.5], diameter: 4.5, holeDiameter: 1.7, height: 4 },
    ],
    notes: "Stands on four posts, with M2 screws through its mounting holes.",
  },
  "pi-zero": {
    name: "Raspberry Pi Zero",
    pins: { gpio: 26, analogPins: 0 },
    source: "datasheet",
    mount: "floor",
    footprint: { shape: "rect", width: 65, height: 30 },
    height: 12,
    standoffs: [
      { at: [-29, -11.5], diameter: 5, holeDiameter: 2.2, height: 4 },
      { at: [29, -11.5], diameter: 5, holeDiameter: 2.2, height: 4 },
      { at: [-29, 11.5], diameter: 5, holeDiameter: 2.2, height: 4 },
      { at: [29, 11.5], diameter: 5, holeDiameter: 2.2, height: 4 },
    ],
    notes: "Stands on four posts, with M2.5 screws through its mounting holes. Allow room for what plugs into it.",
  },
  "arduino-uno": {
    name: "Arduino Uno",
    pins: { gpio: 20, analogPins: 6 },
    source: "datasheet",
    mount: "floor",
    footprint: { shape: "rect", width: 68.6, height: 53.4 },
    height: 20,
    standoffs: [
      { at: [-20.3, -24.2], diameter: 5.5, holeDiameter: 2.5, height: 4 },
      { at: [31.8, -19.1], diameter: 5.5, holeDiameter: 2.5, height: 4 },
      { at: [31.8, 8.8], diameter: 5.5, holeDiameter: 2.5, height: 4 },
      { at: [-19, 24], diameter: 5.5, holeDiameter: 2.5, height: 4 },
    ],
    notes: "Stands on four posts, with M3 screws through its mounting holes. Its USB and power sockets aren't given holes here, so add those to the wall.",
  },
  "teensy-40": {
    name: "PJRC Teensy 4.0",
    pins: { gpio: 24, analogPins: 10 },
    source: "datasheet",
    mount: "floor",
    footprint: { shape: "rect", width: 35.56, height: 17.78 },
    height: 13.5,
    port: { side: "left", z: 11.2, width: 12, height: 8, cornerRadius: 2 },
    holder: {
      underside: 8,
      thickness: 1.6,
      // Down the middle, between the rows of header pins under the board.
      pads: [
        { at: [-12.78, 0], width: 4, height: 8 },
        { at: [0, 0], width: 4, height: 8 },
        { at: [12.78, 0], width: 4, height: 8 },
      ],
      stops: [{ at: [19.08, 0], width: 2.2, height: 6 }],
      clips: [{ at: -8, length: 5 }, { at: 8, length: 5 }],
    },
    notes: "The size is PJRC's. The cradle is laid out like the RP2040-Plus's, for headers soldered with their plastic underneath, and its USB faces the left edge. Check the board's thickness, and print a fit test for the clips.",
  },
  "teensy-41": {
    name: "PJRC Teensy 4.1",
    pins: { gpio: 42, analogPins: 18 },
    source: "datasheet",
    mount: "floor",
    footprint: { shape: "rect", width: 60.96, height: 17.78 },
    height: 13.5,
    port: { side: "left", z: 11.2, width: 12, height: 8, cornerRadius: 2 },
    holder: {
      underside: 8,
      thickness: 1.6,
      // Down the middle, between the rows of header pins under the board.
      pads: [
        { at: [-25.48, 0], width: 4, height: 8 },
        { at: [0, 0], width: 4, height: 8 },
        { at: [25.48, 0], width: 4, height: 8 },
      ],
      stops: [{ at: [31.78, 0], width: 2.2, height: 6 }],
      clips: [{ at: -15, length: 5 }, { at: 15, length: 5 }],
    },
    notes: "The size is PJRC's. The cradle is laid out like the RP2040-Plus's, for headers soldered with their plastic underneath, and its USB faces the left edge. An SD card in its slot at the right end sticks out past the stop. Check the board's thickness, and print a fit test for the clips.",
  },
  "arduino-nano": {
    name: "Arduino Nano",
    pins: { gpio: 20, analogPins: 8 },
    source: "datasheet",
    mount: "floor",
    footprint: { shape: "rect", width: 45, height: 18 },
    height: 14,
    port: { side: "left", z: 11.2, width: 13, height: 9, cornerRadius: 2 },
    holder: {
      underside: 8,
      thickness: 1.6,
      // Down the middle, between the rows of header pins under the board.
      pads: [
        { at: [-17.5, 0], width: 4, height: 8 },
        { at: [0, 0], width: 4, height: 8 },
        { at: [17.5, 0], width: 4, height: 8 },
      ],
      stops: [{ at: [23.8, 0], width: 2.2, height: 6 }],
      clips: [{ at: -10, length: 5 }, { at: 10, length: 5 }],
    },
    notes: "The size is Arduino's. The cradle is laid out like the RP2040-Plus's, for headers soldered with their plastic underneath, and its USB faces the left edge. A6 and A7 only read analog, so they're among its analog pins, not its 20. Print a fit test for the clips.",
  },
  "seeed-xiao": {
    name: "Seeed Studio XIAO",
    pins: { gpio: 11, analogPins: 4 },
    source: "datasheet",
    mount: "floor",
    footprint: { shape: "rect", width: 21, height: 17.8 },
    height: 12.5,
    port: { side: "left", z: 10.8, width: 14, height: 8.5, cornerRadius: 2 },
    holder: {
      underside: 8,
      thickness: 1.2,
      // Down the middle, between the rows of header pins under the board.
      pads: [
        { at: [-6.5, 0], width: 4, height: 8 },
        { at: [6.5, 0], width: 4, height: 8 },
      ],
      stops: [{ at: [11.8, 0], width: 2.2, height: 6 }],
      clips: [{ at: -4, length: 5 }, { at: 4, length: 5 }],
    },
    notes: "The size is Seeed's, the same for each XIAO. The cradle is laid out like the RP2040-Plus's, for headers soldered with their plastic underneath, and its USB-C faces the left edge. Check the board's thickness, and print a fit test for the clips.",
  },
  "mx-switch": {
    name: "Cherry MX-style key switch",
    source: "datasheet",
    pins: { switches: 1 },
    mount: "panel",
    control: "press",
    // A 14 mm square hole, through a 1.5 mm skin that a recess from below leaves, for its clips.
    cutouts: [{ kind: "rect", width: 14, height: 14, recess: { width: 15.6, height: 15.6, skin: 1.5 } }],
    above: { footprint: { shape: "rect", width: 15.6, height: 15.6 }, height: 6.6 },
    below: { footprint: { shape: "rect", width: 14, height: 14 }, depth: 5.3 },
    stems: [{ top: 11.6, cross: [4, 1.2], housing: 6.6 }],
    notes: "Cherry's sizes. It clips into the skin from above, and the body below, with its pins, is for a 3 mm panel. Give it a printed cap, whose stem socket fabrication.fit.knobHole loosens, or put a bought one on.",
  },
  "shift-74hc165": {
    name: "74HC165 shift register breakout",
    pins: { shiftInputs: 8 },
    source: "estimated",
    mount: "floor",
    footprint: { shape: "rect", width: 20, height: 30 },
    height: 12,
  },
};

// The same outline, USB-C socket and holes as the RP2040-Plus, by Waveshare's drawings, and the Desk Synth
// V2 holds it in the same cradle.
raw["rp2350-plus"] = {
  ...(raw["rp2040-plus"] as object),
  name: "Waveshare RP2350-Plus",
  source: "datasheet",
};

// Where each part's wires leave it, for keeping room there and routing them: see wireExitSchema.
// These are estimates from typical parts, not measurements, so the checks on them only warn.
// Dupont plugs on header pins stand about 14 mm, a microswitch's quick-connect tabs and their
// plugs about 12, soldered wires about 8 before they can bend, and a STEMMA QT plug about 10.
const headerRows = (width: number, depth: number) => [
  { side: "up", at: [0, depth / 2 - 1.3], width, height: 2.6, room: 14 },
  { side: "up", at: [0, -depth / 2 + 1.3], width, height: 2.6, room: 14 },
];
const WIRES: Record<string, object[]> = {
  // Its depth is all the room the Desk Synth leaves under its deck, 0.3 mm short of the plate, so it
  // takes in the switch's plugs already, and the wires bend as they leave them.
  "arcade-24mm": [{ side: "down", width: 20, height: 12, room: 0 }],
  "ec11-dial-30mm": [{ side: "down", width: 12.5, height: 7, room: 10 }],
  "ec11-dial-19mm": [{ side: "down", width: 12.5, height: 7, room: 10 }],
  "ec11-encoder": [{ side: "down", width: 12.5, height: 7, room: 10 }],
  "encoder-board-5752": [
    { side: "left", at: [0, 4], width: 6, height: 4, room: 10 },
    { side: "right", at: [0, 4], width: 6, height: 4, room: 10 },
  ],
  // Its header can be wired straight down, or out past the end of the board with a right-angle plug,
  // whose housing is about 6 mm before the wires bend away.
  "oled-242-ssd1309": [
    { side: "down", at: [-31, 0], width: 4, height: 20, room: 14 },
    { side: "left", at: [0, 5.5], width: 20, height: 6, room: 10 },
  ],
  "oled-ssd1306": [{ side: "down", at: [0, 11.5], width: 11, height: 3, room: 14 }],
  "latch-button": [{ side: "down", width: 16, height: 16, room: 10 }],
  "pot-9mm": [{ side: "down", at: [0, -6], width: 10, height: 3, room: 8 }],
  ttp223: [{ side: "down", at: [0, -5], width: 8, height: 3, room: 14 }],
  "led-3mm": [{ side: "down", width: 5, height: 3, room: 8 }],
  "led-5mm": [{ side: "down", width: 7, height: 3, room: 8 }],
  "fader-60mm": [
    { side: "down", at: [0, -40], width: 8, height: 4, room: 8 },
    { side: "down", at: [0, 40], width: 8, height: 4, room: 8 },
  ],
  "rp2040-plus": headerRows(51, 21),
  "pico-rp2350": [
    { side: "up", at: [9.2, 0], width: 2.6, height: 51, room: 14 },
    { side: "up", at: [-9.2, 0], width: 2.6, height: 51, room: 14 },
  ],
  "pi-zero": [{ side: "up", at: [0, 11.5], width: 51, height: 5.2, room: 14 }],
  "arduino-uno": headerRows(60, 50),
  "teensy-40": headerRows(35.56, 17.78),
  "teensy-41": headerRows(60.96, 17.78),
  "arduino-nano": headerRows(45, 18),
  "seeed-xiao": headerRows(21, 17.8),
  ads7830: [
    { side: "front", at: [0, 5], width: 6, height: 4, room: 10 },
    { side: "rear", at: [0, 5], width: 6, height: 4, room: 10 },
  ],
  "shift-74hc165": [{ side: "up", at: [0, 13.7], width: 18, height: 2.6, room: 14 }],
  "mx-switch": [{ side: "down", width: 10, height: 6, room: 8 }],
  "midi-din-5": [{ side: "back", width: 16, height: 12, room: 12 }],
  "trs-35-panel": [{ side: "back", width: 10, height: 10, room: 10 }],
  "trs-635-panel": [{ side: "back", width: 14, height: 14, room: 12 }],
  "usb-c-panel": [{ side: "back", width: 12, height: 6, room: 25 }],
  "dc-barrel-panel": [{ side: "back", width: 10, height: 10, room: 10 }],
};
WIRES["rp2350-plus"] = WIRES["rp2040-plus"]!;

// A plug at each end, of which one will do.
const EITHER_END = new Set(["encoder-board-5752", "ads7830", "oled-242-ssd1309"]);

export const library: Record<string, Part> = Object.fromEntries(
  Object.entries(raw).map(([id, part]) => [id, partSchema.parse(WIRES[id] ? { ...(part as object), wires: WIRES[id], ...(EITHER_END.has(id) ? { wiresFrom: "any" } : {}) } : part)]),
);

// Starting points for a 0.4 mm nozzle, not test results. A fit-test print should
// replace them. Web is the plastic left between two cutouts or a cutout and a wall.
export const materials: Record<Material, { minWall: number; minWeb: number; minSkin: number }> = {
  PETG: { minWall: 1.6, minWeb: 1.2, minSkin: 0.6 },
  "PETG-GF": { minWall: 2, minWeb: 1.6, minSkin: 0.8 },
};
