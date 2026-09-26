import { createHmac } from 'node:crypto';
// Counter-based, reproducible, versioned server RNG. No client seed or dice formula.
export function randomSource(seed:string) {
  if (!/^[a-f0-9]{64}$/.test(seed)) throw new Error('Invalid simulation seed');
  let counter = 0;
  return {
    integer(maxExclusive:number) {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x100000000) throw new Error('Invalid random range');
      const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
      while (true) {
        const draw = createHmac('sha256', Buffer.from(seed,'hex')).update(String(counter++)).digest().readUInt32BE(0);
        if (draw < limit) return draw % maxExclusive;
      }
    },
    get draws() { return counter; }
  };
}
