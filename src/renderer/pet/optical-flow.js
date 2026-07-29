'use strict';
/*
 * Optical-flow frame interpolation for the desk-pet renderer.
 *
 * Goal: reduce the "stutter" of low-FPS hand-drawn sprite clips by synthesising
 * intermediate frames between every pair of key frames using dense optical flow
 * (a compact single-scale Lucas–Kanade / Farneback-style estimator).
 *
 * The pure math (grayOf / computeFlow / warpRGBA / interpolatePair) operates on
 * raw typed arrays and is unit-testable under Node (no DOM). The high-level
 * buildInterpolatedImages() helper uses <canvas> and is only invoked in the
 * browser renderer.
 */

// ── Pixel helpers ──────────────────────────────────────────────────

function grayOf(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const k = i * 4;
    // Rec. 601 luma, ignoring fully-transparent pixels
    const a = rgba[k + 3] / 255;
    out[i] = (0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2]) * a;
  }
  return out;
}

function downsample(g, w, h, dw, dh) {
  const o = new Float32Array(dw * dh);
  const sx = w / dw, sy = h / dh;
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor(y * sy), sy1 = Math.min(h - 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor(x * sx), sx1 = Math.min(w - 1, Math.floor((x + 1) * sx));
      let s = 0, c = 0;
      for (let yy = sy0; yy <= sy1; yy++)
        for (let xx = sx0; xx <= sx1; xx++) { s += g[yy * w + xx]; c++; }
      o[y * dw + x] = s / c;
    }
  }
  return o;
}

function upsample(f, fw, fh, w, h) {
  const o = new Float32Array(w * h);
  const sx = fw / w, sy = fh / h;
  for (let y = 0; y < h; y++) {
    const fy = y * sy, y0 = Math.floor(fy), y1 = Math.min(fh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * sx, x0 = Math.floor(fx), x1 = Math.min(fw - 1, x0 + 1), tx = fx - x0;
      const a = f[y0 * fw + x0], b = f[y0 * fw + x1], c = f[y1 * fw + x0], d = f[y1 * fw + x1];
      o[y * w + x] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    }
  }
  return o;
}

function blurGray(g, w, h) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          s += g[yy * w + xx]; c++;
        }
      }
      o[y * w + x] = s / c;
    }
  }
  return o;
}

// ── Dense optical flow (single-scale Lucas–Kanade over a window) ────

function denseLK(a, b, w, h, win) {
  const N = w * h;
  const Ix = new Float32Array(N), Iy = new Float32Array(N), It = new Float32Array(N);
  const at = (g, x, y) => g[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      Ix[i] = (at(a, x + 1, y) - at(a, x - 1, y)) * 0.5;
      Iy[i] = (at(a, x, y + 1) - at(a, x, y - 1)) * 0.5;
      It[i] = b[i] - a[i];
    }
  }

  const fx = new Float32Array(N), fy = new Float32Array(N);
  const r = win;
  const MAX = 40; // clamp to avoid pathological flow
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let Sxx = 0, Sxy = 0, Syy = 0, Sxt = 0, Syt = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const i = yy * w + xx;
          const ix = Ix[i], iy = Iy[i], it = It[i];
          Sxx += ix * ix; Sxy += ix * iy; Syy += iy * iy;
          Sxt += ix * it; Syt += iy * it;
        }
      }
      const det = Sxx * Syy - Sxy * Sxy;
      let u = 0, v = 0;
      if (Math.abs(det) > 1e-4) {
        u = (-Sxt * Syy + Sxy * Syt) / det;
        v = (Sxy * Sxt - Sxx * Syt) / det;
      }
      const m = Math.hypot(u, v);
      if (m > MAX) { u = u / m * MAX; v = v / m * MAX; }
      const i = y * w + x;
      fx[i] = u; fy[i] = v;
    }
  }
  return { fx, fy };
}

function computeFlow(aGray, bGray, w, h, opts = {}) {
  const target = opts.quality === 'fast' ? 96 : 160;
  const downscale = Math.max(1, Math.ceil(Math.max(w, h) / target));
  const dw = Math.max(1, Math.round(w / downscale));
  const dh = Math.max(1, Math.round(h / downscale));
  let aD = blurGray(downsample(aGray, w, h, dw, dh), dw, dh);
  let bD = blurGray(downsample(bGray, w, h, dw, dh), dw, dh);
  const coarse = denseLK(aD, bD, dw, dh, 2);
  // Refine at full resolution using the up-sampled coarse flow as a prior (2 iters)
  let fx = upsample(coarse.fx, dw, dh, w, h);
  let fy = upsample(coarse.fy, dw, dh, w, h);
  for (let iter = 0; iter < 2; iter++) {
    // Estimate the residual flow needed to align b onto a at the current flow,
    // then accumulate it (classic coarse-to-fine refinement).
    const resid = residualGray(aGray, bGray, w, h, fx, fy);
    const r2 = denseLK(resid.a, resid.b, w, h, 2);
    for (let i = 0; i < w * h; i++) { fx[i] += r2.fx[i]; fy[i] += r2.fy[i]; }
  }
  return { fx, fy };
}

