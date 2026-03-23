import { Buffer } from "buffer/";

globalThis.Buffer = Buffer;
globalThis.process = globalThis.process || { env: {} };
globalThis.global = globalThis;
