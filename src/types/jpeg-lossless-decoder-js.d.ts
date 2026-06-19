declare module "jpeg-lossless-decoder-js" {
  export class Decoder {
    decompress(buffer: ArrayBuffer, offset?: number, length?: number): ArrayBuffer
  }
}
