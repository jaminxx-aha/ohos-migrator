import { test } from "node:test";
import assert from "node:assert/strict";
import { extractImports } from "./import-extractor.js";

test("named bindings with alias", () => {
  const imps = extractImports(`import { a, b as c } from '@ohos.router';`);
  assert.equal(imps.length, 1);
  assert.equal(imps[0].specifier, "@ohos.router");
  assert.equal(imps[0].line, 1);
  assert.deepEqual(imps[0].bindings, [
    { imported: "a", local: "a" },
    { imported: "b", local: "c" },
  ]);
});

test("default import binding", () => {
  const imps = extractImports(`import dataUriUtils from '@ohos.x';`);
  assert.deepEqual(imps[0].bindings, [{ imported: "default", local: "dataUriUtils" }]);
});

test("namespace import binding", () => {
  const imps = extractImports(`import * as ns from '@ohos.x';`);
  assert.deepEqual(imps[0].bindings, [{ imported: "*", local: "ns" }]);
});

test("type-only import", () => {
  const imps = extractImports(`import type { Foo } from '@ohos.x';`);
  assert.equal(imps[0].specifier, "@ohos.x");
  assert.equal(imps[0].bindings[0].local, "Foo");
});

test("require import", () => {
  const imps = extractImports(`const x = require('@ohos.x');`);
  assert.equal(imps[0].specifier, "@ohos.x");
});

test("dynamic import()", () => {
  const imps = extractImports(`const m = import('@ohos.lazy');`);
  assert.equal(imps.length, 1);
  assert.equal(imps[0].specifier, "@ohos.lazy");
  assert.deepEqual(imps[0].bindings, []);
});

test("multi-line named bindings", () => {
  const content = "import {\n  a,\n  b as c,\n} from '@ohos.x';";
  const imps = extractImports(content);
  assert.equal(imps[0].bindings.length, 2);
  assert.equal(imps[0].bindings[1].local, "c");
});

test("line numbers across multiple imports", () => {
  const content = "import a from 'x';\nimport b from 'y';\nconst m = import('z');";
  const imps = extractImports(content);
  assert.equal(imps[0].line, 1);
  assert.equal(imps[1].line, 2);
  assert.equal(imps[2].line, 3);
});

test("specStart/specEnd surround the quoted specifier", () => {
  const content = `import a from '@ohos.x';`;
  const imps = extractImports(content);
  assert.equal(content.slice(imps[0].specStart, imps[0].specEnd), "'@ohos.x'");
});
