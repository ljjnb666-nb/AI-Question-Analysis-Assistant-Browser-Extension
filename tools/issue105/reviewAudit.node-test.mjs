import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { auditRealReviewEvidence, REVIEW_VERSION } from "./reviewAudit.mjs";

const SHA = "a".repeat(64);
const BASE = "e861b254bb66d5c52d0e03e2a8fb530c9d090874";
const OPT = [{key:"A",text:"检查安全阀"},{key:"B",text:"绕开保护"},{key:"C",text:"无视告警"},{key:"D",text:"删除记录"}];
const TRUTH={status:"readable",stem:"设备异常应如何处理？",options:OPT};
const parsed=(o=TRUTH)=>JSON.parse(JSON.stringify(o));
const imageBytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from("synthetic-unit-test-not-real-image")]);
const imageSha=createHash("sha256").update(imageBytes).digest("hex");

function realSample(id="r2b-1"){
  return {
    caseId:id,siteId:"public-site-a",
    capture:{
      client:"microsoft_edge",captureMethod:"manual_capture",sourcePolicy:"public_or_authorized",
      siteId:"public-site-a",sessionAlias:"session-01",capturedAt:"2026-10-13T11:00:00Z",
      extensionCommit:BASE,extensionArtifactSha256:SHA,
    },
    evidence:{
      kind:"real_edge_screenshot",relativePath:"shot.png",sha256:imageSha,
      annotation:{method:"human_pixel_review",reviewerAlias:"dataset-labeler",reviewedAt:"2026-10-13T11:02:00Z"},
    },
    truth:parsed(),
    observation:{blockId:"block-1",resultBlockId:"block-1",blockSource:"manual_capture",
      routeUsed:"vision",questionType:"single_choice",
      structuredChoice:{version:1,evidence:"vision_text_labels_unverified",stem:TRUTH.stem,options:parsed(OPT)},
      history:{structuredChoice:null}},
  };
}
function fixture(sample=realSample()){
  const dataset={version:"issue105-r2a-v1",datasetId:"dataset-01",samples:[sample]};
  const bytes=Buffer.from(JSON.stringify(dataset,null,2)+"\n","utf8");
  const reviews={version:REVIEW_VERSION,datasetId:dataset.datasetId,
    datasetSha256:createHash("sha256").update(bytes).digest("hex"),
    entries:["reviewer-01","reviewer-02"].map((reviewerAlias)=>({
      caseId:sample.caseId,imageSha256:sample.evidence.sha256,
      reviewerAlias,method:"independent_pixel_annotation",reviewedAt:"2026-10-13T12:00:00Z",truth:parsed(sample.truth),
    })),
  };
  return {dataset,bytes,reviews};
}
const audit=x=>auditRealReviewEvidence(x.dataset,{datasetBytes:x.bytes,reviews:x.reviews});
const rebindDatasetBytes=x=>{
  x.bytes=Buffer.from(JSON.stringify(x.dataset,null,2)+"\n","utf8");
  x.reviews.datasetSha256=createHash("sha256").update(x.bytes).digest("hex");
  return x;
};

