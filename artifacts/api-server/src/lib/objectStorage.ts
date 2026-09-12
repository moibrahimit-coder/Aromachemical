import { createHash, createHmac, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { File, Storage } from "@google-cloud/storage";
import {
  canAccessObject,
  getObjectAclPolicy,
  type ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
  type ObjectStorageFile,
} from "./objectAcl";
import { isVercelRuntime, requireExternalRuntimeConfig } from "./runtime";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const S3_SERVICE = "s3";

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

type ObjectMetadata = {
  size: number;
  contentType: string;
  magic: Buffer;
};

type PrivateObjectProvider = {
  privateObjectDir(): string;
  signUpload(objectName: string): Promise<string>;
  signDownload(objectName: string, filename: string): Promise<string>;
  objectFile(bucketName: string, objectName: string): ObjectStorageFile;
};

class GcsObjectFile implements ObjectStorageFile {
  constructor(private readonly file: File) {}

  get name(): string {
    return this.file.name;
  }

  async exists(): Promise<[boolean]> {
    return this.file.exists();
  }

  async getMetadata(): Promise<[Record<string, unknown>]> {
    const [metadata] = await this.file.getMetadata();
    return [metadata as Record<string, unknown>];
  }

  async readRange(start: number, end: number): Promise<Buffer> {
    const [body] = await this.file.download({ start, end });
    return body;
  }

  async downloadResponse(): Promise<Response> {
    const [metadata] = await this.file.getMetadata();
    return new Response(Readable.toWeb(this.file.createReadStream()) as ReadableStream, {
      headers: {
        "Content-Type": String(metadata.contentType ?? "application/octet-stream"),
        ...(metadata.size ? { "Content-Length": String(metadata.size) } : {}),
      },
    });
  }

  async setMetadata(metadata: { metadata: Record<string, string> }): Promise<void> {
    await this.file.setMetadata(metadata);
  }
}

class ReplitGcsProvider implements PrivateObjectProvider {
  privateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
    return dir;
  }

  async signUpload(objectName: string): Promise<string> {
    const { bucketName, objectName: key } = parseObjectPath(objectName);
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: key,
        method: "PUT",
        expires_at: new Date(Date.now() + 900_000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Failed to sign object URL (${response.status})`);
    const body = (await response.json()) as { signed_url?: string };
    if (!body.signed_url) throw new Error("Object storage returned no signed URL");
    return body.signed_url;
  }

  async signDownload(): Promise<string> {
    throw new Error("Presigned private downloads are only available on Vercel.");
  }

  objectFile(bucketName: string, objectName: string): ObjectStorageFile {
    return new GcsObjectFile(objectStorageClient.bucket(bucketName).file(objectName));
  }
}

type S3Config = {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
};

function s3Config(): S3Config {
  const [endpoint, region, bucket, accessKeyId, secretAccessKey] =
    requireExternalRuntimeConfig([
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ]);
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("S3_ENDPOINT must be an absolute HTTPS URL.");
  }
  if (parsedEndpoint.protocol !== "https:" || parsedEndpoint.username || parsedEndpoint.password) {
    throw new Error("S3_ENDPOINT must be an HTTPS URL without credentials.");
  }
  return {
    endpoint: parsedEndpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    prefix: normalizePrefix(process.env.S3_PREFIX ?? ""),
  };
}

class S3ObjectFile implements ObjectStorageFile {
  constructor(
    private readonly config: S3Config,
    private readonly bucket: string,
    readonly name: string,
  ) {}

  async exists(): Promise<[boolean]> {
    const response = await s3Request(this.config, this.bucket, this.name, "HEAD");
    if (response.status === 404) return [false];
    if (!response.ok) throw new Error(`S3 object lookup failed (${response.status})`);
    return [true];
  }

  async getMetadata(): Promise<[Record<string, unknown>]> {
    const response = await s3Request(this.config, this.bucket, this.name, "HEAD");
    if (response.status === 404) throw new ObjectNotFoundError();
    if (!response.ok) throw new Error(`S3 metadata lookup failed (${response.status})`);
    return [
      {
        size: response.headers.get("content-length") ?? "0",
        contentType: response.headers.get("content-type") ?? "",
        metadata: {
          "custom:aclPolicy": response.headers.get("x-amz-meta-aclpolicy") ?? undefined,
        },
      },
    ];
  }

  async readRange(start: number, end: number): Promise<Buffer> {
    const response = await s3Request(this.config, this.bucket, this.name, "GET", {
      Range: `bytes=${start}-${end}`,
    });
    if (response.status === 404) throw new ObjectNotFoundError();
    if (!response.ok) throw new Error(`S3 object read failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  async downloadResponse(): Promise<Response> {
    const response = await s3Request(this.config, this.bucket, this.name, "GET");
    if (response.status === 404) throw new ObjectNotFoundError();
    if (!response.ok) throw new Error(`S3 object download failed (${response.status})`);
    return response;
  }

  async setMetadata(args: { metadata: Record<string, string> }): Promise<void> {
    const [current] = await this.getMetadata();
    const source = `/${this.bucket}/${encodeS3Path(this.name)}`;
    const response = await s3Request(this.config, this.bucket, this.name, "PUT", {
      "x-amz-copy-source": source,
      "x-amz-metadata-directive": "REPLACE",
      "Content-Type": String(current.contentType || "application/octet-stream"),
      ...Object.fromEntries(
        Object.entries(args.metadata).map(([key, value]) => [
          `x-amz-meta-${key.replace(/^custom:/, "").toLowerCase()}`,
          value,
        ]),
      ),
    });
    if (!response.ok) throw new Error(`S3 metadata update failed (${response.status})`);
  }
}

class S3Provider implements PrivateObjectProvider {
  constructor(private readonly config: S3Config) {}

  privateObjectDir(): string {
    return `${this.config.bucket}${this.config.prefix ? `/${this.config.prefix}` : ""}`;
  }

  async signUpload(objectName: string): Promise<string> {
    const { bucketName, objectName: key } = parseObjectPath(objectName);
    return presignS3Put(this.config, bucketName, key, 900);
  }

  async signDownload(objectName: string, filename: string): Promise<string> {
    const { bucketName, objectName: key } = parseObjectPath(objectName);
    return presignS3Get(this.config, bucketName, key, filename, 300);
  }

  objectFile(bucketName: string, objectName: string): ObjectStorageFile {
    return new S3ObjectFile(this.config, bucketName, objectName);
  }
}

export class ObjectStorageService {
  private provider(): PrivateObjectProvider {
    return isVercelRuntime() ? new S3Provider(s3Config()) : new ReplitGcsProvider();
  }

  getPrivateObjectDir(): string {
    return this.provider().privateObjectDir();
  }

  async createObjectEntityUploadDestination(): Promise<{
    uploadURL: string;
    objectPath: string;
  }> {
    const provider = this.provider();
    const privateObjectDir = provider.privateObjectDir();
    const objectName = `${privateObjectDir}/uploads/${randomUUID()}`;
    const { objectName: key } = parseObjectPath(objectName);
    const { objectName: privatePrefix } = parsePrivateObjectDir(privateObjectDir);
    const prefix = privatePrefix ? `${privatePrefix}/` : "";
    if (!key.startsWith(prefix)) {
      throw new Error("Private object storage returned an invalid object prefix");
    }
    return {
      uploadURL: await provider.signUpload(objectName),
      objectPath: `/objects/${key.slice(prefix.length)}`,
    };
  }

  async getObjectEntityUploadURL(): Promise<string> {
    return (await this.createObjectEntityUploadDestination()).uploadURL;
  }

  /**
   * Called only after the route has authenticated, authorized, and validated
   * the object. A redirect avoids proxying a large private file through a
   * short-lived Vercel Function.
   */
  async getVercelPrivateDownloadURL(
    objectPath: string,
    filename: string,
  ): Promise<string> {
    if (!isVercelRuntime()) {
      throw new Error("Vercel private download URLs are unavailable on this runtime.");
    }
    if (!isSafeObjectPath(objectPath)) throw new ObjectNotFoundError();
    const relative = objectPath.slice("/objects/".length);
    const privateDir = this.getPrivateObjectDir();
    const { bucketName, objectName } = parseObjectPath(
      `${privateDir.replace(/\/$/, "")}/${relative}`,
    );
    return this.provider().signDownload(`${bucketName}/${objectName}`, filename);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (isSafeObjectPath(rawPath)) return rawPath;
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const url = new URL(rawPath);
    const { objectName } = parseObjectPath(url.pathname);
    const { objectName: privatePrefix } = parsePrivateObjectDir(this.getPrivateObjectDir());
    const normalizedPrefix = privatePrefix ? `${privatePrefix}/` : "";
    if (!objectName.startsWith(normalizedPrefix)) return url.pathname;
    return `/objects/${objectName.slice(normalizedPrefix.length)}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<ObjectStorageFile> {
    if (!isSafeObjectPath(objectPath)) throw new ObjectNotFoundError();
    const relative = objectPath.slice("/objects/".length);
    const privateDir = this.getPrivateObjectDir();
    const { bucketName, objectName } = parseObjectPath(
      `${privateDir.replace(/\/$/, "")}/${relative}`,
    );
    const file = this.provider().objectFile(bucketName, objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async getObjectMetadata(file: ObjectStorageFile): Promise<ObjectMetadata> {
    const [metadata] = await file.getMetadata();
    return {
      size: Number(metadata.size ?? 0),
      contentType: String(metadata.contentType ?? ""),
      magic: await file.readRange(0, 7),
    };
  }

  async validateUploadedObject(
    objectPath: string,
    expected: {
      size: number;
      contentType: "image/jpeg" | "image/png" | "application/pdf";
    },
  ): Promise<ObjectStorageFile> {
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

  async downloadObject(file: ObjectStorageFile, cacheTtlSec = 0): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const response = await file.downloadResponse();
    const headers: Record<string, string> = {
      "Content-Type": String(metadata.contentType ?? "application/octet-stream"),
      "Cache-Control": `${aclPolicy?.visibility === "public" ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) headers["Content-Length"] = String(metadata.size);
    return new Response(response.body, { headers });
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
    objectFile: ObjectStorageFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      ...args,
      requestedPermission: args.requestedPermission ?? ObjectPermission.READ,
    });
  }
}

