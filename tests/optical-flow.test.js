const of = require('../src/renderer/pet/optical-flow');

// Build two 40x40 RGBA frames: a white block that shifts +5px in x between A and B.
function makeFrames() {
  const W = 40, H = 40;
  function frame(blockX) {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inside = x >= blockX && x < blockX + 10 && y >= 12 && y < 22;
        const v = inside ? 255 : 0;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    return d;
  }
  return { W, H, a: frame(10), b: frame(15) };
}

describe('optical-flow pure functions', () => {
  const { W, H, a, b } = makeFrames();

  test('grayOf preserves shape and luminance', () => {
    const g = of.grayOf(a, W, H);
    expect(g.length).toBe(W * H);
    expect(g[12 * W + 15]).toBeGreaterThan(200); // white block
    expect(g[5 * W + 5]).toBeLessThan(20);        // black bg
  });

  test('computeFlow recovers the +5px horizontal shift', () => {
    const aG = of.grayOf(a, W, H);
    const bG = of.grayOf(b, W, H);
    const flow = of.computeFlow(aG, bG, W, H, { quality: 'fast' });
    expect(flow.fx.length).toBe(W * H);

    // Inside the block (x 12..18, y 14..20) the flow should point +x ≈ 5
    let sum = 0, n = 0;
    for (let y = 14; y < 20; y++)
      for (let x = 12; x < 18; x++) { sum += flow.fx[y * W + x]; n++; }
    const mean = sum / n;
    expect(mean).toBeGreaterThan(3);   // recovered rightward motion
    expect(mean).toBeLessThan(7);

    // Background should be ~stationary
    let bsum = 0, bn = 0;
    for (let y = 2; y < 8; y++)
      for (let x = 2; x < 8; x++) { bsum += Math.abs(flow.fx[y * W + x]); bn++; }
    expect(bsum / bn).toBeLessThan(1.5);
  });

  test('warpRGBA forward by the flow moves the block onto B', () => {
    const aG = of.grayOf(a, W, H);
    const bG = of.grayOf(b, W, H);
    const flow = of.computeFlow(aG, bG, W, H, { quality: 'fast' });
    const warped = of.warpRGBA(a, W, H, flow.fx, flow.fy, 1);
    // At a point clearly inside B's block, warped pixel should be bright
    const i = (17 * W + 19) * 4;
    expect(warped[i]).toBeGreaterThan(180);
  });

  test('interpolatePair returns ~A at t=0 and ~B at t=1', () => {
    const aG = of.grayOf(a, W, H);
    const bG = of.grayOf(b, W, H);
    const flow = of.computeFlow(aG, bG, W, H, { quality: 'fast' });
    const at0 = of.interpolatePair(a, b, W, H, 0, flow);
    const at1 = of.interpolatePair(a, b, W, H, 1, flow);
    // t=0 ≈ a: pixel inside A block bright, t=1 ≈ b: pixel inside B block bright
    expect(at0[(17 * W + 12) * 4]).toBeGreaterThan(180); // A block location
    expect(at1[(17 * W + 19) * 4]).toBeGreaterThan(180); // B block location
  });
});
