/**
 * Show a file or folder in the system file manager (Explorer, Finder, or the Linux default), with
 * the file selected where the platform allows it. Under WSL the Windows Explorer is used, since
 * that is where the person is looking.
 */
import { execFile, spawn } from 'node:child_process';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';

const isWsl = process.platform === 'linux' && (() => { try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')); } catch { return false; } })();

const run = (cmd: string, args: string[]) => new Promise<string>((resolve, reject) => execFile(cmd, args, (e, out) => (e ? reject(e) : resolve(out))));
/** Explorer exits 1 even when it worked, so it is started and left alone. */
const detach = (cmd: string, args: string[], verbatim = false) => { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim }).unref(); };

export async function reveal(p: string): Promise<void> {
  const file = (await fs.stat(p)).isFile();
  if (process.platform === 'darwin') { await run('open', file ? ['-R', p] : [p]); return; }
  if (process.platform === 'win32') { detach('explorer.exe', [file ? `/select,"${p}"` : `"${p}"`], true); return; }
  if (isWsl) { const w = (await run('wslpath', ['-w', p])).trim(); detach('explorer.exe', [file ? `/select,${w}` : w]); return; }
  await run('xdg-open', [file ? path.dirname(p) : p]);
}

/** True when `p` is one of `roots` or inside one of them. */
export function within(p: string, roots: string[]): boolean {
  const r = path.resolve(p);
  return roots.some((root) => { const b = path.resolve(root); return r === b || r.startsWith(b + path.sep); });
}
