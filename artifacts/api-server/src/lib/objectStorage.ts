import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { File, Storage } from "@google-cloud/storage";
import {
  canAccessObject,
  getObjectAclPolicy,
  type ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error("PRIVATE_OBJECT_DIR is not configured");
    }
    return dir;
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const { bucketName, objectName } = parseObjectPath(
      `${privateObjectDir}/uploads/${objectId}`,
    );
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir += "/";
    if (!rawObjectPath.startsWith(entityDir)) return rawObjectPath;
    return `/objects/${rawObjectPath.slice(entityDir.length)}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!isSafeObjectPath(objectPath)) throw new ObjectNotFoundError();
    const relative = objectPath.slice("/objects/".length);
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir += "/";
    const { bucketName, objectName } = parseObjectPath(`${entityDir}${relative}`);
    const objectFile = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return objectFile;
  }

  async getObjectMetadata(file: File): Promise<{
    size: number;
    contentType: string;
    magic: Buffer;
  }> {
    const [metadata] = await file.getMetadata();
    const [magic] = await file.download({ start: 0, end: 7 });
    return {
      size: Number(metadata.size ?? 0),
      contentType: String(metadata.contentType ?? ""),
      magic,
    };
  }

  async validateUploadedObject(
    objectPath: string,
    expected: {
      size: number;
      contentType: "image/jpeg" | "image/png" | "application/pdf";
    },
  ): Promise<File> {
    const file = await this.getObjectEntityFile(objectPath);
    const actual = await this.getObjectMetadata(file);
    if (actual.size !== expected.size || actual.contentType !== expected.contentType) {
      throw new Error("Uploaded object metadata does not match the declared upload");
    }
    if (!hasMagicBytes(actual.magic, expected.contentType)) {
      throw new Error("Uploaded object content does not match its declared type");
    }
    return file;
  }

  async downloadObject(file: File, cacheTtlSec = 0): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": String(metadata.contentType ?? "application/octet-stream"),
      "Cache-Control": `${aclPolicy?.visibility === "public" ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) headers["Content-Length"] = String(metadata.size);
    return new Response(webStream, { headers });
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity(args: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      ...args,
      requestedPermission: args.requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function isSafeObjectPath(path: string): boolean {
  return (
    path.startsWith("/objects/") &&
    !path.includes("..") &&
    !path.includes("\\") &&
    path.length > "/objects/".length
  );
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid object path");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

function hasMagicBytes(
  bytes: Buffer,
  contentType: "image/jpeg" | "image/png" | "application/pdf",
): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(bytes);
  }
  return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

async function signObjectURL(args: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: args.bucketName,
      object_name: args.objectName,
      method: args.method,
      expires_at: new Date(Date.now() + args.ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Failed to sign object URL (${response.status})`);
  const body = (await response.json()) as { signed_url?: string };
  if (!body.signed_url) throw new Error("Object storage returned no signed URL");
  return body.signed_url;
}