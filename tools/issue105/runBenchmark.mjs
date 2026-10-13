#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateChoiceBenchmark, loadChoiceBenchmarkDataset } from "./benchmarkEngine.mjs";
import { auditRealReviewEvidence, readReviewBundle } from "./reviewAudit.mjs";

const args=process.argv.slice(2);
let datasetArg,reviewArg,outputArg,invalidArgs=false;
for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(arg==="--reviews"&&i+1<args.length&&!reviewArg)reviewArg=args[++i];
  else if(arg==="--output"&&i+1<args.length&&!outputArg)outputArg=args[++i];
  else if(!arg.startsWith("--")&&!datasetArg)datasetArg=arg;
  else invalidArgs=true;
}
if(!datasetArg||invalidArgs){
  console.error("用法：node tools/issue105/runBenchmark.mjs <dataset.json> [--reviews <reviews.json>] [--output <report.json>]");
  process.exitCode=2;
}else{
  try{
    const datasetPath=resolve(datasetArg);
    const dataset=loadChoiceBenchmarkDataset(datasetPath);
    const datasetBytes=readFileSync(datasetPath);
    const reviews=reviewArg?readReviewBundle(resolve(reviewArg)):undefined;
    // Always enforce review provenance BEFORE calculating any real metrics.
    const audit=auditRealReviewEvidence(dataset,{datasetBytes,reviews});
    const report={...evaluateChoiceBenchmark(dataset,{datasetPath}),reviewAudit:audit};
    const serialized=JSON.stringify(report,null,2)+"\n";
    if(outputArg)writeFileSync(resolve(outputArg),serialized,{flag:"wx"});
    process.stdout.write(serialized);
    if(report.diagnostics.some(item=>item.status==="FAIL"))process.exitCode=1;
  }catch(error){
    console.error(String(error instanceof Error?error.message:error));
    process.exitCode=2;
  }
}
