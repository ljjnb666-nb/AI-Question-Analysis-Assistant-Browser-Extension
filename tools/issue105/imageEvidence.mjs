import { inflateSync } from "node:zlib";

/**
 * R2C: bounded, lossless PNG payload verification for private Edge screenshot evidence.
 * This validates PNG chunks, CRC, bounded DEFLATE, scanline filters and reconstructs
 * pixel rows. It does not attest acquisition source, image labels, or reviewer identity.
 */
const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
const MAX_WIDTH = 8192;
const MAX_HEIGHT = 8192;
const MAX_PIXELS = 16_777_216;
const MAX_RAW = 64 * 1024 * 1024;
const CHANNELS = new Map([[0,1],[2,3],[3,1],[4,2],[6,4]]);
const invalid = reason => { throw new Error("ISSUE105_PNG_INVALID: " + reason); };
const table = Uint32Array.from({length:256}, (_,i) => {
  let n=i;
  for(let k=0;k<8;k++) n=(n & 1) ? (0xedb88320 ^ (n>>>1)) : (n>>>1);
  return n>>>0;
});
export function pngCrc32(bytes){
  let n=0xffffffff;
  for(const b of bytes)n=table[(n ^ b)&0xff] ^ (n>>>8);
  return (n ^ 0xffffffff)>>>0;
}
function paeth(a,b,c){
  const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);
  return da<=db && da<=dc?a:db<=dc?b:c;
}
/** Allow only non-interlaced 8-bit RGB/RGBA/grayscale/indexed screenshots.
 * Rejecting unsupported but valid PNG types is intentional (fail-closed).
 */
export function validatePngPixels(bytes){
  if(!Buffer.isBuffer(bytes) || bytes.length<45 || !bytes.subarray(0,8).equals(PNG_SIGNATURE)){
    invalid("invalid PNG signature or truncated file");
  }
  let offset=8,seenIHDR=false,seenIDAT=false,endedIDAT=false,seenIEND=false;
  let seenPLTE=false, paletteEntries=0, width=0,height=0,channels=0,colorType=-1;
  const idats=[];
  while(offset<bytes.length){
    if(bytes.length-offset<12)invalid("truncated PNG chunk header");
    const len=bytes.readUInt32BE(offset),type=bytes.toString("ascii",offset+4,offset+8);
    if(!/^[A-Za-z]{4}$/.test(type))invalid("invalid chunk type");
    if(len>20*1024*1024 || len>bytes.length-offset-12)invalid("invalid chunk length");
    const dataStart=offset+8,end=dataStart+len,crc=bytes.readUInt32BE(end);
    if(pngCrc32(bytes.subarray(offset+4,end))!==crc)invalid("PNG chunk CRC mismatch");
    if(!seenIHDR && type!=="IHDR")invalid("IHDR must be first");
    if(seenIEND)invalid("data after IEND");
    if(type==="IHDR"){
      if(seenIHDR||len!==13)invalid("duplicate or invalid IHDR");
      seenIHDR=true;width=bytes.readUInt32BE(dataStart);height=bytes.readUInt32BE(dataStart+4);
      const bitDepth=bytes[dataStart+8];colorType=bytes[dataStart+9];
      channels=CHANNELS.get(colorType) ?? 0;
      if(width<1||height<1||width>MAX_WIDTH||height>MAX_HEIGHT||
         width*height>MAX_PIXELS||bitDepth!==8||channels===0||
         bytes[dataStart+10]!==0||bytes[dataStart+11]!==0||bytes[dataStart+12]!==0){
        invalid("unsupported dimensions, color mode, bit depth or interlace");
      }
    }else if(type==="PLTE"){
      if(seenPLTE||seenIDAT||len===0||len%3!==0||len>768)invalid("invalid PNG palette");
      seenPLTE=true;paletteEntries=len/3;
    }else if(type==="IDAT"){
      if(endedIDAT)invalid("non-contiguous PNG IDAT chunks");
      if(len===0)invalid("empty IDAT chunk");
      seenIDAT=true;idats.push(bytes.subarray(dataStart,end));
    }else if(type==="IEND"){
      if(len!==0||!seenIDAT||seenIEND)invalid("invalid IEND");
      seenIEND=true;
    }else if(type==="acTL"||type==="fcTL"||type==="fdAT"){
      invalid("animated PNG is not accepted as screenshot evidence");
    }else if(type[0]===type[0].toUpperCase()){
      invalid("unsupported critical PNG chunk");
    }
    if(type!=="IDAT"&&seenIDAT)endedIDAT=true;
    offset=end+4;
    if(seenIEND && offset!==bytes.length) invalid("trailing bytes after IEND");
  }
  if(!seenIHDR||!seenIEND||!seenIDAT)invalid("incomplete PNG");
  if(colorType===3&&!seenPLTE)invalid("indexed PNG requires palette");
  if(colorType===0||colorType===4){if(seenPLTE)invalid("grayscale PNG cannot have palette");}
  const rowBytes=width*channels,expected=(rowBytes+1)*height;
  if(expected>MAX_RAW)invalid("decoded PNG exceeds resource limit");
  const compressed=Buffer.concat(idats);
  let inflated,consumed;
  try {
    const output=inflateSync(compressed,{maxOutputLength:expected+1,info:true});
    inflated=output.buffer;
    consumed=output.engine.bytesWritten;
  } catch {invalid("PNG compressed pixels cannot be decompressed within bounds");}
  if(consumed!==compressed.length)invalid("PNG compressed stream has trailing unconsumed data");
  if(inflated.length!==expected)invalid("PNG decoded scanline length mismatch");
  let previous=Buffer.alloc(rowBytes),row=Buffer.alloc(rowBytes);
  for(let y=0;y<height;y++){
    const start=y*(rowBytes+1),filter=inflated[start];
    if(filter>4)invalid("invalid PNG scanline filter");
    for(let i=0;i<rowBytes;i++){
      const x=inflated[start+i+1],a=i>=channels?row[i-channels]:0,b=previous[i],c=i>=channels?previous[i-channels]:0;
      const predict=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
      row[i]=(x+predict)&255;
    }
    if(colorType===3 && row.some(index=>index>=paletteEntries))
      invalid("indexed PNG references missing palette entry");
    [previous,row]=[row,previous];
  }
  return {format:"png",width,height,pixelIntegrity:"PNG_CRC_INFLATE_FILTERS_VERIFIED"};
}
export function validateScreenshotPixels(bytes){
  if(!Buffer.isBuffer(bytes))invalid("screenshot is not a byte buffer");
  if(bytes.subarray(0,8).equals(PNG_SIGNATURE))return validatePngPixels(bytes);
  if(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff){
    invalid("JPEG pixel decoder unavailable: retain PNG screenshot for verified benchmark");
  }
  invalid("unsupported screenshot format");
}
