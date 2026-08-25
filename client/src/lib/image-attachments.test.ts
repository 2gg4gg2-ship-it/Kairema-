import { describe, expect, it } from "vitest";
import { MAX_COMPOSER_IMAGES, MAX_IMAGE_SOURCE_BYTES, MAX_IMAGE_UPLOAD_BYTES, optimizeImageForUpload } from "./image-attachments";

describe("optimizeImageForUpload", () => {
  it("keeps a supported image already below the binary-upload safety boundary intact", async () => {
    const file = new File(["small-photo"], "photo.jpg", { type: "image/jpeg" });

    await expect(optimizeImageForUpload(file)).resolves.toBe(file);
    expect(MAX_IMAGE_UPLOAD_BYTES).toBeLessThan(8 * 1024 * 1024);
    expect(MAX_COMPOSER_IMAGES).toBe(4);
  });

  it("rejects a source above the device-processing boundary before decoding or upload", async () => {
    const file = new File(["photo"], "large-photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: MAX_IMAGE_SOURCE_BYTES + 1 });

    await expect(optimizeImageForUpload(file)).rejects.toThrow("до 32 МБ");
  });
});
