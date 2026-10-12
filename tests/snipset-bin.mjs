export const snipsetSkip = Bun.which("snipset") ? false : "snipset binary not on PATH";

// bun test prints a skipped test's name but not its reason, so say it once here.
if (snipsetSkip) console.warn(`skipping tests that run the real binary: ${snipsetSkip}`);