// Build warped gray images for residual estimation at full res using current flow
function residualGray(aGray, bGray, w, h, fx, fy) {
  const aW = new Float32Array(w * h);
  const bW = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // warp a forward by (fx,fy)
      aW[i] = sample1(aGray, w, h, x - fx[i], y - fy[i]);
      // warp b backward by (fx,fy)
      bW[i] = sample1(bGray, w, h, x + fx[i], y + fy[i]);
    }
  }
  // residual = how much bW still needs to move to match aW → estimate delta
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (aW[i] - bW[i]) * 0.5; // unused directly
  return { a: aW, b: bW };
}

function sample1(g, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const a = g[Math.min(h - 1, Math.max(0, y0)) * w + Math.min(w - 1, Math.max(0, x0))];
  const b = g[Math.min(h - 1, Math.max(0, y0)) * w + x1];
  const c = g[y1 * w + Math.min(w - 1, Math.max(0, x0))];
  const d = g[y1 * w + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

// ── Backward warp (RGBA) ───────────────────────────────────────────

function warpRGBA(rgba, w, h, fx, fy, scale) {
  const o = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const sx = x - scale * fx[i];
      const sy = y - scale * fy[i];
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = x0 + 1, y1 = y0 + 1;
      const tx = sx - x0, ty = sy - y0;
      const cx0 = Math.min(w - 1, Math.max(0, x0));
      const cx1 = Math.min(w - 1, Math.max(0, x1));
      const cy0 = Math.min(h - 1, Math.max(0, y0));
      const cy1 = Math.min(h - 1, Math.max(0, y1));
      const a = i4(rgba, w, h, cx0, cy0), b = i4(rgba, w, h, cx1, cy0);
      const c = i4(rgba, w, h, cx0, cy1), d = i4(rgba, w, h, cx1, cy1);
      const oi = i * 4;
      for (let ch = 0; ch < 4; ch++) {
        o[oi + ch] = a[ch] * (1 - tx) * (1 - ty) + b[ch] * tx * (1 - ty)
                   + c[ch] * (1 - tx) * ty + d[ch] * tx * ty;
      }
    }
  }
  return o;
}

function i4(rgba, w, h, x, y) {
  const yy = Math.min(h - 1, Math.max(0, y));
  const xx = Math.min(w - 1, Math.max(0, x));
  const k = (yy * w + xx) * 4;
  return [rgba[k], rgba[k + 1], rgba[k + 2], rgba[k + 3]];
}

// ── Interpolate a single intermediate frame at t∈[0,1] ─────────────

function interpolatePair(aRGBA, bRGBA, w, h, t, flow) {
  const Aw = warpRGBA(aRGBA, w, h, flow.fx, flow.fy, t);
  const Bw = warpRGBA(bRGBA, w, h, flow.fx, flow.fy, t - 1);
  const o = new Float32Array(w * h * 4);
  for (let k = 0; k < o.length; k++) o[k] = (1 - t) * Aw[k] + t * Bw[k];
  return o;
}

// ── Browser helper: expand a list of <img> into interpolated <img> ─

function _decodeImg(img) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  if (img.decode) return img.decode().catch(() => {});
  return new Promise(res => {
    img.onload = () => res();
    img.onerror = () => res();
  });
}

async function buildInterpolatedImages(images, opts = {}) {
  const factor = Math.max(1, opts.factor || 2);
  if (factor < 2 || !images || images.length < 2) return images.slice();
  await Promise.all(images.map(_decodeImg));
  const w = images[0].naturalWidth, h = images[0].naturalHeight;
  if (!w || !h) return images.slice();

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const dataList = images.map(img => {
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  });

  const out = [];
  for (let i = 0; i < images.length; i++) {
    out.push(images[i]);
    if (i < images.length - 1 && factor > 1) {
      const a = dataList[i].data, b = dataList[i + 1].data;
      const aGray = grayOf(a, w, h), bGray = grayOf(b, w, h);
      const flow = computeFlow(aGray, bGray, w, h, { quality: opts.quality });
      for (let k = 1; k < factor; k++) {
        const t = k / factor;
        const interp = interpolatePair(a, b, w, h, t, flow);
        const c2 = document.createElement('canvas');
        c2.width = w; c2.height = h;
        const x2 = c2.getContext('2d');
        const id = new ImageData(new Uint8ClampedArray(interp.buffer), w, h);
        x2.putImageData(id, 0, 0);
        const im = new Image();
        im.src = c2.toDataURL('image/png');
        out.push(im);
      }
    }
  }
  await Promise.all(out.map(_decodeImg));
  return out;
}

const DEFAULTS = { enabled: false, factor: 2, quality: 'balanced' };

const api = {
  grayOf, downsample, upsample, blurGray, denseLK, computeFlow,
  warpRGBA, interpolatePair, buildInterpolatedImages, DEFAULTS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.opticalFlow = api;
}
