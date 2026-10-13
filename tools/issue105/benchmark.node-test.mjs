import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateChoiceBenchmark, loadChoiceBenchmarkDataset, VERSION } from "./benchmarkEngine.mjs";

const options = [
  { key:"A",text:"核查安全装置" },{ key:"B",text:"忽略故障告警" },
  { key:"C",text:"拆除保护装置" },{ key:"D",text:"不记录风险" },
];
const choice={version:1,evidence:"vision_text_labels_unverified",stem:"以下操作哪项正确？",options};
function sample(id="case-1"){
  return {caseId:id,siteId:"site-alias-1",
    evidence:{kind:"synthetic_fixture",fixtureId:id},
    truth:{status:"readable",stem:choice.stem,options},
    observation:{blockId:"block-1",resultBlockId:"block-1",blockSource:"manual_capture",
      routeUsed:"vision",questionType:"single_choice",structuredChoice:choice,
      history:{structuredChoice:choice}}};
}
const dataset=(...samples)=>({version:VERSION,datasetId:"dataset-test",samples});

test("R2A-01 real cohort stays empty/null even when synthetic fixture matches perfectly",()=>{
  const result=evaluateChoiceBenchmark(dataset(sample()));
  assert.equal(result.status,"NO_REAL_SAMPLES");
  assert.equal(result.real.sampleCount,0);
  assert.deepEqual(result.real.metrics.strictWholeQuestionRecall,{numerator:0,denominator:0,rate:null});
  assert.equal(result.synthetic.metrics.strictWholeQuestionRecall.rate,1);
  assert.equal(result.synthetic.metrics.strictWholeQuestionPrecision.rate,1);
  assert.deepEqual(result.synthetic.metrics.optionPairExactRate,{numerator:4,denominator:4,rate:1});
  assert.equal(result.synthetic.metrics.historyConsistencyRate.rate,1);
});

test("R2A-02 unlabeled/obscured truth without DTO is counted as correct rejection",()=>{
  const s=sample();s.truth={status:"unreadable",reason:"missing_labels"};
  s.observation.structuredChoice=null;s.observation.history={structuredChoice:null};
  const report=evaluateChoiceBenchmark(dataset(s));
  assert.deepEqual(report.synthetic.metrics.correctRejectRate,{numerator:1,denominator:1,rate:1});
  assert.equal(report.synthetic.metrics.strictWholeQuestionRecall.rate,null);
  assert.equal(report.diagnostics[0].status,"PASS");
});

test("R2A-03 hallucinated four labeled options are a false structure against unreadable pixels",()=>{
  const s=sample();s.truth={status:"unreadable",reason:"occluded"};
  const report=evaluateChoiceBenchmark(dataset(s));
  assert.equal(report.synthetic.counts.falseStructure,1);
  assert.deepEqual(report.synthetic.metrics.correctRejectRate,{numerator:0,denominator:1,rate:0});
  assert.ok(report.diagnostics[0].failures.includes("FALSE_STRUCTURE_ON_UNREADABLE_PIXELS"));
});

test("R2A-04 a wrong option pair, stem, or replay fails separately",()=>{
  const s=sample();
  s.observation.structuredChoice={...choice,stem:"另一道题",options:options.map((o,i)=>i===2?{...o,text:"错误的C项"}:o)};
  s.observation.history={structuredChoice:choice};
  const report=evaluateChoiceBenchmark(dataset(s));
  assert.equal(report.synthetic.metrics.optionPairExactRate.numerator,3);
  assert.equal(report.synthetic.metrics.stemExactRate.numerator,0);
  assert.equal(report.synthetic.metrics.historyConsistencyRate.numerator,0);
  assert.deepEqual(report.diagnostics[0].failures,["STEM_MISMATCH","OPTION_PAIR_MISMATCH_C","HISTORY_DTO_MISMATCH"]);
});

