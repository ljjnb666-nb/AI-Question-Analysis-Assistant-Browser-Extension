import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("SW-07/08/15 AST audit finds exactly one production appSettings writer and no UI import of its implementation", () => {
  const root = resolve("src");
  const files = readdirSync(root, { recursive: true }).map(String).filter(name => /\.tsx?$/.test(name) && !name.includes(".test") && !name.startsWith("test/") && !name.startsWith("test\\"));
  const owners: string[] = [];
  for (const name of files) {
    const file = ts.createSourceFile(name, readFileSync(resolve(root, name), "utf8"), ts.ScriptTarget.Latest, true);
    const variables = new Map<string, ts.Expression>();
    function collect(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer);
      ts.forEachChild(node, collect);
    }
    collect(file);
    function stringValue(node: ts.Node): string | undefined {
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isIdentifier(node)) { const value = variables.get(node.text); return value && stringValue(value); }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        let object = variables.get(node.expression.text);
        if (object && ts.isAsExpression(object)) object = object.expression;
        if (object && ts.isObjectLiteralExpression(object)) {
          const prop = object.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file) === node.name.text);
          if (prop && ts.isPropertyAssignment(prop)) return stringValue(prop.initializer);
        }
      }
    }
    function keys(node: ts.Expression): string[] {
      if (ts.isIdentifier(node)) {
        const value = variables.get(node.text);
        if (!value) throw new Error(`Unresolved storage write payload: ${name}:${node.getText(file)}`);
        return keys(value);
      }
      if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(p => {
        if (ts.isSpreadAssignment(p)) return keys(p.expression);
        if (!p.name) throw new Error(`Unknown storage payload ${name}`);
        const key = ts.isComputedPropertyName(p.name) ? stringValue(p.name.expression) : p.name.getText(file).replace(/["']/g, "");
        if (!key) throw new Error(`Unresolved storage key ${name}`);
        return [key];
      });
      if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(p => keys(p as ts.Expression));
      const value = stringValue(node);
      if (!value) throw new Error(`Unresolved storage removal key ${name}`);
      return [value];
    }
    // Resolve storage receiver syntax and local aliases, independent of whitespace/comments.
    function receiverPath(node: ts.Expression, seen = new Set<string>()): string | undefined {
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return receiverPath(node.expression, seen);
      if (ts.isIdentifier(node)) {
        if (node.text === "chrome") return "chrome";
        if (seen.has(node.text)) return undefined;
        seen.add(node.text);
        const value = variables.get(node.text);
        return value ? receiverPath(value, seen) : undefined;
      }
      if (ts.isPropertyAccessExpression(node)) {
        const parent = receiverPath(node.expression, seen);
        return parent ? `${parent}.${node.name.text}` : undefined;
      }
      if (ts.isElementAccessExpression(node)) {
        const parent = receiverPath(node.expression, seen);
        const key = stringValue(node.argumentExpression);
        return parent && key ? `${parent}.${key}` : undefined;
      }
    }
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /appSettingsAuthority/.test(node.moduleSpecifier.text) && !name.startsWith("background")) {
        throw new Error(`Non-background module imports writer: ${name}`);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const receiver = receiverPath(node.expression.expression);
        const method = node.expression.name.text;
        if (receiver === "chrome.storage.local" && ["set", "remove", "clear"].includes(method)) {
          if (method === "clear" || keys(node.arguments[0]).includes("appSettings")) owners.push(name.replace(/\\/g, "/"));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  expect(owners).toEqual(["background/appSettingsAuthority.ts"]);
}, 30000);
