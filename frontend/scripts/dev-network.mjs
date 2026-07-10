import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FRONTEND_PORT = process.env.FRONTEND_PORT ?? "5173";

function isPrivateLanAddress(address) {
  return (
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function isTailscaleAddress(address) {
  return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address);
}

function interfaceAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function defaultHosts() {
  const addresses = interfaceAddresses();
  return unique([
    "127.0.0.1",
    ...addresses.filter(
      (address) => isPrivateLanAddress(address) || isTailscaleAddress(address),
    ),
  ]);
}

const hosts = process.env.FRONTEND_HOSTS
  ? unique(process.env.FRONTEND_HOSTS.split(",").map((host) => host.trim()))
  : defaultHosts();

if (hosts.length === 0) {
  console.error("No frontend hosts found.");
  process.exit(1);
}

console.log(`Starting frontend on: ${hosts.join(", ")}`);

const viteBin = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  ".bin",
  "vite",
);

const children = hosts.map((host) =>
  spawn(viteBin, ["--host", host, "--port", FRONTEND_PORT], {
    env: { ...process.env, FRONTEND_HOST: host },
    stdio: "inherit",
  }),
);

let exitCode = 0;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

function stopWithExitCode(code) {
  exitCode = code;
  stop();
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (stopping) return;
    stopWithExitCode(code || (signal ? 1 : 0));
  });
  child.on("error", () => stopWithExitCode(1));
}

process.on("SIGINT", () => {
  stopWithExitCode(130);
});

process.on("SIGTERM", () => {
  stopWithExitCode(143);
});

process.on("exit", () => {
  process.exitCode = exitCode;
});
