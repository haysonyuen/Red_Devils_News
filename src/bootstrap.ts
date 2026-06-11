import "dotenv/config";
import { Blob as NodeBlob } from "node:buffer";
import { ReadableStream as NodeReadableStream } from "node:stream/web";

if (typeof globalThis.Blob === "undefined") {
  (globalThis as unknown as Record<string, unknown>).Blob = NodeBlob;
}
if (typeof globalThis.File === "undefined") {
  class NodeFile extends NodeBlob {
    readonly name: string;
    readonly lastModified: number;

    constructor(
      fileBits: ConstructorParameters<typeof NodeBlob>[0],
      fileName: string,
      options: BlobPropertyBag & { lastModified?: number } = {}
    ) {
      super(fileBits, options);
      this.name = fileName;
      this.lastModified = options.lastModified ?? Date.now();
    }
  }

  (globalThis as unknown as Record<string, unknown>).File = NodeFile;
}
if (typeof globalThis.ReadableStream === "undefined") {
  (globalThis as unknown as Record<string, unknown>).ReadableStream =
    NodeReadableStream;
}

require("./index");
