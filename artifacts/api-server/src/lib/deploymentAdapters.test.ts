import assert from "node:assert/strict";
import test from "node:test";
import { ObjectStorageService, isSafeObjectPath, parseObjectPath } from "./objectStorage";
import {
  canonicalAppOrigin,
  isVercelRuntime,
  requireExternalRuntimeConfig,
} from "./runtime";

test("Vercel runtime configuration is explicit and does not fall back", () => {
  assert.equal(isVercelRuntime({ VERCEL: "1" }), true);
  assert.equal(isVercelRuntime({}), false);
  assert.deepEqual(
    requireExternalRuntimeConfig(["A", "B"], { A: "configured", B: "also-configured" }),
    ["configured", "also-configured"],
  );
  assert.throws(
    () => requireExternalRuntimeConfig(["A", "B"], { A: "configured" }),
    /B/,
  );
});

test("canonical Vercel origin never uses a hostile request host", () => {
  assert.equal(canonicalAppOrigin("https://school.example"), "https://school.example");
  for (const invalid of [
    "https://school.example/checkout",
    "https://user:pass@school.example",
    "https://school.example?redirect=evil",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => canonicalAppOrigin(invalid));
  }
});

test("S3 adapter produces a private normalized object path without parsing signed URLs", async () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, {
      VERCEL: "1",
      S3_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
      S3_REGION: "auto",
      S3_BUCKET: "aroma-private",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
      S3_PREFIX: "production/books",
      S3_FORCE_PATH_STYLE: "true",
    });
    const destination = await new ObjectStorageService().createObjectEntityUploadDestination();
    assert.match(destination.uploadURL, /^https:\/\/account-id\.r2\.cloudflarestorage\.com\/aroma-private\//);
    assert.match(destination.objectPath, /^\/objects\/uploads\/[0-9a-f-]+$/);
    assert.equal(isSafeObjectPath(destination.objectPath), true);
    const downloadUrl = new URL(
      await new ObjectStorageService().getVercelPrivateDownloadURL(
        destination.objectPath,
        "aroma-school-ebook.pdf",
      ),
    );
    assert.equal(downloadUrl.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(downloadUrl.searchParams.get("X-Amz-SignedHeaders"), "host");
    assert.equal(downloadUrl.searchParams.get("X-Amz-Expires"), "300");
    assert.equal(
      downloadUrl.searchParams.get("response-content-disposition"),
      'attachment; filename="aroma-school-ebook.pdf"',
    );
    assert.match(downloadUrl.searchParams.get("X-Amz-Signature") ?? "", /^[a-f0-9]{64}$/);
    assert.equal(downloadUrl.toString().includes("test-secret-key"), false);
    assert.deepEqual(parseObjectPath("aroma-private/production/books/item.pdf"), {
      bucketName: "aroma-private",
      objectName: "production/books/item.pdf",
    });
    process.env.S3_PREFIX = "";
    const rootDestination = await new ObjectStorageService().createObjectEntityUploadDestination();
    assert.match(rootDestination.objectPath, /^\/objects\/uploads\/[0-9a-f-]+$/);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  }
});