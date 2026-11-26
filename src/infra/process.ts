import spawn from "cross-spawn";
import treeKill from "tree-kill";

/**
 * Runs a program with an argument array (never a shell string), so names and
 * paths can't be read as shell syntax. cross-spawn makes this work for .cmd
 * files on Windows, such as npm.cmd, which Node refuses to spawn directly
 * since CVE-2024-27980 (ADR 8). Doesn't use VS Code, so the end-to-end test
 * can use it too.
 */

/** Keep the end of the output only; npm install can print a lot. */
const MAX_OUTPUT_CHARACTERS = 64 * 1024;

export interface RunProcessOptions {
  cwd: string;
  /** Aborting kills the program and everything it started. */
  signal: AbortSignal;
  /** Receives output as it arrives, e.g. for VS Code's Output panel. */
  onOutput?: (text: string) => void;
}

export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<{ output: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new Error("Cancelled."));
      return;
    }

    const commandLine = [command, ...args].join(" ");
    options.onOutput?.(`\n> ${commandLine}\n`);

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let output = "";
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output = (output + text).slice(-MAX_OUTPUT_CHARACTERS);
      options.onOutput?.(text);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    // child.kill() would leave npm's own child processes running on Windows.
    const onAbort = () => {
      if (child.pid !== undefined) {
        treeKill(child.pid);
      }
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    let settled = false;
    const finish = (error: Error | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal.removeEventListener("abort", onAbort);
      if (error === undefined) {
        resolve({ output });
      } else {
        reject(error);
      }
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ENOENT"
          ? new Error(
              `"${command}" wasn't found. Check that Node.js is installed and on the PATH that VS Code sees.`,
            )
          : error,
      );
    });

    child.on("close", (code, signalName) => {
      if (options.signal.aborted) {
        finish(new Error("Cancelled."));
      } else if (code === 0) {
        finish(undefined);
      } else {
        finish(
          new Error(
            `"${commandLine}" failed (${code === null ? `stopped by ${signalName}` : `exit code ${code}`}).\n${lastLines(output, 15)}`,
          ),
        );
      }
    });
  });
}

function lastLines(text: string, count: number): string {
  return text.trimEnd().split(/\r?\n/).slice(-count).join("\n");
}
