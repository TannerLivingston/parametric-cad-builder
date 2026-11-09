// How many of the microcontroller's pins a design uses, and an I2C address for each part on the bus.
// Switches go through any shift registers first, three pins for the whole chain, and analog inputs
// use the microcontroller's own analog pins first, then any analog boards on the bus.
import type { Part } from "./schema.js";

export const SHIFT_REGISTER_PINS = 3; // clock, data and latch, shared along the chain
export const SHIFT_REGISTER_INPUTS = 8; // a 74HC165's
export const I2C_PINS = 2;

export interface PinUse {
  what: string;
  pins: number;
}

export interface PinBudget {
  controller: string; // the microcontroller's id
  gpio: number;
  used: number;
  uses: PinUse[];
  addresses: { id: string; address: number }[];
  // What doesn't fit: switches or analog inputs left over, and parts without an address.
  unaddressed: string[];
  analogShort: number;
}

export interface PinPart {
  id: string;
  part: Pick<Part, "pins">;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function planPins(parts: PinPart[], ownShiftRegisters: number): PinBudget | null {
  const controller = parts.find((p) => p.part.pins?.gpio !== undefined);
  if (!controller) return null;
  const others = parts.filter((p) => p !== controller);
  const sum = (key: "switches" | "direct" | "analog" | "shiftInputs" | "analogInputs") => others.reduce((total, p) => total + (p.part.pins?.[key] ?? 0), 0);
  const uses: PinUse[] = [];

  const switches = sum("switches");
  const shiftInputs = sum("shiftInputs") + ownShiftRegisters * SHIFT_REGISTER_INPUTS;
  const shifted = Math.min(switches, shiftInputs);
  if (shiftInputs > 0) uses.push({ what: `Shift registers, for ${plural(shifted, "switch", "switches")} of ${shiftInputs} inputs`, pins: SHIFT_REGISTER_PINS });
  if (switches > shifted) uses.push({ what: plural(switches - shifted, "switch", "switches") + (shiftInputs > 0 ? " past the shift registers" : ""), pins: switches - shifted });

  const direct = others.filter((p) => (p.part.pins?.direct ?? 0) > 0);
  if (direct.length) uses.push({ what: `${direct.map((p) => p.id).join(", ")}, wired straight in`, pins: sum("direct") });

  const onBus = others.filter((p) => p.part.pins?.i2c?.length);
  const addresses = assignAddresses(onBus);
  if (onBus.length) uses.push({ what: `The I2C bus, for ${plural(onBus.length, "part")}`, pins: I2C_PINS });

  const analog = sum("analog");
  const ownAnalog = Math.min(analog, controller.part.pins?.analogPins ?? 0);
  if (ownAnalog > 0) uses.push({ what: plural(ownAnalog, "analog input"), pins: ownAnalog });
  const onBoards = Math.min(analog - ownAnalog, sum("analogInputs"));

  return {
    controller: controller.id,
    gpio: controller.part.pins!.gpio!,
    used: uses.reduce((total, use) => total + use.pins, 0),
    uses,
    addresses,
    unaddressed: onBus.filter((p) => !addresses.some((a) => a.id === p.id)).map((p) => p.id),
    analogShort: analog - ownAnalog - onBoards,
  };
}

// The first address for each part that leaves the others one, trying the most constrained first.
// Parts that can't all be fitted get none, so they can be named.
function assignAddresses(parts: PinPart[]): { id: string; address: number }[] {
  const order = [...parts].sort((a, b) => a.part.pins!.i2c!.length - b.part.pins!.i2c!.length);
  const taken = new Map<number, string>();
  const fit = (i: number): boolean => {
    if (i === order.length) return true;
    const part = order[i]!;
    for (const address of part.part.pins!.i2c!) {
      if (taken.has(address)) continue;
      taken.set(address, part.id);
      if (fit(i + 1)) return true;
      taken.delete(address);
    }
    return false;
  };
  if (!fit(0)) {
    // Place as many as will go, in order, and leave the rest out.
    taken.clear();
    for (const part of order) {
      const free = part.part.pins!.i2c!.find((address) => !taken.has(address));
      if (free !== undefined) taken.set(free, part.id);
    }
  }
  return parts.flatMap((p) => {
    const found = [...taken].find(([, id]) => id === p.id);
    return found ? [{ id: p.id, address: found[0] }] : [];
  });
}

export function hex(address: number): string {
  return `0x${address.toString(16).padStart(2, "0")}`;
}
