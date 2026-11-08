// Express only needs decoding for request bodies. Use the runtime's WHATWG
// decoder instead of iconv-lite's browser-disabled Node stream extensions.
function decoder(encoding) {
  try { return new TextDecoder(encoding); }
  catch { throw new Error('Encoding not recognized: ' + encoding); }
}
exports.encodingExists = (encoding) => {
  try { decoder(encoding); return true; } catch { return false; }
};
exports.getDecoder = (encoding) => {
  const instance = decoder(encoding);
  return { write: (bytes) => instance.decode(bytes, {stream:true}),
    end: () => instance.decode() };
};
exports.decode = (bytes, encoding) => decoder(encoding).decode(bytes);
