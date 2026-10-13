import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { readManualChoiceStructure, readManualChoiceStructureForDisplay } from "../../src/shared/ai/manualChoiceStructure.ts";

export const VERSION = "issue105-r2a-v1";
const KEYS = ["A", "B", "C", "D"];
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const SHA = /^[a-f0-9]{64}$/;
const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);
const fail = reason => { throw new Error("ISSUE105_BENCHMARK_INVALID: " + reason); };
const checkId = (v, label) => { if (typeof v !== "string" || !ID.test(v)) fail(label + " must be opaque ID"); };
const present = x => x !== undefined && x !== null;
const norm = x => String(x).replace(/\r\n?/g, "\n").trim();
const exact = (a,b) => norm(a) === norm(b);
const ratio = (numerator, denominator) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });
const isPngOrJpeg = bytes =>
  bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
  (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);

function checkOptions(options, label) {
  if (!Array.isArray(options) || options.length !== 4) fail(label + " must contain four options");
  options.forEach((o,i) => {
    if (!isObject(o) || o.key !== KEYS[i] || typeof o.text !== "string" ||
      !o.text.trim() || o.text.length > 240) fail(label + ": expected ordered nonempty A-D");
  });
}

function verifyImage(sample, datasetPath) {
  const ev = sample.evidence, id = sample.caseId;
  if (!datasetPath) fail(id + ": real evidence requires dataset file path");
  if (typeof ev.relativePath !== "string" || !ev.relativePath ||
      ev.relativePath.includes("\\") || isAbsolute(ev.relativePath) ||
      ev.relativePath.split("/").includes("..")) fail(id + ": unsafe screenshot path");
  if (!SHA.test(ev.sha256)) fail(id + ": invalid SHA256");
  const ann = ev.annotation;
  if (!isObject(ann) || ann.method !== "human_pixel_review" ||
      typeof ann.reviewerAlias !== "string" || !ID.test(ann.reviewerAlias) ||
      typeof ann.reviewedAt !== "string" || !Number.isFinite(Date.parse(ann.reviewedAt))) {
    fail(id + ": missing human pixel-review metadata");
  }
  const root = realpathSync(dirname(resolve(datasetPath)));
  let file;
  try { file = realpathSync(resolve(root, ev.relativePath)); }
  catch { fail(id + ": missing screenshot file"); }
  const child = relative(root, file);
  if (!child || child === ".." || child.startsWith(".." + sep) || isAbsolute(child)) {
    fail(id + ": screenshot escapes dataset directory");
  }
  if (!/\.(png|jpe?g)$/i.test(file)) fail(id + ": unsupported image suffix");
  const len = statSync(file).size;
  if (len < 8 || len > 20*1024*1024) fail(id + ": screenshot size out of bounds");
  const bytes = readFileSync(file);
  if (!isPngOrJpeg(bytes)) fail(id + ": invalid image signature");
  if (createHash("sha256").update(bytes).digest("hex") !== ev.sha256) fail(id + ": screenshot SHA256 mismatch");
}

function validate(sample, datasetPath) {
  if (!isObject(sample)) fail("case must be object");
  checkId(sample.caseId,"caseId"); checkId(sample.siteId,sample.caseId+".siteId");
  if (!isObject(sample.evidence)) fail(sample.caseId+": evidence missing");
  if (sample.evidence.kind === "real_edge_screenshot") verifyImage(sample,datasetPath);
  else if (sample.evidence.kind === "synthetic_fixture") checkId(sample.evidence.fixtureId,sample.caseId+".fixtureId");
  else fail(sample.caseId+": invalid evidence kind");
  const gt=sample.truth;
  if (!isObject(gt) || !["readable","unreadable"].includes(gt.status)) fail(sample.caseId+": truth status missing");
  if (gt.status === "readable") {
    if (typeof gt.stem!=="string" || !gt.stem.trim() || gt.stem.length>1400) fail(sample.caseId+": invalid ground-truth stem");
    checkOptions(gt.options,sample.caseId+".truth.options");
  } else if (!["missing_labels","occluded","ambiguous","unreadable_text"].includes(gt.reason)) {
    fail(sample.caseId+": unreadable reason missing");
  }
  const o=sample.observation;
  if (!isObject(o)) fail(sample.caseId+": observation missing");
  checkId(o.blockId,sample.caseId+".blockId");
  checkId(o.resultBlockId,sample.caseId+".resultBlockId");
  if (!["manual_capture","auto_dom","auto_visual"].includes(o.blockSource) ||
      !["vision","hybrid","text"].includes(o.routeUsed) ||
      !["single_choice","multi_choice","judge","short_answer","fill_blank","unknown"].includes(o.questionType)) {
    fail(sample.caseId+": invalid observation provenance or question type");
  }
  if (Object.hasOwn(o,"history") && (!isObject(o.history) || !Object.hasOwn(o.history,"structuredChoice"))) {
    fail(sample.caseId+": history must contain structuredChoice or explicit null");
  }
}

