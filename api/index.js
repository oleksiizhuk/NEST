// Vercel serverless entry point.
// Requires the Nest app COMPILED by `nest build` (dist/), where the tsconfig
// path aliases (@infrastructure/*, @application/*, ...) are already resolved
// to relative paths. Vercel must NOT transpile src/ directly, otherwise those
// aliases stay unresolved at runtime ("Cannot find module '@infrastructure/...'").
// Before anything else: Vercel's own request wrapper calls the deprecated
// url.parse(), and Node would log DEP0169 on every new instance. Cosmetic,
// so a missing file never takes the function down.
try {
  require('../dist/config/quiet-warnings').quietPlatformWarnings();
} catch (error) {
  console.warn(`warning filter not installed: ${error}`);
}
const { bootstrapServer } = require('../dist/main');

let serverPromise;

module.exports = async (req, res) => {
  if (!serverPromise) serverPromise = bootstrapServer();
  const server = await serverPromise;
  server(req, res);
};
