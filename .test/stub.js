// Minimal browser stubs so game.js can run headless under Node for testing.
function makeCtx2D() {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeCtx2D() };
}
const __canvas = makeCanvas();
const document = {
  getElementById: () => __canvas,
  createElement: () => makeCanvas(),
};
let __rafCb = null;
const window = {
  addEventListener: () => {},
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 800,
};
const requestAnimationFrame = (cb) => { __rafCb = cb; };
class Path2D {
  moveTo() {} lineTo() {} closePath() {}
}
