// Vercel serverless entry point.
// Requires the Nest app COMPILED by `nest build` (dist/), where the tsconfig
// path aliases (@infrastructure/*, @application/*, ...) are already resolved
// to relative paths. Vercel must NOT transpile src/ directly, otherwise those
// aliases stay unresolved at runtime ("Cannot find module '@infrastructure/...'").
const { bootstrapServer } = require('../dist/main');

let serverPromise;

module.exports = async (req, res) => {
  if (!serverPromise) serverPromise = bootstrapServer();
  const server = await serverPromise;
  server(req, res);
};
