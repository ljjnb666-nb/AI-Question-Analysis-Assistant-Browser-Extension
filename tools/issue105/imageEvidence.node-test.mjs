import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pngCrc32, validatePngPixels, validateScreenshotPixels } from "./imageEvidence.mjs";

const SIG=Buffer.from([137,80,78,71,13,10,26,10]);
const REAL_PNG_BYTES=Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQcGj4DwADRAHgMqq/hAAAAABJRU5ErkJggg==",
  "base64",
); // Valid 1x1 RGBA PNG, synthetic proof of parser behavior; never real Edge evidence.
function chunk(type,data=Buffer.alloc(0)){
  const name=Buffer.from(type,"ascii");
  const out=Buffer.alloc(12+data.length);
  out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);
  out.writeUInt32BE(pngCrc32(Buffer.concat([name,data])),8+data.length);
  return out;
}
function generatePng({width=1,height=1,filter=0,raw=null, color=6}={}){
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
  ihdr[8]=8;ihdr[9]=color;
  const row=raw??Buffer.from([filter,32,64,128,255]);
  return Buffer.concat([SIG,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(row)),chunk("IEND")]);
}
test("R2C-01 full lossless one-pixel PNG is accepted with explicit integrity-only status",()=>{
  const out=validatePngPixels(REAL_PNG_BYTES);
  assert.deepEqual(out,{format:"png",width:1,height:1,pixelIntegrity:"PNG_CRC_INFLATE_FILTERS_VERIFIED"});
});
test("R2C-02 PNG signature-only bytes are rejected instead of misclassified as Edge screenshot",()=>{
  assert.throws(()=>validateScreenshotPixels(Buffer.concat([SIG,Buffer.from("invalid payload")])),/INVALID/);
});
test("R2C-03 CRC mutation in IHDR or IDAT fails closed",()=>{
  const a=Buffer.from(REAL_PNG_BYTES);a[28]^=0x10;
  assert.throws(()=>validatePngPixels(a),/CRC mismatch/);
  const b=Buffer.from(REAL_PNG_BYTES);b[45]^=0x01;
  assert.throws(()=>validatePngPixels(b),/CRC mismatch/);
});
test("R2C-04 truncated IEND, trailing bytes, and extra non-contiguous IDAT are rejected",()=>{
  assert.throws(()=>validatePngPixels(REAL_PNG_BYTES.subarray(0,REAL_PNG_BYTES.length-12)),/incomplete PNG/);
  assert.throws(()=>validatePngPixels(Buffer.concat([REAL_PNG_BYTES,Buffer.from([0])])),/trailing bytes/);
  const ihdr=chunk("IHDR",REAL_PNG_BYTES.subarray(16,29));
  const d=chunk("IDAT",deflateSync(Buffer.from([0,0,0,0,255])));
  const noncontiguous=Buffer.concat([SIG,ihdr,d,chunk("tEXt",Buffer.from("a\0b")),d,chunk("IEND")]);
  assert.throws(()=>validatePngPixels(noncontiguous),/non-contiguous/);
});
test("R2C-05 bounds on dimensions, bit depth and filters reject unsafe or unsupported pixels",()=>{
  assert.throws(()=>validatePngPixels(generatePng({width:9000})),/unsupported dimensions/);
  assert.throws(()=>validatePngPixels(generatePng({filter:9})),/scanline filter/);
  const raw=Buffer.from([0,0,0,0,0,0,0,0,0,0]);
  assert.throws(()=>validatePngPixels(generatePng({raw})),/scanline length mismatch|cannot be decompressed within bounds/);
});
test("R2C-06 decompress bomb fails within decoded scanline bound",()=>{
  const many=Buffer.alloc(200000,1);
  assert.throws(()=>validatePngPixels(generatePng({raw:many})),/cannot be decompressed within bounds/);
});
test("R2C-07 valid filtered RGBA PNG remains decodable",()=>{
  for(let filter=0;filter<=4;filter++){
    assert.equal(validatePngPixels(generatePng({filter})).height,1);
  }
});
test("R2C-08 JPEG is explicitly unsupported rather than silently counted as pixel-verified",()=>{
  assert.throws(()=>validateScreenshotPixels(Buffer.from([255,216,255,224,0,4,0,0,255,217])),/JPEG pixel decoder unavailable/);
});
test("R2C-09 animated PNG is rejected as a static screenshot",()=>{
  const ihdr=chunk("IHDR",REAL_PNG_BYTES.subarray(16,29));
  const anim=chunk("acTL",Buffer.alloc(8));
  const data=chunk("IDAT",deflateSync(Buffer.from([0,0,0,0,255])));
  assert.throws(()=>validatePngPixels(Buffer.concat([SIG,ihdr,anim,data,chunk("IEND")])),/animated PNG/);
});

test("R2C-10 local PNG preflight CLI emits only sanitized metadata and correct SHA",()=>{
  const dir=mkdtempSync(join(tmpdir(),"quiz-r2c-"));
  try{
    const path=join(dir,"valid.png");writeFileSync(path,REAL_PNG_BYTES);
    const run=spawnSync(process.execPath,[resolve("tools/issue105/verifyScreenshot.mjs"),path],{encoding:"utf8"});
    assert.equal(run.status,0,run.stderr);
    const metadata=JSON.parse(run.stdout);
    assert.equal(metadata.state,"PNG_PIXELS_CHECKED_NOT_EDGE_ACCEPTANCE");
    assert.equal(metadata.width,1);
    assert.equal(metadata.height,1);
    assert.match(metadata.sha256,/^[a-f0-9]{64}$/);
    assert.ok(!run.stdout.includes(path));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test("R2C-11 corrupt files fail closed before the CLI can emit any success JSON",()=>{
  const dir=mkdtempSync(join(tmpdir(),"quiz-r2c-"));
  try{
    const path=join(dir,"bad.png");writeFileSync(path,Buffer.concat([SIG,Buffer.from("fabricated image")]));
    const run=spawnSync(process.execPath,[resolve("tools/issue105/verifyScreenshot.mjs"),path],{encoding:"utf8"});
    assert.equal(run.status,2);
    assert.equal(run.stdout,"");
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("R2C-12 indexed PNG rejects out-of-range palette index after actual scanline reconstruction",()=>{
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=3;
  const palette=chunk("PLTE",Buffer.from([10,20,30]));
  const png=index=>Buffer.concat([SIG,chunk("IHDR",ihdr),palette,
    chunk("IDAT",deflateSync(Buffer.from([0,index]))),chunk("IEND")]);
  assert.equal(validatePngPixels(png(0)).format,"png");
  assert.throws(()=>validatePngPixels(png(1)),/missing palette entry/);
});

test("R2C-13 PNG IDAT with valid chunk CRC but trailing unconsumed compressed data fails closed",()=>{
  const ihdr=chunk("IHDR",REAL_PNG_BYTES.subarray(16,29));
  const pixelData=deflateSync(Buffer.from([0,32,64,128,255]));
  const extra=Buffer.concat([pixelData,Buffer.from("trailing-garbage")]);
  const invalidStream=Buffer.concat([SIG,ihdr,chunk("IDAT",extra),chunk("IEND")]);
  assert.throws(()=>validatePngPixels(invalidStream),/trailing unconsumed data/);
  assert.deepEqual(validatePngPixels(generatePng()),{format:"png",width:1,height:1,pixelIntegrity:"PNG_CRC_INFLATE_FILTERS_VERIFIED"});
});
