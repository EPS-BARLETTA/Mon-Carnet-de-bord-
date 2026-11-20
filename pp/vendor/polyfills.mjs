// Compléments pour les versions de Safari (iPad) qui n'ont pas encore ces fonctions, utilisées par pdf.js.
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* iterate() {
    const reader = this.getReader();
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
  if (!ReadableStream.prototype.values) ReadableStream.prototype.values = ReadableStream.prototype[Symbol.asyncIterator];
}
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new this((ok, ko) => { resolve = ok; reject = ko; });
    return {promise, resolve, reject};
  };
}
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {configurable: true, writable: true, value(index) {
    const i = Math.trunc(index) || 0;
    return this[i < 0 ? this.length + i : i];
  }});
}
if (!Uint8Array.prototype.at) Uint8Array.prototype.at = Array.prototype.at;
if (typeof structuredClone !== 'function') {
  globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}
