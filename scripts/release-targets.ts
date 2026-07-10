export const RELEASE_TARGETS = [
  {
    id: "darwin-arm64",
    packageName: "showtell-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    bunTarget: "bun-darwin-arm64",
  },
  {
    id: "linux-x64",
    packageName: "showtell-linux-x64",
    os: "linux",
    cpu: "x64",
    bunTarget: "bun-linux-x64-baseline",
    libc: "glibc",
  },
  {
    id: "linux-arm64",
    packageName: "showtell-linux-arm64",
    os: "linux",
    cpu: "arm64",
    bunTarget: "bun-linux-arm64",
    libc: "glibc",
  },
] as const;

export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];
export type PlatformId = ReleaseTarget["id"];

export function releaseTarget(id: string): ReleaseTarget | undefined {
  return RELEASE_TARGETS.find((target) => target.id === id);
}
