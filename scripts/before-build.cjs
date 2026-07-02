// electron-builder beforeBuild hook: пред-собираем Remotion-бандл перед упаковкой.
// Срабатывает и при `npm run dist`, и при прямом вызове electron-builder в CI.
const { execSync } = require("node:child_process");
const path = require("node:path");

module.exports = async () => {
  const script = path.resolve(__dirname, "bundle-remotion.mjs");
  execSync(`node "${script}"`, { stdio: "inherit", cwd: path.resolve(__dirname, "..") });
  return true; // не отменять установку зависимостей electron-builder
};
