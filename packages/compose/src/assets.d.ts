/** Asset imports (`import x from "...woff2" with { type: "file" }`) resolve to a
 *  file path — in dev a node_modules path, in a `bun build --compile` binary an
 *  extracted embedded path. */
declare module "*.woff2" {
  const path: string;
  export default path;
}

declare module "*.svg" {
  const path: string;
  export default path;
}
