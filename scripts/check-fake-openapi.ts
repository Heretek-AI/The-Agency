/** Route self-check for check 08: every fake route exists in openapi.json. */
import {
  checkFakeRoutesAgainstOpenApi,
  loadOpenApiSpec,
} from "../dispatcher/test/support/fake-opencode.js";

const { spec, path } = await loadOpenApiSpec();
const missing = checkFakeRoutesAgainstOpenApi(spec);
if (missing.length > 0) {
  console.error(`fake-matches-openapi: missing from ${path}: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`fake-matches-openapi: all served routes exist in ${path}`);