function bucket(){return {samples:0,readable:0,unreadable:0,emitted:0,fullyCorrect:0,missing:0,wrong:0,
  correctReject:0,falseStructure:0,stemCorrect:0,optionPairsCorrect:0,invalidDto:0,historyCompared:0,historyEqual:0,sites:{}};}
function summary(b){return {
  sampleCount:b.samples,groundTruth:{readable:b.readable,unreadable:b.unreadable},
  counts:{emitted:b.emitted,missingStructure:b.missing,wrongStructure:b.wrong,
    falseStructure:b.falseStructure,invalidOrUnauthorizedDto:b.invalidDto},
  metrics:{
    strictWholeQuestionRecall:ratio(b.fullyCorrect,b.readable),
    strictWholeQuestionPrecision:ratio(b.fullyCorrect,b.emitted),
    stemExactRate:ratio(b.stemCorrect,b.readable),
    optionPairExactRate:ratio(b.optionPairsCorrect,4*b.readable),
    correctRejectRate:ratio(b.correctReject,b.unreadable),
    historyConsistencyRate:ratio(b.historyEqual,b.historyCompared),
  },
  siteDistribution:Object.fromEntries(Object.entries(b.sites).sort(([a],[c])=>a.localeCompare(c))),
};}

/** An offline quality report; neither this function nor image hashes verify pixel annotations or grant Fill authority. */
export function evaluateChoiceBenchmark(dataset,{datasetPath}={}){
  if(!isObject(dataset)||dataset.version!==VERSION) fail("unsupported dataset version");
  checkId(dataset.datasetId,"datasetId");
  if(!Array.isArray(dataset.samples)||dataset.samples.length>10000) fail("samples must be array <= 10000");
  const real=bucket(),synthetic=bucket(),seen=new Set(),diagnostics=[];
  for(const sample of dataset.samples){
    validate(sample,datasetPath);
    if(seen.has(sample.caseId)) fail(sample.caseId+": duplicate caseId");
    seen.add(sample.caseId);
    const cohort=sample.evidence.kind==="real_edge_screenshot"?"real":"synthetic";
    const b=cohort==="real"?real:synthetic,o=sample.observation,gt=sample.truth;
    b.samples++;b.sites[sample.siteId]=(b.sites[sample.siteId]??0)+1;
    const raw=o.structuredChoice,rawPresent=present(raw),errors=[];
    const projection=readManualChoiceStructureForDisplay(
      {id:o.blockId,source:o.blockSource},
      {blockId:o.resultBlockId,routeUsed:o.routeUsed,questionType:o.questionType,structuredChoice:raw},
    );
    if(rawPresent&&!projection){b.invalidDto++;errors.push("INVALID_OR_UNAUTHORIZED_DTO");}
    if(projection)b.emitted++;
    if(gt.status==="readable"){
      b.readable++;
      if(!projection){b.missing++;errors.push("MISSING_STRUCTURE");}
      else{
        const stemOk=exact(projection.stem,gt.stem);if(stemOk)b.stemCorrect++;else errors.push("STEM_MISMATCH");
        let allOptions=true;
        for(let i=0;i<4;i++){
          if(projection.options[i].key===gt.options[i].key&&exact(projection.options[i].text,gt.options[i].text))b.optionPairsCorrect++;
          else{allOptions=false;errors.push("OPTION_PAIR_MISMATCH_"+KEYS[i]);}
        }
        if(stemOk&&allOptions)b.fullyCorrect++;else b.wrong++;
      }
    }else{
      b.unreadable++;
      if(projection){b.falseStructure++;errors.push("FALSE_STRUCTURE_ON_UNREADABLE_PIXELS");}
      else b.correctReject++;
    }
    if(Object.hasOwn(o,"history")){
      b.historyCompared++;
      const historyRaw=o.history.structuredChoice,parsed=readManualChoiceStructure(historyRaw);
      if(present(historyRaw)===rawPresent && Boolean(parsed)===Boolean(projection) &&
         JSON.stringify(parsed??null)===JSON.stringify(projection??null)) b.historyEqual++;
      else errors.push("HISTORY_DTO_MISMATCH");
    }
    diagnostics.push({caseId:sample.caseId,siteId:sample.siteId,cohort,status:errors.length?"FAIL":"PASS",failures:errors});
  }
  return {schemaVersion:VERSION,datasetId:dataset.datasetId,
    status:real.samples?"REAL_METRICS_NOT_EDGE_ACCEPTANCE":"NO_REAL_SAMPLES",
    note:"SHA256 binds local image bytes only; annotations still need independent pixel review. No Fill/Submit authority.",
    real:summary(real),synthetic:summary(synthetic),diagnostics};
}

export function loadChoiceBenchmarkDataset(path){
  const size=statSync(path).size;
  if(size<2||size>2*1024*1024) fail("dataset JSON size out of bounds");
  return JSON.parse(readFileSync(path,"utf8"));
}