test("R2B-01 two independent, image-bound matching annotations are required",()=>{
  const x=fixture();
  assert.deepEqual(audit(x),{state:"TWO_REVIEWER_CONSENSUS_SELF_ATTESTED_NOT_EDGE_ACCEPTANCE",
    reviewed:1,reviewersPerCase:2,datasetHashVerified:true});
});
test("R2B-02 one review or duplicate reviewer is rejected",()=>{
  const x=fixture();
  x.reviews.entries.pop();
  assert.throws(()=>audit(x),/exactly two reviews/);
  const y=fixture();
  y.reviews.entries[1].reviewerAlias="reviewer-01";
  assert.throws(()=>audit(y),/duplicate reviewer/);
});
test("R2B-03 semantic A-D disagreement, missing text or unreadable reason disagreement block the corpus",()=>{
  const x=fixture();x.reviews.entries[1].truth.options[2].text="伪造的 C 项";
  assert.throws(()=>audit(x),/reviewers disagree/);
  const y=fixture();y.reviews.entries[1].truth.options[2].text="";
  assert.throws(()=>audit(y),/invalid review entry/);
  const s=realSample();s.truth={status:"unreadable",reason:"occluded"};
  const z=fixture(s);z.reviews.entries[1].truth.reason="missing_labels";
  assert.throws(()=>audit(z),/reviewers disagree/);
});
test("R2B-04 self-asserted dataset ground truth that diverges from both reviewers is rejected",()=>{
  const x=fixture();x.reviews.entries.forEach(v=>{v.truth.options[0].text="虚假的 A 项";});
  assert.throws(()=>audit(x),/dataset truth differs/);
});
test("R2B-05 changing dataset bytes or screenshot hash fails closed",()=>{
  const x=fixture();x.bytes=Buffer.from(x.bytes.toString("utf8")+" ");
  assert.throws(()=>audit(x),/dataset SHA256 mismatch/);
  const y=fixture();y.reviews.entries[1].imageSha256="f".repeat(64);
  assert.throws(()=>audit(y),/review image digest mismatch/);
});
test("R2B-06 incorrect Edge capture claims, nonmanual routes and predating reviews fail closed",()=>{
  const x=fixture();x.dataset.samples[0].capture.client="chrome";
  rebindDatasetBytes(x);
  assert.throws(()=>audit(x),/incomplete Edge capture/);
  const y=fixture();y.dataset.samples[0].observation.routeUsed="text";
  rebindDatasetBytes(y);
  assert.throws(()=>audit(y),/manual visual route/);
  const z=fixture();z.reviews.entries[0].reviewedAt="2026-10-13T10:59:59Z";
  assert.throws(()=>audit(z),/review predates capture/);
});
test("R2B-07 unknown cases and third reviews are rejected, with no partial metrics",()=>{
  const x=fixture();x.reviews.entries[1].caseId="unknown-case";
  assert.throws(()=>audit(x),/unknown\/non-real case/);
  const y=fixture();y.reviews.entries.push({...y.reviews.entries[0],reviewerAlias:"reviewer-03"});
  assert.throws(()=>audit(y),/exactly two reviews/);
});
test("R2B-08 synthetic-only datasets reject fake review metadata without increasing real cohort",()=>{
  const data={version:"issue105-r2a-v1",datasetId:"synth",samples:[{
    caseId:"s1",siteId:"s1",evidence:{kind:"synthetic_fixture",fixtureId:"test"},
    truth:{status:"unreadable",reason:"missing_labels"},observation:{},
  }]};
  assert.deepEqual(auditRealReviewEvidence(data),{state:"NO_REAL_SAMPLES",reviewed:0,reviewersPerCase:0});
  assert.throws(()=>auditRealReviewEvidence(data,{reviews:{}}),/without real screenshot/);
});
test("R2B-09 real CLI fails without review bundle; valid fixture carries a warning even if results are computed",()=>{
  const dir=mkdtempSync(join(tmpdir(),"quiz-r2b-"));
  try{
    const x=fixture(),datasetPath=join(dir,"dataset.json"),reviewPath=join(dir,"reviews.json"),imagePath=join(dir,"shot.png");
    writeFileSync(datasetPath,x.bytes);
    writeFileSync(reviewPath,JSON.stringify(x.reviews,null,2)+"\n");
    writeFileSync(imagePath,imageBytes);
    const call=(...args)=>spawnSync(process.execPath,[resolve("tools/issue105/runBenchmark.mjs"),datasetPath,...args],{encoding:"utf8"});
    const missing=call();
    assert.equal(missing.status,2);
    assert.match(missing.stderr,/review bundle/);
    const valid=call("--reviews",reviewPath);
    assert.equal(valid.status,1,valid.stderr); // History DTO mismatch is expected, not a CLI ingestion failure.
    const report=JSON.parse(valid.stdout);
    assert.equal(report.reviewAudit.state,"TWO_REVIEWER_CONSENSUS_SELF_ATTESTED_NOT_EDGE_ACCEPTANCE");
    assert.equal(report.status,"REAL_METRICS_NOT_EDGE_ACCEPTANCE");
    assert.equal(report.real.sampleCount,1);
    assert.equal(report.diagnostics[0].status,"FAIL");
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test("R2B-10 CLI cannot overwrite old reports; explicit output works for synthetic corpus",()=>{
  const fixturePath=resolve("benchmarks/issue105/synthetic-fixtures.json");
  const dir=mkdtempSync(join(tmpdir(),"quiz-r2b-"));
  try{
    const out=join(dir,"report.json");
    const run=()=>spawnSync(process.execPath,[resolve("tools/issue105/runBenchmark.mjs"),fixturePath,"--output",out],{encoding:"utf8"});
    const first=run();assert.equal(first.status,0,first.stderr);
    assert.equal(JSON.parse(first.stdout).reviewAudit.state,"NO_REAL_SAMPLES");
    const second=run();assert.equal(second.status,2);assert.match(second.stderr,/EEXIST/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("R2B-11 rejects a mutated parsed dataset even when reviews agree with the altered object",()=>{
  const x=fixture();
  x.dataset.samples[0].truth.stem="已经篡改的数据集题干";
  for(const entry of x.reviews.entries)entry.truth.stem="已经篡改的数据集题干";
  assert.throws(()=>audit(x),/dataset object differs from bound bytes/);
});
test("R2B-12 rejects non-JSON bound bytes even when a matching review hash is provided",()=>{
  const x=fixture();
  x.bytes=Buffer.from("not-json","utf8");
  x.reviews.datasetSha256=createHash("sha256").update(x.bytes).digest("hex");
  assert.throws(()=>audit(x),/not valid JSON/);
});
