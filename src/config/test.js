import fs from "fs";
import { uploadFile } from "./s3.js";

async function testUpload() {
  try {
    // Read local file
    const file = fs.readFileSync("./test.png");

    // Define S3 key (path inside bucket)
    const key = "photos/test/test.jpg";

    // Upload to S3
    await uploadFile(key, file, {
      contentType: "image/jpeg",
    });

    console.log("✅ Upload successful:", key);
  } catch (err) {
    console.error("❌ Upload failed:", err);
  }
}

testUpload();
