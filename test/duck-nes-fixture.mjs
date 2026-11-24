// Original NROM diagnostic: draw a white backdrop, enable a pulse channel,
// then copy controller port 2 into zero-page $10 for the Zapper assertions.
export function diagnosticCartridge() {
  const bytes = new Uint8Array(16 + 16384 + 8192);
  bytes.set([0x4e, 0x45, 0x53, 0x1a, 1, 1]);
  const program = [];
  function write(address, value) {
    program.push(0xa9, value, 0x8d, address & 255, address >> 8);
  }
  write(0x2006, 0x3f); write(0x2006, 0); write(0x2007, 0x30);
  write(0x2001, 0x0a);
  write(0x4015, 1); write(0x4000, 0xbf); write(0x4002, 0x50); write(0x4003, 0x08);
  const loop = 0x8000 + program.length;
  program.push(0xad, 0x17, 0x40, 0x85, 0x10, 0x4c, loop & 255, loop >> 8);
  bytes.set(program, 16);
  for (const vector of [0x3ffa, 0x3ffc, 0x3ffe]) bytes.set([0, 0x80], 16 + vector);
  return bytes;
}
