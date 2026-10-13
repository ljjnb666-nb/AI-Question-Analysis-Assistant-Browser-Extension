#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateChoiceBenchmark, loadChoiceBenchmarkDataset } from "./benchmarkEngine.mjs";

const args=process.argv.slice(2);
if((args.length!==1&&args.length!==3)||(args.length===3&&args[1]!=="--output")){
  console.error("用法：node tools/issue105/runBenchmark.mjs <dataset.json> [--output <report.json>]");
  process.exitCode=2;
}else{
  try{
    const datasetPath=resolve(args[0]);
    const report=evaluateChoiceBenchmark(loadChoiceBenchmarkDataset(datasetPath),{datasetPath});
    const text=JSON.stringify(report,null,2)+"\n";
    process.stdout.write(text);
    if(args.length===3)writeFileSync(resolve(args[2]),text,{flag:"wx"});
    if(report.diagnostics.some(item=>item.status==="FAIL"))process.exitCode=1;
  }catch(error){
    console.error(String(error instanceof Error?error.message:error));
    process.exitCode=2;
  }
}
