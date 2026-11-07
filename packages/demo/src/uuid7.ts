const hex = (n: number, digits: number) => n.toString(16).padStart(digits, "0");

/**
 * A UUIDv7 (RFC 9562) for the instant `at`: the 48-bit Unix time in milliseconds, then bits
 * from `rand`. `seq`, when given, fills the 12-bit rand_a field (the RFC's counter method), so
 * ids made in order within one millisecond also sort in that order.
 */
export function uuidv7At(at: Date, rand: () => number, seq?: number): string {
  const ms = at.getTime();
  if (!Number.isInteger(ms) || ms < 0 || ms > 0xffff_ffff_ffff) throw new RangeError("bad time");
  const randA = seq === undefined ? Math.floor(rand() * 0x1000) : seq & 0xfff;
  const variant = 0x8000 | Math.floor(rand() * 0x4000);
  const tail = hex(Math.floor(rand() * 0x1_0000_0000), 8) + hex(Math.floor(rand() * 0x1_0000), 4);
  const time = hex(ms, 12);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hex(randA, 3)}-${hex(variant, 4)}-${tail}`;
}
