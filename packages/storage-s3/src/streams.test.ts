/** Streaming read/write tests for S3 storage. */
import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createS3Storage } from "./index.ts";

/** A fake S3 response handler keyed by the command constructor name. */
/* eslint-disable typescript/prefer-function-type -- allow interface for Handler to satisfy consistent-type-definitions */
interface Handler {
  (input: Record<string, unknown>): unknown;
}
/* eslint-enable typescript/prefer-function-type */

/** A fake S3 client that records commands and returns canned responses. */
function makeClient(handlers: Record<string, Handler> = {}): { client: S3Client; sent: string[] } {
  const sent: string[] = [];
  const send = async (command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> => {
    sent.push(command.constructor.name);
    const handler = handlers[command.constructor.name];
    return handler ? await handler(command.input) : {};
  };
  // lib-storage Upload resolves `client.config.endpoint()` before sending.
  const config = {
    endpoint: async (): Promise<unknown> =>
      await Promise.resolve({ protocol: "https:", hostname: "bkt", path: "/", query: undefined }),
  };
  return { client: { send, config } as unknown as S3Client, sent };
}

function notFoundError(): S3ServiceException {
  return new S3ServiceException({
    $fault: "client",
    name: "NotFound",
    message: "Not Found",
    $metadata: { httpStatusCode: 404 },
  });
}

describe("createS3Storage - streams", () => {
  it("writeStream uploads small bodies with a single PUT", async () => {
    const { client, sent } = makeClient();
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await storage.writeStream("x/y.bin", Readable.from([Buffer.from("streamed")]));

    expect(sent).toEqual([PutObjectCommand.name]);
  });

  it("readStream returns node stream bodies directly", async () => {
    const payload = Buffer.from("direct-bytes");
    const { client } = makeClient({
      [GetObjectCommand.name]: () => ({ Body: Readable.from([payload]) }),
    });
    const storage = createS3Storage({ bucket: "bkt", client });

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.readStream("a.bin")) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it("readStream converts web-stream bodies to node streams", async () => {
    const payload = Buffer.from("web-bytes");
    const web = Readable.toWeb(Readable.from([payload]));
    const { client } = makeClient({ [GetObjectCommand.name]: () => ({ Body: web }) });
    const storage = createS3Storage({ bucket: "bkt", client });

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.readStream("a.bin")) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it("readStream rejects when GetObject throws", async () => {
    const { client } = makeClient({
      [GetObjectCommand.name]: () => {
        throw notFoundError();
      },
    });
    const storage = createS3Storage({ bucket: "bkt", client });

    await expect(storage.readStream("missing.bin")).rejects.toThrow();
  });
});
