#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validateScreenshotPixels } from "./imageEvidence.mjs";

if(process.argv.length!==3){
  console.error("用法：node tools/issue105/verifyScreenshot.mjs <private-screenshot.png>");
  process.exitCode=2;
}else{
  try{
    const filename=resolve(process.argv[2]);
    const length=statSync(filename).size;
    if(length<45||length>20*1024*1024)
      throw new Error("ISSUE105_IMAGE_INVALID: screenshot size out of bounds");
    const bytes=readFileSync(filename);
    if(bytes.length!==length)throw new Error("ISSUE105_IMAGE_INVALID: file changed while reading");
    const image=validateScreenshotPixels(bytes);
    console.log(JSON.stringify({
      state:"PNG_PIXELS_CHECKED_NOT_EDGE_ACCEPTANCE",
      width:image.width,height:image.height,
      sha256:createHash("sha256").update(bytes).digest("hex"),
      pixelIntegrity:image.pixelIntegrity,
    },null,2));
  }catch(error){
    console.error(String(error instanceof Error?error.message:error));
    process.exitCode=2;
  }
}