test("R2A-05 display gate rejects changed block ownership and text-only route",()=>{
  const a=sample("ownership");a.observation.resultBlockId="wrong-id";
  const b=sample("route");b.observation.routeUsed="text";
  const report=evaluateChoiceBenchmark(dataset(a,b));
  assert.equal(report.synthetic.counts.emitted,0);
  assert.equal(report.synthetic.counts.invalidOrUnauthorizedDto,2);
  assert.equal(report.synthetic.counts.missingStructure,2);
});

test("R2A-06 malformed schemas and duplicate samples fail closed",()=>{
  assert.throws(()=>evaluateChoiceBenchmark(dataset(sample(),sample())),/duplicate caseId/);
  const bad=sample();bad.truth.options=bad.truth.options.map((o,i)=>i===0?{...o,key:"B"}:o);
  assert.throws(()=>evaluateChoiceBenchmark(dataset(bad)),/ordered nonempty/);
  assert.throws(()=>evaluateChoiceBenchmark({...dataset(sample()),version:"unknown"}),/unsupported dataset/);
  const history=sample();history.observation.history={};
  assert.throws(()=>evaluateChoiceBenchmark(dataset(history)),/history must contain/);
});

test("R2A-07 real-image SHA is checked against bytes; no real-sample inflation",()=>{
  const dir=mkdtempSync(join(tmpdir(),"quiz-issue105-"));
  try{
    // Real decodable PNG payload generated offline, not a real Edge screenshot or pixel Ground Truth.
    const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQcGj4DwADRAHgMqq/hAAAAABJRU5ErkJggg==","base64");
    writeFileSync(join(dir,"test.png"),bytes);
    const s=sample("real-test");
    s.evidence={kind:"real_edge_screenshot",relativePath:"test.png",
      sha256:createHash("sha256").update(bytes).digest("hex"),
      annotation:{method:"human_pixel_review",reviewerAlias:"anon-reviewer",reviewedAt:"2026-10-13T00:00:00Z"}};
    const path=join(dir,"dataset.json");writeFileSync(path,"{}");
    const report=evaluateChoiceBenchmark(dataset(s),{datasetPath:path});
    assert.equal(report.status,"REAL_METRICS_NOT_EDGE_ACCEPTANCE");
    assert.equal(report.real.sampleCount,1);
    assert.equal(report.synthetic.sampleCount,0);
    s.evidence.sha256="a".repeat(64);
    assert.throws(()=>evaluateChoiceBenchmark(dataset(s),{datasetPath:path}),/SHA256 mismatch/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("R2A-08 path traversal and absent files cannot count as real evidence",()=>{
  const dir=mkdtempSync(join(tmpdir(),"quiz-issue105-"));
  try{
    const p=join(dir,"dataset.json");writeFileSync(p,"{}");
    const s=sample();
    s.evidence={kind:"real_edge_screenshot",relativePath:"../outside.png",
      sha256:"a".repeat(64),
      annotation:{method:"human_pixel_review",reviewerAlias:"reviewer-1",reviewedAt:"2026-10-13T00:00:00Z"}};
    assert.throws(()=>evaluateChoiceBenchmark(dataset(s),{datasetPath:p}),/unsafe screenshot path/);
    s.evidence.relativePath="missing.png";
    assert.throws(()=>evaluateChoiceBenchmark(dataset(s),{datasetPath:p}),/missing screenshot file/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("R2A-09 synthetic CLI emits report and never invents real metrics",()=>{
  const fixture=resolve("benchmarks/issue105/synthetic-fixtures.json");
  const parsed=loadChoiceBenchmarkDataset(fixture);
  assert.equal(parsed.samples.length,2);
  const processResult=spawnSync(process.execPath,["tools/issue105/runBenchmark.mjs",fixture],{encoding:"utf8"});
  assert.equal(processResult.status,0,processResult.stderr);
  const report=JSON.parse(processResult.stdout);
  assert.equal(report.status,"NO_REAL_SAMPLES");
  assert.equal(report.real.metrics.optionPairExactRate.rate,null);
  assert.equal(report.diagnostics.length,2);
});
