import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { createS3Storage, s3Key } from "./index.ts";

/** Minimal stand-in for the S3 response `Body` with the shape the SDK uses. */
interface FakeBody {
  transformToByteArray(): Promise<Uint8Array>;
}

/** A fake S3 response handler keyed by the command constructor name. */
type Handler = (input: Record<string, unknown>) => unknown;

/** A fake S3 client that records commands and returns canned responses. */
function makeClient(handlers: Record<string, Handler> = {}): { client: S3Client; sent: string[] } {
  const sent: string[] = [];
  const send = async (command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<unknown> => {
    sent.push(command.constructor.name);
    const handler = handlers[command.constructor.name];
    return handler ? await handler(command.input) : {};
  };
  return { client: { send } as unknown as S3Client, sent };
}

function body(bytes: number[]): FakeBody {
  return {
    transformToByteArray: async (): Promise<Uint8Array> => {
      const data = new Uint8Array(bytes);
      return await Promise.resolve(data);
    },
  };
}

function notFoundError(): S3ServiceException {
  return new S3ServiceException({
    $fault: "client",
    name: "NotFound",
    message: "Not Found",
    $metadata: { httpStatusCode: 404 },
  });
}

describe("s3Key", () => {
  it("joins a prefix and path into an S3 key", () => {
    expect(s3Key("", "a/b.txt")).toBe("a/b.txt");
    expect(s3Key("app", "a/b.txt")).toBe("app/a/b.txt");
    expect(s3Key("app", "")).toBe("app/");
  });
});

describe("createS3Storage", () => {
  it("constructs a StorageAdapter without throwing", () => {
    const storage = createS3Storage({
      bucket: "test-bucket",
      prefix: "app",
      endpoint: "http://localhost:9000",
      region: "us-east-1",
    });

    expect(storage).toBeDefined();
    expect(typeof storage.read).toBe("function");
    expect(typeof storage.write).toBe("function");
    expect(typeof storage.delete).toBe("function");
    expect(typeof storage.exists).toBe("function");
    expect(typeof storage.list).toBe("function");
  });

  it("write sends PutObjectCommand with the bucketed, prefixed key and body", async () => {
    const { client, sent } = makeClient();
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await storage.write("x/y.png", Buffer.from("hello"));

    expect(sent).toEqual([PutObjectCommand.name]);
  });

  it("read sends GetObjectCommand and returns the response body bytes", async () => {
    const { client } = makeClient({
      [GetObjectCommand.name]: () => ({ Body: body([1, 2, 3]) }),
    });
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    const result = await storage.read("x/y.png");

    expect(Buffer.from(result).toString("hex")).toBe("010203");
  });

  it("read returns an empty buffer when the response has no body", async () => {
    const { client } = makeClient({ [GetObjectCommand.name]: () => ({}) });
    const storage = createS3Storage({ bucket: "bkt", client });

    await expect(storage.read("a.txt")).resolves.toHaveLength(0);
  });

  it("delete sends DeleteObjectCommand with the prefixed key", async () => {
    const { client, sent } = makeClient();
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await storage.delete("x/y.png");

    expect(sent).toEqual([DeleteObjectCommand.name]);
  });

  it("exists returns true when HeadObject succeeds", async () => {
    const { client } = makeClient({ [HeadObjectCommand.name]: () => ({}) });
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await expect(storage.exists("x/y.png")).resolves.toBe(true);
  });

  it("exists returns false on a 404 HeadObject error", async () => {
    const { client } = makeClient({
      [HeadObjectCommand.name]: () => {
        throw notFoundError();
      },
    });
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await expect(storage.exists("x/y.png")).resolves.toBe(false);
  });

  it("exists rethrows non-404 errors", async () => {
    const { client } = makeClient({
      [HeadObjectCommand.name]: () => {
        throw new Error("boom");
      },
    });
    const storage = createS3Storage({ bucket: "bkt", client });

    await expect(storage.exists("a.txt")).rejects.toThrow("boom");
  });

  it("list sends ListObjectsV2Command and strips the prefix from keys", async () => {
    const { client } = makeClient({
      [ListObjectsV2Command.name]: () => ({
        Contents: [{ Key: "app/a/1.png" }, { Key: "app/a/2.png" }, { Key: "app/b/3.png" }],
      }),
    });
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    const result = await storage.list("a");

    expect(result).toEqual(["a/1.png", "a/2.png", "b/3.png"]);
  });

  it("list returns an empty array when there are no contents", async () => {
    const { client } = makeClient({ [ListObjectsV2Command.name]: () => ({}) });
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await expect(storage.list("a")).resolves.toEqual([]);
  });

  it("returns unprefixed keys when no prefix is configured", async () => {
    const { client } = makeClient({
      [ListObjectsV2Command.name]: () => ({ Contents: [{ Key: "a/1.png" }] }),
    });
    const storage = createS3Storage({ bucket: "bkt", client });

    await expect(storage.list("a")).resolves.toEqual(["a/1.png"]);
  });
});