export function isSafeObjectPath(path: string): boolean {
  return (
    path.startsWith("/objects/") &&
    !path.includes("..") &&
    !path.includes("\\") &&
    path.length > "/objects/".length
  );
}

export function parseObjectPath(path: string): {
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

function parsePrivateObjectDir(path: string): {
  bucketName: string;
  objectName: string;
} {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  const [bucketName, ...objectParts] = normalized.split("/");
  if (!bucketName) throw new Error("Invalid private object directory");
  return { bucketName, objectName: objectParts.join("/") };
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

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function s3Timestamp(now = new Date()): { amzDate: string; dateStamp: string } {
  const compact = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: compact, dateStamp: compact.slice(0, 8) };
}

function encodeS3Path(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function s3Url(config: S3Config, bucket: string, key: string): URL {
  const url = new URL(config.endpoint.toString());
  const endpointPath = url.pathname.replace(/\/$/, "");
  if (config.forcePathStyle) {
    url.pathname = `${endpointPath}/${encodeURIComponent(bucket)}/${encodeS3Path(key)}`;
  } else {
    url.hostname = `${bucket}.${url.hostname}`;
    url.pathname = `${endpointPath}/${encodeS3Path(key)}`;
  }
  return url;
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function authorization(
  config: S3Config,
  method: string,
  url: URL,
  headers: Record<string, string>,
  payloadHash: string,
  timestamp: { amzDate: string; dateStamp: string },
): string {
  const canonicalHeaders = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const signedHeaders = canonicalHeaders.map(([key]) => key).join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery(url),
    `${canonicalHeaders.map(([key, value]) => `${key}:${value}\n`).join("")}`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${timestamp.dateStamp}/${config.region}/${S3_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp.amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, timestamp.dateStamp), config.region), S3_SERVICE),
    "aws4_request",
  );
  return `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`;
}

