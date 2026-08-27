/** Preview ResizeObserver is silent; R3F never learns the canvas size. Fire once on observe. */

const g = globalThis as unknown as { __bayRoKick?: boolean };
if (typeof window !== "undefined" && !g.__bayRoKick) {
  g.__bayRoKick = true;
  const Orig = window.ResizeObserver;
  window.ResizeObserver = class ResizeObserver {
    private inner: globalThis.ResizeObserver;
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      this.inner = new Orig(cb);
    }
    observe(el: Element, opts?: ResizeObserverOptions) {
      this.inner.observe(el, opts);
      queueMicrotask(() => {
        const r = el.getBoundingClientRect();
        const box = { inlineSize: r.width, blockSize: r.height };
        this.cb(
          [
            {
              target: el,
              contentRect: r,
              borderBoxSize: [box],
              contentBoxSize: [box],
              devicePixelContentBoxSize: [box],
            } as ResizeObserverEntry,
          ],
          this,
        );
      });
    }
    unobserve(el: Element) {
      this.inner.unobserve(el);
    }
    disconnect() {
      this.inner.disconnect();
    }
  };
}

export {};