async function s3Request(
  config: S3Config,
  bucket: string,
  key: string,
  method: "GET" | "HEAD" | "PUT",
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = s3Url(config, bucket, key);
  const timestamp = s3Timestamp();
  const payloadHash = sha256("");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": timestamp.amzDate,
    ...extraHeaders,
  };
  return fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization: authorization(config, method, url, headers, payloadHash, timestamp),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

function safeAttachmentFilename(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return safe || "download";
}

function presignS3Put(config: S3Config, bucket: string, key: string, expiresIn: number): string {
  return presignS3Request(config, bucket, key, "PUT", expiresIn);
}

function presignS3Get(
  config: S3Config,
  bucket: string,
  key: string,
  filename: string,
  expiresIn: number,
): string {
  return presignS3Request(
    config,
    bucket,
    key,
    "GET",
    expiresIn,
    `attachment; filename="${safeAttachmentFilename(filename)}"`,
  );
}

function presignS3Request(
  config: S3Config,
  bucket: string,
  key: string,
  method: "GET" | "PUT",
  expiresIn: number,
  contentDisposition?: string,
): string {
  const url = s3Url(config, bucket, key);
  const timestamp = s3Timestamp();
  const scope = `${timestamp.dateStamp}/${config.region}/${S3_SERVICE}/aws4_request`;
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${config.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", timestamp.amzDate);
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  url.searchParams.set("X-Amz-SignedHeaders", "host");
  if (contentDisposition) {
    url.searchParams.set("response-content-disposition", contentDisposition);
  }
  const headers = { host: url.host };
  url.searchParams.set(
    "X-Amz-Signature",
    authorization(config, method, url, headers, "UNSIGNED-PAYLOAD", timestamp)
      .match(/Signature=([a-f0-9]+)$/)?.[1] ?? "",
  );
  return url.toString();
}